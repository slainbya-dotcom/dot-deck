/* The floating dot-matrix dice roller (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const X = WT.dice;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');
  const SETTLE = 450;   // ms the numbers flicker before they land

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  let grid = null;

  let last = null;             // { vals, until } main roll
  const savedResults = {};     // id -> { vals, until }
  const spin = {};             // die id -> extra spin angle
  let spinUntil = 0;
  let t = 0, lastFrame = performance.now();

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function look() {
    const m = state.matchWorldTime && wtLook;
    const src = m ? wtLook : state;
    return {
      matched: !!m,
      width: m ? wtLook.width : state.width,
      dotSize: src.dotSize, dotShape: src.dotShape, showUnlit: src.showUnlit,
      dotColor: src.dotColor, bgColor: src.bgColor, bgOpacity: src.bgOpacity,
    };
  }

  /** While settling, show random faces instead of the real result. */
  function shown(r, now) {
    if (!r) return null;
    const settling = now < r.until;
    return { vals: settling ? r.vals.map((v) => ({ id: v.id, value: X.roll1(X.byId(v.id), (n) => Math.floor(Math.random() * n)) })) : r.vals, settling };
  }

  function paint() {
    const L = look();
    const now = performance.now();
    const colors = {};
    for (const d of X.DICE) colors[d.id] = state.colorMode === 'one' ? L.dotColor : state.colors[d.id];
    const sr = {};
    for (const id of Object.keys(savedResults)) sr[id] = shown(savedResults[id], now);
    grid = X.build({ W: L.width, t, state, last: shown(last, now), savedResults: sr, spin, color: L.dotColor, colors, crits: state.crits });
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, grid, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  // ---- rolling -----------------------------------------------------------------------------
  function sounds(vals) {
    WT.chimes.unlock();
    if (state.sound === 'rattle') WT.chimes.rattle(state.volume, vals.length);
    else if (state.sound !== 'none') WT.chimes.play(state.sound, state.volume);
    if (state.critSound !== 'none' && vals.some((v) => v.id === 'd20' && v.value === 20)) {
      setTimeout(() => WT.chimes.play(state.critSound, state.volume), SETTLE);
    }
  }
  function kick(counts) {
    spinUntil = performance.now() + SETTLE;
    for (const id of X.IDS) if (counts[id]) spin[id] = spin[id] || 0;
  }

  async function act(h, right) {
    switch (h.action) {
      case 'die': {
        const n = X.count(state.pool);
        if (right) state.pool[h.die] = Math.max(0, state.pool[h.die] - 1);
        else if (n < X.MAX) state.pool[h.die]++;
        else return;
        last = null;
        await WT.store.save(state);
        break;
      }
      case 'roll': {
        const vals = X.rollCounts(state.pool);
        if (!vals.length) return;
        last = { vals, until: performance.now() + SETTLE };
        kick(state.pool);
        sounds(vals);
        break;
      }
      case 'saved': {
        const r = state.saved.find((x) => x.id === h.id);
        if (!r) return;
        const vals = X.rollCounts(r.counts);
        if (!vals.length) return;
        savedResults[r.id] = { vals, until: performance.now() + SETTLE };
        sounds(vals);
        break;
      }
      case 'clear':
        state.pool = X.emptyCounts();
        last = null;
        await WT.store.save(state);
        break;
      case 'sum': case 'each':
        if (state.mode === h.action) return;
        state.mode = h.action;
        await WT.store.save(state);
        break;
    }
    paint();
  }

  // ---- interaction -------------------------------------------------------------
  const toGrid = (e) => {
    const r = canvas.getBoundingClientRect(), p = look().dotSize;
    return [(e.clientX - r.left) / p, (e.clientY - r.top) / p];
  };
  let down = null;
  root.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.controls')) return;
    down = { x: e.screenX, y: e.screenY };
  });
  window.addEventListener('mousemove', (e) => {
    if (!down) return;
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
      down = null;
      WT.store.startDragging();
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (!down || !grid) { down = null; return; }
    down = null;
    const h = X.hitAt(grid, ...toGrid(e));
    if (h) act(h, false);
  });
  // Right-click a die to remove one; right-click anywhere else for settings.
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const h = grid && X.hitAt(grid, ...toGrid(e));
    if (h && h.action === 'die') act(h, true);
    else WT.store.openSettings();
  });
  // Scroll over a die: up adds one, down removes one.
  root.addEventListener('wheel', (e) => {
    const h = grid && X.hitAt(grid, ...toGrid(e));
    if (!h || h.action !== 'die') return;
    e.preventDefault();
    act(h, e.deltaY > 0);
  }, { passive: false });
  $('btn-settings').addEventListener('click', () => WT.store.openSettings());
  $('btn-close').addEventListener('click', () => WT.store.quit());
  $('btn-pin').addEventListener('click', async () => {
    state.alwaysOnTop = !state.alwaysOnTop;
    applyPin();
    await WT.store.save(state);
  });

  function applyPin() {
    $('btn-pin').classList.toggle('active', state.alwaysOnTop);
    $('btn-pin').title = state.alwaysOnTop ? 'Stop keeping on top' : 'Keep on top';
    WT.store.setAlwaysOnTop(state.alwaysOnTop);
  }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw && wtLook && Date.now() % 60000 > 3000) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
  }

  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;
    // A saved roll that was edited shows its new dice, not an old result.
    for (const r of s.saved) {
      const old = state.saved.find((x) => x.id === r.id);
      if (!old || JSON.stringify([old.counts, old.mod, old.mode]) !== JSON.stringify([r.counts, r.mod, r.mode])) delete savedResults[r.id];
    }
    state = s;
    applyPin();
    paint();
  });
  state = await WT.store.load();
  if (early) state = early;

  WT.store.onToggleSaved(async () => {
    state.views.saved = !state.views.saved;
    await WT.store.save(state);
    paint();
  });

  await refreshWorldTime();
  setInterval(refreshWorldTime, 3000);
  window.addEventListener('resize', paint);

  applyPin();
  paint();
  // Animation: the slow spin (and a quick burst of extra spin just after a roll).
  setInterval(() => {
    const now = performance.now(), dt = Math.min(0.2, (now - lastFrame) / 1000);
    lastFrame = now;
    if (document.hidden) return;
    t += dt;
    if (now < spinUntil) {
      const left = (spinUntil - now) / SETTLE;
      for (const id of Object.keys(spin)) if (state.pool[id]) spin[id] += dt * 9 * left;
    }
    paint();
  }, 50);

  WT.widget = { getState: () => state, look };
})();
