/* Dot Visualiser settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const V = WT.viz;
  const media = WT.store.media;
  const $ = (id) => document.getElementById(id);
  const isMac = /Mac/i.test(navigator.userAgent);
  const STYLE_INFO = {
    bars: ['A · Spectrum columns', 'Low notes left, high right; peak caps fall back slowly.'],
    mirror: ['B · Mirror', 'Spreads out from the middle, lows in the centre.'],
    scope: ['C · Oscilloscope', 'The sound wave itself.'],
    vu: ['D · VU meters', 'Left and right loudness, like a stereo.'],
    falls: ['E · Waterfall', 'The spectrum scrolling down, newest at the top.'],
  };

  let state = null;
  let early = null;
  let saveTimer = null;
  let wtRaw = null, wtLook = null;

  function saveNow() { clearTimeout(saveTimer); saveTimer = null; WT.store.save(state).catch(console.error); }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- style --------------------------------------------------------------------------------
  function renderStyles() {
    const box = $('style-list');
    box.textContent = '';
    for (const id of V.STYLES) {
      const [title, desc] = STYLE_INFO[id];
      const card = el('div', 'style-card' + (state.style === id ? ' on' : ''));
      const pick = el('label', 'pick');
      const r = el('input'); r.type = 'radio'; r.name = 'style'; r.checked = state.style === id;
      r.addEventListener('change', () => { state.style = id; saveNow(); renderStyles(); });
      const t = el('div');
      t.append(el('div', 'strong', title), el('div', 'muted small-text', desc));
      pick.append(r, t);
      const tr = el('label', 'check track');
      const c = el('input'); c.type = 'checkbox'; c.checked = state.track[id];
      c.addEventListener('change', () => { state.track[id] = c.checked; saveNow(); });
      tr.append(c, document.createTextNode(' Show what’s playing'));
      card.append(pick, tr);
      box.appendChild(card);
    }
  }

  // ---- sound source -----------------------------------------------------------------------
  let sourcesKey = '';
  async function renderSources() {
    let list = [];
    try { list = await media.sources(); } catch (e) { list = ['system']; }
    if (!list.includes(state.source)) list.push(state.source);     // keep a device that's unplugged right now
    const key = JSON.stringify([list, state.source]);
    const sel = $('opt-source');
    if (key === sourcesKey || sel.matches(':focus')) return;
    sourcesKey = key;
    sel.textContent = '';
    for (const s of list) {
      const o = el('option', '', s === 'system' ? (isMac ? 'Default input' : 'What you hear (system audio)') : s);
      o.value = s;
      sel.appendChild(o);
    }
    sel.value = state.source;
  }
  async function renderStatus() {
    try {
      const f = await media.frame();
      $('sound-status').textContent = f.error ? 'Couldn’t listen: ' + f.error
        : (f.device ? 'Listening to ' + f.device + '. ' : '') + (f.active ? 'Sound is coming through.' : 'Nothing coming through right now.');
    } catch (e) {
      $('sound-status').textContent = '';
    }
  }

  // ---- the rest -------------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    $('opt-sens').value = Math.round(state.sensitivity * 100);
    $('out-sens').textContent = Math.round(state.sensitivity * 100) + '%';
    $('opt-player').value = state.playerSource;
    document.querySelector(`input[name=cmode][value="${state.colorMode}"]`).checked = true;
    $('opt-peaks').checked = state.peaks;
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
    $('opt-source').addEventListener('change', (e) => { state.source = e.target.value; saveNow(); setTimeout(renderStatus, 800); });
    $('opt-sens').addEventListener('input', (e) => { state.sensitivity = parseInt(e.target.value, 10) / 100; $('out-sens').textContent = e.target.value + '%'; saveSoon(); });
    $('opt-player').addEventListener('change', (e) => { state.playerSource = e.target.value; saveNow(); });
    document.querySelectorAll('input[name=cmode]').forEach((r) => r.addEventListener('change', () => { state.colorMode = r.value; saveNow(); }));
    $('opt-peaks').addEventListener('change', (e) => { state.peaks = e.target.checked; saveNow(); });
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

  function renderAll() { renderStyles(); renderRest(); renderSources(); }

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
  renderStatus();
  $('about').textContent = 'Dot Visualiser 1.0.0 · works offline, nothing is recorded';
  setInterval(() => { if (!document.hidden) { renderSources(); renderStatus(); } }, 3000);
  setInterval(refreshWorldTime, 3000);
})();
