#!/usr/bin/env python
from pms5003 import PMS5003
import board
import math
import types
from adafruit_bme280 import basic as adafruit_bme280
from mics6814 import MICS6814
gas = MICS6814()

temp_offset = 0
comp_temp_cub_a = 0.00033
comp_temp_cub_b = -0.03129
comp_temp_cub_c = 1.8736
comp_temp_cub_d = -14.82131
comp_temp_cub_d = comp_temp_cub_d + temp_offset
# Magnus coefficients (Sonntag 1990) for dew point based humidity correction
magnus_b = 17.62
magnus_c = 243.12

# New Gas Comp Factors based on long term regression testing and proportion of RS
red_temp_comp_factor = -0.015
red_hum_comp_factor = 0.0125
red_bar_comp_factor = -0.0053
oxi_temp_comp_factor = -0.017
oxi_hum_comp_factor = 0.0115
oxi_bar_comp_factor = -0.0072
nh3_temp_comp_factor = -0.02695
nh3_hum_comp_factor = 0.0094
nh3_bar_comp_factor = 0.003254

# Station elevation for sea-level pressure correction (730 ft)
station_altitude_m = 222.5

def read_raw_gas():
    gas_data = gas.read_all()
    raw_red_rs = round(gas_data.reducing, 0)
    raw_oxi_rs = round(gas_data.oxidising, 0)
    raw_nh3_rs = round(gas_data.nh3, 0)
    return raw_red_rs, raw_oxi_rs, raw_nh3_rs


red_r0, oxi_r0, nh3_r0 = read_raw_gas()

def linear (AQIHigh, AQILow, concHigh, concLow, concentration):
    return round(((concentration - concLow) / (concHigh - concLow)) * (AQIHigh - AQILow) + AQILow)

def AQIPM25(concentration):
    # EPA PM2.5 breakpoints as revised in 2024 (Good now ends at 9.0 ug/m3)
    c = (math.floor(10 * concentration)) / 10 

    if c >= 0 and c < 9.1:
        return linear(50, 0, 9.0, 0, c)
    elif c >= 9.1 and c < 35.5:
        return linear(100, 51, 35.4, 9.1, c)
    elif c >= 35.5 and c < 55.5: 
        return linear(150, 101, 55.4, 35.5, c)
    elif c >= 55.5 and c < 125.5:
        return linear(200, 151, 125.4, 55.5, c)
    elif c >= 125.5 and c < 225.5:
        return linear(300, 201, 225.4, 125.5, c)
    elif c >= 225.5 and c < 325.5:
        return linear(500, 301, 325.4, 225.5, c)
    else:
        return 500

def AQIRating(AQI):
    if AQI <= 50:
        return "Good"
    elif AQI > 50 and AQI <= 100:
        return "Moderate"
    elif AQI > 100 and AQI <= 150:
        return "Unhealthy for Sensitive Groups"
    elif AQI > 150 and AQI <= 200:
        return "Unhealthy"
    elif AQI > 200 and AQI <= 300:
        return "Very Unhealthy"
    elif AQI > 300 and AQI <= 500:
        return "Hazardous"
    else:
        return "Out of Range"

# Convert celsius to Fahrenheit
def celsius_to_fahrenheit(deg_celsius):
    return ((deg_celsius * 9)/5 + 32)

def adjusted_temperature(temp):
    #comp_temp = comp_temp_slope * raw_temp + comp_temp_intercept
    return (comp_temp_cub_a * math.pow(temp, 3) + comp_temp_cub_b * math.pow(temp, 2) +
                 comp_temp_cub_c * temp + comp_temp_cub_d)
    
def adjusted_humidity(humidity, raw_temp, adjusted_temp):
    # The sensor sits in air warmed by the Pi but with the same water content as outside,
    # so keep the dew point from the raw readings and recompute RH at the corrected temp.
    # The old quadratic ignored temperature and peaked above 100%.
    if humidity <= 0:
        return 0.0
    gamma = math.log(humidity / 100) + magnus_b * raw_temp / (magnus_c + raw_temp)
    comp_hum = 100 * math.exp(gamma - magnus_b * adjusted_temp / (magnus_c + adjusted_temp))
    return min(100.0, comp_hum)

def barometer_altitude_comp_factor(alt, temp):
    comp_factor = math.pow(1 - (0.0065 * alt/(temp + 0.0065 * alt + 273.15)), -5.257)
    return comp_factor

def adjusted_pressure(pressure, altitude, temp):
    return round(pressure * barometer_altitude_comp_factor(altitude, temp), 1)
    
def read_gas_in_ppm(gas_calib_temp, gas_calib_hum, gas_calib_bar, raw_temp, raw_hum, raw_barometer, gas_sensors_warm):
    if gas_sensors_warm:
        comp_red_rs, comp_oxi_rs, comp_nh3_rs, raw_red_rs, raw_oxi_rs, raw_nh3_rs = comp_gas(gas_calib_temp,
                                                                                             gas_calib_hum,
                                                                                             gas_calib_bar,
                                                                                             raw_temp,
                                                                                             raw_hum, raw_barometer)
        print("Reading Compensated Gas sensors after warmup completed")
    else:
        raw_red_rs, raw_oxi_rs, raw_nh3_rs = read_raw_gas()
        comp_red_rs = raw_red_rs
        comp_oxi_rs = raw_oxi_rs
        comp_nh3_rs = raw_nh3_rs
        print("Reading Raw Gas sensors before warmup completed")
    print("Red Rs:", round(comp_red_rs, 0), "Oxi Rs:", round(comp_oxi_rs, 0), "NH3 Rs:", round(comp_nh3_rs, 0))
    if comp_red_rs/red_r0 > 0:
        red_ratio = comp_red_rs/red_r0
    else:
        red_ratio = 0.0001
    if comp_oxi_rs/oxi_r0 > 0:
        oxi_ratio = comp_oxi_rs/oxi_r0
    else:
        oxi_ratio = 0.0001
    if comp_nh3_rs/nh3_r0 > 0:
        nh3_ratio = comp_nh3_rs/nh3_r0
    else:
        nh3_ratio = 0.0001
    red_in_ppm = math.pow(10, -1.25 * math.log10(red_ratio) + 0.64)
    oxi_in_ppm = math.pow(10, math.log10(oxi_ratio) - 0.8129)
    nh3_in_ppm = math.pow(10, -1.8 * math.log10(nh3_ratio) - 0.163)
    return red_in_ppm, oxi_in_ppm, nh3_in_ppm, comp_red_rs, comp_oxi_rs, comp_nh3_rs, raw_red_rs, raw_oxi_rs, raw_nh3_rs

def comp_gas(gas_calib_temp, gas_calib_hum, gas_calib_bar, raw_temp, raw_hum, raw_barometer):
    gas_data = gas.read_all()
    gas_temp_diff = raw_temp - gas_calib_temp
    gas_hum_diff = raw_hum - gas_calib_hum
    gas_bar_diff = raw_barometer - gas_calib_bar
    raw_red_rs = round(gas_data.reducing, 0)
    comp_red_rs = round(raw_red_rs - (red_temp_comp_factor * raw_red_rs * gas_temp_diff +
                                      red_hum_comp_factor * raw_red_rs * gas_hum_diff +
                                      red_bar_comp_factor * raw_red_rs * gas_bar_diff), 0)
    raw_oxi_rs = round(gas_data.oxidising, 0)
    comp_oxi_rs = round(raw_oxi_rs - (oxi_temp_comp_factor * raw_oxi_rs * gas_temp_diff +
                                      oxi_hum_comp_factor * raw_oxi_rs * gas_hum_diff +
                                      oxi_bar_comp_factor * raw_oxi_rs * gas_bar_diff), 0)
    raw_nh3_rs = round(gas_data.nh3, 0)
    comp_nh3_rs = round(raw_nh3_rs - (nh3_temp_comp_factor * raw_nh3_rs * gas_temp_diff +
                                      nh3_hum_comp_factor * raw_nh3_rs * gas_hum_diff +
                                      nh3_bar_comp_factor * raw_nh3_rs * gas_bar_diff), 0)
    print("Gas Compensation. Raw Red Rs:", raw_red_rs, "Comp Red Rs:", comp_red_rs, "Raw Oxi Rs:",
          raw_oxi_rs, "Comp Oxi Rs:", comp_oxi_rs,
          "Raw NH3 Rs:", raw_nh3_rs, "Comp NH3 Rs:", comp_nh3_rs)
    return comp_red_rs, comp_oxi_rs, comp_nh3_rs, raw_red_rs, raw_oxi_rs, raw_nh3_rs   



class EnviroReader:

    def __init__(self):
        try:
            # BME280 Temp / hPa sensor
            # Create sensor object, using the board's default I2C bus.
            i2c = board.I2C()   # uses board.SCL and board.SDA
            self.bme280 = adafruit_bme280.Adafruit_BME280_I2C(i2c)
            # change this to match the location's pressure (hPa) at sea level
            self.bme280.sea_level_pressure = 1013.25

        except ValueError as e:
            print(f"Caught ValueError: {e}")
            self.bme280 = types.SimpleNamespace(temperature=0, relative_humidity=0, altitude=0, pressure=0)

        # Configure the PMS5003
        self.pms5003 = PMS5003(
            device='/dev/ttyAMA0',
            baudrate=9600,
            pin_enable=22,
            pin_reset=27
        )

        gas.set_pwm_period(4096)
        gas.set_brightness(0.1)
        gas.set_led(1, 1, 1)

    def recalibrate(self):
        self.pms5003.reset()

    def read_data(self):
        pms5003_data = self.pms5003.read()
        pm25 = pms5003_data.pm_ug_per_m3(2.5)
        aqi = AQIPM25(pm25)
        aqi_label = AQIRating(aqi)
        temp_celcius = self.bme280.temperature
        humidity = self.bme280.relative_humidity
        adjusted_temp_celcius = adjusted_temperature(temp_celcius)
        _adjusted_humidity = adjusted_humidity(humidity, temp_celcius, adjusted_temp_celcius)
        altitude = station_altitude_m
        pressure = self.bme280.pressure
        # Use the real station elevation and ambient (corrected) temp; bme280.altitude is
        # derived from the measured pressure, so correcting with it just undoes itself
        _adjusted_pressure = adjusted_pressure(pressure, altitude, adjusted_temp_celcius)
        
        red_in_ppm, oxi_in_ppm, nh3_in_ppm, comp_red_rs, comp_oxi_rs, comp_nh3_rs, raw_red_rs, raw_oxi_rs, raw_nh3_rs = read_gas_in_ppm(adjusted_temp_celcius, _adjusted_humidity, _adjusted_pressure, temp_celcius, humidity, pressure, True)


        return {
            'temp_celcius': temp_celcius,
            'temp_fahrenheit': celsius_to_fahrenheit(temp_celcius),
            'adjusted_temp_celcius': adjusted_temp_celcius,
            'adjusted_temp_fahrenheit': celsius_to_fahrenheit(adjusted_temp_celcius),
            'humidity': humidity,
            'adjusted_humidity': _adjusted_humidity,
            'pressure': pressure,
            'adjusted_pressure': _adjusted_pressure,
            'altitude': altitude,
            'PM1.0':  pms5003_data.pm_ug_per_m3(1.0),
            'PM2.5': pm25,
            'PM10': pms5003_data.pm_ug_per_m3(10),
            'AQI': aqi,
            'AQI_LABEL': aqi_label,
            'red': red_in_ppm,
            'nh3': nh3_in_ppm,
            'oxi': oxi_in_ppm,
            'raw_oxiRS': raw_oxi_rs,
            'raw_redRS': raw_red_rs, 
            'raw_nh3RS': raw_nh3_rs,
        }
