/* The floating dot-matrix sun & moon widget (main window). */
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
  let wtHome = null;
  let lastSig = '';
  let lastSize = '';
  let sunCache = { key: '', s: null };
  let lastTick = Date.now();

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

  /** Where we are: Dot Clock's home city, a chosen city, or the computer's time zone. */
  function place() {
    if (state.useWorldTimeHome && wtHome) return wtHome;
    if (state.place) return state.place;
    const tz = WT.time.systemZone();
    const c = WT.geo.cityForZone(tz);
    return c ? { label: WT.geo.cityLabel(c), tz: c.tz, lat: c.lat, lng: c.lng } : { label: 'London, UK', tz: 'Europe/London', lat: 51.51, lng: -0.13 };
  }

  /** Sun times are recalculated once a minute (they only change day to day). */
  function sunTimes(p, now) {
    const key = p.lat + ',' + p.lng + ',' + p.tz + ',' + Math.floor(now / 60000);
    if (sunCache.key !== key) sunCache = { key, s: WT.sun.sunTimes(p, now) };
    return sunCache.s;
  }

  function paint(force) {
    const now = Date.now();
    const L = look();
    const p = place();
    const s = sunTimes(p, now);
    const one = state.colorMode === 'one';
    const fmt = (t) => WT.time.formatTime(p.tz, new Date(t), state.use24h, false);
    const W = Math.max(L.width, WT.panels.minWidth(state.use24h ? '00:00' : '00:00 AM'));
    const ctx = {
      W, now, s, m: WT.sun.moon(now), place: p, fmt, southern: p.lat < 0,
      panels: state.panels, rows: state.rows,
      colors: one ? { text: L.dotColor, sun: L.dotColor, moon: L.dotColor, sky: L.dotColor }
        : { text: L.dotColor, sun: state.colors.sun, moon: state.colors.moon, sky: state.colors.sky },
    };
    const g = WT.panels.build(ctx);
    // Only the sun dot / bar move between minutes, so this signature is cheap and stable.
    const sig = JSON.stringify([W, L, state.panels, state.rows, state.colors, state.colorMode, state.use24h, p, Math.floor(now / 15000)]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, g, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  /** Chime when sunrise, the evening golden hour or sunset passes. */
  function checkEvents(now) {
    const s = sunTimes(place(), now);
    const events = [['sunrise', s.sunrise], ['golden', s.goldenEveningStart], ['sunset', s.sunset]];
    for (const [k, t] of events) {
      if (t && lastTick < t && t <= now && state.chimes[k] !== 'none') WT.chimes.play(state.chimes[k], state.volume);
    }
    lastTick = now;
  }

  function tick() {
    setTimeout(tick, 1000);
    try {
      const now = Date.now();
      checkEvents(now);
      paint();
    } catch (e) { console.error('tick failed', e); }
  }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw && wtLook && Date.now() % 60000 > 3000) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
    wtHome = raw ? WT.worldTime.homeFrom(raw) : null;
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
  setInterval(async () => { await refreshWorldTime(); paint(); }, 3000);

  document.addEventListener('visibilitychange', () => paint(true));
  window.addEventListener('resize', () => paint(true));

  applyPin();
  paint(true);
  tick();

  WT.widget = { getState: () => state, look, place };
})();
