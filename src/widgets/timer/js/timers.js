/* Timer model: calendar-aware lengths (years … seconds), start / pause / reset,
 * progress for the bar and a fixed-width "time left" read-out. Pure functions. */
(function (WT) {
  'use strict';

  const UNITS = ['y', 'mo', 'd', 'h', 'mi', 's'];
  const LIMITS = { y: 99, mo: 999, d: 9999, h: 9999, mi: 9999, s: 9999 };

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  /**
   * Adds a length to a moment using the local calendar: years, months and days
   * move the date (keeping the wall-clock time; 31 Jan + 1 month = 28/29 Feb),
   * then hours, minutes and seconds are added as real elapsed time.
   */
  function addLength(ms, len) {
    const d = new Date(ms);
    let y = d.getFullYear() + (len.y || 0);
    let m = d.getMonth() + (len.mo || 0);
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    const day = Math.min(d.getDate(), daysInMonth(y, m));
    const t = new Date(y, m, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
    if (len.d) t.setDate(t.getDate() + len.d);
    return t.getTime() + ((len.h || 0) * 3600 + (len.mi || 0) * 60 + (len.s || 0)) * 1000;
  }

  function isEmptyLength(len) { return UNITS.every((u) => !len[u]); }

  /** Breaks the span now → end into calendar years, months, days, h, m, s (rounded up to the second). */
  function breakdown(now, end) {
    const out = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 };
    if (end <= now) return out;
    end = now + Math.ceil((end - now) / 1000) * 1000;
    if (end - now >= 86400000 * 28) {
      while (out.y < 99 && addLength(now, { y: out.y + 1 }) <= end) out.y++;
      while (addLength(now, { y: out.y, mo: out.mo + 1 }) <= end) out.mo++;
    }
    while (addLength(now, { y: out.y, mo: out.mo, d: out.d + 1 }) <= end) out.d++;
    let rest = Math.round((end - addLength(now, { y: out.y, mo: out.mo, d: out.d })) / 1000);
    out.h = Math.floor(rest / 3600); rest -= out.h * 3600;
    out.mi = Math.floor(rest / 60);
    out.s = rest - out.mi * 60;
    return out;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  /** "1Y 02M 03D", "2M 03D 04H", "3D 04:05:06" or "04:05:06". */
  function formatParts(b) {
    if (b.y) return `${b.y}Y ${pad2(b.mo)}M ${pad2(b.d)}D`;
    if (b.mo) return `${b.mo}M ${pad2(b.d)}D ${pad2(b.h)}H`;
    if (b.d) return `${b.d}D ${pad2(b.h)}:${pad2(b.mi)}:${pad2(b.s)}`;
    return `${pad2(b.h)}:${pad2(b.mi)}:${pad2(b.s)}`;
  }

  /** "1 year 2 months 5 minutes" for the settings window. */
  function describeLength(len) {
    const names = { y: 'year', mo: 'month', d: 'day', h: 'hour', mi: 'minute', s: 'second' };
    const parts = UNITS.filter((u) => len[u]).map((u) => len[u] + ' ' + names[u] + (len[u] === 1 ? '' : 's'));
    return parts.length ? parts.join(' ') : 'no length set';
  }

  /** Does this timer ever need the long (day/month/year) read-out? */
  function isLong(t) {
    const now = Date.now();
    return addLength(now, t.length) - now >= 86400000;
  }

  // Samples used to reserve a fixed-width slot for the read-out, so the widget
  // never changes size while counting down.
  const SHORT_SAMPLES = ['00:00:00', 'DONE'];
  const LONG_SAMPLES = ['00:00:00', 'DONE', '30D 00:00:00', '11M 30D 00H', '99Y 11M 30D'];
  function slotSamples(t) { return isLong(t) ? LONG_SAMPLES : SHORT_SAMPLES; }

  /** Milliseconds left (null = not started; full length). */
  function remainingMs(t, now) {
    switch (t.status) {
      case 'running': return Math.max(0, t.endAt - now);
      case 'paused': return Math.max(0, t.remainingMs);
      case 'done': return 0;
      default: return addLength(now, t.length) - now;
    }
  }

  /** 0 → 1 as time passes. */
  function progress(t, now) {
    if (t.status === 'done') return 1;
    if (t.status === 'idle' || !t.totalMs) return 0;
    return Math.min(1, Math.max(0, 1 - remainingMs(t, now) / t.totalMs));
  }

  /** Fraction of the bar to light: grows for "fill", shrinks for "empty". */
  function barFraction(t, now) {
    const p = progress(t, now);
    return t.direction === 'fill' ? p : 1 - p;
  }

  function readout(t, now) {
    if (t.status === 'done') return 'DONE';
    const left = remainingMs(t, now);
    return formatParts(breakdown(now, now + left));
  }

  // ---- state changes (return the same object, mutated) ---------------------
  function start(t, now) {
    if (t.status === 'running') return t;
    if (t.status === 'paused' && t.remainingMs > 0) {
      t.endAt = now + t.remainingMs;
    } else {
      const end = addLength(now, t.length);
      t.totalMs = Math.max(1000, end - now);
      t.endAt = now + t.totalMs;
    }
    t.status = 'running';
    t.remainingMs = null;
    t.alerting = false;
    return t;
  }

  function pause(t, now) {
    if (t.status !== 'running') return t;
    t.remainingMs = Math.max(0, t.endAt - now);
    t.endAt = null;
    t.status = 'paused';
    return t;
  }

  function reset(t) {
    t.status = 'idle';
    t.endAt = null;
    t.remainingMs = null;
    t.totalMs = 0;
    t.alerting = false;
    t.doneAt = null;
    return t;
  }

  function finish(t, when) {
    t.status = 'done';
    t.doneAt = when;
    t.endAt = null;
    t.remainingMs = 0;
    t.alerting = true;
    return t;
  }

  /** What the play/pause button does (a finished timer starts again from the top). */
  function toggle(t, now) {
    if (t.status === 'running') return pause(t, now);
    if (t.status === 'done') reset(t);
    return start(t, now);
  }

  /** Timers whose end time has passed (e.g. while the app was closed). */
  function overdue(timers, now) {
    return timers.filter((t) => t.status === 'running' && t.endAt <= now);
  }

  WT.timers = {
    UNITS, LIMITS, addLength, isEmptyLength, breakdown, formatParts, describeLength, slotSamples,
    remainingMs, progress, barFraction, readout, start, pause, reset, finish, toggle, overdue,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
