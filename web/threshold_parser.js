
const thresholdChartInit = () => {
    const IndoorSrc = 'http://192.168.119.220';
    const OutdoorSrc = 'http://192.168.119.137';

    const colors = {
        yellow:     'rgba(251, 191,  36, 0.85)',  // Moderate           51–100
        orange:     'rgba(251, 146,  60, 0.85)',  // Unhealthy for SG  101–150
        red:        'rgba(248, 113, 113, 0.85)',  // Unhealthy         151–200
        purple:     'rgba(192, 132, 252, 0.85)',  // Very Unhealthy    201–300
        pink:       'rgba(244, 114, 182, 0.85)',  // Hazardous         301–500
        slate:      'rgba(148, 163, 184, 0.85)',  // Out of Range       501+
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
        const countByRating = (rating) =>
            labels.map(day => (dataIn[day] || []).filter(v => v.rating === rating).length);

        return {
            labels,
            datasets: [
                { label: 'Moderate',                       data: countByRating('Moderate'),                       backgroundColor: colors.yellow },
                { label: 'Unhealthy for Sensitive Groups', data: countByRating('Unhealthy for Sensitive Groups'), backgroundColor: colors.orange },
                { label: 'Unhealthy',                      data: countByRating('Unhealthy'),                      backgroundColor: colors.red    },
                { label: 'Hazardous',                      data: countByRating('Hazardous'),                      backgroundColor: colors.purple },
                { label: 'Very Hazardous',                 data: countByRating('Very Hazardous'),                 backgroundColor: colors.pink   },
                { label: 'Out of Range',                   data: countByRating('Out of Range'),                   backgroundColor: colors.slate  },
            ],
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
                const FONT = "'Inter', system-ui, sans-serif";
                const TICK = '#64748b';
                const config = {
                    type: 'bar',
                    data,
                    options: {
                        responsive: true,
                        animation: { duration: 400, easing: 'easeInOutQuart' },
                        plugins: {
                            title: {
                                display: true,
                                text: `${source} — Last 90 Days: Hours Above Good AQI`,
                                color: '#e2e8f0',
                                font: { size: 14, weight: '500', family: FONT },
                                padding: { top: 18, bottom: 4 },
                            },
                            legend: {
                                labels: {
                                    color: '#94a3b8',
                                    font: { size: 12, family: FONT },
                                    usePointStyle: true,
                                    pointStyleWidth: 8,
                                    boxHeight: 6,
                                    padding: 16,
                                },
                            },
                            tooltip: {
                                backgroundColor: 'rgba(15,23,42,0.92)',
                                titleColor: '#64748b',
                                bodyColor: '#e2e8f0',
                                borderColor: 'rgba(255,255,255,0.08)',
                                borderWidth: 1,
                                padding: 12,
                                cornerRadius: 8,
                                titleFont: { size: 11, family: FONT },
                                bodyFont:  { size: 13, weight: '500', family: FONT },
                            },
                        },
                        scales: {
                            x: {
                                stacked: true,
                                ticks: {
                                    color: TICK,
                                    maxRotation: 45,
                                    font: { size: 10, family: FONT },
                                    maxTicksLimit: 15,
                                },
                                grid:   { color: 'rgba(255,255,255,0.04)' },
                                border: { color: 'rgba(255,255,255,0.08)' },
                            },
                            y: {
                                stacked: true,
                                min: 0,
                                max: 24,
                                ticks: {
                                    color: TICK,
                                    stepSize: 4,
                                    font: { size: 11, family: FONT },
                                    padding: 8,
                                },
                                grid:   { color: 'rgba(255,255,255,0.04)' },
                                border: { color: 'transparent' },
                            },
                        },
                    },
                };

                stackedBar = new Chart(document.getElementById('bar-chart'), config);
            }
        });
    };
};

thresholdChartInit();