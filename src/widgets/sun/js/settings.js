/* Dot Sun settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const $ = (id) => document.getElementById(id);
  const PANELS = {
    arc: { title: 'Sky arc', desc: 'The sun’s path from sunrise to sunset with its current position, day length and a large moon.' },
    rows: { title: 'Rows', desc: 'Sunrise / sunset with a daylight bar, then the lines you tick below.' },
    compact: { title: 'Compact line', desc: 'Sunrise, sunset and the moon on one line — the height of a Dot Clock row.' },
  };
  const ROWS = [['bar', 'Sunrise / sunset + daylight bar'], ['golden', 'Golden hour'], ['length', 'Day length'], ['moon', 'Moon phase']];

  let state = null;
  let early = null;
  let saveTimer = null;
  let wtRaw = null, wtLook = null, wtHome = null;

  function saveNow() { clearTimeout(saveTimer); saveTimer = null; WT.store.save(state).catch(console.error); }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 200); }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function place() {
    if (state.useWorldTimeHome && wtHome) return wtHome;
    if (state.place) return state.place;
    const c = WT.geo.cityForZone(WT.time.systemZone());
    return c ? { label: WT.geo.cityLabel(c), tz: c.tz, lat: c.lat, lng: c.lng } : { label: 'London, UK', tz: 'Europe/London', lat: 51.51, lng: -0.13 };
  }

  // ---- today ----------------------------------------------------------------------
  function renderToday() {
    const p = place(), now = Date.now();
    const s = WT.sun.sunTimes(p, now), m = WT.sun.moon(now);
    const f = (t) => (t ? WT.time.formatTime(p.tz, new Date(t), state.use24h, false) : '—');
    $('today-place').textContent = p.label;
    const sun = s.polar === 'day' ? 'Midnight sun (no sunset today)' : s.polar === 'night' ? 'Polar night (no sunrise today)'
      : `Sunrise ${f(s.sunrise)} · sunset ${f(s.sunset)} · day ${WT.sun.formatLength(s.dayLength).toLowerCase()}`;
    const golden = s.goldenEveningStart ? ` · evening golden hour from ${f(s.goldenEveningStart)}` : '';
    const full = new Date(WT.sun.nextFullMoon(now)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    $('today-facts').textContent = `${sun}${golden}. Moon: ${m.name.toLowerCase()}, ${Math.round(m.illumination * 100)}% lit, next full moon ${full}.`;
  }

  // ---- panels -----------------------------------------------------------------------
  function renderPanels() {
    const list = $('panel-list');
    list.textContent = '';
    state.panels.forEach((p, i) => {
      const info = PANELS[p.id];
      const li = el('li', 'timer' + (p.enabled ? '' : ' off'));
      const head = el('div', 'head');
      const on = el('input');
      on.type = 'checkbox';
      on.checked = p.enabled;
      on.addEventListener('change', () => { p.enabled = on.checked; saveNow(); renderPanels(); });
      const title = el('label', 'ptitle-strong', info.title);
      title.prepend(on);
      const up = el('button', 'icon-btn', '▲'); up.type = 'button'; up.title = 'Move up'; up.disabled = i === 0;
      up.addEventListener('click', () => move(i, -1));
      const dn = el('button', 'icon-btn', '▼'); dn.type = 'button'; dn.title = 'Move down'; dn.disabled = i === state.panels.length - 1;
      dn.addEventListener('click', () => move(i, 1));
      const spacer = el('span');
      spacer.style.flex = '1';
      head.append(title, spacer, up, dn);
      li.append(head, el('div', 'summary', info.desc));
      if (p.id === 'rows') {
        const line = el('div', 'line');
        for (const [k, text] of ROWS) {
          const l = el('label', 'check');
          const c = el('input');
          c.type = 'checkbox';
          c.checked = state.rows[k];
          c.disabled = !p.enabled;
          c.addEventListener('change', () => { state.rows[k] = c.checked; saveNow(); });
          l.append(c, document.createTextNode(' ' + text));
          line.appendChild(l);
        }
        li.appendChild(line);
      }
      list.appendChild(li);
    });
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.panels.length) return;
    [state.panels[i], state.panels[j]] = [state.panels[j], state.panels[i]];
    saveNow();
    renderPanels();
  }

  // ---- location search ----------------------------------------------------------------
  function attachSearch(input, list, onChoose) {
    let items = [], active = -1;
    const hide = () => { list.hidden = true; active = -1; };
    function draw() {
      list.textContent = '';
      const q = input.value.trim();
      if (!q) { hide(); return; }
      items = WT.geo.search(q, 8);
      if (!items.length) list.appendChild(el('li', 'empty', 'No match. Try the nearest bigger city.'));
      items.forEach((c, i) => {
        const li = el('li', i === active ? 'active' : '');
        li.append(el('span', '', WT.geo.cityDetail(c)), el('span', 'meta', WT.time.abbreviation(c.tz, new Date())));
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
        list.appendChild(li);
      });
      list.hidden = false;
    }
    function choose(i) { const c = items[i]; if (!c) return; input.value = ''; hide(); onChoose(c); }
    input.addEventListener('input', () => { active = -1; draw(); });
    input.addEventListener('blur', () => setTimeout(hide, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active >= 0 ? active : 0); }
      else if (e.key === 'Escape') hide();
    });
  }

  // ---- everything else -------------------------------------------------------------------
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
    $('opt-wthome').checked = state.useWorldTimeHome;
    $('wthome-status').textContent = !state.useWorldTimeHome ? (state.place ? 'Using ' + state.place.label + '.' : 'Using your computer’s time zone.')
      : wtHome ? 'Using ' + wtHome.label + ' from Dot Clock.' : 'Dot Clock’s home city isn’t available, so ' + (state.place ? state.place.label : 'your computer’s time zone') + ' is used.';
    document.querySelector(`input[name=fmt][value="${state.use24h ? 24 : 12}"]`).checked = true;
    document.querySelector(`input[name=cmode][value="${state.colorMode}"]`).checked = true;
    for (const k of ['sun', 'moon', 'sky']) { $('col-' + k).value = state.colors[k]; $('col-' + k).disabled = state.colorMode === 'one'; }
    for (const k of ['sunrise', 'golden', 'sunset']) {
      $('slot-' + k).textContent = '';
      $('slot-' + k).appendChild(chimeSelect(state.chimes[k], (v) => { state.chimes[k] = v; saveNow(); preview(v); }));
    }
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
    $('opt-wthome').addEventListener('change', (e) => { state.useWorldTimeHome = e.target.checked; saveNow(); renderAll(); });
    attachSearch($('place-search'), $('place-results'), (c) => {
      state.place = { label: WT.geo.cityLabel(c), tz: c.tz, lat: c.lat, lng: c.lng };
      state.useWorldTimeHome = false;
      saveNow();
      renderAll();
    });
    document.querySelectorAll('input[name=fmt]').forEach((r) => r.addEventListener('change', () => { state.use24h = r.value === '24'; saveNow(); renderToday(); }));
    document.querySelectorAll('input[name=cmode]').forEach((r) => r.addEventListener('change', () => { state.colorMode = r.value; saveNow(); renderRest(); }));
    for (const k of ['sun', 'moon', 'sky']) $('col-' + k).addEventListener('input', (e) => { state.colors[k] = e.target.value; saveSoon(); });
    for (const k of ['sunrise', 'golden', 'sunset']) $('test-' + k).addEventListener('click', () => preview(state.chimes[k] === 'none' ? 'coin' : state.chimes[k]));
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

  function renderAll() { renderToday(); renderPanels(); renderRest(); }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
    wtHome = raw ? WT.worldTime.homeFrom(raw) : null;
    if (state) { renderToday(); renderRest(); }
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
  $('about').textContent = 'Dot Sun 1.1.0 · ' + WT.geo.cities().length + ' cities · works fully offline';
  setInterval(() => { if (!document.hidden) renderToday(); }, 30000);
  setInterval(refreshWorldTime, 3000);
})();
