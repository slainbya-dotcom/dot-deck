/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'worldtime.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);

  function defaults() {
    return {
      version: 1,
      clocks: [],              // [{id, label, tz, lat, lng, color|null, home}]
      use24h: WT.time.systemUses24h(),
      showSeconds: false,
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
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const coord = (v, lim) => (typeof v === 'number' && isFinite(v) && Math.abs(v) <= lim ? v : null);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const out = {
      version: 1,
      use24h: bool(s.use24h, d.use24h),
      showSeconds: bool(s.showSeconds, d.showSeconds),
      dotColor: hex(s.dotColor, d.dotColor),
      dotSize: Math.round(num(s.dotSize, 2, 8, d.dotSize)),
      dotShape: s.dotShape === 'square' ? 'square' : 'round',
      showUnlit: bool(s.showUnlit, d.showUnlit),
      bgColor: hex(s.bgColor, d.bgColor),
      bgOpacity: num(s.bgOpacity, 0, 1, d.bgOpacity),
      alwaysOnTop: bool(s.alwaysOnTop, d.alwaysOnTop),
      clocks: [],
    };
    let haveHome = false;
    const ids = new Set();
    for (const c of Array.isArray(s.clocks) ? s.clocks : []) {
      if (!c || typeof c !== 'object') continue;
      const tz = typeof c.tz === 'string' ? WT.time.resolveZone(c.tz) : null;
      if (!tz) continue;
      let id = typeof c.id === 'string' && c.id ? c.id : uid();
      if (ids.has(id)) id = uid();
      ids.add(id);
      const home = c.home === true && !haveHome;
      if (home) haveHome = true;
      out.clocks.push({
        id,
        label: (typeof c.label === 'string' && c.label.trim() ? c.label.trim() : tz).slice(0, 40),
        tz,
        lat: coord(c.lat, 90),
        lng: coord(c.lng, 180),
        color: hex(c.color, null),
        home,
      });
      // `auto`: home guessed from the computer's time zone, not confirmed by the user.
      if (home && c.auto === true) out.clocks[out.clocks.length - 1].auto = true;
      if (out.clocks.length >= 24) break;
    }
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

  /** fn(section) when the widget asks settings to do something (e.g. "locate"). */
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
    isTauri, defaults, normalize, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
