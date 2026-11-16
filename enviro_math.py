# Sensor corrections and AQI math, kept free of hardware imports so the
# collectors and the history recompute scripts share exactly the same formulas
import math

# Temperature calibration, fitted against KPDX hourly obs (37k hours, 2022-07 to 2026-10):
# PDX = 0.963 * raw - 1.22 C, residual sd 1.65 C. The old cubic subtracted ~8 C and read
# ~6.7 C colder than PDX; the sensor itself only runs ~1.8 C warm.
comp_temp_slope = 0.963
comp_temp_intercept = -1.22
# Then cool by the standard lapse rate for the station sitting above PDX (9 m)
pdx_altitude_m = 9.4
lapse_rate_c_per_m = 0.0065
# Magnus coefficients (Sonntag 1990) for dew point based humidity correction
magnus_b = 17.62
magnus_c = 243.12

# Station elevation for sea-level pressure correction (730 ft)
station_altitude_m = 222.5
temp_lapse_adjustment = lapse_rate_c_per_m * (station_altitude_m - pdx_altitude_m)

# Per-site calibration. corrected_C = temp_slope * raw_C + temp_intercept - temp_lapse;
# raw RH is multiplied by hum_scale before the dew point correction.
#   outdoor        Pi 3 outside, fitted to KPDX (above)
#   indoor_legacy  Pi Zero W indoors running the old aqi_monitor.py, whose constant LCD
#                  redraws heat the sensor more; used for history recorded before the
#                  collector port. PROVISIONAL: fitted against the ecobee "Jeff's Office"
#                  sensor next to it over 2026-11-08..15 only (raw 26-29 C, offset-only
#                  fit, residual sd 0.27 C); to be refitted with a summer export.
#   indoor         the same Pi on indoor/indoor_monitor.py. PROVISIONAL copy of
#                  indoor_legacy until a few days of post-port ecobee data are fitted.
# Indoor altitude: raw pressure reads 0.81 hPa (sd 0.27) below the outdoor sensor over
# 721 shared hours, i.e. 6.8 m higher. Sea-level reduction should use outdoor air
# temperature, which the indoor Pi doesn't have; room temperature biased it ~-0.9 hPa
# against the outdoor Pi in winter, so indoors reduces with the ISA 15 C instead
# (slp_temp_c; None means use the corrected sensor temperature).
SITES = {
    'outdoor': {'temp_slope': comp_temp_slope, 'temp_intercept': comp_temp_intercept,
                'temp_lapse': temp_lapse_adjustment, 'hum_scale': 1.0,
                'altitude_m': station_altitude_m, 'slp_temp_c': None},
    'indoor_legacy': {'temp_slope': 1.0, 'temp_intercept': -7.46, 'temp_lapse': 0.0,
                      'hum_scale': 1.0, 'altitude_m': 229.3, 'slp_temp_c': 15.0},
    'indoor': {'temp_slope': 1.0, 'temp_intercept': -7.46, 'temp_lapse': 0.0,
               'hum_scale': 1.0, 'altitude_m': 229.3, 'slp_temp_c': 15.0},
}

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

def fahrenheit_to_celsius(deg_fahrenheit):
    return (deg_fahrenheit - 32) * 5 / 9

def adjusted_temperature(temp, site='outdoor'):
    cal = SITES[site]
    return cal['temp_slope'] * temp + cal['temp_intercept'] - cal['temp_lapse']

def adjusted_humidity(humidity, raw_temp, adjusted_temp, site='outdoor'):
    # The sensor sits in air warmed by the Pi but with the same water content as outside,
    # so keep the dew point from the raw readings and recompute RH at the corrected temp.
    # The old quadratic ignored temperature and peaked above 100%.
    if humidity <= 0:
        return 0.0
    humidity = min(100.0, humidity * SITES[site]['hum_scale'])
    gamma = math.log(humidity / 100) + magnus_b * raw_temp / (magnus_c + raw_temp)
    comp_hum = 100 * math.exp(gamma - magnus_b * adjusted_temp / (magnus_c + adjusted_temp))
    return min(100.0, comp_hum)

def barometer_altitude_comp_factor(alt, temp):
    comp_factor = math.pow(1 - (0.0065 * alt/(temp + 0.0065 * alt + 273.15)), -5.257)
    return comp_factor

def adjusted_pressure(pressure, altitude, temp):
    return round(pressure * barometer_altitude_comp_factor(altitude, temp), 1)

def sea_level_pressure(pressure, adjusted_temp, site='outdoor'):
    cal = SITES[site]
    temp = adjusted_temp if cal['slp_temp_c'] is None else cal['slp_temp_c']
    return adjusted_pressure(pressure, cal['altitude_m'], temp)
