const forecast = {
    base: {
        pointofficeData: {
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
        },
        apiHost: 'api.weather.gov',
        pointsAPIPath: 'points',
        latLon: { lat: 45.4333, lon: -122.5142 },
        gridpoint: { x: 117, y: 99 },
        station: 'PQR',

        getIcon: (url, dateString, size, classes) => {
            const _size = size || 'medium';
            const div = document.createElement('div');
            classes.forEach(c => div.classList.add(c));
            const img = document.createElement('img');

            let _url = url.split('?')[0];
            _url = `${_url}?size=${_size}`;
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
        },

        round: (n, p = 1) => {
            const mulitplier = Math.pow(10, p);
            return Math.round(n * mulitplier) / mulitplier;
        },
    },

    hourly: {
        cache: {
            data: undefined,
            timestamp: -1,
        },

        getRawForecast: async (station, gridpoint, apiHost) => {
            const hourlyForecastAPIPath = 'forecast/hourly';
            const reqUri = `https://${apiHost}/gridpoints/${station}/${gridpoint.x},${gridpoint.y}/${hourlyForecastAPIPath}`;
            return (await fetch(reqUri)).json();
        },

        formatPeriods: (periods, hoursToFormat) => {
            const _hoursToFormat = hoursToFormat || 6;

            if (new Date().getHours() >= new Date(periods[0].startTime).getHours()) {
                periods.shift();
            }

            return periods.slice(0, _hoursToFormat).map(period => {
                const { startTime, temperature, temperatureTrend, probabilityOfPrecipitation, relativeHumidity, windSpeed, windDirection, icon }
                    = period;
                return { startTime, temperature, temperatureTrend, probabilityOfPrecipitation, relativeHumidity, windSpeed, windDirection, icon };
            });
        },

        getTempElement: (temp) => {
            const div = document.createElement('div');
            div.classList.add('temp');
            div.classList.add('item');
            div.innerHTML = forecast.base.round(temp, 1);
            return div;
        },

        getHourElement: (dateString) => {
            const date = new Date(dateString);
            const div = document.createElement('div');
            div.classList.add('hour');
            div.classList.add('item');
            div.innerHTML = date.toLocaleString('en-US', { hour: 'numeric', hour12: true });
            return div;
        },

        getForecast: async () => {
            const now = Date.now();
            const { station, gridpoint, apiHost } = forecast.base;
            if (forecast.hourly.cache.data !== undefined) {
                if (now >= forecast.hourly.cache.timestamp + 60 * 1000 * 60) {
                    forecast.hourly.cache.data = await forecast.hourly.getRawForecast(station, gridpoint, apiHost);
                    forecast.hourly.cache.timestamp = now;
                } else if (new Date(forecast.hourly.cache.data.properties.periods[0].startTime).getHours() < new Date(now).getHours()) {
                    forecast.hourly.cache.data = await forecast.hourly.getRawForecast(station, gridpoint, apiHost);
                    forecast.hourly.cache.timestamp = now;
                }
            } else {
                forecast.hourly.cache.data = await forecast.hourly.getRawForecast(station, gridpoint, apiHost);
                forecast.hourly.cache.timestamp = now;
            }
            return forecast.hourly.formatPeriods(forecast.hourly.cache.data.properties.periods, 6);
        },

        renderForecast: async (root) => {

            try {
                const hours = await forecast.hourly.getForecast();
                hours.forEach(hour => {
                    root.appendChild(forecast.hourly.getHourElement(hour.startTime));
                    root.appendChild(forecast.hourly.getTempElement(hour.temperature));
                    root.appendChild(forecast.base.getIcon(hour.icon, hour.startTime, 'medium', ['icon', 'item']));
                });

            } catch (e) {
                console.error(e);
            }
        }
    },

    day: {
        cache: {
            date: undefined,
            data: undefined,
        },

//         getDayWidget: (temperature, chanceOfRain, isDayTime) => {


//             /*
//             <div class="icon sun-shower">
//   <div class="cloud"></div>
//   <div class="sun">
//     <div class="rays"></div>
//   </div>
//   <div class="rain"></div>
// </div>

// <div class="icon thunder-storm">
//   <div class="cloud"></div>
//   <div class="lightning">
//     <div class="bolt"></div>
//     <div class="bolt"></div>
//   </div>
// </div>

// <div class="icon cloudy">
//   <div class="cloud"></div>
//   <div class="cloud"></div>
// </div>

// <div class="icon flurries">
//   <div class="cloud"></div>
//   <div class="snow">
//     <div class="flake"></div>
//     <div class="flake"></div>
//   </div>
// </div>

// <div class="icon sunny">
//   <div class="sun">
//     <div class="rays"></div>
//   </div>
// </div>

// <div class="icon rainy">
//   <div class="cloud"></div>
//   <div class="rain"></div>
// </div>

//             */
//             const setIcon = (div, type, label) => {
//                 div.setAttribute('icon', 'sunny')
//                 div.setAttribute('data-label', label);
//                 return div
//             }
//             //Sunny
//             const getSunny = (div, label) => {
//                 const _div = setIcon(div, 'sunny', label);
//                 const span = document.createElement('span');
//                 span.classList.add('sun');
//                 _div.appendChild(span);
//                 return _div;
//             }

//             const getCloudy = (div, label) => {
//                 const _div = setIcon(div, 'cloudy', label);
//                 let span = document.createElement('span');
//                 span.classList.add('cloud');
//                 _div.appendChild(span);
//                 span = document.createElement('span');
//                 span.classList.add('cloud');
//                 _div.appendChild(span);
//                 return _div;
//             }

//             const getSnowy = (div, label) => {
//                 const _div = setIcon(div, 'snowy', label);
//                 const span = document.createElement('span');
//                 span.classList.add('snowman');
//                 _div.appendChild(span);
//                 const ul = document.createElement('ul');
//                 for(let i=1; i<=13;i++) {
//                     ul.appendChild('li');
//                 }
//                 _div.appendChild(ul);
//                 return _div;
//             }

//             const getStormy = (div, label) => {
//                 const _div = setIcon(div, 'stormy', label);
//                 const span = document.createElement('span');
//                 span.classList.add('cloud');
//                 _div.appendChild(span);
//                 const ul = document.createElement('ul');
//                 for(let i=1; i<=5;i++) {
//                     ul.appendChild('li');
//                 }
//                 _div.appendChild(ul);
//                 return _div;
//             }

//             const getMoon = (div, label) => {
//                 const _div = setIcon(div, 'supermoon', label);
//                 let span = document.createElement('span');
//                 span.classList.add('moon');
//                 _div.appendChild(span);
//                 span = document.createElement('span');
//                 span.classList.add('meteor');
//                 _div.appendChild(span);
//                 return _div;
//             }

//             if (is
//         }

        getRawForecast: async (station, gridpoint, apiHost) => {
            const dailyForecastAPIPath = 'forecast';
            const reqUri = `https://${apiHost}/gridpoints/${station}/${gridpoint.x},${gridpoint.y}/${dailyForecastAPIPath}`;
            return (await fetch(reqUri)).json();
        },

        formatPeriod: (period) => {
            const { name, _startTime, isDayTime, temperature, temperatureTrend, shortForecast, probabilityOfPrecipitation, relativeHumidity, icon } = period;
            return {
                name,
                startTime: new Date(_startTime),
                isDayTime,
                temperature,
                temperatureTrend,
                shortForecast,
                chanceOfRain: probabilityOfPrecipitation.value,
                humidity: relativeHumidity.value,
                icon
            };
        },

        formatForecast: (data) => {
            const current = forecast.day.formatPeriod(data.properties.periods[0]);
            const tonight = forecast.day.formatPeriod(data.properties.periods[1]);
            return {
                current,
                tonight,
            }
        },

        getForecast: async () => {
            const date = new Date();
            const { station, gridpoint, apiHost } = forecast.base;
            if (forecast.day.cache.data !== undefined) {
                if (date.getDate() !== forecast.day.cache.date.getDate()) {
                    forecast.day.cache.data = await forecast.day.getRawForecast(station, gridpoint, apiHost);
                    forecast.day.cache.date = date;
                }
            } else {
                forecast.day.cache.data = await forecast.day.getRawForecast(station, gridpoint, apiHost);
                forecast.day.cache.date = date;
            }
            return forecast.day.formatForecast(forecast.day.cache.data);
        },

        getTempElement: (temp, type) => {
            const div = document.createElement('div');
            div.classList.add('daytemp');
            div.classList.add( type === 'high' ? 'high' : 'low');
            div.innerHTML = forecast.base.round(temp, 1);

            return div;
        },

        getTempTrendElement: (temperatureTrend) => {
            const div = document.createElement('div');
            if (temperatureTrend === 'rising') {
                div.classList.add('triangle-top');
            } else if (temperatureTrend === 'falling') {
                div.classList.add('triangle-bottom');
            }

            return div;
        },

        getChanceOfRain: (percent) => {
            const div = document.createElement('div');
            div.classList.add('rain');
            div.innerHTML = `Rain: ${percent || 0}%`;
            return div;
        },

        getShortForecast: (shortForecast) => {
            const div = document.createElement('div');
            div.classList.add('short');
            div.innerHTML = shortForecast;
            return div;
        },


        renderForecast: async (root) => {
            try {
                const {current, tonight} = await forecast.day.getForecast();
               
                root.appendChild(forecast.day.getTempElement(current.temperature, 'high'));
                root.appendChild(forecast.day.getTempTrendElement(current.temperatureTrend));
                root.appendChild(forecast.day.getTempElement(tonight.temperature, 'low'));
                root.appendChild(forecast.base.getIcon(current.icon, new Date().toString(), 'large', ['icon']));
                root.appendChild(forecast.day.getChanceOfRain(current.chanceOfRain));
                root.appendChild(forecast.day.getShortForecast(current.shortForecast));
                
                
                
            } catch (e) {
                console.error(e);
            }
        },

    },
};


const showForecast = () => {
    const root = document.querySelector('.forecast');
    root.innerHTML = '';
    forecast.day.renderForecast(root);
    root.classList.remove('noshow');
}

const hideForecast = () => {
    const root = document.querySelector('.forecast');
    root.classList.add('noshow');
}
