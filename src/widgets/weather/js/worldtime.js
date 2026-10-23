/* Reads the Dot Clock app's settings and works out how wide its widget is,
 * so Dot Timer can use exactly the same width, dot size and colours. */
(function (WT) {
  'use strict';
  const HEX = /^#[0-9a-f]{6}$/i;

  /** The look Dot Clock is using, or null if its settings are missing/unreadable. */
  function lookFrom(json, now) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return null; }
    if (!s || typeof s !== 'object') return null;
    const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v : d);
    const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

    // Rebuild Dot Clock's rows exactly as its widget does, then measure them.
    const clocks = (Array.isArray(s.clocks) ? s.clocks : []).filter((c) => c && WT.time.resolveZone(c.tz));
    const use24h = typeof s.use24h === 'boolean' ? s.use24h : true;
    const rows = clocks.length
      ? clocks.map((c) => ({
        label: String(c.label || c.tz).slice(0, 40),
        time: WT.time.formatTime(c.tz, now, use24h, s.showSeconds === true),
        zone: WT.time.abbreviation(c.tz, now),
        day: true, // sun and moon icons are the same width
      }))
      : [{ label: 'RIGHT-CLICK TO SET UP' }];

    return {
      width: WT.dots.layout(rows).w,
      rows: rows.length,
      dotSize: Math.round(num(s.dotSize, 2, 8, 3)),
      dotShape: s.dotShape === 'square' ? 'square' : 'round',
      showUnlit: typeof s.showUnlit === 'boolean' ? s.showUnlit : true,
      dotColor: hex(s.dotColor, '#ffb000'),
      bgColor: hex(s.bgColor, '#101010'),
      bgOpacity: num(s.bgOpacity, 0, 1, 0.85),
    };
  }

  /** Raw JSON from the native side (null outside Tauri or if Dot Clock isn't installed). */
  async function readRaw() {
    const T = (window.__DECK_TAURI__ || window.__TAURI__);
    if (T && T.core && T.core.invoke) {
      try { return (await T.core.invoke('read_world_time')) || null; } catch (e) { return null; }
    }
    // Browser preview: Dot Clock's dev build keeps its state in localStorage.
    try { return window.localStorage.getItem('worldtime.state.v1'); } catch (e) { return null; }
  }

  /** Dot Clock's home city {label, tz, lat, lng}, or null. */
  function homeFrom(json) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return null; }
    const h = s && Array.isArray(s.clocks) && s.clocks.find((c) => c && c.home);
    if (!h || typeof h.lat !== 'number' || typeof h.lng !== 'number' || !WT.time.resolveZone(h.tz)) return null;
    return { label: String(h.label || h.tz), tz: h.tz, lat: h.lat, lng: h.lng };
  }

  /** All of Dot Clock's clocks [{label, tz, lat, lng}], home first. */
  function clocksFrom(json) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return []; }
    const list = (s && Array.isArray(s.clocks) ? s.clocks : []).filter((c) => c && WT.time.resolveZone(c.tz));
    list.sort((a, b) => (b.home === true) - (a.home === true));
    return list.map((c) => ({ label: String(c.label || c.tz), name: String(c.label || c.tz), tz: c.tz,
      lat: typeof c.lat === 'number' ? c.lat : null, lng: typeof c.lng === 'number' ? c.lng : null }));
  }

  WT.worldTime = { lookFrom, homeFrom, clocksFrom, readRaw };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
