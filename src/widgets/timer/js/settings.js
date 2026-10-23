/* Dot Timer settings window: timers, appearance (or match Dot Clock), sound, window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const $ = (id) => document.getElementById(id);
  const UNIT_LABELS = { y: 'years', mo: 'months', d: 'days', h: 'hrs', mi: 'mins', s: 'secs' };
  const UNIT_TITLES = { y: 'Years', mo: 'Months', d: 'Days', h: 'Hours', mi: 'Minutes', s: 'Seconds' };

  let state = null;
  let early = null;
  let saveTimer = null;
  let wtLook = null;

  // ---- saving ----------------------------------------------------------------
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    WT.store.save(state).catch((e) => { $('timer-status').textContent = 'Could not save settings: ' + e; });
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 200);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function iconButton(role, label, text) {
    const b = el('button', 'icon-btn ' + role, text);
    b.type = 'button';
    b.dataset.role = role;
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  }

  const timerById = (id) => state.timers.find((t) => t.id === id);

  // ---- status line -------------------------------------------------------------
  function statusText(t, now) {
    const r = WT.timers.readout(t, now);
    switch (t.status) {
      case 'running': return 'Running · ' + r + ' left';
      case 'paused': return 'Paused · ' + r + ' left';
      case 'done': return t.alerting ? 'Done · click the widget to dismiss' : 'Done';
      default: return 'Ready · ' + r;
    }
  }

  function playLabel(t) {
    return t.status === 'running' ? 'Pause' : t.status === 'paused' ? 'Resume' : t.status === 'done' ? 'Start again' : 'Start';
  }

  // ---- timer cards -----------------------------------------------------------------
  function chimeSelect(value) {
    const sel = el('select');
    sel.dataset.role = 'chime';
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
    const none = el('option', '', 'No sound');
    none.value = 'none';
    sel.appendChild(none);
    sel.value = value;
    return sel;
  }

  function radios(name, current, options, onChange) {
    const wrap = el('div', 'seg');
    wrap.setAttribute('role', 'radiogroup');
    for (const [value, text] of options) {
      const l = el('label');
      const r = el('input');
      r.type = 'radio';
      r.name = name;
      r.value = value;
      r.checked = value === current;
      r.addEventListener('change', () => { if (r.checked) onChange(value); });
      l.append(r, document.createTextNode(' ' + text));
      wrap.appendChild(l);
    }
    return wrap;
  }

  function renderTimers() {
    const list = $('timer-list');
    const active = document.activeElement;
    const focusId = active && active.closest && active.closest('.timer') ? active.closest('.timer').dataset.id : null;
    const focusRole = active && active.dataset ? active.dataset.role : null;
    let caret = null;
    try { caret = active && (active.type === 'text') ? active.selectionStart : null; } catch (e) { caret = null; }

    list.textContent = '';
    if (!state.timers.length) {
      list.appendChild(el('li', 'muted', 'No timers yet. Add one below.'));
    }
    const now = Date.now();
    state.timers.forEach((t, i) => {
      const li = el('li', 'timer');
      li.dataset.id = t.id;

      // Head: colour, name, status, controls
      const head = el('div', 'head');
      const sw = el('div', 'swatch');
      const color = el('input');
      color.type = 'color';
      color.dataset.role = 'color';
      color.value = t.color || effectiveDotColor();
      color.title = t.color ? 'Timer colour (custom)' : 'Timer colour (using the global dot colour)';
      const auto = el('span', 'auto', 'auto');
      auto.hidden = !!t.color;
      color.addEventListener('input', () => { t.color = color.value; auto.hidden = true; reset.hidden = false; saveSoon(); });
      sw.append(color, auto);

      const name = el('input', 'name');
      name.type = 'text';
      name.maxLength = 40;
      name.spellcheck = false;
      name.value = t.label;
      name.dataset.role = 'name';
      name.setAttribute('aria-label', 'Timer name');
      name.addEventListener('input', () => { if (name.value.trim()) { t.label = name.value.trim(); saveSoon(); } });
      name.addEventListener('change', () => { if (!name.value.trim()) name.value = t.label; });

      const status = el('span', 'tstatus' + (t.status === 'running' ? ' running' : ''), statusText(t, now));
      status.dataset.role = 'status';

      const reset = iconButton('colreset', 'Use the global dot colour', '↺');
      reset.hidden = !t.color;
      reset.addEventListener('click', () => { t.color = null; saveNow(); renderTimers(); });
      const up = iconButton('up', 'Move up', '▲');
      up.disabled = i === 0;
      up.addEventListener('click', () => move(t.id, -1));
      const down = iconButton('down', 'Move down', '▼');
      down.disabled = i === state.timers.length - 1;
      down.addEventListener('click', () => move(t.id, 1));
      const del = iconButton('remove', 'Remove timer', '✕');
      del.addEventListener('click', () => {
        state.timers = state.timers.filter((x) => x.id !== t.id);
        saveNow();
        renderTimers();
      });
      head.append(sw, name, status, reset, up, down, del);

      // Length
      const lenLine = el('div', 'line');
      lenLine.append(el('span', 'lbl', 'Length'));
      const units = el('div', 'units');
      const summary = el('span', 'summary', WT.timers.describeLength(t.length));
      for (const u of WT.timers.UNITS) {
        const l = el('label');
        l.title = UNIT_TITLES[u];
        const inp = el('input');
        inp.type = 'number';
        inp.min = '0';
        inp.max = String(WT.timers.LIMITS[u]);
        inp.step = '1';
        inp.value = t.length[u] || 0;
        inp.dataset.role = 'len-' + u;
        inp.setAttribute('aria-label', UNIT_TITLES[u]);
        inp.addEventListener('input', () => {
          const v = inp.value === '' ? 0 : Number(inp.value);
          const ok = Number.isInteger(v) && v >= 0 && v <= WT.timers.LIMITS[u];
          inp.classList.toggle('bad', !ok);
          if (!ok) return;
          const next = Object.assign({}, t.length, { [u]: v });
          if (WT.timers.isEmptyLength(next)) {
            summary.textContent = 'Set a length above zero';
            summary.classList.add('bad');
            return;
          }
          summary.classList.remove('bad');
          t.length = next;
          summary.textContent = WT.timers.describeLength(next);
          // A new length can't apply to a countdown that's already under way.
          if (t.status !== 'idle') { WT.timers.reset(t); refreshLive(); }
          saveSoon();
        });
        l.append(inp, document.createTextNode(UNIT_LABELS[u]));
        units.appendChild(l);
      }
      lenLine.append(units, summary);

      // Bar direction
      const barLine = el('div', 'line');
      barLine.append(el('span', 'lbl', 'Bar'),
        radios('dir-' + t.id, t.direction, [['empty', 'Empties as time runs out'], ['fill', 'Fills up as time passes']],
          (v) => { t.direction = v; saveNow(); }));

      // Chime + finish behaviour + controls
      const chimeLine = el('div', 'line');
      const sel = chimeSelect(t.chime);
      sel.addEventListener('change', () => { t.chime = sel.value; saveNow(); preview(sel.value); });
      const test = el('button', 'ctl', '▶ Test');
      test.type = 'button';
      test.dataset.role = 'test';
      test.addEventListener('click', () => preview(t.chime));
      const finish = el('select');
      finish.dataset.role = 'finish';
      [['once', 'Chime once'], ['repeat', 'Repeat until clicked']].forEach(([v, txt]) => {
        const o = el('option', '', txt);
        o.value = v;
        finish.appendChild(o);
      });
      finish.value = t.finish;
      finish.addEventListener('change', () => { t.finish = finish.value; saveNow(); });
      chimeLine.append(el('span', 'lbl', 'Chime'), sel, test, el('span', 'lbl', 'When done'), finish);

      const ctlLine = el('div', 'line');
      const play = el('button', 'ctl primary', playLabel(t));
      play.type = 'button';
      play.dataset.role = 'play';
      play.addEventListener('click', () => {
        WT.chimes.unlock();
        WT.timers.toggle(t, Date.now());
        saveNow();
        refreshLive();
      });
      const rst = el('button', 'ctl', 'Reset');
      rst.type = 'button';
      rst.dataset.role = 'reset';
      rst.addEventListener('click', () => { WT.timers.reset(t); saveNow(); refreshLive(); });
      ctlLine.append(play, rst);

      li.append(head, lenLine, barLine, chimeLine, ctlLine);
      list.appendChild(li);
    });

    if (focusId && focusRole) {
      const target = list.querySelector(`.timer[data-id="${CSS.escape(focusId)}"] [data-role="${focusRole}"]`);
      if (target && !target.disabled) {
        target.focus();
        if (caret !== null && target.setSelectionRange) try { target.setSelectionRange(caret, caret); } catch (e) { /* */ }
      }
    }
    $('btn-add').disabled = state.timers.length >= WT.store.MAX_TIMERS;
  }

  function move(id, delta) {
    const i = state.timers.findIndex((t) => t.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.timers.length) return;
    [state.timers[i], state.timers[j]] = [state.timers[j], state.timers[i]];
    saveNow();
    renderTimers();
  }

  function preview(id) {
    WT.chimes.unlock();
    if (id && id !== 'none') WT.chimes.play(id, state.volume);
  }

  /** Updates status text and play/pause labels without rebuilding (keeps typing focus). */
  function refreshLive() {
    const now = Date.now();
    document.querySelectorAll('.timer').forEach((li) => {
      const t = timerById(li.dataset.id);
      if (!t) return;
      const s = li.querySelector('[data-role=status]');
      s.textContent = statusText(t, now);
      s.classList.toggle('running', t.status === 'running');
      li.querySelector('[data-role=play]').textContent = playLabel(t);
    });
  }

  // ---- appearance ------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);
  const effectiveDotColor = () => (matched() ? wtLook.dotColor : state.dotColor);

  function renderAppearance() {
    $('opt-match').checked = state.matchWorldTime;
    $('match-status').textContent = !state.matchWorldTime ? 'Using the settings below.'
      : wtLook ? `Matched to Dot Clock: ${wtLook.width} dots wide, ${wtLook.dotSize} px dots. Change its look in Dot Clock.`
        : 'Dot Clock isn’t installed (or hasn’t been run yet), so the settings below are used.';
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
    $('opt-volume').value = Math.round(state.volume * 100);
    $('out-volume').textContent = Math.round(state.volume * 100) + '%';
    $('opt-top').checked = state.alwaysOnTop;
  }

  function bindAppearance() {
    $('opt-match').addEventListener('change', (e) => { state.matchWorldTime = e.target.checked; saveNow(); renderAll(); });
    $('opt-dot').addEventListener('input', (e) => { state.dotColor = e.target.value; saveSoon(); });
    $('btn-dot-all').addEventListener('click', () => { state.timers.forEach((t) => { t.color = null; }); saveNow(); renderTimers(); });
    $('opt-size').addEventListener('input', (e) => {
      state.dotSize = parseInt(e.target.value, 10);
      $('out-size').textContent = state.dotSize + ' px';
      saveSoon();
    });
    document.querySelectorAll('input[name=shape]').forEach((r) => r.addEventListener('change', () => {
      state.dotShape = r.value; saveNow();
    }));
    $('opt-unlit').addEventListener('change', (e) => { state.showUnlit = e.target.checked; saveNow(); });
    $('opt-bg').addEventListener('input', (e) => { state.bgColor = e.target.value; saveSoon(); });
    $('opt-opacity').addEventListener('input', (e) => {
      state.bgOpacity = parseInt(e.target.value, 10) / 100;
      $('out-opacity').textContent = state.bgOpacity === 0 ? 'Transparent' : e.target.value + '%';
      saveSoon();
    });
    $('opt-width').addEventListener('input', (e) => {
      state.width = parseInt(e.target.value, 10);
      $('out-width').textContent = state.width + ' dots';
      saveSoon();
    });
    $('opt-volume').addEventListener('input', (e) => {
      state.volume = parseInt(e.target.value, 10) / 100;
      $('out-volume').textContent = e.target.value + '%';
      saveSoon();
    });
    $('opt-volume').addEventListener('change', () => preview((state.timers[0] && state.timers[0].chime) || 'coin'));
    $('opt-top').addEventListener('change', (e) => { state.alwaysOnTop = e.target.checked; saveNow(); });
    $('btn-center').addEventListener('click', () => WT.store.recenterWidget());
    $('btn-quit').addEventListener('click', () => WT.store.quit());
    $('btn-add').addEventListener('click', () => {
      if (state.timers.length >= WT.store.MAX_TIMERS) return;
      const t = WT.store.newTimer(state.timers.length + 1);
      state.timers.push(t);
      saveNow();
      renderTimers();
      const li = document.querySelector(`.timer[data-id="${CSS.escape(t.id)}"]`);
      if (li) {
        li.scrollIntoView({ block: 'nearest' });
        li.querySelector('[data-role=name]').select();
      }
    });
  }

  function buildGallery() {
    const g = $('chime-gallery');
    WT.chimes.CHIMES.forEach((c) => {
      const b = el('button', '', '▶ ' + c.name);
      b.type = 'button';
      b.title = c.kind + ' tone · ' + c.bits + '-bit';
      b.appendChild(el('span', 'kind', c.kind));
      b.addEventListener('click', () => preview(c.id));
      g.appendChild(b);
    });
  }

  function renderAll() {
    renderTimers();
    renderAppearance();
  }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    const next = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
    const changed = JSON.stringify(next) !== JSON.stringify(wtLook);
    wtLook = next;
    if (changed && state) renderAppearance();
  }

  // ---- wiring ----------------------------------------------------------------------
  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;
    // Only rebuild cards when something other than the live countdown changed,
    // so typing isn't interrupted by the widget saving a finished timer.
    state = s;
    renderAll();
  });
  state = await WT.store.load();
  if (early) state = early;
  await refreshWorldTime();

  bindAppearance();
  buildGallery();
  renderAll();

  $('about').textContent = 'Dot Timer 1.1.0 · works fully offline';
  setInterval(() => { if (!document.hidden) refreshLive(); }, 500);
  setInterval(refreshWorldTime, 3000);
})();
