import sqlite3
import time
from string import Template

class DbManager:
    
    def writeToDB(self, run_time, p1, p25, p10, raw_temp, comp_temp, comp_hum,
                        raw_hum, raw_barometer, comp_barameter, oxi, red, nh3, 
                        raw_oxi_rs, raw_red_rs, raw_nh3_rs):
 
        raw_temp = round(raw_temp, 2)
        raw_hum = round(raw_hum, 2)
        comp_temp = round(comp_temp, 2)
        comp_hum = round(comp_hum, 2)
        raw_barometer = round(raw_barometer, 1)
        comp_barameter = round(comp_barameter, 1)
        time_stamp = round(time.time(), 0)

        sqlTemplate = Template("""
        INSERT INTO envdata (time, run_time, raw_temp, output_temp, raw_humidity, output_humidity, raw_bar,
            output_bar, oxi, red, nh3, raw_oxiRS, raw_redRS, raw_nh3RS, p1, P10, P25)
        VALUES ($timestamp, $run_time, $raw_temp, $output_temp, $raw_humidity, $output_humidity, $raw_bar,
            $output_bar, $oxi, $red, $nh3, $raw_oxiRS, $raw_redRS, $raw_nh3RS, $p1, $P10, $P25);
        """)
        sql = sqlTemplate.substitute(timestamp=time_stamp, run_time=run_time, raw_temp=raw_temp, output_temp=comp_temp,
            raw_humidity=raw_hum, output_humidity=comp_hum, raw_bar=raw_barometer, output_bar=comp_barameter, oxi=oxi, 
                red=red, nh3=nh3, raw_oxiRS=raw_oxi_rs, raw_redRS=raw_red_rs, raw_nh3RS=raw_nh3_rs, p1=p1, P10=p10, P25=p25)

        try:
            conn = sqlite3.connect('./environment')
            c = conn.cursor()
            c.execute(sql)
            conn.commit()
            conn.close()
        except sqlite3.Error as e:
                print("An error occurred:", e.args[0])