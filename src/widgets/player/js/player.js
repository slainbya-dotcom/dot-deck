/* Dot Player: draws the widget as a dot grid (pure, no DOM), plus a simulated
 * player for the browser preview. The grid also carries click regions ("hits")
 * that the widget turns into actions. */
(function (WT) {
  'use strict';
  const WHITE = '#e8e4d0', RED = '#ff5a4a';

  const VIEWS = [
    { id: 'player', name: 'Now playing' },
    { id: 'sound', name: 'Sound controls' },
  ];
  const ROWS = [
    { id: 'progress', view: 'player', name: 'Progress bar' },
    { id: 'buttons', view: 'player', name: 'Play / skip buttons' },
    { id: 'volume', view: 'sound', name: 'Volume' },
    { id: 'output', view: 'sound', name: 'Output device' },
    { id: 'input', view: 'sound', name: 'Input device' },
  ];
  const COLOR_IDS = ['track', 'progress', 'buttons', 'volume', 'output', 'input'];

  const ICON = {
    play: ['1000', '1100', '1110', '1111', '1110', '1100', '1000'],
    pause: ['11011', '11011', '11011', '11011', '11011', '11011', '11011'],
    stop: ['00000', '11111', '11111', '11111', '11111', '11111', '00000'],
    prev: ['100001', '100011', '100111', '101111', '100111', '100011', '100001'],
    next: ['100001', '110001', '111001', '111101', '111001', '110001', '100001'],
    speaker: ['0001', '0011', '1111', '1111', '1111', '0011', '0001'],
    left: ['000', '001', '011', '111', '011', '001', '000'],
    right: ['000', '100', '110', '111', '110', '100', '000'],
    foldUp: ['00000', '00000', '00100', '01110', '11111', '00000', '00000'],
    foldDown: ['00000', '00000', '11111', '01110', '00100', '00000', '00000'],
  };

  /** 75 -> "1:15", 3725 -> "1:02:05". */
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const ss = String(s).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }

  function grid(w, h) {
    const D = WT.dots;
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [], hits: [] };
    const ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a, clip) => {
      x = Math.round(x); y = Math.round(y);
      if (x < D.MARGIN || y < 0 || x >= w - D.MARGIN || y >= h) return;
      if (clip && (x < clip[0] || x >= clip[1])) return;
      g.cidx[y * w + x] = ci(c) + 1; g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.text = (s, x, y, c, a, clip) => {
      D.textColumns(s).forEach((m, i) => { for (let r = 0; r < 7; r++) if (m & (1 << r)) g.set(x + i, y + r, c, a, clip); });
      return D.textWidth(s);
    };
    g.icon = (rows, x, y, c, a) => {
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '1') g.set(x + i, y + j, c, a); });
      return rows[0].length;
    };
    g.hit = (x0, y0, x1, y1, action, extra) => g.hits.push(Object.assign({ x0, y0, x1, y1, action }, extra || {}));
    return g;
  }

  /** Text that fits is drawn as-is; text that doesn't scrolls round inside [x0, x1). */
  function marquee(g, s, x0, x1, y, c, a, offset, center) {
    const tw = WT.dots.textWidth(s), room = x1 - x0;
    if (tw <= room) { g.text(s, center ? x0 + Math.floor((room - tw) / 2) : x0, y, c, a); return false; }
    const loop = tw + 24, o = Math.floor(offset) % loop;
    g.text(s, x0 - o, y, c, a, [x0, x1]);
    g.text(s, x0 - o + loop, y, c, a, [x0, x1]);
    return true;
  }

  /** Which rows are on, in order. */
  function shownRows(state) {
    return ROWS.filter((r) => state.views[r.view] && state.rows[r.id]).map((r) => r.id);
  }

  /** Height in dots for these settings (the widget never changes size with the music). */
  function height(state) {
    const M = WT.dots.MARGIN;
    const title = state.views.player ? (state.layout === 'two' ? 2 : 1) : 0;
    const lines = Math.max(1, title + shownRows(state).length);
    return M * 2 + lines * 7 + (lines - 1) * 3;
  }

  /**
   * opts: { W, state, np, audio, scroll, colors }
   *   np    = { available, title, artist, playing, position, duration, source } (position already interpolated)
   *   audio = { volume|null, muted, outputs, output, inputs, input, mic_muted|null } or null while loading
   *   colors = { track, progress, buttons, volume, output, input }
   * Returns a grid with `hits` and `scrolling` (true if anything needs animating).
   */
  function build(opts) {
    const D = WT.dots, M = D.MARGIN;
    const { W, state, colors } = opts;
    const np = opts.np || { available: false };
    const audio = opts.audio;
    const scroll = opts.scroll || 0;
    const on = shownRows(state);
    const g = grid(W, height(state));
    g.scrolling = false;
    let y = M;

    if (!state.views.player && !on.length) { g.text('TURN ON A VIEW', M, y, WHITE, 0.6); return g; }

    if (state.views.player) {
      const tc = colors.track;
      const dim = np.playing ? 1 : 0.55;
      g.icon(!np.available ? ICON.stop : np.playing ? ICON.play : ICON.pause, M, y, tc, np.available ? 1 : 0.4);
      g.hit(M, y, M + 6, y + 7, 'toggle');
      const tx = M + 9, sc = np.playing ? scroll : 0;
      if (!np.available) g.text('NOTHING PLAYING', tx, y, WHITE, 0.45, [tx, W - M]);
      else if (state.layout === 'one') {
        const line = np.artist ? np.title + ' - ' + np.artist : np.title;
        g.scrolling = marquee(g, line, tx, W - M, y, tc, dim, sc) || g.scrolling;
      } else {
        g.scrolling = marquee(g, np.title, tx, W - M, y, tc, dim, sc) || g.scrolling;
        y += 10;
        g.scrolling = marquee(g, np.artist || ' ', tx, W - M, y, WHITE, 0.75 * dim, sc * 0.8) || g.scrolling;
      }
      y += 10;
    }

    for (const id of on) {
      const c = colors[id];
      if (id === 'progress') {
        const live = np.available && !(np.duration > 0);
        const left = np.available ? fmt(np.position) : '--:--';
        const right = !np.available ? '--:--' : live ? 'LIVE' : state.timeMode === 'left' ? '-' + fmt(np.duration - np.position) : fmt(np.duration);
        const lw = g.text(left, M, y, WHITE, 0.85);
        const rw = D.textWidth(right);
        g.text(right, W - M - rw, y, live ? RED : WHITE, 0.85);
        const b0 = M + lw + 4, b1 = W - M - rw - 4;
        if (b1 > b0 + 2) {
          const frac = np.available && !live ? Math.min(1, np.position / np.duration) : 0;
          const head = b0 + Math.round(frac * (b1 - b0 - 1));
          for (let x = b0; x < b1; x++) {
            if (np.available && !live && x === head) for (let j = 1; j <= 5; j++) g.set(x, y + j, WHITE);
            else if (np.available && !live && x < head) for (let j = 2; j <= 4; j++) g.set(x, y + j, c);
            else g.set(x, y + 3, c, 0.3);
          }
          if (np.available && !live) g.hit(b0, y, b1, y + 7, 'seek', { b0, b1 });
        }
      }
      if (id === 'buttons') {
        const parts = [ICON.prev, np.playing ? ICON.pause : ICON.play, ICON.next];
        const acts = ['prev', 'toggle', 'next'];
        const total = parts.reduce((s, p) => s + p[0].length, 0) + 2 * 12;
        let x = Math.floor((W - total) / 2);
        parts.forEach((p, i) => {
          const w = g.icon(p, x, y, c, np.available ? 1 : 0.35);
          g.hit(x - 3, y, x + w + 3, y + 7, acts[i]);
          x += w + 12;
        });
        // Fold arrow: opens / closes the Sound controls view from the widget.
        const fx = W - M - 5;
        g.icon(state.views.sound ? ICON.foldUp : ICON.foldDown, fx, y, WHITE, 0.6);
        g.hit(fx - 3, y, fx + 6, y + 7, 'fold');
      }
      if (id === 'volume') {
        const vol = audio && typeof audio.volume === 'number' ? audio.volume : null;
        const muted = !!(audio && audio.muted);
        g.icon(ICON.speaker, M, y, c, vol === null ? 0.4 : 1);
        if (muted) [[6, 2], [7, 3], [8, 4], [8, 2], [6, 4]].forEach(([dx, dy]) => g.set(M + dx, y + dy, RED));
        else if (vol !== null) {
          if (vol > 0) [2, 3, 4].forEach((dy) => g.set(M + 6, y + dy, c));
          if (vol > 0.5) [1, 2, 3, 4, 5].forEach((dy) => g.set(M + 8, y + dy, c));
        }
        if (audio) g.hit(M, y, M + 9, y + 7, 'mute');
        const label = !audio ? '--' : vol === null ? 'N/A' : muted ? 'MUTE' : String(Math.round(vol * 100));
        g.text(label, W - M - D.textWidth(label), y, muted ? RED : WHITE, vol === null ? 0.45 : 0.85);
        const b0 = M + 13, b1 = W - M - D.textWidth('MUTE') - 4;
        const n = Math.round((vol || 0) * (b1 - b0));
        for (let x = b0; x < b1; x++) {
          if ((x - b0) % 2) continue;
          const hgt = 1 + Math.floor(((x - b0) / (b1 - b0)) * 6);
          for (let j = 0; j < hgt; j++) g.set(x, y + 6 - j, c, vol !== null && x - b0 < n ? (muted ? 0.35 : 1) : 0.18);
        }
        if (vol !== null) g.hit(b0 - 2, y, b1 + 2, y + 7, 'volume', { b0, b1 });
      }
      if (id === 'output' || id === 'input') {
        const isOut = id === 'output';
        const list = (audio && (isOut ? audio.outputs : audio.inputs)) || [];
        const cur = audio && (isOut ? audio.output : audio.input);
        const dev = list.find((d) => d.id === cur);
        const micMuted = !isOut && audio && audio.mic_muted === true;
        g.text(isOut ? 'OUT' : 'IN', M, y, c);
        if (!isOut && audio && audio.mic_muted !== null && audio.mic_muted !== undefined) g.hit(M, y, M + 18, y + 7, 'mic');
        const a0 = M + 21, a1 = W - M - 3;
        const many = list.length > 1;
        g.icon(ICON.left, a0, y, c, many ? 0.9 : 0.3);
        g.icon(ICON.right, a1, y, c, many ? 0.9 : 0.3);
        if (many) {
          g.hit(a0 - 2, y, a0 + 5, y + 7, 'device', { kind: id, dir: -1 });
          g.hit(a1 - 2, y, a1 + 5, y + 7, 'device', { kind: id, dir: 1 });
          g.hit(a0 + 5, y, a1 - 2, y + 7, 'device', { kind: id, dir: 1 });
        }
        if (micMuted) {
          const t = 'MIC MUTED';
          g.text(t, a0 + 6 + Math.max(0, Math.floor((a1 - a0 - 7 - D.textWidth(t)) / 2)), y, RED, 1, [a0 + 5, a1 - 1]);
        } else {
          const name = !audio ? '...' : dev ? dev.name : list.length ? 'CHOOSE A DEVICE' : 'NO DEVICES';
          g.scrolling = marquee(g, name, a0 + 6, a1 - 2, y, WHITE, dev ? 0.9 : 0.5, scroll * 0.7, true) || g.scrolling;
        }
      }
      y += 10;
    }
    return g;
  }

  /** Grid dot (gx, gy) -> the hit under it, if any. */
  function hitAt(g, gx, gy) {
    return g.hits.find((h) => gx >= h.x0 && gx < h.x1 && gy >= h.y0 - 1 && gy < h.y1 + 1) || null;
  }

  /** The next device id in `list` after `cur`, wrapping round. */
  function cycle(list, cur, dir) {
    if (!list || !list.length) return null;
    const i = list.findIndex((d) => d.id === cur);
    return list[(Math.max(0, i) + dir + list.length * 2) % list.length].id;
  }

  // ---- simulated player and devices (browser preview / development) ---------------------------
  function simulator() {
    const TRACKS = [
      ['Neon Harbour', 'The Low Satellites', 233], ['Paper Lanterns', 'Mira Vale', 198],
      ['Slow Static', 'Kite Theory', 261], ['Glass Orchard', 'Juniper & The Echoes', 174],
    ];
    const outs = [['o1', 'Speakers (Realtek Audio)'], ['o2', 'Headphones'], ['o3', 'LG Monitor (HDMI)']].map(([id, name]) => ({ id, name }));
    const ins = [['i1', 'Microphone Array'], ['i2', 'Yeti Stereo Mic'], ['i3', 'Headset Mic']].map(([id, name]) => ({ id, name }));
    const S = { track: 0, pos: 42, playing: true, at: Date.now(), vol: 0.62, muted: false, out: 'o2', inp: 'i1', mic: false };
    const tick = () => {
      const now = Date.now();
      if (S.playing) S.pos += (now - S.at) / 1000;
      S.at = now;
      if (S.pos >= TRACKS[S.track][2]) { S.track = (S.track + 1) % TRACKS.length; S.pos = 0; }
    };
    return {
      readPlayer() {
        tick();
        const t = TRACKS[S.track];
        return { available: true, source: 'Preview', title: t[0], artist: t[1], playing: S.playing, position: S.pos, duration: t[2] };
      },
      action(a, p) {
        tick();
        if (a === 'toggle') S.playing = !S.playing;
        if (a === 'next') { S.track = (S.track + 1) % TRACKS.length; S.pos = 0; }
        if (a === 'prev') { if (S.pos > 3) S.pos = 0; else { S.track = (S.track + TRACKS.length - 1) % TRACKS.length; S.pos = 0; } }
        if (a === 'seek') S.pos = p;
      },
      readAudio: () => ({ volume: S.vol, muted: S.muted, outputs: outs, output: S.out, inputs: ins, input: S.inp, mic_muted: S.mic }),
      setVolume(v) { S.vol = v; S.muted = false; },
      setMuted(m) { S.muted = m; },
      setDevice(kind, id) { if (kind === 'input') S.inp = id; else S.out = id; },
      setMicMuted(m) { S.mic = m; },
    };
  }

  WT.player = { VIEWS, ROWS, COLOR_IDS, ICON, fmt, shownRows, height, build, hitAt, cycle, simulator, WHITE, RED };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
