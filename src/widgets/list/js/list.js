/* Dot List: the checklist drawn as a dot grid (pure, no DOM). The grid carries click
 * regions ("hits") that the widget turns into actions. */
(function (WT) {
  'use strict';
  const WHITE = '#e8e4d0', GREEN = '#39ff7a', RED = '#ff5a4a';
  const MAX_TASKS = 100;
  const MAX_TEXT = 80;
  const SETTLE = 900;      // ms a ticked task stays put before it sinks (or hides)

  const BOX = ['1111111', '1000001', '1000001', '1000001', '1000001', '1000001', '1111111'];
  const TICK = ['0000000', '0000001', '0000010', '1000100', '0101000', '0010000', '0000000'];
  const PLUS = ['0000000', '0001000', '0001000', '0111110', '0001000', '0001000', '0000000'];
  const CROSS = ['00000', '10001', '01010', '00100', '01010', '10001', '00000'];

  /** Tasks in the order shown: to-do first (in your order), then done ones once they've settled. */
  function ordered(tasks, doneMode, now) {
    const settled = (x) => x.done && now - (x.doneAt || 0) > SETTLE;
    const open = tasks.filter((x) => !settled(x));
    if (doneMode === 'hide') return open;
    return open.concat(tasks.filter(settled));
  }

  /** Local midnight that started the day containing `now`. */
  function startOfDay(now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  /** Drops tasks that were ticked before today (for "clear done tasks overnight"). */
  function clearOvernight(tasks, now) {
    const today = startOfDay(now);
    return tasks.filter((x) => !(x.done && (x.doneAt || 0) < today));
  }

  /** How many rows are drawn (plus the add row). */
  function rowCount(state, now) {
    return Math.min(state.rows, Math.max(1, ordered(state.tasks, state.doneMode, now).length));
  }
  function height(state, now) {
    return WT.dots.MARGIN * 2 + (rowCount(state, now) + 1) * 10 - 3;
  }

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

  /** Fits text in [x0, x1): scrolls round when `scroll` is given and it's too long, else trims with "..". */
  function line(g, s, x0, x1, y, c, a, scroll) {
    const D = WT.dots;
    s = D.normalizeText(s);
    const tw = D.textWidth(s), room = x1 - x0;
    if (tw <= room) { g.text(s, x0, y, c, a); return tw; }
    if (scroll !== undefined && scroll !== null) {
      const loop = tw + 18, o = Math.floor(scroll) % loop;
      g.text(s, x0 - o, y, c, a, [x0, x1]); g.text(s, x0 - o + loop, y, c, a, [x0, x1]);
      return room;
    }
    while (s && D.textWidth(s + '..') > room) s = s.slice(0, -1);
    return g.text(s.trimEnd() + '..', x0, y, c, a);
  }

  /**
   * opts: { W, state, now, t (seconds, for the cursor blink and hover scroll), hover (task id),
   *         hoverScroll (seconds hovered), scroll (first visible row), editing ({text} or null), color, doneColor }
   * state: { tasks: [{id, text, done, doneAt}], rows, doneMode 'sink'|'hide' }
   */
  function build(opts) {
    const D = WT.dots, M = D.MARGIN;
    const { W, state } = opts;
    const now = opts.now || Date.now();
    const t = opts.t || 0;
    const main = opts.color || '#ffb000';
    const doneC = opts.doneColor || GREEN;
    const all = ordered(state.tasks, state.doneMode, now);
    const n = rowCount(state, now);
    const g = grid(W, height(state, now));
    const maxTop = Math.max(0, all.length - state.rows);
    const top = Math.max(0, Math.min(maxTop, opts.scroll || 0));
    g.scrollTop = top;
    g.maxScroll = maxTop;

    all.slice(top, top + state.rows).forEach((item, i) => {
      const y = M + i * 10;
      const hov = opts.hover === item.id;
      g.bits(BOX, M, y, item.done ? doneC : main, item.done ? 0.7 : 1);
      if (item.done) g.bits(TICK, M, y, doneC);
      const tx = M + 10, right = W - M - (hov ? 9 : all.length > state.rows ? 3 : 0);
      const w = line(g, item.text, tx, right, y, item.done ? WHITE : main, item.done ? 0.35 : 1, hov ? (opts.hoverScroll !== undefined ? opts.hoverScroll : t) * 18 : null);
      if (item.done) for (let x = tx; x < tx + w; x++) g.set(x, y + 3, WHITE, 0.35);   // crossed through
      if (hov) g.bits(CROSS, W - M - 5, y, RED, 0.85);
      g.hit(M - 1, y - 1, hov ? W - M - 8 : W - M, y + 8, 'tick', { id: item.id });
      if (hov) g.hit(W - M - 7, y - 1, W - M, y + 8, 'del', { id: item.id });
    });
    if (!all.length) g.text(D.normalizeText('NOTHING TO DO'), M + 10, M, WHITE, 0.3);

    // A thin bar on the right shows where you are in a long list.
    if (all.length > state.rows) {
      const H = n * 10 - 3;
      const a = Math.floor((top / all.length) * H), b = Math.ceil(((top + state.rows) / all.length) * H);
      for (let y = 0; y < H; y++) g.set(W - M - 1, M + y, WHITE, y >= a && y < b ? 0.7 : 0.15);
    }

    // The add row: "+ ADD A TASK", or what you're typing with a blinking cursor.
    const ay = M + n * 10;
    if (opts.editing) {
      g.bits(PLUS, M, ay, main);
      const room = W - M - (M + 10) - 3;
      let s = D.normalizeText(opts.editing.text);
      while (s && D.textWidth(s) > room) s = s.slice(1);    // keep the end in view while typing
      const w = g.text(s, M + 10, ay, WHITE);
      if (Math.floor(t * 2.5) % 2 === 0) for (let j = 0; j < 7; j++) g.set(M + 10 + w + 1, ay + j, main);
    } else if (state.tasks.length >= MAX_TASKS) {
      g.text('LIST IS FULL', M + 10, ay, WHITE, 0.3);
    } else {
      g.bits(PLUS, M, ay, main, 0.5);
      g.text('ADD A TASK', M + 10, ay, WHITE, 0.35);
    }
    g.hit(M - 1, ay - 1, W - M, ay + 8, 'add');
    return g;
  }

  function hitAt(g, gx, gy) {
    return g.hits.find((h) => gx >= h.x0 && gx < h.x1 && gy >= h.y0 && gy < h.y1) || null;
  }

  WT.list = { MAX_TASKS, MAX_TEXT, SETTLE, ordered, startOfDay, clearOvernight, rowCount, height, build, hitAt, WHITE, GREEN, RED };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
