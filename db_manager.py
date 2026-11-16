import sqlite3
import time


class DbManager:

    def __init__(self, path='./environment'):
        self.path = path

    def writeToDB(self, run_time, p1, p25, p10, raw_temp, comp_temp, comp_hum,
                        raw_hum, raw_barometer, comp_barameter, oxi, red, nh3,
                        raw_oxi_rs, raw_red_rs, raw_nh3_rs):

        def rnd(value, digits):
            return None if value is None else round(value, digits)

        # Parameters rather than string substitution, so a missing reading is stored as NULL
        row = (round(time.time(), 0), run_time, rnd(raw_temp, 2), rnd(comp_temp, 2), rnd(raw_hum, 2),
               rnd(comp_hum, 2), rnd(raw_barometer, 1), rnd(comp_barameter, 1), oxi, red, nh3,
               raw_oxi_rs, raw_red_rs, raw_nh3_rs, p1, p10, p25)
        try:
            conn = sqlite3.connect(self.path)
            conn.execute("""
                INSERT INTO envdata (time, run_time, raw_temp, output_temp, raw_humidity, output_humidity, raw_bar,
                    output_bar, oxi, red, nh3, raw_oxiRS, raw_redRS, raw_nh3RS, p1, P10, P25)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", row)
            conn.commit()
            conn.close()
        except sqlite3.Error as e:
            print("An error occurred:", e.args[0])
