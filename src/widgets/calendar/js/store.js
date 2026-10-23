/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotcalendar.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);

  const DEFAULT_LABELS = { minute: 'MINUTE', hour: 'HOUR', day: '{WEEKDAY}', week: 'WEEK', month: '{MONTH}', year: '{YEAR}' };

  function defaultTracker(kind) {
    return {
      kind, enabled: true, label: DEFAULT_LABELS[kind], show: 'value', direction: 'fill',
      steps: false, chime: 'none', color: null, yearCounts: 'days',
    };
  }

  function defaults() {
    return {
      version: 1,
      trackers: WT.calendar.KINDS.map(defaultTracker),
      weekStart: 1,             // 1 = Monday, 0 = Sunday
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
  const pick = (v, list, d) => (list.includes(v) ? v : d);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normTracker(t, kind) {
    const d = defaultTracker(kind);
    t = t && typeof t === 'object' ? t : {};
    return {
      kind,
      enabled: bool(t.enabled, d.enabled),
      label: typeof t.label === 'string' ? t.label.trim().slice(0, 40) : d.label,
      show: pick(t.show, ['value', 'count', 'percent', 'none'], d.show),
      direction: t.direction === 'drain' ? 'drain' : 'fill',
      steps: bool(t.steps, d.steps),
      chime: t.chime === 'none' || WT.chimes.byId(t.chime) ? t.chime : d.chime,
      color: hex(t.color, null),
      yearCounts: pick(t.yearCounts, ['days', 'weeks', 'months'], d.yearCounts),
    };
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    // Exactly one tracker of each kind, in the saved order.
    const saved = Array.isArray(s.trackers) ? s.trackers.filter((t) => t && WT.calendar.KINDS.includes(t.kind)) : [];
    const seen = new Set();
    const trackers = [];
    for (const t of saved) if (!seen.has(t.kind)) { seen.add(t.kind); trackers.push(normTracker(t, t.kind)); }
    for (const k of WT.calendar.KINDS) if (!seen.has(k)) trackers.push(normTracker(null, k));
    return {
      version: 1,
      trackers,
      weekStart: s.weekStart === 0 ? 0 : 1,
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
    isTauri, defaults, normalize, DEFAULT_LABELS, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
