/* Dot Reader: the upper + lower case dot font, laying an article out into lines, and
 * drawing the widget (pure, no DOM). The grid carries click regions ("hits"). */
(function (WT) {
  'use strict';
  const WHITE = '#e8e4d0', BLUE = '#5ad1ff', DIM = '#8a8676', RED = '#ff5a4a';
  const LINE = 11;          // 9 rows of letter + 2 rows of space
  const TOP_BAR = 14;       // address bar + rule
  const BOTTOM_BAR = 11;    // rule + status line

  // ---- font: capitals, digits and punctuation from the family's 5x7 font; lower case is 9 rows ----
  const LOWER = {
    a: '00000 00000 01110 00001 01111 10001 01111 00000 00000', b: '10000 10000 10110 11001 10001 10001 11110 00000 00000',
    c: '00000 00000 01110 10000 10000 10001 01110 00000 00000', d: '00001 00001 01101 10011 10001 10001 01111 00000 00000',
    e: '00000 00000 01110 10001 11111 10000 01110 00000 00000', f: '00110 01001 01000 11100 01000 01000 01000 00000 00000',
    g: '00000 00000 01111 10001 10001 01111 00001 10001 01110', h: '10000 10000 10110 11001 10001 10001 10001 00000 00000',
    i: '00100 00000 01100 00100 00100 00100 01110 00000 00000', j: '00010 00000 00110 00010 00010 00010 00010 10010 01100',
    k: '10000 10000 10010 10100 11000 10100 10010 00000 00000', l: '01100 00100 00100 00100 00100 00100 01110 00000 00000',
    m: '00000 00000 11010 10101 10101 10001 10001 00000 00000', n: '00000 00000 10110 11001 10001 10001 10001 00000 00000',
    o: '00000 00000 01110 10001 10001 10001 01110 00000 00000', p: '00000 00000 11110 10001 10001 11110 10000 10000 10000',
    q: '00000 00000 01111 10001 10001 01111 00001 00001 00001', r: '00000 00000 10110 11001 10000 10000 10000 00000 00000',
    s: '00000 00000 01111 10000 01110 00001 11110 00000 00000', t: '01000 01000 11100 01000 01000 01001 00110 00000 00000',
    u: '00000 00000 10001 10001 10001 10011 01101 00000 00000', v: '00000 00000 10001 10001 10001 01010 00100 00000 00000',
    w: '00000 00000 10001 10001 10101 10101 01010 00000 00000', x: '00000 00000 10001 01010 00100 01010 10001 00000 00000',
    y: '00000 00000 10001 10001 10001 01111 00001 10001 01110', z: '00000 00000 11111 00010 00100 01000 11111 00000 00000',
  };
  const EXTRA = {
    '•': '00000 00000 00000 01110 01110 01110 00000 00000 00000', '·': '000 000 000 000 010 000 000 000 000', '×': '00000 00000 10001 01010 00100 01010 10001 00000 00000',
    ';': '00000 01100 01100 00000 01100 00100 01000 00000 00000', '_': '00000 00000 00000 00000 00000 00000 00000 11111 00000',
    '|': '00100 00100 00100 00100 00100 00100 00100 00100 00100', '~': '00000 00000 00000 01000 10101 00010 00000 00000 00000',
    '^': '00100 01010 10001 00000 00000 00000 00000 00000 00000', '`': '01000 00100 00000 00000 00000 00000 00000 00000 00000',
    '{': '00110 00100 00100 01000 00100 00100 00110 00000 00000', '}': '01100 00100 00100 00010 00100 00100 01100 00000 00000',
    '[': '01110 01000 01000 01000 01000 01000 01110 00000 00000', ']': '01110 00010 00010 00010 00010 00010 01110 00000 00000',
    '\\': '10000 10000 01000 00100 00010 00001 00001 00000 00000', '°': '01100 10010 10010 01100 00000 00000 00000 00000 00000',
    '£': '00110 01001 01000 11110 01000 01000 11111 00000 00000', '$': '00100 01111 10100 01110 00101 11110 00100 00000 00000',
    '€': '00111 01000 11110 01000 11110 01000 00111 00000 00000',
  };
  function fromBitmap(bm) {
    const rows = bm.split(' ');
    const c = [];
    for (let x = 0; x < 5; x++) { let m = 0; for (let y = 0; y < 9; y++) if (rows[y][x] === '1') m |= 1 << y; c.push(m); }
    let a = 0, b = c.length - 1;
    while (a < b && !c[a]) a++;
    while (b > a && !c[b]) b--;
    return c.slice(a, b + 1);
  }
  const cache = new Map();
  /** Column bitmasks (9 rows, bit 0 = top) for one character. */
  function glyph(ch) {
    let cols = cache.get(ch);
    if (cols) return cols;
    if (ch === ' ') cols = [0, 0];
    else if (LOWER[ch]) cols = fromBitmap(LOWER[ch]);
    else if (EXTRA[ch]) cols = fromBitmap(EXTRA[ch]);
    else cols = WT.dots.textColumns(WT.dots.normalizeText(ch));
    if (!cols.length) cols = [0];
    cache.set(ch, cols);
    return cols;
  }
  /** Smart quotes, dashes and accents to things the font has (é -> e); case is kept. */
  function plain(s) {
    return String(s == null ? '' : s)
      .replace(/[‘’‚‛′]/g, "'").replace(/[“”„″]/g, '"')
      .replace(/[–—―−]/g, '-').replace(/…/g, '...')
      .replace(/[  -​  　]/g, ' ').replace(/­/g, '')
      .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').replace(/œ/g, 'oe').replace(/ø/g, 'o').replace(/Ø/g, 'O')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function widthOf(s) {
    let w = 0, n = 0;
    for (const ch of plain(s)) { w += glyph(ch).length; n++; }
    return n ? w + n - 1 : 0;
  }

  // ---- layout: article blocks -> lines ------------------------------------------------------------------
  /*
   * Blocks: { t: 'h1'|'h2'|'h3'|'p'|'meta'|'li'|'quote'|'pre'|'img'|'hr', r: [[text, {href}?], ...], n (list number) }
   * Lines:  { y, kind, runs: [{x, text, color, alpha, href}], first } plus 'rule', 'bar', 'img' and 'bullet' marks.
   */
  const STYLE = {
    h1: { color: 'main', alpha: 1, after: 3, rule: true },
    h2: { color: 'main', alpha: 1, before: 5, after: 3 },
    h3: { color: 'main', alpha: 0.8, before: 3, after: 2 },
    p: { color: 'text', alpha: 0.95, after: 6 },
    meta: { color: DIM, alpha: 0.9, after: 6 },
    li: { color: 'text', alpha: 0.95, indent: 9, after: 2 },
    quote: { color: 'text', alpha: 0.6, indent: 8, bar: true, before: 1, after: 6 },
    pre: { color: 'text', alpha: 0.7, indent: 4, after: 6, keepSpaces: true },
    img: { color: DIM, alpha: 0.8, before: 2, after: 6 },
    hr: { before: 2, after: 6 },
  };
  const IMG_H = 22;

  function layout(blocks, width) {
    const lines = [];
    let y = 0, prev = null;
    for (const b of blocks) {
      const st = STYLE[b.t] || STYLE.p;
      if (prev === 'li' && b.t !== 'li') y += 4;
      y += st.before || 0;
      if (b.t === 'hr') { lines.push({ y: y + 2, kind: 'rule', soft: true }); y += 5 + st.after; prev = b.t; continue; }
      if (b.t === 'img') {
        lines.push({ y, kind: 'img', h: IMG_H });
        y += IMG_H + 3;
        const cap = b.r && b.r.length && b.r.map((x) => x[0]).join('').trim();
        if (cap) {
          const sub = layoutRuns([[('Image: ' + cap).slice(0, 200)]], width, st, y, 'imgcap');
          for (const l of sub.lines) lines.push(l);
          y = sub.y;
        }
        y += st.after;
        prev = b.t;
        continue;
      }
      const label = b.t === 'li' && b.n ? b.n + '.' : null;
      const ind = label ? Math.max(9, widthOf(label) + 4) : st.indent || 0;
      const start = y;
      const sub = layoutRuns(b.r || [], width - ind, st, y, b.t, ind);
      if (!sub.lines.length) { prev = b.t; continue; }
      sub.lines[0].first = true;
      if (b.t === 'li') sub.lines[0].bullet = label || true;
      for (const l of sub.lines) lines.push(l);
      y = sub.y;
      if (st.rule) { lines.push({ y: y - 1, kind: 'rule' }); y += 2; }
      if (st.bar) lines.push({ y: start, kind: 'bar', h: y - start - 2 });
      y += st.after || 0;
      prev = b.t;
    }
    return { lines, height: y };
  }

  /** Word-wraps inline runs ([text, {href}]) into lines starting at y. Very long words are broken. */
  function layoutRuns(runs, maxW, st, y, kind, indent) {
    const lines = [];
    const words = [];
    for (const [text, o] of runs) {
      const href = o && o.href;
      const parts = st.keepSpaces ? plain(text).split(/(\n)/) : plain(text).replace(/\s+/g, ' ').split(/( )/);
      for (const p of parts) {
        if (p === '') continue;
        if (p === '\n') words.push({ br: true });
        else if (p === ' ' && !st.keepSpaces) words.push({ space: true });
        else words.push({ w: p, href });
      }
    }
    let line = { y, kind, runs: [] }, x = 0, space = false;
    const flush = () => { lines.push(line); y += LINE; line = { y, kind, runs: [] }; x = 0; space = false; };
    const color = st.color, alpha = st.alpha;
    for (const wd of words) {
      if (wd.br) { flush(); continue; }
      if (wd.space) { space = x > 0; continue; }
      let w = wd.w;
      let ww = widthOf(w);
      const sp = space ? 4 : 0;
      if (x > 0 && x + sp + ww > maxW) flush();
      else x += sp;
      // A word longer than the whole line (a long link, say): break it across lines.
      while (ww > maxW && w.length > 1) {
        let cut = w.length;
        while (cut > 1 && widthOf(w.slice(0, cut)) > maxW - x) cut--;
        line.runs.push({ x: x + (indent || 0), text: w.slice(0, cut), color: wd.href ? BLUE : color, alpha: wd.href ? 1 : alpha, href: wd.href });
        flush();
        w = w.slice(cut); ww = widthOf(w);
      }
      line.runs.push({ x: x + (indent || 0), text: w, color: wd.href ? BLUE : color, alpha: wd.href ? 1 : alpha, href: wd.href });
      x += ww;
      space = false;
    }
    if (line.runs.length) flush();
    return { lines, y };
  }

  // ---- drawing ------------------------------------------------------------------------------------------
  function grid(w, h) {
    const D = WT.dots, M = D.MARGIN;
    const g = { w, h, cidx: new Uint8Array(w * h), alpha: new Float32Array(w * h), colors: [], hits: [] };
    const ci = (c) => { let i = g.colors.indexOf(c); if (i < 0) { g.colors.push(c); i = g.colors.length - 1; } return i; };
    g.set = (x, y, c, a, y0, y1) => {
      x = Math.round(x); y = Math.round(y);
      if (x < M || y < 0 || x >= w - M || y >= h) return;
      if (y0 !== undefined && (y < y0 || y >= y1)) return;
      g.cidx[y * w + x] = ci(c) + 1; g.alpha[y * w + x] = a === undefined ? 1 : a;
    };
    g.write = (s, x, y, c, a, y0, y1) => {
      for (const ch of plain(s)) {
        const cols = glyph(ch);
        cols.forEach((m, i) => { for (let r = 0; r < 9; r++) if (m & (1 << r)) g.set(x + i, y + r, c, a, y0, y1); });
        x += cols.length + 1;
      }
      return x - 1;
    };
    g.bits = (rows, x, y, c, a) => rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '1') g.set(x + i, y + j, c, a); });
    g.hit = (x0, y0, x1, y1, action, extra) => g.hits.push(Object.assign({ x0, y0, x1, y1, action }, extra || {}));
    return g;
  }
  /** Trims text (adding "..") to fit in `room` dots. */
  function fit(s, room) {
    s = plain(s);
    if (widthOf(s) <= room) return s;
    while (s && widthOf(s + '..') > room) s = s.slice(0, -1);
    return s.trimEnd() + '..';
  }
  const BACK = ['000', '001', '011', '111', '011', '001', '000'];
  const FWD = ['000', '100', '110', '111', '110', '100', '000'];
  const OUT = ['0001111', '0000011', '0000101', '1001001', '1010000', '1000000', '1111110'];
  const HOME = ['0001000', '0011100', '0111110', '1111111', '0100010', '0101010', '0111110'];

  /** Content area (y range) for a widget of height H. */
  function view(H) {
    const M = WT.dots.MARGIN;
    return { top: M + TOP_BAR, bottom: H - M - BOTTOM_BAR };
  }

  /**
   * opts: { W, H, page ({url, title, blocks} | null), laid (layout result), scroll, nav {back, fwd},
   *         editing (address text or null), loading, error, hoverHref, t, color (main), text (body colour) }
   */
  function build(opts) {
    const D = WT.dots, M = D.MARGIN;
    const { W, H } = opts;
    const main = opts.color || '#ffb000', text = opts.text || WHITE;
    const g = grid(W, H);
    const nav = opts.nav || {};

    // ---- top bar: back, forward, home, the address, open-in-browser ----
    g.bits(BACK, M, M + 1, main, nav.back ? 0.9 : 0.25); if (nav.back) g.hit(M - 1, M - 1, M + 5, M + 9, 'back');
    g.bits(FWD, M + 6, M + 1, main, nav.fwd ? 0.9 : 0.25); if (nav.fwd) g.hit(M + 5, M - 1, M + 11, M + 9, 'fwd');
    g.bits(HOME, M + 13, M + 1, main, 0.6); g.hit(M + 12, M - 1, M + 21, M + 9, 'home');
    const web = opts.page && /^https?:/i.test(opts.page.url || '');
    if (web) { g.bits(OUT, W - M - 7, M + 1, main, 0.6); g.hit(W - M - 9, M - 1, W - M, M + 9, 'external'); }
    const ax = M + 24, ar = W - M - (web ? 11 : 0);
    if (opts.editing !== null && opts.editing !== undefined) {
      for (let x = ax - 2; x < ar; x++) g.set(x, M + 10, main, 0.8);   // underline while typing
      let s = plain(opts.editing);
      while (s && widthOf(s) > ar - ax - 4) s = s.slice(1);
      const ex = g.write(s, ax, M, text, 1);
      if (Math.floor((opts.t || 0) * 2.5) % 2 === 0) for (let j = 0; j < 9; j++) g.set(ex + 2, M + j, main);
    } else {
      const u = opts.page ? String(opts.page.url || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/^dot:/, '') : '';
      g.write(fit(u || 'Type an address', ar - ax), ax, M, DIM, u ? 0.9 : 0.6);
    }
    g.hit(ax - 2, M - 1, ar, M + 9, 'address');
    for (let x = M; x < W - M; x += 2) g.set(x, M + 11, WHITE, 0.15);

    // ---- the page ----
    const { top, bottom } = view(H);
    const viewH = bottom - top;
    const tw = W - M * 2 - 4;
    g.scrollTop = 0; g.maxScroll = 0;
    if (opts.error) {
      g.write(fit('Couldn’t open this page', tw), M, top, main, 1);
      layoutRuns([[opts.error]], tw, STYLE.p, 0, 'p').lines.slice(0, Math.max(1, Math.floor(viewH / LINE) - 3)).forEach((l, i) => {
        for (const r of l.runs) g.write(r.text, M + r.x, top + LINE + 2 + i * LINE, text, 0.7, top, bottom);
      });
      if (web || opts.errorUrl) {
        const y = bottom - LINE;
        const e = g.write('Open it in your browser', M, y, BLUE, 1, top, bottom);
        for (let x = M; x < e; x++) g.set(x, y + 9, BLUE, 0.5, top, bottom);
        g.hit(M - 1, y - 1, e + 2, y + 10, 'external');
      }
    } else if (opts.laid) {
      const laid = opts.laid;
      const maxScroll = Math.max(0, laid.height - viewH);
      const sy = Math.round(Math.max(0, Math.min(maxScroll, opts.scroll || 0)));
      g.scrollTop = sy; g.maxScroll = maxScroll;
      const fade = opts.loading ? 0.35 : 1;
      for (const l of laid.lines) {
        const y = top + l.y - sy;
        if (y > bottom || y + IMG_H + 2 < top) continue;
        if (l.kind === 'rule') { for (let x = M; x < M + tw; x += l.soft ? 2 : 1) g.set(x, y, main, 0.35 * fade, top, bottom); continue; }
        if (l.kind === 'bar') { for (let j = 0; j < l.h; j++) g.set(M + 2, y + j, main, 0.6 * fade, top, bottom); continue; }
        if (l.kind === 'img') {
          const x0 = M, x1 = M + Math.min(tw, 54);
          for (let x = x0; x < x1; x += 2) { g.set(x, y, DIM, 0.6 * fade, top, bottom); g.set(x, y + l.h, DIM, 0.6 * fade, top, bottom); }
          for (let j = 0; j <= l.h; j += 2) { g.set(x0, y + j, DIM, 0.6 * fade, top, bottom); g.set(x1 - 1, y + j, DIM, 0.6 * fade, top, bottom); }
          for (let k = 0; k < 16; k++) g.set(x0 + 8 + k, y + l.h - 4 - Math.min(k, 16 - k) * 0.8, DIM, 0.8 * fade, top, bottom);
          for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) g.set(x1 - 12 + k, y + 5 + j, DIM, 0.8 * fade, top, bottom);
          continue;
        }
        if (l.bullet === true) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) g.set(M + 3 + k, y + 3 + j, main, 0.9 * fade, top, bottom);
        else if (l.bullet) g.write(l.bullet, M + 1, y, main, 0.9 * fade, top, bottom);
        for (const r of l.runs) {
          const c = r.color === 'main' ? main : r.color === 'text' ? text : r.color;
          const hov = r.href && r.href === opts.hoverHref;
          const end = g.write(r.text, M + r.x, y, c, (hov ? 1 : r.alpha) * fade, top, bottom);
          if (r.href) {
            for (let x = M + r.x; x <= end; x++) g.set(x, y + 9, BLUE, (hov ? 1 : 0.45) * fade, top, bottom);
            if (y + 10 > top && y < bottom) g.hit(M + r.x - 1, Math.max(top, y - 1), end + 3, Math.min(bottom, y + 10), 'link', { href: r.href });
          }
        }
      }
      if (maxScroll > 0) {
        const a = Math.floor((sy / laid.height) * viewH), b = Math.ceil(((sy + viewH) / laid.height) * viewH);
        for (let y = 0; y < viewH; y++) g.set(W - M - 1, top + y, WHITE, y >= a && y < b ? 0.7 : 0.12);
      }
    }

    // ---- status line: title (or LOADING...) and how far through you are ----
    for (let x = M; x < W - M; x += 2) g.set(x, bottom, WHITE, 0.15);
    const sy = bottom + 2;
    if (opts.loading) {
      const dots = '.'.repeat(1 + (Math.floor((opts.t || 0) * 3) % 3));
      g.write('Loading' + dots, M, sy, main, 0.9);
    } else {
      const pct = g.maxScroll ? Math.round((g.scrollTop / g.maxScroll) * 100) + '%' : '';
      const pw = pct ? widthOf(pct) + 4 : 0;
      if (pct) g.write(pct, W - M - widthOf(pct), sy, WHITE, 0.4);
      // Over a link: where it goes. Otherwise the page title.
      if (opts.hoverHref) g.write(fit(String(opts.hoverHref).replace(/^https?:\/\/(www\.)?/i, ''), W - M * 2 - pw), M, sy, BLUE, 0.8);
      else {
        const title = opts.error ? 'Error' : opts.page ? opts.page.title || '' : '';
        if (title) g.write(fit(title, W - M * 2 - pw), M, sy, main, 0.6);
      }
    }
    return g;
  }

  function hitAt(g, gx, gy) {
    return g.hits.find((h) => gx >= h.x0 && gx < h.x1 && gy >= h.y0 && gy < h.y1) || null;
  }

  /** Words -> minutes at an easy reading pace. */
  function readingMinutes(blocks) {
    let n = 0;
    for (const b of blocks) for (const r of b.r || []) n += String(r[0]).split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(n / 230));
  }

  // ---- built-in pages --------------------------------------------------------------------------------------
  const WELCOME = {
    url: 'dot:welcome',
    title: 'Welcome to Dot Reader',
    blocks: [
      { t: 'h1', r: [['Welcome to Dot Reader']] },
      { t: 'p', r: [['Click the address at the top, type a web address and press Enter. The page opens in reading mode: just the words, in dots.']] },
      { t: 'h2', r: [['Getting around']] },
      { t: 'li', r: [['Scroll with the mouse wheel, the arrow keys, Page Up / Page Down or Space']] },
      { t: 'li', r: [['Click a ', {}], ['blue link', { href: 'dot:links' }], [' to follow it; ◂ ▸ go back and forward']] },
      { t: 'li', r: [['The house goes to your home page; the arrow on the right opens the page in your normal browser']] },
      { t: 'li', r: [['Ctrl+L (Cmd+L on a Mac) jumps to the address']] },
      { t: 'h2', r: [['Good to know']] },
      { t: 'p', r: [['Reading mode works best on articles, blogs, news, recipes, documentation and Wikipedia. Web apps such as email, video or social media sites have little to read and are better in your normal browser.']] },
      { t: 'p', r: [['Try ', {}], ['en.wikipedia.org/wiki/Dot_matrix', { href: 'https://en.wikipedia.org/wiki/Dot_matrix' }], [' to start.', {}]] },
      { t: 'meta', r: [['Change the size, colours and home page in settings (right-click the widget).']] },
    ],
  };
  const LINKS = {
    url: 'dot:links',
    title: 'About links',
    blocks: [
      { t: 'h1', r: [['About links']] },
      { t: 'p', r: [['Links are blue and underlined, and they brighten when the mouse is over them. Links to other web pages open in Dot Reader; anything else (like email addresses) is left alone.']] },
      { t: 'p', r: [['Go ', {}], ['back to the welcome page', { href: 'dot:welcome' }], ['.', {}]] },
    ],
  };
  const BUILTIN = { 'dot:welcome': WELCOME, 'dot:links': LINKS };

  WT.reader = { LINE, TOP_BAR, BOTTOM_BAR, glyph, plain, widthOf, layout, layoutRuns, build, view, hitAt, fit, readingMinutes, BUILTIN, WHITE, BLUE, DIM, RED };
})(typeof window !== 'undefined' ? (window.WT = window.WT || {}) : (globalThis.WT = globalThis.WT || {}));
