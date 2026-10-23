/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotticker.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);
  const MAX_MESSAGES = 50;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newMessage(text, extra) {
    return Object.assign({ id: uid(), text: text || 'NEW MESSAGE', color: null, urgent: false, enabled: true,
      schedule: { days: [], from: '', to: '' }, chime: 'none' }, extra || {});
  }

  function defaults() {
    return {
      version: 1,
      messages: [
        newMessage("DON'T FORGET THE BINS", { color: '#ff5a4a', urgent: true }),
        newMessage('STAY HUNGRY, STAY FOOLISH'),
        newMessage('IT IS {TIME} ON {DAY}', { color: '#39ff7a' }),
      ],
      styles: [
        { id: 'scroll', enabled: true },
        { id: 'flip', enabled: false },
        { id: 'tagged', enabled: false, tag: 'NOTE', tagColor: '#5ad1ff' },
        { id: 'board', enabled: false, title: 'REMINDERS · {TIME}', titleColor: '#e8e4d0' },
        { id: 'type', enabled: false },
      ],
      speed: 33,          // dots per second
      direction: 'left',
      holdSeconds: 3,     // flip board / typewriter
      separator: '*',
      pauseOnHover: true,
      use24h: WT.time.systemUses24h(),
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
  const hhmm = (v) => (typeof v === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v) ? v : '');
  const str = (v, d, max) => (typeof v === 'string' ? v.slice(0, max) : d);

  function normMessage(m, id) {
    const sc = (m && m.schedule) || {};
    return {
      id,
      text: str(m.text, '', 200),
      color: hex(m.color, null),
      urgent: bool(m.urgent, false),
      enabled: bool(m.enabled, true),
      schedule: {
        days: Array.isArray(sc.days) ? [...new Set(sc.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [],
        from: hhmm(sc.from), to: hhmm(sc.to),
      },
      chime: m.chime === 'none' || WT.chimes.byId(m.chime) ? m.chime : 'none',
    };
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    const s = raw;
    const ids = new Set();
    const messages = [];
    for (const m of Array.isArray(s.messages) ? s.messages : []) {
      if (!m || typeof m !== 'object') continue;
      let id = typeof m.id === 'string' && m.id ? m.id : uid();
      if (ids.has(id)) id = uid();
      ids.add(id);
      messages.push(normMessage(m, id));
      if (messages.length >= MAX_MESSAGES) break;
    }
    const saved = Array.isArray(s.styles) ? s.styles.filter((x) => x && WT.ticker.STYLE_IDS.includes(x.id)) : [];
    const seen = new Set(), styles = [];
    const normStyle = (x) => {
      const base = d.styles.find((b) => b.id === x.id);
      const o = { id: x.id, enabled: bool(x.enabled, base.enabled) };
      if (x.id === 'tagged') { o.tag = str(x.tag, base.tag, 16) || base.tag; o.tagColor = hex(x.tagColor, base.tagColor); }
      if (x.id === 'board') { o.title = str(x.title, base.title, 60); o.titleColor = hex(x.titleColor, base.titleColor); }
      return o;
    };
    for (const x of saved) if (!seen.has(x.id)) { seen.add(x.id); styles.push(normStyle(x)); }
    for (const x of d.styles) if (!seen.has(x.id)) styles.push(Object.assign({}, x));
    return {
      version: 1,
      messages,
      styles,
      speed: int(s.speed, 8, 120, d.speed),
      direction: s.direction === 'right' ? 'right' : 'left',
      holdSeconds: num(s.holdSeconds, 1, 20, d.holdSeconds),
      separator: str(s.separator, d.separator, 6),
      pauseOnHover: bool(s.pauseOnHover, d.pauseOnHover),
      use24h: bool(s.use24h, d.use24h),
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
    isTauri, defaults, normalize, newMessage, MAX_MESSAGES, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
