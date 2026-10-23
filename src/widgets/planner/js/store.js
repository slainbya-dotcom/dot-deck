/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotplanner.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);
  const MAX_CITIES = 10;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** A planner city from a name + zone (e.g. a search result or a Dot Clock clock). */
  function newCity(place) {
    return {
      id: uid(), label: WT.planner.defaultCode(place.name || place.label), name: String(place.name || place.label || place.tz),
      tz: place.tz, color: null, work: [9, 17], awake: [7, 23], weekends: false,
    };
  }

  function defaults() {
    return {
      version: 1,
      cities: [],               // first city = home (its hours label the scale)
      panels: [{ id: 'blocks', enabled: true }, { id: 'numbers', enabled: true }],
      hours: 12,
      use24h: WT.time.systemUses24h(),
      highlight: '#39ff7a',     // everyone-working bar and working-hour numbers
      chime: 'none',            // when a window with everyone working begins
      seededFromClock: false,
      matchWorldTime: true,
      width: 130,
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
  const span = (v, d) => (Array.isArray(v) && v.length === 2 ? [int(v[0], 0, 24, d[0]), int(v[1], 0, 24, d[1])] : d.slice());

  function normCity(c, id) {
    const tz = typeof c.tz === 'string' ? WT.time.resolveZone(c.tz) : null;
    if (!tz) return null;
    return {
      id,
      label: (typeof c.label === 'string' && c.label.trim() ? c.label.trim() : WT.planner.defaultCode(c.name || tz)).slice(0, 10),
      name: String(c.name || tz).slice(0, 60),
      tz,
      color: hex(c.color, null),
      work: span(c.work, [9, 17]),
      awake: span(c.awake, [7, 23]),
      weekends: bool(c.weekends, false),
    };
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const ids = new Set(), cities = [];
    for (const c of Array.isArray(s.cities) ? s.cities : []) {
      if (!c || typeof c !== 'object') continue;
      let id = typeof c.id === 'string' && c.id ? c.id : uid();
      if (ids.has(id)) id = uid();
      const n = normCity(c, id);
      if (!n) continue;
      ids.add(id);
      cities.push(n);
      if (cities.length >= MAX_CITIES) break;
    }
    const saved = Array.isArray(s.panels) ? s.panels.filter((p) => p && WT.planner.PANEL_IDS.includes(p.id)) : [];
    const seen = new Set(), panels = [];
    for (const p of saved) if (!seen.has(p.id)) { seen.add(p.id); panels.push({ id: p.id, enabled: bool(p.enabled, true) }); }
    for (const p of d.panels) if (!seen.has(p.id)) panels.push(Object.assign({}, p));
    return {
      version: 1,
      cities,
      panels,
      hours: [6, 12, 24].includes(s.hours) ? s.hours : d.hours,
      use24h: bool(s.use24h, d.use24h),
      highlight: hex(s.highlight, d.highlight),
      chime: s.chime === 'none' || WT.chimes.byId(s.chime) ? s.chime : 'none',
      seededFromClock: bool(s.seededFromClock, false),
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
    };
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
    isTauri, defaults, normalize, newCity, MAX_CITIES, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
