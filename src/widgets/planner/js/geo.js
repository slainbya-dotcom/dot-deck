/* Offline city search, nearest-city / time-zone lookup for a point,
 * and OS geolocation. No network access. */
(function (WT) {
  'use strict';

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function countryName(cc) {
    return (WT.COUNTRIES && WT.COUNTRIES[cc]) || cc || '';
  }

  let CITIES = null;
  function cities() {
    if (CITIES) return CITIES;
    CITIES = [];
    for (const [name, admin, cc, lat, lng, tz, rank, aliases] of WT.CITIES) {
      const zone = WT.time.resolveZone(tz);
      if (!zone) continue; // engine doesn't know this zone
      const country = countryName(cc);
      CITIES.push({
        name, admin, cc, lat, lng, tz: zone, rank, country,
        keys: [name].concat(aliases ? aliases.split('|') : []).map(fold),
        countryKey: fold(country), adminKey: fold(admin),
      });
    }
    return CITIES;
  }

  /** "New York, USA" */
  function cityLabel(c) {
    return c.country ? c.name + ', ' + c.country : c.name;
  }

  /** "New York, New York, USA" (for disambiguating search results) */
  function cityDetail(c) {
    return [c.name, c.admin && c.admin !== c.name ? c.admin : '', c.country].filter(Boolean).join(', ');
  }

  function wordStarts(key, q) {
    return key.startsWith(q) || key.includes(' ' + q);
  }

  /** Ranked offline search. Accepts "paris", "san fr", "london, uk", "japan". */
  function search(query, limit) {
    limit = limit || 12;
    const raw = String(query || '');
    const [qCity, qPlace] = raw.split(',').map(fold);
    if (!qCity) return [];
    const out = [];
    for (const c of cities()) {
      // Lower is better: exact name 0, exact alias 1, name prefix 2, alias prefix 3,
      // word prefix 4, country/region match 6.
      let score = Infinity;
      c.keys.forEach((k, i) => {
        let s = Infinity;
        if (k === qCity) s = i === 0 ? 0 : 1;
        else if (k.startsWith(qCity)) s = i === 0 ? 2 : 3;
        else if (wordStarts(k, qCity)) s = 4;
        if (s < score) score = s;
      });
      if (score === Infinity && (c.countryKey === qCity ||
          (qCity.length >= 3 && (c.countryKey.startsWith(qCity) || c.adminKey.startsWith(qCity))))) score = 6;
      if (score === Infinity) continue;
      if (qPlace && !(c.countryKey.startsWith(qPlace) || c.adminKey.startsWith(qPlace) ||
          fold(c.cc) === qPlace)) continue;
      out.push({ c, score });
    }
    out.sort((a, b) => a.score - b.score || a.c.rank - b.c.rank || a.c.name.localeCompare(b.c.name));
    return out.slice(0, limit).map((x) => x.c);
  }

  function km(lat1, lng1, lat2, lng2) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Cities sorted by distance from a point: [{city, km}] */
  function nearby(lat, lng, n) {
    const list = [];
    for (const c of cities()) if (c.cc) list.push({ city: c, km: km(lat, lng, c.lat, c.lng) });
    list.sort((a, b) => a.km - b.km);
    return list.slice(0, n || 50);
  }

  /** Distinct candidate zones for a point, closest first: [{tz, city, km}] */
  function zoneCandidates(lat, lng, n) {
    const seen = new Set(), out = [];
    for (const x of nearby(lat, lng, 120)) {
      const key = WT.time.canonicalZone(x.city.tz);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tz: x.city.tz, city: x.city, km: x.km });
      if (out.length >= (n || 6)) break;
    }
    return out;
  }

  /**
   * Best guess for a clicked/located point.
   * `preferTz` (usually the OS zone) wins if it is one of the 3 closest zones,
   * which fixes most border cases when the user is pinning where they are.
   */
  function describePoint(lat, lng, preferTz) {
    const near = nearby(lat, lng, 1)[0];
    const candidates = zoneCandidates(lat, lng, 6);
    let tz = candidates.length ? candidates[0].tz : 'UTC';
    if (preferTz) {
      const want = WT.time.canonicalZone(preferTz);
      const hit = candidates.slice(0, 3).find((c) => WT.time.canonicalZone(c.tz) === want);
      if (hit) tz = hit.tz;
    }
    return {
      label: near ? cityLabel(near.city) : formatLatLng(lat, lng),
      nearestKm: near ? near.km : Infinity,
      tz, lat: round(lat), lng: round(lng), candidates,
    };
  }

  function round(v) { return Math.round(v * 1000) / 1000; }

  function formatLatLng(lat, lng) {
    return Math.abs(lat).toFixed(2) + (lat >= 0 ? 'N ' : 'S ') + Math.abs(lng).toFixed(2) + (lng >= 0 ? 'E' : 'W');
  }

  /** City for a zone's own location (used to centre the map when nothing is set). */
  function cityForZone(tz) {
    const want = WT.time.canonicalZone(tz);
    let best = null;
    for (const c of cities()) {
      if (c.cc && WT.time.canonicalZone(c.tz) === want && (!best || c.rank < best.rank)) best = c;
    }
    return best;
  }

  /** OS location via the webview. Rejects with {code, message} on failure or timeout. */
  function currentPosition(timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject({ code: 'unavailable', message: 'Location services are not available.' });
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; reject({ code: 'timeout', message: 'Location request timed out.' }); }
      }, timeoutMs + 1000);
      navigator.geolocation.getCurrentPosition(
        (p) => { if (!done) { done = true; clearTimeout(timer); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); } },
        (e) => {
          if (done) return;
          done = true; clearTimeout(timer);
          const msg = e && e.code === 1 ? 'Location permission is off.' :
            e && e.code === 2 ? 'Location services could not find you.' : 'Location request timed out.';
          reject({ code: e && e.code, message: msg });
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 },
      );
    });
  }

  WT.geo = {
    fold, cities, cityLabel, cityDetail, search, km, nearby, zoneCandidates, describePoint,
    cityForZone, currentPosition, formatLatLng, countryName,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
