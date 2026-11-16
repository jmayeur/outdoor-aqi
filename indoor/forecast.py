# Barometric forecast from sea-level pressure and its 3-hour change, ported branch for
# branch from aqi_monitor.py (after R. J. Ellis, worldstormcentral.co "secret law of storms").
# The thresholds assume sea-level pressure; the old script fed it station pressure
# corrected for only 23 m, so it read ~992 hPa and always landed in the < 1009 branch.


def trend_symbol(change):
    if -1.1 < change < 1.1:
        return '-'
    if -4 < change <= -1.1:
        return '<'
    if -10 < change <= -4:
        return '<<'
    if change <= -10:
        return '<!'
    if 1.1 <= change < 6:
        return '>'
    if 6 <= change < 10:
        return '>>'
    return '>!'


def forecast(p, c):
    """Returns (text, icon name) for sea-level pressure p (hPa) and its 3-hour change c."""
    if p < 1009:
        if -1.1 < c < 6:
            return 'Clearing and Colder', 'Fair'
        if 6 <= c < 10:
            return 'Strong Wind Warning', 'Windy'
        if c >= 10:
            return 'Gale Warning', 'Gale'
        if -4 <= c <= -1.1:
            return 'Rain and Wind', 'Rain'
        if -10 < c < -4:
            return 'Storm', 'Storm'
        return 'Storm and Gale', 'Gale'
    if p <= 1018:
        if -4 < c < 1.1:
            return 'No Change', 'Stable'
        if 1.1 <= c <= 6 and p <= 1015:
            return 'No Change', 'Stable'
        if 1.1 <= c <= 6 and p > 1015:
            return 'Poorer Weather', 'Poorer'
        if 6 <= c < 10:
            return 'Strong Wind Warning', 'Windy'
        if c >= 10:
            return 'Gale Warning', 'Gale'
        return 'Rain and Wind', 'Rain'
    if p <= 1023:
        if 0 < c < 1.1:
            return 'No Change', 'Stable'
        if 1.1 <= c < 6:
            return 'Poorer Weather', 'Poorer'
        if 6 <= c < 10:
            return 'Strong Wind Warning', 'Windy'
        if c >= 10:
            return 'Gale Warning', 'Gale'
        if -1.1 < c <= 0:
            return 'Fair Weather with\nSlight Temp Change', 'Fair'
        if -4 < c <= -1.1:
            return 'No Change but\nRain in 24 Hours', 'Stable'
        return 'Rain, Wind and\n Higher Temp', 'Rain'
    if 0 < c < 1.1:
        return 'Fair Weather', 'Fair'
    if -1.1 < c <= 0:
        return 'Fair Weather with\nLittle Temp Change', 'Fair'
    if 1.1 <= c < 6:
        return 'Poorer Weather', 'Poorer'
    if 6 <= c < 10:
        return 'Strong Wind Warning', 'Windy'
    if c >= 10:
        return 'Gale Warning', 'Gale'
    if -4 < c <= -1.1:
        return 'Fair Weather and\nSlowly Rising Temp', 'Fair'
    return 'Warming Trend', 'Fair'
