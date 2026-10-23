/* The floating dot-matrix reader (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const R = WT.reader;
  const native = WT.store.native;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let lastSize = '';
  let grid = null;
  const t0 = performance.now();

  // Navigation: a list of visited pages with where you'd scrolled to.
  const history = [];
  let at = -1;
  const pages = new Map();            // url -> article (this session)
  let page = null, laid = null, laidKey = '';
  let scroll = 0;
  let loading = false, error = null, errorUrl = null;
  let editing = null;
  let hoverHref = null;
  let loadId = 0;

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const look = () => ({ dotSize: state.dotSize, dotShape: state.dotShape, showUnlit: state.showUnlit, dotColor: state.color });

  function paint() {
    const W = state.W, H = state.H;
    const tw = W - D.MARGIN * 2 - 4;
    if (page && (page.url + '|' + tw) !== laidKey) { laid = R.layout(page.blocks, tw); laidKey = page.url + '|' + tw; }
    grid = R.build({
      W, H, page, laid: page ? laid : null, scroll, nav: { back: at > 0, fwd: at < history.length - 1 },
      editing, loading, error, errorUrl, hoverHref, t: (performance.now() - t0) / 1000, color: state.color, text: state.textColor,
    });
    scroll = grid.scrollTop;
    if (history[at]) history[at].scroll = scroll;
    root.style.background = hexToRgba(state.bgColor, Math.max(state.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, grid, look());
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  // ---- loading pages ----------------------------------------------------------------------
  async function open(url, push) {
    const id = ++loadId;
    error = null; errorUrl = null; editing = null; hoverHref = null;
    if (push) {
      history.splice(at + 1);
      history.push({ url, scroll: 0 });
      at = history.length - 1;
    }
    const keepScroll = history[at] ? history[at].scroll : 0;
    if (R.BUILTIN[url]) { page = R.BUILTIN[url]; scroll = keepScroll; paint(); return; }
    if (pages.has(url)) { page = pages.get(url); scroll = keepScroll; paint(); remember(url); return; }
    loading = true;
    paint();
    try {
      const res = await native.fetch(url);
      if (id !== loadId) return;                       // something else was opened meanwhile
      const art = WT.extract.toArticle(res.html, res.url || url);
      art.url = res.url || url;
      pages.set(url, art);
      if (art.url !== url) pages.set(art.url, art);
      page = art;
      scroll = keepScroll;
      remember(url);
    } catch (e) {
      if (id !== loadId) return;
      error = String((e && e.message) || e);
      errorUrl = url;
      page = { url, title: url, blocks: [] };
    } finally {
      if (id === loadId) { loading = false; paint(); }
    }
  }
  function remember(url) {
    if (state.rememberLast && state.last !== url) { state.last = url; WT.store.save(state).catch(console.error); }
  }
  const back = () => { if (at > 0) { at--; open(history[at].url, false); } };
  const fwd = () => { if (at < history.length - 1) { at++; open(history[at].url, false); } };

  /** What you typed -> an address, or a web search if it doesn't look like one. */
  function target(typed) {
    const s = String(typed || '').trim();
    if (!s) return null;
    if (/\s/.test(s) || !/\.|^dot:/i.test(s)) return 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(s);
    return WT.store.normalizeUrl(s) || 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(s);
  }

  function act(h) {
    switch (h.action) {
      case 'link': open(h.href, true); break;
      case 'back': back(); break;
      case 'fwd': fwd(); break;
      case 'home': open(state.home, true); break;
      case 'address': editing = page && /^https?:/.test(page.url) ? page.url : ''; paint(); break;
      case 'external': {
        const u = errorUrl || (page && page.url);
        if (u && /^https?:/.test(u)) native.openExternal(u).catch(console.error);
        break;
      }
    }
  }

  function scrollBy(d) { scroll += d; paint(); }
  const pageStep = () => { const v = R.view(state.H); return Math.max(R.LINE, v.bottom - v.top - R.LINE); };

  // ---- keyboard ------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); act({ action: 'address' }); return; }
    if (editing !== null) {
      if (e.ctrlKey || e.metaKey) return;               // let paste through
      if (e.key === 'Enter') { const u = target(editing); editing = null; if (u) open(u, true); else paint(); }
      else if (e.key === 'Escape') { editing = null; paint(); }
      else if (e.key === 'Backspace') { editing = editing.slice(0, -1); paint(); }
      else if (e.key.length === 1) { if (editing.length < 2000) editing += e.key; paint(); }
      else return;
      e.preventDefault();
      return;
    }
    const steps = { ArrowDown: R.LINE, ArrowUp: -R.LINE, PageDown: pageStep(), PageUp: -pageStep(), ' ': e.shiftKey ? -pageStep() : pageStep(), Home: -1e9, End: 1e9 };
    if (steps[e.key] !== undefined) { e.preventDefault(); scrollBy(steps[e.key]); return; }
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); back(); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); fwd(); }
  });
  window.addEventListener('paste', (e) => {
    if (editing === null) return;
    editing += ((e.clipboardData && e.clipboardData.getData('text')) || '').replace(/\s+/g, ' ').trim();
    e.preventDefault();
    paint();
  });

  // ---- mouse -------------------------------------------------------------------------------------
  const toGrid = (e) => {
    const r = canvas.getBoundingClientRect(), p = state.dotSize;
    return [(e.clientX - r.left) / p, (e.clientY - r.top) / p];
  };
  let down = null;
  root.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.controls')) return;
    down = { x: e.screenX, y: e.screenY };
  });
  window.addEventListener('mousemove', (e) => {
    if (down && Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
      down = null;
      WT.store.startDragging();
      return;
    }
    const h = grid && R.hitAt(grid, ...toGrid(e));
    const href = h && h.action === 'link' ? h.href : null;
    canvas.style.cursor = h ? 'pointer' : '';
    if (href !== hoverHref) { hoverHref = href; paint(); }
  });
  window.addEventListener('mouseup', (e) => {
    if (!down || !grid) { down = null; return; }
    down = null;
    const h = R.hitAt(grid, ...toGrid(e));
    if (h) act(h);
    else if (editing !== null) { editing = null; paint(); }
  });
  // Mouse back / forward buttons.
  window.addEventListener('auxclick', (e) => { if (e.button === 3) back(); if (e.button === 4) fwd(); });
  root.addEventListener('wheel', (e) => { e.preventDefault(); scrollBy((e.deltaY > 0 ? 1 : -1) * R.LINE * 2); }, { passive: false });
  root.addEventListener('contextmenu', (e) => { e.preventDefault(); WT.store.openSettings(); });
  $('btn-settings').addEventListener('click', () => WT.store.openSettings());
  $('btn-close').addEventListener('click', () => WT.store.quit());
  $('btn-pin').addEventListener('click', async () => {
    state.alwaysOnTop = !state.alwaysOnTop;
    applyPin();
    await WT.store.save(state);
  });

  function applyPin() {
    $('btn-pin').classList.toggle('active', state.alwaysOnTop);
    $('btn-pin').title = state.alwaysOnTop ? 'Stop keeping on top' : 'Keep on top';
    WT.store.setAlwaysOnTop(state.alwaysOnTop);
  }

  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;
    state = s;
    applyPin();
    paint();
  });
  state = await WT.store.load();
  if (early) state = early;

  window.addEventListener('resize', paint);
  applyPin();
  open(state.rememberLast && state.last ? state.last : state.home, true);
  // Only animate while needed: the typing cursor, or "Loading...".
  setInterval(() => { if (!document.hidden && (editing !== null || loading)) paint(); }, 120);

  WT.widget = { getState: () => state, open };
})();
