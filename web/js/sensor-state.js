/**
 * sensor-state.js — Shared URL sensor-state helpers
 *
 * Used by pages that only manage a single ?sensor=outdoor|indoor URL param
 * (thresholds.html, aqi_trends.html). Pages with richer URL state (aq-chart-v3.js)
 * manage their own full state object instead.
 *
 * Exposes: window.SensorState.read()  → 'outdoor' | 'indoor'
 *          window.SensorState.write(sensor, push) → updates URL
 *          window.SensorState.label(sensor) → 'Outdoor' | 'Indoor'
 */
window.SensorState = (() => {
    const VALID = new Set(['outdoor', 'indoor']);

    return {
        /** Read ?sensor= from the current URL, defaulting to 'outdoor'. */
        read() {
            const raw = (new URLSearchParams(window.location.search).get('sensor') || 'outdoor').toLowerCase();
            return VALID.has(raw) ? raw : 'outdoor';
        },

        /**
         * Write ?sensor= to the URL.
         * @param {string}  sensor  'outdoor' | 'indoor'
         * @param {boolean} push    true → pushState, false → replaceState
         */
        write(sensor, push = false) {
            const url = `${window.location.pathname}?sensor=${sensor}`;
            push
                ? history.pushState({ sensor }, '', url)
                : history.replaceState({ sensor }, '', url);
        },

        /** Capitalised display label for a sensor key. */
        label(sensor) {
            return sensor === 'indoor' ? 'Indoor' : 'Outdoor';
        },
    };
})();
