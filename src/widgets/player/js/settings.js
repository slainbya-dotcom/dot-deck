/* Dot Player settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const P = WT.player;
  const media = WT.store.media;
  const $ = (id) => document.getElementById(id);
  const isMac = /Mac/i.test(navigator.userAgent);

  let state = null;
  let early = null;
  let saveTimer = null;
  let wtRaw = null, wtLook = null;
  let audio = null;

  function saveNow() { clearTimeout(saveTimer); saveTimer = null; WT.store.save(state).catch(console.error); }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- right now -------------------------------------------------------------------------
  async function refreshNow() {
    try {
      const np = await media.readPlayer(state.source);
      $('now-main').textContent = np && np.available ? `${np.title}${np.artist ? ' — ' + np.artist : ''}` : 'Nothing playing';
      $('now-meta').textContent = np && np.available
        ? `${np.playing ? 'Playing' : 'Paused'}${np.source ? ' in ' + np.source : ''}` + (np.duration > 0 ? ` · ${P.fmt(np.position)} of ${P.fmt(np.duration)}` : '')
        : isMac ? 'Start something in Spotify or Apple Music.' : 'Start something in Spotify, a browser or any media app.';
    } catch (e) {
      $('now-main').textContent = 'Couldn’t read what’s playing: ' + e;
    }
    try {
      audio = await media.readAudio();
      renderDevices();
    } catch (e) {
      $('dev-status').textContent = 'Couldn’t read the sound devices: ' + e;
    }
  }

  // ---- views -------------------------------------------------------------------------------
  function colourInput(id, title) {
    const col = el('input'); col.type = 'color'; col.value = state.colors[id];
    col.disabled = state.colorMode === 'one';
    col.title = title + ' colour';
    col.addEventListener('input', () => { state.colors[id] = col.value; saveSoon(); });
    return col;
  }

  function renderViews() {
    const box = $('view-list');
    box.textContent = '';
    for (const v of P.VIEWS) {
      const card = el('div', 'view' + (state.views[v.id] ? '' : ' off'));
      const head = el('label', 'head check');
      const c = el('input'); c.type = 'checkbox'; c.checked = state.views[v.id];
      c.addEventListener('change', () => { state.views[v.id] = c.checked; saveNow(); renderViews(); });
      head.append(c, document.createTextNode(' ' + v.name));
      card.appendChild(head);
      const list = el('div', 'metric-list');
      if (v.id === 'player') {
        const row = el('div', 'metric');
        row.append(el('span', '', 'Track & artist (always shown)'), colourInput('track', 'Track'));
        list.appendChild(row);
      }
      for (const r of P.ROWS.filter((r) => r.view === v.id)) {
        const row = el('div', 'metric');
        const l = el('label', 'check');
        const k = el('input'); k.type = 'checkbox'; k.checked = state.rows[r.id]; k.disabled = !state.views[v.id];
        k.addEventListener('change', () => { state.rows[r.id] = k.checked; saveNow(); });
        l.append(k, document.createTextNode(' ' + r.name));
        row.append(l, colourInput(r.id, r.name));
        list.appendChild(row);
      }
      card.appendChild(list);
      box.appendChild(card);
    }
  }

  // ---- devices -------------------------------------------------------------------------------
  function fillSelect(sel, list, cur) {
    if (sel.matches(':focus')) return;              // don't yank it while the user is choosing
    const key = JSON.stringify([list, cur]);
    if (sel.dataset.key === key) return;
    sel.dataset.key = key;
    sel.textContent = '';
    if (!list.length) { const o = el('option', '', 'No devices found'); o.value = ''; sel.appendChild(o); sel.disabled = true; return; }
    sel.disabled = false;
    for (const d of list) { const o = el('option', '', d.name); o.value = d.id; sel.appendChild(o); }
    sel.value = cur;
  }
  function renderDevices() {
    if (!audio) return;
    fillSelect($('opt-output'), audio.outputs || [], audio.output);
    fillSelect($('opt-input'), audio.inputs || [], audio.input);
  }
  async function pickDevice(kind, id) {
    if (!id) return;
    $('dev-status').textContent = '';
    $('dev-status').classList.remove('error');
    try {
      await media.setDevice(kind, id);
    } catch (e) {
      $('dev-status').textContent = 'Couldn’t switch: ' + e;
      $('dev-status').classList.add('error');
    }
    setTimeout(refreshNow, 300);
  }

  // ---- the rest -------------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    document.querySelector(`input[name=layout][value="${state.layout}"]`).checked = true;
    document.querySelector(`input[name=tmode][value="${state.timeMode}"]`).checked = true;
    document.querySelector(`input[name=cmode][value="${state.colorMode}"]`).checked = true;
    $('opt-speed').value = String(state.speed);
    $('opt-source').value = state.source;
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
    document.querySelectorAll('input[name=layout]').forEach((r) => r.addEventListener('change', () => { state.layout = r.value; saveNow(); }));
    document.querySelectorAll('input[name=tmode]').forEach((r) => r.addEventListener('change', () => { state.timeMode = r.value; saveNow(); }));
    document.querySelectorAll('input[name=cmode]').forEach((r) => r.addEventListener('change', () => { state.colorMode = r.value; saveNow(); renderViews(); }));
    $('opt-speed').addEventListener('change', (e) => { state.speed = Number(e.target.value); saveNow(); });
    $('opt-source').addEventListener('change', (e) => { state.source = e.target.value; saveNow(); refreshNow(); });
    $('opt-output').addEventListener('change', (e) => pickDevice('output', e.target.value));
    $('opt-input').addEventListener('change', (e) => pickDevice('input', e.target.value));
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

  function renderAll() { renderViews(); renderRest(); renderDevices(); }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
    if (state) renderRest();
  }

  if (isMac) {
    $('mac-note').hidden = false;
    document.querySelectorAll('.mac-only').forEach((e) => { e.hidden = false; });
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
  refreshNow();
  $('about').textContent = 'Dot Player 1.0.0 · works offline, nothing leaves your computer';
  setInterval(() => { if (!document.hidden) refreshNow(); }, 2000);
  setInterval(refreshWorldTime, 3000);
})();
