#!/usr/bin/env python3
"""Fill agg_envdata.raw_humidity for hours aggregated before the column existed.

Hours still covered by minute data are averaged from envdata.raw_humidity. Older
hours come from a snapshot taken before recompute_history.py ran, whose
agg_envdata.output_humidity still held the raw hourly average.

  python3 backfill_raw_humidity.py --backup environment-pre-recompute.db [--db environment]
"""
import argparse
import sqlite3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default='environment')
    parser.add_argument('--backup', required=True, help='snapshot taken before recompute_history.py')
    args = parser.parse_args()

    backup = sqlite3.connect(f'file:{args.backup}?mode=ro', uri=True)
    if backup.execute("SELECT 1 FROM agg_meta WHERE key = 'history_recomputed_v1'").fetchone():
        raise SystemExit('backup was taken after recompute_history.py; its humidity is no longer raw')
    raw_by_hour = dict(backup.execute(
        'SELECT hour, output_humidity FROM agg_envdata WHERE output_humidity IS NOT NULL').fetchall())
    backup.close()

    conn = sqlite3.connect(args.db, isolation_level=None)
    c = conn.cursor()
    if 'raw_humidity' not in [col[1] for col in c.execute('PRAGMA table_info(agg_envdata)')]:
        c.execute('ALTER TABLE agg_envdata ADD COLUMN raw_humidity REAL')

    c.execute('BEGIN IMMEDIATE')
    checkpoint = int(c.execute("SELECT value FROM agg_meta WHERE key = 'last_agg_checkpoint'").fetchone()[0])
    first_minute = c.execute('SELECT min(time) FROM envdata').fetchone()[0]
    first_full_hour = -(-first_minute // 3600) * 3600

    recent = c.execute('''SELECT (time / 3600) * 3600 AS h, avg(raw_humidity) FROM envdata
                          WHERE time >= ? AND time <= ? GROUP BY h''',
                       (first_full_hour, checkpoint)).fetchall()
    c.executemany('UPDATE agg_envdata SET raw_humidity = ? WHERE hour = ? AND raw_humidity IS NULL',
                  [(rh, h) for h, rh in recent])

    old_hours = [h for (h,) in c.execute(
        'SELECT hour FROM agg_envdata WHERE hour < ? AND raw_humidity IS NULL', (first_full_hour,))]
    from_backup = [(raw_by_hour[h], h) for h in old_hours if h in raw_by_hour]
    c.executemany('UPDATE agg_envdata SET raw_humidity = ? WHERE hour = ?', from_backup)
    c.execute('COMMIT')

    missing = c.execute('''SELECT count(*) FROM agg_envdata
                           WHERE raw_humidity IS NULL AND output_humidity IS NOT NULL''').fetchone()[0]
    print(f'raw_humidity: {len(recent)} hours from minute data, {len(from_backup)} from backup, '
          f'{missing} hours with humidity but no raw value')
    conn.close()


if __name__ == '__main__':
    main()
