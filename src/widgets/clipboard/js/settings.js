/* Dot Clipboard settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const C = WT.clip;
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
  function iconBtn(text, title, onClick, cls) {
    const b = el('button', 'icon-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button'; b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
  const setStatus = (msg) => { $('clip-status').textContent = msg || ''; };

  function ago(t) {
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    return h < 24 ? h + ' h ago' : Math.floor(h / 24) + ' d ago';
  }

  // ---- history -------------------------------------------------------------------------------
  function renderClips() {
    const list = $('clip-list');
    list.textContent = '';
    for (const c of C.ordered(state.clips)) {
      const li = el('li', 'clip' + (c.pinned ? ' pinned' : ''));
      const text = el('span', 'text', C.flat(c.text)); text.title = c.text;
      li.append(
        iconBtn('📌', c.pinned ? 'Unpin' : 'Pin (always kept, shown first)', () => { c.pinned = !c.pinned; saveNow(); renderClips(); }, c.pinned ? 'pinbtn on' : 'pinbtn'),
        text,
        el('span', 'age', c.pinned ? 'pinned' : ago(c.at)),
        iconBtn('⧉', 'Copy it again', () => WT.store.native.copy(c.text).then(() => setStatus('Copied.'))),
        iconBtn('✕', 'Remove', () => { state.clips = state.clips.filter((x) => x !== c); saveNow(); renderClips(); }));
      list.appendChild(li);
    }
    if (!state.clips.length) list.appendChild(el('li', 'muted', state.paused ? 'Paused, so nothing is being recorded.' : 'Nothing yet. Copy some text in any app and it appears here and on the widget.'));
    $('btn-clear').disabled = !state.clips.some((c) => !c.pinned);
    $('btn-clear-all').disabled = !state.clips.length;
  }

  // ---- the rest -------------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    $('opt-paused').checked = state.paused;
    document.querySelector(`input[name=style][value="${state.style}"]`).checked = true;
    document.querySelectorAll('.for-history').forEach((e) => { e.hidden = state.style !== 'history'; });
    $('opt-rows').value = state.rows;
    $('out-rows').textContent = state.rows;
    $('opt-max').value = state.max;
    $('out-max').textContent = 'the last ' + state.max;
    $('opt-remember').checked = state.remember;
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
    $('opt-paused').addEventListener('change', (e) => { state.paused = e.target.checked; saveNow(); renderClips(); });
    $('btn-clear').addEventListener('click', () => {
      const n = state.clips.filter((c) => !c.pinned).length;
      state.clips = state.clips.filter((c) => c.pinned);
      setStatus('Cleared ' + n + (n === 1 ? ' clip.' : ' clips.'));
      saveNow(); renderClips();
    });
    $('btn-clear-all').addEventListener('click', () => { state.clips = []; setStatus('Everything cleared.'); saveNow(); renderClips(); });
    document.querySelectorAll('input[name=style]').forEach((r) => r.addEventListener('change', () => { state.style = r.value; saveNow(); renderRest(); }));
    $('opt-rows').addEventListener('input', (e) => { state.rows = parseInt(e.target.value, 10); $('out-rows').textContent = state.rows; saveSoon(); });
    $('opt-max').addEventListener('input', (e) => {
      state.max = parseInt(e.target.value, 10);
      $('out-max').textContent = 'the last ' + state.max;
      // Trim straight away (oldest unpinned first).
      let n = 0;
      const keep = new Set(C.ordered(state.clips).filter((c) => c.pinned || ++n <= state.max));
      state.clips = state.clips.filter((c) => keep.has(c));
      saveSoon(); renderClips();
    });
    $('opt-remember').addEventListener('change', (e) => { state.remember = e.target.checked; saveNow(); });
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

  function renderAll() { renderClips(); renderRest(); }

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
  $('about').textContent = 'Dot Clipboard 1.0.0 · works fully offline';
  setInterval(() => { if (!document.hidden) renderClips(); }, 30 * 1000);
  setInterval(refreshWorldTime, 3000);
})();
