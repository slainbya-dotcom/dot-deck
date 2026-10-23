/* Dot Focus settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const F = WT.focus;
  const $ = (id) => document.getElementById(id);
  const PHASE_TITLES = { focus: 'Focus', break: 'Break', long: 'Long break' };

  let state = null;
  let early = null;
  let saveTimer = null;
  let wtLook = null;

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    WT.store.save(state).catch((e) => { $('cycle-status').textContent = 'Could not save settings: ' + e; });
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

  const fmt = (L) => [L.h && L.h + ' h', L.mi && L.mi + ' min', L.s && L.s + ' s'].filter(Boolean).join(' ');

  /** A changed length can't apply to a phase that's already under way. */
  function lengthChanged(phase) {
    const c = state.cycle;
    if (c.phase === phase && (c.status === 'running' || c.status === 'paused')) {
      c.status = 'idle'; c.endAt = null; c.remainingMs = null; c.totalMs = 0;
    }
  }

  // ---- phase rows (name, length, colour) --------------------------------------
  function renderPhases() {
    const box = $('phase-rows');
    const active = document.activeElement;
    const focusRole = active && active.dataset ? active.dataset.role : null;
    box.textContent = '';
    for (const p of F.PHASES) {
      const row = el('div', 'phase' + (p === 'long' && !state.longEnabled ? ' off' : ''));
      row.append(el('span', 'ptitle', PHASE_TITLES[p]));

      const color = el('input');
      color.type = 'color';
      color.value = state.colors[p];
      color.dataset.role = 'color-' + p;
      color.title = PHASE_TITLES[p] + ' colour';
      color.disabled = state.colorMode !== 'each';
      color.addEventListener('input', () => { state.colors[p] = color.value; saveSoon(); });

      const name = el('input', 'pname');
      name.type = 'text';
      name.maxLength = 24;
      name.spellcheck = false;
      name.value = state.names[p];
      name.dataset.role = 'name-' + p;
      name.setAttribute('aria-label', PHASE_TITLES[p] + ' name on the widget');
      name.addEventListener('input', () => { if (name.value.trim()) { state.names[p] = name.value.trim(); saveSoon(); } });
      name.addEventListener('change', () => { if (!name.value.trim()) name.value = state.names[p]; });

      const units = el('div', 'units');
      const summary = el('span', 'summary', fmt(state.lengths[p]));
      for (const [u, label, max] of [['h', 'hrs', 23], ['mi', 'mins', 999], ['s', 'secs', 59]]) {
        const l = el('label');
        const inp = el('input');
        inp.type = 'number';
        inp.min = '0';
        inp.max = String(max);
        inp.value = state.lengths[p][u];
        inp.dataset.role = 'len-' + p + '-' + u;
        inp.setAttribute('aria-label', PHASE_TITLES[p] + ' ' + label);
        inp.addEventListener('input', () => {
          const v = inp.value === '' ? 0 : Number(inp.value);
          const ok = Number.isInteger(v) && v >= 0 && v <= max;
          inp.classList.toggle('bad', !ok);
          if (!ok) return;
          const next = Object.assign({}, state.lengths[p], { [u]: v });
          if (!next.h && !next.mi && !next.s) {
            summary.textContent = 'Must be longer than zero';
            summary.classList.add('bad');
            return;
          }
          summary.classList.remove('bad');
          summary.textContent = fmt(next);
          state.lengths[p] = next;
          lengthChanged(p);
          saveSoon();
        });
        l.append(inp, document.createTextNode(label));
        units.appendChild(l);
      }
      row.append(color, name, units, summary);
      box.appendChild(row);
    }
    if (focusRole) {
      const t = box.querySelector(`[data-role="${focusRole}"]`);
      if (t && !t.disabled) t.focus();
    }
  }

  // ---- "Now" card --------------------------------------------------------------
  function renderNow() {
    const c = state.cycle, now = Date.now();
    const name = PHASE_TITLES[c.phase];
    const round = c.phase === 'focus' ? ` · round ${c.round + 1}${state.longEnabled ? ' of ' + state.longEvery : ''}` : '';
    $('now-phase').textContent = name + round;
    const t = F.readout(c, state, now);
    $('now-meta').textContent = {
      running: t + ' left',
      paused: 'Paused · ' + t + ' left',
      waiting: 'Waiting for you · ' + t,
      idle: 'Ready · ' + t,
    }[c.status];
    $('btn-play').textContent = c.status === 'running' ? 'Pause' : c.status === 'paused' ? 'Resume' : 'Start';
    $('btn-skip').textContent = 'Skip to ' + PHASE_TITLES[F.nextPhase(state, c).phase].toLowerCase();
  }

  // ---- other controls ------------------------------------------------------------
  function chimeSelect(value, onChange) {
    const sel = el('select');
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
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function preview(id) {
    WT.chimes.unlock();
    if (id && id !== 'none') WT.chimes.play(id, state.volume);
  }

  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    $('opt-long').checked = state.longEnabled;
    $('opt-every').value = state.longEvery;
    $('opt-every').disabled = !state.longEnabled;
    $('opt-next').value = state.next;
    $('opt-bar').value = state.barMode;
    document.querySelector(`input[name=cmode][value="${state.colorMode}"]`).checked = true;
    $('opt-finish').value = state.finish;
    $('opt-volume').value = Math.round(state.volume * 100);
    $('out-volume').textContent = Math.round(state.volume * 100) + '%';

    $('slot-chime-focus').textContent = '';
    $('slot-chime-focus').appendChild(chimeSelect(state.chimes.focus, (v) => { state.chimes.focus = v; saveNow(); preview(v); }));
    $('slot-chime-break').textContent = '';
    $('slot-chime-break').appendChild(chimeSelect(state.chimes.break, (v) => { state.chimes.break = v; saveNow(); preview(v); }));

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
    $('btn-play').addEventListener('click', () => { WT.chimes.unlock(); F.toggle(state.cycle, state, Date.now()); saveNow(); renderNow(); });
    $('btn-skip').addEventListener('click', () => { F.skip(state.cycle, state, Date.now()); saveNow(); renderNow(); });
    $('btn-reset').addEventListener('click', () => { F.reset(state.cycle); saveNow(); renderNow(); });

    $('opt-long').addEventListener('change', (e) => {
      state.longEnabled = e.target.checked;
      if (!state.longEnabled && state.cycle.phase === 'long' && state.cycle.status !== 'running') state.cycle.phase = 'focus';
      saveNow(); renderAll();
    });
    $('opt-every').addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (!Number.isInteger(v) || v < 2 || v > 12) return;
      state.longEvery = v;
      if (state.cycle.round >= v) state.cycle.round = 0;
      saveSoon(); renderNow();
    });
    $('opt-next').addEventListener('change', (e) => { state.next = e.target.value; saveNow(); });
    $('opt-bar').addEventListener('change', (e) => { state.barMode = e.target.value; saveNow(); });
    document.querySelectorAll('input[name=cmode]').forEach((r) => r.addEventListener('change', () => {
      state.colorMode = r.value; saveNow(); renderPhases();
    }));
    $('opt-finish').addEventListener('change', (e) => { state.finish = e.target.value; saveNow(); });
    $('test-focus').addEventListener('click', () => preview(state.chimes.focus));
    $('test-break').addEventListener('click', () => preview(state.chimes.break));
    $('opt-volume').addEventListener('input', (e) => {
      state.volume = parseInt(e.target.value, 10) / 100;
      $('out-volume').textContent = e.target.value + '%';
      saveSoon();
    });
    $('opt-volume').addEventListener('change', () => preview(state.chimes.focus));

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
    renderPhases();
    renderNow();
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
    // The widget saves on every phase change; only the "Now" card needs a full
    // refresh then, so typing in the other fields isn't interrupted.
    const onlyCycle = JSON.stringify(Object.assign({}, s, { cycle: 0 })) === JSON.stringify(Object.assign({}, state, { cycle: 0 }));
    state = s;
    if (onlyCycle) renderNow(); else renderAll();
  });
  state = await WT.store.load();
  if (early) state = early;
  await refreshWorldTime();

  bind();
  buildGallery();
  renderAll();
  $('about').textContent = 'Dot Focus 1.1.0 · works fully offline';
  setInterval(() => { if (!document.hidden) renderNow(); }, 500);
  setInterval(refreshWorldTime, 3000);
})();
