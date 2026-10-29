#!/usr/bin/env python3
"""Recompute corrected temperature, humidity and pressure in stored history.

Run once, with enviro.service and the aggregator stopped, after deploying the
enviro_math.py corrections. Raw columns are never modified.

  envdata                  output_humidity / output_bar recomputed from the raw columns
                           (output_temp too, which is unchanged apart from rounding).
  agg_envdata /            hours still covered by minute data are re-averaged (and
  hourly_peak_envdata      re-maxed) from the recomputed minute rows. Older hours only
                           ever stored raw averages under the output_* names, so they are
                           corrected from those averages: exact for temperature, close
                           for pressure, approximate for humidity (and for the humidity
                           and pressure peaks, which use the hour's average temperature).
                           Hours whose average pressure shows the BME280 fallback
                           writing zeros get NULL temp/humidity/pressure.

Writes agg_meta.history_recomputed_v1 and refuses to run again, since the older
hourly rows would otherwise be corrected twice.

  python3 recompute_history.py [--db environment] [--dry-run]
"""
import argparse
import sqlite3
import time

from enviro_math import (adjusted_temperature, adjusted_humidity, adjusted_pressure,
                         celsius_to_fahrenheit, fahrenheit_to_celsius, station_altitude_m)

MARKER = 'history_recomputed_v1'
# Average raw pressure below this means the hour includes zeroed BME280 readings
MIN_VALID_RAW_BAR = 900


def corrected(raw_temp_f, raw_hum, raw_bar):
    raw_c = fahrenheit_to_celsius(raw_temp_f)
    out_c = adjusted_temperature(raw_c)
    return (celsius_to_fahrenheit(out_c),
            adjusted_humidity(raw_hum, raw_c, out_c),
            adjusted_pressure(raw_bar, station_altitude_m, out_c),
            raw_c, out_c)


def summarize(c, label):
    print(label)
    for table in ('envdata', 'agg_envdata', 'hourly_peak_envdata'):
        row = c.execute(f'''SELECT round(avg(output_temp), 2), round(avg(output_humidity), 2),
                                   round(max(output_humidity), 2), sum(output_humidity > 100),
                                   round(avg(output_bar), 1), round(min(output_bar), 1),
                                   round(max(output_bar), 1)
                            FROM {table}''').fetchone()
        print(f'  {table:20} temp avg {row[0]}  hum avg {row[1]} max {row[2]} (>100: {row[3]})'
              f'  bar avg {row[4]} min {row[5]} max {row[6]}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default='environment')
    parser.add_argument('--dry-run', action='store_true', help='report the changes, then roll back')
    args = parser.parse_args()

    conn = sqlite3.connect(args.db, isolation_level=None)
    c = conn.cursor()
    if c.execute('SELECT value FROM agg_meta WHERE key = ?', (MARKER,)).fetchone():
        raise SystemExit(f'{MARKER} is already set in agg_meta; refusing to correct hourly rows twice')

    c.execute('BEGIN IMMEDIATE')
    summarize(c, 'before')

    checkpoint = int(c.execute("SELECT value FROM agg_meta WHERE key = 'last_agg_checkpoint'").fetchone()[0])
    first_minute = c.execute('SELECT min(time) FROM envdata').fetchone()[0]
    # first hour whose minute data has not been partly purged
    first_full_hour = -(-first_minute // 3600) * 3600

    # 1. minute rows
    minute_rows = c.execute('''SELECT rowid, raw_temp, raw_humidity, raw_bar FROM envdata
                               WHERE raw_temp IS NOT NULL''').fetchall()
    updates = []
    for rowid, raw_temp, raw_hum, raw_bar in minute_rows:
        if raw_bar is None or raw_bar < MIN_VALID_RAW_BAR:
            updates.append((None, None, None, rowid))
            continue
        temp_f, hum, bar, _, _ = corrected(raw_temp, raw_hum, raw_bar)
        updates.append((round(temp_f, 2), round(hum, 2), round(bar, 1), rowid))
    c.executemany('UPDATE envdata SET output_temp = ?, output_humidity = ?, output_bar = ? WHERE rowid = ?',
                  updates)
    print(f'envdata: recomputed {len(updates)} minute rows')

    # 2. hours still covered by minute data: re-aggregate (only rows up to the checkpoint,
    #    matching what the aggregator has already folded in)
    recent = c.execute('''SELECT (time / 3600) * 3600 AS h, avg(output_temp), avg(output_humidity),
                                 avg(output_bar), max(output_temp), max(output_humidity), max(output_bar)
                          FROM envdata WHERE time >= ? AND time <= ? GROUP BY h''',
                       (first_full_hour, checkpoint)).fetchall()
    c.executemany('UPDATE agg_envdata SET output_temp = ?, output_humidity = ?, output_bar = ? WHERE hour = ?',
                  [(r[1], r[2], r[3], r[0]) for r in recent])
    c.executemany('UPDATE hourly_peak_envdata SET output_temp = ?, output_humidity = ?, output_bar = ? WHERE hour = ?',
                  [(r[4], r[5], r[6], r[0]) for r in recent])
    print(f'hourly: re-aggregated {len(recent)} hours from minute data')

    # 3. older hours: stored output_* are raw averages / raw peaks
    old_aggs = c.execute('''SELECT hour, output_temp, output_humidity, output_bar FROM agg_envdata
                            WHERE hour < ? AND output_temp IS NOT NULL''', (first_full_hour,)).fetchall()
    agg_updates = []
    hour_temps = {}
    faulty = 0
    for hour, raw_temp, raw_hum, raw_bar in old_aggs:
        if raw_bar is None or raw_bar < MIN_VALID_RAW_BAR:
            agg_updates.append((None, None, None, hour))
            hour_temps[hour] = None
            faulty += 1
            continue
        temp_f, hum, bar, raw_c, out_c = corrected(raw_temp, raw_hum, raw_bar)
        agg_updates.append((temp_f, hum, bar, hour))
        hour_temps[hour] = (raw_c, out_c)
    c.executemany('UPDATE agg_envdata SET output_temp = ?, output_humidity = ?, output_bar = ? WHERE hour = ?',
                  agg_updates)

    old_peaks = c.execute('''SELECT hour, output_temp, output_humidity, output_bar FROM hourly_peak_envdata
                             WHERE hour < ? AND output_temp IS NOT NULL''', (first_full_hour,)).fetchall()
    peak_updates = []
    for hour, raw_temp, raw_hum, raw_bar in old_peaks:
        if hour in hour_temps and hour_temps[hour] is None:
            peak_updates.append((None, None, None, hour))
            continue
        # the temperature correction is monotonic, so the peak maps exactly
        peak_temp_f = celsius_to_fahrenheit(adjusted_temperature(fahrenheit_to_celsius(raw_temp)))
        raw_c, out_c = hour_temps.get(hour) or (fahrenheit_to_celsius(raw_temp),
                                                adjusted_temperature(fahrenheit_to_celsius(raw_temp)))
        peak_updates.append((peak_temp_f, min(100.0, adjusted_humidity(raw_hum, raw_c, out_c)),
                             adjusted_pressure(raw_bar, station_altitude_m, out_c), hour))
    c.executemany('UPDATE hourly_peak_envdata SET output_temp = ?, output_humidity = ?, output_bar = ? WHERE hour = ?',
                  peak_updates)
    print(f'hourly: corrected {len(agg_updates)} older hours ({faulty} with zeroed sensor readings nulled), '
          f'{len(peak_updates)} peak rows')

    c.execute('INSERT INTO agg_meta (key, value) VALUES (?, ?)',
              (MARKER, f'{int(time.time())} first_full_hour={first_full_hour} checkpoint={checkpoint}'))
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
