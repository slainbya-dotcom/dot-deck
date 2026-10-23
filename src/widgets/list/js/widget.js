/* The floating dot-matrix to-do list (main window). */
(async function () {
  'use strict';
  const WT = window.WT;
  const D = WT.dots;
  const Ls = WT.list;
  const $ = (id) => document.getElementById(id);
  const root = $('widget');
  const canvas = $('matrix');

  let state = null;
  let early = null;
  let wtRaw = null;
  let wtLook = null;
  let lastSize = '';
  let grid = null;
  let hover = null;        // task id under the mouse
  let hoverSince = 0;
  let scroll = 0;
  let editing = null;      // { text } while typing a new task
  const t0 = performance.now();

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function look() {
    const m = state.matchWorldTime && wtLook;
    const src = m ? wtLook : state;
    return {
      matched: !!m,
      width: m ? wtLook.width : state.width,
      dotSize: src.dotSize, dotShape: src.dotShape, showUnlit: src.showUnlit,
      dotColor: src.dotColor, bgColor: src.bgColor, bgOpacity: src.bgOpacity,
    };
  }

  function paint() {
    const L = look();
    const now = performance.now();
    // A long task under the mouse scrolls from its start each time you hover.
    grid = Ls.build({
      W: L.width, state, now: Date.now(), t: (now - t0) / 1000, hover, scroll, editing,
      color: L.dotColor, doneColor: state.doneColor, hoverScroll: Math.max(0, (now - hoverSince) / 1000 - 0.6),
    });
    scroll = grid.scrollTop;
    root.style.background = hexToRgba(L.bgColor, Math.max(L.bgOpacity, 0.02));
    const size = D.drawGrid(canvas, grid, L);
    const k = size.width + 'x' + size.height;
    if (k !== lastSize) {
      lastSize = k;
      WT.store.resizeWindow(size.width, size.height);
    }
  }

  // ---- actions ----------------------------------------------------------------------------
  async function act(h) {
    if (h.action === 'tick') {
      const x = state.tasks.find((k) => k.id === h.id);
      if (!x) return;
      x.done = !x.done;
      x.doneAt = x.done ? Date.now() : 0;
      await WT.store.save(state);
      // Paint again when it settles, so it sinks (or hides) on time.
      setTimeout(paint, Ls.SETTLE + 50);
    } else if (h.action === 'del') {
      state.tasks = state.tasks.filter((k) => k.id !== h.id);
      hover = null;
      await WT.store.save(state);
    } else if (h.action === 'add') {
      startEditing();
    }
    paint();
  }

  function startEditing() {
    if (state.tasks.length >= Ls.MAX_TASKS) return;
    editing = editing || { text: '' };
    window.focus();
    paint();
  }
  async function finishEditing(save) {
    if (!editing) return;
    const text = editing.text;
    editing = null;
    if (save && WT.store.addTask(state, text)) {
      scroll = state.addAt === 'top' ? 0 : 1e9;
      await WT.store.save(state);
    }
    paint();
  }

  // Typing goes straight onto the widget while adding a task.
  window.addEventListener('keydown', (e) => {
    if (!editing) return;
    if (e.ctrlKey || e.metaKey) return;               // let paste (Ctrl/Cmd+V) through
    if (e.key === 'Enter') finishEditing(true);
    else if (e.key === 'Escape') finishEditing(false);
    else if (e.key === 'Backspace') editing.text = editing.text.slice(0, -1);
    else if (e.key.length === 1) { if (editing.text.length < Ls.MAX_TEXT) editing.text += e.key; }
    else return;
    e.preventDefault();
    paint();
  });
  window.addEventListener('paste', (e) => {
    if (!editing) return;
    const s = (e.clipboardData && e.clipboardData.getData('text')) || '';
    editing.text = WT.store.clean(editing.text + ' ' + s).slice(0, Ls.MAX_TEXT);
    if (!editing.text) editing.text = '';
    e.preventDefault();
    paint();
  });
  // Clicking away from the widget saves what you typed (if anything).
  window.addEventListener('blur', () => { if (editing) finishEditing(!!editing.text.trim()); });

  // ---- interaction -------------------------------------------------------------
  const toGrid = (e) => {
    const r = canvas.getBoundingClientRect(), p = look().dotSize;
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
    const h = grid && Ls.hitAt(grid, ...toGrid(e));
    const id = h && (h.action === 'tick' || h.action === 'del') ? h.id : null;
    if (id !== hover) { hover = id; hoverSince = performance.now(); paint(); }
  });
  root.addEventListener('mouseleave', () => { if (hover) { hover = null; paint(); } });
  window.addEventListener('mouseup', (e) => {
    if (!down || !grid) { down = null; return; }
    down = null;
    const h = Ls.hitAt(grid, ...toGrid(e));
    if (h) act(h);
    else if (editing) finishEditing(!!editing.text.trim());
  });
  root.addEventListener('wheel', (e) => {
    if (!grid || grid.maxScroll <= 0) return;
    e.preventDefault();
    scroll = Math.max(0, Math.min(grid.maxScroll, scroll + (e.deltaY > 0 ? 1 : -1)));
    paint();
  }, { passive: false });
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

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw && wtLook && Date.now() % 60000 > 3000) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
  }

  /** "Clear done tasks overnight": drop anything ticked before today. */
  async function overnight() {
    if (!state.clearOvernight) return;
    const kept = Ls.clearOvernight(state.tasks, Date.now());
    if (kept.length !== state.tasks.length) {
      state.tasks = kept;
      await WT.store.save(state);
      paint();
    }
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
  WT.store.onAddTask(startEditing);

  await refreshWorldTime();
  setInterval(refreshWorldTime, 3000);
  window.addEventListener('resize', paint);

  applyPin();
  await overnight();
  setInterval(overnight, 60 * 1000);
  paint();
  // Only animate while it's needed: the typing cursor, or a long task scrolling under the mouse.
  setInterval(() => { if (!document.hidden && (editing || hover)) paint(); }, 80);
  setInterval(paint, 30 * 1000);   // so settled ticks and the date stay current

  WT.widget = { getState: () => state, look };
})();
