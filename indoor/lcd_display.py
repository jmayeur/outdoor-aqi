# Screens for the Enviro+ 0.96" ST7735 LCD, ported from aqi_monitor.py.
# Rendering is done only when the caller asks (new sample, minute tick or a tap) instead
# of on every loop pass, and fonts and icons are loaded once.
import colorsys
import os
from datetime import timedelta

from PIL import Image, ImageDraw, ImageFont, ImageFilter
from fonts.ttf import RobotoMedium as UserFont
from astral import LocationInfo
from astral.sun import sun

ICON_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'icons')

# {name: [units, [level thresholds], position on the All Air screen]}
AQ_ITEMS = {
    'P1': ['ug/m3', [6, 17, 27, 35], 0], 'P2.5': ['ug/m3', [11, 35, 53, 70], 1],
    'P10': ['ug/m3', [16, 50, 75, 100], 2], 'Oxi': ['ppm', [0.2, 0.4, 0.8, 1], 3],
    'Red': ['ppm', [6, 10, 50, 75], 4], 'NH3': ['ppm', [1, 2, 10, 15], 5],
}
AQ_NO_GAS = ['P1', 'P2.5', 'P10']
AQ_LEVELS = ['Great', 'OK', 'Alert', 'Poor', 'Bad']
PALETTE = [(128, 128, 255), (0, 255, 0), (255, 255, 0), (255, 165, 0), (255, 0, 0)]
BACKGROUND_HUE = [240, 120, 60, 39, 0]
SCREENS = ['Icon Weather', 'All Air', 'Forecast']

BLUR = 5
OPACITY = 255
SUN_RADIUS = 20
MARGIN = 3


def level_of(name, value):
    level = 0
    if value is None:
        return level
    for i, limit in enumerate(AQ_ITEMS[name][1]):
        if value > limit:
            level = i + 1
    return level


def max_aqi(values, gas_warm):
    """Returns (factor, level) for the worst air quality item, as on the old icon screen."""
    worst = ('All', 0)
    for name in (AQ_ITEMS if gas_warm else AQ_NO_GAS):
        level = level_of(name, values.get(name))
        if level > worst[1]:
            worst = (name, level)
    return worst


def describe_humidity(humidity):
    if 30 < humidity <= 75:
        return 'good'
    return 'wet' if humidity > 75 else 'dry'


class Display:

    def __init__(self, disp, location):
        """disp: an initialised ST7735; location: astral LocationInfo."""
        self.disp = disp
        self.width = disp.width
        self.height = disp.height
        self.location = location
        self.font_sm = ImageFont.truetype(UserFont, 12)
        self.font_smm = ImageFont.truetype(UserFont, 14)
        self.font_medium = ImageFont.truetype(UserFont, 16)
        self.font_ml = ImageFont.truetype(UserFont, 18)
        self.icons = {}
        for name in os.listdir(ICON_DIR):
            if name.endswith('.png') and not name.startswith('.'):
                self.icons[name[:-4]] = Image.open(os.path.join(ICON_DIR, name)).convert('RGBA')
        self._sun_cache = {}

    # --- helpers -----------------------------------------------------------------------

    def _sun_times(self, day):
        if day not in self._sun_cache:
            self._sun_cache = {d: v for d, v in self._sun_cache.items() if d >= day - timedelta(1)}
            self._sun_cache[day] = sun(self.location.observer, date=day, tzinfo=self.location.tzinfo)
        return self._sun_cache[day]

    def _sun_progress(self, local_dt):
        today = local_dt.date()
        s_yesterday = self._sun_times(today - timedelta(1))
        s_today = self._sun_times(today)
        s_tomorrow = self._sun_times(today + timedelta(1))
        if s_today['sunrise'] < local_dt < s_today['sunset']:
            day, start, end = True, s_today['sunrise'], s_today['sunset']
        elif local_dt > s_today['sunset']:
            day, start, end = False, s_today['sunset'], s_tomorrow['sunrise']
        else:
            day, start, end = False, s_yesterday['sunset'], s_today['sunrise']
        return (local_dt - start).total_seconds(), (end - start).total_seconds(), day

    def _background(self, progress, period, day, aqi_level):
        x = int((progress / period) * self.width)
        if day:
            x = self.width - x
        centre = 80
        y = int(1 / centre * (x - centre) ** 2 + SUN_RADIUS)
        val = 0.8 - 0.6 * (abs(centre - x) / (2 * centre))
        if not day:
            val = 1 - val
        r, g, b = [int(c * 255) for c in colorsys.hsv_to_rgb(BACKGROUND_HUE[aqi_level] / 360, 1.0, val)]
        img = Image.new('RGBA', (self.width, self.height), color=(r, g, b))
        if day:
            overlay = Image.new('RGBA', (self.width, self.height), color=(0, 0, 0, 0))
            # red sun when the background is yellow or orange, so it still stands out
            fill = (180, 0, 0, OPACITY) if aqi_level in (2, 3) else (180, 180, 0, OPACITY)
            ImageDraw.Draw(overlay).ellipse((x - SUN_RADIUS, y - SUN_RADIUS, x + SUN_RADIUS, y + SUN_RADIUS),
                                            fill=fill, outline=(0, 0, 0))
            img = Image.alpha_composite(img, overlay)
        return img.filter(ImageFilter.GaussianBlur(radius=BLUR))

    def _text(self, img, position, text, font, align_right=False, rectangle=False):
        w, h = font.getsize(text)
        x, y = position
        if align_right:
            x -= w
        if rectangle:
            x += 1
            y += 1
            layer = Image.new('RGBA', (self.width, self.height), color=(0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)
            draw.rectangle((x - 1, y, x + w, y + h + 1), (255, 255, 255))
            draw.text((x, y), text, font=font, fill=(0, 0, 0, 0))
            return Image.alpha_composite(img, layer)
        ImageDraw.Draw(img).text((x, y), text, font=font, fill=(255, 255, 255))
        return img

    def _paste_icon(self, img, name, position):
        icon = self.icons.get(name)
        if icon is not None:
            img.paste(icon, position, mask=icon)

    def _centered_message(self, message, back_colour=(0, 0, 0)):
        img = Image.new('RGB', (self.width, self.height), color=back_colour)
        draw = ImageDraw.Draw(img)
        size_x, size_y = draw.textsize(message, self.font_medium)
        draw.text(((self.width - size_x) / 2, (self.height / 2) - (size_y / 2)), message,
                  font=self.font_medium, fill=(255, 255, 255))
        self.disp.display(img)

    # --- screens -----------------------------------------------------------------------

    def show_message(self, message, error=False):
        self._centered_message(message, (85, 15, 15) if error else (0, 0, 0))

    def show(self, screen, view):
        if screen == 'All Air':
            self.all_air(view)
        elif screen == 'Forecast':
            self.forecast(view)
        else:
            self.icon_weather(view)

    def icon_weather(self, v):
        local_dt = v['local_dt']
        progress, period, day = self._sun_progress(local_dt)
        factor, level = max_aqi(v['aq'], v['gas_warm'])
        img = self._background(progress, period, day, level)
        img = self._text(img, (MARGIN, MARGIN), local_dt.strftime('%H:%M') + '  IN', self.font_smm)
        img = self._text(img, (self.width - MARGIN, MARGIN), local_dt.strftime('%d %b %y').lstrip('0'),
                         self.font_smm, align_right=True)
        # temperature and 24 h range
        if v['temp_f'] is not None:
            temp_string = f"{v['temp_f']:.0f}°F"
            img = self._text(img, (68, 18), temp_string, self.font_smm, align_right=True)
            spacing = self.font_smm.getsize(temp_string)[1] + 1
            if v['temp_min'] is not None and v['temp_max'] is not None:
                range_string = f"{v['temp_min']:.0f}-{v['temp_max']:.0f}"
            else:
                range_string = '------'
            img = self._text(img, (68, 18 + spacing), range_string, self.font_sm, align_right=True, rectangle=True)
        self._paste_icon(img, 'temperature', (MARGIN, 18))
        # humidity
        if v['hum'] is not None:
            humidity_string = f"{v['hum']:.0f}%"
            img = self._text(img, (68, 48), humidity_string, self.font_smm, align_right=True)
            spacing = self.font_smm.getsize(humidity_string)[1] + 1
            desc = describe_humidity(v['hum'])
            img = self._text(img, (68, 48 + spacing), desc.upper(), self.font_sm, align_right=True, rectangle=True)
            self._paste_icon(img, 'humidity-' + desc, (MARGIN, 48))
        # air quality
        aqi_string = f'{level}: {factor}'
        img = self._text(img, (self.width - MARGIN, 18), aqi_string, self.font_smm, align_right=True)
        spacing = self.font_smm.getsize(aqi_string)[1] + 1
        img = self._text(img, (self.width - MARGIN - 1, 18 + spacing), AQ_LEVELS[level].upper(), self.font_sm,
                         align_right=True, rectangle=True)
        self._paste_icon(img, 'aqi', (80, 18))
        # pressure and forecast
        if v['bar'] is not None:
            pressure_string = f"{int(v['bar'])} {v['trend']}"
            img = self._text(img, (self.width - MARGIN, 48), pressure_string, self.font_smm, align_right=True)
            spacing = self.font_smm.getsize(pressure_string)[1] + 1
            icon = v['icon_forecast']
            img = self._text(img, (self.width - MARGIN - 1, 48 + spacing), icon.upper(), self.font_sm,
                             align_right=True, rectangle=True)
            self._paste_icon(img, 'weather-' + icon.lower(), (80, 48))
        self.disp.display(img.convert('RGB'))

    def all_air(self, v):
        img = Image.new('RGB', (self.width, self.height), color=(0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.text((2, 2), 'IN AIR QUALITY', font=self.font_ml, fill=(255, 255, 255))
        column_count = 2
        row_count = round(len(AQ_ITEMS) / column_count, 0)
        for name, (_, _, position) in AQ_ITEMS.items():
            value = v['aq'].get(name)
            column = int(position / row_count)
            row = position % row_count
            x = 2 + (self.width / column_count) * column
            y = 2 + (self.height / (row_count + 1) * (row + 1))
            if value is None:
                message = f'{name}: --'
            elif name == 'Oxi':
                message = f'{name}: {value:.2f}'
            else:
                message = f'{name}: {round(value, 0):.0f}'
            draw.text((x, y), message, font=self.font_ml, fill=PALETTE[level_of(name, value)])
        self.disp.display(img)

    def forecast(self, v):
        if v['bar'] is not None and v['bar_change'] is not None:
            message = 'Barometer {:.0f} hPa\n3Hr Change {:.0f} hPa\n{}'.format(
                round(v['bar'], 0), round(v['bar_change'], 0), v['forecast'])
        else:
            message = 'WEATHER FORECAST\nWaiting for 3 hours\nof pressure data'
        self._centered_message(message)


def make_location(name, region, timezone, latitude, longitude):
    return LocationInfo(name, region, timezone, latitude, longitude)
