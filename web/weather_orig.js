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

const AQIPM25 = (concentration) => {
    const _conc = parseFloat(concentration);
    let AQI;
    const c = (Math.floor(10 * _conc)) / 10;
    if (c >= 0 && c < 12.1) {
        AQI = linear(50, 0, 12, 0, c);
    }
    else if (c >= 12.1 && c < 35.5) {
        AQI = linear(100, 51, 35.4, 12.1, c);
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
        result.color = colors.redorange;
        result.fontColor = fontColors.black;
    }
    else if (_AQI > 200 && _AQI <= 300) {
        result.AQICategory = "Very Unhealthy";
        result.color = colors.red;
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

const colors = {
    green: 'rgba(0, 128, 0, .9)',
    yellow: 'rgba(255, 255, 0, .9)',
    orange: 'rgba(255, 128, 0, .9)',
    redorange: 'rgba(255, 64, 0, .9)',
    red: 'rgba(255, 0, 0, .9)',
    brown: 'rgba(128, 64, 0, .9)',
    burntumber: 'rgba(128, 0, 0, .9)',
};

const fontColors = {
    black: 'black',
    white: 'white',
}

const getAQI = (P25) => {
    const aqi = AQIPM25(P25);
    const rating = AQIRating(aqi);

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

    console.log(result);
    return result;
};

const updateData = () => {
    getWeatherData().then(data => {

        const indoor = document.getElementById('indoor-data');
        const outdoor = document.getElementById('outdoor-data');
        const indoorTemp = indoor.getElementsByClassName('temp')[0];
        const outdoorTemp = outdoor.getElementsByClassName('temp')[0];
        const indoorHumidity = indoor.getElementsByClassName('humidity')[0];
        const outdoorHumidity = outdoor.getElementsByClassName('humidity')[0];

        const indoorAQI = indoor.getElementsByClassName('aqi')[0];
        const outdoorAQI = outdoor.getElementsByClassName('aqi')[0];

        indoor.style.backgroundColor = data.indoor.aqi.color;
        outdoor.style.backgroundColor = data.outdoor.aqi.color;

        indoorTemp.innerHTML = `${Math.round(data.indoor.temp * 10) / 10} °F`;
        indoorTemp.style.color = data.indoor.aqi.fontColor;
        outdoorTemp.innerHTML = `${Math.round(data.outdoor.temp * 10) / 10} °F`;
        outdoorTemp.style.color = data.outdoor.aqi.fontColor;

        indoorHumidity.innerHTML = `${Math.round(data.indoor.humidity * 10) / 10}%`;
        indoorHumidity.style.color = data.indoor.aqi.fontColor;
        outdoorHumidity.innerHTML = `${Math.round(data.outdoor.humidity * 10) / 10}%`;
        outdoorHumidity.style.color = data.outdoor.aqi.fontColor;

        indoorAQI.innerHTML = `PM2.5 AQI: ${Math.round(data.indoor.aqi.aqi)}`;
        indoorAQI.style.color = data.indoor.aqi.fontColor;
        outdoorAQI.innerHTML = `PM2.5 AQI: ${Math.round(data.outdoor.aqi.aqi)}`;
        outdoorAQI.style.color = data.outdoor.aqi.fontColor;
    });
};