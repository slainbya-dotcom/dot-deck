/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotvisualiser.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaults() {
    return {
      version: 1,
      style: 'bars',             // bars | mirror | scope | vu | falls
      // "What's playing" line, chosen per style.
      track: { bars: false, mirror: false, scope: false, vu: false, falls: true },
      source: 'system',          // 'system' or an input device's name
      sensitivity: 0.5,          // 0 = only loud parts, 1 = everything
      colorMode: 'meter',        // 'meter' = green/amber/red etc, 'one' = the dot colour
      peaks: true,               // peak caps on columns and VU meters
      playerSource: 'auto',      // macOS track line: 'auto' | 'spotify' | 'music'
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

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const T0 = s.track || {}, track = {};
    for (const st of WT.viz.STYLES) track[st] = bool(T0[st], d.track[st]);
    return {
      version: 1,
      style: WT.viz.STYLES.includes(s.style) ? s.style : d.style,
      track,
      source: typeof s.source === 'string' && s.source ? s.source.slice(0, 200) : d.source,
      sensitivity: num(s.sensitivity, 0, 1, d.sensitivity),
      colorMode: s.colorMode === 'one' ? 'one' : 'meter',
      peaks: bool(s.peaks, d.peaks),
      playerSource: ['auto', 'spotify', 'music'].includes(s.playerSource) ? s.playerSource : d.playerSource,
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

  // ---- sound + track bridge: Rust in the app, simulated in a plain browser ----------------------
  let sim = null, simStart = 0;
  const simu = () => { if (!sim) { sim = WT.viz.simulator(); simStart = Date.now(); } return sim; };
  const call = (cmd, args, fallback) => (isTauri ? T.core.invoke(cmd, args || {}) : Promise.resolve(fallback()));
  const media = {
    frame: () => call('audio_frame', null, () => simu()((Date.now() - simStart) / 1000)),
    sources: () => call('audio_sources', null, () => ['system', 'Microphone Array', 'BlackHole 2ch']),
    setSource: (source) => call('set_audio_source', { source }, () => undefined),
    readPlayer: (source) => call('read_player', { source }, () => ({ available: true, source: 'Preview', title: 'Neon Harbour', artist: 'The Low Satellites', playing: true, position: 0, duration: 0 })),
    /** Preview only: pause / play the simulated music. */
    toggleSim: () => simu().toggle(),
  };

  /** fn() when the tray menu's "Next style" is clicked. */
  function onNextStyle(fn) {
    if (isTauri) T.event.listen('next-style', () => fn());
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
    isTauri, defaults, normalize, media, onNextStyle, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
