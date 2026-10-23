/* Dot Launcher settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const Ln = WT.launcher;
  const D = WT.dots;
  const $ = (id) => document.getElementById(id);
  const ICON_LABELS = {
    app: 'App', globe: 'Globe', folder: 'Folder', doc: 'Document', mail: 'Mail', chat: 'Chat', music: 'Music', code: 'Code',
    terminal: 'Terminal', calc: 'Calculator', photo: 'Photo', video: 'Video', game: 'Game', gear: 'Settings', calendar: 'Calendar',
    note: 'Notes', cart: 'Shop', star: 'Star', heart: 'Heart', home: 'Home',
  };

  let state = null;
  let early = null;
  let saveTimer = null;
  let wtRaw = null, wtLook = null;

  function saveNow() { clearTimeout(saveTimer); saveTimer = null; WT.store.save(state).catch(console.error); }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function iconBtn(text, title, onClick, disabled) {
    const b = el('button', 'icon-btn', text);
    b.type = 'button'; b.title = title; b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }
  const setStatus = (msg, error) => { $('item-status').textContent = msg || ''; $('item-status').classList.toggle('error', !!error); };

  /** A small canvas showing an item's dot icon. */
  function iconCanvas(item) {
    const cv = el('canvas');
    const w = 11, g = { w, h: w, cidx: new Uint8Array(w * w), alpha: new Float32Array(w * w), colors: [item.color] };
    (Ln.ICON[item.icon] || Ln.ICON.app).forEach((row, j) => { for (let i = 0; i < 7; i++) if (row[i] === '1') { g.cidx[(j + 2) * w + i + 2] = 1; g.alpha[(j + 2) * w + i + 2] = 1; } });
    D.drawGrid(cv, g, { dotSize: 3, dotShape: 'round', showUnlit: true, dotColor: item.color });
    return cv;
  }

  // ---- items ---------------------------------------------------------------------------------
  function renderItems() {
    const list = $('item-list');
    const a = document.activeElement;
    const focus = a && a.closest && a.closest('.item') ? { id: a.closest('.item').dataset.id, role: a.dataset.role, pos: a.selectionStart } : null;
    list.textContent = '';
    state.items.forEach((it, i) => {
      const li = el('li', 'item');
      li.dataset.id = it.id;
      let cv = iconCanvas(it);
      const redraw = () => { const n = iconCanvas(it); li.replaceChild(n, cv); cv = n; };
      const icon = el('select'); icon.title = 'Icon'; icon.dataset.role = 'icon';
      for (const n of Ln.ICON_NAMES) { const o = el('option', '', ICON_LABELS[n] || n); o.value = n; icon.appendChild(o); }
      icon.value = it.icon;
      icon.addEventListener('change', () => { it.icon = icon.value; redraw(); saveNow(); });
      const col = el('input'); col.type = 'color'; col.value = it.color; col.title = 'Colour';
      col.addEventListener('input', () => { it.color = col.value; redraw(); saveSoon(); });
      const name = el('input', 'name'); name.type = 'text'; name.maxLength = 24; name.value = it.name; name.dataset.role = 'name';
      name.title = 'Name shown on the widget';
      name.addEventListener('input', () => { if (name.value.trim()) { it.name = name.value.trim(); saveSoon(); } });
      name.addEventListener('change', () => { name.value = it.name; });
      const target = el('span', 'target', it.target); target.title = it.target;
      li.append(cv, icon, col, name, target,
        iconBtn('▶', 'Open it now', () => WT.store.native.launch(it.id).catch((e) => setStatus('Couldn’t open ' + it.name + ': ' + e, true))),
        iconBtn('▲', 'Move up', () => move(i, -1), i === 0),
        iconBtn('▼', 'Move down', () => move(i, 1), i === state.items.length - 1),
        iconBtn('✕', 'Remove', () => { state.items.splice(i, 1); saveNow(); renderItems(); }));
      list.appendChild(li);
    });
    if (!state.items.length) list.appendChild(el('li', 'muted', 'Nothing here yet. Add an app, file, folder or website above, or drag them onto the widget.'));
    const full = state.items.length >= Ln.MAX_ITEMS;
    for (const id of ['btn-add-app', 'btn-add-file', 'btn-add-folder', 'btn-add-url']) $(id).disabled = full;
    if (focus) {
      const e = list.querySelector(`.item[data-id="${CSS.escape(focus.id)}"] [data-role="${focus.role}"]`);
      if (e) { e.focus(); try { if (focus.pos != null) e.setSelectionRange(focus.pos, focus.pos); } catch (err) { /* selects */ } }
    }
    renderNote();
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.items.length) return;
    [state.items[i], state.items[j]] = [state.items[j], state.items[i]];
    saveNow(); renderItems();
  }

  function add(target, kind) {
    if (!target) return;
    if (state.items.length >= Ln.MAX_ITEMS) { setStatus('The launcher is full (' + Ln.MAX_ITEMS + '). Remove something first.', true); return; }
    if (state.items.some((x) => x.target.toLowerCase() === String(target).trim().toLowerCase())) { setStatus('That’s already in the launcher.'); return; }
    const it = WT.store.newItem(target, { kind });
    state.items.push(it);
    setStatus('Added ' + it.name + '. Change its name, icon or colour below if you like.');
    saveNow(); renderItems();
  }
  async function pick(kind) {
    try {
      const p = await WT.store.native.pick(kind);
      if (p) add(p, kind === 'app' ? 'app' : kind);
    } catch (e) {
      setStatus('Couldn’t open the file picker: ' + e, true);
    }
  }

  // ---- style --------------------------------------------------------------------------------
  function renderNote() {
    const W = matched() ? wtLook.width : state.width;
    const per = Ln.perRow(W);
    $('style-note').textContent = state.style === 'icons'
      ? `${per} icons fit in each row at this width, so ${per * state.rows} show at once${state.items.length > per * state.rows ? ' (scroll the mouse wheel over the widget for the rest)' : ''}.`
      : `${state.listRows * 2} show at once in two columns${state.items.length > state.listRows * 2 ? ' (scroll the mouse wheel over the widget for the rest)' : ''}.`;
  }

  // ---- the rest -------------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    document.querySelector(`input[name=style][value="${state.style}"]`).checked = true;
    document.querySelector(`input[name=rows][value="${state.rows}"]`).checked = true;
    document.querySelectorAll('.for-icons').forEach((e) => { e.hidden = state.style !== 'icons'; });
    document.querySelectorAll('.for-list').forEach((e) => { e.hidden = state.style !== 'list'; });
    $('opt-list-rows').value = state.listRows;
    $('out-list-rows').textContent = state.listRows + ' rows';
    $('opt-match').checked = state.matchWorldTime;
    $('match-status').textContent = !state.matchWorldTime ? 'Using the settings below.'
      : wtLook ? `Matched to Dot Clock: ${wtLook.width} dots wide, ${wtLook.dotSize} px dots.` : 'Dot Clock isn’t installed (or hasn’t been run yet), so the settings below are used.';
    $('look-fields').disabled = matched();
    const L = matched() ? wtLook : state;
    $('opt-dot').value = L.dotColor;
    $('opt-size').value = L.dotSize;
    $('out-size').textContent = L.dotSize + ' px';
    document.querySelector(`input[name=shape][value="${L.dotShape}"]`).checked = true;
    $('opt-unlit').checked = L.showUnlit;
    $('opt-bg').value = L.bgColor;
    $('opt-opacity').value = Math.round(L.bgOpacity * 100);
    $('out-opacity').textContent = L.bgOpacity === 0 ? 'Transparent' : Math.round(L.bgOpacity * 100) + '%';
    const w = matched() ? wtLook.width : state.width;
    $('opt-width').value = w;
    $('out-width').textContent = w + ' dots';
    $('opt-top').checked = state.alwaysOnTop;
    renderNote();
  }

  function bind() {
    $('btn-add-app').addEventListener('click', () => pick('app'));
    $('btn-add-file').addEventListener('click', () => pick('file'));
    $('btn-add-folder').addEventListener('click', () => pick('folder'));
    const addUrl = () => {
      let v = $('add-url').value.trim();
      if (!v) return;
      if (!/^[a-z]+:/i.test(v)) v = 'https://' + v;
      add(v, 'web');
      $('add-url').value = '';
    };
    $('btn-add-url').addEventListener('click', addUrl);
    $('add-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
    document.querySelectorAll('input[name=style]').forEach((r) => r.addEventListener('change', () => { state.style = r.value; saveNow(); renderRest(); }));
    document.querySelectorAll('input[name=rows]').forEach((r) => r.addEventListener('change', () => { state.rows = Number(r.value); saveNow(); renderNote(); }));
    $('opt-list-rows').addEventListener('input', (e) => { state.listRows = parseInt(e.target.value, 10); $('out-list-rows').textContent = state.listRows + ' rows'; saveSoon(); renderNote(); });
    $('opt-match').addEventListener('change', (e) => { state.matchWorldTime = e.target.checked; saveNow(); renderRest(); });
    $('opt-dot').addEventListener('input', (e) => { state.dotColor = e.target.value; saveSoon(); });
    $('opt-size').addEventListener('input', (e) => { state.dotSize = parseInt(e.target.value, 10); $('out-size').textContent = state.dotSize + ' px'; saveSoon(); });
    document.querySelectorAll('input[name=shape]').forEach((r) => r.addEventListener('change', () => { state.dotShape = r.value; saveNow(); }));
    $('opt-unlit').addEventListener('change', (e) => { state.showUnlit = e.target.checked; saveNow(); });
    $('opt-bg').addEventListener('input', (e) => { state.bgColor = e.target.value; saveSoon(); });
    $('opt-opacity').addEventListener('input', (e) => {
      state.bgOpacity = parseInt(e.target.value, 10) / 100;
      $('out-opacity').textContent = state.bgOpacity === 0 ? 'Transparent' : e.target.value + '%';
      saveSoon();
    });
    $('opt-width').addEventListener('input', (e) => { state.width = parseInt(e.target.value, 10); $('out-width').textContent = state.width + ' dots'; saveSoon(); renderNote(); });
    $('opt-top').addEventListener('change', (e) => { state.alwaysOnTop = e.target.checked; saveNow(); });
    $('btn-center').addEventListener('click', () => WT.store.recenterWidget());
    $('btn-quit').addEventListener('click', () => WT.store.quit());
  }

  function renderAll() { renderItems(); renderRest(); }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
    if (state) renderRest();
  }

  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;
    state = s;
    renderAll();
  });
  state = await WT.store.load();
  if (early) state = early;
  await refreshWorldTime();
  bind();
  renderAll();
  $('about').textContent = 'Dot Launcher 1.0.0 · works fully offline';
  setInterval(refreshWorldTime, 3000);
})();
