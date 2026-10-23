/* Draws Dot Sun's three panels (rows, sky arc, compact line) into one dot grid
 * that WT.dots.drawGrid can paint. */
(function (WT) {
  'use strict';
  const D = WT.dots;
  const M = 3, GAP = 4, ROW = 7, ROW_GAP = 4;
  const SUN7 = ['1001001', '0100010', '0011100', '1011101', '0011100', '0100010', '1001001'];

  function grid(w, h) {
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [] };
    g.ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      g.cidx[y * w + x] = g.ci(c) + 1;
      g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.cols = (cols, x, y, c, a) => cols.forEach((m, dx) => { for (let r = 0; r < 7; r++) if (m & (1 << r)) g.set(x + dx, y + r, c, a); });
    g.text = (s, x, y, c, a) => { const cols = D.textColumns(s); g.cols(cols, x, y, c, a); return cols.length; };
    g.textR = (s, xr, y, c, a) => g.text(s, xr - D.textWidth(s), y, c, a);
    return g;
  }

  /** Same loading bar as the other widgets: rounded frame, 1-dot gap, 3-dot fill. */
  function bar(g, x0, y0, bw, frac, c) {
    for (let x = 1; x < bw - 1; x++) { g.set(x0 + x, y0, c); g.set(x0 + x, y0 + 6, c); }
    for (let y = 1; y < 6; y++) { g.set(x0, y0 + y, c); g.set(x0 + bw - 1, y0 + y, c); }
    const iw = bw - 4, f = Math.max(0, Math.min(1, frac)) * iw, full = Math.floor(f), part = f - full;
    for (let x = 0; x < iw; x++) {
      const a = x < full ? 1 : (x === full && part > 0.08 ? 0.25 + 0.6 * part : 0);
      if (a) for (let y = 2; y <= 4; y++) g.set(x0 + 2 + x, y0 + y, c, a);
    }
  }

  function moonDisc(g, cx, cy, r, m, southern, c) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + r * 0.6) continue;
      g.set(cx + x, cy + y, c, WT.sun.moonLit(x, y, r, m, southern) ? 1 : 0.22);
    }
  }

  /** Fit "LABEL value" pairs: try each candidate label until label + value fit. */
  function fitLabel(candidates, value, avail) {
    const vw = value ? D.textWidth(value) + 5 : 0;
    for (const l of candidates) if (D.textWidth(l) + vw <= avail) return l;
    return candidates[candidates.length - 1];
  }

  // ---- panel heights (content only, no outer margin) ---------------------------------
  function rowsHeight(ctx) {
    const p = ctx;
    let h = 0, n = 0;
    if (p.rows.bar) { h += ROW + 2 + 7; n++; }
    for (const k of ['golden', 'length', 'moon']) if (p.rows[k]) { h += ROW; n++; }
    return n ? h + (n - 1) * ROW_GAP : 0;
  }
  const ARC_H = 30;
  const HEIGHTS = { rows: rowsHeight, arc: () => ARC_H, compact: () => ROW };

  /**
   * ctx: {W, panels:[{id, enabled}], rows:{bar,golden,length,moon}, s (sun times), m (moon),
   *       now, fmt(t) -> "07:37", southern, colors:{text,sun,moon,sky}}
   */
  function build(ctx) {
    const list = ctx.panels.filter((p) => p.enabled && HEIGHTS[p.id](ctx) > 0);
    const W = ctx.W, inner = W - M * 2;
    const C = ctx.colors;
    if (!list.length) {
      const g = grid(W, M * 2 + ROW);
      g.text('RIGHT-CLICK TO CHOOSE PANELS', M, M, C.text);
      return g;
    }
    const h = M * 2 + list.reduce((t, p) => t + HEIGHTS[p.id](ctx), 0) + (list.length - 1) * GAP;
    const g = grid(W, h);
    const s = ctx.s, m = ctx.m, now = ctx.now;
    const pct = Math.round(m.illumination * 100) + '%';
    const rise = s.sunrise !== null ? ctx.fmt(s.sunrise) : '--:--';
    const set = s.sunset !== null ? ctx.fmt(s.sunset) : '--:--';
    let y = M;

    for (const p of list) {
      if (p.id === 'rows') {
        let yy = y;
        const gap = () => { yy += ROW_GAP; };
        let first = true;
        const next = () => { if (!first) gap(); first = false; };
        if (ctx.rows.bar) {
          next();
          if (s.polar) {
            g.text(s.polar === 'day' ? 'MIDNIGHT SUN' : 'POLAR NIGHT', M, yy, C.sun);
          } else {
            const right = 'SET ' + set;
            g.text(fitLabel(['SUNRISE ' + rise, 'RISE ' + rise, rise], right, inner), M, yy, C.sun);
            g.textR(right, W - M, yy, C.sun);
          }
          bar(g, M, yy + ROW + 2, inner, WT.sun.daylightFraction(s, now), C.sun);
          yy += ROW + 2 + 7;
        }
        if (ctx.rows.golden) {
          next();
          const morning = s.goldenMorningEnd !== null && now < s.goldenMorningEnd;
          const t = morning ? 'TILL ' + ctx.fmt(s.goldenMorningEnd) : (s.goldenEveningStart !== null ? ctx.fmt(s.goldenEveningStart) : '--:--');
          g.text(fitLabel(['GOLDEN HOUR', 'GOLDEN HR', 'GOLDEN'], t, inner), M, yy, C.sun);
          g.textR(t, W - M, yy, C.sun);
          yy += ROW;
        }
        if (ctx.rows.length) {
          next();
          const t = WT.sun.formatLength(s.dayLength);
          g.text(fitLabel(['DAY LENGTH', 'DAYLIGHT', 'DAY'], t, inner), M, yy, C.text);
          g.textR(t, W - M, yy, C.text);
          yy += ROW;
        }
        if (ctx.rows.moon) {
          next();
          moonDisc(g, M + 3, yy + 3, 3, m, ctx.southern, C.moon);
          const name = fitLabel([m.name, m.name.replace('WAXING ', 'WAX ').replace('WANING ', 'WAN '), 'MOON'], pct, inner - 10);
          g.text(name, M + 10, yy, C.moon);
          g.textR(pct, W - M, yy, C.moon);
          yy += ROW;
        }
      } else if (p.id === 'arc') {
        const moonR = 9;
        const x0 = M + 1, x1 = W - M - moonR * 2 - 8, hy = y + 20, peak = 12;
        const up = WT.sun.isUp(ctx.place, now);
        const f = WT.sun.daylightFraction(s, now);
        for (let x = x0; x <= x1; x++) g.set(x, hy, C.text, 0.5);                       // horizon
        if (!s.polar) {
          const arcY = (u) => hy - Math.sin(Math.PI * u) * peak;
          const span = s.sunset - s.sunrise;
          for (let i = 0; i <= 64; i++) {
            const u = i / 64, t = s.sunrise + u * span;
            const golden = (s.goldenMorningEnd !== null && t < s.goldenMorningEnd) || (s.goldenEveningStart !== null && t > s.goldenEveningStart);
            g.set(x0 + u * (x1 - x0), arcY(u), golden ? C.sun : C.sky, 0.45);
          }
          const sx = x0 + f * (x1 - x0), sy = up ? arcY(f) : hy + 3;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5) g.set(sx + dx, sy + dy, C.sun, up ? 1 : 0.3);
          g.text(rise, x0, hy + 3, C.sun);
          g.textR(set, x1, hy + 3, C.sun);
        } else {
          const msg = s.polar === 'day' ? 'MIDNIGHT SUN' : 'POLAR NIGHT';
          g.text(msg, Math.round((x0 + x1 - D.textWidth(msg)) / 2), hy + 3, C.sun);
        }
        const len = WT.sun.formatLength(s.dayLength);
        g.text(len, Math.round((x0 + x1 - D.textWidth(len)) / 2), y, C.text);
        const mcx = W - M - moonR - 1;
        moonDisc(g, mcx, y + moonR, moonR, m, ctx.southern, C.moon);
        g.text(pct, Math.round(mcx - D.textWidth(pct) / 2 + 0.5), hy + 3, C.moon);
      } else if (p.id === 'compact') {
        let x = M;
        g.cols(colsOf(SUN7), x, y, C.sun); x += 9;
        x += g.text(rise, x, y, C.sun) + 5;
        g.cols(colsOf(SUN7), x, y, C.sun, 0.35); x += 9;
        g.text(set, x, y, C.sun);
        g.textR(pct, W - M - 11, y, C.moon);
        moonDisc(g, W - M - 4, y + 3, 3, m, ctx.southern, C.moon);
      }
      y += HEIGHTS[p.id](ctx) + GAP;
    }
    return g;
  }

  function colsOf(rows) {
    const out = [];
    for (let x = 0; x < rows[0].length; x++) {
      let mm = 0;
      for (let r = 0; r < 7; r++) if (rows[r][x] === '1') mm |= 1 << r;
      out.push(mm);
    }
    return out;
  }

  /** Widest the compact line can be, so callers can keep the widget wide enough. */
  function minWidth(fmtSample) {
    return M * 2 + 9 + D.textWidth(fmtSample) + 5 + 9 + D.textWidth(fmtSample) + 5 + D.textWidth('100%') + 11;
  }

  WT.panels = { build, minWidth, HEIGHTS, ARC_H, M, GAP };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
