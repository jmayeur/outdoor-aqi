#!/usr/bin/env python3
"""Recompute corrected temperature, humidity and pressure in the indoor Pi's history.

Run with the collector and the aggregator stopped. Raw minute columns are never modified.
Unlike the outdoor script this is safe to re-run after a recalibration: hourly rows that
have no minute data behind them are first copied, as found, into legacy_hourly, and every
run starts again from that copy.

What the old aqi_monitor.py era stored in the hourly tables (output_* columns):
  hour <  2021-06-06 05:00  cubic-corrected temp (F), quadratic humidity, pressure scaled
                            for altitude 300 m using the temperature in F as if it were C
  hour <  2026-06-01 23:00  the same with altitude 23 m
  hour =  2026-06-01 23:00  mix of corrected and raw (the aggregator change landed mid-hour): NULL
  later                     raw averages / raw peaks (the PR#1 aggregator averaged raw_*
                            into output_*), until minute data takes over on 2026-10-17

  envdata          output_* recomputed from raw columns: rows before the collector
                   cutover (agg_meta.indoor_collector_cutover) with the 'indoor_legacy'
                   profile, later rows with 'indoor'
  hours with       re-averaged / re-maxed from minute rows (up to the aggregation checkpoint)
  minute data
  older hours      decoded back to raw from legacy_hourly, then corrected with
                   'indoor_legacy'. Exact for temperature, close for pressure, approximate
                   for humidity (hourly averages of a nonlinear correction)

  python3 indoor/recompute_history_indoor.py [--db environment] [--dry-run]
"""
import argparse
import math
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
from enviro_math import (SITES, adjusted_temperature, adjusted_humidity, sea_level_pressure,
                         celsius_to_fahrenheit, fahrenheit_to_celsius)

ALTITUDE_300_UNTIL = 1622955600   # 2021-06-06 05:00 UTC, first hour after a 13-day gap
MIXED_HOUR = 1780354800           # 2026-06-01 23:00 UTC
MIN_VALID_RAW_BAR = 900

# aqi_monitor.py corrections (display enabled, temp_offset 0)
CUBIC = (-0.0001, 0.0037, 1.00568, -6.78291)
QUAD = (-0.0032, 1.6931, 0.9391)


def cubic(t):
    a, b, c, d = CUBIC
    return a * t ** 3 + b * t ** 2 + c * t + d


def inverse_cubic(out_c):
    lo, hi = -20.0, 70.0        # cubic() is increasing over this range
    for _ in range(60):
        mid = (lo + hi) / 2
        if cubic(mid) < out_c:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def inverse_quad(out_h):
    a, b, c = QUAD
    disc = b * b + 4 * a * (out_h - c)
    if disc < 0:
        return None
    return (-b + math.sqrt(disc)) / (2 * a)


def old_bar_factor(altitude, temp_f):
    return math.pow(1 - (0.0065 * altitude / (temp_f + 0.0065 * altitude + 273.15)), -5.257)


def encoding_of(hour):
    if hour < ALTITUDE_300_UNTIL:
        return 'cubic_alt300'
    if hour < MIXED_HOUR:
        return 'cubic_alt23'
    if hour == MIXED_HOUR:
        return 'mixed'
    return 'raw'


def decode(encoding, temp, hum, bar, avg_out_f=None):
    """Raw (temp C, RH, hPa) from stored values. avg_out_f: the hour's stored average temp,
    which the old pressure correction used (pass None to use temp itself)."""
    if encoding == 'raw':
        return fahrenheit_to_celsius(temp), hum, bar
    altitude = 300 if encoding == 'cubic_alt300' else 23
    raw_c = inverse_cubic(fahrenheit_to_celsius(temp))
    raw_h = inverse_quad(hum) if hum is not None else None
    raw_bar = bar / old_bar_factor(altitude, temp if avg_out_f is None else avg_out_f)
    return raw_c, raw_h, raw_bar


def corrected(raw_c, raw_h, raw_bar, site):
    out_c = adjusted_temperature(raw_c, site)
    hum = adjusted_humidity(raw_h, raw_c, out_c, site) if raw_h is not None else None
    bar = sea_level_pressure(raw_bar, out_c, site)
    return celsius_to_fahrenheit(out_c), hum, bar, out_c


def summarize(c, label):
    print(label)
    for table in ('envdata', 'agg_envdata', 'hourly_peak_envdata'):
        row = c.execute(f'''SELECT round(avg(output_temp), 2), round(min(output_temp), 1), round(max(output_temp), 1),
                                   round(avg(output_humidity), 2), round(avg(output_bar), 1),
                                   round(min(output_bar), 1), round(max(output_bar), 1)
                            FROM {table}''').fetchone()
        print(f'  {table:20} temp avg {row[0]} [{row[1]}, {row[2]}]  hum avg {row[3]}'
              f'  bar avg {row[4]} [{row[5]}, {row[6]}]')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default='environment')
    parser.add_argument('--dry-run', action='store_true', help='report the changes, then roll back')
    args = parser.parse_args()

    conn = sqlite3.connect(args.db, isolation_level=None)
    c = conn.cursor()
    c.execute('BEGIN IMMEDIATE')
    summarize(c, 'before')

    if not any(col[1] == 'raw_humidity' for col in c.execute('PRAGMA table_info(agg_envdata)')):
        c.execute('ALTER TABLE agg_envdata ADD COLUMN raw_humidity REAL')
    meta = dict(c.execute('SELECT key, value FROM agg_meta').fetchall())
    checkpoint = int(meta['last_agg_checkpoint'])
    cutover = int(meta.get('indoor_collector_cutover', 2 ** 62))
    first_minute = c.execute('SELECT min(time) FROM envdata').fetchone()[0]
    first_full_hour = -(-first_minute // 3600) * 3600

    # 0. keep the hourly rows that have no minute data behind them exactly as first found
    c.execute('''CREATE TABLE IF NOT EXISTS legacy_hourly (
                     hour INTEGER PRIMARY KEY, encoding TEXT NOT NULL,
                     avg_temp REAL, avg_hum REAL, avg_bar REAL, peak_temp REAL, peak_hum REAL, peak_bar REAL)''')
    if c.execute('SELECT count(*) FROM legacy_hourly').fetchone()[0] == 0:
        rows = c.execute('''SELECT a.hour, a.output_temp, a.output_humidity, a.output_bar,
                                   p.output_temp, p.output_humidity, p.output_bar
                            FROM agg_envdata a LEFT JOIN hourly_peak_envdata p ON p.hour = a.hour
                            WHERE a.hour < ?''', (first_full_hour,)).fetchall()
        c.executemany('INSERT INTO legacy_hourly VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                      [(r[0], encoding_of(r[0])) + tuple(r[1:]) for r in rows])
        print(f'legacy_hourly: saved {len(rows)} hours before {first_full_hour}')
    legacy_until = c.execute('SELECT max(hour) FROM legacy_hourly').fetchone()[0]

    # 1. minute rows
    updates = []
    for rowid, t, raw_f, raw_h, raw_bar in c.execute(
            'SELECT rowid, time, raw_temp, raw_humidity, raw_bar FROM envdata WHERE raw_temp IS NOT NULL').fetchall():
        if raw_bar is None or raw_bar < MIN_VALID_RAW_BAR:
            updates.append((None, None, None, rowid))
            continue
        site = 'indoor' if t >= cutover else 'indoor_legacy'
        temp_f, hum, bar, _ = corrected(fahrenheit_to_celsius(raw_f), raw_h, raw_bar, site)
        updates.append((round(temp_f, 2), round(hum, 2), round(bar, 1), rowid))
    c.executemany('UPDATE envdata SET output_temp = ?, output_humidity = ?, output_bar = ? WHERE rowid = ?', updates)
    print(f'envdata: recomputed {len(updates)} minute rows')

    # 2. hours covered by minute data, up to what the aggregator has already folded in
    recent = c.execute('''SELECT (time / 3600) * 3600 AS h, avg(output_temp), avg(output_humidity), avg(raw_humidity),
                                 avg(output_bar), max(output_temp), max(output_humidity), max(output_bar), count(*)
                          FROM envdata WHERE time >= ? AND time <= ? GROUP BY h''',
                       (first_full_hour, checkpoint)).fetchall()
    c.executemany('''UPDATE agg_envdata SET output_temp = ?, output_humidity = ?, raw_humidity = ?, output_bar = ?,
                     ENTRIES = ? WHERE hour = ?''', [(r[1], r[2], r[3], r[4], r[8], r[0]) for r in recent])
    c.executemany('UPDATE hourly_peak_envdata SET output_temp = ?, output_humidity = ?, output_bar = ? WHERE hour = ?',
                  [(r[5], r[6], r[7], r[0]) for r in recent])
    print(f'hourly: re-aggregated {len(recent)} hours from minute data')

    # 3. legacy hours: decode to raw, correct with the indoor_legacy profile
    agg_updates, peak_updates = [], []
    counts = {}
    for hour, enc, at, ah, ab, pt, ph, pb in c.execute('SELECT * FROM legacy_hourly').fetchall():
        counts[enc] = counts.get(enc, 0) + 1
        if enc == 'mixed' or at is None or ab is None or (enc == 'raw' and ab < MIN_VALID_RAW_BAR):
            agg_updates.append((None, None, None, None, hour))
            peak_updates.append((None, None, None, hour))
            continue
        raw_c, raw_h, raw_bar = decode(enc, at, ah, ab)
        temp_f, hum, bar, out_c = corrected(raw_c, raw_h, raw_bar, 'indoor_legacy')
        agg_updates.append((temp_f, hum, raw_h, bar, hour))
        if pt is None:
            continue
        # peaks: temperature maps exactly (monotonic); humidity and pressure use the hour's average temps
        peak_raw_c = decode(enc, pt, None, 1000.0)[0]
        peak_f = celsius_to_fahrenheit(adjusted_temperature(peak_raw_c, 'indoor_legacy'))
        peak_raw_h = (ph if enc == 'raw' else inverse_quad(ph)) if ph is not None else None
        peak_hum = adjusted_humidity(peak_raw_h, raw_c, out_c, 'indoor_legacy') if peak_raw_h is not None else None
        peak_raw_bar = decode(enc, at, None, pb, avg_out_f=at)[2] if pb is not None else None
        peak_bar = sea_level_pressure(peak_raw_bar, out_c, 'indoor_legacy') if pb is not None else None
        peak_updates.append((peak_f, peak_hum, peak_bar, hour))
    c.executemany('UPDATE agg_envdata SET output_temp = ?, output_humidity = ?, raw_humidity = ?, output_bar = ? '
                  'WHERE hour = ?', agg_updates)
    c.executemany('UPDATE hourly_peak_envdata SET output_temp = ?, output_humidity = ?, output_bar = ? WHERE hour = ?',
                  peak_updates)
    print(f'hourly: corrected {len(agg_updates)} legacy hours {counts}, {len(peak_updates)} peak rows')

    c.execute('INSERT OR REPLACE INTO agg_meta (key, value) VALUES (?, ?)',
              ('indoor_history_recomputed', f'{int(time.time())} legacy_until={legacy_until} '
               f'first_full_hour={first_full_hour} checkpoint={checkpoint} cutover={meta.get("indoor_collector_cutover")} '
               f'legacy={SITES["indoor_legacy"]} indoor={SITES["indoor"]}'))
    summarize(c, 'after')

    if args.dry_run:
        c.execute('ROLLBACK')
        print('dry run: rolled back')
    else:
        c.execute('COMMIT')
        print('committed')
    conn.close()


if __name__ == '__main__':
    main()
