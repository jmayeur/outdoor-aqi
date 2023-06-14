import enviro_reader
import time

enviroReader = enviro_reader.EnviroReader()

try:
    while True:
        enviro_data = enviroReader.read_data();
        print("\nTemperature: %0.1f C" % enviro_data['temp_celcius'])
        print("Humidity: %0.1f %%" % enviro_data['humidity'])
        print("Pressure: %0.1f hPa" % enviro_data['pressure'])
        print("Altitude = %0.2f meters" % enviro_data['altitude'])
    
        print("AQI (PM2.5 %f" % enviro_data['AQI'])
        print("AQI Rating %s" % enviro_data['AQI_LABEL'])

        print("PM1.0 ug/m3 (ultrafine particles): %x" % enviro_data['PM1.0'])
        print("PM10 ug/m3  (dust, pollen, mould spores): %x" % enviro_data['PM10'])

        time.sleep(2)

except KeyboardInterrupt:
    pass