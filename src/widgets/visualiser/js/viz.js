/* Dot Visualiser: smoothing the sound readings and drawing the five styles as a dot
 * grid (pure, no DOM), plus simulated music for the browser preview. */
(function (WT) {
  'use strict';
  const WHITE = '#e8e4d0', AMBER = '#ffb000', RED = '#ff5a4a', GREEN = '#39ff7a', BLUE = '#5ad1ff';
  const STYLES = ['bars', 'mirror', 'scope', 'vu', 'falls'];
  const BANDS = 32;
  const FALL_ROWS = 14;
  const HEIGHT = { bars: 20, mirror: 21, scope: 19, vu: 17, falls: FALL_ROWS };   // without margins / track line
  const TRACK_H = 10;      // the "what's playing" line + gap

  // ---- smoothing --------------------------------------------------------------------------------------
  /** Everything the styles need between frames. */
  function createState() {
    return {
      level: new Array(BANDS).fill(0), peak: new Array(BANDS).fill(0),
      vuL: 0, vuR: 0, pkL: 0, pkR: 0, wave: [], waveMax: 0.05, ring: [], active: false,
    };
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  /** dB -> 0..1. sensitivity 0..1 moves the floor from -40 dB (only loud parts) to -90 dB (everything). */
  const fromDb = (db, sensitivity) => {
    const floor = -40 - 50 * sensitivity;
    return clamp01((db - floor) / -floor);
  };

  /**
   * Folds one reading into the state. frame = { bands: dB[32], wave: [-1..1], left, right (RMS 0..1), active }.
   * Bars jump up straight away and fall smoothly; peak caps hang, then drift down.
   */
  function update(s, frame, dt, sensitivity) {
    dt = Math.max(0, Math.min(0.25, dt || 0));
    const sens = typeof sensitivity === 'number' ? sensitivity : 0.5;
    const fall = Math.pow(0.02, dt);
    for (let b = 0; b < BANDS; b++) {
      const v = frame && frame.active ? fromDb(frame.bands[b], sens) : 0;
      s.level[b] = v > s.level[b] ? v : s.level[b] * fall;
      s.peak[b] = Math.max(s.level[b], s.peak[b] - dt * 0.6);
    }
    const vu = (rms) => (rms > 0 ? fromDb(20 * Math.log10(rms) + 12, sens * 0.6) : 0);
    const L = frame && frame.active ? vu(frame.left) : 0, R = frame && frame.active ? vu(frame.right) : 0;
    const vfall = Math.pow(0.05, dt);
    s.vuL = Math.max(L, s.vuL * vfall); s.vuR = Math.max(R, s.vuR * vfall);
    s.pkL = Math.max(s.vuL, s.pkL - dt * 0.4); s.pkR = Math.max(s.vuR, s.pkR - dt * 0.4);
    // The wave is scaled to its recent loudest point so quiet music still fills the scope.
    const w = frame && frame.active && frame.wave ? frame.wave : [];
    const m = w.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
    s.waveMax = Math.max(0.05, m, s.waveMax * Math.pow(0.3, dt));
    s.wave = w.map((x) => x / s.waveMax);
    s.ring.unshift(s.level.slice());
    if (s.ring.length > FALL_ROWS) s.ring.length = FALL_ROWS;
    s.active = !!(frame && frame.active);
    return s;
  }

  // ---- drawing --------------------------------------------------------------------------------------
  function grid(w, h) {
    const D = WT.dots, M = D.MARGIN;
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [] };
    const ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a, clip) => {
      x = Math.round(x); y = Math.round(y);
      if (x < M || y < 0 || x >= w - M || y >= h) return;
      if (clip && (x < clip[0] || x >= clip[1])) return;
      g.cidx[y * w + x] = ci(c) + 1; g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.text = (s, x, y, c, a, clip) => {
      D.textColumns(s).forEach((m, i) => { for (let r = 0; r < 7; r++) if (m & (1 << r)) g.set(x + i, y + r, c, a, clip); });
      return D.textWidth(s);
    };
    g.bits = (rows, x, y, c, a) => rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '1') g.set(x + i, y + j, c, a); });
    return g;
  }
  const PLAY = ['1000', '1100', '1110', '1111', '1110', '1100', '1000'];
  const PAUSE = ['11011', '11011', '11011', '11011', '11011', '11011', '11011'];
  const NOTE = ['00011', '00101', '00100', '00100', '01100', '11100', '01000'];

  /** Text that fits is drawn as-is; text that doesn't scrolls round inside [x0, x1). */
  function marquee(g, s, x0, x1, y, c, a, offset) {
    const tw = WT.dots.textWidth(s), room = x1 - x0;
    if (tw <= room) { g.text(s, x0, y, c, a); return false; }
    const loop = tw + 24, o = Math.floor(offset) % loop;
    g.text(s, x0 - o, y, c, a, [x0, x1]);
    g.text(s, x0 - o + loop, y, c, a, [x0, x1]);
    return true;
  }

  /** Band value for column x of n across the width (smoothly interpolated). */
  function bandAt(arr, x, n) {
    const f = (x / Math.max(1, n - 1)) * (BANDS - 1), i = Math.floor(f), k = f - i;
    return arr[i] * (1 - k) + arr[Math.min(BANDS - 1, i + 1)] * k;
  }

  /** Total height in dots for a style, with or without the track line. */
  function height(style, showTrack) {
    return WT.dots.MARGIN * 2 + HEIGHT[style] + (showTrack ? TRACK_H : 0);
  }

  /**
   * opts: { W, style, s (state), showTrack, np ({available, title, artist, playing}), scroll,
   *         colorMode 'meter'|'one', color (main dot colour), peaks (bool) }
   * Returns a grid; `g.scrolling` is true when the track name needs to scroll.
   */
  function build(opts) {
    const D = WT.dots, M = D.MARGIN;
    const { W, s } = opts;
    const style = STYLES.includes(opts.style) ? opts.style : 'bars';
    const main = opts.color || AMBER;
    const one = opts.colorMode === 'one';
    const heat = (f) => (one ? main : f > 0.85 ? RED : f > 0.6 ? AMBER : GREEN);
    const g = grid(W, height(style, opts.showTrack));
    const GW = W - M * 2;
    g.scrolling = false;
    let top = M;

    if (opts.showTrack) {
      const np = opts.np || {};
      if (np.available) {
        g.bits(np.playing ? PLAY : PAUSE, M, top, main, np.playing ? 1 : 0.6);
        const line = np.artist ? np.title + ' - ' + np.artist : np.title;
        g.scrolling = marquee(g, D.normalizeText(line), M + 8, W - M, top, main, np.playing ? 1 : 0.55, np.playing ? opts.scroll || 0 : 0);
      } else {
        g.bits(NOTE, M, top, main, 0.4);
        g.text('NOTHING PLAYING', M + 8, top, WHITE, 0.4);
      }
      top += TRACK_H;
    }

    const H = HEIGHT[style];
    if (style === 'bars') {
      const cols = Math.max(8, Math.floor((GW + 2) / 6)), cw = 4;
      const gap = Math.max(1, Math.floor((GW - cols * cw) / (cols - 1)));
      const off = M + Math.floor((GW - (cols * cw + (cols - 1) * gap)) / 2);
      for (let c = 0; c < cols; c++) {
        const n = Math.round(bandAt(s.level, c, cols) * H);
        const pk = Math.min(H - 1, Math.round(bandAt(s.peak, c, cols) * H));
        for (let k = 0; k < H; k++) {
          const y = top + H - 1 - k;
          for (let i = 0; i < cw; i++) {
            if (k < n) g.set(off + c * (cw + gap) + i, y, heat(k / H), k % 2 ? 0.85 : 1);
            else if (opts.peaks !== false && k === pk && pk > 0) g.set(off + c * (cw + gap) + i, y, WHITE, 0.85);
          }
        }
      }
    } else if (style === 'mirror') {
      const mid = top + 10;
      for (let x = 0; x < GW; x += 2) {
        // Lows in the middle, highs out at the edges.
        const n = Math.round(bandAt(s.level, Math.abs(x - GW / 2) * 2, GW) * 10);
        for (let k = 0; k <= n; k++) {
          const a = 1 - (k / 11) * 0.6;
          g.set(M + x, mid - k, main, a);
          g.set(M + x, mid + k, main, a * 0.6);
        }
      }
    } else if (style === 'scope') {
      const mid = top + 9, c = one ? main : GREEN;
      for (let x = 0; x < GW; x += 4) g.set(M + x, mid, WHITE, 0.2);
      const w = s.wave;
      let prev = null;
      for (let x = 0; x < GW; x++) {
        const v = w.length ? w[Math.min(w.length - 1, Math.floor((x / GW) * w.length))] : 0;
        const y = mid - Math.round(Math.max(-1, Math.min(1, v)) * 9);
        if (prev !== null) for (let yy = Math.min(prev, y); yy <= Math.max(prev, y); yy++) g.set(M + x, yy, c);
        else g.set(M + x, y, c);
        prev = y;
      }
    } else if (style === 'vu') {
      [['L', s.vuL, s.pkL, top], ['R', s.vuR, s.pkR, top + 10]].forEach(([ch, v, p, y]) => {
        g.text(ch, M, y, WHITE, 0.7);
        const x0 = M + 8, segs = Math.floor((GW - 8) / 3);
        const n = Math.round(v * segs), pk = Math.round(p * segs);
        for (let seg = 0; seg < segs; seg++) {
          for (let j = 0; j < 7; j++) for (let i = 0; i < 2; i++) {
            if (seg < n) g.set(x0 + seg * 3 + i, y + j, heat(seg / segs));
            else if (opts.peaks !== false && seg === pk - 1) g.set(x0 + seg * 3 + i, y + j, WHITE, 0.9);
            else if (j === 3) g.set(x0 + seg * 3 + i, y + j, WHITE, 0.12);
          }
        }
      });
    } else {
      // Waterfall: newest at the top, each row older and fainter.
      for (let r = 0; r < Math.min(FALL_ROWS, s.ring.length); r++) {
        for (let x = 0; x < GW; x += 2) {
          const v = bandAt(s.ring[r], x, GW);
          if (v > 0.06) g.set(M + x, top + r, one ? main : v > 0.6 ? AMBER : BLUE, Math.min(1, 0.45 + v * 1.2) * (1 - (r / FALL_ROWS) * 0.7));
        }
      }
    }
    return g;
  }

  // ---- simulated music (browser preview / development) --------------------------------------------
  /** Returns fn(t seconds) -> a reading shaped like the app's: a 120 bpm beat with a melody. */
  function simulator() {
    let playing = true;
    const fn = (t) => {
      if (!playing) return { bands: new Array(BANDS).fill(-100), wave: new Array(128).fill(0), left: 0, right: 0, active: false };
      const beat = (t * 2) % 1, bar = Math.floor(t * 2) % 4;
      const kick = Math.exp(-beat * 9), snare = bar % 2 ? Math.exp(-beat * 7) : 0, hat = Math.exp(-((t * 4) % 1) * 14);
      const mel = 0.5 + 0.5 * Math.sin(t * 0.9);
      const bands = [];
      for (let b = 0; b < BANDS; b++) {
        const f = b / (BANDS - 1);
        const v = Math.min(1, 0.9 * kick * Math.exp(-f * 9) + 0.6 * snare * Math.exp(-((f - 0.45) ** 2) / 0.03)
          + 0.45 * hat * Math.exp(-((f - 0.85) ** 2) / 0.01)
          + 0.45 * Math.exp(-((f - 0.2 - mel * 0.35) ** 2) / 0.004) * (0.7 + 0.3 * Math.sin(t * 7))
          + 0.12 * (1 - f) + 0.05 * Math.random());
        bands.push(-65 + v * 65);
      }
      const wave = [];
      for (let i = 0; i < 128; i++) {
        const x = i / 128;
        wave.push(0.3 * (0.55 * kick * Math.sin(x * 9 + t * 40) + 0.3 * Math.sin(x * 37 + t * 90) * (0.4 + snare) + 0.12 * Math.sin(x * 120 + t * 300) * hat));
      }
      const loud = 0.08 + 0.12 * kick + 0.05 * snare;
      return { bands, wave, left: loud * (0.95 + 0.05 * Math.sin(t * 3)), right: loud * (0.95 + 0.05 * Math.cos(t * 2.3)), active: true };
    };
    fn.toggle = () => { playing = !playing; return playing; };
    return fn;
  }

  WT.viz = { STYLES, BANDS, HEIGHT, TRACK_H, createState, update, fromDb, build, height, simulator, WHITE, GREEN, RED, AMBER };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
