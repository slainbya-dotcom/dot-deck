/* Dot Weather: forecast parsing (Open-Meteo), weather codes, animated dot icons and
 * the five styles. Pure: no DOM, no network (see forecast.js for fetching). */
(function (WT) {
  'use strict';
  const WHITE = '#e8e4d0';
  const NATURAL = { sun: '#ffd23f', cloud: '#c9ced8', dark: '#8a909c', rain: '#5ad1ff', snow: '#ffffff', bolt: '#ffe14a', fog: '#9aa0aa', moon: '#e6e0c0' };
  const STYLES = ['now', 'hours', 'days', 'graph', 'cities'];

  // ---- weather codes (WMO, as used by Open-Meteo) -------------------------------------------------
  /** -> { icon, text } for a code; `day` false switches sun icons to moon ones. */
  function describe(code, day) {
    const d = day !== false;
    const c = Number(code);
    if (c === 0) return { icon: d ? 'sun' : 'night', text: d ? 'SUNNY' : 'CLEAR' };
    if (c === 1) return { icon: d ? 'sun' : 'night', text: d ? 'MOSTLY SUNNY' : 'MOSTLY CLEAR' };
    if (c === 2) return { icon: d ? 'part' : 'nightpart', text: 'PARTLY CLOUDY' };
    if (c === 3) return { icon: 'cloud', text: 'CLOUDY' };
    if (c === 45 || c === 48) return { icon: 'fog', text: 'FOG' };
    if (c === 51 || c === 53 || c === 55) return { icon: 'drizzle', text: 'DRIZZLE' };
    if (c === 56 || c === 57) return { icon: 'sleet', text: 'FREEZING DRIZZLE' };
    if (c === 61) return { icon: 'rain', text: 'LIGHT RAIN' };
    if (c === 63) return { icon: 'rain', text: 'RAIN' };
    if (c === 65) return { icon: 'rain', text: 'HEAVY RAIN' };
    if (c === 66 || c === 67) return { icon: 'sleet', text: 'FREEZING RAIN' };
    if (c === 71) return { icon: 'snow', text: 'LIGHT SNOW' };
    if (c === 73 || c === 77) return { icon: 'snow', text: 'SNOW' };
    if (c === 75) return { icon: 'snow', text: 'HEAVY SNOW' };
    if (c === 80 || c === 81) return { icon: 'rain', text: 'SHOWERS' };
    if (c === 82) return { icon: 'rain', text: 'HEAVY SHOWERS' };
    if (c === 85 || c === 86) return { icon: 'snow', text: 'SNOW SHOWERS' };
    if (c === 95) return { icon: 'storm', text: 'THUNDERSTORM' };
    if (c === 96 || c === 99) return { icon: 'storm', text: 'THUNDER + HAIL' };
    return { icon: 'cloud', text: '' };
  }

  // ---- Open-Meteo ------------------------------------------------------------------------------------
  const API = 'https://api.open-meteo.com/v1/forecast';
  /** One request per place: current conditions, 5 days of hours, and 5 days. Always Celsius. */
  function url(place) {
    const q = [
      'latitude=' + Number(place.lat).toFixed(3),
      'longitude=' + Number(place.lng).toFixed(3),
      'current=temperature_2m,weather_code,is_day',
      'hourly=temperature_2m,weather_code,precipitation_probability,is_day',
      'daily=weather_code,temperature_2m_max,temperature_2m_min',
      'timezone=auto',
      'forecast_days=5',
    ];
    return API + '?' + q.join('&');
  }

  /** "2026-10-22T14:00" in a place with UTC offset `off` seconds -> epoch ms. */
  function localToEpoch(s, off) {
    const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(String(s || ''));
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) - off * 1000;
  }
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

  /** Open-Meteo JSON -> our compact model (or throws if it isn't a forecast). */
  function parse(json, fetchedAt) {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    if (!j || !j.hourly || !j.daily || !Array.isArray(j.hourly.time)) throw new Error(j && j.reason ? j.reason : 'Unexpected reply from the weather service');
    const off = Number(j.utc_offset_seconds) || 0;
    const H = j.hourly, Dd = j.daily, C = j.current || {};
    const hourly = H.time.map((t, i) => ({
      at: localToEpoch(t, off),
      t: n(H.temperature_2m[i]),
      code: n(H.weather_code[i]),
      day: H.is_day ? H.is_day[i] !== 0 : true,
      rain: n(H.precipitation_probability ? H.precipitation_probability[i] : null) || 0,
    })).filter((h) => isFinite(h.at) && h.t !== null);
    const daily = Dd.time.map((d, i) => ({
      date: String(d).slice(0, 10),
      hi: n(Dd.temperature_2m_max[i]),
      lo: n(Dd.temperature_2m_min[i]),
      code: n(Dd.weather_code[i]),
    })).filter((d) => d.hi !== null && d.lo !== null);
    return {
      fetchedAt: fetchedAt || Date.now(),
      offset: off,
      current: n(C.temperature_2m) === null ? null : { t: C.temperature_2m, code: n(C.weather_code), day: C.is_day !== 0, at: localToEpoch(C.time, off) },
      hourly,
      daily,
    };
  }

  const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  /** Local YYYY-MM-DD at the place for epoch `t`. */
  const localDate = (t, off) => new Date(t + off * 1000).toISOString().slice(0, 10);

  /**
   * What to show at time `now` from a (possibly hours-old) model:
   * { now: {t, code, day, icon, text}, hours: [{at, hour, t, code, day, icon, rain}], days: [{dow, hi, lo, icon, today}] }
   */
  function view(model, now) {
    if (!model) return null;
    now = now || Date.now();
    const off = model.offset;
    const hours = model.hourly.filter((h) => h.at + 3600000 > now).slice(0, 24).map((h) => Object.assign({}, h, {
      hour: new Date(h.at + off * 1000).getUTCHours(),
      icon: describe(h.code, h.day).icon,
    }));
    let cur = model.current && now - model.fetchedAt < 2 * 3600000 ? model.current : hours[0];
    if (!cur) return null;
    const d = describe(cur.code, cur.day);
    const today = localDate(now, off);
    const days = model.daily.filter((x) => x.date >= today).map((x) => ({
      date: x.date, hi: x.hi, lo: x.lo, code: x.code, icon: describe(x.code, true).icon, today: x.date === today,
      dow: DOW[new Date(x.date + 'T12:00:00Z').getUTCDay()],
    }));
    return { now: { t: cur.t, code: cur.code, day: cur.day, icon: d.icon, text: d.text }, hours, days };
  }

  // ---- drawing --------------------------------------------------------------------------------------
  function grid(w, h) {
    const D = WT.dots, M = D.MARGIN;
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [] };
    const ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a) => {
      x = Math.round(x); y = Math.round(y);
      if (x < M || y < 0 || x >= w - M || y >= h) return;
      g.cidx[y * w + x] = ci(c) + 1; g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.text = (s, x, y, c, a, k) => {
      k = k || 1;
      D.textColumns(s).forEach((m, i) => {
        for (let r = 0; r < 7; r++) if (m & (1 << r)) for (let dx = 0; dx < k; dx++) for (let dy = 0; dy < k; dy++) g.set(x + i * k + dx, y + r * k + dy, c, a);
      });
      return D.textWidth(s) * k;
    };
    g.bits = (rows, x, y, c, a, k) => {
      k = k || 1;
      rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '1') for (let dx = 0; dx < k; dx++) for (let dy = 0; dy < k; dy++) g.set(x + i * k + dx, y + j * k + dy, c, a);
      });
    };
    return g;
  }

  const DEG = ['010', '101', '010'];
  const PIN = ['01110', '11111', '11011', '11111', '01110', '00100', '00100'];
  const SUN = ['1001001', '0100010', '0011100', '1011101', '0011100', '0100010', '1001001'];
  const SUN_CORE = ['0000000', '0000000', '0011100', '0011100', '0011100', '0000000', '0000000'];
  const MOON = ['0011110', '0111000', '1110000', '1110000', '1110000', '0111000', '0011110'];
  const CLOUD = ['0000000', '0011000', '0111110', '1111111', '1111111', '0000000', '0000000'];
  const CLOUD_HI = ['0011000', '0111110', '1111111', '1111111', '0000000', '0000000', '0000000'];
  const PART_CLOUD = ['0000000', '0000000', '0110000', '1111100', '1111110', '0000000', '0000000'];
  const PART_SUN = ['0000101', '0000010', '0000111', '0000010', '0000000', '0000000', '0000000'];
  const PART_MOON = ['0000011', '0000110', '0000110', '0000011', '0000000', '0000000', '0000000'];
  const FOG = ['1111110', '0000000', '0111111', '0000000', '1111110', '0000000', '0111111'];
  const BOLT = ['0000000', '0000000', '0000000', '0000000', '0001000', '0011000', '0010000'];

  /** A 7x7 animated weather icon at scale k. `pal` = natural colours or all one colour. */
  function icon(g, name, x, y, k, frame, pal) {
    k = k || 1; frame = frame || 0;
    const B = (rows, c, a) => g.bits(rows, x, y, c, a, k);
    const dot = (dx, dy, c, a) => { for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) g.set(x + dx * k + i, y + dy * k + j, c, a); };
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(frame / 6));
    switch (name) {
      case 'sun': B(SUN, pal.sun, pulse); B(SUN_CORE, pal.sun); break;
      case 'night': B(MOON, pal.moon); if (Math.floor(frame / 8) % 3 === 0) dot(6, 0, pal.snow, 0.9); break;
      case 'part': B(PART_SUN, pal.sun, 0.6 + 0.4 * Math.abs(Math.sin(frame / 6))); B(PART_CLOUD, pal.cloud); break;
      case 'nightpart': B(PART_MOON, pal.moon); B(PART_CLOUD, pal.cloud); break;
      case 'cloud': B(CLOUD, pal.cloud); break;
      case 'fog': B(FOG, pal.fog, 0.5 + 0.3 * Math.abs(Math.sin(frame / 10))); break;
      case 'drizzle':
        B(CLOUD_HI, pal.cloud);
        [[2, 0], [5, 1]].forEach(([dx, o]) => dot(dx, 4 + ((Math.floor(frame / 3) + o) % 3), pal.rain, 0.8));
        break;
      case 'rain':
        B(CLOUD_HI, pal.cloud);
        [[1, 0], [3, 1], [5, 2]].forEach(([dx, o]) => dot(dx, 4 + ((Math.floor(frame / 2) + o) % 3), pal.rain));
        break;
      case 'sleet':
        B(CLOUD_HI, pal.cloud);
        dot(1, 4 + (Math.floor(frame / 2) % 3), pal.rain);
        dot(3, 4 + ((Math.floor(frame / 4) + 1) % 3), pal.snow, 0.9);
        dot(5, 4 + ((Math.floor(frame / 2) + 2) % 3), pal.rain);
        break;
      case 'snow':
        B(CLOUD_HI, pal.cloud);
        [[0, 0], [2, 1], [4, 0], [6, 1]].forEach(([dx, o]) => dot(dx, 4 + ((Math.floor(frame / 4) + o) % 3), pal.snow, 0.9));
        break;
      case 'storm': {
        const f = frame % 40;
        B(CLOUD_HI, f < 2 ? pal.snow : pal.dark);
        B(BOLT, pal.bolt, f < 6 || (f > 10 && f < 13) ? 1 : 0.35);
        break;
      }
      default: B(CLOUD, pal.cloud);
    }
  }

  /** Shortens text (dropping characters) until it fits in `room` dots. */
  function fit(s, room) {
    const D = WT.dots;
    s = D.normalizeText(s);
    while (s && D.textWidth(s) > room) s = s.slice(0, -1).trimEnd();
    return s;
  }

  /**
   * opts: { W, style, places: [{place, view|null, status}], frame, unit 'C'|'F', use24h,
   *         days (1-4, style C), color (main dot colour), icons 'natural'|'mono' }
   * `places[0]` is the main place (A–D); E shows them all.
   */
  function build(opts) {
    const D = WT.dots, M = D.MARGIN;
    const { W, frame } = opts;
    const main = opts.color || '#ffb000';
    const pal = opts.icons === 'mono'
      ? { sun: main, cloud: main, dark: main, rain: main, snow: main, bolt: main, fog: main, moon: main }
      : NATURAL;
    const cool = opts.icons === 'mono' ? main : NATURAL.rain;
    const conv = (c) => Math.round(opts.unit === 'F' ? c * 9 / 5 + 32 : c);
    const tempW = (c, k) => (D.textWidth(String(conv(c))) + 4) * (k || 1);
    const temp = (g, c, x, y, color, a, k) => {
      k = k || 1;
      const w = g.text(String(conv(c)), x, y, color, a, k);
      g.bits(DEG, x + w + k, y, color, a, k);
      return w + 4 * k;
    };
    const hourText = (h) => (opts.use24h ? String(h).padStart(2, '0') : (h % 12 || 12) + (h < 12 ? 'AM' : 'PM'));
    const pinLabel = (g, label, xRight, y, room) => {
      // Pin + place name, right-aligned to xRight, in at most `room` dots.
      const s = fit(label, room - 7);
      const w = D.textWidth(s);
      g.text(s, xRight - w, y, main, 0.65);
      g.bits(PIN, xRight - w - 7, y, main, 0.65);
      return w + 7;
    };
    const style = STYLES.includes(opts.style) ? opts.style : 'now';
    const places = opts.places || [];
    const first = places[0] || null;
    const message = (g, s) => g.text(fit(s, W - M * 2), M, M, WHITE, 0.6);

    const heights = {
      now: M * 2 + 25,
      hours: M * 2 + 7 + 3 + 7 + 3 + 7,
      days: M * 2 + opts.days * 7 + (opts.days - 1) * 3,
      graph: M * 2 + 7 + 3 + 16 + 2 + 7,
      cities: M * 2 + Math.max(1, places.length) * 7 + (Math.max(1, places.length) - 1) * D.GAP,
    };
    const g = grid(W, heights[style]);

    if (style === 'cities') {
      if (!places.length) { message(g, 'ADD A PLACE IN SETTINGS'); return g; }
      places.forEach((p, i) => {
        const y = M + i * (7 + D.GAP);
        const v = p.view;
        let right = W - M;
        if (v) {
          icon(g, v.now.icon, right - 7, y, 1, frame, pal);
          right -= 7 + 4;
          right -= tempW(v.now.t);
          temp(g, v.now.t, right, y, main);
        } else {
          const s = p.status === 'error' ? 'OFFLINE' : '...';
          right -= D.textWidth(s);
          g.text(s, right, y, WHITE, 0.45);
        }
        g.text(fit(p.place.label, right - M - 6), M, y, main);
      });
      return g;
    }

    if (!first) { message(g, 'ADD A PLACE IN SETTINGS'); return g; }
    const v = first.view;
    if (!v) { message(g, first.status === 'error' ? 'CAN\'T REACH THE WEATHER' : 'GETTING THE WEATHER...'); return g; }
    const today = v.days[0];

    if (style === 'now') {
      // Big icon + temperature on the left; conditions, high/low and the place on the right.
      const y0 = M + 6;
      icon(g, v.now.icon, M, y0, 2, frame, pal);
      const tx = M + 18;
      const tw = temp(g, v.now.t, tx, y0, WHITE, 1, 2);
      const rx = tx + tw + 4, room = W - M - rx;
      g.text(fit(v.now.text, room), rx, M, main);
      if (today) {
        let x = rx;
        x += g.text('H', x, M + 9, WHITE, 0.6) + 1;
        x += temp(g, today.hi, x, M + 9, WHITE, 0.9) + 4;
        x += g.text('L', x, M + 9, WHITE, 0.6) + 1;
        temp(g, today.lo, x, M + 9, WHITE, 0.9);
      }
      const s = fit(first.place.label, room - 7);
      g.bits(PIN, rx, M + 18, main, 0.65);
      g.text(s, rx + 7, M + 18, main, 0.65);
      return g;
    }

    if (style === 'hours') {
      const count = 6, slot = Math.floor((W - M * 2) / count);
      for (let i = 0; i < count; i++) {
        const h = v.hours[i * 2];
        if (!h) break;
        const cx = M + i * slot + Math.floor(slot / 2);
        const lbl = i === 0 ? 'NOW' : hourText(h.hour);
        g.text(lbl, cx - Math.floor(D.textWidth(lbl) / 2), M, WHITE, i === 0 ? 0.95 : 0.6);
        icon(g, i === 0 ? v.now.icon : h.icon, cx - 3, M + 10, 1, frame, pal);
        const t = i === 0 ? v.now.t : h.t;
        temp(g, t, cx - Math.floor(tempW(t) / 2), M + 20, main);
      }
      return g;
    }

    if (style === 'days') {
      const rows = v.days.slice(0, opts.days);
      const all = v.days.slice(0, Math.max(opts.days, 1));
      const lo = Math.min(...all.map((d) => d.lo), v.now.t), hi = Math.max(...all.map((d) => d.hi), v.now.t);
      const span = Math.max(1, hi - lo);
      const loW = Math.max(...rows.map((d) => tempW(d.lo))), hiW = Math.max(...rows.map((d) => tempW(d.hi)));
      const dayW = D.textWidth('TODAY');
      rows.forEach((d, i) => {
        const y = M + i * 10;
        g.text(d.today ? 'TODAY' : d.dow, M, y, d.today ? main : WHITE, d.today ? 1 : 0.85);
        icon(g, d.today ? v.now.icon : d.icon, M + dayW + 4, y, 1, frame, pal);
        const x0 = M + dayW + 4 + 7 + 5;
        temp(g, d.lo, x0 + loW - tempW(d.lo), y, cool, 0.9);
        const hx = W - M - hiW;
        temp(g, d.hi, hx + hiW - tempW(d.hi), y, main);
        // Range bar on a shared scale: cool at the low end, warm at the high end.
        const b0 = x0 + loW + 4, b1 = hx - 4;
        if (b1 - b0 < 4) return;
        for (let x = b0; x < b1; x++) g.set(x, y + 3, WHITE, 0.15);
        const at = (t) => b0 + Math.round(((t - lo) / span) * (b1 - b0 - 1));
        for (let x = at(d.lo); x <= at(d.hi); x++) {
          const tt = (x - b0) / (b1 - b0);
          const col = opts.icons === 'mono' ? main : tt < 0.4 ? NATURAL.rain : tt < 0.7 ? '#b8ff5a' : '#ffb000';
          for (let j = 2; j <= 4; j++) g.set(x, y + j, col);
        }
        if (d.today) for (let j = 1; j <= 5; j++) g.set(at(v.now.t), y + j, WHITE);
      });
      return g;
    }

    // graph: header (icon, temp, conditions ... place), then 24 hours of temperature over rain chance.
    const GH = 16;
    icon(g, v.now.icon, M, M, 1, frame, pal);
    let x = M + 10;
    x += temp(g, v.now.t, x, M, WHITE) + 4;
    // The place's short name ("London" from "London, UK") on the right; conditions in between if they fit.
    const short = String(first.place.label).split(',')[0].trim() || first.place.label;
    const placeW = pinLabel(g, short, W - M, M, Math.max(30, Math.floor((W - M - x) * 0.6)));
    const cond = WT.dots.normalizeText(v.now.text);
    if (D.textWidth(cond) <= W - M - placeW - 4 - x) g.text(cond, x, M, main, 0.95);
    const top = M + 10, gw = W - M * 2;
    const hrs = v.hours.slice(0, 24);
    if (hrs.length < 2) return g;
    const ts = hrs.map((h) => h.t), tlo = Math.min(...ts) - 1, thi = Math.max(...ts) + 1;
    const last = hrs.length - 1;
    const xs = (i) => M + Math.round((i / last) * (gw - 1));
    for (let i = 0; i <= last; i++) {
      const nn = Math.round((hrs[i].rain / 100) * (GH - 2));
      for (let xx = xs(i); xx < (i < last ? xs(i + 1) : xs(i) + 1); xx += 2) for (let j = 0; j < nn; j++) g.set(xx, top + GH - 1 - j, cool, 0.35);
    }
    let prev = null;
    for (let xx = M; xx < M + gw; xx++) {
      const f = ((xx - M) / (gw - 1)) * last, i = Math.floor(f), t = ts[i] + (ts[Math.min(last, i + 1)] - ts[i]) * (f - i);
      const yy = top + Math.round((1 - (t - tlo) / (thi - tlo)) * (GH - 1));
      if (prev !== null) for (let y = Math.min(prev, yy); y <= Math.max(prev, yy); y++) g.set(xx, y, main);
      else g.set(xx, yy, main);
      prev = yy;
    }
    for (let i = 0; i <= last; i += 6) {
      const lbl = i === 0 ? 'NOW' : hourText(hrs[i].hour);
      g.text(lbl, Math.min(W - M - D.textWidth(lbl), xs(i)), top + GH + 2, WHITE, 0.55);
    }
    return g;
  }

  // ---- simulated forecast (browser preview / development) --------------------------------------------
  /** A believable Open-Meteo-shaped reply for a place (no network). */
  function simulate(place, now) {
    now = now || Date.now();
    const seed = Math.abs(Math.round((place.lat || 0) * 7 + (place.lng || 0) * 3));
    const off = -new Date(now).getTimezoneOffset() * 60;
    const base = 10 + (seed % 12);
    const startLocal = new Date(now + off * 1000);
    startLocal.setUTCMinutes(0, 0, 0);
    startLocal.setUTCHours(0);
    const iso = (t) => new Date(t).toISOString().slice(0, 16);
    const time = [], temperature = [], code = [], rain = [], isDay = [];
    for (let i = 0; i < 120; i++) {
      const t = startLocal.getTime() + i * 3600000, h = i % 24;
      time.push(iso(t));
      const dayShift = [0, -3, 2, 1, -4][Math.floor(i / 24) % 5];
      temperature.push(Math.round((base + dayShift + 6 * Math.sin(((h - 9) / 24) * Math.PI * 2) + Math.sin(i * 1.7 + seed)) * 10) / 10);
      const r = Math.max(0, Math.min(100, Math.round(55 * Math.sin((i + seed) / 5) + 20 * Math.cos(i))));
      rain.push(r);
      code.push(r > 60 ? 61 : r > 40 ? 3 : r > 20 ? 2 : 0);
      isDay.push(h >= 7 && h < 19 ? 1 : 0);
    }
    const dtime = [], dmax = [], dmin = [], dcode = [];
    for (let d = 0; d < 5; d++) {
      dtime.push(iso(startLocal.getTime() + d * 86400000).slice(0, 10));
      const day = temperature.slice(d * 24, d * 24 + 24);
      dmax.push(Math.max(...day)); dmin.push(Math.min(...day));
      dcode.push([61, 2, 0, 95, 3][(d + seed) % 5]);
    }
    const nowLocal = iso(now + off * 1000);
    const idx = Math.max(0, time.findIndex((t) => t.slice(0, 13) === nowLocal.slice(0, 13)));
    return {
      utc_offset_seconds: off,
      current: { time: nowLocal, temperature_2m: temperature[idx], weather_code: [61, 2, 0, 3][seed % 4], is_day: isDay[idx] },
      hourly: { time, temperature_2m: temperature, weather_code: code, precipitation_probability: rain, is_day: isDay },
      daily: { time: dtime, weather_code: dcode, temperature_2m_max: dmax, temperature_2m_min: dmin },
    };
  }

  WT.weather = { STYLES, NATURAL, describe, url, parse, view, build, fit, simulate, localToEpoch };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
