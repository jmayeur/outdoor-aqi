/**
 * years.js — year-over-year views built from /daily-aq-data.json
 *
 *  1. Calendar heatmap: one row of day cells per year
 *  2. One year against the range of the other years (7-day averages by date)
 *  3. AQI category days per year
 *  4. Almanac table of yearly extremes and counts
 */
(() => {
    const HOSTS = ['localhost', '127.0.0.1'].includes(location.hostname)
        ? { outdoor: 'http://localhost:3001', indoor: 'http://localhost:3002' }   // local testing
        : { outdoor: 'http://192.168.119.137', indoor: 'http://192.168.119.220' };

    const MIN_HOURS = 18;                       // EPA's 75% completeness rule for a daily value
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DAY_MS = 86400000;

    // ── AQI (matches enviro_math.AQIPM25, EPA 2024 breakpoints) ─────────────────
    const AQI_BREAKS = [[0, 9.0, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
        [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]];
    const pm25ToAqi = (pm) => {
        const c = Math.floor(10 * pm) / 10;
        for (const [cl, ch, al, ah] of AQI_BREAKS) {
            if (c <= ch) return Math.round(((ah - al) / (ch - cl)) * (Math.max(c, cl) - cl) + al);
        }
        return 500;
    };
    const AQI_CATS = [
        { key: 'good', label: 'Good', max: 50, color: '#3fb950', ink: '#0b0b0b' },
        { key: 'mod', label: 'Moderate', max: 100, color: '#e3b341', ink: '#0b0b0b' },
        { key: 'usg', label: 'Unhealthy for sensitive groups', short: 'USG', max: 150, color: '#f0883e', ink: '#0b0b0b' },
        { key: 'unh', label: 'Unhealthy', max: 200, color: '#f85149', ink: '#ffffff' },
        { key: 'vun', label: 'Very unhealthy', max: 300, color: '#a371f7', ink: '#ffffff' },
        { key: 'haz', label: 'Hazardous', max: Infinity, color: '#b0365a', ink: '#ffffff' },
    ];
    const NO_DATA = { key: 'none', label: 'No data', color: '#2a2e44', ink: '#94a3b8' };
    const aqiCat = (aqi) => AQI_CATS.find((c) => aqi <= c.max);

    // ── Data ────────────────────────────────────────────────────────────────────
    const parseDays = (payload) => payload.rows.map((r) => {
        const o = Object.fromEntries(payload.fields.map((f, i) => [f, r[i]]));
        const [y, m, d] = o.day.split('-').map(Number);
        o.y = y; o.m = m; o.d = d;
        o.t = Date.UTC(y, m - 1, d);
        o.slot = (Date.UTC(2024, m - 1, d) - Date.UTC(2024, 0, 1)) / DAY_MS;  // day of a leap year, 0-365
        o.complete = o.hours >= MIN_HOURS;
        o.aqi = o.pavg == null ? null : pm25ToAqi(o.pavg);
        o.cat = o.aqi == null ? null : aqiCat(o.aqi);
        return o;
    });

    const fmtDay = (o) => `${MONTHS[o.m - 1]} ${o.d}, ${o.y}`;
    const fmtSlot = (slot) => { const dt = new Date(Date.UTC(2024, 0, 1) + slot * DAY_MS); return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`; };
    const slotOfMonth = (mi) => (Date.UTC(2024, mi, 1) - Date.UTC(2024, 0, 1)) / DAY_MS;

    // ── Metrics ─────────────────────────────────────────────────────────────────
    const METRICS = {
        aqi: { label: 'Air quality', unit: '', field: 'pavg', fmt: (v) => `${pm25ToAqi(v)} AQI`, sub: (v) => `${v.toFixed(1)} µg/m³ PM2.5` },
        tmax: { label: 'High', unit: '°F', field: 'tmax', fmt: (v) => `${v.toFixed(0)}°F` },
        tmin: { label: 'Low', unit: '°F', field: 'tmin', fmt: (v) => `${v.toFixed(0)}°F` },
        tavg: { label: 'Mean', unit: '°F', field: 'tavg', fmt: (v) => `${v.toFixed(0)}°F` },
        havg: { label: 'Humidity', unit: '%', field: 'havg', fmt: (v) => `${v.toFixed(0)}%` },
        pm: { label: 'PM2.5', unit: 'µg/m³', field: 'pavg', fmt: (v) => `${v.toFixed(1)} µg/m³`, log: true },
    };
    const CAL_METRICS = ['aqi', 'tmax', 'tmin', 'havg'];
    const BAND_METRICS = ['tmax', 'tmin', 'havg', 'pm'];

    // ── State ───────────────────────────────────────────────────────────────────
    const state = { sensor: SensorState.read(), days: [], calMetric: 'aqi', bandMetric: 'tmax', bandYear: null };
    const cache = {};

    // ── Tooltip ─────────────────────────────────────────────────────────────────
    const tip = document.getElementById('tip');
    const showTip = (event, title, rows) => {
        tip.replaceChildren();
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = title;
        tip.append(t);
        rows.forEach(({ value, label, color, swatch }) => {
            const row = document.createElement('div');
            row.className = 'row';
            if (color) {
                const k = document.createElement('span');
                k.className = swatch ? 'sw' : 'ln';
                k.style.cssText = swatch ? `display:inline-block;width:10px;height:10px;border-radius:2px;background:${color}` : `border-color:${color}`;
                row.append(k);
            }
            const v = document.createElement('span');
            v.className = 'v';
            v.textContent = value;
            row.append(v);
            if (label) {
                const l = document.createElement('span');
                l.textContent = label;
                row.append(l);
            }
            tip.append(row);
        });
        tip.style.display = 'block';
        const pad = 14;
        const { width, height } = tip.getBoundingClientRect();
        let x = event.clientX + pad;
        let y = event.clientY + pad;
        if (x + width > window.innerWidth - 8) x = event.clientX - width - pad;
        if (y + height > window.innerHeight - 8) y = event.clientY - height - pad;
        tip.style.left = `${Math.max(8, x)}px`;
        tip.style.top = `${Math.max(8, y)}px`;
    };
    const hideTip = () => { tip.style.display = 'none'; };

    // ── Small DOM helpers ───────────────────────────────────────────────────────
    const el = (tag, props = {}, children = []) => {
        const n = Object.assign(document.createElement(tag), props);
        n.append(...children);
        return n;
    };
    const segButtons = (container, keys, labelOf, current, onPick) => {
        container.replaceChildren(...keys.map((k) => {
            const b = el('button', { type: 'button', textContent: labelOf(k) });
            b.setAttribute('aria-pressed', String(k === current));
            b.addEventListener('click', () => onPick(k));
            return b;
        }));
    };
    const legendSwatch = (color, label, line = false) => el('span', {}, [
        el('span', { className: line ? 'ln' : 'sw', style: line ? `border-color:${color}` : `background:${color}` }),
        label,
    ]);
    const widthOf = (svg) => Math.max(svg.parentElement.clientWidth, 0);

    // ── 1. Calendar heatmap ─────────────────────────────────────────────────────
    const calColor = (metric, days) => {
        if (metric === 'aqi') {
            return { color: (o) => o.cat.color, legend: () => AQI_CATS.map((c) => legendSwatch(c.color, c.label)) };
        }
        const vals = days.filter((o) => o.complete && o[metric] != null).map((o) => o[metric]).sort(d3.ascending);
        const lo = d3.quantile(vals, 0.02);
        const mid = d3.quantile(vals, 0.5);
        const hi = d3.quantile(vals, 0.98);
        const interp = metric === 'havg'
            ? d3.interpolateLab('#25304f', '#8cc0f5')
            : d3.piecewise(d3.interpolateLab, ['#4f90e0', '#363a4f', '#ef6f5e']);
        const scale = metric === 'havg'
            ? d3.scaleSequential([lo, hi], interp).clamp(true)
            : d3.scaleDiverging([lo, mid, hi], interp).clamp(true);
        const m = METRICS[metric];
        return {
            color: (o) => scale(o[metric]),
            legend: () => {
                const stops = d3.range(0, 1.01, 0.1).map((t) => interp(t)).join(',');
                return [el('span', {}, [m.fmt(lo), el('span', { className: 'grad', style: `background:linear-gradient(90deg,${stops})` }), m.fmt(hi)])];
            },
        };
    };

    const drawCalendar = () => {
        const svgEl = document.getElementById('calendar');
        const metric = state.calMetric;
        const days = state.days;
        const years = [...new Set(days.map((o) => o.y))].sort((a, b) => b - a);
        const byDay = new Map(days.map((o) => [o.day, o]));
        const first = days[0].t;
        const last = days[days.length - 1].t;

        const labelW = 44;
        const width = Math.max(widthOf(svgEl), 640);
        const cell = Math.max(8, Math.min(16, Math.floor((width - labelW) / 54)));
        const gap = cell >= 11 ? 2 : 1;
        const yearH = cell * 7 + 16;
        const top = 18;
        const height = top + years.length * yearH;

        const { color, legend } = calColor(metric, days);
        const svg = d3.select(svgEl).attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
        svg.selectAll('*').remove();

        // month labels, placed on the week that holds the 1st in a non-specific year
        const col = (t, y) => {
            const jan1 = Date.UTC(y, 0, 1);
            return Math.floor(((t - jan1) / DAY_MS + new Date(jan1).getUTCDay()) / 7);
        };
        const refYear = years[0];
        svg.append('g').selectAll('text').data(MONTHS).join('text')
            .attr('x', (_, i) => labelW + col(Date.UTC(refYear, i, 1), refYear) * cell)
            .attr('y', 11).text((d) => d);

        years.forEach((y, yi) => {
            const g = svg.append('g').attr('transform', `translate(${labelW},${top + yi * yearH})`);
            svg.append('text').attr('class', 'year-label').attr('x', 0).attr('y', top + yi * yearH + cell * 3.5 + 4).text(y);
            const cells = [];
            for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += DAY_MS) {
                if (t < first || t > last) continue;
                const key = new Date(t).toISOString().slice(0, 10);
                cells.push({ t, key, o: byDay.get(key) });
            }
            g.selectAll('rect').data(cells).join('rect')
                .attr('x', (c) => col(c.t, y) * cell)
                .attr('y', (c) => new Date(c.t).getUTCDay() * cell)
                .attr('width', cell - gap).attr('height', cell - gap).attr('rx', cell >= 11 ? 2 : 1)
                .attr('fill', (c) => (c.o && c.o.complete && c.o[METRICS[metric].field] != null ? color(c.o) : 'var(--empty)'))
                .on('pointerenter pointermove', (event, c) => {
                    d3.select(event.currentTarget).attr('stroke', '#e2e8f0').attr('stroke-width', 1);
                    const dt = new Date(c.t);
                    const title = `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()}`;
                    if (!c.o || !c.o.complete) {
                        return showTip(event, title, [{ value: c.o ? `${c.o.hours} h` : 'No data', label: c.o ? 'of data, incomplete' : '' }]);
                    }
                    const o = c.o;
                    const rows = metric === 'aqi'
                        ? [{ value: `${o.aqi}`, label: o.cat.label, color: o.cat.color, swatch: true }, { value: `${o.pavg.toFixed(1)}`, label: 'µg/m³ PM2.5 avg' }]
                        : [{ value: METRICS[metric].fmt(o[metric]), label: METRICS[metric].label.toLowerCase(), color: color(o), swatch: true }];
                    rows.push({ value: `${o.tmin.toFixed(0)}–${o.tmax.toFixed(0)}°F`, label: 'low–high' });
                    showTip(event, title, rows);
                })
                .on('pointerleave', (event) => { d3.select(event.currentTarget).attr('stroke', null); hideTip(); });
        });

        document.getElementById('cal-legend').replaceChildren(...legend(), legendSwatch('var(--empty)', 'No data'));
        document.getElementById('cal-hint').textContent = metric === 'aqi'
            ? 'Daily AQI from 24-hour average PM2.5. Weeks run down each column, Sunday at the top.'
            : `Daily ${METRICS[metric].label.toLowerCase()}. Colours stretch from the 2nd to the 98th percentile of all days.`;
    };

    // ── 2. One year against the others ──────────────────────────────────────────
    const smoothYears = (days, field) => {
        // {year: Float64Array(366) of centred 7-day means, NaN where too few days}
        const raw = d3.group(days.filter((o) => o.complete && o[field] != null), (o) => o.y);
        const out = new Map();
        raw.forEach((list, y) => {
            const arr = new Array(366).fill(NaN);
            list.forEach((o) => { arr[o.slot] = o[field]; });
            const sm = arr.map((_, i) => {
                const win = [];
                for (let k = i - 3; k <= i + 3; k++) if (k >= 0 && k < 366 && !Number.isNaN(arr[k])) win.push(arr[k]);
                return win.length >= 4 ? d3.mean(win) : NaN;
            });
            out.set(y, { smooth: sm, daily: arr });
        });
        return out;
    };

    const drawBand = () => {
        const svgEl = document.getElementById('band');
        const metric = state.bandMetric;
        const m = METRICS[metric];
        const series = smoothYears(state.days, m.field);
        const years = [...series.keys()].sort((a, b) => b - a);
        if (!years.includes(state.bandYear)) state.bandYear = years[0];
        const sel = state.bandYear;
        const others = years.filter((y) => y !== sel);

        const band = d3.range(366).map((i) => {
            const vals = others.map((y) => ({ y, v: series.get(y).smooth[i] })).filter((d) => !Number.isNaN(d.v));
            if (vals.length < 2) return null;
            const lo = d3.least(vals, (d) => d.v);
            const hi = d3.greatest(vals, (d) => d.v);
            return { i, lo: lo.v, loY: lo.y, hi: hi.v, hiY: hi.y, mid: d3.median(vals, (d) => d.v) };
        });
        const cur = series.get(sel).smooth.map((v, i) => ({ i, v }));

        const width = Math.max(widthOf(svgEl), 560);
        const height = 320;
        const mg = { l: 44, r: 52, t: 12, b: 26 };
        const floor = 0.3;
        const allVals = band.filter(Boolean).flatMap((b) => [b.lo, b.hi]).concat(cur.filter((d) => !Number.isNaN(d.v)).map((d) => d.v));
        const x = d3.scaleLinear([0, 365], [mg.l, width - mg.r]);
        const y = m.log
            ? d3.scaleLog([floor, Math.max(d3.max(allVals), 10)], [height - mg.b, mg.t]).clamp(true).nice()
            : d3.scaleLinear(d3.extent(allVals), [height - mg.b, mg.t]).nice();
        const yv = (v) => y(m.log ? Math.max(v, floor) : v);

        const svg = d3.select(svgEl).attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
        svg.selectAll('*').remove();

        // grid and axes
        const yTicks = m.log ? [0.3, 1, 3, 10, 30, 100, 300].filter((t) => t >= y.domain()[0] && t <= y.domain()[1]) : y.ticks(6);
        svg.append('g').selectAll('line').data(yTicks).join('line')
            .attr('x1', mg.l).attr('x2', width - mg.r).attr('y1', (t) => y(t)).attr('y2', (t) => y(t)).attr('stroke', 'var(--grid)');
        svg.append('g').selectAll('text').data(yTicks).join('text')
            .attr('x', mg.l - 6).attr('y', (t) => y(t) + 4).attr('text-anchor', 'end').text((t) => `${t}${m.unit === '°F' ? '°' : ''}`);
        svg.append('line').attr('x1', mg.l).attr('x2', width - mg.r).attr('y1', height - mg.b).attr('y2', height - mg.b).attr('stroke', 'var(--axis)');
        svg.append('g').selectAll('text').data(MONTHS).join('text')
            .attr('x', (_, i) => x(slotOfMonth(i)) + 2).attr('y', height - 8).text((d) => d);
        svg.append('g').selectAll('line').data(MONTHS.slice(1)).join('line')
            .attr('x1', (_, i) => x(slotOfMonth(i + 1))).attr('x2', (_, i) => x(slotOfMonth(i + 1)))
            .attr('y1', height - mg.b).attr('y2', height - mg.b + 4).attr('stroke', 'var(--axis)');

        // band, middle line, selected year
        const defined = (d) => d && !Number.isNaN(d.lo);
        svg.append('path').datum(band)
            .attr('fill', 'rgba(148,163,184,0.16)')
            .attr('d', d3.area().defined(defined).x((d) => x(d.i)).y0((d) => yv(d.lo)).y1((d) => yv(d.hi)).curve(d3.curveMonotoneX));
        svg.append('path').datum(band)
            .attr('fill', 'none').attr('stroke', '#7c8799').attr('stroke-width', 1.5).attr('stroke-dasharray', '4 3')
            .attr('d', d3.line().defined(defined).x((d) => x(d.i)).y((d) => yv(d.mid)).curve(d3.curveMonotoneX));
        svg.append('path').datum(cur)
            .attr('fill', 'none').attr('stroke', 'var(--accent)').attr('stroke-width', 2).attr('stroke-linejoin', 'round')
            .attr('d', d3.line().defined((d) => !Number.isNaN(d.v)).x((d) => x(d.i)).y((d) => yv(d.v)).curve(d3.curveMonotoneX));
        const lastPt = [...cur].reverse().find((d) => !Number.isNaN(d.v));
        if (lastPt) {
            svg.append('text').attr('x', x(lastPt.i) + 6).attr('y', yv(lastPt.v) + 4)
                .style('fill', 'var(--ink-1)').style('font-weight', 600).style('font-size', '12px').text(sel);
        }

        // crosshair
        const hair = svg.append('line').attr('y1', mg.t).attr('y2', height - mg.b).attr('stroke', 'var(--ink-3)').style('display', 'none');
        const dot = svg.append('circle').attr('r', 4).attr('fill', 'var(--accent)').attr('stroke', 'var(--surface)').attr('stroke-width', 2).style('display', 'none');
        svg.append('rect').attr('x', mg.l).attr('y', mg.t).attr('width', width - mg.l - mg.r).attr('height', height - mg.t - mg.b)
            .attr('fill', 'transparent')
            .on('pointermove', (event) => {
                const i = Math.max(0, Math.min(365, Math.round(x.invert(d3.pointer(event)[0]))));
                hair.attr('x1', x(i)).attr('x2', x(i)).style('display', null);
                const v = cur[i].v;
                const daily = series.get(sel).daily[i];
                const rows = [];
                if (!Number.isNaN(v)) {
                    dot.attr('cx', x(i)).attr('cy', yv(v)).style('display', null);
                    rows.push({ value: m.fmt(v), label: `${sel}, 7-day avg`, color: 'var(--accent)' });
                    if (!Number.isNaN(daily)) rows.push({ value: m.fmt(daily), label: 'that day' });
                } else {
                    dot.style('display', 'none');
                    rows.push({ value: '—', label: `no ${sel} data`, color: 'var(--accent)' });
                }
                const b = band[i];
                if (b) {
                    rows.push({ value: m.fmt(b.mid), label: 'middle of other years', color: '#7c8799' });
                    rows.push({ value: `${m.fmt(b.lo)} – ${m.fmt(b.hi)}`, label: `${b.loY} – ${b.hiY}` });
                }
                showTip(event, fmtSlot(i), rows);
            })
            .on('pointerleave', () => { hair.style('display', 'none'); dot.style('display', 'none'); hideTip(); });

        document.getElementById('band-legend').replaceChildren(
            legendSwatch('var(--accent)', `${sel}`, true),
            legendSwatch('#7c8799', 'Middle of other years', true),
            legendSwatch('rgba(148,163,184,0.35)', `Range of ${others.length} other year${others.length === 1 ? '' : 's'}`),
        );
        const yearSel = document.getElementById('band-year');
        yearSel.replaceChildren(...years.map((yy) => el('option', { value: yy, textContent: yy, selected: yy === sel })));
    };

    // ── 3. AQI category days per year ───────────────────────────────────────────
    const drawAqiBars = () => {
        const svgEl = document.getElementById('aqi-bars');
        const days = state.days;
        const first = days[0].t;
        const last = days[days.length - 1].t;
        const years = [...new Set(days.map((o) => o.y))].sort((a, b) => b - a);
        const cats = [...AQI_CATS, NO_DATA];

        const rows = years.map((y) => {
            const start = Math.max(first, Date.UTC(y, 0, 1));
            const end = Math.min(last, Date.UTC(y, 11, 31));
            const span = Math.round((end - start) / DAY_MS) + 1;
            const counts = Object.fromEntries(cats.map((c) => [c.key, 0]));
            days.filter((o) => o.y === y).forEach((o) => {
                if (o.complete && o.cat) counts[o.cat.key] += 1;
            });
            counts.none = span - AQI_CATS.reduce((s, c) => s + counts[c.key], 0);
            const partial = span < (y % 4 === 0 ? 366 : 365);
            return { y, span, counts, partial, start, end };
        });

        const labelW = 52;
        const width = Math.max(widthOf(svgEl), 520);
        const barH = 22;
        const rowH = 38;
        const height = rows.length * rowH + 4;
        const x = d3.scaleLinear([0, 366], [labelW, width - 8]);
        const svg = d3.select(svgEl).attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
        svg.selectAll('*').remove();

        rows.forEach((r, ri) => {
            const yTop = ri * rowH + 4;
            svg.append('text').attr('class', 'year-label').attr('x', 0).attr('y', yTop + barH / 2 + 4).text(r.y);
            if (r.partial) {
                const s = new Date(r.start); const e = new Date(r.end);
                svg.append('text').attr('x', 0).attr('y', yTop + barH + 11).style('font-size', '10px')
                    .text(`${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()} – ${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}`);
            }
            let acc = 0;
            cats.forEach((c) => {
                const n = r.counts[c.key];
                if (!n) return;
                const x0 = x(acc);
                const w = Math.max(x(acc + n) - x0 - 2, 1);   // 2px surface gap between segments
                acc += n;
                const g = svg.append('g');
                g.append('rect').attr('x', x0).attr('y', yTop).attr('width', w).attr('height', barH).attr('rx', 3).attr('fill', c.color);
                if (w >= 26) {
                    g.append('text').attr('x', x0 + w / 2).attr('y', yTop + barH / 2 + 4).attr('text-anchor', 'middle')
                        .style('fill', c.ink).style('font-weight', 600).text(n);
                }
                g.append('rect').attr('x', x0).attr('y', yTop - 4).attr('width', w + 2).attr('height', barH + 8).attr('fill', 'transparent')
                    .on('pointerenter pointermove', (event) => {
                        g.select('rect').attr('stroke', '#e2e8f0');
                        showTip(event, `${r.y} · ${c.label}`, [
                            { value: `${n} day${n === 1 ? '' : 's'}`, label: `${Math.round((100 * n) / r.span)}% of ${r.span}`, color: c.color, swatch: true },
                        ]);
                    })
                    .on('pointerleave', () => { g.select('rect').attr('stroke', null); hideTip(); });
            });
        });
        document.getElementById('aqi-legend').replaceChildren(...cats.map((c) => legendSwatch(c.color, c.label)));
    };

    // ── 4. Almanac ──────────────────────────────────────────────────────────────
    const extreme = (list, field, pick) => {
        const vals = list.filter((o) => o[field] != null);
        if (!vals.length) return null;
        const o = pick === 'max' ? d3.greatest(vals, (d) => d[field]) : d3.least(vals, (d) => d[field]);
        return { v: o[field], o };
    };
    const ALMANAC = {
        outdoor: [
            { label: 'Mean temp', get: (l) => ({ v: d3.mean(l, (o) => o.tavg) }), fmt: (v) => `${v.toFixed(1)}°` },
            { label: 'Hottest', get: (l) => extreme(l, 'tmax', 'max'), fmt: (v) => `${v.toFixed(0)}°`, rec: 'max' },
            { label: 'Coldest', get: (l) => extreme(l, 'tmin', 'min'), fmt: (v) => `${v.toFixed(0)}°`, rec: 'min' },
            { label: 'Days ≥ 90°', get: (l) => ({ v: l.filter((o) => o.tmax >= 90).length }), fmt: String, rec: 'max', count: true },
            { label: 'Nights ≤ 32°', get: (l) => ({ v: l.filter((o) => o.tmin <= 32).length }), fmt: String, rec: 'max', count: true },
            { label: 'Last spring freeze', get: (l) => { const o = [...l].reverse().find((d) => d.m < 7 && d.tmin <= 32); return o ? { v: o.slot, o, dateOnly: true } : null; } },
            { label: 'First fall freeze', get: (l) => { const o = l.find((d) => d.m >= 7 && d.tmin <= 32); return o ? { v: o.slot, o, dateOnly: true } : null; } },
            { label: 'Worst air', get: (l) => extreme(l, 'pavg', 'max'), fmt: (v) => `${pm25ToAqi(v)} AQI`, rec: 'max' },
            { label: 'Days AQI > 100', get: (l) => ({ v: l.filter((o) => o.aqi > 100).length }), fmt: String, rec: 'max', count: true },
        ],
        indoor: [
            { label: 'Mean temp', get: (l) => ({ v: d3.mean(l, (o) => o.tavg) }), fmt: (v) => `${v.toFixed(1)}°` },
            { label: 'Warmest', get: (l) => extreme(l, 'tmax', 'max'), fmt: (v) => `${v.toFixed(0)}°`, rec: 'max' },
            { label: 'Coolest', get: (l) => extreme(l, 'tmin', 'min'), fmt: (v) => `${v.toFixed(0)}°`, rec: 'min' },
            { label: 'Mean humidity', get: (l) => ({ v: d3.mean(l, (o) => o.havg) }), fmt: (v) => `${v.toFixed(0)}%` },
            { label: 'Driest', get: (l) => extreme(l, 'hmin', 'min'), fmt: (v) => `${v.toFixed(0)}%`, rec: 'min' },
            { label: 'Most humid', get: (l) => extreme(l, 'hmax', 'max'), fmt: (v) => `${v.toFixed(0)}%`, rec: 'max' },
            { label: 'Worst air', get: (l) => extreme(l, 'pavg', 'max'), fmt: (v) => `${pm25ToAqi(v)} AQI`, rec: 'max' },
            { label: 'Days AQI > 50', get: (l) => ({ v: l.filter((o) => o.aqi > 50).length }), fmt: String, rec: 'max', count: true },
        ],
    };

    const drawAlmanac = () => {
        const cols = ALMANAC[state.sensor];
        const complete = state.days.filter((o) => o.complete);
        const first = state.days[0];
        const last = state.days[state.days.length - 1];
        const years = [...new Set(complete.map((o) => o.y))].sort((a, b) => b - a);
        const rows = years.map((y) => {
            const list = complete.filter((o) => o.y === y);
            const partial = (y === first.y && (first.m > 1 || first.d > 1)) || (y === last.y && (last.m < 12 || last.d < 31));
            return { y, partial, cells: cols.map((c) => c.get(list)) };
        });
        // A partial year can hold an extreme, but its day counts are short, so counts
        // are compared across full years only
        const recIdx = cols.map((c, ci) => {
            if (!c.rec) return null;
            const pool = rows.filter((r) => r.cells[ci] && (!c.count || !r.partial));
            if (pool.length < 2) return null;
            return (c.rec === 'max' ? d3.greatest : d3.least)(pool, (r) => r.cells[ci].v).y;
        });
        const table = document.getElementById('almanac');
        const head = el('tr', {}, [el('th', { textContent: 'Year' }), ...cols.map((c) => el('th', { textContent: c.label }))]);
        const body = rows.map((r) => el('tr', {}, [
            el('td', {}, [String(r.y), ...(r.partial ? [el('span', { className: 'partial', textContent: ' partial' })] : [])]),
            ...r.cells.map((cell, ci) => {
                const c = cols[ci];
                if (!cell || cell.v == null || Number.isNaN(cell.v)) return el('td', { textContent: '—' });
                const td = el('td', { className: recIdx[ci] === r.y ? 'rec' : '' });
                if (cell.dateOnly) {
                    td.textContent = `${MONTHS[cell.o.m - 1]} ${cell.o.d}`;
                } else {
                    td.append(c.fmt(cell.v));
                    if (cell.o) td.append(el('span', { className: 'd', textContent: `${MONTHS[cell.o.m - 1]} ${cell.o.d}` }));
                }
                return td;
            }),
        ]));
        table.replaceChildren(el('thead', {}, [head]), el('tbody', {}, body));
    };

    // ── Notes about the data ────────────────────────────────────────────────────
    const setNotes = () => {
        const indoorPm = state.sensor === 'indoor'
            ? 'The indoor PM sensor has been fading since 2021 (most minutes now read 0), so indoor air quality after that year is unreliable.'
            : '';
        const show = (id, text) => { const n = document.getElementById(id); n.textContent = text; n.hidden = !text; };
        show('cal-note', state.calMetric === 'aqi' ? indoorPm : '');
        show('band-note', state.bandMetric === 'pm' ? indoorPm : '');
        show('aqi-note', indoorPm);
    };

    // ── Render & controls ───────────────────────────────────────────────────────
    const renderAll = () => {
        if (!state.days.length) return;
        segButtons(document.getElementById('cal-metric'), CAL_METRICS, (k) => METRICS[k].label, state.calMetric, (k) => { state.calMetric = k; renderAll(); });
        segButtons(document.getElementById('band-metric'), BAND_METRICS, (k) => METRICS[k].label, state.bandMetric, (k) => { state.bandMetric = k; renderAll(); });
        setNotes();
        drawCalendar();
        drawBand();
        drawAqiBars();
        drawAlmanac();
    };

    const load = async () => {
        const sensor = state.sensor;
        const label = SensorState.label(sensor);
        document.title = `Years – ${label}`;
        document.getElementById('title').textContent = `Years · ${label}`;
        document.querySelectorAll('#sensor-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sensor === sensor)));
        const content = document.getElementById('content');
        const status = document.getElementById('status');
        content.classList.add('loading');
        try {
            if (!cache[sensor]) {
                const res = await fetch(`${HOSTS[sensor]}/daily-aq-data.json`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                cache[sensor] = parseDays(await res.json());
            }
            if (state.sensor !== sensor) return;   // switched again while loading
            state.days = cache[sensor];
            const f = state.days[0];
            const l = state.days[state.days.length - 1];
            document.getElementById('span').textContent =
                `Daily summaries from ${fmtDay(f)} to ${fmtDay(l)}. Hourly data runs a day behind.`;
            status.hidden = true;
            content.hidden = false;
            renderAll();
        } catch (e) {
            status.hidden = false;
            status.textContent = `Couldn't load ${label.toLowerCase()} data (${e.message}).`;
        } finally {
            content.classList.remove('loading');
        }
    };

    document.querySelectorAll('#sensor-seg button').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.sensor === state.sensor) return;
        state.sensor = b.dataset.sensor;
        SensorState.write(state.sensor, true);
        load();
    }));
    window.addEventListener('popstate', () => { state.sensor = SensorState.read(); load(); });
    document.getElementById('band-year').addEventListener('change', (e) => { state.bandYear = Number(e.target.value); renderAll(); });
    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderAll, 150); });

    SensorState.write(state.sensor, false);
    load();
})();
