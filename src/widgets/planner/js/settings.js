/* Dot Planner settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const P = WT.planner;
  const $ = (id) => document.getElementById(id);
  const PANELS = {
    blocks: { title: 'Hour blocks', desc: 'Bright = working, dim = awake, dark = asleep. A bar on top lights when everyone’s working; a line marks now.' },
    numbers: { title: 'Local hours', desc: 'Each city’s own clock hour for the coming hours: highlighted = working, dim = awake, faint = asleep.' },
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
  function iconBtn(text, title, onClick, disabled) {
    const b = el('button', 'icon-btn', text);
    b.type = 'button'; b.title = title; b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }
  const defaultColor = () => (state.matchWorldTime && wtLook ? wtLook.dotColor : state.dotColor);
  const fmtTime = (tz, t) => WT.time.formatTime(tz, new Date(t), state.use24h, false);

  function hourSelect(value, onChange) {
    const s = el('select', 'hour');
    for (let h = 0; h <= 24; h++) {
      const o = el('option', '', h === 24 ? (state.use24h ? '24:00' : 'midnight') : (state.use24h ? String(h).padStart(2, '0') + ':00' : (h % 12 || 12) + (h < 12 ? ' am' : ' pm')));
      o.value = h;
      s.appendChild(o);
    }
    s.value = value;
    s.addEventListener('change', () => onChange(Number(s.value)));
    return s;
  }

  // ---- next overlap card ------------------------------------------------------------
  function renderOverlap() {
    const now = Date.now(), c = state.cities;
    if (c.length < 2) {
      $('overlap-main').textContent = c.length ? 'Add another city to find a shared window.' : 'Add some cities to get started.';
      $('overlap-meta').textContent = '';
      return;
    }
    const w = P.nextOverlap(c, now, 7 * 24);
    const home = c[0];
    if (!w) {
      // Best partial overlap in the next 24 hours, in 30-minute steps.
      let best = null;
      for (let t = now - (now % 1800000); t < now + 24 * 3600000; t += 1800000) {
        const n = c.filter((x) => P.status(x, t + 900000) === 2).length;
        if (!best || n > best.n) best = { n, t, end: t + 1800000 };
        else if (n === best.n && t === best.end) best.end = t + 1800000;
      }
      $('overlap-main').textContent = 'No time in the next week when all ' + c.length + ' are working.';
      $('overlap-meta').textContent = best && best.n > 1
        ? `Best in the next day: ${fmtTime(home.tz, best.t)}–${fmtTime(home.tz, best.end)} ${home.label} time, ${best.n} of ${c.length} working (` +
          c.filter((x) => P.status(x, best.t + 900000) === 2).map((x) => x.label).join(', ') + ').'
        : 'Try widening someone’s working hours, or allow weekend work.';
      return;
    }
    const startsNow = w.start <= now + 60000;
    const day = new Date(w.start).toLocaleDateString(undefined, { weekday: 'long' });
    $('overlap-main').textContent = (startsNow ? 'Now' : day) + ' · ' + fmtTime(home.tz, w.start) + '–' + fmtTime(home.tz, w.end) + ' ' + home.label + ' time';
    $('overlap-meta').textContent = c.map((x) => x.label + ' ' + fmtTime(x.tz, w.start)).join(' · ');
  }

  // ---- cities --------------------------------------------------------------------
  function renderCities() {
    const list = $('city-list');
    const active = document.activeElement;
    const focusId = active && active.closest && active.closest('.timer') ? active.closest('.timer').dataset.id : null;
    const focusRole = active && active.dataset ? active.dataset.role : null;
    list.textContent = '';
    const now = Date.now();
    state.cities.forEach((c, i) => {
      const li = el('li', 'timer');
      li.dataset.id = c.id;
      const head = el('div', 'head');

      const sw = el('div', 'swatch');
      const color = el('input');
      color.type = 'color'; color.value = c.color || defaultColor(); color.dataset.role = 'color';
      const auto = el('span', 'auto', 'auto');
      auto.hidden = !!c.color;
      color.addEventListener('input', () => { c.color = color.value; auto.hidden = true; saveSoon(); });
      sw.append(color, auto);

      const code = el('input', 'name code');
      code.type = 'text'; code.maxLength = 10; code.spellcheck = false; code.value = c.label; code.dataset.role = 'code';
      code.title = 'Short name on the widget';
      code.addEventListener('input', () => { if (code.value.trim()) { c.label = code.value.trim().toUpperCase(); saveSoon(); } });
      code.addEventListener('change', () => { code.value = c.label; renderOverlap(); });

      const name = el('span', 'cityname', c.name + ' · ' + fmtTime(c.tz, now) + ' ' + WT.time.abbreviation(c.tz, new Date(now)));
      if (i === 0) name.prepend(el('span', 'badge', 'Home'));

      head.append(sw, code, name,
        iconBtn('↺', 'Use the default colour', () => { c.color = null; saveNow(); renderCities(); }, !c.color),
        iconBtn('▲', 'Move up (top = home)', () => move(i, -1), i === 0),
        iconBtn('▼', 'Move down', () => move(i, 1), i === state.cities.length - 1),
        iconBtn('✕', 'Remove', () => { state.cities.splice(i, 1); saveNow(); renderAll(); }));

      const l1 = el('div', 'line');
      l1.append(el('span', 'lbl', 'Working'),
        hourSelect(c.work[0], (v) => { c.work[0] = v; saveNow(); renderOverlap(); }), el('span', 'lbl', 'to'),
        hourSelect(c.work[1], (v) => { c.work[1] = v; saveNow(); renderOverlap(); }));
      const wk = el('label', 'check');
      const w = el('input'); w.type = 'checkbox'; w.checked = c.weekends;
      w.addEventListener('change', () => { c.weekends = w.checked; saveNow(); renderOverlap(); });
      wk.append(w, document.createTextNode(' Weekends too'));
      l1.append(wk);

      const l2 = el('div', 'line');
      l2.append(el('span', 'lbl', 'Awake'),
        hourSelect(c.awake[0], (v) => { c.awake[0] = v; saveNow(); }), el('span', 'lbl', 'to'),
        hourSelect(c.awake[1], (v) => { c.awake[1] = v; saveNow(); }));

      li.append(head, l1, l2);
      list.appendChild(li);
    });
    if (!state.cities.length) list.appendChild(el('li', 'muted', 'No cities yet. Search above, or copy them from Dot Clock.'));
    if (focusId && focusRole) {
      const t = list.querySelector(`.timer[data-id="${CSS.escape(focusId)}"] [data-role="${focusRole}"]`);
      if (t) t.focus();
    }
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.cities.length) return;
    [state.cities[i], state.cities[j]] = [state.cities[j], state.cities[i]];
    saveNow(); renderAll();
  }

  function addCity(place) {
    if (state.cities.length >= WT.store.MAX_CITIES) { $('city-status').textContent = 'Up to ' + WT.store.MAX_CITIES + ' cities.'; return; }
    state.cities.push(WT.store.newCity(place));
    $('city-status').textContent = '';
    saveNow(); renderAll();
  }

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
        li.append(el('span', '', WT.geo.cityDetail(c)), el('span', 'meta', fmtTime(c.tz, Date.now()) + ' ' + WT.time.abbreviation(c.tz, new Date())));
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

  // ---- layout / appearance ------------------------------------------------------------
  function renderPanels() {
    const list = $('panel-list');
    list.textContent = '';
    state.panels.forEach((p, i) => {
      const info = PANELS[p.id];
      const li = el('li', 'timer' + (p.enabled ? '' : ' off'));
      const head = el('div', 'head');
      const title = el('label', 'ptitle-strong', info.title);
      const on = el('input'); on.type = 'checkbox'; on.checked = p.enabled;
      on.addEventListener('change', () => { p.enabled = on.checked; saveNow(); renderPanels(); });
      title.prepend(on);
      const spacer = el('span'); spacer.style.flex = '1';
      head.append(title, spacer,
        iconBtn('▲', 'Move up', () => movePanel(i, -1), i === 0),
        iconBtn('▼', 'Move down', () => movePanel(i, 1), i === state.panels.length - 1));
      li.append(head, el('div', 'summary', info.desc));
      list.appendChild(li);
    });
  }
  function movePanel(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.panels.length) return;
    [state.panels[i], state.panels[j]] = [state.panels[j], state.panels[i]];
    saveNow(); renderPanels();
  }

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
    $('opt-hours').value = String(state.hours);
    document.querySelector(`input[name=fmt][value="${state.use24h ? 24 : 12}"]`).checked = true;
    $('opt-highlight').value = state.highlight;
    $('slot-chime').textContent = '';
    $('slot-chime').appendChild(chimeSelect(state.chime, (v) => { state.chime = v; saveNow(); preview(v); }));
    $('opt-volume').value = Math.round(state.volume * 100);
    $('out-volume').textContent = Math.round(state.volume * 100) + '%';
    $('btn-import').disabled = !wtRaw || !WT.worldTime.clocksFrom(wtRaw).length;
    $('btn-import').title = $('btn-import').disabled ? 'Dot Clock isn’t installed, or has no cities yet' : 'Adds any of Dot Clock’s cities not already here';
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
    attachSearch($('add-search'), $('add-results'), (c) => addCity({ name: WT.geo.cityLabel(c), tz: c.tz }));
    $('btn-import').addEventListener('click', () => {
      const have = new Set(state.cities.map((c) => WT.time.canonicalZone(c.tz) + '|' + c.name));
      const add = WT.worldTime.clocksFrom(wtRaw).filter((c) => !have.has(WT.time.canonicalZone(c.tz) + '|' + c.name));
      const room = WT.store.MAX_CITIES - state.cities.length;
      add.slice(0, room).forEach((c) => state.cities.push(WT.store.newCity(c)));
      $('city-status').textContent = add.length ? 'Added ' + Math.min(room, add.length) + ' from Dot Clock.' : 'All of Dot Clock’s cities are already here.';
      saveNow(); renderAll();
    });
    $('opt-hours').addEventListener('change', (e) => { state.hours = Number(e.target.value); saveNow(); });
    document.querySelectorAll('input[name=fmt]').forEach((r) => r.addEventListener('change', () => { state.use24h = r.value === '24'; saveNow(); renderAll(); }));
    $('opt-highlight').addEventListener('input', (e) => { state.highlight = e.target.value; saveSoon(); });
    $('test-chime').addEventListener('click', () => preview(state.chime === 'none' ? 'coin' : state.chime));
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

  function renderAll() { renderOverlap(); renderCities(); renderPanels(); renderRest(); }

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
  $('about').textContent = 'Dot Planner 1.1.0 · ' + WT.geo.cities().length + ' cities · works fully offline';
  setInterval(() => { if (!document.hidden) renderOverlap(); }, 30000);
  setInterval(refreshWorldTime, 3000);
})();
