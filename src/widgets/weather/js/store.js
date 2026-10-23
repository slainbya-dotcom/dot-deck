/* Settings model + bridge to the native shell.
 * In Tauri: state lives in a JSON file owned by Rust and changes are broadcast
 * to both windows. In a plain browser (for development): localStorage. */
(function (WT) {
  'use strict';

  const KEY = 'dotweather.state.v1';
  const HEX = /^#[0-9a-f]{6}$/i;
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const isTauri = !!(T && T.core && T.core.invoke);
  const MAX_PLACES = 8;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** A place from a search result, Dot Clock clock or located point: {label, name, lat, lng, tz}. */
  function newPlace(p) {
    const label = String(p.label || p.name || '').trim() || WT.geo.formatLatLng(p.lat, p.lng);
    return { id: uid(), label: label.slice(0, 24), name: String(p.name || label).slice(0, 60), lat: round(p.lat), lng: round(p.lng), tz: p.tz || 'UTC' };
  }
  const round = (v) => Math.round(Number(v) * 1000) / 1000;

  function defaults() {
    return {
      version: 1,
      style: 'now',             // now | hours | days | graph | cities
      places: [],               // first = main place (styles A-D); E shows them all
      days: 4,                  // style C: 1 (today) to 4
      unit: guessUnit(),
      use24h: WT.time.systemUses24h(),
      icons: 'natural',         // natural colours, or 'mono' = the dot colour
      seeded: false,            // first run has picked a starting place
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

  /** °F for the US and a few others, °C everywhere else (from the system time zone). */
  function guessUnit() {
    const z = WT.time.systemZone();
    return /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Indiana|Kentucky|Boise|Juneau|Sitka|Nome|Menominee|North_Dakota|Adak|Metlakatla|Yakutat)|^Pacific\/Honolulu|^US\//.test(z) ? 'F' : 'C';
  }

  const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const int = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);

  function normPlace(p, id) {
    if (!p || typeof p !== 'object') return null;
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 24) : WT.geo.formatLatLng(lat, lng);
    return {
      id, label, name: String(p.name || label).slice(0, 60), lat: round(lat), lng: round(lng),
      tz: typeof p.tz === 'string' && WT.time.resolveZone(p.tz) ? p.tz : 'UTC',
    };
  }

  /** Validates anything (old versions, hand-edited files) into a safe state object. */
  function normalize(raw) {
    const d = defaults();
    const s = raw && typeof raw === 'object' ? raw : {};
    const ids = new Set(), places = [];
    for (const p of Array.isArray(s.places) ? s.places : []) {
      let id = p && typeof p.id === 'string' && p.id ? p.id : uid();
      if (ids.has(id)) id = uid();
      const n = normPlace(p, id);
      if (!n) continue;
      ids.add(id);
      places.push(n);
      if (places.length >= MAX_PLACES) break;
    }
    return {
      version: 1,
      style: WT.weather.STYLES.includes(s.style) ? s.style : d.style,
      places,
      days: int(s.days, 1, 4, d.days),
      unit: s.unit === 'F' ? 'F' : s.unit === 'C' ? 'C' : d.unit,
      use24h: bool(s.use24h, d.use24h),
      icons: s.icons === 'mono' ? 'mono' : 'natural',
      seeded: bool(s.seeded, false),
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

  /** First-run starting place: Dot Clock's home city, else the biggest city in the system time zone. */
  function startingPlace(wtRaw) {
    const home = wtRaw ? WT.worldTime.homeFrom(wtRaw) : null;
    if (home) return newPlace({ label: home.label, name: home.label, lat: home.lat, lng: home.lng, tz: home.tz });
    const c = WT.geo.cityForZone(WT.time.systemZone());
    return c ? newPlace({ label: WT.geo.cityLabel(c), name: WT.geo.cityDetail(c), lat: c.lat, lng: c.lng, tz: c.tz }) : null;
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
    isTauri, defaults, normalize, newPlace, startingPlace, guessUnit, MAX_PLACES, uid, load, save, subscribe, openSettings, onOpenSection,
    resizeWindow, setAlwaysOnTop, startDragging, quit, recenterWidget,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
