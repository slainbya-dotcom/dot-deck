/* Ten chiptune chimes, synthesised live with Web Audio (no sound files).
 *  - "8-bit" ones use pulse waves (12.5 / 25 / 50 % duty), volume that steps
 *    down in 1/15ths at 60 Hz like an NES, and a little bit-crush grit.
 *  - "16-bit" ones use smoother triangle/pulse voices with vibrato, a low-pass
 *    filter and a short echo, more like a SNES.
 * Every chime uses only notes from a major scale/chord: bright, never minor. */
(function (WT) {
  'use strict';

  // note = [start s, length s, MIDI note, voice, volume 0-1]
  function arp(notes, step, voice, last, vol) {
    return notes.map((m, i) => [i * step, i === notes.length - 1 ? last : step * 0.95, m, voice, vol || 1]);
  }

  const CHIMES = [
    // Hi tones
    { id: 'coin', name: 'Coin', kind: 'Hi', bits: 8,
      notes: [[0, 0.08, 83, 'p25', 1], [0.08, 0.42, 88, 'p25', 1]] },
    { id: 'sparkle', name: 'Sparkle', kind: 'Hi', bits: 8,
      notes: arp([84, 88, 91, 96], 0.065, 'p12', 0.38) },
    { id: 'powerup', name: 'Power Up', kind: 'Hi', bits: 8,
      notes: arp([72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96], 0.04, 'p25', 0.32, 0.9) },
    // Dual tones
    { id: 'dingdong', name: 'Ding Dong', kind: 'Dual', bits: 16,
      notes: [[0, 0.55, 76, 'tri', 1], [0, 0.55, 88, 'p50', 0.22], [0.5, 0.95, 72, 'tri', 1], [0.5, 0.95, 84, 'p50', 0.22]] },
    { id: 'twotone', name: 'Two-Tone', kind: 'Dual', bits: 8,
      notes: [72, 79, 72, 79].map((m, i) => [i * 0.15, 0.135, m, 'p50', 0.8]) },
    { id: 'chirp', name: 'Chirp', kind: 'Dual', bits: 8,
      notes: [[0, 0.09, 84, 'p25', 0.7], [0, 0.09, 88, 'p25', 0.7], [0.15, 0.24, 84, 'p25', 0.7], [0.15, 0.24, 88, 'p25', 0.7]] },
    { id: 'fanfare', name: 'Fanfare', kind: 'Dual', bits: 16,
      notes: [[0, 0.1, 67, 'p25', 0.9], [0.11, 0.1, 72, 'p25', 0.9], [0.22, 0.1, 76, 'p25', 0.9],
        [0.33, 0.7, 79, 'p25', 0.9], [0.33, 0.7, 76, 'p12', 0.5], [0.33, 0.7, 60, 'tri', 0.9]] },
    // Lo tones
    { id: 'warmbell', name: 'Warm Bell', kind: 'Lo', bits: 16,
      notes: [[0, 1.5, 48, 'tri', 1], [0, 1.3, 55, 'tri', 0.6], [0.02, 1.1, 64, 'tri', 0.45]] },
    { id: 'lowarp', name: 'Low Arp', kind: 'Lo', bits: 8,
      notes: arp([48, 52, 55, 60], 0.13, 'p50', 0.5, 0.8) },
    { id: 'bounce', name: 'Bounce', kind: 'Lo', bits: 16,
      notes: arp([53, 57, 60, 65], 0.1, 'tri', 0.12).concat([[0.45, 0.65, 60, 'tri', 0.8], [0.45, 0.65, 65, 'tri', 0.8]]) },
  ];

  const byId = (id) => CHIMES.find((c) => c.id === id) || null;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const lengthOf = (c) => c.notes.reduce((m, n) => Math.max(m, n[0] + n[1]), 0);

  // ---- audio ---------------------------------------------------------------
  let ctx = null;
  const waves = {};

  function audio() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /** Call from any click so later (timer-triggered) chimes are allowed to play. */
  function unlock() { audio(); }

  /** Band-limited pulse wave with the given duty cycle. */
  function pulse(ac, duty) {
    const key = 'p' + duty;
    if (waves[key]) return waves[key];
    const n = 48, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      re[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
      im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
    }
    waves[key] = ac.createPeriodicWave(re, im);
    return waves[key];
  }

  function voice(ac, osc, name) {
    if (name === 'tri') osc.type = 'triangle';
    else osc.setPeriodicWave(pulse(ac, name === 'p12' ? 0.125 : name === 'p25' ? 0.25 : 0.5));
  }

  /** 4-bit-ish quantiser for that 8-bit grit. */
  function crusher(ac) {
    const ws = ac.createWaveShaper();
    const steps = 16, curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    ws.curve = curve;
    return ws;
  }

  /** Plays a chime now. volume 0–1. Returns its length in seconds (0 if it can't play). */
  function play(id, volume) {
    const ac = audio();
    return ac ? schedule(ac, id, volume) : 0;
  }

  /** Builds the chime into any AudioContext (also used with OfflineAudioContext for tests). */
  function schedule(ac, id, volume) {
    const c = byId(id);
    if (!c) return 0;
    const t0 = ac.currentTime + 0.03;
    const master = ac.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume === undefined ? 0.7 : volume)) * 0.22;
    master.connect(ac.destination);

    let bus = master;
    const extra = [];
    if (c.bits === 8) {
      // Halve first so two voices together never hit the shaper's ±1 limit.
      const pre = ac.createGain();
      pre.gain.value = 0.5;
      const cr = crusher(ac);
      pre.connect(cr);
      cr.connect(master);
      master.gain.value *= 1.6;
      bus = pre;
      extra.push(pre, cr);
    } else {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;
      const echo = ac.createDelay(1);
      echo.delayTime.value = 0.17;
      const fb = ac.createGain();
      fb.gain.value = 0.28;
      const wet = ac.createGain();
      wet.gain.value = 0.35;
      lp.connect(master);
      lp.connect(echo);
      echo.connect(fb);
      fb.connect(echo);
      echo.connect(wet);
      wet.connect(master);
      bus = lp;
      extra.push(lp, echo, fb, wet);
    }

    for (const [start, len, midi, vname, vol] of c.notes) {
      const osc = ac.createOscillator();
      voice(ac, osc, vname);
      osc.frequency.value = hz(midi);
      const g = ac.createGain();
      const at = t0 + start, peak = vol;
      if (c.bits === 8) {
        // NES-style: instant attack, volume steps down in 1/15ths every frame.
        const frames = Math.max(1, Math.round(len * 60));
        for (let f = 0; f <= frames; f++) {
          const level = Math.round(15 * peak * (1 - 0.55 * f / frames)) / 15;
          g.gain.setValueAtTime(level, at + f / 60);
        }
        g.gain.setValueAtTime(0, at + len);
      } else {
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(peak, at + 0.012);
        g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * 0.05), at + len);
        g.gain.setValueAtTime(0, at + len + 0.01);
        if (len > 0.3) {
          const lfo = ac.createOscillator();
          const depth = ac.createGain();
          lfo.frequency.value = 5.5;
          depth.gain.value = 7; // cents
          lfo.connect(depth);
          depth.connect(osc.detune);
          lfo.start(at + 0.15);
          lfo.stop(at + len + 0.05);
        }
      }
      osc.connect(g);
      g.connect(bus);
      osc.start(at);
      osc.stop(at + len + 0.05);
    }

    const total = lengthOf(c) + (c.bits === 16 ? 0.9 : 0.1);
    if (typeof OfflineAudioContext !== 'undefined' && ac instanceof OfflineAudioContext) return total;
    setTimeout(() => {
      try { master.disconnect(); extra.forEach((n) => n.disconnect()); } catch (e) { /* already gone */ }
    }, (total + 0.2) * 1000);
    return total;
  }

  /** A short dice rattle: a few clicks of filtered noise, like dice on a table. `n` = how many dice. */
  function rattle(volume, n) {
    const ac = audio();
    if (!ac || !(volume > 0)) return;
    const len = Math.floor(ac.sampleRate * 0.03);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const hits = Math.min(9, 3 + Math.max(1, n || 1));
    const t0 = ac.currentTime + 0.01;
    for (let k = 0; k < hits; k++) {
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 1800 + Math.random() * 2600; bp.Q.value = 3 + Math.random() * 4;
      const g = ac.createGain();
      // Clicks bunch up at the start and thin out as the dice settle.
      const at = t0 + 0.42 * Math.pow(k / hits, 1.6) + Math.random() * 0.02;
      g.gain.value = volume * 0.9 * (1 - (k / hits) * 0.6);
      src.connect(bp); bp.connect(g); g.connect(ac.destination);
      src.start(at);
    }
  }

  WT.chimes = { CHIMES, byId, play, schedule, unlock, lengthOf, hz, rattle };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
