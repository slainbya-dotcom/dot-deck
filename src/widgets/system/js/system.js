/* Dot System: reading history, value formatting and the three styles
 * (scrolling graph, columns, dials) drawn into a dot grid. */
(function (WT) {
  'use strict';
  const D = WT.dots;
  const M = 3, RED = '#ff5a4a', WHITE = '#e8e4d0';
  const STYLES = ['graph', 'columns', 'dials'];
  const METRICS = [
    { id: 'cpu', label: 'CPU', short: 'C' },
    { id: 'mem', label: 'MEM', short: 'M' },
    { id: 'dsk', label: 'DSK', short: 'D' },
    { id: 'net', label: 'NET', short: 'N' },
    { id: 'bat', label: 'BAT', short: 'B' },
  ];
  const HIST = 400;

  /** Rolling history plus the latest reading. Network is scaled against recent peaks. */
  function createHistory() {
    return { cpu: [], mem: [], dsk: [], net: [], bat: [], peak: { cpu: 0, mem: 0, dsk: 0, net: 0, bat: 0 }, last: null, netMax: 1e6 };
  }

  /**
   * Adds a reading {cpu, mem, disk, net_down, net_up, battery|null, plugged, battery_minutes}.
   * Returns normalised 0–1 values {cpu, mem, dsk, net, bat}.
   */
  function push(h, r) {
    const netBytes = (r.net_down || 0) + (r.net_up || 0);
    // Network has no natural 100%: scale to the busiest second recently (at least 1 MB/s),
    // letting the scale relax slowly when things quieten down.
    h.netMax = Math.max(1e6, netBytes, h.netMax * 0.995);
    const v = {
      cpu: clamp(r.cpu), mem: clamp(r.mem), dsk: clamp(r.disk),
      net: clamp(netBytes / h.netMax), bat: r.battery === null || r.battery === undefined ? null : clamp(r.battery),
    };
    for (const k of ['cpu', 'mem', 'dsk', 'net', 'bat']) {
      h[k].push(v[k] === null ? 0 : v[k]);
      if (h[k].length > HIST) h[k].shift();
      h.peak[k] = Math.max(v[k] || 0, h.peak[k] - 0.03); // falling peak caps
    }
    h.last = Object.assign({ v, netBytes }, r);
    return v;
  }
  const clamp = (x) => Math.min(1, Math.max(0, Number(x) || 0));

  /** "42%", "21M", "640K", "12B" — short enough to sit under a column or dial. */
  function valueText(id, h) {
    const r = h.last;
    if (!r) return '--';
    if (id === 'net') {
      const b = r.netBytes;
      return b >= 1e6 ? Math.round(b / 1e6) + 'M' : b >= 1e3 ? Math.round(b / 1e3) + 'K' : Math.round(b) + 'B';
    }
    if (id === 'bat' && r.v.bat === null) return '--';
    return Math.round(r.v[id] * 100) + '%';
  }

  function grid(w, h) {
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [] };
    g.ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      g.cidx[y * w + x] = g.ci(c) + 1;
      g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.text = (s, x, y, c, a) => { D.textColumns(s).forEach((m, i) => { for (let r = 0; r < 7; r++) if (m & (1 << r)) g.set(x + i, y + r, c, a); }); return D.textWidth(s); };
    return g;
  }

  /** 11×7 battery: outline, nub, fill (red when low), lightning bolt when plugged in. */
  function battery(g, x, y, frac, plugged, c) {
    for (let i = 0; i < 10; i++) { g.set(x + i, y, c); g.set(x + i, y + 6, c); }
    for (let j = 0; j < 7; j++) { g.set(x, y + j, c); g.set(x + 9, y + j, c); }
    [2, 3, 4].forEach((j) => g.set(x + 10, y + j, c));
    const n = Math.round(frac * 7);
    for (let i = 0; i < n; i++) for (let j = 2; j <= 4; j++) g.set(x + 1 + i, y + j, frac < 0.2 ? RED : c, 0.9);
    if (plugged) [[5, 1], [4, 2], [3, 3], [4, 3], [5, 3], [6, 3], [5, 4], [4, 5]].forEach(([dx, dy]) => g.set(x + dx, y + dy, WHITE));
  }

  const GRAPH_H = 19, COL_H = 16, DIAL_R = 9;
  const HEIGHT = {
    graph: M * 2 + 7 + 3 + GRAPH_H + 1,
    columns: M * 2 + COL_H + 2 + 7 + 2 + 7,
    dials: M * 2 + DIAL_R + 2 + 7 + 2 + 7,
  };

  /**
   * ctx: {W, style, metrics: {cpu,mem,dsk,net,bat: bool}, colors: {cpu,…}, h (history), hasBattery}
   */
  function build(ctx) {
    const { W, h } = ctx;
    const g = grid(W, HEIGHT[ctx.style] || HEIGHT.graph);
    const on = METRICS.filter((m) => ctx.metrics[m.id] && (m.id !== 'bat' || ctx.hasBattery));
    const col = (m) => ctx.colors[m.id];
    const plugged = !!(h.last && h.last.plugged);
    if (!on.length) { g.text('RIGHT-CLICK TO CHOOSE MONITORS', M, M, WHITE); return g; }

    if (ctx.style === 'graph') {
      const traces = on.filter((m) => m.id !== 'bat');
      const bat = on.find((m) => m.id === 'bat');
      const right = W - M - (bat ? 14 : 0);
      const full = traces.map((m) => m.label + ' ' + valueText(m.id, h));
      const short = traces.map((m) => m.short + valueText(m.id, h));
      const wsum = (arr) => arr.reduce((s, t) => s + D.textWidth(t), 0) + Math.max(0, arr.length - 1) * 6;
      const labels = wsum(full) <= right - M ? full : short;
      let x = M;
      labels.forEach((t, i) => { if (x + D.textWidth(t) <= right) x += g.text(t, x, M, col(traces[i])) + 6; });
      if (bat) battery(g, W - M - 11, M, h.last && h.last.v.bat !== null ? h.last.v.bat : 0, plugged, col(bat));
      const top = M + 10, gw = W - M * 2;
      for (let x2 = 0; x2 < gw; x2 += 2) g.set(M + x2, top + GRAPH_H, WHITE, 0.25);
      traces.slice().reverse().forEach((m) => {
        const arr = h[m.id], n = Math.min(gw, arr.length);
        let prev = null;
        for (let i = 0; i < n; i++) {
          const y = top + GRAPH_H - Math.round(arr[arr.length - n + i] * GRAPH_H);
          // join big jumps with a short vertical run so the trace stays continuous
          if (prev !== null && Math.abs(y - prev) > 1) {
            const step = y > prev ? 1 : -1;
            for (let yy = prev + step; yy !== y; yy += step) g.set(M + i, yy, col(m), 0.6);
          }
          g.set(M + i, y, col(m));
          prev = y;
        }
      });
    } else if (ctx.style === 'columns') {
      const slot = Math.floor((W - M * 2) / on.length);
      const colW = Math.max(3, Math.min(13, slot - 6));
      on.forEach((m, i) => {
        const cx = M + i * slot + Math.floor(slot / 2), x0 = cx - Math.floor(colW / 2);
        const val = h.last ? (h.last.v[m.id] || 0) : 0;
        const n = Math.round(val * COL_H), pk = Math.round(h.peak[m.id] * COL_H);
        for (let k = 0; k < COL_H; k++) {
          const y = M + COL_H - 1 - k;
          const c = m.id === 'bat' ? (val < 0.2 ? RED : col(m)) : (k >= COL_H * 0.85 ? RED : col(m));
          for (let w = 0; w < colW; w++) {
            if (k < n) g.set(x0 + w, y, c, k % 2 === 0 ? 1 : 0.85);
            else if (k === pk - 1 && m.id !== 'bat') g.set(x0 + w, y, WHITE, 0.8);
          }
        }
        const lbl = m.id === 'bat' && plugged ? 'CHG' : m.label;
        g.text(lbl, Math.round(cx - D.textWidth(lbl) / 2), M + COL_H + 2, col(m));
        const vt = valueText(m.id, h);
        g.text(vt, Math.round(cx - D.textWidth(vt) / 2), M + COL_H + 11, WHITE, 0.85);
      });
    } else {
      const slot = (W - M * 2) / on.length;
      on.forEach((m, i) => {
        const cx = M + slot * i + slot / 2, cy = M + DIAL_R;
        const val = h.last ? (h.last.v[m.id] || 0) : 0;
        for (let a = 0; a <= 40; a++) {
          const t = Math.PI * (1 - a / 40);
          g.set(cx + Math.cos(t) * DIAL_R, cy - Math.sin(t) * DIAL_R, col(m), a / 40 <= val ? 1 : 0.25);
        }
        const t = Math.PI * (1 - val);
        for (let r = 0; r <= DIAL_R - 2; r++) g.set(cx + Math.cos(t) * r, cy - Math.sin(t) * r, WHITE);
        const lbl = m.id === 'bat' && plugged ? 'CHG' : m.label;
        g.text(lbl, Math.round(cx - D.textWidth(lbl) / 2), cy + 2, col(m));
        const vt = valueText(m.id, h);
        g.text(vt, Math.round(cx - D.textWidth(vt) / 2), cy + 11, WHITE, 0.85);
      });
    }
    return g;
  }

  /** Fake but plausible readings, for the browser preview. */
  function simulator() {
    const s = { cpu: 0.25, mem: 0.6, disk: 0.48, net: 3e5, battery: 0.84 };
    const walk = (x, d, lo, hi) => Math.min(hi, Math.max(lo, x + (Math.random() - 0.5) * d));
    return () => {
      const plugged = Math.floor(Date.now() / 8000) % 2 === 1;
      s.cpu = walk(s.cpu, 0.25, 0.03, 0.98);
      s.mem = walk(s.mem, 0.02, 0.4, 0.9);
      s.net = Math.max(0, walk(s.net, 2e6, 0, 3e7));
      s.battery = Math.min(1, Math.max(0.05, s.battery + (plugged ? 0.002 : -0.001)));
      return { cpu: s.cpu, mem: s.mem, disk: s.disk, net_down: s.net, net_up: s.net * 0.2, battery: s.battery, plugged, battery_minutes: 180 };
    };
  }

  WT.system = { STYLES, METRICS, HEIGHT, createHistory, push, valueText, build, simulator };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
