const { readEnviroData } = require('./db');

const prepareData = async (durationHours, fields) => {
    fields = fields || ['p1', 'p10', 'p25'];
    const rawData = (await readEnviroData(durationHours)).data;
    const series = {};
    const flags = {};
    fields.forEach((field) => {
        series[field] = [];
        flags[field] = true;
    });

    const processedData =  rawData.reduce((c, v) => {
        const time = new Date(v.time * 1000);
        if (flags.output_temp) { c.output_temp.push({time, value: v.raw_temp}); }
        if (flags.output_humidity) { c.output_humidity.push({time, value: v.raw_humidity}); }
        if (flags.output_bar) { c.output_bar.push({time, value: v.raw_bar}); }
        if (flags.oxi) { c.oxi.push({time, value: v.oxi}); }
        if (flags.red) { c.red.push({time, value: v.red}); }
        if (flags.nh3) { c.nh3.push({time, value: v.nh3}); }
        if (flags.p1) { c.p1.push({time, value: v.p1}); }
        if (flags.p10) { c.p10.push({time, value: v.P10}); }
        if (flags.p25) { c.p25.push({time, value: v.P25}); }
        return c;
    }, series);

    return processedData;
};

module.exports = prepareData;