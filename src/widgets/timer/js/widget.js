/* The floating dot-matrix timer widget (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');
  const rowBtns = $('rowbtns');

  const REPEAT_EVERY_MS = 3500;          // "repeat until clicked" gap between chimes
  const REPEAT_FOR_MS = 5 * 60 * 1000;   // ...but give up after 5 minutes

  let state = null;
  let early = null;
  let wtRaw = null;      // Dot Clock's settings JSON (string) or null
  let wtLook = null;     // derived width/dots/colours
  let lastSig = '';
  let lastSize = '';
  let pitch = 3;
  let hoverRow = -1;
  let lastRepeat = 0;

  const ICON = {
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
    reset: '<svg viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.5.5A4 4 0 1 0 8 4v2L4.8 3.2 8 .5z"/></svg>',
  };

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /** Appearance in use: Dot Clock's when matching (and it's installed), else our own. */
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

  function rows(now, L) {
    if (!state.timers.length) {
      return [{ label: 'RIGHT-CLICK TO ADD A TIMER', frac: 0, color: L.dotColor }];
    }
    const flashOn = Math.floor(now / 500) % 2 === 0;
    return state.timers.map((t) => ({
      label: t.label,
      time: WT.timers.readout(t, now),
      slot: Math.max(...WT.timers.slotSamples(t).map(D.textWidth)),
      frac: WT.timers.barFraction(t, now),
      timeAlpha: t.alerting ? (flashOn ? 1 : 0) : t.status === 'paused' ? 0.45 : 1,
      color: t.color || L.dotColor,
    }));
  }

  function paint(force) {
    const now = Date.now();
    const L = look();
    const r = rows(now, L);
    // Never narrower than the widest time read-out plus a little label.
    const minW = D.MARGIN * 2 + Math.max(0, ...r.map((x) => x.slot || 0)) + D.GAP + 12;
    const W = Math.max(L.width, minW);
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
    placeRowButtons();
  }

  // ---- per-timer hover buttons -------------------------------------------------
  function buildRowButtons() {
    rowBtns.textContent = '';
    state.timers.forEach((t, i) => {
      const g = document.createElement('div');
      g.className = 'rowbtn-group';
      g.dataset.index = i;
      const play = document.createElement('button');
      play.type = 'button';
      play.innerHTML = t.status === 'running' ? ICON.pause : ICON.play; // static SVG only
      play.title = t.status === 'running' ? 'Pause' : t.status === 'done' ? 'Start again' : t.status === 'paused' ? 'Resume' : 'Start';
      play.addEventListener('click', () => act(t.id, 'toggle'));
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.innerHTML = ICON.reset;
      reset.title = 'Reset';
      reset.addEventListener('click', () => act(t.id, 'reset'));
      g.append(play, reset);
      rowBtns.appendChild(g);
    });
    placeRowButtons();
  }

  function placeRowButtons() {
    rowBtns.querySelectorAll('.rowbtn-group').forEach((g) => {
      const i = Number(g.dataset.index);
      const barTop = (D.timerTop(i) + D.ROW_H + D.TEXT_BAR_GAP) * pitch;
      g.style.top = Math.max(0, barTop + (D.BAR_H * pitch - 22) / 2) + 'px';
      g.style.right = (D.MARGIN * pitch + 4) + 'px';
      g.classList.toggle('show', i === hoverRow);
    });
  }

  function rowAt(clientY) {
    const r = root.getBoundingClientRect();
    const y = (clientY - r.top) / pitch;
    for (let i = 0; i < state.timers.length; i++) {
      const top = D.timerTop(i);
      if (y >= top - 2 && y < top + D.TIMER_H + 2) return i;
    }
    return -1;
  }

  // ---- actions -------------------------------------------------------------
  async function act(id, what) {
    const t = state.timers.find((x) => x.id === id);
    if (!t) return;
    const now = Date.now();
    if (what === 'reset') WT.timers.reset(t);
    else WT.timers.toggle(t, now);
    buildRowButtons();
    paint(true);
    await WT.store.save(state);
  }

  /** Stop any flashing / repeating chimes. */
  async function acknowledge() {
    const alerting = state.timers.filter((t) => t.alerting);
    if (!alerting.length) return;
    alerting.forEach((t) => { t.alerting = false; });
    paint(true);
    await WT.store.save(state);
  }

  function chime(t) {
    if (t.chime !== 'none') WT.chimes.play(t.chime, state.volume);
  }

  /** Finish any timers whose time is up; chime (once) for the first of them. */
  async function checkFinished(now) {
    const due = WT.timers.overdue(state.timers, now);
    if (!due.length) return;
    due.forEach((t) => WT.timers.finish(t, t.endAt));
    chime(due[0]);
    lastRepeat = now;
    buildRowButtons();
    paint(true);
    await WT.store.save(state);
  }

  function repeatChimes(now) {
    if (now - lastRepeat < REPEAT_EVERY_MS) return;
    const t = state.timers.find((x) => x.alerting && x.finish === 'repeat' && now - (x.doneAt || now) < REPEAT_FOR_MS);
    if (!t) return;
    lastRepeat = now;
    chime(t);
  }

  function tick() {
    setTimeout(tick, 250);
    try {
      const now = Date.now();
      checkFinished(now);
      repeatChimes(now);
      paint();
    } catch (e) { console.error('tick failed', e); }
  }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw && wtLook) {
      // Same settings: still re-measure occasionally (abbreviations change with DST).
      if (Date.now() % 60000 > 3000) return;
    }
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
  }

  // ---- interaction -----------------------------------------------------------
  let down = null;
  root.addEventListener('mousedown', (e) => {
    WT.chimes.unlock();
    acknowledge();
    if (e.button !== 0 || e.target.closest('.controls, .rowbtn-group')) return;
    down = { x: e.screenX, y: e.screenY };
  });
  window.addEventListener('mousemove', (e) => {
    const r = rowAt(e.clientY);
    if (r !== hoverRow) { hoverRow = r; placeRowButtons(); }
    if (!down) return;
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
      down = null;
      WT.store.startDragging();
    }
  });
  window.addEventListener('mouseup', () => { down = null; });
  root.addEventListener('mouseleave', () => { hoverRow = -1; placeRowButtons(); });

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

  // Listen before loading so a change made meanwhile isn't lost.
  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;
    state = s;
    applyPin();
    buildRowButtons();
    paint(true);
  });
  state = await WT.store.load();
  if (early) state = early;

  await refreshWorldTime();
  setInterval(refreshWorldTime, 3000);

  document.addEventListener('visibilitychange', () => paint(true));
  // (Only redraw on resize — never resize from a resize event, which could loop.)
  window.addEventListener('resize', () => paint(true));

  applyPin();
  buildRowButtons();
  paint(true);
  tick();

  WT.widget = { getState: () => state, look }; // for debugging from devtools
})();
