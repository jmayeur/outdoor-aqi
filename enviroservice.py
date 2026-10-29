import time
import signal
import enviro_reader
import db_manager
import time
from pms5003 import ChecksumMismatchError
enviroReader = enviro_reader.EnviroReader()
dbManager = db_manager.DbManager()

# continue sampling
samplingEnbled = True

# seconds of PMS5003 frames averaged into each sample; the read itself paces the
# loop at roughly one sample per minute
pmWindowSecs = 55

def close():
  print("Sampling stopped, terminating")

def main():
  global samplingEnbled
  global pmWindowSecs
  start_time = time.time()

  # add a hook for TERM (15) and INT (2)
  signal.signal(signal.SIGTERM, _handle_signal)
  signal.signal(signal.SIGINT, _handle_signal)

  while samplingEnbled:
    try:

        # The PMS5003 is only reset on checksum errors; a scheduled reset made the
        # first frame after it (the least settled one) the stored reading
        print("Reading Data")
        enviro_data = enviroReader.read_data(pmWindowSecs)
        run_time = round((time.time() - start_time), 0)

        dbManager.writeToDB(run_time, enviro_data['PM1.0'], enviro_data['PM2.5'], enviro_data['PM10'], enviro_data['temp_fahrenheit'],
            enviro_data['adjusted_temp_fahrenheit'], enviro_data['adjusted_humidity'], enviro_data['humidity'], enviro_data['pressure'],
            enviro_data['adjusted_pressure'], enviro_data['oxi'], enviro_data['red'], enviro_data['nh3'], enviro_data['raw_oxiRS'],
            enviro_data['raw_redRS'], enviro_data['raw_nh3RS'])

    except ChecksumMismatchError as cme: 
        print('Checksum Error', cme)
        print('Recalibrating')
        enviroReader.recalibrate()
        continue

    except KeyboardInterrupt:
        pass
    

# when receiving a signal ...
def _handle_signal(signal, frame):
  global samplingEnbled
  samplingEnbled = False
  close()

if __name__ == '__main__':
  main()
