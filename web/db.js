const sqlite3 = require('sqlite3').verbose()

const openDB = () => {
    const path = '../environment';
    return new Promise((resolve, reject) => {
         const db = new sqlite3.Database(path, sqlite3.OPEN_READONLY,
            (err) => {
                if (err) {
                    reject("Open error: " + err.message);
                }
                else {
                    resolve(db);
                }
            }
        )
    });
};

const closeDB = (db) => {
    db.close((err) => {
        if (err) {
         console.error(err.message);
        }
        console.log("Closing the database connection.");
      });
}

const readRealtimeData = async () => {
    
    const enviroDB = await openDB();
    
    const query = 'SELECT * FROM envdata ORDER BY time DESC LIMIT 1';
    return new Promise(function (resolve, reject) {

        enviroDB.all(query, [], (err, rows) => {
            closeDB(enviroDB);
            if (err) {
                reject("Read error: " + err.message);
            }
            else {
                resolve({ data: rows });
            }
        })
    });
};

const readAboveThresholdP25Hours = async () => {

const enviroDB = await openDB();
    
    const query = 'select hour, P25 from hourly_peak_envdata where P25 >= 12.1';
    return new Promise(function (resolve, reject) {

        enviroDB.all(query, [], (err, rows) => {
            closeDB(enviroDB);
            if (err) {
                reject("Read error: " + err.message);
            }
            else {
                resolve({ data: rows });
            }
        })
    });
};

const readEnviroData = async (durationHours) => {
    const enviroDB = await openDB();
    
    durationHours = durationHours || 24;
    const sinceTime = Math.round(Date.now()/1000,0) - (durationHours * 60 * 60);
    const params = [sinceTime];
    const query = 'SELECT * FROM envdata WHERE time >= ? ORDER BY time';
    return new Promise(function (resolve, reject) {

        enviroDB.all(query, params, (err, rows) => {
            closeDB(enviroDB);
            if (err) {
                reject("Read error: " + err.message);
            }
            else {
                resolve({ data: rows });
            }
        })
    });
};

const readData = async (durationDays, table) => {
    const enviroDB = await openDB();

    durationDays = durationDays || 30;
    const today = new Date();
    const amDate = new Date(`${today.getMonth()+1}/${today.getDate()}/${today.getFullYear()} 00:00:00`);
    const sinceHour = Math.round(amDate.getTime()/1000,0) - (durationDays * 24 * 60 * 60);
    const params = [sinceHour];
    const query = `SELECT * FROM ${table} WHERE hour >= ? ORDER BY hour`;
    return new Promise(function (resolve, reject) {

        enviroDB.all(query, params, (err, rows) => {
            closeDB(enviroDB);
            if (err) {
                reject("Read error: " + err.message);
            }
            else {
                resolve({ data: rows });
            }
        })
    });
};

module.exports = {readEnviroData, readData, readRealtimeData, readAboveThresholdP25Hours};
