/* The floating dot-matrix message ticker (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');
  const FRAME_MS = 33;

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  let animT = 0;              // animation clock (ms); stops while paused on hover
  let lastFrame = Date.now();
  let hovering = false;
  let wasActive = new Set();  // message ids active last minute (for "message appears" chimes)
  let lastActiveCheck = 0;

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

  function frame() {
    const now = Date.now();
    const dt = Math.min(1500, now - lastFrame); // catch up after slow frames, but not after sleep
    lastFrame = now;
    if (!(hovering && state.pauseOnHover)) animT += dt;
    const L = look();
    const g = WT.ticker.build({
      W: L.width, t: animT, now, use24h: state.use24h,
      msgs: WT.ticker.activeMessages(state, now),
      styles: state.styles, speed: state.speed, dir: state.direction,
      hold: state.holdSeconds * 1000, sep: state.separator,
      defaultColor: L.dotColor, sepColor: L.dotColor,
    });
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, g, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  /** Chime when a scheduled message starts showing. */
  function checkSchedules(now) {
    if (now - lastActiveCheck < 1000) return;
    lastActiveCheck = now;
    const active = new Set(state.messages.filter((m) => WT.ticker.isActive(m, now)).map((m) => m.id));
    const started = state.messages.find((m) => active.has(m.id) && !wasActive.has(m.id) && m.chime !== 'none' && hasSchedule(m));
    if (started && lastActiveCheck > startedAt + 3000) WT.chimes.play(started.chime, state.volume);
    wasActive = active;
  }
  const hasSchedule = (m) => (m.schedule.days.length || m.schedule.from || m.schedule.to);
  const startedAt = Date.now();

  function tick() {
    setTimeout(tick, FRAME_MS);
    try {
      const now = Date.now();
      checkSchedules(now);
      frame();
    } catch (e) { console.error('frame failed', e); }
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
  root.addEventListener('mouseenter', () => { hovering = true; });
  root.addEventListener('mouseleave', () => { hovering = false; });
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
  });
  state = await WT.store.load();
  if (early) state = early;

  await refreshWorldTime();
  setInterval(refreshWorldTime, 3000);
  wasActive = new Set(state.messages.filter((m) => WT.ticker.isActive(m, Date.now())).map((m) => m.id));

  applyPin();
  tick();

  WT.widget = { getState: () => state, look };
})();
