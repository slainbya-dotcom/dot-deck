/* 5x7 dot-matrix font, sun/moon icons, row layout and canvas renderer. */
(function (WT) {
  'use strict';

  // Each glyph: 7 rows of 5 columns, '1' = lit.
  const G = {
    A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
    C: '01110 10001 10000 10000 10000 10001 01110', D: '11100 10010 10001 10001 10001 10010 11100',
    E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
    G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
    I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
    K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
    M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
    O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
    Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
    S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
    U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
    W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
    Y: '10001 10001 10001 01010 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
    0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
    2: '01110 10001 00001 00010 00100 01000 11111', 3: '11111 00010 00100 00010 00001 10001 01110',
    4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
    6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
    8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
    ' ': '000 000 000 000 000 000 000',
    '.': '00000 00000 00000 00000 00000 01100 01100', ',': '00000 00000 00000 00000 01100 00100 01000',
    ':': '00000 01100 01100 00000 01100 01100 00000', ';': '00000 01100 01100 00000 01100 00100 01000',
    '-': '00000 00000 00000 11111 00000 00000 00000', '+': '00000 00100 00100 11111 00100 00100 00000',
    "'": '01100 00100 01000 00000 00000 00000 00000', '"': '01010 01010 01010 00000 00000 00000 00000',
    '/': '00000 00001 00010 00100 01000 10000 00000', '(': '00010 00100 01000 01000 01000 00100 00010',
    ')': '01000 00100 00010 00010 00010 00100 01000', '&': '01100 10010 10100 01000 10101 10010 01101',
    '?': '01110 10001 00001 00010 00100 00000 00100', '!': '00100 00100 00100 00100 00100 00000 00100',
    '_': '00000 00000 00000 00000 00000 00000 11111', '=': '00000 00000 11111 00000 11111 00000 00000',
    '#': '01010 01010 11111 01010 11111 01010 01010', '*': '00000 00100 10101 01110 10101 00100 00000',
    '@': '01110 10001 00001 01101 10101 10101 01110',
    '%': '11001 11010 00010 00100 01000 01011 10011',
  };
  // Punctuation is drawn proportionally (blank side columns trimmed).
  const NARROW = new Set(['.', ',', ':', ';', "'", '!', '(', ')', '"']);

  const ICONS = {
    sun: '1001001 0100010 0011100 1011101 0011100 0100010 1001001',
    moon: '0011110 0111000 1110000 1110000 1110000 0111000 0011110',
  };

  /** Bitmap string -> array of column bitmasks (bit 0 = top row). */
  function toColumns(bitmap, trim) {
    const rows = bitmap.split(' ');
    const w = rows[0].length;
    let cols = [];
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let y = 0; y < 7; y++) if (rows[y][x] === '1') m |= 1 << y;
      cols.push(m);
    }
    if (trim) {
      let a = 0, b = cols.length - 1;
      while (a < b && cols[a] === 0) a++;
      while (b > a && cols[b] === 0) b--;
      cols = cols.slice(a, b + 1);
    }
    return cols;
  }

  const GLYPHS = {};
  for (const ch of Object.keys(G)) GLYPHS[ch] = toColumns(G[ch], NARROW.has(ch));
  const ICON_COLS = { sun: toColumns(ICONS.sun), moon: toColumns(ICONS.moon) };

  const SPECIAL = {
    'ß': 'SS', 'Æ': 'AE', 'æ': 'AE', 'Œ': 'OE', 'œ': 'OE', 'Ø': 'O', 'ø': 'O', 'Ł': 'L', 'ł': 'L',
    'Đ': 'D', 'đ': 'D', 'Ð': 'D', 'ð': 'D', 'Þ': 'TH', 'þ': 'TH', 'ı': 'I',
    '‘': "'", '’': "'", 'ʻ': "'", 'ʼ': "'", '`': "'", '“': '"', '”': '"',
    '–': '-', '—': '-', '·': '.', '…': '...',
  };

  /** Uppercase ASCII approximation of any label so it can be drawn. */
  function normalizeText(s) {
    let out = '';
    for (const ch of String(s || '')) out += SPECIAL[ch] !== undefined ? SPECIAL[ch] : ch;
    out = out.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    let res = '';
    for (const ch of out) res += GLYPHS[ch] ? ch : (/\s/.test(ch) ? ' ' : '?');
    return res;
  }

  function hasGlyph(ch) { return !!GLYPHS[ch]; }

  /** Text -> column bitmasks with 1 blank column between glyphs. */
  function textColumns(s) {
    const cols = [];
    const txt = normalizeText(s);
    for (let i = 0; i < txt.length; i++) {
      if (i > 0) cols.push(0);
      for (const c of GLYPHS[txt[i]]) cols.push(c);
    }
    return cols;
  }

  function textWidth(s) { return textColumns(s).length; }

  // Layout constants, in dots.
  const MARGIN = 3, GAP = 5, ROW_H = 7, ROW_GAP = 4, MAX_LABEL = 28;

  /**
   * rows: [{label, time?, zone?, day?, color}]
   * Returns {w, h, lit: Uint8Array (0 = off, n = colour index + 1), colors: []}
   */
  function layout(rows) {
    const cooked = rows.map((r) => ({
      label: textColumns(String(r.label || '').slice(0, MAX_LABEL)),
      time: r.time ? textColumns(r.time) : null,
      zone: r.zone ? textColumns(r.zone) : null,
      icon: r.day === undefined ? null : ICON_COLS[r.day ? 'sun' : 'moon'],
      color: r.color,
    }));
    const max = (k) => cooked.reduce((m, r) => Math.max(m, r[k] ? r[k].length : 0), 0);
    const wl = max('label'), wt = max('time'), wz = max('zone'), wi = max('icon');
    const xTime = MARGIN + wl + (wt ? GAP : 0);
    const xZone = xTime + wt + (wz ? GAP : 0);
    const xIcon = xZone + wz + (wi ? GAP : 0);
    const w = xIcon + wi + MARGIN;
    const h = MARGIN * 2 + cooked.length * ROW_H + Math.max(0, cooked.length - 1) * ROW_GAP;

    const lit = new Uint8Array(w * h);
    const colors = [];
    cooked.forEach((r, i) => {
      let ci = colors.indexOf(r.color);
      if (ci < 0) { colors.push(r.color); ci = colors.length - 1; }
      const y0 = MARGIN + i * (ROW_H + ROW_GAP);
      const blit = (cols, x0) => {
        if (!cols) return;
        cols.forEach((m, dx) => {
          for (let y = 0; y < 7; y++) if (m & (1 << y)) lit[(y0 + y) * w + x0 + dx] = ci + 1;
        });
      };
      blit(r.label, MARGIN);
      if (r.time) blit(r.time, xTime + (wt - r.time.length)); // right-align times
      blit(r.zone, xZone);
      blit(r.icon, xIcon);
    });
    return { w, h, lit, colors };
  }

  /**
   * Draws rows onto a canvas. opts: {dotSize, dotShape, showUnlit, dotColor}
   * Returns the CSS pixel size {width, height}.
   */
  function render(canvas, rows, opts) {
    const g = layout(rows);
    const pitch = opts.dotSize;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const width = g.w * pitch, height = g.h * pitch;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const round = opts.dotShape !== 'square';
    const r = pitch * 0.4;
    const side = pitch * 0.8;
    const paths = g.colors.map(() => new Path2D());
    const unlit = new Path2D();
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const v = g.lit[y * g.w + x];
        if (!v && !opts.showUnlit) continue;
        const p = v ? paths[v - 1] : unlit;
        const cx = x * pitch + pitch / 2, cy = y * pitch + pitch / 2;
        if (round) { p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, Math.PI * 2); }
        else p.rect(cx - side / 2, cy - side / 2, side, side);
      }
    }
    if (opts.showUnlit) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = opts.dotColor;
      ctx.fill(unlit);
    }
    ctx.globalAlpha = 1;
    g.colors.forEach((c, i) => { ctx.fillStyle = c; ctx.fill(paths[i]); });
    return { width, height };
  }

  // ---- Dot Timer layout ------------------------------------------------------
  // Each timer = a text line (label left, time right) + a 7-dot "loading bar".
  const TEXT_BAR_GAP = 2, BAR_H = 7, TIMER_GAP = 4;
  const TIMER_H = ROW_H + TEXT_BAR_GAP + BAR_H;

  /** Text columns, trimmed from the end until they fit in maxW dots. */
  function fitColumns(text, maxW) {
    let s = String(text || '');
    let cols = textColumns(s);
    while (cols.length > maxW && s.length) {
      s = s.slice(0, -1).trimEnd();
      cols = textColumns(s);
    }
    return cols.length > maxW ? [] : cols;
  }

  /** Total widget height in dots for n timers (n = 0 shows a one-line message). */
  function timersHeight(n) {
    return n ? MARGIN * 2 + n * TIMER_H + (n - 1) * TIMER_GAP : MARGIN * 2 + ROW_H;
  }

  /** Top of timer i's text line, in dots (used to place the hover buttons). */
  function timerTop(i) { return MARGIN + i * (TIMER_H + TIMER_GAP); }

  /**
   * rows: [{label, time, slot (dots reserved for the time), frac (0–1 of bar lit),
   *         timeAlpha (0 hides the time, e.g. while flashing), color}]
   * W: total width in dots. Returns a grid {w, h, cidx, alpha, colors}.
   */
  function layoutTimers(rows, W) {
    const h = timersHeight(rows.length);
    const cidx = new Uint8Array(W * h);
    const alpha = new Float32Array(W * h);
    const colors = [];
    const set = (x, y, ci, a) => {
      if (x < 0 || x >= W || y < 0 || y >= h) return;
      cidx[y * W + x] = ci + 1;
      alpha[y * W + x] = a;
    };
    const blit = (cols, x0, y0, ci, a) => {
      cols.forEach((m, dx) => {
        for (let y = 0; y < 7; y++) if (m & (1 << y)) set(x0 + dx, y0 + y, ci, a);
      });
    };
    const inner = W - MARGIN * 2;

    rows.forEach((r, i) => {
      let ci = colors.indexOf(r.color);
      if (ci < 0) { colors.push(r.color); ci = colors.length - 1; }
      const y0 = timerTop(i);
      const timeCols = r.time ? textColumns(r.time) : [];
      const slot = Math.max(r.slot || 0, timeCols.length);
      const labelCols = fitColumns(r.label, Math.max(0, inner - (slot ? slot + GAP : 0)));
      blit(labelCols, MARGIN, y0, ci, 1);
      const ta = r.timeAlpha === undefined ? 1 : r.timeAlpha;
      if (ta > 0) blit(timeCols, MARGIN + inner - timeCols.length, y0, ci, ta);
      if (r.frac === undefined) return;

      // Loading bar: rounded frame, 1-dot gap, 3-dot-high fill.
      const by = y0 + ROW_H + TEXT_BAR_GAP, bx = MARGIN, bw = inner;
      for (let x = 1; x < bw - 1; x++) { set(bx + x, by, ci, 1); set(bx + x, by + BAR_H - 1, ci, 1); }
      for (let y = 1; y < BAR_H - 1; y++) { set(bx, by + y, ci, 1); set(bx + bw - 1, by + y, ci, 1); }
      const iw = bw - 4;
      const f = Math.max(0, Math.min(1, r.frac)) * iw;
      const full = Math.floor(f), part = f - full;
      for (let x = 0; x < iw; x++) {
        const a = x < full ? 1 : (x === full && part > 0.08 ? 0.25 + 0.6 * part : 0);
        if (a) for (let y = 2; y <= 4; y++) set(bx + 2 + x, by + y, ci, a);
      }
    });
    if (!rows.length) {
      colors.push(null);
    }
    return { w: W, h, cidx, alpha, colors };
  }

  /** Draws a grid from layoutTimers. opts: {dotSize, dotShape, showUnlit, dotColor}. */
  function drawGrid(canvas, g, opts) {
    const pitch = opts.dotSize;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const width = g.w * pitch, height = g.h * pitch;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const round = opts.dotShape !== 'square';
    const r = pitch * 0.4, side = pitch * 0.8;
    const paths = new Map(); // "colourIndex|alpha" -> Path2D
    const unlit = new Path2D();
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const k = y * g.w + x;
        const v = g.cidx[k];
        if (!v && !opts.showUnlit) continue;
        let p = unlit;
        if (v) {
          const key = (v - 1) + '|' + (Math.round(g.alpha[k] * 4) / 4);
          p = paths.get(key);
          if (!p) { p = new Path2D(); paths.set(key, p); }
        }
        const cx = x * pitch + pitch / 2, cy = y * pitch + pitch / 2;
        if (round) { p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, Math.PI * 2); }
        else p.rect(cx - side / 2, cy - side / 2, side, side);
      }
    }
    if (opts.showUnlit) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = opts.dotColor;
      ctx.fill(unlit);
    }
    for (const [key, p] of paths) {
      const [ci, a] = key.split('|');
      ctx.globalAlpha = Math.max(0.12, Number(a));
      ctx.fillStyle = g.colors[Number(ci)] || opts.dotColor;
      ctx.fill(p);
    }
    ctx.globalAlpha = 1;
    return { width, height };
  }

  WT.dots = {
    normalizeText, hasGlyph, textColumns, textWidth, layout, render, MAX_LABEL, MARGIN, GAP,
    fitColumns, timersHeight, timerTop, layoutTimers, drawGrid, TIMER_H, ROW_H, TEXT_BAR_GAP, BAR_H,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
