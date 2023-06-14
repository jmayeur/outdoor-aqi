
const trendsChartInit = () => {
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

    const colorMap = {
        Good: colors.green,
        Moderate: colors.yellow,
        "Unhealthy for Sensitive Groups": colors.orange,
        Unhealthy: colors.red,
        Hazardous: colors.purple,
        "Very Hazardous": colors.brown,
        "Out of Range": colors.burntumber,
    };

    const boxWidth = 420;
    const boxHeight = 780;
    const widthPadding = 30;
    const heightPadding = 10;
    const squareSize = 60;
    const columns = Math.floor(boxWidth / squareSize);
    const rows = Math.floor(boxHeight / squareSize);
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    const aqiEquation = (AQIHigh, AQILow, concHigh, concLow, concentration) => {
        // via https://forum.airnowtech.org/t/the-aqi-equation/169
        return Math.round(((AQIHigh - AQILow) / (concHigh - concLow)) * (concentration - concLow) + AQILow);
    };

    const pm25aqi = (concentration) => {
        const _conc = parseFloat(concentration);
        const c = (Math.floor(10 * _conc)) / 10;
        switch (true) {
            case (c >= 0 && c < 12.1):
                return aqiEquation(50, 0, 12, 0, c);
            case (c >= 12.1 && c < 35.5):
                return aqiEquation(100, 51, 35.4, 12.1, c);
            case (c >= 35.5 && c < 55.5):
                return aqiEquation(150, 101, 55.4, 35.5, c);
            case (c >= 55.5 && c < 150.5):
                return aqiEquation(200, 151, 150.4, 55.5, c);
            case (c >= 150.5 && c < 250.5):
                return aqiEquation(300, 201, 250.4, 150.5, c);
            case (c >= 250.5 && c < 350.5):
                return aqiEquation(400, 301, 350.4, 250.5, c);
            case (c >= 350.5 && c < 500.5):
                return aqiEquation(500, 401, 500.4, 350.5, c);
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
        return raw.p25.map((d) => {
            const aqi = pm25aqi(d.value);
            const date = new Date(d.time);
            const day = formatDate(date);
            const hour = date.getHours();
            return { day, date, hour, P25: d.value, aqi, rating: aqiRating(aqi) };
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

    const getHistoricalPeaks91 = async (source) => {
        const response = await fetch(`${source}/peak-aq-data.json?dd=92&fields=(p25)`)
        const result = await response.json();
        return result;
    };

    const getData = async (source) => {
        let _data;
        try {
            _data = await getHistoricalPeaks91(source);
        } catch (e) {
            console.log(e);
            _data = {
                data: []
            };
        }
        return _data;
    };

    const drawBoardBackground = (ctx) => {
        const dftFillStyle = ctx.fillStyle;
        ctx.fillStyle = "white";
        ctx.fillRect(0.5 + widthPadding, 0.5 + heightPadding, boxWidth, boxHeight);
        ctx.fillStyle = dftFillStyle;
    };

    const drawBoard = (ctx) => {
        drawBoardBackground(ctx);
        for (let x = 0; x <= boxWidth; x += squareSize) {
            ctx.moveTo(0.5 + x + widthPadding, heightPadding);
            ctx.lineTo(0.5 + x + widthPadding, boxHeight + heightPadding);
        }

        for (let y = 0; y <= boxHeight; y += squareSize) {
            ctx.moveTo(widthPadding, 0.5 + y + heightPadding);
            ctx.lineTo(boxWidth + widthPadding, 0.5 + y + heightPadding);
        }
        ctx.strokeStyle = "black";
        ctx.stroke();
    };

    const drawBlockAndReturnNextYFloor = (ctx, x, y, color) => {
        const dftFillStyle = ctx.fillStyle;
        ctx.fillStyle = color;
        const _eX = 59;
        const _eY = (squareSize / 24);
        ctx.fillRect(x, y - _eY, _eX, _eY);
        ctx.fillStyle = dftFillStyle;
        return y - _eY + 0.25;
    };

    const drawText = (ctx, x, y, text) => {
        const dftFillStyle = ctx.fillStyle;
        ctx.fillStyle = "raspberry";
        ctx.font = "15px monospace";
        ctx.fontWeight = "bold";
        ctx.fillText(text, x + 7, y - 24);
        ctx.filter = "";
        ctx.fillStyle = dftFillStyle;

    }

    const drawData = (ctx, data) => {
        const keys = Object.keys(data).sort();
        let idx = 0;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                const xOffSet = widthPadding + 1 + (col * squareSize);

                let nextYFloor = heightPadding + (squareSize * (row + 1));

               
                const key = keys[idx];
                const day = data[key];
                for (const hour of day) {
                    nextYFloor = drawBlockAndReturnNextYFloor(ctx, xOffSet, nextYFloor, colorMap[hour.rating] );
                }
                const keyParts = key.split('-');
                const text = `${keyParts[1]}/${keyParts[2]}`;
                drawText(ctx, xOffSet, heightPadding + (squareSize * (row + 1)), text);
                idx++;
            };
        }
    };

    window.showTrendChart = (source) => {
        drawBoard(ctx);
        const src = source === 'Indoor' ? IndoorSrc : OutdoorSrc;
        getData(src).then(raw => {
            const readyData = processRaw(raw);
            const dateGrouped = groupByDate(readyData);
            drawData(ctx, dateGrouped);
        });
    };

};

trendsChartInit();


