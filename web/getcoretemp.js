const { exec } = require('child_process');

const getCoreTemp = (req, res) => {
    exec('vcgencmd measure_temp', (err, stdout, stderr) => {
        if (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(err));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const [key, val] = stdout.split('=');
        return res.end(`{"core_temp": "${val.replace(/\r?\n|\r/g, '')}"}`);
    });
};

module.exports = getCoreTemp;