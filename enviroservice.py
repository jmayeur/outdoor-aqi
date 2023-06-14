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

# const sample time delay
sampleFrequencyDelay = 60

def close():
  print("Sampling stopped, terminating")

def main():
  global samplingEnbled
  global sampleFrequencyDelay
  start_time = time.time()
  ticks = 0

  # add a hook for TERM (15) and INT (2)
  signal.signal(signal.SIGTERM, _handle_signal)
  signal.signal(signal.SIGINT, _handle_signal)

  while samplingEnbled:
    try:

        if ticks == 30:
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

        time.sleep(sampleFrequencyDelay)

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