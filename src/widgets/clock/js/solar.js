/* Sun position (low-precision almanac formula, accurate to ~0.1°) used to
 * decide between the sun and moon icons. Pure functions, no DOM. */
(function (WT) {
  'use strict';
  const RAD = Math.PI / 180;

  /** Sun altitude in degrees above the horizon at lat/lng for `date`. */
  function sunAltitude(date, lat, lng) {
    const d = date.getTime() / 86400000 - 10957.5;          // days since J2000.0
    const g = (357.529 + 0.98560028 * d) * RAD;              // mean anomaly
    const q = 280.459 + 0.98564736 * d;                      // mean longitude (deg)
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD; // ecliptic longitude
    const e = (23.439 - 0.00000036 * d) * RAD;               // obliquity
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    let gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    if (gmst < 0) gmst += 24;
    const ha = (gmst * 15 + lng) * RAD - ra;                 // local hour angle
    const la = lat * RAD;
    const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
    return alt / RAD;
  }

  /** True between sunrise and sunset (sun's upper limb above the horizon). */
  function isDaytime(date, lat, lng, tz) {
    if (typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng)) {
      return sunAltitude(date, lat, lng) > -0.833;
    }
    // No coordinates: fall back to 06:00–18:00 local time.
    const h = WT.time.wallClock(tz || 'UTC', date).hour;
    return h >= 6 && h < 18;
  }

  WT.solar = { sunAltitude, isDaytime };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
