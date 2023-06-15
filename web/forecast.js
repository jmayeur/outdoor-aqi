//https://api.weather.gov/points/45.4333,-122.5142
const apiHost = 'api.weather.gov';
const pointsAPIPath = 'points';
const latLon = { lat: 45.4333, lon: -122.5142 };
const gridpoint = { x: 117, y: 99 };
const station = 'PQR';

const pointofficeData = {
    "@id": "https://api.weather.gov/points/45.4333,-122.5142",
    "@type": "wx:Point",
    "cwa": "PQR",
    "forecastOffice": "https://api.weather.gov/offices/PQR",
    "gridId": "PQR",
    "gridX": 117,
    "gridY": 99,
    "forecast": "https://api.weather.gov/gridpoints/PQR/117,99/forecast",
    "forecastHourly": "https://api.weather.gov/gridpoints/PQR/117,99/forecast/hourly",
    "forecastGridData": "https://api.weather.gov/gridpoints/PQR/117,99",
    "observationStations": "https://api.weather.gov/gridpoints/PQR/117,99/stations",
    "relativeLocation": {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [
                -122.51496299999999,
                45.438583999999999
            ]
        },
        "properties": {
            "city": "Happy Valley",
            "state": "OR",
            "distance": {
                "unitCode": "wmoUnit:m",
                "value": 590.56326770068995
            },
            "bearing": {
                "unitCode": "wmoUnit:degree_(angle)",
                "value": 174
            }
        }
    }
};

const getHourlyForcast = async (station, gridpoint, apiHost) => {
    const hourlyForecastAPIPath = 'forecast/hourly';
    const reqUri = `https://${apiHost}/gridpoints/${station}/${gridpoint.x},${gridpoint.y}/${hourlyForecastAPIPath}`;
    return (await fetch(reqUri)).json();
};

const formatHourPeriods = (periods, hoursToFormat) => {
    const _hoursToFormat = hoursToFormat || 6;

    return periods.slice(0, _hoursToFormat).map(period => {
        const { startTime, temperature, temperatureTrend, probabilityOfPrecipitation, relativeHumidity, windSpeed, windDirection, icon }
            = period;
        return { startTime, temperature, temperatureTrend, probabilityOfPrecipitation, relativeHumidity, windSpeed, windDirection, icon };
    });
};

const getIcon = (url, dateString) => {
    const div = document.createElement('div');
    div.classList.add('icon');
    div.classList.add('item');
    const img = document.createElement('img');
    let _url = url.replace('small', 'medium').replace(',0', '');
    if (window.SunCalc) {
        try {
            const date = new Date(dateString);
            const { sunrise, sunset } = window.SunCalc.getTimes(new Date(), 45.4333, -122.5142);

            if (date >= sunrise && date <= sunset) {
                _url = _url.replace('night', 'day');
            } else if (date >= sunset) {
                _url = _url.replace('day', 'night');
            }
        } catch (e) {
            console.error(e);
        }

    }
    img.src = _url
    div.appendChild(img);
    return div;
};

const getTempElement = (temp) => {
    const div = document.createElement('div');
    div.classList.add('temp');
    div.classList.add('item');
    div.innerHTML = round(temp, 1);
    return div;
}

const getHourElement = (dateString) => {
    const date = new Date(dateString);
    const div = document.createElement('div');
    div.classList.add('hour');
    div.classList.add('item');
    div.innerHTML = date.toLocaleString('en-US', { hour: 'numeric', hour12: true });
    return div;
};

const renderForecast = async (root) => {

    try {
        const rawForecast = await getHourlyForcast(station, gridpoint, apiHost);
        const hours = formatHourPeriods(rawForecast.properties.periods, 6);
        hours.forEach(hour => {
            root.appendChild(getHourElement(hour.startTime));
            root.appendChild(getTempElement(hour.temperature));
            root.appendChild(getIcon(hour.icon, hour.startTime));
        });

    } catch (e) {
        console.error(e);
    }
};

const showForecast = () => {
    const root = document.querySelector('.forecast');
    root.innerHTML = '';
    renderForecast(root);
    root.classList.remove('noshow');
}

const hideForecast = () => {
    const root = document.querySelector('.forecast');
    root.classList.add('noshow');
}
