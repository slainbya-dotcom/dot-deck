/* The floating dot-matrix calendar-progress widget (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const C = WT.calendar;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSig = '';
  let lastSize = '';
  const lastKey = {};   // kind -> current period start, to spot when a bar fills

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

  const opts = () => ({ weekStart: state.weekStart });
  const enabled = () => state.trackers.filter((t) => t.enabled);

  function rows(now, L) {
    const list = enabled();
    if (!list.length) return [{ label: 'RIGHT-CLICK TO CHOOSE BARS', frac: 0, color: L.dotColor }];
    return list.map((t) => {
      const o = Object.assign(opts(), { yearCounts: t.yearCounts });
      const f = C.fraction(t.kind, now, o, t.steps);
      return {
        label: C.label(t.label, now),
        time: C.readout(t, now, opts()),
        slot: Math.max(...C.slotSamples(t).map(D.textWidth)),
        frac: t.direction === 'drain' ? 1 - f : f,
        color: t.color || L.dotColor,
      };
    });
  }

  function paint(force) {
    const now = Date.now();
    const L = look();
    const r = rows(now, L);
    const minW = D.MARGIN * 2 + Math.max(0, ...r.map((x) => x.slot || 0)) + D.GAP + 12;
    const W = Math.max(L.width, minW);
    const sig = JSON.stringify([r, W, L]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, D.layoutTimers(r, W), L);
    const key = size.width + 'x' + size.height;
    if (key !== lastSize) {
      lastSize = key;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  /** Chime when a bar completes. If several finish together (e.g. at midnight) only the biggest chimes. */
  function checkRollovers(now) {
    let winner = null;
    for (const t of state.trackers) {
      const k = C.periodKey(t.kind, now, opts());
      const had = lastKey[t.kind];
      lastKey[t.kind] = k;
      if (had === undefined || had === k) continue;          // first look, or same period
      if (t.enabled && t.chime !== 'none' && (!winner || C.KINDS.indexOf(t.kind) > C.KINDS.indexOf(winner.kind))) winner = t;
    }
    if (winner) WT.chimes.play(winner.chime, state.volume);
  }

  function tick() {
    setTimeout(tick, 250);
    try {
      const now = Date.now();
      checkRollovers(now);
      paint();
    } catch (e) { console.error('tick failed', e); }
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

  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    WT.store.openSettings();
  });
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
  setInterval(refreshWorldTime, 3000);

  document.addEventListener('visibilitychange', () => paint(true));
  window.addEventListener('resize', () => paint(true));

  applyPin();
  paint(true);
  tick();

  WT.widget = { getState: () => state, look };
})();
