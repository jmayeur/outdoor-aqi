# Sensor corrections and AQI math, kept free of hardware imports so the
# collector and recompute_history.py share exactly the same formulas
import math

temp_offset = 0
comp_temp_cub_a = 0.00033
comp_temp_cub_b = -0.03129
comp_temp_cub_c = 1.8736
comp_temp_cub_d = -14.82131
comp_temp_cub_d = comp_temp_cub_d + temp_offset
# Magnus coefficients (Sonntag 1990) for dew point based humidity correction
magnus_b = 17.62
magnus_c = 243.12

# Station elevation for sea-level pressure correction (730 ft)
station_altitude_m = 222.5

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
