
let chart;
let currentDuration = 1;
let currentMetricType = 'aqi';
let currentChartType = 'current';
let lastLoadEpoch = 0;
let watchInterval;
const reloadDelay = 60 * 1000; // 60 seconds;
const chartColors = ['#003f5c', '#bc5090', '#ffa600'];

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
        getChartData(currentDuration, currentMetricType, currentChartType).then(_data => {
            const {data, options} = formatData(_data);
            chart = new Chartist.Line('.ct-chart', data, options);
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


/**
 * 
 * @param {// Our labels and three data series
       

        
 */

// Chart Data & Setup
const formatData = (_data) => {

    let startTime, endTime, labels;
    const series = [];

    Object.keys(_data).forEach((key, index) => {
        const element = dataElements.find(i => i.id === key);
        const item = _data[key];

        if (!startTime) {
            startTime = new Date(item[0].time);
            endTime = new Date(item[item.length - 1].time);
            labels = item.map((v) => new Date(v.time).toLocaleTimeString('en-US'))
        }

        series.push(item.map(v => { return { value: v.value, label: element.label } }));
    });

    const data = {
        labels,
        series,
    };

    // We are setting a few options for our chart and override the defaults
    var options = {
        // Don't draw the line chart points
        showPoint: false,
        // Disable line smoothing
        lineSmooth: true,
        // X-Axis specific configuration
        axisX: {
            // We can disable the grid for this axis
            showGrid: false,
            // and also don't show the label
            showLabel: true
        },
        // Y-Axis specific configuration
        axisY: {
            // Lets offset the chart a bit from the labels
            offset: 60,
            // The label interpolation function enables you to modify the values
            // used for the labels on each axis. Here we are converting the
            // values into million pound.
            labelInterpolationFnc: function (item) {
                return `${item.value}${item.label}`;
            }
        }
    };

    return {data, options};
};


const colors = {
    green: 'rgba(0, 128, 0, .9)',
    yellow: 'rgba(255, 255, 0, .9)',
    red: 'rgba(255, 0, 0, .9)',
};

const setChartBG = (chartData) => {
    const ctx = document.getElementById('line-chart').getContext('2d');
    const lastReadings = chartData.data.datasets.reduce((acc, reading) => {
        acc[reading.label] = reading.data[reading.data.length - 1]
        return acc;
    }, {});

    console.log(lastReadings);
    let color = colors.green;
    let set = false;
    Object.keys(lastReadings).forEach(key => {
        if (!set) {
            const value = lastReadings[key];
            switch (key) {
                case 'PM1':
                    if (value >= 27) { color = colors.red; set = true; }
                    else if (value >= 17) { color = colors.yellow; set = true; }
                    break;
                case 'PM2.5':
                    if (value >= 53) { color = colors.red; set = true; }
                    else if (value >= 35) { color = colors.yellow; set = true; }
                    break;
                case 'PM1':
                    if (value >= 75) { color = colors.red; set = true; }
                    else if (value >= 50) { color = colors.yellow; set = true; }
                    break;
            }
        }


    });
    ctx.canvas.style.backgroundColor = color;
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
getChartData(currentDuration, currentMetricType).then(_data => {
    const {data, options} = formatData(_data);
    chart = new Chartist.Line('.ct-chart', data, options);
    lastLoadEpoch = Date.now();
    startWatchInterval();
});
