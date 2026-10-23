/* Settings window: location (OS or city search), clocks, appearance, window.
 * Everything here works offline: no maps, no web lookups. */
(async function () {
  'use strict';
  const WT = window.WT;
  const $ = (id) => document.getElementById(id);
  const MAX_CLOCKS = 24;

  let state = null;
  let early = null;         // broadcast received while still loading
  let autoLocateTried = false;
  let saveTimer = null;

  // ---- saving ----------------------------------------------------------------
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    WT.store.save(state).catch((e) => setStatus('Could not save settings: ' + e, true));
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 150);
  }

  function setStatus(msg, isError) {
    const s = $('loc-status');
    s.textContent = msg || '';
    s.classList.toggle('error', !!isError);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function zoneLine(tz, now) {
    return tz.replace(/_/g, ' ') + ' · ' + WT.time.abbreviation(tz, now) + ' · ' +
      WT.time.formatTime(tz, now, state.use24h, false);
  }

  // ---- home ----------------------------------------------------------------
  function home() { return state.clocks.find((c) => c.home) || null; }

  function setHome(place) {
    const old = home();
    const clock = {
      id: old ? old.id : WT.store.uid(), label: place.label.slice(0, 40), tz: place.tz,
      lat: place.lat, lng: place.lng, color: old ? old.color : null, home: true,
    };
    if (old) state.clocks[state.clocks.indexOf(old)] = clock;
    else state.clocks.unshift(clock);
    saveNow();
    renderAll();
    return clock;
  }

  async function useLocation() {
    setStatus('Finding your location…');
    $('btn-locate').disabled = true;
    try {
      const pos = await WT.geo.currentPosition(12000);
      // Named after the nearest city in the built-in list; the user can rename it.
      const d = WT.geo.describePoint(pos.lat, pos.lng, WT.time.systemZone());
      setHome(d);
      setStatus('Location set to ' + d.label + '. Not quite right? Rename it under Clocks, or search for your city.');
    } catch (e) {
      // Location services off / denied / timed out -> let them search for their city.
      setStatus(((e && e.message) || 'Location is unavailable.') + ' Search for your city (or the nearest one) below.', true);
      focusHomeSearch();
    } finally {
      $('btn-locate').disabled = false;
    }
  }

  // ---- clocks ----------------------------------------------------------------
  function addClock(place) {
    const dup = state.clocks.find((c) => c.tz === place.tz && c.label.toLowerCase() === place.label.toLowerCase());
    if (dup) { flash(dup.id); return; }
    if (state.clocks.length >= MAX_CLOCKS) {
      $('clock-status').textContent = 'You can show up to ' + MAX_CLOCKS + ' clocks. Remove one to add another.';
      return;
    }
    $('clock-status').textContent = '';
    const c = {
      id: WT.store.uid(), label: place.label.slice(0, 40), tz: place.tz,
      lat: place.lat, lng: place.lng, color: null, home: false,
    };
    state.clocks.push(c);
    saveNow();
    renderClocks();
    flash(c.id);
  }

  function flash(id) {
    const li = document.querySelector(`.clock[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.scrollIntoView({ block: 'nearest' });
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 900);
  }

  function move(id, delta) {
    const i = state.clocks.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.clocks.length) return;
    [state.clocks[i], state.clocks[j]] = [state.clocks[j], state.clocks[i]];
    saveNow();
    renderClocks();
    const btn = document.querySelector(`.clock[data-id="${CSS.escape(id)}"] .${delta < 0 ? 'up' : 'down'}`);
    if (btn && !btn.disabled) btn.focus();
  }

  function iconButton(cls, label, text) {
    const b = el('button', 'icon-btn ' + cls, text);
    b.type = 'button';
    b.dataset.role = cls;
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  }

  function renderClocks() {
    const list = $('clock-list');
    // Preserve focus/caret if the user is typing in a name field.
    const active = document.activeElement;
    const focusId = active && active.closest && active.closest('.clock') ? active.closest('.clock').dataset.id : null;
    const focusRole = active && active.dataset ? active.dataset.role : null;
    let caret = null;
    try { caret = active && active.type === 'text' ? active.selectionStart : null; } catch (e) { caret = null; }

    list.textContent = '';
    if (!state.clocks.length) {
      list.appendChild(el('li', 'empty-list', 'No clocks yet. Set your location or add a city above.'));
      return;
    }
    const now = new Date();
    state.clocks.forEach((c, i) => {
      const li = el('li', 'clock');
      li.dataset.id = c.id;

      const sw = el('div', 'swatch');
      const color = el('input');
      color.type = 'color';
      color.dataset.role = 'color';
      color.value = c.color || state.dotColor;
      color.title = c.color ? 'Row colour (custom)' : 'Row colour (using the global dot colour)';
      color.addEventListener('input', () => {
        c.color = color.value;
        reset.hidden = false;
        auto.hidden = true;
        saveSoon();
      });
      const auto = el('span', 'auto', 'auto');
      auto.hidden = !!c.color;
      sw.append(color, auto);

      const main = el('div', 'main');
      const name = el('input', 'name');
      name.type = 'text';
      name.dataset.role = 'name';
      name.maxLength = 40;
      name.spellcheck = false;
      name.value = c.label;
      name.setAttribute('aria-label', 'Clock name');
      name.addEventListener('input', () => {
        if (name.value.trim()) { c.label = name.value.trim(); saveSoon(); }
      });
      name.addEventListener('change', () => {
        if (!name.value.trim()) { name.value = c.label; }
        if (c.home) renderHome();
      });
      const meta = el('div', 'meta', zoneLine(c.tz, now));
      meta.dataset.tz = c.tz;
      main.append(name, meta);

      li.append(sw, main);
      if (c.home) {
        const b = el('span', 'badge', 'Home');
        b.title = 'Your location. Change it under “Your location”.';
        li.append(b);
      }

      const reset = iconButton('reset', 'Use the global dot colour', '↺');
      reset.hidden = !c.color;
      reset.addEventListener('click', () => { c.color = null; saveNow(); renderClocks(); });
      const up = iconButton('up', 'Move up', '▲');
      up.disabled = i === 0;
      up.addEventListener('click', () => move(c.id, -1));
      const down = iconButton('down', 'Move down', '▼');
      down.disabled = i === state.clocks.length - 1;
      down.addEventListener('click', () => move(c.id, 1));
      const del = iconButton('remove', c.home ? 'Your home clock can be changed, not removed' : 'Remove', '✕');
      del.disabled = c.home;
      del.addEventListener('click', () => {
        state.clocks = state.clocks.filter((x) => x.id !== c.id);
        saveNow();
        renderClocks();
      });
      li.append(reset, up, down, del);
      list.appendChild(li);
    });

    if (focusId && focusRole) {
      const target = list.querySelector(`.clock[data-id="${CSS.escape(focusId)}"] [data-role="${focusRole}"]`);
      if (target && !target.disabled) {
        target.focus();
        if (caret !== null && target.setSelectionRange) try { target.setSelectionRange(caret, caret); } catch (e) { /* */ }
      }
    }
  }

  function renderHome() {
    const h = home();
    $('home-label').textContent = h ? h.label : 'Not set yet';
    $('home-meta').textContent = !h ? 'Your home clock appears first on the widget.' :
      zoneLine(h.tz, new Date()) + (h.auto ? ' · guessed from your computer’s time zone' : '');
  }

  /** First run: try location services once, when this window is actually on screen. */
  function maybeAutoLocate() {
    const h = home();
    if (autoLocateTried || (h && !h.auto)) return;
    autoLocateTried = true;
    useLocation();
  }

  // ---- appearance ------------------------------------------------------------
  function renderAppearance() {
    document.querySelector(`input[name=fmt][value="${state.use24h ? 24 : 12}"]`).checked = true;
    document.querySelector(`input[name=shape][value="${state.dotShape}"]`).checked = true;
    $('opt-seconds').checked = state.showSeconds;
    $('opt-dot').value = state.dotColor;
    $('opt-size').value = state.dotSize;
    $('out-size').textContent = state.dotSize + ' px';
    $('opt-unlit').checked = state.showUnlit;
    $('opt-bg').value = state.bgColor;
    $('opt-opacity').value = Math.round(state.bgOpacity * 100);
    $('out-opacity').textContent = state.bgOpacity === 0 ? 'Transparent' : Math.round(state.bgOpacity * 100) + '%';
    $('opt-top').checked = state.alwaysOnTop;
  }

  function bindAppearance() {
    document.querySelectorAll('input[name=fmt]').forEach((r) => r.addEventListener('change', () => {
      state.use24h = r.value === '24'; saveNow(); refreshLive();
    }));
    document.querySelectorAll('input[name=shape]').forEach((r) => r.addEventListener('change', () => {
      state.dotShape = r.value; saveNow();
    }));
    $('opt-seconds').addEventListener('change', (e) => { state.showSeconds = e.target.checked; saveNow(); });
    $('opt-dot').addEventListener('input', (e) => {
      state.dotColor = e.target.value;
      document.querySelectorAll('.clock').forEach((li) => {
        const c = state.clocks.find((x) => x.id === li.dataset.id);
        if (c && !c.color) li.querySelector('input[type=color]').value = state.dotColor;
      });
      saveSoon();
    });
    $('btn-dot-all').addEventListener('click', () => {
      state.clocks.forEach((c) => { c.color = null; });
      saveNow();
      renderClocks();
    });
    $('opt-size').addEventListener('input', (e) => {
      state.dotSize = parseInt(e.target.value, 10);
      $('out-size').textContent = state.dotSize + ' px';
      saveSoon();
    });
    $('opt-unlit').addEventListener('change', (e) => { state.showUnlit = e.target.checked; saveNow(); });
    $('opt-bg').addEventListener('input', (e) => { state.bgColor = e.target.value; saveSoon(); });
    $('opt-opacity').addEventListener('input', (e) => {
      state.bgOpacity = parseInt(e.target.value, 10) / 100;
      $('out-opacity').textContent = state.bgOpacity === 0 ? 'Transparent' : e.target.value + '%';
      saveSoon();
    });
    $('opt-top').addEventListener('change', (e) => { state.alwaysOnTop = e.target.checked; saveNow(); });
    $('btn-center').addEventListener('click', () => WT.store.recenterWidget());
    $('btn-quit').addEventListener('click', () => WT.store.quit());
  }

  // ---- search dropdowns --------------------------------------------------------
  function attachSearch(input, list, onChoose) {
    let items = [];
    let active = -1;
    function hide() { list.hidden = true; active = -1; }
    function draw() {
      list.textContent = '';
      const q = input.value.trim();
      if (!q) { hide(); return; }
      items = WT.geo.search(q, 8);
      if (!items.length) {
        list.appendChild(el('li', 'empty', 'No match. Try the nearest bigger city in the same time zone, then rename it.'));
      }
      const now = new Date();
      items.forEach((c, i) => {
        const li = el('li', i === active ? 'active' : '');
        li.setAttribute('role', 'option');
        li.append(el('span', '', WT.geo.cityDetail(c)),
          el('span', 'meta', WT.time.abbreviation(c.tz, now) + ' ' + WT.time.formatTime(c.tz, now, state.use24h, false)));
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
        list.appendChild(li);
      });
      list.hidden = false;
    }
    function choose(i) {
      const c = items[i];
      if (!c) return;
      input.value = '';
      hide();
      onChoose(c);
    }
    input.addEventListener('input', () => { active = -1; draw(); });
    input.addEventListener('focus', draw);
    input.addEventListener('blur', () => setTimeout(hide, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active >= 0 ? active : 0); }
      else if (e.key === 'Escape') { hide(); }
    });
  }

  // ---- searching -------------------------------------------------------------
  /** Puts the cursor in "search for your city" (used when location services fail). */
  function focusHomeSearch() {
    const input = $('home-search');
    input.scrollIntoView({ block: 'nearest' });
    input.focus();
  }

  function bindSearches() {
    $('btn-locate').addEventListener('click', useLocation);
    attachSearch($('home-search'), $('home-results'), (c) => {
      const label = WT.geo.cityLabel(c);
      setHome({ label, tz: c.tz, lat: c.lat, lng: c.lng });
      setStatus('Location set to ' + label + '.');
    });
    attachSearch($('add-search'), $('add-results'), (c) => {
      addClock({ label: WT.geo.cityLabel(c), tz: c.tz, lat: c.lat, lng: c.lng });
    });
  }

  // ---- live bits -------------------------------------------------------------
  function refreshLive() {
    const now = new Date();
    document.querySelectorAll('.clock .meta').forEach((m) => { m.textContent = zoneLine(m.dataset.tz, now); });
    renderHome();
  }

  function renderAll() {
    renderHome();
    renderClocks();
    renderAppearance();
  }

  // ---- wiring ----------------------------------------------------------------
  // Listen before loading so a change made meanwhile isn't lost.
  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;                     // our own save echoing back
    state = s;
    renderAll();
  });
  state = await WT.store.load();
  if (early) state = early;

  WT.store.onOpenSection((section) => {
    if (section.split('|')[0] === 'locate') maybeAutoLocate();
  });

  bindAppearance();
  bindSearches();
  renderAll();

  $('about').textContent = 'Dot Clock 1.1.0 · ' + WT.geo.cities().length + ' cities · tzdata ' +
    WT.TZDATA_VERSION + ' · works fully offline';

  setInterval(() => { if (!document.hidden) refreshLive(); }, 1000);
  window.addEventListener('focus', maybeAutoLocate);
  // The "open" event can arrive before this page has loaded; cover that case too.
  if (document.hasFocus()) maybeAutoLocate();
})();
