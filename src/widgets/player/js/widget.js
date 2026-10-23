/* The floating dot-matrix player (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const P = WT.player;
  const media = WT.store.media;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  let grid = null;

  // Latest readings. Position is interpolated between readings so the bar moves smoothly.
  let np = { available: false };
  let npAt = 0;
  let audio = null;
  let scroll = 0;
  let trackKey = '';
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

  function livePosition() {
    if (!np.available) return 0;
    let p = np.position + (np.playing ? (Date.now() - npAt) / 1000 : 0);
    if (np.duration > 0) p = Math.min(p, np.duration);
    return p;
  }

  function paint() {
    const L = look();
    const colors = {};
    for (const id of P.COLOR_IDS) colors[id] = state.colorMode === 'one' ? L.dotColor : state.colors[id];
    grid = P.build({ W: L.width, state, np: Object.assign({}, np, { position: livePosition() }), audio, scroll, colors });
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, grid, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  // ---- readings ------------------------------------------------------------------------
  let readingPlayer = false, readingAudio = false;
  async function readPlayer() {
    if (readingPlayer || !state.views.player) return;
    readingPlayer = true;
    try {
      const r = await media.readPlayer(state.source);
      np = r || { available: false };
      npAt = Date.now();
      const key = np.available ? np.title + '\u0000' + np.artist : '';
      if (key !== trackKey) { trackKey = key; scroll = 0; }
    } catch (e) {
      console.error('read_player', e);
    } finally {
      readingPlayer = false;
    }
  }
  async function readAudio() {
    if (readingAudio || !state.views.sound) return;
    readingAudio = true;
    try { audio = await media.readAudio(); } catch (e) { console.error('read_audio', e); } finally { readingAudio = false; }
  }
  const soon = (fn, ms) => setTimeout(fn, ms);

  // ---- actions ----------------------------------------------------------------------------
  let volTimer = null;
  function setVolume(v) {
    if (!audio || typeof audio.volume !== 'number') return;
    audio.volume = Math.max(0, Math.min(1, v));
    audio.muted = false;
    clearTimeout(volTimer);
    volTimer = setTimeout(() => {
      media.setVolume(audio.volume).catch(console.error);
      media.setMuted(false).catch(() => {});
    }, 60);
  }

  async function act(h, gx) {
    switch (h.action) {
      case 'toggle':
        if (!np.available) return;
        np.position = livePosition(); npAt = Date.now(); np.playing = !np.playing;   // feels instant
        await media.action('toggle').catch(console.error);
        soon(readPlayer, 400);
        break;
      case 'next': case 'prev':
        if (!np.available) return;
        await media.action(h.action).catch(console.error);
        soon(readPlayer, 400);
        break;
      case 'seek': {
        const t = Math.max(0, Math.min(1, (gx - h.b0) / (h.b1 - h.b0))) * np.duration;
        np.position = t; npAt = Date.now();
        await media.action('seek', t).catch(console.error);
        soon(readPlayer, 600);
        break;
      }
      case 'volume':
        setVolume((gx - h.b0) / (h.b1 - h.b0));
        break;
      case 'mute':
        audio.muted = !audio.muted;
        await media.setMuted(audio.muted).catch(console.error);
        soon(readAudio, 200);
        break;
      case 'mic':
        audio.mic_muted = !audio.mic_muted;
        await media.setMicMuted(audio.mic_muted).catch(console.error);
        soon(readAudio, 200);
        break;
      case 'device': {
        const isOut = h.kind === 'output';
        const id = P.cycle(isOut ? audio.outputs : audio.inputs, isOut ? audio.output : audio.input, h.dir);
        if (!id) return;
        if (isOut) audio.output = id; else audio.input = id;
        scroll = 0;
        await media.setDevice(h.kind, id).catch(console.error);
        soon(readAudio, 300);
        break;
      }
      case 'fold':
        state.views.sound = !state.views.sound;
        await WT.store.save(state);
        if (state.views.sound) readAudio();
        break;
    }
    paint();
  }

  // ---- interaction -------------------------------------------------------------
  let down = null;
  root.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.controls')) return;
    down = { x: e.screenX, y: e.screenY, cx: e.clientX, cy: e.clientY };
  });
  window.addEventListener('mousemove', (e) => {
    if (!down) return;
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
      down = null;
      WT.store.startDragging();
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (!down || !grid) { down = null; return; }
    down = null;
    const r = canvas.getBoundingClientRect();
    const pitch = look().dotSize;
    const gx = (e.clientX - r.left) / pitch, gy = (e.clientY - r.top) / pitch;
    const h = P.hitAt(grid, gx, gy);
    if (h) act(h, gx);
  });
  // Mouse wheel anywhere over the widget changes the volume.
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (audio && typeof audio.volume === 'number') { setVolume(audio.volume + (e.deltaY < 0 ? 0.05 : -0.05)); paint(); }
  }, { passive: false });
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

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw && wtLook && Date.now() % 60000 > 3000) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
  }

  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;
    const soundWasOn = state.views.sound, playerWasOn = state.views.player;
    state = s;
    applyPin();
    if (state.views.sound && !soundWasOn) readAudio();
    if (state.views.player && !playerWasOn) readPlayer();
    paint();
  });
  state = await WT.store.load();
  if (early) state = early;

  WT.store.onToggleSound(async () => {
    state.views.sound = !state.views.sound;
    await WT.store.save(state);
    if (state.views.sound) readAudio();
    paint();
  });

  await refreshWorldTime();
  setInterval(refreshWorldTime, 3000);
  window.addEventListener('resize', paint);

  applyPin();
  await Promise.all([readPlayer(), readAudio()]);
  paint();
  setInterval(readPlayer, 1000);
  setInterval(readAudio, 2000);
  // Animation: scrolling text and the moving playhead.
  setInterval(() => {
    const now = performance.now(), dt = Math.min(1.5, (now - lastFrame) / 1000);
    lastFrame = now;
    if (grid && grid.scrolling) scroll += dt * 10 * state.speed;
    paint();
  }, 80);

  WT.widget = { getState: () => state, look };
})();
