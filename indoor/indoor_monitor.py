#!/usr/bin/env python3
"""Indoor Enviro+ collector and LCD display (Pi Zero W), replacing aqi_monitor.py.

Writes one row a minute to envdata through db_manager, with the same raw/output columns
as the outdoor collector, and drives the LCD (icon weather, all air quality, forecast;
tap the proximity sensor to switch). Corrections come from enviro_math with the
'indoor' site profile.

Run from the directory holding the environment DB:
  cd ~/enviro-lite && python3 indoor/indoor_monitor.py
"""
import json
import os
import signal
import sqlite3
import sys
import threading
import time
from collections import deque
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))

try:
    from smbus2 import SMBus
except ImportError:
    from smbus import SMBus
from bme280 import BME280
from enviroplus import gas as mics6814
from ltr559 import LTR559
from pms5003 import PMS5003, ReadTimeoutError, ChecksumMismatchError
import ST7735

from enviro_math import (adjusted_temperature, adjusted_humidity, sea_level_pressure,
                         celsius_to_fahrenheit, fahrenheit_to_celsius)
from db_manager import DbManager
from gas import GasCalibration
from forecast import forecast, trend_symbol
from lcd_display import Display, SCREENS, make_location

SITE = 'indoor'
TZ = ZoneInfo('America/Los_Angeles')
# City-level coordinates, only used for the sun position on the icon screen
LOCATION = make_location('Portland', 'USA', 'America/Los_Angeles', 45.52, -122.68)

DB_PATH = './environment'
STATE_PATH = './indoor_state.json'
SAMPLE_SECS = 60
POLL_SECS = 0.1
STARTUP_SECS = 300           # no DB writes while the sensors settle after start
STATE_FRESH_SECS = 1200      # gas heater state survives a restart shorter than this
STATE_SAVE_SECS = 300
GAS_DAILY_HOUR = 3           # local hour for the rolling R0 sample
PROXIMITY_THRESHOLD = 1500
TAP_DEBOUNCE_SECS = 0.5
MIN_VALID_RAW_BAR = 900
LOG_EVERY = 10               # samples between journal summaries

running = True


def stop(signum, frame):
    global running
    running = False


class PMSampler(threading.Thread):
    """Reads every PMS5003 frame (~1/s) and averages them over each sample interval."""

    def __init__(self, pms):
        super().__init__(daemon=True)
        self.pms = pms
        self.lock = threading.Lock()
        self._reset_totals()
        self.bad_frames = 0
        self.timeouts = 0

    def _reset_totals(self):
        self.totals = {1.0: 0.0, 2.5: 0.0, 10: 0.0}
        self.frames = 0

    def run(self):
        while running:
            try:
                frame = self.pms.read()
            except ChecksumMismatchError:
                self.bad_frames += 1
                continue
            except ReadTimeoutError:
                self.timeouts += 1
                try:
                    self.pms.reset()
                except Exception as e:
                    print('PMS5003 reset failed:', e, flush=True)
                    time.sleep(5)
                continue
            except Exception as e:
                print('PMS5003 read failed:', e, flush=True)
                time.sleep(5)
                continue
            with self.lock:
                for size in self.totals:
                    self.totals[size] += frame.pm_ug_per_m3(size)
                self.frames += 1

    def take(self):
        """Returns ({1.0, 2.5, 10: average ug/m3}, frame count), or (None, 0) with no frames."""
        with self.lock:
            frames = self.frames
            averages = {s: round(t / frames, 2) for s, t in self.totals.items()} if frames else None
            self._reset_totals()
        return averages, frames


def corrected(raw_c, raw_hum, raw_bar):
    out_c = adjusted_temperature(raw_c, SITE)
    return (out_c, adjusted_humidity(raw_hum, raw_c, out_c, SITE),
            sea_level_pressure(raw_bar, out_c, SITE))


def load_history():
    """Last 24 h of (time, corrected temp F, sea-level pressure) from the DB."""
    history = deque()
    try:
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute('''SELECT time, raw_temp, raw_humidity, raw_bar FROM envdata
                               WHERE time >= ? AND raw_temp IS NOT NULL AND raw_bar > ?
                               ORDER BY time''', (time.time() - 86400, MIN_VALID_RAW_BAR)).fetchall()
        conn.close()
    except sqlite3.Error as e:
        print('Could not read history:', e, flush=True)
        return history
    for t, raw_f, raw_hum, raw_bar in rows:
        out_c, _, bar = corrected(fahrenheit_to_celsius(raw_f), raw_hum, raw_bar)
        history.append((t, celsius_to_fahrenheit(out_c), bar))
    return history


def pressure_change(history, now, bar):
    """Change over 3 h, against the reading nearest to 3 h ago (within 10 min)."""
    target = now - 3 * 3600
    best = None
    for t, _, b in history:
        if abs(t - target) <= 600 and (best is None or abs(t - target) < abs(best[0] - target)):
            best = (t, b)
        if t > target + 600:
            break
    return None if best is None else bar - best[1]


def load_state():
    try:
        with open(STATE_PATH) as f:
            state = json.load(f)
        return state, time.time() - state.get('saved', 0) < STATE_FRESH_SECS
    except (OSError, ValueError):
        return {}, False


def save_state(gas_cal, screen):
    state = {'saved': time.time(), 'screen': screen, 'gas': gas_cal.state()}
    tmp = STATE_PATH + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f)
    os.replace(tmp, STATE_PATH)


def read_raw_gas():
    g = mics6814.read_all()
    return round(g.reducing, 0), round(g.oxidising, 0), round(g.nh3, 0)


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    start = time.time()

    disp = ST7735.ST7735(port=0, cs=1, dc=9, backlight=12, rotation=270, spi_speed_hz=10000000)
    disp.begin()
    display = Display(disp, LOCATION)
    display.show_message('Starting...')

    bme280 = BME280(i2c_dev=SMBus(1))
    ltr559 = LTR559()
    # the first BME280 reading after setup is not reliable
    bme280.get_temperature()
    bme280.get_humidity()
    bme280.get_pressure()

    state, fresh = load_state()
    gas_cal = GasCalibration(read_raw_gas, state.get('gas'), fresh)
    screen = state.get('screen', SCREENS[0])
    if screen not in SCREENS:
        screen = SCREENS[0]

    pm_sampler = PMSampler(PMS5003())
    pm_sampler.start()

    db = DbManager(DB_PATH)
    history = load_history()
    print(f'Started: {len(history)} rows of history, gas warm={gas_cal.warm}, screen={screen}', flush=True)

    view = None
    next_sample = (int(time.time()) // SAMPLE_SECS + 1) * SAMPLE_SECS
    last_state_save = time.time()
    last_tap = 0
    prox_was_high = False
    rendered_minute = None
    samples = 0

    while running:
        now = time.time()
        dirty = False

        # tap the sensor to change screen (edge-triggered, so a hand held over it moves one screen)
        try:
            prox_high = ltr559.get_proximity() > PROXIMITY_THRESHOLD
        except Exception:
            prox_high = False
        if prox_high and not prox_was_high and now - last_tap > TAP_DEBOUNCE_SECS:
            screen = SCREENS[(SCREENS.index(screen) + 1) % len(SCREENS)]
            last_tap = now
            dirty = True
        prox_was_high = prox_high

        if now >= next_sample:
            next_sample = max(next_sample + SAMPLE_SECS, (int(now) // SAMPLE_SECS + 1) * SAMPLE_SECS)
            try:
                view = take_sample(bme280, pm_sampler, gas_cal, db, history, start, now)
                samples += 1
                if samples % LOG_EVERY == 1:
                    print('Sample: {:.1f}F {:.0f}% {:.1f}hPa PM2.5 {} ({} frames, {} bad, {} timeouts) gas warm={}'.format(
                        view['temp_f'], view['hum'], view['bar'], view['aq']['P2.5'], view['pm_frames'],
                        pm_sampler.bad_frames, pm_sampler.timeouts, gas_cal.warm), flush=True)
            except Exception as e:
                print('Sample failed:', repr(e), flush=True)
                display.show_message('Sensor Error', error=True)
                view = None
            dirty = True

        local_now = datetime.now(TZ)
        if view is not None and (dirty or local_now.minute != rendered_minute):
            view['local_dt'] = local_now
            try:
                display.show(screen, view)
            except Exception as e:
                print('Display failed:', repr(e), flush=True)
            rendered_minute = local_now.minute

        if now - last_state_save >= STATE_SAVE_SECS:
            save_state(gas_cal, screen)
            last_state_save = now

        time.sleep(POLL_SECS)

    save_state(gas_cal, screen)
    display.show_message('Monitor stopped')
    print('Stopped', flush=True)


def take_sample(bme280, pm_sampler, gas_cal, db, history, start, now):
    raw_c = bme280.get_temperature()
    raw_hum = bme280.get_humidity()
    raw_bar = bme280.get_pressure()
    if raw_bar < MIN_VALID_RAW_BAR:
        raise ValueError(f'implausible BME280 reading: {raw_c:.2f} C {raw_hum:.1f}% {raw_bar:.1f} hPa')
    out_c, hum, bar = corrected(raw_c, raw_hum, raw_bar)
    raw_f, out_f = celsius_to_fahrenheit(raw_c), celsius_to_fahrenheit(out_c)

    local_now = datetime.now(TZ)
    gas_cal.maybe_calibrate(raw_f, raw_hum, raw_bar, local_now, GAS_DAILY_HOUR)
    ppm, raw_rs = gas_cal.read(raw_f, raw_hum, raw_bar)

    pm, frames = pm_sampler.take()
    p1, p25, p10 = (pm[1.0], pm[2.5], pm[10]) if pm else (None, None, None)

    run_time = round(now - start, 0)
    if run_time >= STARTUP_SECS:
        db.writeToDB(run_time, p1, p25, p10, raw_f, out_f, hum, raw_hum, raw_bar, bar,
                     ppm['oxi'], ppm['red'], ppm['nh3'], raw_rs['oxi'], raw_rs['red'], raw_rs['nh3'])

    history.append((now, out_f, bar))
    while history and history[0][0] < now - 86400:
        history.popleft()
    change = pressure_change(history, now, bar)
    text, icon = forecast(bar, change) if change is not None else ('Waiting for data', 'Wait')
    temps = [h[1] for h in history]
    return {
        'temp_f': out_f, 'temp_min': min(temps), 'temp_max': max(temps), 'hum': hum,
        'bar': bar, 'bar_change': change, 'trend': trend_symbol(change) if change is not None else '',
        'forecast': text, 'icon_forecast': icon, 'gas_warm': gas_cal.warm, 'pm_frames': frames,
        'aq': {'P1': p1, 'P2.5': p25, 'P10': p10, 'Oxi': ppm['oxi'], 'Red': ppm['red'], 'NH3': ppm['nh3']},
    }


if __name__ == '__main__':
    main()
