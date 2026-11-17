// Daily rollup of the hourly table for the Years page: one row per local calendar day.
// Days follow the process time zone (the Pis run America/Los_Angeles). The result only
// changes when a new hour is aggregated, so it is cached and keyed by the newest hour.
const { openDB, closeDB } = require('./db');

const FIELDS = ['day', 'hours', 'tmin', 'tmax', 'tavg', 'havg', 'hmin', 'hmax', 'bavg', 'pavg', 'pmax'];

const QUERY = `
    SELECT date(hour, 'unixepoch', 'localtime') AS day,
           count(*) AS hours,
           round(min(output_temp), 1), round(max(output_temp), 1), round(avg(output_temp), 1),
           round(avg(output_humidity), 1), round(min(output_humidity), 1), round(max(output_humidity), 1),
           round(avg(output_bar), 1),
           round(avg(P25), 2), round(max(P25), 2)
    FROM agg_envdata
    GROUP BY day
    ORDER BY day`;

let cache = { newestHour: null, body: null };

const all = (db, sql) => new Promise((resolve, reject) => {
    db.all(sql, [], (err, rows) => (err ? reject(`Read error: ${err.message}`) : resolve(rows)));
});

const readDailyData = async () => {
    const db = await openDB();
    try {
        const [{ newest }] = await all(db, 'SELECT max(hour) AS newest FROM agg_envdata');
        if (cache.body && cache.newestHour === newest) {
            return cache.body;
        }
        const rows = await all(db, QUERY);
        // Arrays instead of objects keep the payload small (about 1.5k days per sensor)
        const body = JSON.stringify({ fields: FIELDS, newestHour: newest, rows: rows.map(Object.values) });
        cache = { newestHour: newest, body };
        return body;
    } finally {
        closeDB(db);
    }
};

module.exports = { readDailyData };
