/* Dot Weather settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const Wx = WT.weather;
  const F = WT.forecast;
  const $ = (id) => document.getElementById(id);
  const STYLE_INFO = {
    now: ['A · Now', 'Big icon and temperature, conditions, today’s high and low, and the place.'],
    hours: ['B · Next hours', 'Every 2 hours across the width: time, icon, temperature.'],
    days: ['C · Days ahead', 'Today to 4 days: high and low with a range bar.'],
    graph: ['D · 24-hour graph', 'Temperature line over chance-of-rain columns, with the place.'],
    cities: ['E · Cities', 'One row per place, like Dot Clock.'],
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
  const deg = (c) => Math.round(state.unit === 'F' ? c * 9 / 5 + 32 : c) + '°' + state.unit;
  const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  function setStatus(msg, error) {
    $('place-status').textContent = msg || '';
    $('place-status').classList.toggle('error', !!error);
  }

  // ---- right now -------------------------------------------------------------------------
  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }
  function renderNow() {
    const p = state.places[0];
    if (!p) { $('now-main').textContent = 'Add a place below to see its weather.'; $('now-meta').textContent = ''; return; }
    const e = F.cached(p);
    const v = e.model ? Wx.view(e.model, Date.now()) : null;
    if (!v) {
      $('now-main').textContent = p.label + ': ' + (e.error ? 'couldn’t get the weather' : 'getting the weather…');
      $('now-meta').textContent = e.error ? e.error + '. Check the internet connection, then click Refresh now.' : '';
      return;
    }
    const t = v.days[0];
    $('now-main').textContent = `${p.label}: ${deg(v.now.t)}, ${cap(v.now.text || 'Unknown')}`;
    $('now-meta').textContent = (t ? `High ${deg(t.hi)} · Low ${deg(t.lo)} · ` : '') + 'Updated ' + ago(e.model.fetchedAt) +
      (e.error ? ' · offline, showing the last forecast' : '');
  }

  // ---- style -------------------------------------------------------------------------------
  function renderStyles() {
    const box = $('style-list');
    box.textContent = '';
    for (const id of Wx.STYLES) {
      const [title, desc] = STYLE_INFO[id];
      const l = el('label', 'style-card' + (state.style === id ? ' on' : ''));
      const r = el('input'); r.type = 'radio'; r.name = 'style'; r.checked = state.style === id;
      r.addEventListener('change', () => { state.style = id; saveNow(); renderStyles(); });
      const t = el('div');
      t.append(el('div', 'strong', title), el('div', 'muted small-text', desc));
      l.append(r, t);
      box.appendChild(l);
    }
    $('days-row').hidden = state.style !== 'days';
    $('opt-days').value = String(state.days);
  }

  // ---- places --------------------------------------------------------------------------------
  function renderPlaces() {
    const list = $('place-list');
    const active = document.activeElement;
    const focusId = active && active.closest && active.closest('.timer') ? active.closest('.timer').dataset.id : null;
    list.textContent = '';
    state.places.forEach((p, i) => {
      const li = el('li', 'timer');
      li.dataset.id = p.id;
      const head = el('div', 'head');
      const name = el('input', 'name');
      name.type = 'text'; name.maxLength = 24; name.spellcheck = false; name.value = p.label; name.dataset.role = 'label';
      name.title = 'Name shown on the widget';
      name.addEventListener('input', () => { if (name.value.trim()) { p.label = name.value.trim(); saveSoon(); } });
      name.addEventListener('change', () => { name.value = p.label; renderNow(); });
      const e = F.cached(p);
      const v = e.model ? Wx.view(e.model, Date.now()) : null;
      const info = el('span', 'cityname', p.name + (v ? ' · ' + deg(v.now.t) : ''));
      if (i === 0) info.prepend(el('span', 'badge main', 'Main'));
      head.append(name, info,
        iconBtn('▲', 'Move up (top = main place)', () => move(i, -1), i === 0),
        iconBtn('▼', 'Move down', () => move(i, 1), i === state.places.length - 1),
        iconBtn('✕', 'Remove', () => { state.places.splice(i, 1); saveNow(); renderAll(); }));
      li.append(head);
      list.appendChild(li);
    });
    if (!state.places.length) list.appendChild(el('li', 'muted', 'No places yet. Use your location, search above, or copy them from Dot Clock.'));
    if (focusId) {
      const t = list.querySelector(`.timer[data-id="${CSS.escape(focusId)}"] [data-role="label"]`);
      if (t) t.focus();
    }
    $('btn-import').disabled = !wtRaw || !WT.worldTime.clocksFrom(wtRaw).some((c) => c.lat !== null);
    $('btn-import').title = $('btn-import').disabled ? 'Dot Clock isn’t installed, or has no cities yet' : 'Adds any of Dot Clock’s cities not already here';
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.places.length) return;
    [state.places[i], state.places[j]] = [state.places[j], state.places[i]];
    saveNow(); renderAll();
    refreshForecasts(false);
  }

  const same = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lng - b.lng) < 0.01;
  function addPlace(p, toTop) {
    const dup = state.places.find((x) => same(x, p));
    if (dup) { setStatus(dup.label + ' is already in the list.'); return; }
    if (state.places.length >= WT.store.MAX_PLACES) { setStatus('Up to ' + WT.store.MAX_PLACES + ' places. Remove one to add another.', true); return; }
    const place = WT.store.newPlace(p);
    if (toTop) state.places.unshift(place); else state.places.push(place);
    setStatus('');
    saveNow(); renderAll();
    refreshForecasts(false);
  }

  async function useLocation() {
    setStatus('Finding your location…');
    $('btn-locate').disabled = true;
    try {
      const pos = await WT.geo.currentPosition(12000);
      // Named after the nearest city in the built-in list; the user can rename it.
      const d = WT.geo.describePoint(pos.lat, pos.lng, WT.time.systemZone());
      const existing = state.places.find((x) => same(x, d));
      if (existing) {
        state.places.splice(state.places.indexOf(existing), 1);
        state.places.unshift(existing);
        saveNow(); renderAll();
      } else {
        addPlace({ label: d.label, name: d.label + ' (your location)', lat: d.lat, lng: d.lng, tz: d.tz }, true);
      }
      setStatus('Main place set to ' + d.label + '. Rename it if you like.');
      refreshForecasts(false);
    } catch (e) {
      setStatus(((e && e.message) || 'Location is unavailable.') + ' Search for your city (or the nearest one) instead.', true);
      $('add-search').focus();
    } finally {
      $('btn-locate').disabled = false;
    }
  }

  function attachSearch(input, list, onChoose) {
    let items = [], active = -1;
    const hide = () => { list.hidden = true; active = -1; };
    function draw() {
      list.textContent = '';
      const q = input.value.trim();
      if (!q) { hide(); return; }
      items = WT.geo.search(q, 8);
      if (!items.length) list.appendChild(el('li', 'empty', 'No match. Try the nearest bigger town or city.'));
      items.forEach((c, i) => {
        const li = el('li', i === active ? 'active' : '');
        li.append(el('span', '', WT.geo.cityDetail(c)), el('span', 'meta', c.lat.toFixed(1) + ', ' + c.lng.toFixed(1)));
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

  async function refreshForecasts(force) {
    if (force) { $('btn-refresh').disabled = true; $('now-meta').textContent = 'Refreshing…'; }
    try { await F.refresh(state.places, force); } finally { $('btn-refresh').disabled = false; }
    renderNow(); renderPlaces();
  }

  // ---- the rest -------------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    document.querySelector(`input[name=unit][value="${state.unit}"]`).checked = true;
    document.querySelector(`input[name=fmt][value="${state.use24h ? 24 : 12}"]`).checked = true;
    document.querySelector(`input[name=icons][value="${state.icons}"]`).checked = true;
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
    $('btn-refresh').addEventListener('click', () => refreshForecasts(true));
    $('btn-locate').addEventListener('click', useLocation);
    attachSearch($('add-search'), $('add-results'), (c) => addPlace({ label: WT.geo.cityLabel(c), name: WT.geo.cityDetail(c), lat: c.lat, lng: c.lng, tz: c.tz }));
    $('btn-import').addEventListener('click', () => {
      const add = WT.worldTime.clocksFrom(wtRaw).filter((c) => c.lat !== null && !state.places.some((x) => same(x, c)));
      const room = WT.store.MAX_PLACES - state.places.length;
      add.slice(0, room).forEach((c) => state.places.push(WT.store.newPlace(c)));
      setStatus(add.length ? 'Added ' + Math.min(add.length, room) + ' from Dot Clock.' : 'Dot Clock’s cities are already here.');
      saveNow(); renderAll();
      refreshForecasts(false);
    });
    $('opt-days').addEventListener('change', (e) => { state.days = Number(e.target.value); saveNow(); });
    document.querySelectorAll('input[name=unit]').forEach((r) => r.addEventListener('change', () => { state.unit = r.value; saveNow(); renderNow(); renderPlaces(); }));
    document.querySelectorAll('input[name=fmt]').forEach((r) => r.addEventListener('change', () => { state.use24h = r.value === '24'; saveNow(); }));
    document.querySelectorAll('input[name=icons]').forEach((r) => r.addEventListener('change', () => { state.icons = r.value; saveNow(); }));
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

  function renderAll() { renderNow(); renderStyles(); renderPlaces(); renderRest(); }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    if (raw === wtRaw) return;
    wtRaw = raw;
    wtLook = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
    if (state) { renderRest(); renderPlaces(); }
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
  F.onChange(() => { renderNow(); renderPlaces(); });
  refreshForecasts(false);   // only fetches what's stale
  $('about').textContent = 'Dot Weather 1.0.0 · forecasts from Open-Meteo.com';
  setInterval(() => { if (!document.hidden) renderNow(); }, 15000);
  setInterval(refreshWorldTime, 3000);
})();
