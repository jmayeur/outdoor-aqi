const sqlite3 = require('sqlite3');

const AGG_WINDOW_SECS   = 24 * 60 * 60;       // aggregate data older than 24 h
const PURGE_WINDOW_SECS = 30 * 24 * 60 * 60;  // delete minute-level data older than 30 days

class EnviroDBManager {

    constructor() {
        this.dbConn = null;
    }

    close() {
        if (this.dbConn) {
            try {
                this.dbConn.close();
            } catch (e) {
                console.error(e);
            }
        }
    }

    openDB(path) {
        return new Promise((resolve, reject) => {
            this.dbConn = new sqlite3.Database(path, sqlite3.OPEN_READWRITE,
                (err) => {
                    if (err) {
                        reject(`DB ${path} open error ${err.message}`);
                    }
                    else {
                        resolve(`DB ${path} is open`);
                    }
                }
            )
        });
    }

    _readData(query, params) {
        return new Promise((resolve, reject) => {
            this.dbConn.all(query, params, (err, rows) => {
                if (err) {
                    reject("Read error: " + err.message);
                }
                else {
                    resolve({ data: rows });
                }
            })
        });
    };

    _execQuery(query, params) {
        return new Promise((resolve, reject) => {
            this.dbConn.run(query, params,
                (err) => {
                    if (err) {
                        reject(err.message);
                    }
                    else {
                        resolve(true);
                    }
                });
        });
    }

    // ── Aggregation checkpoint ────────────────────────────────────────────────
    //
    // agg_meta is a lightweight key/value table that persists the high-water
    // mark of the last successful aggregation run.  Creating it with
    // IF NOT EXISTS makes the first run self-bootstrapping — no migration step.

    ensureMetaTable() {
        return this._execQuery(
            `CREATE TABLE IF NOT EXISTS agg_meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )`,
            []
        );
    }

    /** Returns the Unix timestamp (seconds) of the last successful aggregation,
     *  or 0 on the very first run so all data older than aggCutoff is processed. */
    readLastAggCheckpoint() {
        return this._readData(
            `SELECT value FROM agg_meta WHERE key = 'last_agg_checkpoint'`,
            []
        ).then(result => {
            if (result.data && result.data.length > 0) {
                return parseInt(result.data[0].value, 10);
            }
            return 0;
        });
    }

    /** Persists the aggregation high-water mark.  Called only after both
     *  updateFinalAggs and updateHourPeaks complete successfully. */
    writeLastAggCheckpoint(ts) {
        return this._execQuery(
            `INSERT INTO agg_meta (key, value) VALUES ('last_agg_checkpoint', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [ts.toString()]
        );
    }

    // ── Data reads ────────────────────────────────────────────────────────────

    /**
     * Returns envdata rows that fall in the half-open interval (newerThan, olderThan].
     *
     *  newerThan  — the last aggregation checkpoint (skip already-processed rows)
     *  olderThan  — now minus 24 h (skip the most-recent hour so partial hours
     *               are never aggregated mid-fill)
     *
     * Rows are ordered by time so bucketData produces chronologically correct buckets.
     */
    readUnprocessedData(newerThan, olderThan) {
        return this._readData(
            'SELECT * FROM envdata WHERE time > ? AND time <= ? ORDER BY time',
            [newerThan, olderThan]
        );
    }

    bucketData(rows) {
        return rows.reduce((c, r) => {
            const date = new Date(r.time * 1000);
            const hourBucket = new Date(`${date.toLocaleDateString('en-US')} ${date.getHours()}:00:00`).getTime().toString();
            if (!c[hourBucket]) {
                c[hourBucket] = [];
            }
            c[hourBucket].push(r);
            return c;
        }, {});
    }

    createTempAggs(bucketedHourMap) {
        return Object.keys(bucketedHourMap).map((key) => {
            const hourBucket = bucketedHourMap[key];
            const sumMap = {
                hour: new Date(parseInt(key)).getTime() / 1000,
                raw_temp: 0,
                raw_humidity: 0,
                raw_bar: 0,
                oxi: 0,
                red: 0,
                nh3: 0,
                p1: 0,
                P10: 0,
                P25: 0,
                ENTRIES: 0
            };

            const rawData = hourBucket.reduce((c, r) => {
                c.raw_temp += r.raw_temp;
                c.raw_humidity += r.raw_humidity;
                c.raw_bar += r.raw_bar;
                c.oxi += r.oxi;
                c.red += r.red;
                c.nh3 += r.nh3;
                c.p1 += r.p1;
                c.P10 += r.P10;
                c.P25 += r.P25;
                c.ENTRIES += 1;
                return c;
            }, sumMap);

            rawData.raw_temp = rawData.raw_temp / rawData.ENTRIES;
            rawData.raw_humidity = rawData.raw_humidity / rawData.ENTRIES;
            rawData.raw_bar = rawData.raw_bar / rawData.ENTRIES;
            rawData.oxi = rawData.oxi / rawData.ENTRIES;
            rawData.red = rawData.red / rawData.ENTRIES;
            rawData.nh3 = rawData.nh3 / rawData.ENTRIES;
            rawData.p1 = rawData.p1 / rawData.ENTRIES;
            rawData.P10 = rawData.P10 / rawData.ENTRIES;
            rawData.P25 = rawData.P25 / rawData.ENTRIES;
            return rawData;
        });
    }

    createTempHourlyPeaks(bucketedHourMap) {
        return Object.keys(bucketedHourMap).map((key) => {
            const hourBucket = bucketedHourMap[key];
            const peakMap = {
                hour: new Date(parseInt(key)).getTime() / 1000,
                raw_temp: 0,
                raw_humidity: 0,
                raw_bar: 0,
                oxi: 0,
                red: 0,
                nh3: 0,
                p1: 0,
                P10: 0,
                P25: 0
            };

            const calcMaxVal = (a, b, field) => {
                return a[field] >= b[field] ? a[field] : b[field]
            }

            return hourBucket.reduce((c, r) => {
                Object.keys(c).forEach(key => {
                    if (key != 'hour') {
                        c[key] = calcMaxVal(c, r, key);
                    }
                });
                return c;
            }, peakMap);

        });
    }

    /**
     * Deletes envdata rows older than the given timestamp.
     *
     * Previously called with a 24-hour cutoff (immediately after aggregation).
     * Now called with a 30-day cutoff so minute-level data is retained long
     * enough for any failed daily scoring job to be replayed from raw readings.
     */
    purgeOldData(olderThan) {
        const query = 'DELETE FROM envdata WHERE time <= ?';
        const params = [olderThan];
        return this._execQuery(query, params);
    }

    mapDataToParams(data) {
        return Object.keys(data).reduce((acc, key) => {
            acc[`$${key}`] = data[key];
            return acc;
        }, {});
    }

    updateFinalAggs(aggregates) {
        const calculateCombined = (a, b, field, sfield) => {
            return (a[field] * a.ENTRIES + b[sfield] * b.ENTRIES) / (a.ENTRIES + b.ENTRIES);
        }
        return new Promise((resolve, reject) => {

            const success = [];
            aggregates.forEach(aggregate => {
                this._readData('SELECT * FROM agg_envdata WHERE hour = ? ', [aggregate.hour]).then(result => {
                    const finalAggregate = aggregate;
                    let query;
                    if (result && result.data && result.data.length > 0) {
                        const existingAggregate = result.data[0];
                        finalAggregate.raw_temp = calculateCombined(finalAggregate, existingAggregate, 'raw_temp', 'output_temp');
                        finalAggregate.raw_humidity = calculateCombined(finalAggregate, existingAggregate, 'raw_humidity', 'output_humidity');
                        finalAggregate.raw_bar = calculateCombined(finalAggregate, existingAggregate, 'raw_bar', 'output_bar');
                        finalAggregate.oxi = calculateCombined(finalAggregate, existingAggregate, 'oxi', 'oxi');
                        finalAggregate.red = calculateCombined(finalAggregate, existingAggregate, 'red', 'red');
                        finalAggregate.nh3 = calculateCombined(finalAggregate, existingAggregate, 'nh3', 'nh3');
                        finalAggregate.p1 = calculateCombined(finalAggregate, existingAggregate, 'p1', 'p1');
                        finalAggregate.P10 = calculateCombined(finalAggregate, existingAggregate, 'P10', 'P10');
                        finalAggregate.P25 = calculateCombined(finalAggregate, existingAggregate, 'P25', 'P25');
                        finalAggregate.ENTRIES = existingAggregate.ENTRIES + finalAggregate.ENTRIES;

                        query = `UPDATE agg_envdata
                        SET
                        output_temp = $raw_temp,
                        output_humidity = $raw_humidity,
                        output_bar = $raw_bar,
                        oxi = $oxi,
                        red = $red,
                        nh3 = $nh3,
                        p1 = $p1,
                        P10 = $P10,
                        P25 = $P25,
                        ENTRIES = $ENTRIES WHERE hour = $hour;`;

                    } else {
                        query = `INSERT INTO agg_envdata (hour, output_temp, output_humidity, output_bar, oxi, red, nh3, p1, P10, P25, ENTRIES)
                        VALUES ($hour, $raw_temp, $raw_humidity, $raw_bar, $oxi, $red, $nh3, $p1, $P10, $P25, $ENTRIES);`;
                    }

                    this._execQuery(query, this.mapDataToParams(finalAggregate)).then(r => {
                        success.push(r)
                        if (success.length === aggregates.length) {
                            return resolve(true);
                        }
                    }).catch(err => reject(err));
                }).catch(e => {
                    return reject(e);
                });
            });
        });
    }

    updateHourPeaks(hourPeaks) {
        return new Promise((resolve, reject) => {

            const success = [];
            hourPeaks.forEach(hourPeak => {
                this._readData('SELECT * FROM hourly_peak_envdata WHERE hour = ? ', [hourPeak.hour]).then(result => {
                    const finalHourPeak = hourPeak;
                    let query;
                    if (result && result.data && result.data.length > 0) {
                        const existingHourPeak = result.data[0];
                        Object.keys(finalHourPeak).forEach(key => {
                            let existing_key = key;
                            if (existing_key === 'raw_temp') {
                                existing_key = 'output_temp';
                            } else if (existing_key === 'raw_humidity') {
                                existing_key = 'output_humidity';
                            } else if (existing_key === 'raw_bar') {
                                existing_key = 'output_bar';
                            }
                            finalHourPeak[key] = finalHourPeak[key] >= existingHourPeak[existing_key] ? finalHourPeak[key] : existingHourPeak[existing_key];
                        });

                        query = `UPDATE hourly_peak_envdata
                        SET
                        output_temp = $raw_temp,
                        output_humidity = $raw_humidity,
                        output_bar = $raw_bar,
                        oxi = $oxi,
                        red = $red,
                        nh3 = $nh3,
                        p1 = $p1,
                        P10 = $P10,
                        P25 = $P25 WHERE hour = $hour;`;

                    } else {
                        query = `INSERT INTO hourly_peak_envdata (hour, output_temp, output_humidity, output_bar, oxi, red, nh3, p1, P10, P25)
                        VALUES ($hour, $raw_temp, $raw_humidity, $raw_bar, $oxi, $red, $nh3, $p1, $P10, $P25);`;
                    }
                    this._execQuery(query, this.mapDataToParams(finalHourPeak)).then(r => {
                        success.push(r)
                        if (success.length === hourPeaks.length) {
                            return resolve(true);
                        }
                    }).catch(err => reject(err));
                }).catch(e => {
                    return reject(e);
                });
            });
        });
    }
}

const enviroDBManager = new EnviroDBManager();

function main() {
    const now         = Math.round(Date.now() / 1000);
    const aggCutoff   = now - AGG_WINDOW_SECS;    // upper bound: only aggregate complete hours
    const purgeCutoff = now - PURGE_WINDOW_SECS;  // lower bound: keep 30 days of minute data

    return enviroDBManager.openDB('environment')
        .then(msg => {
            console.log(msg);
            return enviroDBManager.ensureMetaTable();
        })
        .then(() => enviroDBManager.readLastAggCheckpoint())
        .then(checkpoint => {
            console.log(`Aggregation window: ${checkpoint} → ${aggCutoff}`);
            return enviroDBManager.readUnprocessedData(checkpoint, aggCutoff);
        })
        .then(result => {
            console.log(`Found ${result.data.length} unprocessed rows`);
            if (result.data.length === 0) {
                return;  // nothing new to aggregate; fall through to purge
            }

            const bucketedHourMap  = enviroDBManager.bucketData(result.data);
            const localAggregates  = enviroDBManager.createTempAggs(bucketedHourMap);
            const localHourlyPeaks = enviroDBManager.createTempHourlyPeaks(bucketedHourMap);

            return enviroDBManager.updateFinalAggs(localAggregates)
                .then(() => {
                    console.log('Aggregates written to DB');
                    return enviroDBManager.updateHourPeaks(localHourlyPeaks);
                })
                .then(() => {
                    console.log('Hourly peaks written to DB');
                    // Only advance the checkpoint after both writes succeed.
                    // If either throws, this line is skipped and the next tick retries.
                    return enviroDBManager.writeLastAggCheckpoint(aggCutoff);
                })
                .then(() => console.log(`Checkpoint advanced to ${aggCutoff}`));
        })
        .then(() => {
            console.log(`Purging envdata older than 30 days (cutoff: ${purgeCutoff})`);
            return enviroDBManager.purgeOldData(purgeCutoff);
        })
        .then(() => {
            console.log('Purge complete');
            enviroDBManager.close();
        })
        .catch(err => {
            console.error('Error in main():', err);
            enviroDBManager.close();
        });
}

setInterval(() => {
    main();
}, 10 * 60 * 1000); // Every 10 minutes
