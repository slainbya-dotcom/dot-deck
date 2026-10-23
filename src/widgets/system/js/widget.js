/* The floating dot-matrix system monitor (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const S = WT.system;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  const hist = S.createHistory();
  let hasBattery = false;
  let wasLow = false;
  let reading = false;

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
    const colors = {};
    for (const m of S.METRICS) colors[m.id] = state.colorMode === 'one' ? L.dotColor : state.colors[m.id];
    const g = S.build({ W: L.width, style: state.style, metrics: state.metrics[state.style], colors, h: hist, hasBattery });
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, g, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  async function sample() {
    if (reading) return;
    reading = true;
    try {
      const r = await WT.store.readSystem();
      hasBattery = r.battery !== null && r.battery !== undefined;
      S.push(hist, r);
      // Low-battery chime: once each time it drops below the threshold while unplugged.
      const low = hasBattery && !r.plugged && r.battery * 100 < state.lowBattery;
      if (low && !wasLow && state.lowChime !== 'none') WT.chimes.play(state.lowChime, state.volume);
      wasLow = low;
      paint();
    } catch (e) {
      console.error('reading failed', e);
    } finally {
      reading = false;
    }
  }

  function loop() {
    setTimeout(loop, (state ? state.interval : 1) * 1000);
    sample();
  }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw && wtLook && Date.now() % 60000 > 3000) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
  }

  // ---- interaction -------------------------------------------------------------
  let down = null;
  root.addEventListener('mousedown', (e) => {
    WT.chimes.unlock();
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
  window.addEventListener('mouseup', () => { down = null; });
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

  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;
    state = s;
    applyPin();
    paint();
  });
  state = await WT.store.load();
  if (early) state = early;

  await refreshWorldTime();
  setInterval(async () => { await refreshWorldTime(); paint(); }, 3000);
  window.addEventListener('resize', paint);

  applyPin();
  paint();
  loop();

  WT.widget = { getState: () => state, look, hist };
})();
