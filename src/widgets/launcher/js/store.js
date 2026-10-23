/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotlauncher.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaults() {
    return {
      version: 1,
      style: 'icons',            // 'icons' | 'list'
      rows: 2,                   // icon rows: 1, 2 or 3
      listRows: 5,               // list rows (two columns each)
      items: [],                 // [{id, name, target, kind, icon, color}]
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
  const line = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

  /** A launcher item from a path or link (name, kind and icon are guessed, and can be changed). */
  function newItem(target, o) {
    const L = WT.launcher;
    o = o || {};
    let t = line(target, 1000);
    if (/^www\./i.test(t)) t = 'https://' + t;
    const kind = L.KINDS.includes(o.kind) ? o.kind : L.kindOf(t);
    const name = line(o.name || L.nameOf(t) || 'Item', 24);
    return { id: uid(), name, target: t, kind, icon: L.iconFor(name, kind, t), color: L.COLORS[Math.floor(Math.random() * 6)] };
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const L = WT.launcher;
    const ids = new Set(), items = [];
    for (const x of Array.isArray(s.items) ? s.items : []) {
      if (!x || typeof x !== 'object') continue;
      const target = line(x.target, 1000);
      if (!target) continue;
      let id = typeof x.id === 'string' && x.id ? x.id : uid();
      if (ids.has(id)) id = uid();
      ids.add(id);
      const kind = L.KINDS.includes(x.kind) ? x.kind : L.kindOf(target);
      const name = line(x.name, 24) || L.nameOf(target) || 'Item';
      items.push({ id, name, target, kind, icon: L.ICON[x.icon] ? x.icon : L.iconFor(name, kind, target), color: hex(x.color, '#ffb000') });
      if (items.length >= L.MAX_ITEMS) break;
    }
    return {
      version: 1,
      style: L.STYLES.includes(s.style) ? s.style : d.style,
      rows: int(s.rows, 1, 3, d.rows),
      listRows: int(s.listRows, 2, 8, d.listRows),
      items,
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

  // ---- opening + picking: Rust in the app, pretend in a plain browser ------------------------
  const native = {
    launch: (id) => (isTauri ? T.core.invoke('launch', { id }) : new Promise((r) => setTimeout(r, 300))),
    pick: (kind) => (isTauri ? T.core.invoke('pick_path', { kind }) : Promise.resolve(kind === 'folder' ? 'C:\\Users\\You\\Documents\\Projects' : kind === 'app' ? 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Spotify.lnk' : 'C:\\Users\\You\\Documents\\Budget.xlsx')),
    /** fn(paths) when files / folders / apps are dropped on this window. */
    onDrop: (fn, onHover) => {
      if (!isTauri) return;
      T.event.listen('tauri://drag-drop', (e) => fn((e.payload && e.payload.paths) || []));
      T.event.listen('tauri://drag-enter', () => onHover(true));
      T.event.listen('tauri://drag-leave', () => onHover(false));
    },
  };

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
    isTauri, defaults, normalize, newItem, native, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
