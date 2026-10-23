/* Focus-cycle model: focus → break → focus … with an optional long break every
 * N focus rounds. Pure functions over (cycle, settings). */
(function (WT) {
  'use strict';

  const PHASES = ['focus', 'break', 'long'];
  const pad2 = (n) => String(n).padStart(2, '0');

  /** Length of a phase in ms. s.lengths[phase] = {h, mi, s}. */
  function lengthMs(s, phase) {
    const L = s.lengths[phase] || {};
    return Math.max(1, ((L.h || 0) * 3600 + (L.mi || 0) * 60 + (L.s || 0))) * 1000;
  }

  /** Which phase comes after the current one, and the updated round count. */
  function nextPhase(s, c) {
    if (c.phase !== 'focus') return { phase: 'focus', round: c.round };
    const round = c.round + 1;
    if (s.longEnabled && round >= s.longEvery) return { phase: 'long', round: 0 };
    return { phase: 'break', round };
  }

  function remainingMs(c, s, now) {
    if (c.status === 'running') return Math.max(0, c.endAt - now);
    if (c.status === 'paused') return Math.max(0, c.remainingMs);
    return lengthMs(s, c.phase);
  }

  function progress(c, s, now) {
    if (c.status !== 'running' && c.status !== 'paused') return 0;
    const total = c.totalMs || lengthMs(s, c.phase);
    return Math.min(1, Math.max(0, 1 - remainingMs(c, s, now) / total));
  }

  /** Does this phase's bar fill up (true) or drain (false)? */
  function fills(s, phase) {
    switch (s.barMode) {
      case 'allFill': return true;
      case 'allDrain': return false;
      case 'focusDrains': return phase !== 'focus';
      default: return phase === 'focus'; // 'focusFills'
    }
  }

  function barFraction(c, s, now) {
    const p = progress(c, s, now);
    return fills(s, c.phase) ? p : 1 - p;
  }

  /** "00:25:00" (hours always shown, matching Dot Timer). */
  function readout(c, s, now) {
    const t = Math.ceil(remainingMs(c, s, now) / 1000);
    return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}:${pad2(t % 60)}`;
  }

  // ---- state changes (mutate and return the cycle) ---------------------------
  function start(c, s, now) {
    if (c.status === 'running') return c;
    if (c.status === 'paused' && c.remainingMs > 0) {
      c.endAt = now + c.remainingMs;
    } else {
      c.totalMs = lengthMs(s, c.phase);
      c.endAt = now + c.totalMs;
    }
    c.status = 'running';
    c.remainingMs = null;
    c.alerting = false;
    return c;
  }

  function pause(c, now) {
    if (c.status !== 'running') return c;
    c.remainingMs = Math.max(0, c.endAt - now);
    c.endAt = null;
    c.status = 'paused';
    return c;
  }

  function toggle(c, s, now) {
    return c.status === 'running' ? pause(c, now) : start(c, s, now);
  }

  /** Back to the first focus round, stopped. */
  function reset(c) {
    c.phase = 'focus';
    c.round = 0;
    c.status = 'idle';
    c.endAt = null;
    c.remainingMs = null;
    c.totalMs = 0;
    c.alerting = false;
    c.doneAt = null;
    return c;
  }

  /** Moves to the next phase. Keeps running if it was running (or `run` is true). */
  function skip(c, s, now, run) {
    const wasRunning = c.status === 'running' || run;
    const n = nextPhase(s, c);
    c.phase = n.phase;
    c.round = n.round;
    c.alerting = false;
    c.remainingMs = null;
    c.endAt = null;
    c.status = 'idle';
    if (wasRunning) start(c, s, now);
    return c;
  }

  /**
   * A running phase reached its end at time `at`. Switches to the next phase and
   * either starts it straight away (auto) or waits for the user. Returns the phase that ended.
   */
  function advance(c, s, at) {
    const ended = c.phase;
    const n = nextPhase(s, c);
    c.phase = n.phase;
    c.round = n.round;
    c.totalMs = lengthMs(s, c.phase);
    c.remainingMs = null;
    c.doneAt = at;
    c.alerting = true;
    if (s.next === 'auto') {
      c.status = 'running';
      c.endAt = at + c.totalMs;   // no drift: next phase starts exactly when the last ended
    } else {
      c.status = 'waiting';
      c.endAt = null;
    }
    return ended;
  }

  /** Processes every phase that ended up to `now` (e.g. after the app was closed). */
  function catchUp(c, s, now) {
    const ended = [];
    let guard = 0;
    while (c.status === 'running' && c.endAt <= now && guard++ < 500) ended.push(advance(c, s, c.endAt));
    return ended;
  }

  WT.focus = {
    PHASES, lengthMs, nextPhase, remainingMs, progress, fills, barFraction, readout,
    start, pause, toggle, reset, skip, advance, catchUp,
  };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
