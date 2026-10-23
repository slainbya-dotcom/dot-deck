/* Dot Launcher: dot icons, guessing a good icon for a new item, and drawing the two
 * styles (pure, no DOM). The grid carries click regions ("hits") for the widget. */
(function (WT) {
  'use strict';
  const WHITE = '#e8e4d0', GREEN = '#39ff7a';
  const MAX_ITEMS = 42;
  const STYLES = ['icons', 'list'];
  const KINDS = ['app', 'file', 'folder', 'web'];

  // 7x7 icons, drawn at double size in the icon style.
  const ICON = {
    app: ['1111111', '1000001', '1111111', '1000001', '1000001', '1000001', '1111111'],
    globe: ['0011100', '0101010', '1111111', '1001001', '1111111', '0101010', '0011100'],
    folder: ['0000000', '1110000', '1111111', '1000001', '1000001', '1111111', '0000000'],
    doc: ['1111000', '1001100', '1000110', '1111111', '1000001', '1011101', '1111111'],
    mail: ['0000000', '1111111', '1100011', '1010101', '1001001', '1111111', '0000000'],
    chat: ['1111111', '1000001', '1011101', '1000001', '1111111', '0110000', '0100000'],
    music: ['0001111', '0001001', '0001001', '0001001', '0111011', '1111011', '0110000'],
    code: ['0000000', '0010100', '0100010', '1000001', '0100010', '0010100', '0000000'],
    terminal: ['1111111', '1000001', '1010001', '1001001', '1010111', '1000001', '1111111'],
    calc: ['1111111', '1000001', '1111111', '1010101', '1111111', '1010101', '1111111'],
    photo: ['1111111', '1000001', '1000101', '1010001', '1111001', '1111111', '0000000'],
    video: ['0000000', '1111100', '1000110', '1000101', '1000110', '1111100', '0000000'],
    game: ['0000000', '0111110', '1101011', '1000001', '1101011', '0111110', '0000000'],
    gear: ['0010100', '0111110', '1100011', '0100010', '1100011', '0111110', '0010100'],
    calendar: ['0100010', '1111111', '1000001', '1010101', '1000001', '1010101', '1111111'],
    note: ['1111110', '1000010', '1011010', '1000010', '1011010', '1000010', '1111110'],
    cart: ['1000000', '0111111', '0100001', '0100010', '0111100', '0000000', '0010010'],
    star: ['0001000', '0001000', '1111111', '0111110', '0011100', '0110110', '0100010'],
    heart: ['0000000', '0110110', '1111111', '1111111', '0111110', '0011100', '0001000'],
    home: ['0001000', '0011100', '0111110', '1111111', '0100010', '0101010', '0111110'],
  };
  const ICON_NAMES = Object.keys(ICON);
  const COLORS = ['#ffb000', '#5ad1ff', '#39ff7a', '#ff6bd5', '#b8ff5a', '#c9a0ff', '#ff5a4a', '#e8e4d0'];

  const isUrl = (t) => /^(https?|mailto|ftp):/i.test(String(t).trim()) || /^www\./i.test(String(t).trim());
  /** What kind of thing a path or link is, from how it looks. */
  function kindOf(target) {
    const t = String(target || '').trim();
    if (isUrl(t)) return 'web';
    if (/\.(exe|lnk|appref-ms|app|url)\/?$/i.test(t)) return 'app';
    if (/[\\/]$/.test(t) || !/\.[a-z0-9]{1,5}$/i.test(t.split(/[\\/]/).pop() || '')) return 'folder';
    return 'file';
  }
  /** A friendly name: "Google Chrome.lnk" -> "Google Chrome", "https://www.bbc.co.uk/news" -> "bbc.co.uk". */
  function nameOf(target) {
    const t = String(target || '').trim().replace(/[\\/]+$/, '');
    if (isUrl(t)) {
      const m = /^(?:[a-z]+:\/\/)?(?:www\.)?([^/?#:]+)/i.exec(t.replace(/^mailto:/i, ''));
      return m ? m[1] : t;
    }
    const last = t.split(/[\\/]/).pop() || t;
    return last.replace(/\.(exe|lnk|appref-ms|app|url)$/i, '');
  }
  /** A good icon for a name + kind: browsers get the globe, Spotify the note, and so on. */
  function iconFor(name, kind, target) {
    const s = (String(name) + ' ' + String(target || '')).toLowerCase();
    const rules = [
      [/chrome|firefox|edge|safari|opera|brave|browser/, 'globe'], [/outlook|mail|gmail|thunderbird/, 'mail'],
      [/teams|slack|discord|whatsapp|messages|zoom|skype|telegram|signal/, 'chat'], [/spotify|music|itunes|tidal|deezer|podcast/, 'music'],
      [/code|studio|xcode|intellij|pycharm|sublime|notepad\+\+|github/, 'code'], [/terminal|powershell|cmd|iterm|console|bash/, 'terminal'],
      [/calc/, 'calc'], [/photo|lightroom|gimp|paint|figma|canva|picture/, 'photo'], [/vlc|video|netflix|youtube|prime|plex|film|tv/, 'video'],
      [/steam|epic|game|xbox|battle\.net|origin|minecraft/, 'game'], [/settings|control panel|preferences/, 'gear'],
      [/calendar/, 'calendar'], [/notion|onenote|notes|obsidian|evernote|word|docs/, 'note'], [/amazon|ebay|shop|store/, 'cart'],
      [/excel|sheet|\.xlsx|\.csv|\.docx|\.pdf|\.pptx|\.txt/, 'doc'],
    ];
    for (const [re, icon] of rules) if (re.test(s)) return icon;
    return kind === 'web' ? 'globe' : kind === 'folder' ? 'folder' : kind === 'file' ? 'doc' : 'app';
  }

  function grid(w, h) {
    const D = WT.dots, M = D.MARGIN;
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [], hits: [] };
    const ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a) => {
      x = Math.round(x); y = Math.round(y);
      if (x < M || y < 0 || x >= w - M || y >= h) return;
      g.cidx[y * w + x] = ci(c) + 1; g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.text = (s, x, y, c, a) => {
      D.textColumns(s).forEach((m, i) => { for (let r = 0; r < 7; r++) if (m & (1 << r)) g.set(x + i, y + r, c, a); });
      return D.textWidth(s);
    };
    g.bits = (rows, x, y, c, a, k) => {
      k = k || 1;
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '1') for (let dx = 0; dx < k; dx++) for (let dy = 0; dy < k; dy++) g.set(x + i * k + dx, y + j * k + dy, c, a); });
    };
    g.hit = (x0, y0, x1, y1, action, extra) => g.hits.push(Object.assign({ x0, y0, x1, y1, action }, extra || {}));
    return g;
  }
  function fit(s, room) {
    const D = WT.dots;
    s = D.normalizeText(s);
    if (D.textWidth(s) <= room) return s;
    while (s && D.textWidth(s + '..') > room) s = s.slice(0, -1);
    return s.trimEnd() + '..';
  }

  const SIZE = 14;                 // icon size in dots (7x7 at double size)
  /** Icons per row at this width. */
  const perRow = (W) => Math.max(3, Math.floor((W - WT.dots.MARGIN * 2 + 4) / (SIZE + 4)));

  function height(state, W) {
    const M = WT.dots.MARGIN;
    if (state.style === 'list') {
      const rows = Math.min(state.listRows, Math.max(1, Math.ceil(state.items.length / 2)));
      return M * 2 + rows * 10 - 3;
    }
    return M * 2 + state.rows * SIZE + (state.rows - 1) * 4 + 3 + 7;
  }

  /**
   * opts: { W, state, hover (item id), scroll (first row), opening ({id, failed}) or null, color (main), dropping (bool) }
   * state: { style 'icons'|'list', rows (1-3), listRows, items: [{id, name, target, kind, icon, color}] }
   */
  function build(opts) {
    const D = WT.dots, M = D.MARGIN;
    const { W, state } = opts;
    const main = opts.color || '#ffb000';
    const items = state.items;
    const g = grid(W, height(state, W));
    const empty = opts.dropping ? 'DROP TO ADD' : 'DROP APPS HERE, OR ADD IN SETTINGS';

    if (state.style === 'list') {
      const colW = Math.floor((W - M * 2 - 4) / 2);
      const totalRows = Math.ceil(items.length / 2);
      const maxScroll = Math.max(0, totalRows - state.listRows);
      const top = Math.max(0, Math.min(maxScroll, opts.scroll || 0));
      g.scrollTop = top; g.maxScroll = maxScroll;
      if (!items.length) { g.text(fit(empty, W - M * 2), M, M, opts.dropping ? GREEN : WHITE, opts.dropping ? 1 : 0.35); return g; }
      items.slice(top * 2, (top + state.listRows) * 2).forEach((it, k) => {
        const x = M + (k % 2) * (colW + 4), y = M + Math.floor(k / 2) * 10;
        const hov = opts.hover === it.id;
        const op = opts.opening && opts.opening.id === it.id;
        g.bits(ICON[it.icon] || ICON.app, x, y, it.color, hov || op ? 1 : 0.8);
        const label = op ? (opts.opening.failed ? 'CAN\'T OPEN' : 'OPENING') : it.name;
        g.text(fit(label, colW - 10 - (maxScroll && k % 2 ? 3 : 0)), x + 10, y, op ? (opts.opening.failed ? '#ff5a4a' : GREEN) : hov ? WHITE : main, hov || op ? 1 : 0.9);
        g.hit(x - 1, y - 1, x + colW, y + 8, 'open', { id: it.id });
      });
      if (maxScroll) {
        const H = state.listRows * 10 - 3;
        const a = Math.floor((top / totalRows) * H), b = Math.ceil(((top + state.listRows) / totalRows) * H);
        for (let y = 0; y < H; y++) g.set(W - M - 1, M + y, WHITE, y >= a && y < b ? 0.7 : 0.15);
      }
      return g;
    }

    // Icons: 1-3 rows, then a line for the name of whatever's under the mouse.
    const per = perRow(W);
    const gap = Math.floor((W - M * 2 - per * SIZE) / Math.max(1, per - 1));
    const totalRows = Math.ceil(items.length / per);
    const maxScroll = Math.max(0, totalRows - state.rows);
    const top = Math.max(0, Math.min(maxScroll, opts.scroll || 0));
    g.scrollTop = top; g.maxScroll = maxScroll;
    items.slice(top * per, (top + state.rows) * per).forEach((it, k) => {
      const x = M + (k % per) * (SIZE + gap), y = M + Math.floor(k / per) * (SIZE + 4);
      const hov = opts.hover === it.id;
      g.bits(ICON[it.icon] || ICON.app, x, y, it.color, hov ? 1 : 0.75, 2);
      if (hov) for (let i = 2; i < SIZE - 2; i++) g.set(x + i, y + SIZE + 1, it.color, 0.8);   // underline the one you're on
      g.hit(x - 2, y - 2, x + SIZE + 2, y + SIZE + 2, 'open', { id: it.id });
    });
    const ly = g.h - M - 7;
    const hovered = items.find((it) => it.id === opts.hover);
    const pages = maxScroll ? (top + 1) + '/' + (maxScroll + 1) : '';
    const pagesW = pages ? D.textWidth(pages) + 4 : 0;
    if (pages) g.text(pages, W - M - D.textWidth(pages), ly, WHITE, 0.35);
    if (opts.opening) {
      const it = items.find((x) => x.id === opts.opening.id);
      g.text(fit((opts.opening.failed ? 'CAN\'T OPEN ' : 'OPENING ') + (it ? it.name : ''), W - M * 2 - pagesW), M, ly, opts.opening.failed ? '#ff5a4a' : GREEN);
    } else if (hovered) {
      const kind = hovered.kind.toUpperCase();
      const kw = pages ? 0 : D.textWidth(kind) + 4;
      g.text(fit(hovered.name, W - M * 2 - kw - pagesW), M, ly, hovered.color);
      if (!pages) g.text(kind, W - M - D.textWidth(kind), ly, WHITE, 0.4);
    } else if (!items.length) {
      g.text(fit(empty, W - M * 2), M, ly, opts.dropping ? GREEN : WHITE, opts.dropping ? 1 : 0.35);
    } else {
      g.text(fit(opts.dropping ? 'DROP TO ADD' : 'HOVER FOR NAMES', W - M * 2 - pagesW), M, ly, opts.dropping ? GREEN : WHITE, opts.dropping ? 1 : 0.3);
    }
    return g;
  }

  function hitAt(g, gx, gy) {
    return g.hits.find((h) => gx >= h.x0 && gx < h.x1 && gy >= h.y0 && gy < h.y1) || null;
  }

  WT.launcher = { ICON, ICON_NAMES, COLORS, STYLES, KINDS, MAX_ITEMS, SIZE, isUrl, kindOf, nameOf, iconFor, perRow, height, build, hitAt, WHITE, GREEN };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
