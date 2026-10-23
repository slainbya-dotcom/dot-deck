/* Calendar progress: how far through the current minute, hour, day, week, month
 * and year we are (local time), plus the read-outs shown beside each bar. Pure. */
(function (WT) {
  'use strict';

  const KINDS = ['minute', 'hour', 'day', 'week', 'month', 'year'];
  const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const mon = (d) => MONTHS[d.getMonth()].slice(0, 3);
  const pad2 = (n) => String(n).padStart(2, '0');

  /** ISO-8601 week number and the number of ISO weeks in that week-year. */
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const year = t.getUTCFullYear();
    const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
    const dec28 = new Date(Date.UTC(year, 11, 28));
    const d28 = dec28.getUTCDay() || 7;
    dec28.setUTCDate(dec28.getUTCDate() + 4 - d28);
    const weeks = Math.ceil(((dec28 - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
    return { week, weeks };
  }

  /**
   * The period containing `now`: {start, end, units, done} where `units` is how
   * many counted units it has and `done` how many are complete (fractional).
   * opts: {weekStart: 1 (Mon) | 0 (Sun), yearCounts: 'days'|'weeks'|'months'}
   */
  function period(kind, now, opts) {
    const d = new Date(now);
    const Y = d.getFullYear(), M = d.getMonth(), D = d.getDate();
    let start, end;
    switch (kind) {
      case 'minute':
        start = new Date(Y, M, D, d.getHours(), d.getMinutes()).getTime();
        end = start + 60000;
        return { start, end, units: 60, done: (now - start) / 1000 };
      case 'hour':
        start = new Date(Y, M, D, d.getHours()).getTime();
        end = start + 3600000;
        return { start, end, units: 60, done: (now - start) / 60000 };
      case 'day': {
        start = new Date(Y, M, D).getTime();
        end = new Date(Y, M, D + 1).getTime();       // 23 or 25 h on clock-change days
        const units = Math.round((end - start) / 3600000);
        return { start, end, units, done: (now - start) / 3600000 };
      }
      case 'week': {
        const ws = opts && opts.weekStart === 0 ? 0 : 1;
        const back = (d.getDay() - ws + 7) % 7;
        start = new Date(Y, M, D - back).getTime();
        end = new Date(Y, M, D - back + 7).getTime();
        return { start, end, units: 7, done: back + (now - new Date(Y, M, D).getTime()) / (new Date(Y, M, D + 1) - new Date(Y, M, D)) };
      }
      case 'month': {
        start = new Date(Y, M, 1).getTime();
        end = new Date(Y, M + 1, 1).getTime();
        const units = new Date(Y, M + 1, 0).getDate();
        const dayFrac = (now - new Date(Y, M, D).getTime()) / (new Date(Y, M, D + 1) - new Date(Y, M, D));
        return { start, end, units, done: D - 1 + dayFrac };
      }
      default: { // year
        start = new Date(Y, 0, 1).getTime();
        end = new Date(Y + 1, 0, 1).getTime();
        const daysInYear = Math.round((end - start) / 86400000);
        const dayFrac = (now - new Date(Y, M, D).getTime()) / (new Date(Y, M, D + 1) - new Date(Y, M, D));
        const doy = Math.round((new Date(Y, M, D) - start) / 86400000); // 0-based
        const counts = (opts && opts.yearCounts) || 'days';
        if (counts === 'months') {
          return { start, end, units: 12, done: M + (now - new Date(Y, M, 1).getTime()) / (new Date(Y, M + 1, 1) - new Date(Y, M, 1)) };
        }
        if (counts === 'weeks') return { start, end, units: daysInYear / 7, done: (doy + dayFrac) / 7 };
        return { start, end, units: daysInYear, done: doy + dayFrac };
      }
    }
  }

  /** 0 → 1 through the period. `steps` = whole units only (the bar jumps once per unit). */
  function fraction(kind, now, opts, steps) {
    const p = period(kind, now, opts);
    const done = steps ? Math.floor(p.done + 1e-9) : p.done;
    return Math.min(1, Math.max(0, done / p.units));
  }

  /** The unit-specific read-out, e.g. "SEC 42", "WK 43", "22 OCT", "OCT". */
  function value(kind, now, opts) {
    const d = new Date(now);
    switch (kind) {
      case 'minute': return 'SEC ' + pad2(d.getSeconds());
      case 'hour': return 'MIN ' + pad2(d.getMinutes());
      case 'day': return 'HR ' + pad2(d.getHours());
      case 'week': return 'WK ' + pad2(isoWeek(d).week);
      case 'month': return d.getDate() + ' ' + mon(d);
      default: {
        const counts = (opts && opts.yearCounts) || 'days';
        if (counts === 'months') return mon(d);
        if (counts === 'weeks') return 'WK ' + pad2(isoWeek(d).week);
        return d.getDate() + ' ' + mon(d);
      }
    }
  }

  /** "42/60", "4/7", "295/365", "43/52", "10/12". */
  function count(kind, now, opts) {
    const d = new Date(now);
    switch (kind) {
      case 'minute': return d.getSeconds() + '/60';
      case 'hour': return d.getMinutes() + '/60';
      case 'day': return d.getHours() + '/' + period('day', now, opts).units;
      case 'week': return (Math.floor(period('week', now, opts).done) + 1) + '/7';
      case 'month': return d.getDate() + '/' + period('month', now, opts).units;
      default: {
        const counts = (opts && opts.yearCounts) || 'days';
        if (counts === 'months') return (d.getMonth() + 1) + '/12';
        if (counts === 'weeks') { const w = isoWeek(d); return w.week + '/' + w.weeks; }
        const p = period('year', now, opts);
        return (Math.floor(p.done) + 1) + '/' + p.units;
      }
    }
  }

  function readout(t, now, opts) {
    const o = Object.assign({}, opts, { yearCounts: t.yearCounts });
    switch (t.show) {
      case 'count': return count(t.kind, now, o);
      case 'percent': return Math.floor(fraction(t.kind, now, o, false) * 100) + '%';
      case 'none': return '';
      default: return value(t.kind, now, o);
    }
  }

  /** Widest read-out a tracker can show, so its row never changes layout. */
  function slotSamples(t) {
    switch (t.show) {
      case 'count': return ['59/60', '25/25', '7/7', '31/31', '366/366', '53/53', '12/12'];
      case 'percent': return ['100%'];
      case 'none': return [''];
      default: return ['SEC 00', 'MIN 00', 'HR 00', 'WK 53', '30 SEP', 'SEP'];
    }
  }

  /** Label with tokens filled in: {WEEKDAY} {MONTH} {YEAR} {DATE} {WEEK}. */
  function label(text, now) {
    const d = new Date(now);
    return String(text || '')
      .replace(/\{WEEKDAY\}/gi, DAYS[d.getDay()])
      .replace(/\{MONTH\}/gi, MONTHS[d.getMonth()])
      .replace(/\{YEAR\}/gi, String(d.getFullYear()))
      .replace(/\{DATE\}/gi, d.getDate() + ' ' + mon(d))
      .replace(/\{WEEK\}/gi, 'WEEK ' + isoWeek(d).week);
  }

  /** Identifies the current period, to notice when one finishes (fills). */
  function periodKey(kind, now, opts) {
    return String(period(kind, now, opts).start);
  }

  WT.calendar = { KINDS, MONTHS, DAYS, isoWeek, period, fraction, value, count, readout, slotSamples, label, periodKey };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
