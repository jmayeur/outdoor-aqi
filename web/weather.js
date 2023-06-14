const IndoorSrc = 'http://192.168.119.220';
const OutdoorSrc = 'http://192.168.119.137';

async function getRealtimeData(src) {
    const response = await fetch(`${src}/realtime.json`)
    const result = await response.json();
    return result;
};

const linear = (AQIHigh, AQILow, concHigh, concLow, concentration) => {
    return Math.round(((parseFloat(concentration) - concLow) / (concHigh - concLow)) * (AQIHigh - AQILow) + AQILow);
};

const pm25aqi = (concentration) => {
    const _conc = parseFloat(concentration);
    const c = (Math.floor(10 * _conc)) / 10;
    switch (true) {
        case (c >= 0 && c < 12.1):
            return linear(50, 0, 12, 0, c);
        case (c >= 12.1 && c < 35.5):
            return linear(100, 51, 35.4, 12.1, c);
        case (c >= 35.5 && c < 55.5):
            return linear(150, 101, 55.4, 35.5, c);
        case (c >= 55.5 && c < 150.5):
            return linear(200, 151, 150.4, 55.5, c);
        case (c >= 150.5 && c < 250.5):
            return linear(300, 201, 250.4, 150.5, c);
        case (c >= 250.5 && c < 350.5):
            return linear(400, 301, 350.4, 250.5, c);
        case (c >= 350.5 && c < 500.5):
            return linear(500, 401, 500.4, 350.5, c);
        default:
            // We're in hell
            return 666;
    }
}

const colors = {
    green: 'rgb(0, 128, 0)',
    yellow: 'rgb(255, 255, 0)',
    orange: 'rgb(255, 128, 0)',
    redorange: 'rgb(255, 64, 0)',
    red: 'rgb(255, 0, 0)',
    brown: 'rgb(128, 64, 0)',
    burntumber: 'rgb(128, 0, 0)',
};

const aqiRating = (aqi) => {
    const _aqi = parseFloat(aqi);
    switch (true) {
        case (_aqi <= 50):
            return { rating: "Good", color: colors.green };
        case (_aqi > 50 && _aqi <= 100):
            return { rating: "Moderate", color: colors.yellow };
        case (_aqi > 100 && _aqi <= 150):
            return { rating: "Unhealthy for Sensitive Groups", color: colors.orange };
        case (_aqi > 150 && _aqi <= 200):
            return { rating: "Unhealthy", color: colors.redorange };
        case (_aqi > 300 && _aqi <= 400):
            return { rating: "Hazardous", color: colors.red };
        case (_aqi > 400 && _aqi <= 500):
            return { rating: "Very Hazardous", color: colors.brown };
        default:
            // We're in hell
            return { rating: "Out of Range", color: colors.burntumber };
    }
}

const getAQI = (P25) => {
    const aqi = pm25aqi(P25);
    const rating = aqiRating(aqi);

    return {
        aqi,
        ...rating
    };
}

async function getWeatherData() {
    let _indoorData;
    try {
        _indoorData = await getRealtimeData(IndoorSrc);
    } catch (e) {
        console.log(e);
        _indoorData = {
            data: [{
                output_temp: 0,
                output_humidity: 0,
                output_bar: 0,
                P25: 0,
            }]
        };
    }

    let _outdoorData;
    try {
        _outdoorData = await getRealtimeData(OutdoorSrc);
    } catch (e) {
        console.log(e);
        _outdoorData = {
            data: [{
                output_temp: 0,
                output_humidity: 0,
                output_bar: 0,
                P25: 0,
            }]
        };
    }

    const indoorData = _indoorData.data[0];
    const outdoorData = _outdoorData.data[0];

    const result = {
        indoor: {
            temp: indoorData.output_temp,
            humidity: indoorData.output_humidity,
            pressure: indoorData.output_bar,
            aqi: getAQI(indoorData.P25),
        },
        outdoor: {
            temp: outdoorData.raw_temp,
            humidity: outdoorData.raw_humidity,
            pressure: outdoorData.raw_bar,
            aqi: getAQI(outdoorData.P25),
        }
    }
    return result;
};

const getTempColor = (temp) => {
    const { r, g, b } = tempToColor(temp, -10, 120);
    return `rgb(${r}, ${g}, ${b})`
};

const contrast = (rgb_raw) => {
    const grps = rgb_raw.match(/rgb\(([0-9]*),\s([0-9]*),\s([0-9]*)\)/);
    const rgb = [grps[1], grps[2], grps[3]];
    var sum = Math.round(((parseInt(rgb[0]) * 299) + (parseInt(rgb[1]) * 587) + (parseInt(rgb[2]) * 114)) / 1000);
    return (sum > 128) ? 'black' : 'white';
}

const round = (n, p = 1) => {
    const mulitplier = Math.pow(10, p);
    return Math.round(n * mulitplier) / mulitplier;
}

const populateTempSection = (keySelector, temp, humidity) => {
    const root = document.getElementById(keySelector);
    const tempBox = root.getElementsByClassName('tempbox')[0];
    const tempEl = root.getElementsByClassName('temp')[0];
    const humidityEl = root.getElementsByClassName('humidity')[0];
    const bgColor = getTempColor(temp);
    const tmpPct = round(100 - (temp > 100 ? 100 : temp) * .75, 2);
    const tempColor = tmpPct > 50 ? 'white' : contrast(bgColor);
    const humidityColor = tmpPct > 25 ? 'white' : contrast(bgColor);

    tempBox.style.backgroundImage = `linear-gradient(#000, ${tmpPct}%, ${bgColor}`;
    tempEl.style.color = tempColor;
    humidityEl.style.color = humidityColor;
    tempEl.innerHTML = `<span class="display-2 _temp">${round(temp, 1)}</span><span class="h2">°F</span>`;
    humidityEl.innerHTML = `${round(humidity, 1)}%`;
};

const populateAQISection = (keySelector, aqiData) => {
    const root = document.getElementById(keySelector);
    const aqiBox = root.getElementsByClassName('aqibox')[0];
    const aqi = root.getElementsByClassName('aqi')[0];
    const aqiLabel = root.getElementsByClassName('aqilabel')[0];
    const aqiPct = round(100 - aqiData.aqi / 5, 2);
    const aqiColor = aqiPct > 50 ? 'white' : contrast(aqiData.color);
    const aqiLabelColor = aqiPct > 35 ? 'white' : contrast(aqiData.color);

    aqi.innerHTML = `${Math.round(aqiData.aqi)}`;
    aqi.style.color = aqiColor;
    aqi.ariaLabel = aqiData.rating;
    aqiBox.style.backgroundImage = `linear-gradient(#000, ${aqiPct}%, ${aqiData.color}`;
    aqiLabel.style.color = aqiLabelColor;
};

const updateData = () => {
    getWeatherData().then(data => {
        populateTempSection('indoor-data', data.indoor.temp, data.indoor.humidity);
        populateTempSection('outdoor-data', data.outdoor.temp, data.outdoor.humidity);
        populateAQISection('indoor-data', data.indoor.aqi);
        populateAQISection('outdoor-data', data.outdoor.aqi);
    });
};