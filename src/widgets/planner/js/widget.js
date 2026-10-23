/* The floating dot-matrix meeting planner (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSig = '';
  let lastSize = '';
  let wasAllWorking = null;

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

  function paint(force) {
    const now = Date.now();
    const L = look();
    // The picture only changes as the "now" line creeps along: redraw every 20 s.
    const sig = JSON.stringify([L, state.cities, state.panels, state.hours, state.use24h, state.highlight, Math.floor(now / 20000)]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const g = WT.planner.build({
      W: L.width, now, cities: state.cities, panels: state.panels, hours: state.hours, use24h: state.use24h,
      defaultColor: L.dotColor, highlight: state.highlight, scaleColor: '#e8e4d0',
    });
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, g, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  /** Chime when a window opens where every city is working. */
  function checkOverlap(now) {
    const all = WT.planner.allWorking(state.cities, now);
    if (wasAllWorking === false && all && state.chime !== 'none' && state.cities.length > 1) WT.chimes.play(state.chime, state.volume);
    wasAllWorking = all;
  }

  function tick() {
    setTimeout(tick, 1000);
    try {
      const now = Date.now();
      checkOverlap(now);
      paint();
    } catch (e) { console.error('tick failed', e); }
  }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw && wtLook && Date.now() % 60000 > 3000) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
  }

  /** First run: start with Dot Clock's cities, or the computer's own time zone. */
  async function seed() {
    if (state.cities.length || state.seededFromClock) return;
    const fromClock = wtRaw ? WT.worldTime.clocksFrom(wtRaw) : [];
    if (fromClock.length) {
      state.cities = fromClock.slice(0, WT.store.MAX_CITIES).map(WT.store.newCity);
    } else {
      const c = WT.geo.cityForZone(WT.time.systemZone());
      if (c) state.cities = [WT.store.newCity({ name: WT.geo.cityLabel(c), tz: c.tz })];
    }
    state.seededFromClock = true;
    await WT.store.save(state);
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
    paint(true);
  });
  state = await WT.store.load();
  if (early) state = early;

  await refreshWorldTime();
  await seed();
  setInterval(async () => { await refreshWorldTime(); paint(); }, 3000);
  document.addEventListener('visibilitychange', () => paint(true));
  window.addEventListener('resize', () => paint(true));

  applyPin();
  paint(true);
  tick();

  WT.widget = { getState: () => state, look };
})();
