/* The floating dot-matrix visualiser (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const V = WT.viz;
  const media = WT.store.media;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  const an = V.createState();
  let np = { available: false };
  let trackKey = '';
  let scroll = 0;
  let scrolling = false;
  let lastFrame = performance.now();

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
  const showTrack = () => !!state.track[state.style];

  function paint() {
    const L = look();
    const g = V.build({
      W: L.width, style: state.style, s: an, showTrack: showTrack(), np, scroll,
      colorMode: state.colorMode, color: L.dotColor, peaks: state.peaks,
    });
    scrolling = g.scrolling;
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, g, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  // ---- readings ------------------------------------------------------------------------
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = performance.now(), dt = (now - lastFrame) / 1000;
      lastFrame = now;
      const f = await media.frame();
      V.update(an, f, dt, state.sensitivity);
      if (scrolling && np.playing) scroll += dt * 20;
      paint();
    } catch (e) {
      console.error('audio_frame', e);
    } finally {
      busy = false;
    }
  }

  let readingTrack = false;
  async function readTrack() {
    if (readingTrack || !showTrack() || document.hidden) return;
    readingTrack = true;
    try {
      np = (await media.readPlayer(state.playerSource)) || { available: false };
      const key = np.available ? np.title + '\u0000' + np.artist : '';
      if (key !== trackKey) { trackKey = key; scroll = 0; }
    } catch (e) {
      console.error('read_player', e);
    } finally {
      readingTrack = false;
    }
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
  // A click (without dragging) on the widget moves on to the next style.
  window.addEventListener('mouseup', () => {
    if (down) nextStyle();
    down = null;
  });
  root.addEventListener('contextmenu', (e) => { e.preventDefault(); WT.store.openSettings(); });
  $('btn-settings').addEventListener('click', () => WT.store.openSettings());
  $('btn-close').addEventListener('click', () => WT.store.quit());
  $('btn-pin').addEventListener('click', async () => {
    state.alwaysOnTop = !state.alwaysOnTop;
    applyPin();
    await WT.store.save(state);
  });

  async function nextStyle() {
    const i = V.STYLES.indexOf(state.style);
    state.style = V.STYLES[(i + 1) % V.STYLES.length];
    await WT.store.save(state);
    readTrack();
    paint();
  }

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
    const sourceChanged = s.source !== state.source;
    state = s;
    if (sourceChanged) media.setSource(state.source).catch(console.error);
    applyPin();
    readTrack();
    paint();
  });
  state = await WT.store.load();
  if (early) state = early;
  media.setSource(state.source).catch(console.error);
  WT.store.onNextStyle(nextStyle);

  await refreshWorldTime();
  setInterval(refreshWorldTime, 3000);
  window.addEventListener('resize', paint);

  applyPin();
  paint();
  readTrack();
  setInterval(readTrack, 1500);
  // About 30 frames a second; nothing while the widget is hidden.
  setInterval(() => { if (!document.hidden) tick(); }, 33);

  WT.widget = { getState: () => state, look, toggleSim: media.toggleSim };
})();
