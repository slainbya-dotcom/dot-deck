/* Dot System settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const S = WT.system;
  const $ = (id) => document.getElementById(id);
  const STYLE_INFO = {
    graph: ['A · Scrolling graph', 'Traces scroll left like an oscilloscope, live numbers on top.'],
    columns: ['B · Columns', 'A bouncing column per monitor, with peak caps.'],
    dials: ['C · Dials', 'A little gauge with a needle per monitor.'],
  };
  const NAMES = { cpu: 'Processor', mem: 'Memory', dsk: 'Disk', net: 'Network', bat: 'Battery' };

  let state = null;
  let early = null;
  let saveTimer = null;
  let wtRaw = null, wtLook = null;
  let hasBattery = true;
  const hist = S.createHistory();

  function saveNow() { clearTimeout(saveTimer); saveTimer = null; WT.store.save(state).catch(console.error); }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- right now ---------------------------------------------------------------------
  async function refreshNow() {
    try {
      const r = await WT.store.readSystem();
      S.push(hist, r);
      hasBattery = r.battery !== null && r.battery !== undefined;
      const v = hist.last.v;
      $('now-main').textContent = `CPU ${Math.round(v.cpu * 100)}% · Memory ${Math.round(v.mem * 100)}% · Disk ${Math.round(v.dsk * 100)}% full · Network ${S.valueText('net', hist)}/s`;
      $('now-meta').textContent = !hasBattery ? 'No battery found (desktop PC), so the battery monitor is hidden.'
        : `Battery ${Math.round(r.battery * 100)}% · ${r.plugged ? 'plugged in' : 'on battery'}` +
          (!r.plugged && r.battery_minutes ? ` · about ${Math.floor(r.battery_minutes / 60)}h ${r.battery_minutes % 60}m left` : '');
      renderMetrics();
    } catch (e) {
      $('now-main').textContent = 'Couldn’t read the system: ' + e;
    }
  }

  // ---- style + metrics -------------------------------------------------------------------
  function renderStyles() {
    const box = $('style-list');
    box.textContent = '';
    for (const id of S.STYLES) {
      const [title, desc] = STYLE_INFO[id];
      const l = el('label', 'style-card' + (state.style === id ? ' on' : ''));
      const r = el('input'); r.type = 'radio'; r.name = 'style'; r.checked = state.style === id;
      r.addEventListener('change', () => { state.style = id; saveNow(); renderStyles(); renderMetrics(); });
      const t = el('div');
      t.append(el('div', 'strong', title), el('div', 'muted small-text', desc));
      l.append(r, t);
      box.appendChild(l);
    }
    $('style-name').textContent = STYLE_INFO[state.style][0].slice(4);
  }

  function renderMetrics() {
    const box = $('metric-list');
    const m = state.metrics[state.style];
    box.textContent = '';
    for (const x of S.METRICS) {
      const row = el('div', 'metric' + (x.id === 'bat' && !hasBattery ? ' off' : ''));
      const l = el('label', 'check');
      const c = el('input'); c.type = 'checkbox'; c.checked = m[x.id];
      c.disabled = x.id === 'bat' && !hasBattery;
      c.addEventListener('change', () => { m[x.id] = c.checked; saveNow(); });
      l.append(c, document.createTextNode(' ' + x.label + ' · ' + NAMES[x.id] + (x.id === 'bat' && !hasBattery ? ' (none found)' : '')));
      const col = el('input'); col.type = 'color'; col.value = state.colors[x.id];
      col.disabled = state.colorMode === 'one';
      col.title = NAMES[x.id] + ' colour';
      col.addEventListener('input', () => { state.colors[x.id] = col.value; saveSoon(); });
      row.append(l, col);
      box.appendChild(row);
    }
  }

  // ---- the rest -------------------------------------------------------------------------
  function chimeSelect(value, onChange) {
    const sel = el('select');
    const none = el('option', '', 'No chime');
    none.value = 'none';
    sel.appendChild(none);
    for (const kind of ['Hi', 'Dual', 'Lo']) {
      const og = document.createElement('optgroup');
      og.label = kind + ' tones';
      WT.chimes.CHIMES.filter((c) => c.kind === kind).forEach((c) => {
        const o = el('option', '', c.name + ' (' + c.bits + '-bit)');
        o.value = c.id;
        og.appendChild(o);
      });
      sel.appendChild(og);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  const preview = (id) => { WT.chimes.unlock(); if (id && id !== 'none') WT.chimes.play(id, state.volume); };
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    document.querySelector(`input[name=cmode][value="${state.colorMode}"]`).checked = true;
    $('opt-interval').value = String(state.interval);
    $('slot-chime').textContent = '';
    $('slot-chime').appendChild(chimeSelect(state.lowChime, (v) => { state.lowChime = v; saveNow(); preview(v); }));
    $('opt-low').value = state.lowBattery;
    $('out-low').textContent = state.lowBattery + '%';
    $('opt-volume').value = Math.round(state.volume * 100);
    $('out-volume').textContent = Math.round(state.volume * 100) + '%';
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
    document.querySelectorAll('input[name=cmode]').forEach((r) => r.addEventListener('change', () => { state.colorMode = r.value; saveNow(); renderMetrics(); }));
    $('opt-interval').addEventListener('change', (e) => { state.interval = Number(e.target.value); saveNow(); });
    $('opt-low').addEventListener('input', (e) => { state.lowBattery = Number(e.target.value); $('out-low').textContent = state.lowBattery + '%'; saveSoon(); });
    $('test-chime').addEventListener('click', () => preview(state.lowChime === 'none' ? 'lowarp' : state.lowChime));
    $('opt-volume').addEventListener('input', (e) => { state.volume = parseInt(e.target.value, 10) / 100; $('out-volume').textContent = e.target.value + '%'; saveSoon(); });
    $('opt-volume').addEventListener('change', () => preview('coin'));
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

  function renderAll() { renderStyles(); renderMetrics(); renderRest(); }

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
  refreshNow();
  $('about').textContent = 'Dot System 1.1.0 · works fully offline';
  setInterval(() => { if (!document.hidden) refreshNow(); }, 2000);
  setInterval(refreshWorldTime, 3000);
})();
