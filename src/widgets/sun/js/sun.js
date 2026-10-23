/* Sun & moon facts for a place and moment: sunrise, sunset, golden hour, day
 * length and moon phase. Uses WT.solar.sunAltitude. Pure functions. */
(function (WT) {
  'use strict';

  const SYNODIC = 29.530588853;               // days between new moons
  const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
  const RISE_SET = -0.833;                     // sun's upper edge on the horizon (with refraction)
  const GOLDEN = 6;                            // golden hour: sun below 6° (and above the horizon)

  /**
   * Local midnight (start of today) in `tz`, as a timestamp. On a clock-change day
   * this can be an hour out, which doesn't matter: sunrise and sunset are never
   * within an hour of midnight where clocks change.
   */
  function dayStart(tz, now) {
    const w = WT.time.wallClock(tz, new Date(now));
    return now - ((w.hour * 60 + w.minute) * 60 + w.second) * 1000 - (now % 1000);
  }

  /** First minute in [from, from+span) where altitude crosses `level` (rising or setting). */
  function crossing(lat, lng, from, span, level, rising) {
    const step = 60000;
    let prev = WT.solar.sunAltitude(new Date(from), lat, lng);
    for (let t = from + step; t <= from + span; t += step) {
      const a = WT.solar.sunAltitude(new Date(t), lat, lng);
      if (rising ? prev < level && a >= level : prev >= level && a < level) {
        // refine to the second by linear interpolation
        return Math.round(t - step + step * (level - prev) / (a - prev));
      }
      prev = a;
    }
    return null;
  }

  /**
   * Today's sun times in the place's own time zone.
   * {sunrise, sunset, goldenMorningEnd, goldenEveningStart, dayLength, polar: null|'day'|'night', noonAltitude}
   */
  function sunTimes(place, now) {
    const start = dayStart(place.tz, now);
    const span = 24 * 3600000 + 3600000; // a little extra for 25-hour days
    const { lat, lng } = place;
    const sunrise = crossing(lat, lng, start, span, RISE_SET, true);
    const sunset = crossing(lat, lng, start, span, RISE_SET, false);
    const goldenMorningEnd = crossing(lat, lng, start, span, GOLDEN, true);
    const goldenEveningStart = crossing(lat, lng, start, span, GOLDEN, false);
    let polar = null;
    let maxAlt = -90;
    for (let t = start; t < start + 24 * 3600000; t += 600000) maxAlt = Math.max(maxAlt, WT.solar.sunAltitude(new Date(t), lat, lng));
    if (sunrise === null && sunset === null) polar = maxAlt > RISE_SET ? 'day' : 'night';
    let dayLength;
    if (polar === 'day') dayLength = 24 * 3600000;
    else if (polar === 'night') dayLength = 0;
    else if (sunrise !== null && sunset !== null && sunset > sunrise) dayLength = sunset - sunrise;
    else if (sunrise !== null && sunset !== null) dayLength = 24 * 3600000 - (sunrise - sunset); // sets before it rises (high latitudes)
    else dayLength = sunrise !== null ? start + 24 * 3600000 - sunrise : sunset - start;
    return { sunrise, sunset, goldenMorningEnd, goldenEveningStart, dayLength, polar, noonAltitude: maxAlt };
  }

  /** How far the sun is through today's daylight (0 at sunrise … 1 at sunset). */
  function daylightFraction(s, now) {
    if (s.polar === 'day') return 1;
    if (s.polar === 'night' || s.sunrise === null || s.sunset === null || s.sunset <= s.sunrise) return now >= (s.sunset || 0) ? 1 : 0;
    return Math.min(1, Math.max(0, (now - s.sunrise) / (s.sunset - s.sunrise)));
  }

  function isUp(place, now) {
    return WT.solar.sunAltitude(new Date(now), place.lat, place.lng) > RISE_SET;
  }

  // ---- moon ------------------------------------------------------------------------
  function moonAge(now) {
    return ((((now - NEW_MOON) / 86400000) % SYNODIC) + SYNODIC) % SYNODIC;
  }

  /** {age (days), illumination 0–1, waxing, name} */
  function moon(now) {
    const age = moonAge(now);
    const illumination = (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2;
    const e = SYNODIC / 8; // each named phase spans an eighth of the cycle, centred on its point
    const names = ['NEW MOON', 'WAXING CRESCENT', 'FIRST QUARTER', 'WAXING GIBBOUS', 'FULL MOON', 'WANING GIBBOUS', 'LAST QUARTER', 'WANING CRESCENT'];
    const name = names[Math.floor(((age + e / 2) % SYNODIC) / e) % 8];
    return { age, illumination, waxing: age < SYNODIC / 2, name };
  }

  /** Next full moon after `now` (timestamp). */
  function nextFullMoon(now) {
    const age = moonAge(now);
    let wait = SYNODIC / 2 - age;
    if (wait <= 0) wait += SYNODIC;
    return now + wait * 86400000;
  }

  /** Is (x, y) — relative to a disc of radius r — on the lit part of the moon? */
  function moonLit(x, y, r, m, southern) {
    const k = Math.cos(2 * Math.PI * m.age / SYNODIC);
    const edge = Math.sqrt(Math.max(0, r * r - y * y));
    if (southern) x = -x; // seen from the southern hemisphere the moon is mirrored
    return m.waxing ? x > k * edge : x < -k * edge;
  }

  function formatLength(ms) {
    const mins = Math.round(ms / 60000);
    return Math.floor(mins / 60) + 'H ' + String(mins % 60).padStart(2, '0') + 'M';
  }

  WT.sun = { sunTimes, daylightFraction, isUp, moon, nextFullMoon, moonLit, formatLength, dayStart, SYNODIC };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
