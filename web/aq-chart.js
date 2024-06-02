let chart;
let currentDuration = 1;
let currentMetricType = 'aqi';
let currentChartType = 'current';
let lastLoadEpoch = 0;
let watchInterval;
const reloadDelay = 60 * 1000; // 60 seconds;
const hexToRgbA = (hex, a) => {
    let c;
    const _a = a || 1;

    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        c = hex.substring(1).split('');
        if (c.length == 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c = '0x' + c.join('');
        return `rgba(${[(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',')},${_a})`;
    }
    throw new Error('Bad Hex');
};
//const baseColors = ["#e60049", "#0bb4ff", "#50e991", "#e6d800", "#9b19f5", "#ffa300", "#dc0ab4", "#b3d4ff", "#00bfa0"];
const baseColors = ["#7c1158", "#00b7c7", "#9b19f5"];
const chartColors = baseColors.map(hex => hexToRgbA(hex, 1));
const chartFillColors = baseColors.map(hex => hexToRgbA(hex, .25));

// Duration Selectors & Setup
const hourDurationList = [
    { id: "_24", value: 24, label: "Last 24 hrs" },
    { id: "_12", value: 12, label: "Last 12 hrs" },
    { id: "_6", value: 6, label: "Last 6 hrs" },
    { id: "_3", value: 3, label: "Last 3 hrs" },
    { id: "_1", value: 1, label: "Last 1 hr" },
    { id: "_0.5", value: 0.5, label: "Last 30 mins" },
];

// Day Duration Selectors & Setup
const dayDurationList = [
    { id: "_30", value: 30, label: "Last 30 days" },
    { id: "_15", value: 15, label: "Last 15 days" },
    { id: "_10", value: 10, label: "Last 10 days" },
    { id: "_5", value: 5, label: "Last 5 days" },
    { id: "_1", value: 1, label: "Last 1 day" },
];

const makeDurations = (anchorId, durationList) => {
    const anchor = document.getElementById(anchorId);
    anchor.innerHTML = '';

    durationList.forEach((duration) => {
        const input = document.createElement('input');
        input.setAttribute('type', 'radio');
        input.setAttribute('id', duration.id);
        input.setAttribute('name', 'duration');
        input.setAttribute('value', duration.value);
        if (duration.value === currentDuration) {
            input.setAttribute('checked', true);
        }

        const label = document.createElement('label');
        label.setAttribute('for', duration.id);
        label.innerText = duration.label;

        anchor.appendChild(label);

        anchor.appendChild(input);
    });
};

const updateChart = () => {
    if (chart) {
        getChartData(currentDuration, currentMetricType, currentChartType).then(data => {
            const chartData = formatData(data);
            if (currentMetricType === 'aqi' && currentChartType === 'current') {
                setChartBG(chartData);
            } else {
                document.getElementById('line-chart').getContext('2d').canvas.style.backgroundColor = 'rgba(125, 125, 125, 1)'
            }
            chart.data.datasets = chartData.data.datasets;
            chart.data.labels = chartData.data.labels;
            chart.options = chartData.options;
            lastLoadEpoch = Date.now();
            chart.update();
        });
    }
};

const bindDurationEvents = (querySelector) => {
    const durationRadios = document.querySelectorAll(querySelector);
    const onDurationChange = (event) => {
        currentDuration = event.target.value;
        updateChart();
    };

    Array.prototype.forEach.call(durationRadios, (radio) => {
        radio.addEventListener('change', onDurationChange);
    });
};

const chartMetricsSelectorHandler = (event) => {
    currentMetricType = event.target.value;
    updateChart();
};

const bindChartMetricEvent = (querySelector) => {
    document.getElementById(querySelector).addEventListener('change', chartMetricsSelectorHandler);
};

const chartTypeSelectorHandler = (event) => {
    currentChartType = event.target.value;
    currentDuration = 1;
    switch (currentChartType) {
        case 'current':
            makeDurations('durations', hourDurationList);
            break;
        case 'historical':
        case 'peak':
            makeDurations('durations', dayDurationList);
            break;
    }
    bindDurationEvents('input[type=radio][name="duration"]');
    updateChart();
};

const bindChartTypeEvent = (querySelector) => {
    document.getElementById(querySelector).addEventListener('change', chartTypeSelectorHandler);
};


makeDurations('durations', hourDurationList);
bindDurationEvents('input[type=radio][name="duration"]');
bindChartMetricEvent('metrics-selector');
bindChartTypeEvent('charttype-selector');

// Data Manipulators
const dataElements = [
    { id: 'time', label: 'Time Stamp' },
    { id: 'run_time', label: 'Monitor Uptime' },
    { id: 'output_temp', label: '°F' },
    { id: 'output_humidity', label: 'Humidity' },
    { id: 'output_bar', label: 'Barometer' },
    { id: 'oxi', label: 'Oxidising (NO2)' },
    { id: 'red', label: 'Reducing (CO)' },
    { id: 'nh3', label: 'Ammonia (NH3)' },
    { id: 'p1', label: 'PM1' },
    { id: 'p10', label: 'PM10' },
    { id: 'p25', label: 'PM2.5' },

];

const getChartData = (duration, currentMetricType, currentChartType) => {
    let fields = ['p1', 'p10', 'p25'];
    switch (currentMetricType) {
        case 'aqi':
            fields = ['p1', 'p10', 'p25'];
            break;
        case 'weather':
            fields = ['output_temp', 'output_humidity'];
            break;
        case 'gas':
            fields = ['oxi', 'red', 'nh3'];

            break;
    }


    switch (currentChartType) {
        case 'current':
            return fetch(`./aq-data.json?$dh=${duration}&fields=(${fields.join(',')})`)
                .then(response => response.json());
        case 'historical':
            return fetch(`./agg-aq-data.json?dd=${duration}&fields=(${fields.join(',')})`)
                .then(response => response.json());
        case 'peak':
            return fetch(`./peak-aq-data.json?dd=${duration}&fields=(${fields.join(',')})`)
                .then(response => response.json());
    }

    return fetch(`./aq-data.json?dh=${duration}&fields=(${fields.join(',')})`)
        .then(response => response.json());

};

// Chart Data & Setup
const formatData = (_data) => {

    let startTime, endTime;
    const datasets = [];
    const fontColor = '#ffffff';

    Object.keys(_data).forEach((key, index) => {
        const element = dataElements.find(i => i.id === key);
        const item = _data[key];

        if (!startTime) {
            startTime = new Date(item[0].time);
            endTime = new Date(item[item.length - 1].time);
        }

        const data = item.map(v => {
            return { x: new Date(v.time), y: v.value }
        });

        datasets.push({
            data,
            label: element.label,
            borderColor: chartColors[index],
            fill: true,
            backgroundColor: chartFillColors[index],
            pointBackgroundColor: chartColors[index],
            color: fontColor,
            tension: 0.35,
        });
    });

    return {
        type: 'line',
        responsive: true,
        data: { datasets },
        options: {
            plugins: {
                title: {
                    display: true,
                    text: `Sensor Data  ${startTime.toLocaleDateString("en-US")} ${startTime.toLocaleTimeString("en-US")} - ${endTime.toLocaleDateString("en-US")} ${endTime.toLocaleTimeString("en-US")}`,
                    color: fontColor,
                    font: { size: 22 },
                },
                legend: {
                    labels: {
                        color: fontColor,
                        font: { size: 18 },
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    ticks: {
                        color: fontColor,
                    }
                },
                y: {
                    ticks: {
                        color: fontColor,
                        beginAtZero: true,
                        maxTicksLimit: 5,
                    }
                }
            }
        }
    };
};


const linear = (AQIHigh, AQILow, concHigh, concLow, concentration) => {
    return Math.round(((parseFloat(concentration) - concLow) / (concHigh - concLow)) * (AQIHigh - AQILow) + AQILow);
};

const AQIPM25 = (concentration) => {
    const _conc = parseFloat(concentration);
    let AQI;
    const c = (Math.floor(10 * _conc)) / 10;
    if (c >= 0 && c < 12.1) {
        AQI = linear(50, 0, 12, 0, c);
    }
    else if (c >= 35.5 && c < 55.5) {
        AQI = linear(150, 101, 55.4, 35.5, c);
    }
    else if (c >= 55.5 && c < 150.5) {
        AQI = linear(200, 151, 150.4, 55.5, c);
    }
    else if (c >= 150.5 && c < 250.5) {
        AQI = linear(300, 201, 250.4, 150.5, c);
    }
    else if (c >= 250.5 && c < 350.5) {
        AQI = linear(400, 301, 350.4, 250.5, c);
    }
    else if (c >= 350.5 && c < 500.5) {
        AQI = linear(500, 401, 500.4, 350.5, c);
    }
    else {
        AQI = "PM25message";
    }
    return AQI;
}

const colors = {
    green: 'rgba(0, 128, 0, 0.9)',         //0-50
    yellow: 'rgba(255, 255, 0, 0.9)',      //51-100
    orange: 'rgba(255, 126, 0, 0.9)',      //101-150
    red: 'rgba(255, 0, 0, 0.9)',           //151-200
    purple: 'rgba(143, 63, 151, 0.9)',     //201-300
    brown: 'rgba(128, 0, 35, 0.9)',        //301-500
    burntumber: 'rgba(128, 80, 0, 0.9)',   //501+
};

const fontColors = {
    black: 'black',
    white: 'white',
}

const AQIRating = (AQI) => {
    const _AQI = parseFloat(AQI)
    const result = {};
    if (_AQI <= 50) {
        result.AQICategory = "Good";
        result.color = colors.green;
        result.fontColor = fontColors.white;
    }
    else if (_AQI > 50 && _AQI <= 100) {
        result.AQICategory = "Moderate";
        result.color = colors.yellow;
        result.fontColor = fontColors.black;
    }
    else if (_AQI > 100 && _AQI <= 150) {
        result.AQICategory = "Unhealthy for Sensitive Groups";
        result.color = colors.orange;
        result.fontColor = fontColors.black;
    }
    else if (_AQI > 150 && _AQI <= 200) {
        result.AQICategory = "Unhealthy";
        result.color = colors.red;
        result.fontColor = fontColors.black;
    }
    else if (_AQI > 200 && _AQI <= 300) {
        result.AQICategory = "Very Unhealthy";
        result.color = colors.purple;
        result.fontColor = fontColors.white;
    }
    else if (_AQI > 300 && _AQI <= 400) {
        result.AQICategory = "Hazardous";
        result.color = colors.brown;
        result.fontColor = fontColors.white;
    }
    else if (_AQI > 400 && _AQI <= 500) {
        result.AQICategory = "Hazardous";
        result.color = colors.brown;
        result.fontColor = fontColors.white;
    }
    else {
        result.AQICategory = "Out of Range";
        result.color = colors.burntumber;
        result.fontColor = fontColors.white;
    }
    return result;
}

const setChartBG = (chartData) => {
    const ctx = document.getElementById('line-chart').getContext('2d');
    const lastReadings = chartData.data.datasets.reduce((acc, reading) => {
        acc[reading.label] = reading.data[reading.data.length - 1]
        return acc;
    }, {});
    const pm25AQI = AQIPM25(lastReadings['PM2.5'].y);
    const rating = AQIRating(pm25AQI);
    console.log({ pm25PPM: lastReadings['PM2.5'].y, pm25AQI, rating });
    ctx.canvas.style.backgroundColor = rating.color;
    ctx.canvas.style.color = rating.fontColor;

    chartData.options.plugins.title.color = rating.fontColor;
    chartData.options.plugins.legend.labels.color = rating.fontColor;
    chartData.options.scales.x.ticks.color = rating.fontColor;
    chartData.options.scales.y.ticks.color = rating.fontColor;
};

const setWatch = () => {
    const countDownElement = document.getElementById('countdown');
    watchInterval = window.setInterval(() => {
        const now = Date.now();
        const secondsSinceLastUpdate = Math.round((lastLoadEpoch + reloadDelay - now) / 1000);
        if (now >= lastLoadEpoch + reloadDelay) {
            updateChart();
            countDownElement.innerText = reloadDelay / 1000;
        } else {
            countDownElement.innerText = secondsSinceLastUpdate;
        }
    }, 1000);
};

const pauseWatchInterval = () => {
    if (watchInterval) {
        window.clearInterval(watchInterval);
        watchInterval = null;
    }
    document.getElementById('countdown').innerText = 'Paused';
};

const startWatchInterval = () => {
    // cleanup first
    pauseWatchInterval();
    setWatch();
};

const bindCountdown = () => {
    document.getElementById('countdown').addEventListener('click', () => {
        if (watchInterval) {
            pauseWatchInterval();
        } else {
            startWatchInterval();
        }
    });
};

bindCountdown();

// Fire up the currentDuration chart
getChartData(currentDuration, currentMetricType).then(data => {
    const ctx = document.getElementById('line-chart').getContext('2d');

    let chartData = formatData(data)
    if (currentMetricType === 'aqi') {
        setChartBG(chartData);
    } else {
        document.getElementById('line-chart').getContext('2d').canvas.style.backgroundColor = 'rgba(125, 125, 125, 1)'
    }

    chart = new Chart(ctx, chartData);
    lastLoadEpoch = Date.now();
    startWatchInterval();
});