/* The floating dot-matrix weather widget (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const Wx = WT.weather;
  const F = WT.forecast;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  let frame = 0;

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

  // Forecast views are rebuilt every 30 s (or when something changes), not every animation frame.
  let views = null, viewsAt = 0, viewsKey = '';
  const invalidate = () => { views = null; };
  function places() {
    const now = Date.now();
    const key = JSON.stringify(state.places);
    if (views && now - viewsAt < 30000 && key === viewsKey) return views;
    viewsAt = now; viewsKey = key;
    return (views = state.places.map((p) => {
      const e = F.cached(p);
      return { place: p, view: e.model ? Wx.view(e.model, now) : null, status: F.status(e) };
    }));
  }

  function paint() {
    const L = look();
    const g = Wx.build({
      W: L.width, style: state.style, places: places(), frame, unit: state.unit, use24h: state.use24h,
      days: state.days, color: L.dotColor, icons: state.icons,
    });
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, g, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  async function update(force) {
    // Cities (E) needs every place; the others only the main one.
    const list = state.style === 'cities' ? state.places : state.places.slice(0, 1);
    await F.refresh(list, force);
    invalidate();
    paint();
  }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw && wtLook && Date.now() % 60000 > 3000) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
  }

  /** First run: start with Dot Clock's home city, or the system time zone's main city. */
  async function seed() {
    if (state.places.length || state.seeded) return;
    const p = WT.store.startingPlace(wtRaw);
    if (p) state.places.push(p);
    state.seeded = true;
    await WT.store.save(state);
  }

  // ---- interaction -------------------------------------------------------------
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
    update(false);          // fetches any place that was just added
  });
  state = await WT.store.load();
  if (early) state = early;

  await refreshWorldTime();
  await seed();
  setInterval(refreshWorldTime, 3000);
  window.addEventListener('resize', paint);
  F.onChange(() => { invalidate(); paint(); });        // settings fetched something ("Refresh now")

  applyPin();
  paint();
  update(false);
  setInterval(() => update(false), 60 * 1000);      // fetches only when 30 minutes old
  // Coming back online, or waking from sleep: try straight away.
  window.addEventListener('online', () => update(true));
  // Animation: rain, snow, sun rays, thunder.
  setInterval(() => { frame++; paint(); }, 100);

  WT.widget = { getState: () => state, look };
})();
