/* Fetches forecasts from Open-Meteo and keeps the last one for each place, so the
 * widget still shows something when the computer is offline. Shared by both windows
 * (they share browser storage). In a plain browser preview it uses simulated data. */
(function (WT) {
  'use strict';
  const KEY = 'dotweather.cache.v1';
  const FRESH = 30 * 60 * 1000;     // refetch after 30 minutes
  const RETRY = 5 * 60 * 1000;      // after a failure, try again in 5 minutes
  const T = typeof window !== 'undefined' ? (window.__DECK_TAURI__ || window.__TAURI__) : undefined;
  const live = !!(T && T.core && T.core.invoke) && !(typeof window !== 'undefined' && window.__PREVIEW__);
  let memory = {};

  const keyOf = (p) => Number(p.lat).toFixed(2) + ',' + Number(p.lng).toFixed(2);

  function readAll() {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) || {} : memory;
    } catch (e) { return memory; }
  }
  function writeAll(all) {
    memory = all;
    try { window.localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
  }

  /** { model|null, error|null, triedAt } for a place. */
  function cached(place) {
    return readAll()[keyOf(place)] || { model: null, error: null, triedAt: 0 };
  }

  function status(entry) {
    return entry.model ? 'ok' : entry.error ? 'error' : 'loading';
  }

  async function fetchOne(place) {
    if (!live) return WT.weather.parse(WT.weather.simulate(place), Date.now());
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
    try {
      const res = await fetch(WT.weather.url(place), { signal: ctl ? ctl.signal : undefined });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.reason) || 'The weather service said ' + res.status);
      return WT.weather.parse(body, Date.now());
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const inFlight = new Map();
  /** Fetches any place whose forecast is stale (or all of them with force). */
  async function refresh(places, force) {
    const now = Date.now();
    await Promise.all(places.map(async (p) => {
      const k = keyOf(p);
      const e = cached(p);
      const age = e.model ? now - e.model.fetchedAt : Infinity;
      const due = force || (e.error && !e.model ? now - e.triedAt > RETRY : age > FRESH && now - (e.triedAt || 0) > RETRY);
      if (!due || inFlight.has(k)) return inFlight.get(k);
      const job = (async () => {
        try {
          const model = await fetchOne(p);
          const all = readAll();
          all[k] = { model, error: null, triedAt: Date.now() };
          writeAll(all);
        } catch (err) {
          const all = readAll();
          all[k] = { model: (all[k] && all[k].model) || null, error: String((err && err.message) || err), triedAt: Date.now() };
          writeAll(all);
        } finally {
          inFlight.delete(k);
        }
      })();
      inFlight.set(k, job);
      return job;
    }));
    // Forget places that are no longer in the list.
    const keep = new Set(places.map(keyOf));
    const all = readAll();
    let changed = false;
    for (const k of Object.keys(all)) if (!keep.has(k)) { delete all[k]; changed = true; }
    if (changed) writeAll(all);
  }

  /** fn() whenever the other window saves a new forecast. */
  function onChange(fn) {
    if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) fn(); });
  }

  WT.forecast = { cached, status, refresh, onChange, keyOf, FRESH, live };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
