/* Dot Dice settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const X = WT.dice;
  const $ = (id) => document.getElementById(id);

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
  const dieColour = (id) => (state.colorMode === 'one' ? (matched() ? wtLook.dotColor : state.dotColor) : state.colors[id]);
  const setStatus = (msg, error) => { $('saved-status').textContent = msg || ''; $('saved-status').classList.toggle('error', !!error); };

  // ---- saved rolls ------------------------------------------------------------------------
  function renderSaved() {
    const list = $('saved-list');
    // Keep the cursor where it was if the list is redrawn while typing.
    const a = document.activeElement;
    const focus = a && a.closest && a.closest('.saved') ? { id: a.closest('.saved').dataset.id, role: a.dataset.role, pos: a.selectionStart } : null;
    list.textContent = '';
    state.saved.forEach((r, i) => {
      const li = el('li', 'saved');
      li.dataset.id = r.id;
      const top = el('div', 'line');
      const name = el('input', 'label'); name.type = 'text'; name.maxLength = 16; name.value = r.label; name.placeholder = 'Label'; name.dataset.role = 'label';
      name.title = 'Shown on the widget (about 8 letters fit)';
      name.addEventListener('input', () => { r.label = name.value; saveSoon(); });
      const f = el('span', 'formula', X.formula(r.counts, r.mod) || 'No dice yet');
      const mode = el('select'); mode.dataset.role = 'mode';
      [['sum', 'Add together'], ['each', 'Show each']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; mode.appendChild(o); });
      mode.value = r.mode;
      mode.addEventListener('change', () => { r.mode = mode.value; saveNow(); });
      top.append(name, f, mode,
        iconBtn('▲', 'Move up', () => move(i, -1), i === 0),
        iconBtn('▼', 'Move down', () => move(i, 1), i === state.saved.length - 1),
        iconBtn('✕', 'Remove', () => { state.saved.splice(i, 1); saveNow(); renderSaved(); }));

      const dice = el('div', 'line');
      const update = () => { f.textContent = X.formula(r.counts, r.mod) || 'No dice yet'; saveSoon(); };
      for (const d of X.DICE) {
        const l = el('label', 'die');
        l.style.color = dieColour(d.id);
        const n = el('input'); n.type = 'number'; n.min = 0; n.max = X.MAX; n.value = r.counts[d.id] || 0; n.dataset.role = d.id;
        n.addEventListener('input', () => {
          let v = Math.max(0, Math.min(X.MAX, parseInt(n.value, 10) || 0));
          const others = X.count(r.counts) - (r.counts[d.id] || 0);
          if (others + v > X.MAX) { v = X.MAX - others; setStatus('Up to ' + X.MAX + ' dice in one roll.', true); } else setStatus('');
          r.counts[d.id] = v;
          if (String(v) !== n.value && n.value !== '') n.value = v;
          update();
        });
        l.append(document.createTextNode(d.label.toLowerCase()), n);
        dice.appendChild(l);
      }
      const ml = el('label', 'die', 'modifier');
      const m = el('input'); m.type = 'number'; m.min = -99; m.max = 99; m.value = r.mod; m.dataset.role = 'mod';
      m.title = 'A flat number added to the roll, e.g. 3 or -1';
      m.addEventListener('input', () => { r.mod = Math.max(-99, Math.min(99, parseInt(m.value, 10) || 0)); update(); });
      ml.appendChild(m);
      dice.appendChild(ml);
      li.append(top, dice);
      list.appendChild(li);
    });
    if (!state.saved.length) list.appendChild(el('li', 'muted', 'No saved rolls yet. Add one below, or pick dice on the widget and click “Save the dice in the pool”.'));
    $('btn-add').disabled = state.saved.length >= X.MAX_SAVED;
    $('btn-from-pool').disabled = state.saved.length >= X.MAX_SAVED || !X.count(state.pool);
    $('btn-from-pool').title = X.count(state.pool) ? 'Adds ' + X.formula(state.pool, 0) + ' as a saved roll' : 'Pick some dice on the widget first';
    if (focus) {
      const e = list.querySelector(`.saved[data-id="${CSS.escape(focus.id)}"] [data-role="${focus.role}"]`);
      if (e) { e.focus(); try { if (focus.pos !== null && focus.pos !== undefined) e.setSelectionRange(focus.pos, focus.pos); } catch (err) { /* number inputs */ } }
    }
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.saved.length) return;
    [state.saved[i], state.saved[j]] = [state.saved[j], state.saved[i]];
    saveNow(); renderSaved();
  }

  function addSaved(o) {
    if (state.saved.length >= X.MAX_SAVED) { setStatus('Up to ' + X.MAX_SAVED + ' saved rolls. Remove one to add another.', true); return; }
    state.saved.push(WT.store.newSaved(o));
    setStatus('');
    saveNow(); renderSaved();
    const inputs = document.querySelectorAll('#saved-list .label');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  }

  // ---- sounds + colours ----------------------------------------------------------------------
  function soundSelect(value, withRattle, onChange) {
    const sel = el('select');
    const none = el('option', '', 'No sound'); none.value = 'none'; sel.appendChild(none);
    if (withRattle) { const r = el('option', '', 'Dice rattle'); r.value = 'rattle'; sel.appendChild(r); }
    for (const kind of ['Hi', 'Dual', 'Lo']) {
      const og = document.createElement('optgroup');
      og.label = kind + ' tones';
      WT.chimes.CHIMES.filter((c) => c.kind === kind).forEach((c) => {
        const o = el('option', '', c.name + ' (' + c.bits + '-bit)'); o.value = c.id; og.appendChild(o);
      });
      sel.appendChild(og);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  function preview(id) {
    WT.chimes.unlock();
    if (id === 'rattle') WT.chimes.rattle(state.volume, 3);
    else if (id && id !== 'none') WT.chimes.play(id, state.volume);
  }

  function renderColours() {
    const box = $('die-colours');
    box.textContent = '';
    box.classList.toggle('off', state.colorMode === 'one');
    for (const d of X.DICE) {
      const l = el('label', '', d.label.toLowerCase());
      const c = el('input'); c.type = 'color'; c.value = state.colors[d.id]; c.disabled = state.colorMode === 'one';
      c.addEventListener('input', () => { state.colors[d.id] = c.value; saveSoon(); });
      l.appendChild(c);
      box.appendChild(l);
    }
    box.appendChild(iconBtn('↺', 'Back to the standard colours', () => {
      for (const d of X.DICE) state.colors[d.id] = d.color;
      saveNow(); renderColours(); renderSaved();
    }, state.colorMode === 'one'));
  }

  // ---- the rest -------------------------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    $('opt-view-dice').checked = state.views.dice;
    $('opt-view-saved').checked = state.views.saved;
    $('slot-sound').textContent = '';
    $('slot-sound').appendChild(soundSelect(state.sound, true, (v) => { state.sound = v; saveNow(); preview(v); }));
    $('slot-crit').textContent = '';
    $('slot-crit').appendChild(soundSelect(state.critSound, false, (v) => { state.critSound = v; saveNow(); preview(v); }));
    $('opt-volume').value = Math.round(state.volume * 100);
    $('out-volume').textContent = Math.round(state.volume * 100) + '%';
    $('opt-crits').checked = state.crits;
    document.querySelector(`input[name=cmode][value="${state.colorMode}"]`).checked = true;
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
    $('opt-view-dice').addEventListener('change', (e) => { state.views.dice = e.target.checked; saveNow(); });
    $('opt-view-saved').addEventListener('change', (e) => { state.views.saved = e.target.checked; saveNow(); });
    $('btn-add').addEventListener('click', () => addSaved({ label: 'New roll', counts: { d20: 1 }, mod: 0, mode: 'sum' }));
    $('btn-from-pool').addEventListener('click', () => addSaved({ label: 'My roll', counts: state.pool, mod: 0, mode: state.mode }));
    $('test-sound').addEventListener('click', () => preview(state.sound === 'none' ? 'rattle' : state.sound));
    $('opt-volume').addEventListener('input', (e) => { state.volume = parseInt(e.target.value, 10) / 100; $('out-volume').textContent = e.target.value + '%'; saveSoon(); });
    $('opt-volume').addEventListener('change', () => preview(state.sound === 'none' ? 'rattle' : state.sound));
    $('opt-crits').addEventListener('change', (e) => { state.crits = e.target.checked; saveNow(); });
    document.querySelectorAll('input[name=cmode]').forEach((r) => r.addEventListener('change', () => { state.colorMode = r.value; saveNow(); renderColours(); renderSaved(); }));
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

  function renderAll() { renderSaved(); renderColours(); renderRest(); }

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
    // The widget saves the pool on every click; only redraw what depends on it.
    const onlyPool = JSON.stringify(Object.assign({}, s, { pool: 0, mode: 0 })) === JSON.stringify(Object.assign({}, state, { pool: 0, mode: 0 }));
    state = s;
    if (onlyPool) renderSaved(); else renderAll();
  });
  state = await WT.store.load();
  if (early) state = early;
  await refreshWorldTime();
  bind();
  renderAll();
  $('about').textContent = 'Dot Dice 1.0.0 · works fully offline';
  setInterval(refreshWorldTime, 3000);
})();
