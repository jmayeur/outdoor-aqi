
const thresholdChartInit = () => {
    const IndoorSrc = 'http://192.168.119.220';
    const OutdoorSrc = 'http://192.168.119.137';

    const colors = {
        green: 'rgba(0, 128, 0, 0.65)',         //0-50
        yellow: 'rgba(255, 255, 0, 0.65)',      //51-100
        orange: 'rgba(255, 126, 0, 0.65)',      //101-150
        red: 'rgba(255, 0, 0, 0.65)',           //151-200
        purple: 'rgba(143, 63, 151, 0.65)',     //201-300
        brown: 'rgba(128, 0, 35, 0.65)',        //301-500
        burntumber: 'rgba(128, 80, 0, 0.65)',   //501+
    };

    const aqiEquation = (AQIHigh, AQILow, concHigh, concLow, concentration) => {
        // via https://forum.airnowtech.org/t/the-aqi-equation/169
        // updated to use https://forum.airnowtech.org/t/the-aqi-equation-2024-valid-beginning-may-6th-2024/453
        return Math.round(((AQIHigh - AQILow) / (concHigh - concLow)) * (concentration - concLow) + AQILow);
    };

    const pm25aqi = (concentration) => {
        const _conc = parseFloat(concentration);
        const c = (Math.floor(1000 * _conc)) / 1000;
        switch (true) {
            case (c >= 0 && c < 9):
                return aqiEquation(50, 0, 9, 0, c);
            case (c >= 9.1 && c < 35.4):
                return aqiEquation(100, 51, 35.4, 9.1, c);
            case (c >= 35.5 && c < 55.5):
                return aqiEquation(150, 101, 55.4, 35.5, c);
            case (c >= 55.5 && c < 125.4):
                return aqiEquation(200, 151, 125.4, 55.5, c);
            case (c >= 125.5 && c < 225.4):
                return aqiEquation(300, 201, 225.4, 125.5, c);
            case (c >= 225.5 && c < 325.4):
                return aqiEquation(500, 301, 325.4, 225.5, c);
            case (c >= 325.5 && c < 500.4):
                return aqiEquation(500, 301, 325.4, 225.5, c);
            default:
                // We're in hell
                return 666;
        }
    };

    const aqiRating = (aqi) => {
        const _aqi = parseFloat(aqi);
        switch (true) {
            case (_aqi <= 50):
                return "Good";
            case (_aqi > 50 && _aqi <= 100):
                return "Moderate";
            case (_aqi > 100 && _aqi <= 150):
                return "Unhealthy for Sensitive Groups";
            case (_aqi > 150 && _aqi <= 200):
                return "Unhealthy";
            case (_aqi > 200 && _aqi <= 300):
                return "Hazardous";
            case (_aqi > 300 && _aqi <= 500):
                return "Very Hazardous";
            default:
                // We're in hell
                return "Out of Range";
        }
    };

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const processRaw = (raw) => {
        return raw.map((d) => {
            const aqi = pm25aqi(d.P25);
            const date = new Date(d.hour * 1000);
            const day = formatDate(date);
            return { day, date, P25: d.P25, aqi, rating: aqiRating(aqi) };
        });
    };

    const groupByDate = (data) => {
        return data.reduce((acc, d) => {
            const key = d.day
            if (!acc[key]) {
                acc[key] = [];
            }
            acc[key].push(d);
            return acc;
        }, {});
    };

    const flipDate = (date) => {
        const parts = date.split('-');
        return `${parts[1]}/${parts[2]}/${parts[0]}`;
    };

    const fillLast90Days = (data) => {
        const maxDt = new Date();
        const max = formatDate(maxDt);
        const minDt = maxDt;
        minDt.setDate(minDt.getDate() - 90);
        const min = formatDate(minDt);
        const result = {};
        let currentKey = min;
        while (true) {
            result[currentKey] = data[currentKey] || [];
            if (currentKey === max) {
                break;
            }
            const dt = new Date(flipDate(currentKey));
            dt.setDate(dt.getDate() + 1)
            currentKey = formatDate(dt);
        }
        return result;
    }

    const getThresholdData = async (source) => {
        const response = await fetch(`${source}/above_p25_threshold.json`)
        const result = await response.json();
        return result;
    };

    const getData = async (source) => {
        let _data;
        try {
            _data = await getThresholdData(source);
        } catch (e) {
            console.log(e);
            _data = {
                data: []
            };
        }
        return _data;
    };

    const shapeData = (dataIn) => {
        const labels = Object.keys(dataIn);

        return {
            labels,
            datasets: [
                {
                    label: 'Moderate',
                    data: Object.values(dataIn).reduce((acc, r) => { return acc.concat(r.filter(v => v.rating === 'Moderate')); }, []).reduce((acc, v) => { if (!acc[v.day]) { acc[v.day] = 0 } acc[v.day] += 1; return acc; }, {}),
                    backgroundColor: colors.yellow,
                },
                {
                    label: 'Unhealthy for Sensitive Groups',
                    data: Object.values(dataIn).reduce((acc, r) => { return acc.concat(r.filter(v => v.rating === 'Unhealthy for Sensitive Groups')); }, []).reduce((acc, v) => { if (!acc[v.day]) { acc[v.day] = 0 } acc[v.day] += 1; return acc; }, {}),
                    backgroundColor: colors.orange,
                },
                {
                    label: 'Unhealthy',
                    data: Object.values(dataIn).reduce((acc, r) => { return acc.concat(r.filter(v => v.rating === 'Unhealthy')); }, []).reduce((acc, v) => { if (!acc[v.day]) { acc[v.day] = 0 } acc[v.day] += 1; return acc; }, {}),
                    backgroundColor: colors.red,
                },
                {
                    label: 'Hazardous',
                    data: Object.values(dataIn).reduce((acc, r) => { return acc.concat(r.filter(v => v.rating === 'Hazardous')); }, []).reduce((acc, v) => { if (!acc[v.day]) { acc[v.day] = 0 } acc[v.day] += 1; return acc; }, {}),
                    backgroundColor: colors.purple,
                },
                {
                    label: 'Very Hazardous',
                    data: Object.values(dataIn).reduce((acc, r) => { return acc.concat(r.filter(v => v.rating === 'Very Hazardous')); }, []).reduce((acc, v) => { if (!acc[v.day]) { acc[v.day] = 0 } acc[v.day] += 1; return acc; }, {}),
                    backgroundColor: colors.brown,
                },
                {
                    label: 'Out of Range',
                    data: Object.values(dataIn).reduce((acc, r) => { return acc.concat(r.filter(v => v.rating === 'Out of Range')); }, []).reduce((acc, v) => { if (!acc[v.day]) { acc[v.day] = 0 } acc[v.day] += 1; return acc; }, {}),
                    backgroundColor: colors.burntumber,
                },
            ]
        };
    };

    const updateChart = (chart, data, source) => {
        chart.data.datasets = data.datasets;
        chart.data.labels = data.labels;
        chart.options.plugins.title.text = `${source} Last 90 Days Hours Above Good AQI`;

        chart.update();
    };

    let stackedBar;

    window.showThresholdChart = (source) => {
        const src = source === 'Outdoor' ? OutdoorSrc : IndoorSrc;
        getData(src).then(raw => {
            const readyData = processRaw(raw.data);
            const dateGrouped = fillLast90Days(groupByDate(readyData));

            const data = shapeData(dateGrouped);

            if (stackedBar) {
                updateChart(stackedBar, data, source);
            } else {
                Chart.defaults.font.size = 16;
                Chart.defaults.font.family = "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif";
                Chart.defaults.font.weight = "bolder";
                Chart.defaults.color = "#000000";
                const config = {
                    type: 'bar',
                    data,
                    options: {
                        plugins: {
                            title: {
                                display: true,
                                text: `${source} Last 90 Days Hours Above Good AQI`
                            },
                        },
                        responsive: true,
                        scales: {
                            x: {
                                stacked: true,
                            },
                            y: {
                                min: 0,
                                max: 24,
                                stacked: true,
                                ticks: { stepSize: 4 }
                            }
                        }
                    }
                };

                stackedBar = new Chart(document.getElementById('bar-chart'), config);
            }
        });
    };
};

thresholdChartInit();