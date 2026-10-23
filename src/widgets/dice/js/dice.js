/* Dot Dice: the dice, fair rolls, and drawing the widget as a dot grid (pure, no DOM).
 * The grid carries click regions ("hits") that the widget turns into actions. */
(function (WT) {
  'use strict';
  const WHITE = '#e8e4d0', GREEN = '#39ff7a', RED = '#ff5a4a';
  const MAX = 10;            // dice per roll
  const MAX_SAVED = 8;
  const SIZE = 17;           // die drawing, in dots

  // ---- shapes (unit-radius wireframes) -------------------------------------------------------------
  const PHI = (1 + Math.sqrt(5)) / 2;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  function edgesByDistance(v) {
    let min = Infinity;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) min = Math.min(min, dist(v[i], v[j]));
    const e = [];
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (dist(v[i], v[j]) < min * 1.01) e.push([i, j]);
    return e;
  }
  /** Every sign combination of each point (0 stays 0). */
  function signs(list) {
    const out = [];
    for (const p of list) {
      const o = p.map((c) => (c === 0 ? [0] : [c, -c]));
      for (const a of o[0]) for (const b of o[1]) for (const c of o[2]) out.push([a, b, c]);
    }
    return out;
  }
  function solid(verts, edges) {
    const r = Math.max(...verts.map((p) => Math.hypot(...p)));
    const v = verts.map((p) => p.map((c) => c / r));
    return { v, e: edges || edgesByDistance(v) };
  }
  /** The d10 shape: two five-sided pyramids, twisted. */
  function trapezohedron() {
    const v = [[0, 1, 0], [0, -1, 0]];
    for (let k = 0; k < 5; k++) { const a = (k * 2 * Math.PI) / 5; v.push([Math.cos(a), 0.12, Math.sin(a)]); }
    for (let k = 0; k < 5; k++) { const a = ((k + 0.5) * 2 * Math.PI) / 5; v.push([Math.cos(a), -0.12, Math.sin(a)]); }
    const e = [];
    for (let k = 0; k < 5; k++) e.push([0, 2 + k], [1, 7 + k], [2 + k, 7 + k], [7 + k, 2 + ((k + 1) % 5)]);
    return solid(v, e);
  }

  const DICE = [
    { id: 'd4', label: 'D4', sides: 4, color: '#ff6bd5', shape: solid([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) },
    { id: 'd6', label: 'D6', sides: 6, color: '#5ad1ff', shape: solid(signs([[1, 1, 1]])) },
    { id: 'd8', label: 'D8', sides: 8, color: '#3fd6c6', shape: solid([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) },
    { id: 'd10', label: 'D10', sides: 10, color: '#ffb000', shape: trapezohedron() },
    { id: 'd12', label: 'D12', sides: 12, color: '#b8ff5a', shape: solid(signs([[1, 1, 1], [0, 1 / PHI, PHI], [1 / PHI, PHI, 0], [PHI, 0, 1 / PHI]])) },
    { id: 'd20', label: 'D20', sides: 20, color: '#ff8a3d', shape: solid(signs([[0, 1, PHI], [1, PHI, 0], [PHI, 0, 1]])) },
    { id: 'd00', label: 'D00', sides: 10, tens: true, color: '#c9a0ff', shape: trapezohedron() },
  ];
  const IDS = DICE.map((d) => d.id);
  const byId = (id) => DICE.find((d) => d.id === id) || null;
  const emptyCounts = () => Object.fromEntries(IDS.map((id) => [id, 0]));

  // ---- rolling --------------------------------------------------------------------------------------
  /** Fair whole number in [0, n): the system's secure random source, without modulo bias. */
  function randInt(n) {
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (!c) return Math.floor(Math.random() * n);
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do { c.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }
  /** One die: d00 gives 00, 10 ... 90; the others 1..sides. */
  function roll1(die, rnd) {
    const r = rnd || randInt;
    return die.tens ? r(10) * 10 : 1 + r(die.sides);
  }
  /** Rolls every die in `counts` ({d6: 2, ...}) in tray order: [{id, value}]. */
  function rollCounts(counts, rnd) {
    const out = [];
    for (const d of DICE) for (let i = 0; i < (counts[d.id] || 0); i++) out.push({ id: d.id, value: roll1(d, rnd) });
    return out;
  }
  const count = (counts) => IDS.reduce((a, id) => a + (counts[id] || 0), 0);
  const show = (id, v) => (byId(id).tens && v >= 0 && v < 100 ? String(v).padStart(2, '0') : String(v));
  /** "2D20+1D6+3" */
  function formula(counts, mod) {
    const f = DICE.filter((d) => counts[d.id]).map((d) => counts[d.id] + d.label).join('+');
    if (!f) return mod ? String(mod) : '';
    return mod ? f + (mod > 0 ? '+' : '-') + Math.abs(mod) : f;
  }
  /** Total of a roll with a flat modifier. */
  const sum = (vals, mod) => vals.reduce((a, x) => a + x.value, 0) + (mod || 0);
  const countsOf = (vals) => { const c = emptyCounts(); for (const v of vals) c[v.id]++; return c; };

  // ---- drawing --------------------------------------------------------------------------------------
  function grid(w, h) {
    const D = WT.dots, M = D.MARGIN;
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [], hits: [] };
    const ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a, keep) => {
      x = Math.round(x); y = Math.round(y);
      if (x < M || y < 0 || x >= w - M || y >= h) return;
      const k = y * w + x, al = a === undefined ? 1 : a;
      if (keep && g.cidx[k] && g.alpha[k] >= al) return;   // a faint back edge never dims a front one
      g.cidx[k] = ci(c) + 1; g.alpha[k] = al;
    };
    g.text = (s, x, y, c, a, k) => {
      k = k || 1;
      D.textColumns(s).forEach((m, i) => {
        for (let r = 0; r < 7; r++) if (m & (1 << r)) for (let dx = 0; dx < k; dx++) for (let dy = 0; dy < k; dy++) g.set(x + i * k + dx, y + r * k + dy, c, a);
      });
      return D.textWidth(s) * k;
    };
    g.line = (x0, y0, x1, y1, c, a) => {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 200; guard++) {
        g.set(x0, y0, c, a, true);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    };
    g.hit = (x0, y0, x1, y1, action, extra) => g.hits.push(Object.assign({ x0, y0, x1, y1, action }, extra || {}));
    return g;
  }

  /** A slowly spinning wireframe die centred on (cx, cy). Edges facing away are faint. */
  function drawDie(g, die, cx, cy, size, angle, color, bright) {
    const tilt = 0.5 + 0.15 * Math.sin(angle * 0.7);
    const ca = Math.cos(angle), sa = Math.sin(angle), ct = Math.cos(tilt), st = Math.sin(tilt);
    const R = (size - 1) / 2;
    const P = die.shape.v.map(([x, y, z]) => {
      const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
      const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
      return [cx + x1 * R, cy - y2 * R, z2];
    });
    const edges = die.shape.e.map(([a, b]) => ({ a, b, z: (P[a][2] + P[b][2]) / 2 })).sort((p, q) => p.z - q.z);
    for (const { a, b, z } of edges) g.line(P[a][0], P[a][1], P[b][0], P[b][1], color, (z > -0.05 ? 1 : 0.28) * (bright ? 1 : 0.45));
  }

  function button(g, label, x, y, on, action) {
    const D = WT.dots;
    const w = D.textWidth(label) + 6, a = on ? 0.9 : 0.35;
    for (let i = 1; i < w - 1; i++) { g.set(x + i, y, WHITE, a); g.set(x + i, y + 8, WHITE, a); }
    for (let j = 1; j < 8; j++) { g.set(x, y + j, WHITE, a); g.set(x + w - 1, y + j, WHITE, a); }
    g.text(label, x + 3, y + 1, WHITE, on ? 1 : 0.5);
    if (action) g.hit(x, y, x + w, y + 9, action);
    return w;
  }

  const DICE_H = SIZE + 1 + 7 + 3 + 16 + 3 + 9;      // dice view height without margins
  const LABEL_W = 47;                                 // saved-roll label: 8 characters
  const savedH = (n) => Math.max(1, n) * 7 + (Math.max(1, n) - 1) * 3;

  /** Height of the whole widget in dots for these settings. */
  function height(state) {
    const M = WT.dots.MARGIN;
    const parts = [];
    if (state.views.dice) parts.push(DICE_H);
    if (state.views.saved) parts.push(savedH(state.saved.length));
    return M * 2 + (parts.length ? parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * 7 : 7);
  }

  /**
   * opts: { W, t (seconds, for the spin), state, last, savedResults, spin, color, colors, crits }
   *   state.pool = {d4: n, ...}, state.mode 'sum'|'each', state.views, state.saved = [{id,label,counts,mod,mode}]
   *   last = { vals: [{id, value}], settling } or null — the main roll (values already "flickering" while settling)
   *   savedResults = { [id]: { vals, settling } }
   *   spin = { [dieId]: extra angle }
   *   colors = { d4: '#..', ... } (per-die), color = main text colour
   */
  function build(opts) {
    const D = WT.dots, M = D.MARGIN;
    const { W, state } = opts;
    const t = opts.t || 0;
    const main = opts.color || '#ffb000';
    const colors = opts.colors || Object.fromEntries(DICE.map((d) => [d.id, d.color]));
    const crit = (id, v, c) => (opts.crits !== false && id === 'd20' ? (v === 20 ? GREEN : v === 1 ? RED : c) : c);
    const g = grid(W, height(state));
    const fit = (s, room) => { s = D.normalizeText(s); while (s && D.textWidth(s) > room) s = s.slice(0, -1).trimEnd(); return s; };

    if (!state.views.dice && !state.views.saved) { g.text('TURN ON A VIEW', M, M, WHITE, 0.6); return g; }
    let top = M;

    if (state.views.dice) {
      const pool = state.pool;
      const n = count(pool);
      const slot = (W - M * 2) / DICE.length;
      DICE.forEach((d, i) => {
        const cx = M + slot * i + slot / 2;
        const k = pool[d.id] || 0;
        const ang = t * (k ? 0.9 : 0.35) + i * 0.9 + ((opts.spin && opts.spin[d.id]) || 0);
        drawDie(g, d, Math.round(cx - 0.5), top + (SIZE - 1) / 2, SIZE, ang, colors[d.id], k > 0);
        const lbl = d.label.slice(1);   // "20" under the d20; the pool line spells it out
        g.text(lbl, Math.round(cx - D.textWidth(lbl) / 2), top + SIZE + 1, k ? colors[d.id] : WHITE, k ? 1 : 0.4);
        if (k) g.text(String(k), Math.round(M + slot * i), top, WHITE, 1);
        g.hit(M + slot * i, top, M + slot * (i + 1), top + SIZE + 8, 'die', { die: d.id });
      });

      const y0 = top + SIZE + 1 + 7 + 3;
      const last = opts.last;
      if (!last) {
        if (!n) {
          g.text(fit('CLICK DICE TO ADD THEM', W - M * 2), M, y0, WHITE, 0.45);
          g.text(fit('RIGHT-CLICK TO REMOVE', W - M * 2), M, y0 + 9, WHITE, 0.3);
        } else {
          g.text(fit(formula(pool, 0), W - M * 2), M, y0, WHITE, 0.85);
          g.text('READY TO ROLL', M, y0 + 9, WHITE, 0.4);
        }
      } else if (state.mode === 'sum') {
        const a = last.settling ? 0.6 : 1;
        const tw = g.text(String(sum(last.vals, 0)), M, y0 + 1, WHITE, a, 2);
        const x = M + tw + 6, room = W - M - x;
        g.text(fit(formula(countsOf(last.vals), 0), room), x, y0, main, 0.9);
        g.text(fit(last.vals.map((v) => show(v.id, v.value)).join('+'), room), x, y0 + 9, WHITE, 0.5);
      } else {
        let x = M, y = y0;
        for (const v of last.vals) {
          const s = show(v.id, v.value), w = D.textWidth(s);
          if (x + w > W - M) { x = M; y += 9; }
          if (y > y0 + 9) break;
          g.text(s, x, y, last.settling ? colors[v.id] : crit(v.id, v.value, colors[v.id]), last.settling ? 0.55 : 1);
          x += w + 5;
        }
        if (y === y0 && !last.settling && last.vals.length > 1) {
          const nums = last.vals.map((v) => v.value);
          g.text(fit('HIGH ' + Math.max(...nums) + '  LOW ' + Math.min(...nums), W - M * 2), M, y0 + 9, WHITE, 0.45);
        }
      }

      const by = top + DICE_H - 9;
      const rw = button(g, 'ROLL', M, by, n > 0, n ? 'roll' : null);
      const clearW = D.textWidth('CLEAR') + 6;
      button(g, 'CLEAR', W - M - clearW, by, n > 0 || !!last, 'clear');
      const sw = D.textWidth('SUM') + 6, ew = D.textWidth('EACH') + 6;
      const tx = Math.round(M + rw + (W - M * 2 - rw - clearW - (sw + ew + 2)) / 2);
      button(g, 'SUM', tx, by, state.mode === 'sum', 'sum');
      button(g, 'EACH', tx + sw + 2, by, state.mode === 'each', 'each');
      top += DICE_H + 7;
    }

    if (state.views.saved) {
      if (state.views.dice) for (let x = M; x < W - M; x += 2) g.set(x, top - 4, WHITE, 0.25);
      if (!state.saved.length) { g.text(fit('ADD SAVED ROLLS IN SETTINGS', W - M * 2), M, top, WHITE, 0.45); return g; }
      state.saved.forEach((r, i) => {
        const y = top + i * 10;
        const res = opts.savedResults && opts.savedResults[r.id];
        let resW = 0;
        if (res && res.vals.length) {
          const a = res.settling ? 0.55 : 1;
          if (r.mode === 'sum') {
            const s = String(sum(res.vals, r.mod));
            resW = D.textWidth(s);
            g.text(s, W - M - resW, y, WHITE, a);
          } else {
            // Each die with the modifier added, in its colour (natural 20/1 still marked).
            const parts = res.vals.map((v) => ({ v, s: show(v.id, v.value + r.mod) }));
            resW = parts.reduce((s2, p) => s2 + D.textWidth(p.s), 0) + (parts.length - 1) * 4;
            const maxW = W - M * 2 - LABEL_W - 8;
            let x = W - M - Math.min(resW, maxW);
            for (const p of parts) {
              const w = D.textWidth(p.s);
              if (x + w > W - M) break;
              g.text(p.s, x, y, res.settling ? colors[p.v.id] : crit(p.v.id, p.v.value, colors[p.v.id]), a);
              x += w + 4;
            }
            resW = Math.min(resW, maxW);
          }
        }
        g.text(fit(r.label, LABEL_W), M, y, main);
        const fx = M + LABEL_W + 4;
        const f = formula(r.counts, r.mod) + (r.mode === 'each' ? ' EA' : '');
        g.text(fit(f || 'NO DICE', W - M - (resW ? resW + 5 : 0) - fx), fx, y, WHITE, 0.45);
        g.hit(M, y - 1, W - M, y + 8, 'saved', { id: r.id });
      });
    }
    return g;
  }

  /** Grid dot (gx, gy) -> the hit under it, if any. */
  function hitAt(g, gx, gy) {
    return g.hits.find((h) => gx >= h.x0 && gx < h.x1 && gy >= h.y0 && gy < h.y1) || null;
  }

  WT.dice = {
    DICE, IDS, MAX, MAX_SAVED, SIZE, byId, emptyCounts, randInt, roll1, rollCounts, count, show, formula, sum, countsOf,
    height, build, hitAt, WHITE, GREEN, RED,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
