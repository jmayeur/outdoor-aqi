/**
 * aq-chart-v3.js
 *
 * Key design decisions vs v1/v2:
 *  - All UI state lives in a single `state` object that is kept in sync with
 *    the URL's search params. This makes every view bookmarkable and shareable.
 *  - history.pushState is used for major navigation changes (metric / chart type)
 *    so the browser's Back / Forward buttons work naturally.
 *  - history.replaceState is used for minor changes (duration, refresh toggle)
 *    so they don't pollute the history stack.
 *  - Auto-refresh is only available for "current" data; switching to a
 *    historical view automatically disables it.
 *  - The `popstate` event restores the full chart state when the user navigates
 *    back or forward.
 *  - PM2.5 AQI calculation corrected: the 12.1-35.4 range (AQI 51-100,
 *    "Moderate") was missing from the original implementation.
 *  - Requires Chart.js 4 + chartjs-adapter-date-fns (loaded in the HTML).
 */

// ============================================================
// State – single source of truth, synced to URL search params
// ============================================================

const DEFAULT_STATE = {
    sensor:   'outdoor',  // 'outdoor' | 'indoor'
    metric:   'aqi',      // 'aqi' | 'weather' | 'gas'
    type:     'current',  // 'current' | 'historical' | 'peak'
    duration: 1,          // hours when type=current, days otherwise
    refresh:  true,       // auto-refresh (only relevant for type=current)
};

const SENSOR_ROOTS = {
    outdoor: 'http://192.168.119.137',
    indoor:  'http://192.168.119.220',
};

/** Default durations to apply when switching chart type */
const DEFAULT_DURATIONS = { current: 1, historical: 30, peak: 30 };

let state = { ...DEFAULT_STATE };
let chart = null;
let lastLoadEpoch = 0;
let watchInterval = null;

const RELOAD_DELAY_MS = 60 * 1000;

// ============================================================
// URL State Sync
// ============================================================

/**
 * Reads URL search params into `state`. Called on page load and `popstate`.
 * Historical types force refresh=false regardless of what the URL says.
 */
const readURLState = () => {
    const p = new URLSearchParams(window.location.search);
    const type = p.get('type') || DEFAULT_STATE.type;
    const rawSensor = p.get('sensor') || DEFAULT_STATE.sensor;
    state = {
        sensor:   rawSensor in SENSOR_ROOTS ? rawSensor : DEFAULT_STATE.sensor,
        metric:   p.get('metric')   || DEFAULT_STATE.metric,
        type,
        duration: parseFloat(p.get('duration') || DEFAULT_STATE.duration),
        refresh:  type === 'current' ? p.get('refresh') !== 'false' : false,
    };
};

/**
 * Writes `state` to the URL.
 * @param {boolean} push  true → pushState (adds a history entry)
 *                        false → replaceState (updates current entry silently)
 */
const writeURLState = (push = true) => {
    const params = new URLSearchParams({
        sensor:   state.sensor,
        metric:   state.metric,
        type:     state.type,
        duration: state.duration,
        refresh:  state.refresh,
    });
    const url = `${window.location.pathname}?${params.toString()}`;
    if (push) {
        history.pushState({ ...state }, '', url);
    } else {
        history.replaceState({ ...state }, '', url);
    }
    const loc = state.sensor === 'indoor' ? 'Indoor' : 'Outdoor';
    document.title = `AQI – ${loc} / ${state.metric} / ${state.type} / ${state.duration}${state.type === 'current' ? 'h' : 'd'}`;
};

// ============================================================
// Colors
// ============================================================

/** Converts a #rrggbb hex string to an rgba() CSS string. */
const hexToRgbA = (hex, a = 1) => {
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        let c = hex.substring(1).split('');
        if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        c = '0x' + c.join('');
        return `rgba(${[(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',')},${a})`;
    }
    throw new Error('Bad Hex');
};

/**
 * Per-metric color palettes.
 * Colors are chosen for dark backgrounds and contrast against each other.
 *   aqi:     sky-blue (PM1) · orange (PM10) · violet (PM2.5 – most important)
 *   weather: warm-red (temp) · emerald (humidity)
 *   gas:     amber (NO2) · sky (CO) · purple (NH3)
 */
const METRIC_PALETTES = {
    aqi:     ['#38bdf8', '#fb923c', '#a78bfa'],
    weather: ['#f87171', '#34d399'],
    gas:     ['#fbbf24', '#60a5fa', '#c084fc'],
};

// ============================================================
// Duration lists
// ============================================================

const hourDurationList = [
    { id: 'dur_24',  value: 24,  label: 'Last 24 hrs' },
    { id: 'dur_12',  value: 12,  label: 'Last 12 hrs' },
    { id: 'dur_6',   value: 6,   label: 'Last 6 hrs'  },
    { id: 'dur_3',   value: 3,   label: 'Last 3 hrs'  },
    { id: 'dur_1',   value: 1,   label: 'Last 1 hr'   },
    { id: 'dur_0_5', value: 0.5, label: 'Last 30 min' },
];

const dayDurationList = [
    { id: 'dur_30', value: 30, label: 'Last 30 days' },
    { id: 'dur_15', value: 15, label: 'Last 15 days' },
    { id: 'dur_10', value: 10, label: 'Last 10 days' },
    { id: 'dur_5',  value: 5,  label: 'Last 5 days'  },
    { id: 'dur_1',  value: 1,  label: 'Last 1 day'   },
];

const getDurationList = () =>
    state.type === 'current' ? hourDurationList : dayDurationList;

/** Rebuilds the duration pill row to match the current state. */
const makeDurations = () => {
    const anchor = document.getElementById('durations');
    anchor.innerHTML = '';
    getDurationList().forEach(d => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type  = 'radio';
        input.id    = d.id;
        input.name  = 'duration';
        input.value = d.value;
        if (d.value === state.duration) input.checked = true;
        label.setAttribute('for', d.id);
        label.appendChild(input);
        label.appendChild(document.createTextNode(d.label));
        anchor.appendChild(label);
    });
};

// ============================================================
// Data definitions
// ============================================================

const DATA_ELEMENTS = [
    { id: 'output_temp',     label: '°F'              },
    { id: 'output_humidity', label: 'Humidity'         },
    { id: 'output_bar',      label: 'Barometer'        },
    { id: 'oxi',             label: 'Oxidising (NO2)'  },
    { id: 'red',             label: 'Reducing (CO)'    },
    { id: 'nh3',             label: 'Ammonia (NH3)'    },
    { id: 'p1',              label: 'PM1'              },
    { id: 'p10',             label: 'PM10'             },
    { id: 'p25',             label: 'PM2.5'            },
];

const METRIC_FIELDS = {
    aqi:     ['p1', 'p10', 'p25'],
    weather: ['output_temp', 'output_humidity'],
    gas:     ['oxi', 'red', 'nh3'],
};

// ============================================================
// Data fetching
// ============================================================

const getChartData = () => {
    const fields     = METRIC_FIELDS[state.metric] || METRIC_FIELDS.aqi;
    const fieldParam = `(${fields.join(',')})`;
    const root       = SENSOR_ROOTS[state.sensor] || SENSOR_ROOTS.outdoor;
    switch (state.type) {
        case 'current':
            return fetch(`${root}/aq-data.json?dh=${state.duration}&fields=${fieldParam}`)
                .then(r => r.json());
        case 'historical':
            return fetch(`${root}/agg-aq-data.json?dd=${state.duration}&fields=${fieldParam}`)
                .then(r => r.json());
        case 'peak':
            return fetch(`${root}/peak-aq-data.json?dd=${state.duration}&fields=${fieldParam}`)
                .then(r => r.json());
        default:
            return Promise.reject(new Error(`Unknown chart type: ${state.type}`));
    }
};

// ============================================================
// Chart config builder
// ============================================================

const buildChartConfig = (_data) => {
    const datasets = [];
    const palette  = METRIC_PALETTES[state.metric] || METRIC_PALETTES.aqi;
    const TICK     = '#64748b';
    const FONT     = "'Inter', system-ui, sans-serif";
    let startTime, endTime;

    Object.keys(_data).forEach((key, index) => {
        const element = DATA_ELEMENTS.find(i => i.id === key);
        const items   = _data[key];
        const color   = palette[index % palette.length];

        if (!startTime) {
            startTime = new Date(items[0].time);
            endTime   = new Date(items[items.length - 1].time);
        }

        datasets.push({
            label:                element ? element.label : key,
            data:                 items.map(v => ({ x: new Date(v.time), y: v.value })),
            borderColor:          color,
            borderWidth:          2,
            // Gradient fill: opaque at top, transparent at bottom.
            // The function form is called per-render so chartArea is always valid.
            backgroundColor: (context) => {
                const { ctx, chartArea } = context.chart;
                if (!chartArea) return hexToRgbA(color, 0.15);
                const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                grad.addColorStop(0, hexToRgbA(color, 0.40));
                grad.addColorStop(1, hexToRgbA(color, 0.01));
                return grad;
            },
            pointBackgroundColor: color,
            pointBorderColor:     'transparent',
            fill:                 true,
            cubicInterpolationMode: 'monotone',
            pointRadius:          1.5,
            pointHoverRadius:     6,
            pointHoverBackgroundColor: color,
            pointHoverBorderColor:     '#fff',
            pointHoverBorderWidth:     2,
        });
    });

    const METRIC_LABEL = { aqi: 'Air Quality', weather: 'Weather', gas: 'Gas Levels' };
    const sensorLabel  = state.sensor === 'indoor' ? 'Indoor' : 'Outdoor';
    const fmt = (d, opts) => d.toLocaleString('en-US', opts);
    const dateOpts = { month: 'short', day: 'numeric' };
    const timeOpts = { hour: '2-digit', minute: '2-digit' };
    const titleLines = startTime ? [
        `${sensorLabel}  ·  ${METRIC_LABEL[state.metric] || state.metric}`,
        `${fmt(startTime, dateOpts)} ${fmt(startTime, timeOpts)}  –  ${fmt(endTime, dateOpts)} ${fmt(endTime, timeOpts)}`,
    ] : [`${sensorLabel}  ·  ${METRIC_LABEL[state.metric] || state.metric}`];

    return {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: { duration: 400, easing: 'easeInOutQuart' },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: {
                    display: true,
                    text: titleLines,
                    color: '#e2e8f0',
                    font: { size: 14, weight: '500', family: FONT },
                    padding: { top: 18, bottom: 4 },
                },
                legend: {
                    labels: {
                        color: '#94a3b8',
                        font: { size: 12, family: FONT },
                        usePointStyle: true,
                        pointStyleWidth: 8,
                        boxHeight: 6,
                        padding: 20,
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.92)',
                    titleColor: '#64748b',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: { size: 11, family: FONT },
                    bodyFont:  { size: 13, weight: '500', family: FONT },
                    callbacks: {
                        label: (ctx) => {
                            const v = typeof ctx.parsed.y === 'number'
                                ? ctx.parsed.y.toFixed(1) : ctx.parsed.y;
                            return `  ${ctx.dataset.label}: ${v}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: 'time',
                    ticks: {
                        color: TICK,
                        maxRotation: 0,
                        font: { size: 11, family: FONT },
                        maxTicksLimit: 8,
                    },
                    grid:   { color: 'rgba(255,255,255,0.04)' },
                    border: { color: 'rgba(255,255,255,0.08)' },
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: TICK,
                        maxTicksLimit: 6,
                        font: { size: 11, family: FONT },
                        padding: 8,
                    },
                    grid:   { color: 'rgba(255,255,255,0.04)' },
                    border: { color: 'transparent' },
                },
            },
        },
    };
};

// ============================================================
// AQI Calculations – PM2.5 breakpoints per the EPA standard
// ============================================================

/** EPA piecewise linear formula. */
const linear = (AQIHigh, AQILow, concHigh, concLow, c) =>
    Math.round(((c - concLow) / (concHigh - concLow)) * (AQIHigh - AQILow) + AQILow);

/**
 * Convert a PM2.5 µg/m³ concentration to an AQI value.
 * Fixed: the 12.1–35.4 range (AQI 51–100, "Moderate") was absent in v1/v2.
 */
const AQIPM25 = (concentration) => {
    const c = Math.floor(10 * parseFloat(concentration)) / 10;
    if (c >=   0   && c <  12.1) return linear(  50,   0,  12.0,   0.0, c);
    if (c >=  12.1 && c <  35.5) return linear( 100,  51,  35.4,  12.1, c); // was missing
    if (c >=  35.5 && c <  55.5) return linear( 150, 101,  55.4,  35.5, c);
    if (c >=  55.5 && c < 150.5) return linear( 200, 151, 150.4,  55.5, c);
    if (c >= 150.5 && c < 250.5) return linear( 300, 201, 250.4, 150.5, c);
    if (c >= 250.5 && c < 350.5) return linear( 400, 301, 350.4, 250.5, c);
    if (c >= 350.5 && c < 500.5) return linear( 500, 401, 500.4, 350.5, c);
    return null; // out of AQI range
};

const AQI_BANDS = [
    // chartBg: subtle dark tint for the chart card background
    // badgeColor: vivid accent used for the AQI badge text
    { max:   50, category: 'Good',                           chartBg: '#0a1f12', badgeColor: '#4ade80' },
    { max:  100, category: 'Moderate',                       chartBg: '#1f1a00', badgeColor: '#fbbf24' },
    { max:  150, category: 'Unhealthy for Sensitive Groups', chartBg: '#1f0e00', badgeColor: '#fb923c' },
    { max:  200, category: 'Unhealthy',                      chartBg: '#200000', badgeColor: '#f87171' },
    { max:  300, category: 'Very Unhealthy',                 chartBg: '#150826', badgeColor: '#c084fc' },
    { max:  500, category: 'Hazardous',                      chartBg: '#180010', badgeColor: '#f472b6' },
    { max: Infinity, category: 'Out of Range',               chartBg: '#1a1a1a', badgeColor: '#94a3b8' },
];

const AQIRating = (aqi) => AQI_BANDS.find(b => parseFloat(aqi) <= b.max);

/** Updates canvas background and all tick/label colors based on current PM2.5 AQI. */
const applyAQIBackground = (config) => {
    const pm25Dataset = config.data.datasets.find(d => d.label === 'PM2.5');
    const wrapper = document.querySelector('.chart-wrapper');
    const badge   = document.getElementById('aqi-badge');

    if (!pm25Dataset || !pm25Dataset.data.length) {
        wrapper.style.background = '#12121e';
        if (badge) badge.hidden = true;
        return;
    }

    const lastPM25 = pm25Dataset.data[pm25Dataset.data.length - 1].y;
    const aqi      = AQIPM25(lastPM25);
    if (aqi === null) {
        wrapper.style.background = '#12121e';
        if (badge) badge.hidden = true;
        return;
    }

    const rating = AQIRating(aqi);
    wrapper.style.background = rating.chartBg;

    if (badge) {
        badge.hidden = false;
        badge.style.color = rating.badgeColor;
        badge.querySelector('.aqi-value').textContent    = aqi;
        badge.querySelector('.aqi-category').textContent = rating.category;
    }
};

// ============================================================
// Chart rendering
// ============================================================

const renderChart = () => {
    return getChartData()
        .then(_data => {
            const config = buildChartConfig(_data);

            if (state.metric === 'aqi' && state.type === 'current') {
                applyAQIBackground(config);
            } else {
                document.querySelector('.chart-wrapper').style.background = '#12121e';
                const badge = document.getElementById('aqi-badge');
                if (badge) badge.hidden = true;
            }

            // Destroy and recreate to avoid stale scale / plugin state across
            // changes to chart type or metrics.
            if (chart) { chart.destroy(); chart = null; }
            const ctx = document.getElementById('line-chart').getContext('2d');
            chart = new Chart(ctx, config);

            lastLoadEpoch = Date.now();
            syncCountdown();
        })
        .catch(err => {
            console.error('Failed to load chart data:', err);
            const el = document.getElementById('countdown');
            el.textContent = 'Error loading data';
            el.classList.add('paused');
        });
};

// ============================================================
// Auto-refresh / countdown
// ============================================================

const syncCountdown = () => {
    const el = document.getElementById('countdown');
    if (!state.refresh || state.type !== 'current') {
        el.textContent = 'paused';
        el.classList.add('paused');
        return;
    }
    el.classList.remove('paused');
    const remaining = Math.round((lastLoadEpoch + RELOAD_DELAY_MS - Date.now()) / 1000);
    el.textContent = remaining > 0 ? `↻ ${remaining}s` : '↻ refreshing…';
};

const stopWatch = () => {
    if (watchInterval) { clearInterval(watchInterval); watchInterval = null; }
};

const startWatch = () => {
    stopWatch();
    if (!state.refresh || state.type !== 'current') return;
    watchInterval = setInterval(() => {
        if (Date.now() >= lastLoadEpoch + RELOAD_DELAY_MS) {
            renderChart();  // updates lastLoadEpoch and calls syncCountdown
        } else {
            syncCountdown();
        }
    }, 1000);
};

// ============================================================
// UI ↔ State synchronisation
// ============================================================

/** Push current state values into every UI control. */
const syncUIToState = () => {
    document.getElementById('sensor-selector').value     = state.sensor;
    document.getElementById('metrics-selector').value    = state.metric;
    document.getElementById('charttype-selector').value  = state.type;

    const refreshToggle = document.getElementById('refresh-toggle');
    if (state.type !== 'current') {
        refreshToggle.disabled = true;
        refreshToggle.checked  = false;
    } else {
        refreshToggle.disabled = false;
        refreshToggle.checked  = state.refresh;
    }

    makeDurations();
    bindDurationEvents();
    syncCountdown();
};

// ============================================================
// Event bindings
// ============================================================

/**
 * (Re-)binds the duration radio buttons after`makeDurations` rebuilds the DOM.
 * Uses replaceState: duration is a refinement, not a new "page".
 */
const bindDurationEvents = () => {
    document.querySelectorAll('input[type=radio][name="duration"]').forEach(radio => {
        radio.addEventListener('change', e => {
            state.duration = parseFloat(e.target.value);
            writeURLState(false);
            renderChart();
        });
    });
};

document.getElementById('sensor-selector').addEventListener('change', e => {
    state.sensor = e.target.value;
    writeURLState(true); // different data source → add history entry
    renderChart();
});

document.getElementById('metrics-selector').addEventListener('change', e => {
    state.metric = e.target.value;
    writeURLState(true); // new major view → add history entry
    syncUIToState();
    renderChart();
});

document.getElementById('charttype-selector').addEventListener('change', e => {
    state.type     = e.target.value;
    state.duration = DEFAULT_DURATIONS[state.type];
    // Historical/peak types never auto-refresh
    if (state.type !== 'current') state.refresh = false;
    writeURLState(true); // new major view → add history entry
    syncUIToState();
    renderChart().then(() => {
        if (state.refresh) startWatch(); else stopWatch();
    });
});

document.getElementById('refresh-toggle').addEventListener('change', e => {
    state.refresh = e.target.checked;
    writeURLState(false);
    if (state.refresh) { startWatch(); } else { stopWatch(); syncCountdown(); }
});

// Clicking the countdown badge also toggles refresh
document.getElementById('countdown').addEventListener('click', () => {
    if (state.type !== 'current') return;
    state.refresh = !state.refresh;
    document.getElementById('refresh-toggle').checked = state.refresh;
    writeURLState(false);
    if (state.refresh) { startWatch(); } else { stopWatch(); syncCountdown(); }
});

// Restore full state when the user navigates back/forward
window.addEventListener('popstate', () => {
    readURLState();
    stopWatch();
    syncUIToState();
    renderChart().then(() => {
        if (state.refresh) startWatch();
    });
});

// ============================================================
// Initialisation
// ============================================================

readURLState();
syncUIToState();
// Initialise URL (replaceState so we don't add a spurious history entry)
writeURLState(false);
renderChart().then(() => {
    if (state.refresh) startWatch();
});
