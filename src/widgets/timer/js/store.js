/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dottimer.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);
  const MAX_TIMERS = 16;

  function defaults() {
    return {
      version: 1,
      timers: [],              // see normalizeTimer()
      matchWorldTime: true,    // copy Dot Clock's width, dot size and colours
      width: 130,              // widget width in dots when not matching
      dotColor: '#ffb000',
      dotSize: 3,
      dotShape: 'round',
      showUnlit: true,
      bgColor: '#101010',
      bgOpacity: 0.85,
      volume: 0.7,
      alwaysOnTop: false,
    };
  }

  const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const int = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const time = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newTimer(n) {
    return normalizeTimer({ label: 'TIMER ' + (n || 1), length: { mi: 5 } });
  }

  function normalizeTimer(t, id) {
    const L = (t && t.length) || {};
    const length = {};
    for (const u of WT.timers.UNITS) length[u] = int(L[u], 0, WT.timers.LIMITS[u], 0);
    if (WT.timers.isEmptyLength(length)) length.mi = 5;
    const out = {
      id: id || (typeof t.id === 'string' && t.id ? t.id : uid()),
      label: (typeof t.label === 'string' && t.label.trim() ? t.label.trim() : 'TIMER').slice(0, 40),
      length,
      direction: t.direction === 'fill' ? 'fill' : 'empty',
      chime: t.chime === 'none' || WT.chimes.byId(t.chime) ? t.chime : 'coin',
      finish: t.finish === 'repeat' ? 'repeat' : 'once',
      color: hex(t.color, null),
      status: ['idle', 'running', 'paused', 'done'].includes(t.status) ? t.status : 'idle',
      endAt: time(t.endAt),
      remainingMs: typeof t.remainingMs === 'number' && t.remainingMs >= 0 ? t.remainingMs : null,
      totalMs: typeof t.totalMs === 'number' && t.totalMs > 0 ? t.totalMs : 0,
      doneAt: time(t.doneAt),
      alerting: t.alerting === true,
    };
    // Repair impossible combinations instead of crashing on them.
    if (out.status === 'running' && (!out.endAt || !out.totalMs)) WT.timers.reset(out);
    if (out.status === 'paused' && (out.remainingMs === null || !out.totalMs)) WT.timers.reset(out);
    if (out.status !== 'done') out.alerting = false;
    return out;
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const out = {
      version: 1,
      matchWorldTime: bool(s.matchWorldTime, d.matchWorldTime),
      width: int(s.width, 80, 400, d.width),
      dotColor: hex(s.dotColor, d.dotColor),
      dotSize: int(s.dotSize, 2, 8, d.dotSize),
      dotShape: s.dotShape === 'square' ? 'square' : 'round',
      showUnlit: bool(s.showUnlit, d.showUnlit),
      bgColor: hex(s.bgColor, d.bgColor),
      bgOpacity: num(s.bgOpacity, 0, 1, d.bgOpacity),
      volume: num(s.volume, 0, 1, d.volume),
      alwaysOnTop: bool(s.alwaysOnTop, d.alwaysOnTop),
      timers: [],
    };
    const ids = new Set();
    for (const t of Array.isArray(s.timers) ? s.timers : []) {
      if (!t || typeof t !== 'object') continue;
      let id = typeof t.id === 'string' && t.id ? t.id : uid();
      if (ids.has(id)) id = uid();
      ids.add(id);
      out.timers.push(normalizeTimer(t, id));
      if (out.timers.length >= MAX_TIMERS) break;
    }
    // First run: start with one example timer.
    if (!raw) out.timers.push(newTimer(1));
    return out;
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
    isTauri, defaults, normalize, normalizeTimer, newTimer, MAX_TIMERS, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
