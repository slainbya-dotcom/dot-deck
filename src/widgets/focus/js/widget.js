/* The floating dot-matrix focus-cycle widget (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const F = WT.focus;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');
  const rowBtns = $('rowbtns');

  const REPEAT_EVERY_MS = 3500;          // "repeat until clicked" gap between chimes
  const REPEAT_FOR_MS = 5 * 60 * 1000;   // ...but give up after 5 minutes
  const AUTO_FLASH_MS = 10 * 1000;       // auto mode: flash this long after a switch
  const SLOT = D.textWidth('00:00:00');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSig = '';
  let lastSize = '';
  let pitch = 3;
  let hover = false;
  let lastRepeat = 0;
  let lastEnded = 'focus';

  const ICON = {
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
    skip: '<svg viewBox="0 0 16 16"><path d="M2.5 2.5v11l7-5.5zM10 2.5h2.5v11H10z"/></svg>',
    reset: '<svg viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.5.5A4 4 0 1 0 8 4v2L4.8 3.2 8 .5z"/></svg>',
  };

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

  const cyc = () => state.cycle;
  const phaseColor = (phase, L) => (state.colorMode === 'each' ? state.colors[phase] : L.dotColor);

  function row(now, L) {
    const c = cyc();
    const flashOn = Math.floor(now / 500) % 2 === 0;
    return {
      label: state.names[c.phase],
      time: F.readout(c, state, now),
      slot: SLOT,
      frac: F.barFraction(c, state, now),
      timeAlpha: c.alerting ? (flashOn ? 1 : 0) : (c.status === 'paused' || c.status === 'waiting') ? 0.45 : 1,
      color: phaseColor(c.phase, L),
    };
  }

  function paint(force) {
    const now = Date.now();
    const L = look();
    const r = [row(now, L)];
    const W = Math.max(L.width, D.MARGIN * 2 + SLOT + D.GAP + 12);
    const sig = JSON.stringify([r, W, L]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    pitch = L.dotSize;
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, D.layoutTimers(r, W), L);
    const key = size.width + 'x' + size.height;
    if (key !== lastSize) {
      lastSize = key;
      WT.store.resizeWindow(size.width, size.height);
    }
    placeButtons();
  }

  // ---- hover buttons (play/pause, skip, reset) -----------------------------
  function buildButtons() {
    rowBtns.textContent = '';
    const g = document.createElement('div');
    g.className = 'rowbtn-group';
    const c = cyc();
    const mk = (icon, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = icon; // static SVG only
      b.title = title;
      b.addEventListener('click', fn);
      g.appendChild(b);
    };
    mk(c.status === 'running' ? ICON.pause : ICON.play,
      c.status === 'running' ? 'Pause' : c.status === 'paused' ? 'Resume' : 'Start ' + state.names[c.phase].toLowerCase(),
      () => act('toggle'));
    mk(ICON.skip, 'Skip to ' + state.names[F.nextPhase(state, c).phase].toLowerCase(), () => act('skip'));
    mk(ICON.reset, 'Reset to the first focus round', () => act('reset'));
    rowBtns.appendChild(g);
    placeButtons();
  }

  function placeButtons() {
    const g = rowBtns.firstChild;
    if (!g) return;
    const barTop = (D.timerTop(0) + D.ROW_H + D.TEXT_BAR_GAP) * pitch;
    g.style.top = Math.max(0, barTop + (D.BAR_H * pitch - 22) / 2) + 'px';
    g.style.right = (D.MARGIN * pitch + 4) + 'px';
    g.classList.toggle('show', hover);
  }

  async function act(what) {
    const c = cyc(), now = Date.now();
    if (what === 'toggle') F.toggle(c, state, now);
    else if (what === 'skip') F.skip(c, state, now);
    else F.reset(c);
    buildButtons();
    paint(true);
    await WT.store.save(state);
  }

  // ---- phase changes and chimes -----------------------------------------------
  function chimeFor(endedPhase) {
    const id = endedPhase === 'focus' ? state.chimes.focus : state.chimes.break;
    if (id && id !== 'none') WT.chimes.play(id, state.volume);
  }

  async function checkPhase(now) {
    const ended = F.catchUp(cyc(), state, now);
    if (!ended.length) return;
    lastEnded = ended[ended.length - 1];
    chimeFor(lastEnded);           // one chime, even if several phases passed while closed
    lastRepeat = now;
    buildButtons();
    paint(true);
    await WT.store.save(state);
  }

  async function alerts(now) {
    const c = cyc();
    if (!c.alerting) return;
    const since = now - (c.doneAt || now);
    // In auto mode the next phase is already running: stop flashing after a moment
    // unless the user asked for repeats.
    if (state.next === 'auto' && state.finish === 'once' && since > AUTO_FLASH_MS) {
      c.alerting = false;
      paint(true);
      await WT.store.save(state);
      return;
    }
    if (state.finish === 'repeat' && since < REPEAT_FOR_MS && now - lastRepeat >= REPEAT_EVERY_MS) {
      lastRepeat = now;
      chimeFor(lastEnded);
    }
  }

  function tick() {
    setTimeout(tick, 250);
    try {
      const now = Date.now();
      checkPhase(now);
      alerts(now);
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
  // mousedown silences; a click (no drag) on a waiting widget starts the next phase.
  let down = null;
  root.addEventListener('mousedown', async (e) => {
    WT.chimes.unlock();
    const c = cyc();
    const wasAlerting = c.alerting;
    if (wasAlerting) { c.alerting = false; paint(true); }
    if (e.button !== 0 || e.target.closest('.controls, .rowbtn-group')) {
      if (wasAlerting) await WT.store.save(state);
      return;
    }
    down = { x: e.screenX, y: e.screenY, wasAlerting };
  });
  window.addEventListener('mousemove', (e) => {
    if (!down) return;
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
      const d = down;
      down = null;
      if (d.wasAlerting) WT.store.save(state);
      WT.store.startDragging();
    }
  });
  window.addEventListener('mouseup', async () => {
    if (!down) return;
    const d = down;
    down = null;
    const c = cyc();
    if (c.status === 'waiting') {
      F.start(c, state, Date.now());
      buildButtons();
      paint(true);
      await WT.store.save(state);
    } else if (d.wasAlerting) {
      await WT.store.save(state);
    }
  });
  root.addEventListener('mouseenter', () => { hover = true; placeButtons(); });
  root.addEventListener('mouseleave', () => { hover = false; placeButtons(); });

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
    buildButtons();
    paint(true);
  });
  state = await WT.store.load();
  if (early) state = early;

  await refreshWorldTime();
  setInterval(refreshWorldTime, 3000);

  document.addEventListener('visibilitychange', () => paint(true));
  window.addEventListener('resize', () => paint(true));

  applyPin();
  buildButtons();
  paint(true);
  tick();

  WT.widget = { getState: () => state, look };
})();
