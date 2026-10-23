/* The floating dot-matrix launcher (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const Ln = WT.launcher;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  let grid = null;
  let hover = null;
  let scroll = 0;
  let opening = null;      // { id, failed } for a moment after a click
  let openTimer = null;
  let dropping = false;

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
    grid = Ln.build({ W: L.width, state, hover, scroll, opening, color: L.dotColor, dropping });
    scroll = grid.scrollTop;
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, grid, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  async function open(id) {
    clearTimeout(openTimer);
    opening = { id, failed: false };
    paint();
    try {
      await WT.store.native.launch(id);
    } catch (e) {
      console.error('launch', e);
      opening = { id, failed: true };
      paint();
    }
    openTimer = setTimeout(() => { opening = null; paint(); }, opening.failed ? 2500 : 1200);
  }

  // Drop apps, files and folders onto the widget to add them.
  async function dropped(paths) {
    dropping = false;
    let added = 0;
    for (const p of paths) {
      if (state.items.length >= Ln.MAX_ITEMS) break;
      if (state.items.some((x) => x.target === p)) continue;
      state.items.push(WT.store.newItem(p));
      added++;
    }
    if (added) await WT.store.save(state);
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
    const h = grid && Ln.hitAt(grid, ...toGrid(e));
    const id = h ? h.id : null;
    if (id !== hover) { hover = id; paint(); }
  });
  root.addEventListener('mouseleave', () => { if (hover) { hover = null; paint(); } });
  window.addEventListener('mouseup', (e) => {
    if (!down || !grid) { down = null; return; }
    down = null;
    const h = Ln.hitAt(grid, ...toGrid(e));
    if (h && h.action === 'open') open(h.id);
  });
  root.addEventListener('wheel', (e) => {
    if (!grid || grid.maxScroll <= 0) return;
    e.preventDefault();
    scroll = Math.max(0, Math.min(grid.maxScroll, scroll + (e.deltaY > 0 ? 1 : -1)));
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
    state = s;
    applyPin();
    paint();
  });
  state = await WT.store.load();
  if (early) state = early;
  WT.store.native.onDrop(dropped, (on) => { dropping = on; paint(); });

  await refreshWorldTime();
  setInterval(async () => { await refreshWorldTime(); paint(); }, 3000);
  window.addEventListener('resize', paint);

  applyPin();
  paint();

  WT.widget = { getState: () => state, look };
})();
