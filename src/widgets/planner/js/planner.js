/* Dot Planner: who's working / awake / asleep over the next hours in each city,
 * and the two display panels (hour blocks, local-hour numbers). */
(function (WT) {
  'use strict';
  const D = WT.dots;
  const M = 3, GAP = 4, ROW = 7, ROW_GAP = 3;
  const HOUR = 3600000;
  const PANEL_IDS = ['blocks', 'numbers'];

  /** Local decimal hour (e.g. 14.5) and weekday in `tz` at `t`. */
  function local(tz, t) {
    const w = WT.time.wallClock(tz, new Date(t));
    const day = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
    return { hour: w.hour + w.minute / 60, h: w.hour, day };
  }

  const inRange = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b); // b < a = past midnight

  /** 2 = working, 1 = awake, 0 = asleep, for a city at time t. */
  function status(city, t) {
    const l = local(city.tz, t);
    const weekend = l.day === 0 || l.day === 6;
    if (inRange(l.hour, city.work[0], city.work[1]) && !(weekend && !city.weekends)) return 2;
    if (inRange(l.hour, city.awake[0], city.awake[1])) return 1;
    return 0;
  }

  /** Start of the current hour in the home city's time (works for :30/:45 zones too). */
  function hourStart(homeTz, now) {
    const w = WT.time.wallClock(homeTz, new Date(now));
    return now - (w.minute * 60 + w.second) * 1000 - (now % 1000);
  }

  /** Is everybody working at t? */
  const allWorking = (cities, t) => cities.length > 0 && cities.every((c) => status(c, t) === 2);

  /** Next window (within `within` hours) when everyone is working: {start, end} or null. */
  function nextOverlap(cities, now, within) {
    if (!cities.length) return null;
    const step = 15 * 60000;
    let start = null;
    for (let t = now; t < now + (within || 48) * HOUR; t += step) {
      const ok = allWorking(cities, t);
      if (ok && start === null) start = t;
      if (!ok && start !== null) return { start, end: t };
    }
    return start !== null ? { start, end: now + (within || 48) * HOUR } : null;
  }

  /** "09" in 24-hour mode; "9A" / "12P" in 12-hour mode (always 2 characters wide or less). */
  function hourLabel(h, use24h) {
    if (use24h) return String(h).padStart(2, '0');
    const n = h % 12 || 12;
    return n + (h < 12 ? 'A' : 'P');
  }

  // ---- drawing -------------------------------------------------------------------
  function grid(w, h) {
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [] };
    g.ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      g.cidx[y * w + x] = g.ci(c) + 1;
      g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.text = (s, x, y, c, a, xmax) => {
      D.textColumns(s).forEach((m, i) => {
        if (xmax !== undefined && x + i >= xmax) return;
        for (let r = 0; r < 7; r++) if (m & (1 << r)) g.set(x + i, y + r, c, a);
      });
      return D.textWidth(s);
    };
    return g;
  }

  const labelWidth = (cities) => Math.max(D.textWidth('XXX'), ...cities.map((c) => D.textWidth(c.label)));

  function blocksHeight(n) { return 3 + n * ROW + Math.max(0, n - 1) * ROW_GAP + ROW_GAP + ROW; }
  function numbersHeight(n) { return n * ROW + Math.max(0, n - 1) * (ROW_GAP + 1); }
  const HEIGHT = { blocks: blocksHeight, numbers: numbersHeight };

  function height(panels, n) {
    const on = panels.filter((p) => p.enabled);
    if (!on.length || !n) return M * 2 + ROW;
    return M * 2 + on.reduce((h, p) => h + HEIGHT[p.id](n), 0) + (on.length - 1) * GAP;
  }

  /**
   * ctx: {W, now, cities:[{label, tz, work, awake, weekends, color}], panels, hours, use24h,
   *       defaultColor, highlight, scaleColor}
   */
  function build(ctx) {
    const { W, now, cities } = ctx;
    const g = grid(W, height(ctx.panels, cities.length));
    const on = ctx.panels.filter((p) => p.enabled);
    if (!cities.length) { g.text('RIGHT-CLICK TO ADD CITIES', M, M, ctx.defaultColor); return g; }
    if (!on.length) { g.text('RIGHT-CLICK TO CHOOSE A LAYOUT', M, M, ctx.defaultColor); return g; }

    const home = cities[0];
    const t0 = hourStart(home.tz, now);
    const lw = labelWidth(cities);
    const x0 = M + lw + 4;
    const col = (c) => c.color || ctx.defaultColor;
    let y = M;

    for (const p of on) {
      if (p.id === 'blocks') {
        const hours = ctx.hours;
        const cw = Math.max(2, Math.floor((W - M - x0 + 1) / hours));
        const gapPx = cw >= 4 ? 1 : 0;
        // everyone-working bar
        for (let i = 0; i < hours; i++) {
          const ok = allWorking(cities, t0 + i * HOUR + HOUR / 2);
          if (ok) for (let x = 0; x < cw - gapPx; x++) { g.set(x0 + i * cw + x, y, ctx.highlight); g.set(x0 + i * cw + x, y + 1, ctx.highlight); }
        }
        let yy = y + 3;
        cities.forEach((c, r) => {
          if (r) yy += ROW_GAP;
          g.text(c.label, M, yy, col(c), 1, x0 - 3);
          for (let i = 0; i < hours; i++) {
            const s = status(c, t0 + i * HOUR + HOUR / 2);
            if (!s) continue;
            for (let x = 0; x < cw - gapPx; x++) for (let dy = 1; dy < 6; dy++) g.set(x0 + i * cw + x, yy + dy, col(c), s === 2 ? 1 : 0.38);
          }
          yy += ROW;
        });
        yy += ROW_GAP;
        // home-time scale, as often as the labels fit
        const every = Math.max(1, Math.ceil((D.textWidth('00') + 3) / cw));
        for (let i = 0; i < hours; i += every) {
          const lbl = hourLabel(local(home.tz, t0 + i * HOUR).h, ctx.use24h);
          if (x0 + i * cw + D.textWidth(lbl) <= W - M) g.text(lbl, x0 + i * cw, yy, ctx.scaleColor, 0.8);
        }
        // now line
        const nx = x0 + Math.round(((now - t0) / HOUR) * cw);
        for (let k = y; k < yy - 1; k++) g.set(nx, k, ctx.scaleColor, 0.9);
        y += blocksHeight(cities.length) + GAP;
      } else if (p.id === 'numbers') {
        const cell = 16;
        const hours = Math.min(ctx.hours, Math.floor((W - M - x0 + 5) / cell));
        cities.forEach((c, r) => {
          const yy = y + r * (ROW + ROW_GAP + 1);
          g.text(c.label, M, yy, col(c), 1, x0 - 3);
          for (let i = 0; i < hours; i++) {
            const t = t0 + i * HOUR;
            const s = status(c, t + HOUR / 2);
            const lbl = hourLabel(local(c.tz, t).h, ctx.use24h);
            g.text(lbl, x0 + i * cell, yy, s === 2 ? ctx.highlight : col(c), s === 2 ? 1 : s === 1 ? 0.55 : 0.18);
          }
        });
        y += numbersHeight(cities.length) + GAP;
      }
    }
    return g;
  }

  /** "LON" from "London, UK"; "NYC"/"SFO"/"LA" for a few well-known ones. */
  function defaultCode(name) {
    const known = { 'NEW YORK': 'NYC', 'SAN FRANCISCO': 'SFO', 'LOS ANGELES': 'LA', 'HONG KONG': 'HK', 'WASHINGTON DC': 'DC', 'MEXICO CITY': 'CDMX', 'KUALA LUMPUR': 'KL', 'SAO PAULO': 'SAO', 'RIO DE JANEIRO': 'RIO', 'TOKYO': 'TYO', 'BEIJING': 'BJS' };
    const city = D.normalizeText(String(name || '').split(',')[0]).trim();
    if (known[city]) return known[city];
    return city.replace(/[^A-Z]/g, '').slice(0, 3) || 'CTY';
  }

  WT.planner = { PANEL_IDS, local, status, hourStart, allWorking, nextOverlap, hourLabel, build, height, defaultCode, HEIGHT };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
