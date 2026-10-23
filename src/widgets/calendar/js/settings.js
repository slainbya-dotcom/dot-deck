/* Dot Calendar settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const C = WT.calendar;
  const $ = (id) => document.getElementById(id);

  const INFO = {
    minute: { title: 'Minute', counts: 'seconds', value: 'Current second (SEC 42)', unit: 'second' },
    hour: { title: 'Hour', counts: 'minutes', value: 'Current minute (MIN 37)', unit: 'minute' },
    day: { title: 'Day', counts: 'hours', value: 'Current hour (HR 14)', unit: 'hour' },
    week: { title: 'Week', counts: 'days', value: 'Week number (WK 43)', unit: 'day' },
    month: { title: 'Month', counts: 'days', value: 'Date (22 OCT)', unit: 'day' },
    year: { title: 'Year', counts: null, value: null, unit: null },
  };
  const YEAR_VALUE = { days: 'Date (22 OCT)', weeks: 'Week number (WK 43)', months: 'Month (OCT)' };
  const YEAR_UNIT = { days: 'day', weeks: 'week', months: 'month' };

  let state = null;
  let early = null;
  let saveTimer = null;
  let wtLook = null;

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    WT.store.save(state).catch((e) => console.error(e));
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

  function select(role, options, value, onChange) {
    const s = el('select');
    s.dataset.role = role;
    for (const [v, t] of options) {
      const o = el('option', '', t);
      o.value = v;
      s.appendChild(o);
    }
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function chimeSelect(value, onChange) {
    const sel = el('select');
    sel.dataset.role = 'chime';
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

  function preview(id) {
    WT.chimes.unlock();
    if (id && id !== 'none') WT.chimes.play(id, state.volume);
  }

  const effectiveDotColor = () => (state.matchWorldTime && wtLook ? wtLook.dotColor : state.dotColor);
  const unitOf = (t) => (t.kind === 'year' ? YEAR_UNIT[t.yearCounts] : INFO[t.kind].unit);

  function preview_line(t, now) {
    const o = { weekStart: state.weekStart, yearCounts: t.yearCounts };
    const f = C.fraction(t.kind, now, o, t.steps);
    const shown = C.readout(t, now, { weekStart: state.weekStart });
    return `${C.label(t.label, now) || '(no label)'} · ${shown ? shown + ' · ' : ''}${Math.floor(f * 100)}% through`;
  }

  // ---- tracker cards --------------------------------------------------------------
  function renderTrackers() {
    const list = $('tracker-list');
    const active = document.activeElement;
    const focusKind = active && active.closest && active.closest('.timer') ? active.closest('.timer').dataset.kind : null;
    const focusRole = active && active.dataset ? active.dataset.role : null;
    list.textContent = '';
    const now = Date.now();

    state.trackers.forEach((t, i) => {
      const info = INFO[t.kind];
      const li = el('li', 'timer' + (t.enabled ? '' : ' off'));
      li.dataset.kind = t.kind;

      // head: on/off, colour, label, live preview, reorder
      const head = el('div', 'head');
      const on = el('input');
      on.type = 'checkbox';
      on.checked = t.enabled;
      on.dataset.role = 'enabled';
      on.title = 'Show this bar';
      on.addEventListener('change', () => { t.enabled = on.checked; saveNow(); renderTrackers(); });

      const sw = el('div', 'swatch');
      const color = el('input');
      color.type = 'color';
      color.dataset.role = 'color';
      color.value = t.color || effectiveDotColor();
      const auto = el('span', 'auto', 'auto');
      auto.hidden = !!t.color;
      color.addEventListener('input', () => { t.color = color.value; auto.hidden = true; reset.hidden = false; saveSoon(); });
      sw.append(color, auto);

      const title = el('span', 'ktitle', info.title);
      const name = el('input', 'name');
      name.type = 'text';
      name.maxLength = 40;
      name.spellcheck = false;
      name.value = t.label;
      name.placeholder = 'No label';
      name.dataset.role = 'name';
      name.setAttribute('aria-label', info.title + ' label');
      name.addEventListener('input', () => { t.label = name.value.trim(); saveSoon(); });

      const reset = el('button', 'icon-btn', '↺');
      reset.type = 'button';
      reset.title = 'Use the global dot colour';
      reset.hidden = !t.color;
      reset.addEventListener('click', () => { t.color = null; saveNow(); renderTrackers(); });
      const up = el('button', 'icon-btn', '▲');
      up.type = 'button'; up.title = 'Move up'; up.dataset.role = 'up'; up.disabled = i === 0;
      up.addEventListener('click', () => move(i, -1));
      const down = el('button', 'icon-btn', '▼');
      down.type = 'button'; down.title = 'Move down'; down.dataset.role = 'down'; down.disabled = i === state.trackers.length - 1;
      down.addEventListener('click', () => move(i, 1));
      head.append(on, sw, title, name, reset, up, down);

      const live = el('div', 'tstatus', preview_line(t, now));
      live.dataset.role = 'live';

      // options
      const l1 = el('div', 'line');
      if (t.kind === 'year') {
        l1.append(el('span', 'lbl', 'Counts'), select('counts', [['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months']], t.yearCounts,
          (v) => { t.yearCounts = v; saveNow(); renderTrackers(); }));
      } else {
        l1.append(el('span', 'lbl', 'Counts'), el('span', 'summary', info.counts));
      }
      const valueText = t.kind === 'year' ? YEAR_VALUE[t.yearCounts] : info.value;
      l1.append(el('span', 'lbl', 'Shows'), select('show', [['value', valueText], ['count', 'Count (e.g. 22/31)'], ['percent', 'Percent'], ['none', 'Nothing']], t.show,
        (v) => { t.show = v; saveNow(); }));

      const l2 = el('div', 'line');
      l2.append(el('span', 'lbl', 'Bar'),
        select('direction', [['fill', 'Fills up'], ['drain', 'Drains']], t.direction, (v) => { t.direction = v; saveNow(); }),
        select('steps', [['smooth', 'Moves smoothly'], ['steps', 'Moves one ' + unitOf(t) + ' at a time']], t.steps ? 'steps' : 'smooth',
          (v) => { t.steps = v === 'steps'; saveNow(); }));

      const l3 = el('div', 'line');
      const test = el('button', 'ctl', '▶ Test');
      test.type = 'button';
      test.addEventListener('click', () => preview(t.chime === 'none' ? 'coin' : t.chime));
      l3.append(el('span', 'lbl', 'When full'), chimeSelect(t.chime, (v) => { t.chime = v; saveNow(); preview(v); }), test);

      li.append(head, live, l1, l2, l3);
      list.appendChild(li);
    });

    if (focusKind && focusRole) {
      const target = list.querySelector(`.timer[data-kind="${focusKind}"] [data-role="${focusRole}"]`);
      if (target && !target.disabled) target.focus();
    }
  }

  function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= state.trackers.length) return;
    [state.trackers[i], state.trackers[j]] = [state.trackers[j], state.trackers[i]];
    saveNow();
    renderTrackers();
  }

  function refreshLive() {
    const now = Date.now();
    document.querySelectorAll('#tracker-list .timer').forEach((li) => {
      const t = state.trackers.find((x) => x.kind === li.dataset.kind);
      if (t) li.querySelector('[data-role=live]').textContent = preview_line(t, now);
    });
  }

  // ---- general ---------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    $('opt-weekstart').value = String(state.weekStart);
    $('opt-volume').value = Math.round(state.volume * 100);
    $('out-volume').textContent = Math.round(state.volume * 100) + '%';
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
    $('opt-top').checked = state.alwaysOnTop;
  }

  function bind() {
    $('opt-weekstart').addEventListener('change', (e) => { state.weekStart = Number(e.target.value); saveNow(); });
    $('opt-volume').addEventListener('input', (e) => {
      state.volume = parseInt(e.target.value, 10) / 100;
      $('out-volume').textContent = e.target.value + '%';
      saveSoon();
    });
    $('opt-volume').addEventListener('change', () => preview('coin'));
    $('opt-match').addEventListener('change', (e) => { state.matchWorldTime = e.target.checked; saveNow(); renderAll(); });
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

  function buildGallery() {
    WT.chimes.CHIMES.forEach((c) => {
      const b = el('button', '', '▶ ' + c.name);
      b.type = 'button';
      b.title = c.kind + ' tone · ' + c.bits + '-bit';
      b.appendChild(el('span', 'kind', c.kind));
      b.addEventListener('click', () => preview(c.id));
      $('chime-gallery').appendChild(b);
    });
  }

  function renderAll() {
    renderTrackers();
    renderRest();
  }

  async function refreshWorldTime() {
    const raw = await WT.worldTime.readRaw();
    const next = raw ? WT.worldTime.lookFrom(raw, new Date()) : null;
    const changed = JSON.stringify(next) !== JSON.stringify(wtLook);
    wtLook = next;
    if (changed && state) renderRest();
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
  buildGallery();
  renderAll();
  $('about').textContent = 'Dot Calendar 1.1.0 · works fully offline';
  setInterval(() => { if (!document.hidden) refreshLive(); }, 500);
  setInterval(refreshWorldTime, 3000);
})();
