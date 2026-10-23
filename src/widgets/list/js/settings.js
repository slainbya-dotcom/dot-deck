/* Dot List settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const Ls = WT.list;
  const $ = (id) => document.getElementById(id);

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
  const setStatus = (msg, error) => { $('task-status').textContent = msg || ''; $('task-status').classList.toggle('error', !!error); };

  // ---- tasks ---------------------------------------------------------------------------------
  function renderTasks() {
    const list = $('task-list');
    const a = document.activeElement;
    const focus = a && a.closest && a.closest('.task') ? { id: a.closest('.task').dataset.id, pos: a.selectionStart } : null;
    list.textContent = '';
    state.tasks.forEach((x, i) => {
      const li = el('li', 'task' + (x.done ? ' done' : ''));
      li.dataset.id = x.id;
      const c = el('input'); c.type = 'checkbox'; c.checked = x.done; c.title = x.done ? 'Mark as not done' : 'Tick off';
      c.addEventListener('change', () => { x.done = c.checked; x.doneAt = x.done ? Date.now() : 0; saveNow(); renderTasks(); });
      const t = el('input'); t.type = 'text'; t.maxLength = Ls.MAX_TEXT; t.value = x.text; t.dataset.role = 'text';
      t.addEventListener('input', () => { const v = WT.store.clean(t.value); if (v) { x.text = v; saveSoon(); } });
      t.addEventListener('change', () => { t.value = x.text; });
      li.append(c, t,
        iconBtn('▲', 'Move up', () => move(i, -1), i === 0),
        iconBtn('▼', 'Move down', () => move(i, 1), i === state.tasks.length - 1),
        iconBtn('✕', 'Remove', () => { state.tasks.splice(i, 1); saveNow(); renderTasks(); }));
      list.appendChild(li);
    });
    if (!state.tasks.length) list.appendChild(el('li', 'muted', 'Nothing to do. Add a task above.'));
    $('btn-clear').disabled = !state.tasks.some((x) => x.done);
    $('btn-add').disabled = state.tasks.length >= Ls.MAX_TASKS;
    if (focus) {
      const e = list.querySelector(`.task[data-id="${CSS.escape(focus.id)}"] [data-role="text"]`);
      if (e) { e.focus(); try { e.setSelectionRange(focus.pos, focus.pos); } catch (err) { /* ignore */ } }
    }
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.tasks.length) return;
    [state.tasks[i], state.tasks[j]] = [state.tasks[j], state.tasks[i]];
    saveNow(); renderTasks();
  }

  function add() {
    const input = $('add-text');
    if (!WT.store.clean(input.value)) return;
    if (!WT.store.addTask(state, input.value)) { setStatus('The list is full (' + Ls.MAX_TASKS + ' tasks). Clear some done ones first.', true); return; }
    input.value = '';
    setStatus('');
    saveNow(); renderTasks();
  }

  // ---- the rest -------------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    $('opt-rows').value = state.rows;
    $('out-rows').textContent = state.rows;
    document.querySelector(`input[name=done][value="${state.doneMode}"]`).checked = true;
    document.querySelector(`input[name=addat][value="${state.addAt}"]`).checked = true;
    $('opt-overnight').checked = state.clearOvernight;
    $('opt-done-color').value = state.doneColor;
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
  }

  function bind() {
    $('btn-add').addEventListener('click', add);
    $('add-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    $('btn-clear').addEventListener('click', () => {
      const n = state.tasks.filter((x) => x.done).length;
      state.tasks = state.tasks.filter((x) => !x.done);
      setStatus('Cleared ' + n + ' done ' + (n === 1 ? 'task' : 'tasks') + '.');
      saveNow(); renderTasks();
    });
    $('opt-rows').addEventListener('input', (e) => { state.rows = parseInt(e.target.value, 10); $('out-rows').textContent = state.rows; saveSoon(); });
    document.querySelectorAll('input[name=done]').forEach((r) => r.addEventListener('change', () => { state.doneMode = r.value; saveNow(); }));
    document.querySelectorAll('input[name=addat]').forEach((r) => r.addEventListener('change', () => { state.addAt = r.value; saveNow(); }));
    $('opt-overnight').addEventListener('change', (e) => { state.clearOvernight = e.target.checked; saveNow(); });
    $('opt-done-color').addEventListener('input', (e) => { state.doneColor = e.target.value; saveSoon(); });
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
    $('opt-width').addEventListener('input', (e) => { state.width = parseInt(e.target.value, 10); $('out-width').textContent = state.width + ' dots'; saveSoon(); });
    $('opt-top').addEventListener('change', (e) => { state.alwaysOnTop = e.target.checked; saveNow(); });
    $('btn-center').addEventListener('click', () => WT.store.recenterWidget());
    $('btn-quit').addEventListener('click', () => WT.store.quit());
  }

  function renderAll() { renderTasks(); renderRest(); }

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
  $('about').textContent = 'Dot List 1.0.0 · works fully offline';
  setInterval(refreshWorldTime, 3000);
})();
