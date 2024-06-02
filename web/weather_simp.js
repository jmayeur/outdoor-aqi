const IndoorSrc = 'http://192.168.119.220';
const OutdoorSrc = 'http://192.168.119.137';

async function getRealtimeData(src) {
    const response = await fetch(`${src}/realtime.json`)
    const result = await response.json();
    return result;
};

const aqiEquation = (AQIHigh, AQILow, concHigh, concLow, concentration) => {
    // via https://forum.airnowtech.org/t/the-aqi-equation/169
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

const pm10aqi = (concentration) => {
    const _conc = parseFloat(concentration);
    const c = (Math.floor(10 * _conc)) / 10;
    switch (true) {
        case (c >= 0 && c < 55):
            return aqiEquation(50, 0, 54.9, 0, c);
        case (c >= 55 && c < 155):
            return aqiEquation(100, 51, 154.9, 55, c);
        case (c >= 155 && c < 255):
            return aqiEquation(150, 101, 254.9, 155, c);
        case (c >= 255 && c < 355):
            return aqiEquation(200, 151, 354.0, 255, c);
        case (c >= 355 && c < 425):
            return aqiEquation(300, 201, 424.9, 355, c);
        case (c >= 425 && c < 605):
            return aqiEquation(500, 301, 604.9, 425, c);
        default:
            // We're in hell
            return 666;
    }
}




const colors = {
    green: 'rgba(0, 128, 0, 1)',         //0-50
    yellow: 'rgba(255, 255, 0, 1)',      //51-100
    orange: 'rgba(255, 126, 0, 1)',      //101-150
    red: 'rgba(255, 0, 0, 1)',           //151-200
    purple: 'rgba(143, 63, 151, 1)',     //201-300
    brown: 'rgba(128, 0, 35, 1)',        //301-500
    burntumber: 'rgba(128, 80, 0, 1)',   //501+
};

const aqiRating = (aqi) => {
    const _aqi = parseFloat(aqi);
    switch (true) {
        case (_aqi <= 50):
            return { rating: "Good", backgroundColor: colors.green, color: 'white', aqiPct: 70 };
        case (_aqi > 50 && _aqi <= 100):
            return { rating: "Moderate", backgroundColor: colors.yellow, color: 'white', aqiPct: 60 };
        case (_aqi > 100 && _aqi <= 150):
            return { rating: "Unhealthy for Sensitive Groups", backgroundColor: colors.orange, color: 'white', aqiPct: 50 };
        case (_aqi > 150 && _aqi <= 200):
            return { rating: "Unhealthy", backgroundColor: colors.red, color: 'white', aqiPct: 40 };
        case (_aqi > 200 && _aqi <= 300):
            return { rating: "Hazardous", backgroundColor: colors.purple, color: 'white', aqiPct: 30 };
        case (_aqi > 300 && _aqi <= 500):
            return { rating: "Very Hazardous", backgroundColor: colors.brown, color: 'white', aqiPct: 20 };
        default:
            // We're in hell
            return { rating: "Out of Range", backgroundColor: colors.burntumber, color: 'white', aqiPct: 10 };
    }
}

const getAQI = (P25, P10) => {
    const aqi = pm25aqi(P25);
    const rating = aqiRating(aqi);
    const pm10_aqi = pm10aqi(P10)
    const pm10rating = aqiRating(pm10_aqi);

    return {
        aqi,
        ...rating,
        pm10: {
            pm10aqi: pm10_aqi,
            ...pm10rating
        }
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
                time: new Date('1/1/1970').getTime() / 1000,
                output_temp: 0,
                output_humidity: 0,
                output_bar: 0,
                P25: 0,
                P10: 0,
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
                time: new Date('1/1/1970').getTime() / 1000,
                raw_temp: 0,
                raw_humidity: 0,
                raw_bar: 0,
                P25: 0,
                P10: 0,
            }]
        };
    }

    const indoorData = _indoorData.data[0];
    const outdoorData = _outdoorData.data[0];

    const result = {
        indoor: {
            time: indoorData.time,
            temp: Math.round(indoorData.output_temp),
            humidity: Math.round(indoorData.output_humidity),
            pressure: indoorData.output_bar,
            aqi: getAQI(indoorData.P25, indoorData.P10),
        },
        outdoor: {
            time: outdoorData.time,
            temp: Math.round(outdoorData.raw_temp),
            humidity: Math.round(outdoorData.raw_humidity),
            pressure: outdoorData.raw_bar,
            aqi: getAQI(outdoorData.P25, outdoorData.P10),
        }
    }
    return result;
};

const round = (n, p = 1) => {
    const mulitplier = Math.pow(10, p);
    return Math.round(n * mulitplier) / mulitplier;
}

const getTempElements = (temp) => {
    return `<span class="display-2 _temp">${round(temp, 1)}</span>`;
}

const getAqiElements = (aqi) => {
    return `<span class="display-2 _aqi">${Math.round(aqi)}</div>`;
}

const populateTempSection = (keySelector, temp, humidity, aqiData, tsRaw) => {
    const ts = tsRaw * 1000;
    const root = document.getElementById(keySelector);
    const tempBox = root.getElementsByClassName('tempbox')[0];
    const tempEl = root.getElementsByClassName('temp')[0];
    const humidityEl = root.getElementsByClassName('humidity')[0];
    const aqiEl = root.getElementsByClassName('aqi')[0];

    const bgColor = ts > (Date.now() - (5 * 60 * 1000)) ? aqiData.backgroundColor : '#cccccc';
    tempBox.style.backgroundColor = bgColor;
    tempBox.style.backgroundImage = `radial-gradient(at top, #000, ${aqiData.aqiPct}%, ${bgColor}`;
    aqiEl.style.color = aqiData.color;
    tempEl.style.color = aqiData.color;
    humidityEl.style.color = aqiData.color;
    tempEl.innerHTML = getTempElements(temp);
    humidityEl.innerHTML = `${round(humidity, 1)}`;
    aqiEl.innerHTML = getAqiElements(aqiData.aqi);
    aqiEl.ariaLabel = aqiData.rating;
};

const updateData = () => {
    getWeatherData().then(data => {
        populateTempSection('indoor-data', data.indoor.temp, data.indoor.humidity, data.indoor.aqi, data.indoor.time);
        populateTempSection('outdoor-data', data.outdoor.temp, data.outdoor.humidity, data.outdoor.aqi, data.outdoor.time);
    });
};


const getTimeComponents = () => {
    const timeString = new Date().toLocaleTimeString('en-US');
    const parts = timeString.split(' ');
    const hms = parts[0].split(':');
    const meridiem = parts[1];
    const hours = hms[0].padStart(2, '0');
    const minutes = hms[1];

    return {
        hours,
        minutes,
        meridiem
    }
};

const getDigitSpan = (digit) => {
    const span = document.createElement('span');
    span.classList.add('digit');
    span.innerHTML = digit;
    return span;
};

const setDigits = (element, digits) => {
    const _digs = digits.split('');
    element.appendChild(getDigitSpan(_digs[0]));
    element.appendChild(getDigitSpan(_digs[1]));
};

const setClock = (timeComponents) => {
    const hours = document.querySelector('.hours');
    const minutes = document.querySelector('.minutes');
    hours.innerHTML = '';
    minutes.innerHTML = '';
    setDigits(hours, timeComponents.hours);
    setDigits(minutes, timeComponents.minutes);
    document.querySelector('.meridiem').innerHTML = timeComponents.meridiem;
    if (!clockInterval) {
        clockInterval = window.setInterval(() => {
            setClock(getTimeComponents());
        }, 1000);
    }
};

const showWeather = () => {
    const weather = document.querySelector('.weather');
    updateData();
    weather.classList.remove('noshow');
};

const hideWeather = () => {
    const weather = document.querySelector('.weather');
    weather.classList.add('noshow');
};

let clockInterval;
const showClock = () => {
    const clock = document.querySelector('.clock');
    setClock(getTimeComponents());
    clock.classList.remove('noshow');
};

const hideClock = () => {
    if (clockInterval) {
        window.clearInterval(clockInterval);
        clockInterval = undefined;
    }
    clock.classList.add('noshow');
};

const viewStates = [
    {
        id: 'weather',
        isActive: true,
        isVisible: true,
        showFn: showWeather,
        hideFn: hideWeather,
    },
    {
        id: 'clock',
        isActive: false,
        isVisible: false,
        showFn: showClock,
        hideFn: hideClock,
    }, {
        id: 'forecast',
        isActive: true,
        isVisible: false,
        showFn: showForecast,
        hideFn: hideForecast
    }
];
let currentIndex = 0;
const switchViews = () => {
    const lastVisibleIndex = currentIndex;
    currentIndex = (currentIndex + 1) % viewStates.length;
    while (!viewStates[currentIndex].isActive) {
        currentIndex = (currentIndex + 1) % viewStates.length;
    }
    viewStates[lastVisibleIndex].hideFn();
    viewStates[lastVisibleIndex].isVisible = false;
    viewStates[currentIndex].showFn();
    viewStates[currentIndex].isVisible = false;
};