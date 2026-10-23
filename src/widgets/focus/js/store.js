/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotfocus.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);

  function defaults() {
    return {
      version: 1,
      lengths: { focus: { h: 0, mi: 25, s: 0 }, break: { h: 0, mi: 5, s: 0 }, long: { h: 0, mi: 15, s: 0 } },
      names: { focus: 'FOCUS', break: 'BREAK', long: 'LONG BREAK' },
      longEnabled: true,
      longEvery: 4,             // long break after this many focus rounds
      next: 'wait',             // 'auto' = roll straight on, 'wait' = chime and wait for a click
      barMode: 'focusFills',    // focusFills | focusDrains | allFill | allDrain
      colorMode: 'each',        // 'one' = dot colour for every phase, 'each' = colours below
      colors: { focus: '#ff6b4a', break: '#39ff7a', long: '#5ad1ff' },
      chimes: { focus: 'coin', break: 'dingdong' },   // played when that kind of phase ENDS
      finish: 'once',           // 'once' | 'repeat' (until clicked)
      cycle: { phase: 'focus', round: 0, status: 'idle', endAt: null, remainingMs: null, totalMs: 0, alerting: false, doneAt: null },
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
  const time = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const chime = (v, d) => (v === 'none' || WT.chimes.byId(v) ? v : d);
  const name = (v, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 24) : d);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normLength(L, d) {
    L = L && typeof L === 'object' ? L : {};
    const out = { h: int(L.h, 0, 23, d.h), mi: int(L.mi, 0, 999, d.mi), s: int(L.s, 0, 59, d.s) };
    if (!out.h && !out.mi && !out.s) return Object.assign({}, d);
    return out;
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const L = s.lengths || {}, N = s.names || {}, C = s.colors || {}, CH = s.chimes || {};
    const c = s.cycle && typeof s.cycle === 'object' ? s.cycle : {};
    const out = {
      version: 1,
      lengths: { focus: normLength(L.focus, d.lengths.focus), break: normLength(L.break, d.lengths.break), long: normLength(L.long, d.lengths.long) },
      names: { focus: name(N.focus, d.names.focus), break: name(N.break, d.names.break), long: name(N.long, d.names.long) },
      longEnabled: bool(s.longEnabled, d.longEnabled),
      longEvery: int(s.longEvery, 2, 12, d.longEvery),
      next: pick(s.next, ['auto', 'wait'], d.next),
      barMode: pick(s.barMode, ['focusFills', 'focusDrains', 'allFill', 'allDrain'], d.barMode),
      colorMode: pick(s.colorMode, ['one', 'each'], d.colorMode),
      colors: { focus: hex(C.focus, d.colors.focus), break: hex(C.break, d.colors.break), long: hex(C.long, d.colors.long) },
      chimes: { focus: chime(CH.focus, d.chimes.focus), break: chime(CH.break, d.chimes.break) },
      finish: pick(s.finish, ['once', 'repeat'], d.finish),
      cycle: {
        phase: pick(c.phase, ['focus', 'break', 'long'], 'focus'),
        round: int(c.round, 0, 99, 0),
        status: pick(c.status, ['idle', 'running', 'paused', 'waiting'], 'idle'),
        endAt: time(c.endAt),
        remainingMs: typeof c.remainingMs === 'number' && c.remainingMs >= 0 ? c.remainingMs : null,
        totalMs: typeof c.totalMs === 'number' && c.totalMs > 0 ? c.totalMs : 0,
        alerting: c.alerting === true,
        doneAt: time(c.doneAt),
      },
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
    // Repair impossible combinations instead of crashing on them.
    const cy = out.cycle;
    if (cy.status === 'running' && (!cy.endAt || !cy.totalMs)) WT.focus.reset(cy);
    if (cy.status === 'paused' && (cy.remainingMs === null || !cy.totalMs)) WT.focus.reset(cy);
    if (cy.phase === 'long' && !out.longEnabled && cy.status === 'idle') cy.phase = 'focus';
    if (cy.round >= out.longEvery) cy.round = 0;
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
    isTauri, defaults, normalize, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
