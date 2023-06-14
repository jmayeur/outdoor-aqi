#!/usr/bin/env python
from pms5003 import PMS5003
import board
import time
import math
from adafruit_bme280 import basic as adafruit_bme280

# Create sensor object, using the board's default I2C bus.
i2c = board.I2C()   # uses board.SCL and board.SDA
bme280 = adafruit_bme280.Adafruit_BME280_I2C(i2c)

# change this to match the location's pressure (hPa) at sea level
bme280.sea_level_pressure = 1013.25

# Configure the PMS5003 for Enviro+
pms5003 = PMS5003(
    device='/dev/ttyAMA0',
    baudrate=9600,
    pin_enable=22,
    pin_reset=27
)

def linear (AQIHigh, AQILow, concHigh, concLow, concentration):
    return round(((concentration - concLow) / (concHigh - concLow)) * (AQIHigh - AQILow) + AQILow)

def AQIPM25(concentration):
    c = (math.floor(10 * concentration)) / 10 

    if c >= 0 and c < 12.1:
        return linear(50, 0, 12, 0, c)
    elif c >= 12.1 and c < 35.5:
        return linear(100, 51, 35.4, 12.1, c)
    elif c >= 35.5 and c < 55.5: 
        return linear(150, 101, 55.4, 35.5, c)
    elif c >= 55.5 and c < 150.5:
        return linear(200, 151, 150.4, 55.5, c)
    elif c >= 150.5 and c < 250.5:
        return linear(300, 201, 250.4, 150.5, c)
    elif c >= 250.5 and c < 350.5:
        return linear(400, 301, 350.4, 250.5, c)
    elif c >= 350.5 and c < 500.5:
        return linear(500, 401, 500.4, 350.5, c)
    else:
        return 0.0

def AQIRating(AQI):
    if AQI <= 50:
        return "Good"
    elif AQI > 50 and AQI <= 100:
        return "Moderate"
    elif AQI > 100 and AQI <= 150:
        return "Unhealthy for Sensitive Groups"
    elif AQI > 150 and AQI <= 200:
        "Unhealthy"
    elif AQI > 200 and AQI <= 300:
        return "Very Unhealthy"
    elif AQI > 300 and AQI <= 400:
        return "Hazardous"
    elif AQI > 400 and AQI <= 500:
        return "Hazardous"
    else:
        return "Out of Range"

try:
    while True:
        print("\nTemperature: %0.1f C" % bme280.temperature)
        print("Humidity: %0.1f %%" % bme280.relative_humidity)
        print("Pressure: %0.1f hPa" % bme280.pressure)
        print("Altitude = %0.2f meters" % bme280.altitude)
        data = pms5003.read()
        ppm = data.pm_ug_per_m3(2.5)
        aqi = AQIPM25(ppm)
        aqi_label = AQIRating(aqi)
        print("AQI (PM2.5 %f" % aqi)
        print("AQI Rating %s" % aqi_label)

        print("PM1.0 ug/m3 (ultrafine particles): %x" % data.pm_ug_per_m3(1.0))
        #print("PM2.5 ug/m3 (combustion particles, organic compounds, metals): %x" % data.pm_ug_per_m3(2.5))
        print("PM10 ug/m3  (dust, pollen, mould spores): %x" % data.pm_ug_per_m3(10))

        time.sleep(2)

except KeyboardInterrupt:
    pass


