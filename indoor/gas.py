# MICS6814 gas readings with a warm-up period and a rolling 7-day R0 baseline,
# ported from aqi_monitor.py. Baseline temperatures are raw BME280 readings in F,
# as in the original, so the compensation factors keep their meaning.
import math
import time

# Gas compensation factors from long term regression testing (per unit of raw temp F / RH / hPa)
FACTORS = {
    'red': {'temp': -0.015, 'hum': 0.0125, 'bar': -0.0053},
    'oxi': {'temp': -0.017, 'hum': 0.0115, 'bar': -0.0072},
    'nh3': {'temp': -0.02695, 'hum': 0.0094, 'bar': 0.003254},
}
GASES = ('red', 'oxi', 'nh3')
WARMUP_SECS = 6000
HISTORY_DAYS = 7


def _mean(values):
    return sum(values) / len(values)


def ppm_from_ratio(gas, ratio):
    ratio = ratio if ratio > 0 else 0.0001
    if gas == 'red':
        return math.pow(10, -1.25 * math.log10(ratio) + 0.64)
    if gas == 'oxi':
        return math.pow(10, math.log10(ratio) - 0.8129)
    return math.pow(10, -1.8 * math.log10(ratio) - 0.163)


class GasCalibration:
    """read_raw() returns (red, oxi, nh3) sensor resistances in ohms."""

    def __init__(self, read_raw, state=None, state_fresh=False):
        self.read_raw = read_raw
        self.start = time.time()
        self.r0_lists = {g: [] for g in GASES}
        self.baseline_lists = {'temp': [], 'hum': [], 'bar': []}
        self.last_daily_date = None
        self.warm = False
        if state:
            self.r0_lists = state.get('r0_lists', self.r0_lists)
            self.baseline_lists = state.get('baseline_lists', self.baseline_lists)
            self.last_daily_date = state.get('last_daily_date')
            # The heater stays on only while the service runs; a long stop means warming up again
            self.warm = bool(state.get('warm')) and state_fresh
        if not self.r0_lists['red']:
            # cold start with no history: provisional R0 until warm-up completes
            red, oxi, nh3 = read_raw()
            self.r0_lists = {'red': [red], 'oxi': [oxi], 'nh3': [nh3]}

    @property
    def r0(self):
        return {g: _mean(self.r0_lists[g]) for g in GASES}

    @property
    def baseline(self):
        if not self.baseline_lists['temp']:
            return None
        return {k: _mean(v) for k, v in self.baseline_lists.items()}

    def _push(self, raw_temp_f, raw_hum, raw_bar, spot_r0):
        for key, value in (('temp', raw_temp_f), ('hum', raw_hum), ('bar', raw_bar)):
            self.baseline_lists[key] = (self.baseline_lists[key] + [value])[-HISTORY_DAYS:]
        for g in GASES:
            self.r0_lists[g] = (self.r0_lists[g] + [spot_r0[g]])[-HISTORY_DAYS:]

    def maybe_calibrate(self, raw_temp_f, raw_hum, raw_bar, local_now, daily_hour):
        """Finish warm-up, and take the daily R0 sample at daily_hour (local)."""
        if not self.warm:
            if time.time() - self.start < WARMUP_SECS:
                return
            red, oxi, nh3 = self.read_raw()
            spot = {'red': red, 'oxi': oxi, 'nh3': nh3}
            if self.baseline is None:
                # first ever warm reading: seed the whole rolling window with it
                self.baseline_lists = {'temp': [raw_temp_f] * HISTORY_DAYS, 'hum': [raw_hum] * HISTORY_DAYS,
                                       'bar': [raw_bar] * HISTORY_DAYS}
                self.r0_lists = {g: [spot[g]] * HISTORY_DAYS for g in GASES}
            else:
                self._push(raw_temp_f, raw_hum, raw_bar, spot)
            self.warm = True
            print(f'Gas warm-up complete. R0 {self.r0}', flush=True)
            return
        today = local_now.date().isoformat()
        if local_now.hour == daily_hour and self.last_daily_date != today:
            red, oxi, nh3 = self.read_raw()
            self._push(raw_temp_f, raw_hum, raw_bar, {'red': red, 'oxi': oxi, 'nh3': nh3})
            self.last_daily_date = today
            print(f'Daily gas calibration. R0 {self.r0}', flush=True)

    def read(self, raw_temp_f, raw_hum, raw_bar):
        """Returns ({gas: ppm}, {gas: raw resistance})."""
        red, oxi, nh3 = self.read_raw()
        raw = {'red': red, 'oxi': oxi, 'nh3': nh3}
        base = self.baseline if self.warm else None
        r0 = self.r0
        ppm = {}
        for g in GASES:
            rs = raw[g]
            if base is not None:
                f = FACTORS[g]
                rs = rs - (f['temp'] * rs * (raw_temp_f - base['temp']) +
                           f['hum'] * rs * (raw_hum - base['hum']) +
                           f['bar'] * rs * (raw_bar - base['bar']))
            ppm[g] = round(ppm_from_ratio(g, rs / r0[g]), 2)
        return ppm, raw

    def state(self):
        return {'warm': self.warm, 'r0_lists': self.r0_lists, 'baseline_lists': self.baseline_lists,
                'last_daily_date': self.last_daily_date}
