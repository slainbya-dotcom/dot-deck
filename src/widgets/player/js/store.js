/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotplayer.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaults() {
    return {
      version: 1,
      // Each view switches on/off as a whole; its rows have their own ticks.
      views: { player: true, sound: true },
      rows: { progress: true, buttons: true, volume: true, output: true, input: true },
      layout: 'one',            // 'one' = TRACK - ARTIST on one scrolling line, 'two' = separate lines
      timeMode: 'length',       // 'length' = 1:42 ... 3:53, 'left' = 1:42 ... -2:11
      speed: 2,                 // scroll speed: 1 slow, 2 normal, 4 fast
      source: 'auto',           // macOS: 'auto' | 'spotify' | 'music'
      colorMode: 'each',
      colors: { track: '#ffb000', progress: '#39ff7a', buttons: '#ffb000', volume: '#5ad1ff', output: '#ff6bd5', input: '#b8ff5a' },
      matchWorldTime: true,
      width: 130,
      dotColor: '#ffb000',
      dotSize: 3,
      dotShape: 'round',
      showUnlit: true,
      bgColor: '#101010',
      bgOpacity: 0.85,
      alwaysOnTop: false,
    };
  }

  const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const int = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const pick = (v, list, d) => (list.includes(v) ? v : d);

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const V = s.views || {}, R = s.rows || {}, C = s.colors || {};
    const views = {}, rows = {}, colors = {};
    for (const v of WT.player.VIEWS) views[v.id] = bool(V[v.id], d.views[v.id]);
    for (const r of WT.player.ROWS) rows[r.id] = bool(R[r.id], d.rows[r.id]);
    for (const id of WT.player.COLOR_IDS) colors[id] = hex(C[id], d.colors[id]);
    return {
      version: 1,
      views,
      rows,
      layout: pick(s.layout, ['one', 'two'], d.layout),
      timeMode: pick(s.timeMode, ['length', 'left'], d.timeMode),
      speed: pick(s.speed, [1, 2, 4], d.speed),
      source: pick(s.source, ['auto', 'spotify', 'music'], d.source),
      colorMode: s.colorMode === 'one' ? 'one' : 'each',
      colors,
      matchWorldTime: bool(s.matchWorldTime, d.matchWorldTime),
      width: int(s.width, 80, 400, d.width),
      dotColor: hex(s.dotColor, d.dotColor),
      dotSize: int(s.dotSize, 2, 8, d.dotSize),
      dotShape: s.dotShape === 'square' ? 'square' : 'round',
      showUnlit: bool(s.showUnlit, d.showUnlit),
      bgColor: hex(s.bgColor, d.bgColor),
      bgOpacity: num(s.bgOpacity, 0, 1, d.bgOpacity),
      alwaysOnTop: bool(s.alwaysOnTop, d.alwaysOnTop),
    };
  }

  // ---- media bridge: Rust in the app, simulated in a plain browser ----------------------------
  let sim = null;
  const simu = () => (sim = sim || WT.player.simulator());
  const call = (cmd, args, fallback) => (isTauri ? T.core.invoke(cmd, args || {}) : Promise.resolve(fallback()));
  const media = {
    readPlayer: (source) => call('read_player', { source }, () => simu().readPlayer()),
    action: (action, position) => call('player_action', { action, position: position === undefined ? null : position }, () => simu().action(action, position)),
    readAudio: () => call('read_audio', null, () => simu().readAudio()),
    setVolume: (level) => call('set_volume', { level }, () => simu().setVolume(level)),
    setMuted: (muted) => call('set_muted', { muted }, () => simu().setMuted(muted)),
    setDevice: (kind, id) => call('set_device', { kind, id }, () => simu().setDevice(kind, id)),
    setMicMuted: (muted) => call('set_mic_muted', { muted }, () => simu().setMicMuted(muted)),
  };

  /** fn() when the tray menu's "Show / hide sound controls" is clicked. */
  function onToggleSound(fn) {
    if (isTauri) T.event.listen('toggle-sound', () => fn());
  }

  // ---- persistence ---------------------------------------------------------
  let memory = null;          // fallback when localStorage is unavailable
  const pending = new Set();  // JSON we wrote whose broadcast hasn't come back yet

  async function load() {
    let json = null;
    if (isTauri) {
      try { json = await T.core.invoke('load_state'); } catch (e) { console.error('load_state', e); }
    } else {
      try { json = window.localStorage.getItem(KEY); } catch (e) { json = memory; }
    }
    let parsed = null;
    try { parsed = json ? JSON.parse(json) : null; } catch (e) { parsed = null; }
    return normalize(parsed);
  }

  async function save(state) {
    const json = JSON.stringify(normalize(state));
    if (isTauri) {
      if (pending.size > 50) pending.clear();
      pending.add(json);
      await T.core.invoke('save_state', { json });
    } else {
      memory = json;
      try { window.localStorage.setItem(KEY, json); } catch (e) { /* preview without storage */ }
    }
  }

  /** fn(state, isOwnEcho) whenever any window saves. Await it before load() so no change is missed. */
  function subscribe(fn) {
    if (isTauri) {
      return T.event.listen('state-changed', (e) => {
        const json = e.payload;
        let parsed = null;
        try { parsed = JSON.parse(json); } catch (err) { return; }
        fn(normalize(parsed), pending.delete(json));
      });
    } else {
      window.addEventListener('storage', (e) => {
        if (e.key !== KEY || !e.newValue) return;
        try { fn(normalize(JSON.parse(e.newValue)), false); } catch (err) { /* ignore */ }
      });
      return Promise.resolve();
    }
  }

  // ---- window helpers ------------------------------------------------------
  function currentWindow() {
    return isTauri && T.window && T.window.getCurrentWindow ? T.window.getCurrentWindow() : null;
  }

  function openSettings(section) {
    if (isTauri) return T.core.invoke('open_settings', { section: section || null }).catch(console.error);
    window.open('settings.html' + (section ? '#' + encodeURIComponent(section) : ''), 'wt-settings', 'width=540,height=760');
    return Promise.resolve();
  }

  /** fn(section) when the widget asks settings to jump somewhere. */
  function onOpenSection(fn) {
    if (isTauri) {
      T.event.listen('open-section', (e) => fn(String(e.payload || '')));
    } else {
      const fire = () => { if (location.hash.length > 1) fn(decodeURIComponent(location.hash.slice(1))); };
      window.addEventListener('hashchange', fire);
      setTimeout(fire, 0);
    }
  }

  function resizeWindow(w, h) {
    const win = currentWindow();
    if (!win) return;
    const LogicalSize = (T.dpi && T.dpi.LogicalSize) || (T.window && T.window.LogicalSize);
    if (!LogicalSize) return;
    win.setSize(new LogicalSize(Math.ceil(w), Math.ceil(h))).catch(console.error);
  }

  function setAlwaysOnTop(on) {
    const win = currentWindow();
    if (win) win.setAlwaysOnTop(!!on).catch(console.error);
  }

  function startDragging() {
    const win = currentWindow();
    if (win) win.startDragging().catch(console.error);
  }

  function quit() {
    if (isTauri) return T.core.invoke('quit');
    window.close();
  }

  function recenterWidget() {
    if (isTauri) return T.core.invoke('recenter_widget').catch(console.error);
  }

  WT.store = {
    isTauri, defaults, normalize, media, onToggleSound, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
