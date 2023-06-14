import enviro_reader
import db_manager
import time
from pms5003 import ChecksumMismatchError
enviroReader = enviro_reader.EnviroReader()
dbManager = db_manager.DbManager()

start_time = time.time()
# sleep seconds
sleep = 60
ticks = 0
 
try:
    while True:
        if ticks == 5:
            print('Recalibrating')
            enviroReader.recalibrate()
            ticks = 0

        print("Reading Data")
        ticks = ticks + 1
        enviro_data = enviroReader.read_data();
        run_time = round((time.time() - start_time), 0)

        dbManager.writeToDB(run_time, enviro_data['PM1.0'], enviro_data['PM2.5'], enviro_data['PM10'], enviro_data['temp_fahrenheit'],
            enviro_data['adjusted_temp_fahrenheit'], enviro_data['adjusted_humidity'], enviro_data['humidity'], enviro_data['pressure'],
            enviro_data['adjusted_pressure'], enviro_data['oxi'], enviro_data['red'], enviro_data['nh3'], enviro_data['raw_oxiRS'],
            enviro_data['raw_redRS'], enviro_data['raw_nh3RS'])

        time.sleep(sleep)

except ChecksumMismatchError as cme: 
    print('Checksum Error, trying recalibration', cme)
    ticks = 5

except KeyboardInterrupt:
    pass