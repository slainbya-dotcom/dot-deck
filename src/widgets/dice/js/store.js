/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotdice.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaults() {
    return {
      version: 1,
      views: { dice: true, saved: true },
      pool: WT.dice.emptyCounts(),   // the dice picked in the dice view
      mode: 'sum',                   // 'sum' | 'each' (dice view)
      saved: [
        { id: 'ex1', label: 'Sword', counts: { d8: 1 }, mod: 3, mode: 'sum' },
        { id: 'ex2', label: 'Adv', counts: { d20: 2 }, mod: 5, mode: 'each' },
      ],
      sound: 'rattle',               // 'none' | 'rattle' | a chime id
      critSound: 'none',             // chime when a d20 lands on 20
      volume: 0.6,
      crits: true,                   // natural 20 green, natural 1 red
      colorMode: 'each',             // 'each' = a colour per die, 'one' = the dot colour
      colors: Object.fromEntries(WT.dice.DICE.map((d) => [d.id, d.color])),
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
  const sound = (v, d, allowRattle) => (v === 'none' || (allowRattle && v === 'rattle') || (typeof v === 'string' && WT.chimes.byId(v)) ? v : d);

  /** Dice counts, capped so the total is at most MAX. */
  function normCounts(c) {
    const out = WT.dice.emptyCounts();
    let left = WT.dice.MAX;
    for (const id of WT.dice.IDS) {
      const n = Math.min(left, int(c && c[id], 0, WT.dice.MAX, 0));
      out[id] = n; left -= n;
    }
    return out;
  }

  /** A saved roll: label, dice, flat modifier, and whether it adds up or shows each die. */
  function newSaved(o) {
    o = o || {};
    return { id: uid(), label: String(o.label || 'New roll').slice(0, 16), counts: normCounts(o.counts || { d20: 1 }), mod: int(o.mod, -99, 99, 0), mode: o.mode === 'each' ? 'each' : 'sum' };
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const V = s.views || {}, C = s.colors || {};
    const ids = new Set(), saved = [];
    for (const r of Array.isArray(s.saved) ? s.saved : d.saved) {
      if (!r || typeof r !== 'object') continue;
      let id = typeof r.id === 'string' && r.id ? r.id : uid();
      if (ids.has(id)) id = uid();
      ids.add(id);
      saved.push({
        id, label: typeof r.label === 'string' ? r.label.slice(0, 16) : 'Roll',
        counts: normCounts(r.counts), mod: int(r.mod, -99, 99, 0), mode: r.mode === 'each' ? 'each' : 'sum',
      });
      if (saved.length >= WT.dice.MAX_SAVED) break;
    }
    const colors = {};
    for (const die of WT.dice.DICE) colors[die.id] = hex(C[die.id], d.colors[die.id]);
    return {
      version: 1,
      views: { dice: bool(V.dice, d.views.dice), saved: bool(V.saved, d.views.saved) },
      pool: normCounts(s.pool),
      mode: s.mode === 'each' ? 'each' : 'sum',
      saved,
      sound: sound(s.sound, d.sound, true),
      critSound: sound(s.critSound, d.critSound, false),
      volume: num(s.volume, 0, 1, d.volume),
      crits: bool(s.crits, d.crits),
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

  /** fn() when the tray menu's "Show / hide saved rolls" is clicked. */
  function onToggleSaved(fn) {
    if (isTauri) T.event.listen('toggle-saved', () => fn());
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
    isTauri, defaults, normalize, newSaved, normCounts, onToggleSaved, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
