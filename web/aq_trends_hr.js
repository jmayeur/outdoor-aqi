
const trendsChartInit = () => {
    const IndoorSrc = 'http://192.168.119.220';
    const OutdoorSrc = 'http://192.168.119.137';

    const colors = {
        green:  'rgba( 52, 211, 153, 0.90)',  // Good               0–50
        yellow: 'rgba(251, 191,  36, 0.90)',  // Moderate          51–100
        orange: 'rgba(251, 146,  60, 0.90)',  // Unhealthy for SG 101–150
        red:    'rgba(248, 113, 113, 0.90)',  // Unhealthy        151–200
        purple: 'rgba(192, 132, 252, 0.90)',  // Hazardous        201–300
        pink:   'rgba(244, 114, 182, 0.90)',  // Very Hazardous   301–500
        slate:  'rgba(148, 163, 184, 0.90)',  // Out of Range      501+
    };

    const colorMap = {
        Good: colors.green,
        Moderate: colors.yellow,
        "Unhealthy for Sensitive Groups": colors.orange,
        Unhealthy: colors.red,
        Hazardous: colors.purple,
        "Very Hazardous": colors.pink,
        "Out of Range": colors.slate,
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
        ctx.fillStyle = '#12121e';
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
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
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
        const dftStrokeStyle = ctx.strokeStyle;
        const dftLineWidth = ctx.lineWidth;
        const dftFont = ctx.font;
        const dftBaseline = ctx.textBaseline;

        const labelX = x + 6;
        const labelY = y - 20;

        ctx.font = "600 11px 'Inter', system-ui, sans-serif";
        ctx.textBaseline = 'middle';

        const textWidth = ctx.measureText(text).width;
        const padX = 2;
        const chipHeight = 13;
        const chipY = labelY - (chipHeight / 2);

        // Draw a small high-contrast backing chip behind the date label.
        ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
        ctx.fillRect(labelX - padX, chipY, textWidth + (padX * 2), chipHeight);
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.22)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(labelX - padX, chipY, textWidth + (padX * 2), chipHeight);

        ctx.fillStyle = '#f8fafc';
        ctx.fillText(text, labelX, labelY);

        ctx.fillStyle = dftFillStyle;
        ctx.strokeStyle = dftStrokeStyle;
        ctx.lineWidth = dftLineWidth;
        ctx.font = dftFont;
        ctx.textBaseline = dftBaseline;
    };

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
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawBoard(ctx);
        // Tiny source label in the left-margin strip
        ctx.font = "500 9px 'Inter', monospace";
        ctx.fillStyle = '#475569';
        ctx.save();
        ctx.translate(12, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(source.toUpperCase(), 0, 0);
        ctx.restore();
        const src = source === 'Indoor' ? IndoorSrc : OutdoorSrc;
        getData(src).then(raw => {
            const readyData = processRaw(raw);
            const dateGrouped = groupByDate(readyData);
            drawData(ctx, dateGrouped);
        });
    };

};

trendsChartInit();


