/* Dot Clipboard: keeping the history, and drawing the two styles as a dot grid
 * (pure, no DOM). The grid carries click regions ("hits") for the widget. */
(function (WT) {
  'use strict';
  const WHITE = '#e8e4d0', AMBER = '#ffb000', GREEN = '#39ff7a', RED = '#ff5a4a', BLUE = '#5ad1ff', LIME = '#b8ff5a';
  const STYLES = ['history', 'latest'];
  const KEEP_TEXT = 2000;      // characters kept per clip
  const COPIED_MS = 900;

  // ---- history -------------------------------------------------------------------------------------
  /** Adds newly copied text: an existing copy moves to the top (keeping its pin). Trims old unpinned clips. */
  function addClip(clips, text, now, max, makeId) {
    const t = String(text).slice(0, KEEP_TEXT);
    if (!t.trim()) return clips;
    const old = clips.find((c) => c.text === t);
    const rest = clips.filter((c) => c !== old);
    const next = [{ id: old ? old.id : makeId(), text: t, at: now, pinned: old ? old.pinned : false }].concat(rest);
    // Pinned clips never count against the limit.
    let unpinned = 0;
    return next.filter((c) => c.pinned || ++unpinned <= max);
  }
  /** Display order: pinned first (in pin order), then newest first. */
  function ordered(clips) {
    return clips.filter((c) => c.pinned).concat(clips.filter((c) => !c.pinned).sort((a, b) => b.at - a.at));
  }
  /** For the "latest" style: newest first, pinned ones after. */
  function latestOrder(clips) {
    return clips.filter((c) => !c.pinned).sort((a, b) => b.at - a.at).concat(clips.filter((c) => c.pinned));
  }
  const kindOf = (s) => (/^\s*(https?:\/\/|www\.)\S+\s*$/i.test(s) ? 'link'
    : /\n/.test(s.trim()) ? 'lines'
    : /^[\s\d.,:+\-£$€%()#/]+$/.test(s) ? 'number' : 'text');
  function ago(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'NOW';
    if (m < 60) return m + 'M';
    const h = Math.floor(m / 60);
    return h < 24 ? h + 'H' : Math.floor(h / 24) + 'D';
  }
  /** One line for the widget: line breaks and tabs become spaces. */
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

  // ---- drawing ---------------------------------------------------------------------------------------
  const KIND = {
    text: ['0000000', '1111111', '0001000', '0001000', '0001000', '0001000', '0000000'],
    link: ['0000000', '0110000', '1001110', '1011001', '0110010', '0001100', '0000000'],
    number: ['0101000', '1111100', '0101000', '1111100', '0101000', '0000000', '0000000'],
    lines: ['0000000', '1111111', '0000000', '1111100', '0000000', '1111110', '0000000'],
  };
  const PIN = ['0011100', '0111110', '0111110', '0011100', '0001000', '0001000', '0001000'];
  const CROSS = ['00000', '10001', '01010', '00100', '01010', '10001', '00000'];
  const LEFT = ['000', '001', '011', '111', '011', '001', '000'];
  const RIGHT = ['000', '100', '110', '111', '110', '100', '000'];
  const kindColor = (k) => (k === 'link' ? BLUE : k === 'number' ? LIME : WHITE);

  function grid(w, h) {
    const D = WT.dots, M = D.MARGIN;
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [], hits: [] };
    const ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a, clip) => {
      x = Math.round(x); y = Math.round(y);
      if (x < M || y < 0 || x >= w - M || y >= h) return;
      if (clip && (x < clip[0] || x >= clip[1])) return;
      g.cidx[y * w + x] = ci(c) + 1; g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.text = (s, x, y, c, a, clip) => {
      D.textColumns(s).forEach((m, i) => { for (let r = 0; r < 7; r++) if (m & (1 << r)) g.set(x + i, y + r, c, a, clip); });
      return D.textWidth(s);
    };
    g.bits = (rows, x, y, c, a) => rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '1') g.set(x + i, y + j, c, a); });
    g.hit = (x0, y0, x1, y1, action, extra) => g.hits.push(Object.assign({ x0, y0, x1, y1, action }, extra || {}));
    return g;
  }
  function fit(s, room) {
    const D = WT.dots;
    s = D.normalizeText(s);
    if (D.textWidth(s) <= room) return s;
    while (s && D.textWidth(s + '..') > room) s = s.slice(0, -1);
    return s.trimEnd() + '..';
  }
  function marquee(g, s, x0, x1, y, c, a, off) {
    const D = WT.dots;
    s = D.normalizeText(s);
    const tw = D.textWidth(s);
    if (tw <= x1 - x0) { g.text(s, x0, y, c, a); return false; }
    const loop = tw + 18, o = Math.floor(Math.max(0, off)) % loop;
    g.text(s, x0 - o, y, c, a, [x0, x1]); g.text(s, x0 - o + loop, y, c, a, [x0, x1]);
    return true;
  }

  function height(state) {
    const M = WT.dots.MARGIN;
    if (state.style === 'latest') return M * 2 + 7 + 3 + 2;
    const n = Math.min(state.rows, Math.max(1, state.clips.length));
    return M * 2 + n * 10 - 3;
  }

  /**
   * opts: { W, state, now, hover (clip id), hoverScroll (s), scroll (row), index (latest style),
   *         copied ({id, at}) , t (seconds), color }
   * state: { style, rows, paused, clips: [{id, text, at, pinned}] }
   */
  function build(opts) {
    const D = WT.dots, M = D.MARGIN;
    const { W, state } = opts;
    const now = opts.now || Date.now();
    const main = opts.color || AMBER;
    const g = grid(W, height(state));
    const wasCopied = (c) => opts.copied && opts.copied.id === c.id && now - opts.copied.at < COPIED_MS;
    g.scrolling = false;

    if (state.style === 'latest') {
      const list = latestOrder(state.clips);
      const idx = Math.max(0, Math.min(list.length - 1, opts.index || 0));
      g.index = idx;
      if (!list.length) {
        g.text(fit(state.paused ? 'PAUSED: CLICK TO RESUME' : 'COPY SOMETHING', W - M * 2), M, M, WHITE, 0.4);
        if (state.paused) g.hit(M, M - 1, W - M, M + 8, 'resume');
        return g;
      }
      const c = list[idx];
      g.bits(LEFT, M, M, main, idx > 0 ? 0.9 : 0.25);
      g.bits(RIGHT, W - M - 3, M, main, idx < list.length - 1 ? 0.9 : 0.25);
      if (idx > 0) g.hit(M - 1, M - 1, M + 5, M + 8, 'prev');
      if (idx < list.length - 1) g.hit(W - M - 5, M - 1, W - M, M + 8, 'next');
      if (wasCopied(c)) g.text('COPIED', M + 7, M, GREEN);
      else g.scrolling = marquee(g, flat(c.text), M + 7, W - M - 6, M, c.pinned ? main : main, 1, (opts.t || 0) * 16);
      g.hit(M + 6, M - 1, W - M - 6, M + 8, 'copy', { id: c.id });
      // A dot per clip, showing where you are (paused: the dots go dim).
      const room = Math.floor((W - M * 2 - 14) / 4);
      list.slice(0, room).forEach((x, i) => { for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) g.set(M + 7 + i * 4 + k, M + 10 + j, i === idx ? WHITE : main, (i === idx ? 1 : 0.3) * (state.paused ? 0.4 : 1)); });
      return g;
    }

    // History: pinned on top, newest next. Hover a row for its pin and ✕; click it to copy again.
    const list = ordered(state.clips);
    const n = Math.min(state.rows, Math.max(1, list.length));
    const maxScroll = Math.max(0, list.length - state.rows);
    const top = Math.max(0, Math.min(maxScroll, opts.scroll || 0));
    g.scrollTop = top; g.maxScroll = maxScroll;
    if (!list.length) {
      g.text(fit(state.paused ? 'PAUSED: CLICK TO RESUME' : 'COPY SOMETHING TO START', W - M * 2), M, M, WHITE, 0.4);
      if (state.paused) g.hit(M, M - 1, W - M, M + 8, 'resume');
      return g;
    }
    const bar = maxScroll ? 3 : 0;
    list.slice(top, top + state.rows).forEach((c, i) => {
      const y = M + i * 10, hov = opts.hover === c.id;
      const k = kindOf(c.text);
      g.bits(c.pinned ? PIN : KIND[k], M, y, c.pinned ? main : kindColor(k), (c.pinned ? 1 : 0.7) * (state.paused ? 0.5 : 1));
      if (hov) {
        const right = W - M - 20 - bar;
        if (wasCopied(c)) g.text('COPIED', M + 10, y, GREEN);
        else g.scrolling = marquee(g, flat(c.text), M + 10, right, y, WHITE, 1, (opts.hoverScroll || 0) * 18) || g.scrolling;
        g.bits(PIN, W - M - 17 - bar, y, main, c.pinned ? 1 : 0.4);
        g.bits(CROSS, W - M - 5 - bar, y, RED, 0.85);
        g.hit(M - 1, y - 1, W - M - 18 - bar, y + 8, 'copy', { id: c.id });
        g.hit(W - M - 18 - bar, y - 1, W - M - 8 - bar, y + 8, 'pin', { id: c.id });
        g.hit(W - M - 7 - bar, y - 1, W - M - bar, y + 8, 'del', { id: c.id });
      } else {
        // The first row shows PAUSED instead of its age while paused (click it to resume).
        const tag = state.paused && i === 0 ? 'PAUSED' : c.pinned ? '' : ago(now - c.at);
        const tw = tag ? D.textWidth(tag) + 4 : 0;
        if (wasCopied(c)) g.text('COPIED', M + 10, y, GREEN);
        else g.text(fit(flat(c.text), W - M - 10 - M - tw - bar), M + 10, y, main, 0.95);
        if (tag) g.text(tag, W - M - bar - D.textWidth(tag), y, state.paused && i === 0 ? main : WHITE, state.paused && i === 0 ? 0.8 : 0.35);
        if (state.paused && i === 0) g.hit(W - M - bar - D.textWidth(tag) - 1, y - 1, W - M, y + 8, 'resume');
        g.hit(M - 1, y - 1, W - M - (state.paused && i === 0 ? tw + bar : 0), y + 8, 'copy', { id: c.id });
      }
    });
    if (maxScroll) {
      const H = n * 10 - 3;
      const a = Math.floor((top / list.length) * H), b = Math.ceil(((top + state.rows) / list.length) * H);
      for (let y = 0; y < H; y++) g.set(W - M - 1, M + y, WHITE, y >= a && y < b ? 0.7 : 0.15);
    }
    return g;
  }

  function hitAt(g, gx, gy) {
    return g.hits.find((h) => gx >= h.x0 && gx < h.x1 && gy >= h.y0 && gy < h.y1) || null;
  }

  WT.clip = { STYLES, KEEP_TEXT, COPIED_MS, addClip, ordered, latestOrder, kindOf, ago, flat, height, build, hitAt, WHITE, GREEN, RED };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
