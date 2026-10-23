/* Dot Ticker: message tokens, schedules and the five display styles, drawn
 * into a dot grid for WT.dots.drawGrid. Pure apart from reading the clock. */
(function (WT) {
  'use strict';
  const D = WT.dots;
  const M = 3, GAP = 4, ROW = 7;
  const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const STYLE_IDS = ['scroll', 'flip', 'tagged', 'board', 'type'];

  // ---- tokens ------------------------------------------------------------------
  /** Days from today until the next `day month` (e.g. 25 DEC), 0 on the day itself. */
  function daysUntil(day, monIdx, now) {
    const d = new Date(now);
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let target = new Date(d.getFullYear(), monIdx, day);
    if (target < today) target = new Date(d.getFullYear() + 1, monIdx, day);
    return Math.round((target - today) / 86400000);
  }

  /**
   * {TIME} 14:05 · {DATE} 22 OCT · {DAY} THURSDAY · {UNTIL 25 DEC} 64 DAYS
   * use24h controls {TIME}.
   */
  function fill(text, now, use24h) {
    const d = new Date(now);
    return String(text || '')
      .replace(/\{TIME\}/gi, WT.time.formatTime(WT.time.systemZone(), d, use24h !== false, false))
      .replace(/\{DATE\}/gi, d.getDate() + ' ' + MONTHS[d.getMonth()])
      .replace(/\{DAY\}/gi, DAYS[d.getDay()])
      .replace(/\{UNTIL\s+(\d{1,2})\s+([A-Z]{3})[A-Z]*\}/gi, (all, dd, mm) => {
        const mi = MONTHS.indexOf(mm.toUpperCase());
        if (mi < 0) return all;
        const n = daysUntil(Number(dd), mi, now);
        return n === 0 ? 'TODAY' : n === 1 ? '1 DAY' : n + ' DAYS';
      });
  }

  // ---- schedules ---------------------------------------------------------------
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  /** Is a message showing right now? schedule: {days:[0..6], from:'HH:MM'|'', to:'HH:MM'|''} */
  function isActive(msg, now) {
    if (!msg.enabled || !String(msg.text || '').trim()) return false;
    const s = msg.schedule || {};
    const d = new Date(now);
    const mins = d.getHours() * 60 + d.getMinutes();
    const from = toMin(s.from), to = toMin(s.to);
    // A window crossing midnight (22:00–02:00) belongs to the day it started.
    let day = d.getDay();
    if (from !== null && to !== null && from > to && mins < to) day = (day + 6) % 7;
    if (Array.isArray(s.days) && s.days.length && !s.days.includes(day)) return false;
    if (from === null && to === null) return true;
    if (from !== null && to !== null) return from <= to ? mins >= from && mins < to : mins >= from || mins < to;
    if (from !== null) return mins >= from;
    return mins < to;
  }

  /** The messages to show now, with tokens filled in. */
  function activeMessages(state, now) {
    return state.messages.filter((m) => isActive(m, now)).map((m) => ({
      id: m.id, text: fill(m.text, now, state.use24h).toUpperCase(), color: m.color, urgent: m.urgent,
    }));
  }

  // ---- drawing ---------------------------------------------------------------------
  function grid(w, h) {
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [] };
    g.ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      g.cidx[y * w + x] = g.ci(c) + 1;
      g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    /** Text clipped to columns [x0, x1); dy shifts it within its 7-dot row (for slides). */
    g.text = (s, x, y, c, x0, x1, dy, a) => {
      D.textColumns(s).forEach((m, i) => {
        const xx = x + i;
        if (xx < x0 || xx >= x1) return;
        for (let r = 0; r < 7; r++) {
          if (!(m & (1 << r))) continue;
          const yy = y + r + (dy || 0);
          if (yy >= y && yy < y + 7) g.set(xx, yy, c, a);
        }
      });
    };
    return g;
  }

  const HEIGHT = { scroll: ROW, flip: ROW, tagged: ROW, board: ROW * 2 + GAP, type: ROW };

  /** Total height (dots) for the enabled styles. */
  function height(styles) {
    const on = styles.filter((s) => s.enabled);
    if (!on.length) return M * 2 + ROW;
    return M * 2 + on.reduce((h, s) => h + HEIGHT[s.id], 0) + (on.length - 1) * GAP;
  }

  /**
   * ctx: {W, t (ms of animation time), msgs (active), styles, speed (dots/s), dir ('left'|'right'),
   *       hold (ms), sep, defaultColor, sepColor, now, use24h}
   */
  function build(ctx) {
    const W = ctx.W, x0 = M, x1 = W - M, area = x1 - x0;
    const g = grid(W, height(ctx.styles));
    const msgs = ctx.msgs.length ? ctx.msgs : [{ text: 'RIGHT-CLICK TO ADD MESSAGES', color: null }];
    const col = (m) => m.color || ctx.defaultColor;
    const t = ctx.t;
    const sep = '  ' + (ctx.sep || '*') + '  ';
    const flashOff = (m) => m.urgent && Math.floor(t / 400) % 2 === 1;
    const on = ctx.styles.filter((s) => s.enabled);
    if (!on.length) { g.text('RIGHT-CLICK TO CHOOSE A STYLE', M, M, ctx.defaultColor, 0, W); return g; }

    /** One continuous ribbon of every message, scrolled by `ctx.speed` dots per second. */
    function ribbon(y, left, right) {
      const parts = [];
      let len = 0;
      for (const m of msgs) {
        parts.push([m.text, col(m), m]); len += D.textWidth(m.text);
        parts.push([sep, ctx.sepColor, null]); len += D.textWidth(sep);
      }
      const span = right - left;
      const off = Math.floor(t / 1000 * ctx.speed) % (len + span);
      const start = ctx.dir === 'right' ? left - len + off : right - off;
      const step = (ctx.dir === 'right' ? -1 : 1) * (len + span); // where the repeat comes from
      for (let pass = 0; pass < 2; pass++) {
        let x = start + pass * step;
        for (const [s, c, m] of parts) {
          g.text(s, x, y, c, left, right, 0, m && flashOff(m) ? 0.35 : 1);
          x += D.textWidth(s);
        }
      }
    }

    /** A message that fits is centred; one that doesn't pans across during its hold. */
    function placed(s, phase, hold, left, right) {
      const w = D.textWidth(s), span = right - left;
      if (w <= span) return Math.round(left + (span - w) / 2);
      const k = Math.min(1, Math.max(0, (phase - hold * 0.15) / (hold * 0.7)));
      return Math.round(left - (w - span) * k);
    }

    let y = M;
    for (const st of on) {
      if (st.id === 'scroll') {
        ribbon(y, x0, x1);
      } else if (st.id === 'flip') {
        const SLIDE = 320, per = ctx.hold + SLIDE;
        const i = Math.floor(t / per) % msgs.length, ph = t % per;
        const cur = msgs[i], nxt = msgs[(i + 1) % msgs.length];
        if (ph < ctx.hold || msgs.length === 1) {
          g.text(cur.text, placed(cur.text, ph, ctx.hold, x0, x1), y, col(cur), x0, x1, 0, flashOff(cur) ? 0.35 : 1);
        } else {
          const k = Math.round(((ph - ctx.hold) / SLIDE) * 8);
          g.text(cur.text, placed(cur.text, ctx.hold, ctx.hold, x0, x1), y, col(cur), x0, x1, -k);
          g.text(nxt.text, placed(nxt.text, 0, ctx.hold, x0, x1), y, col(nxt), x0, x1, 8 - k);
        }
      } else if (st.id === 'tagged') {
        const tag = fill(st.tag || 'NOTE', ctx.now, ctx.use24h).toUpperCase();
        const tw = D.textWidth(tag);
        g.text(tag, x0, y, st.tagColor || ctx.sepColor, 0, W);
        for (let yy = y - 1; yy < y + 8; yy++) g.set(x0 + tw + 3, yy, st.tagColor || ctx.sepColor, 0.6);
        ribbon(y, x0 + tw + 7, x1);
      } else if (st.id === 'board') {
        const title = fill(st.title || '{DAY} {TIME}', ctx.now, ctx.use24h).toUpperCase();
        g.text(title, x0, y, st.titleColor || ctx.defaultColor, x0, x1);
        ribbon(y + ROW + GAP, x0, x1);
      } else if (st.id === 'type') {
        const PER_CHAR = 70;
        const lens = msgs.map((m) => m.text.length * PER_CHAR + ctx.hold);
        const cycle = lens.reduce((a, b) => a + b, 0);
        let ph = t % cycle, i = 0;
        while (ph >= lens[i]) { ph -= lens[i]; i++; }
        const m = msgs[i];
        const n = Math.min(m.text.length, Math.floor(ph / PER_CHAR));
        const shown = m.text.slice(0, n);
        const sw = D.textWidth(shown);
        const shift = Math.max(0, sw + 3 - area);          // keep the cursor in view on long messages
        g.text(shown, x0 - shift, y, col(m), x0, x1);
        if (Math.floor(t / 300) % 2 === 0 || n < m.text.length) {
          for (let yy = y; yy < y + 7; yy++) g.set(x0 - shift + sw + (shown ? 2 : 0), yy, col(m));
        }
      }
      y += HEIGHT[st.id] + GAP;
    }
    return g;
  }

  WT.ticker = { STYLE_IDS, fill, daysUntil, isActive, activeMessages, build, height, HEIGHT };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
