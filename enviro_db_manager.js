const sqlite3 = require('sqlite3');

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

    readOldData(olderThan) {
        const params = [olderThan];
        const query = 'SELECT * FROM envdata WHERE time <= ?';
        return this._readData(query, params);
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
                            console.log('success', success);
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
                            console.log('success', success);
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
    const olderThan = Math.round(Date.now() / 1000, 0) - (24 * 60 * 60);
    let bucketedHourMap;
    return enviroDBManager.openDB('environment').then(out => {
        console.log(out);
        console.log(`Reading data older than ${olderThan}`);
        return enviroDBManager.readOldData(olderThan).then(result => {
            console.log(`Read old data ${result.data.length}`);
            bucketedHourMap = enviroDBManager.bucketData(result.data);
            console.log('bucketedHourMap built');
            const localAggregates = enviroDBManager.createTempAggs(bucketedHourMap);
            console.log('prepped aggs built');
            return enviroDBManager.updateFinalAggs(localAggregates).then(aggregated => {
                if (aggregated) {
                    console.log(`Aggs written to DB ${aggregated}`);
                    const localHourlyPeaks = enviroDBManager.createTempHourlyPeaks(bucketedHourMap);
                    return enviroDBManager.updateHourPeaks(localHourlyPeaks).then(peakssaved => {
                        if (peakssaved) {
                            console.log(`Houly Peaks written to DB ${peakssaved}`);
                            return enviroDBManager.purgeOldData(olderThan).then(result => {
                                console.log('Run envdata pruned');
                                return enviroDBManager.close();
                            });
                        }
                    });
                }
            });
        }).catch(err => console.error(err));
    }).catch(e => console.error(e));
}

setInterval(() => {
    main();
}, 10 * 60 * 1000); // Every 10 minutes

