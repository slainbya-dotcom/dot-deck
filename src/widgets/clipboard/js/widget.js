/* The floating dot-matrix clipboard history (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const C = WT.clip;
  const native = WT.store.native;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  let grid = null;
  let hover = null, hoverSince = 0;
  let scroll = 0;
  let index = 0;            // latest style: which clip is showing
  let copied = null;        // { id, at }
  const t0 = performance.now();

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

  function paint() {
    const L = look();
    const now = performance.now();
    grid = C.build({
      W: L.width, state, now: Date.now(), hover, hoverScroll: Math.max(0, (now - hoverSince) / 1000 - 0.6),
      scroll, index, copied, t: (now - t0) / 1000, color: L.dotColor,
    });
    if (grid.scrollTop !== undefined) scroll = grid.scrollTop;
    if (grid.index !== undefined) index = grid.index;
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, grid, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  // ---- new clips ---------------------------------------------------------------------------
  async function onClip(text) {
    if (!state || state.paused) return;
    state.clips = C.addClip(state.clips, text, Date.now(), state.max, WT.store.uid);
    index = 0;
    await WT.store.save(state);
    paint();
  }

  async function act(h) {
    const c = h.id && state.clips.find((x) => x.id === h.id);
    switch (h.action) {
      case 'copy':
        if (!c) return;
        copied = { id: c.id, at: Date.now() };
        await native.copy(c.text).catch(console.error);
        setTimeout(paint, C.COPIED_MS + 50);
        break;
      case 'pin':
        if (!c) return;
        c.pinned = !c.pinned;
        await WT.store.save(state);
        break;
      case 'del':
        state.clips = state.clips.filter((x) => x !== c);
        hover = null;
        await WT.store.save(state);
        break;
      case 'prev': index--; break;
      case 'next': index++; break;
      case 'resume':
        state.paused = false;
        native.setPaused(false);
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
    if (down && Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
      down = null;
      WT.store.startDragging();
      return;
    }
    const h = grid && C.hitAt(grid, ...toGrid(e));
    const id = h && h.id && state.style === 'history' ? h.id : null;
    if (id !== hover) { hover = id; hoverSince = performance.now(); paint(); }
  });
  root.addEventListener('mouseleave', () => { if (hover) { hover = null; paint(); } });
  window.addEventListener('mouseup', (e) => {
    if (!down || !grid) { down = null; return; }
    down = null;
    const h = C.hitAt(grid, ...toGrid(e));
    if (h) act(h);
  });
  root.addEventListener('wheel', (e) => {
    if (!grid) return;
    if (state.style === 'latest') { index += e.deltaY > 0 ? 1 : -1; }
    else if (grid.maxScroll > 0) scroll = Math.max(0, Math.min(grid.maxScroll, scroll + (e.deltaY > 0 ? 1 : -1)));
    else return;
    e.preventDefault();
    paint();
  }, { passive: false });
  root.addEventListener('contextmenu', (e) => { e.preventDefault(); WT.store.openSettings(); });
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
    const pauseChanged = s.paused !== state.paused;
    state = s;
    if (pauseChanged) native.setPaused(state.paused);
    applyPin();
    paint();
  });
  state = await WT.store.load();
  if (early) state = early;
  // "Keep the history when the app restarts" off: start fresh (pinned clips stay).
  if (!state.remember && state.clips.some((c) => !c.pinned)) {
    state.clips = state.clips.filter((c) => c.pinned);
    await WT.store.save(state);
  }
  native.setPaused(state.paused);
  native.onClip(onClip);
  native.onTogglePause(async () => {
    state.paused = !state.paused;
    native.setPaused(state.paused);
    await WT.store.save(state);
    paint();
  });

  await refreshWorldTime();
  setInterval(async () => { await refreshWorldTime(); paint(); }, 3000);
  window.addEventListener('resize', paint);

  applyPin();
  paint();
  // Animate only while something scrolls (hovered or latest style); ages tick over each 30 s.
  setInterval(() => { if (!document.hidden && grid && grid.scrolling) paint(); }, 80);
  setInterval(paint, 30 * 1000);

  WT.widget = { getState: () => state, look };
})();
