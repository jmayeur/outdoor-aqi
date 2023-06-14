const http = require('http');
const util = require("util");
const port = process.env.PORT || 3000;
const fs = require('fs');
const baseAssetPath = '/home/pihead/enviro-lite/web/static/';
const prepareData = require('./preparedata');
const { getAggData, getPeakData } = require('./historicaldata');
const { readRealtimeData, readAboveThresholdP25Hours } = require('./db');
const baseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': 86400,
    'Vary': 'Accept-Encoding, Origin',
    'Keep-Alive': 'timeout=2, max=100',
    'Connection': 'Keep-Alive'
};

const getDurationHours = (url) => {
    if (url.indexOf('dh=') === -1) {
        return 24;
    }
    try {
        const param = url.split('dh=')[1].split("&")[0];
        return parseFloat(param);
    } catch (e) {
        console.log(e);
    }
    return 24
};

const getDurationDays = (url) => {
    if (url.indexOf('dd=') === -1) {
        return 30;
    }
    try {
        const param = url.split('dd=')[1].split("&")[0];
        return parseInt(param);
    } catch (e) {
        console.log(e);
    }
    return 30
};

const defaultFields = ['p1', 'p10', 'p25'];
const getFields = (url) => {
    if (url.indexOf('fields=') === -1) {
        return defaultFields;
    }
    try {
        const fields = url.split('fields=(')[1].split(")")[0];
        return fields.split(',');
    } catch (e) {
        console.log(e);
    }
    return defaultFields;
};

const getFileNameFromUrl = (url) => {
    const results = url.match(/(?<=\/)[^\/\?#]+(?=[^\/]*$)/);
    if (results && results.length > 0) {
        return results[0];
    }
    return 'weather_simp.html'
};

const getContentTypeForFileType = (fileName) => {
    const extRegExp = /\.((?:.(?!\.))+$)/g;
    const ext = extRegExp && extRegExp.length > 0 ? extRegExp[0] : '';

    switch (ext) {
        case '.html':
            return { 'Content-Type': 'text/html' };
        case '.js':
            return { 'Content-Type': 'application/javascript' };
        case '.css':
            return { 'Content-Type': 'text/css' };
        case 'ico':
            return { 'Content-Type': 'image/x-icon' };
        default:
            return { 'Content-Type': 'text/plain' };
    }
};

const handlers = {
    fileHandler: (request, response) => {
        const fileName = getFileNameFromUrl(request.url);
        console.log(`fileHandler Attempting to serve: ${fileName}`);
        const errHandler = (errorMessage) => {
            console.error(`fileHandler Failed to serve : ${fileName}`, e);
            response.writeHead(500, { 'Content-Type': 'application/json' });
            return response.end(errorMessage);
        }
        try {
            const stream = fs.createReadStream(`${baseAssetPath}${fileName}`);
            stream.on('error', (err) => {
                errHandler(err)
            })

            response.writeHead(200, getContentTypeForFileType(fileName));
            stream.pipe(response);
        } catch (e) {
            errHandler(util.format(e));
        }
    },

    aggDATA: (request, response) => {
        console.log(`aggDATA Attempting to serve DATA: ${request.url}`);
        try {
            const durationDays = getDurationDays(request.url);
            const fields = getFields(request.url);
            return getAggData(durationDays, fields).then((data) => {
                const headers = { ...baseHeaders };
                headers['Content-Type'] = 'application/json';
                response.writeHead(200, headers);
                return response.end(JSON.stringify(data));
            }).catch((err) => {
                console.error(`aggDATA Failed to serve DATA: ${request.url}`, err);
                response.writeHead(500, { 'Content-Type': 'application/json' });
                return response.end(JSON.stringify(err));
            });
        } catch (e) {
            console.error(`aggDATA Failed to serve DATA: ${request.url}`, e);
            response.writeHead(500, { 'Content-Type': 'application/json' });
            return response.end(JSON.stringify(e));
        }
    },

    peakDATA: (request, response) => {
        console.log(`peakDATA Attempting to serve DATA: ${request.url}`);
        try {
            const durationDays = getDurationDays(request.url);
            const fields = getFields(request.url);
            return getPeakData(durationDays, fields).then((data) => {
                const headers = { ...baseHeaders };
                headers['Content-Type'] = 'application/json';
                response.writeHead(200, headers);
                return response.end(JSON.stringify(data));
            }).catch((err) => {
                console.error(`peakDATA Failed to serve DATA: ${request.url}`, err);
                response.writeHead(500, { 'Content-Type': 'application/json' });
                return response.end(JSON.stringify(err));
            });
        } catch (e) {
            console.error(`peakDATA Failed to serve DATA: ${request.url}`, e);
            response.writeHead(500, { 'Content-Type': 'application/json' });
            return response.end(JSON.stringify(e));
        }
    },

    realtimeDATA: (request, response) => {
        console.log(`realtimeDATA Attempting to serve DATA: ${request.url}`);
        try {
            return readRealtimeData().then((data) => {
                const headers = { ...baseHeaders };
                headers['Content-Type'] = 'application/json';
                response.writeHead(200, headers);
                return response.end(JSON.stringify(data));
            }).catch((err) => {
                console.error(`realtimeDATA Failed to serve DATA: ${request.url}`, err);
                response.writeHead(500, { 'Content-Type': 'application/json' });
                return response.end(JSON.stringify(err));
            });
        } catch (e) {
            console.error(`realtimeDATA Failed to serve DATA: ${request.url}`, e);
            response.writeHead(500, { 'Content-Type': 'application/json' });
            return response.end(JSON.stringify(err));
        }
    },

    aboveP25Threshold: (request, response) => {
        console.log(`aboveP25Threshold Attempting to serve DATA: ${request.url}`);
        try {
            return readAboveThresholdP25Hours().then((data) => {
                const headers = { ...baseHeaders };
                headers['Content-Type'] = 'application/json';
                response.writeHead(200, headers);
                return response.end(JSON.stringify(data));
            }).catch((err) => {
                console.error(`aboveP25Threshold Failed to serve DATA: ${request.url}`, err);
                response.writeHead(500, { 'Content-Type': 'application/json' });
                return response.end(JSON.stringify(err));
            });
        } catch (e) {
            console.error(`aboveP25Threshold Failed to serve DATA: ${request.url}`, e);
            response.writeHead(500, { 'Content-Type': 'application/json' });
            return response.end(JSON.stringify(err));
        }
    },
    
    liveDATA: (request, response) => {
        console.log(`liveDATA Attempting to serve DATA: ${request.url}`);
        try {
            const durationHours = getDurationHours(request.url);
            const fields = getFields(request.url);
            return prepareData(durationHours, fields).then((data) => {
                const headers = { ...baseHeaders };
                headers['Content-Type'] = 'application/json';
                response.writeHead(200, headers);
                return response.end(JSON.stringify(data));
            }).catch((err) => {
                console.error(`liveDATA Failed to serve DATA: ${request.url}`, err);
                response.writeHead(500, { 'Content-Type': 'application/json' });
                return response.end(JSON.stringify(err));
            });
        } catch (e) {
            console.error(`liveDATA Failed to serve DATA: ${request.url}`, e);
            response.writeHead(500, { 'Content-Type': 'application/json' });
            return response.end(JSON.stringify(err));
        }
    },
};

const server = http.createServer(function (request, response) {
    const { method } = request;
    if (method === 'OPTIONS') {
        response.writeHead(200, baseHeaders);
        return response.end();
    } else if (method === 'GET') {

        if (request.url.indexOf('/agg-aq-data.json') !== -1) {
            return handlers.aggDATA(request, response);
        } else if (request.url.indexOf('/peak-aq-data.json') !== -1) {
            return handlers.peakDATA(request, response);
        } else if (request.url.indexOf('/aq-data.json') !== -1) {
            return handlers.liveDATA(request, response);
        } else if (request.url.indexOf('/realtime.json') !== -1) {
            return handlers.realtimeDATA(request, response);
        } else if (request.url.indexOf('/above_p25_threshold.json') !== -1) {
            return handlers.aboveP25Threshold(request, response);
        } else {
            return handlers.fileHandler(request, response);
        }
    }

    response.writeHead(404, { 'Content-Type': 'text/plain' });
    return response.end('Not Found');
});

server.listen(port, function () {
    console.log('Listening on port: %s', port);
});