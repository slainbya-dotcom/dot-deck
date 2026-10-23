/* The floating dot-matrix widget (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;         // a broadcast that arrived while we were still loading
  let lastSig = '';
  let lastSize = '';

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function rows(now) {
    if (!state.clocks.length) {
      return [{ label: 'RIGHT-CLICK TO SET UP', color: state.dotColor }];
    }
    return state.clocks.map((c) => ({
      label: c.label,
      time: WT.time.formatTime(c.tz, now, state.use24h, state.showSeconds),
      zone: WT.time.abbreviation(c.tz, now),
      day: WT.solar.isDaytime(now, c.lat, c.lng, c.tz),
      color: c.color || state.dotColor,
    }));
  }

  /** Largest dot size (<= the chosen one) that keeps the widget on screen. */
  function fittingDotSize(r) {
    const g = WT.dots.layout(r);
    const maxW = (screen.availWidth || 1920) * 0.95, maxH = (screen.availHeight || 1080) * 0.9;
    let size = state.dotSize;
    while (size > 2 && (g.w * size > maxW || g.h * size > maxH)) size--;
    return size;
  }

  function paint() {
    const r = rows(new Date());
    const sig = JSON.stringify([r, state.dotSize, state.dotShape, state.showUnlit, state.dotColor]);
    if (sig === lastSig) return;
    lastSig = sig;
    const opts = Object.assign({}, state, { dotSize: fittingDotSize(r) });
    const size = WT.dots.render(canvas, r, opts);
    const key = size.width + 'x' + size.height;
    if (key !== lastSize) {
      lastSize = key;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  function applyChrome() {
    // A tiny minimum alpha keeps a "transparent" widget clickable/draggable on every OS.
    root.style.background = hexToRgba(state.bgColor, Math.max(state.bgOpacity, 0.02));
    $('btn-pin').classList.toggle('active', state.alwaysOnTop);
    $('btn-pin').title = state.alwaysOnTop ? 'Stop keeping on top' : 'Keep on top';
    WT.store.setAlwaysOnTop(state.alwaysOnTop);
  }

  // Tick on each second boundary. Schedule first so one bad paint can't stop the clock.
  function tick() {
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    try { paint(); } catch (e) { console.error('paint failed', e); }
  }

  // ---- first run -------------------------------------------------------------
  // Show the computer's own time zone straight away, then let the settings window
  // (a normal window, so OS permission prompts display properly) try location
  // services and fall back to searching for a city.
  async function firstRun() {
    const tz = WT.time.systemZone();
    const city = WT.geo.cityForZone(tz);
    state.clocks.unshift({
      id: WT.store.uid(),
      label: city ? WT.geo.cityLabel(city) : tz.split('/').pop().replace(/_/g, ' '),
      tz, lat: city ? city.lat : null, lng: city ? city.lng : null,
      color: null, home: true, auto: true,
    });
    await WT.store.save(state);
    lastSig = '';
    paint();
    WT.store.openSettings('locate');
  }

  // ---- interaction -----------------------------------------------------------
  // Drag only once the pointer actually moves, so button clicks still work.
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
  window.addEventListener('mouseup', () => { down = null; });

  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    WT.store.openSettings();
  });
  $('btn-settings').addEventListener('click', () => WT.store.openSettings());
  $('btn-close').addEventListener('click', () => WT.store.quit());
  $('btn-pin').addEventListener('click', async () => {
    state.alwaysOnTop = !state.alwaysOnTop;
    applyChrome();
    await WT.store.save(state);
  });

  // Listen before loading so a change made meanwhile isn't lost.
  await WT.store.subscribe((s) => {
    if (!state) { early = s; return; }
    state = s;
    applyChrome();
    lastSig = '';
    paint();
  });
  state = await WT.store.load();
  if (early) state = early;

  // Redraw when the machine wakes or the screen DPI changes.
  // (Only redraw on resize — never resize from a resize event, which could loop.)
  document.addEventListener('visibilitychange', () => { lastSig = ''; paint(); });
  window.addEventListener('resize', () => { lastSig = ''; paint(); });

  applyChrome();
  tick();
  if (!state.clocks.some((c) => c.home)) firstRun();

  WT.widget = { getState: () => state }; // for debugging from devtools
})();
