/* Dot Ticker settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const $ = (id) => document.getElementById(id);
  const STYLES = {
    scroll: { title: 'Classic scroll', desc: 'Every message in one continuous ribbon.' },
    flip: { title: 'Flip board', desc: 'One message at a time: holds, then slides up to the next.' },
    tagged: { title: 'Tagged', desc: 'A fixed tag on the left; messages scroll past it.' },
    board: { title: 'Two-line board', desc: 'A title line on top; messages scroll underneath.' },
    type: { title: 'Typewriter', desc: 'Letters appear one by one, with a blinking cursor.' },
  };
  const DAY_LETTERS = [['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6], ['S', 0]];

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

  // ---- messages -------------------------------------------------------------------
  function renderMessages() {
    const list = $('msg-list');
    const active = document.activeElement;
    const focusId = active && active.closest && active.closest('.timer') ? active.closest('.timer').dataset.id : null;
    const focusRole = active && active.dataset ? active.dataset.role : null;
    list.textContent = '';
    const now = Date.now();
    if (!state.messages.length) list.appendChild(el('li', 'muted', 'No messages yet. Add one above.'));

    state.messages.forEach((m, i) => {
      const li = el('li', 'timer' + (m.enabled ? '' : ' off'));
      li.dataset.id = m.id;
      const head = el('div', 'head');

      const on = el('input');
      on.type = 'checkbox'; on.checked = m.enabled; on.title = 'Show this message';
      on.addEventListener('change', () => { m.enabled = on.checked; saveNow(); renderMessages(); });

      const sw = el('div', 'swatch');
      const color = el('input');
      color.type = 'color'; color.value = m.color || defaultColor(); color.dataset.role = 'color';
      const auto = el('span', 'auto', 'auto');
      auto.hidden = !!m.color;
      color.addEventListener('input', () => { m.color = color.value; auto.hidden = true; saveSoon(); });
      sw.append(color, auto);

      const text = el('input', 'name');
      text.type = 'text'; text.maxLength = 200; text.spellcheck = false; text.value = m.text; text.dataset.role = 'text';
      text.addEventListener('input', () => { m.text = text.value; saveSoon(); refreshLive(); });

      head.append(on, sw, text,
        iconBtn('↺', 'Use the default colour', () => { m.color = null; saveNow(); renderMessages(); }, !m.color),
        iconBtn('▲', 'Move up', () => move(i, -1), i === 0),
        iconBtn('▼', 'Move down', () => move(i, 1), i === state.messages.length - 1),
        iconBtn('✕', 'Delete', () => { state.messages.splice(i, 1); saveNow(); renderMessages(); }));

      const live = el('div', 'tstatus', '');
      live.dataset.role = 'live';

      const l1 = el('div', 'line');
      const urgent = el('label', 'check');
      const u = el('input'); u.type = 'checkbox'; u.checked = m.urgent;
      u.addEventListener('change', () => { m.urgent = u.checked; saveNow(); });
      urgent.append(u, document.createTextNode(' Flash (urgent)'));
      l1.append(urgent);

      const l2 = el('div', 'line');
      l2.append(el('span', 'lbl', 'Show on'));
      const days = el('div', 'days');
      for (const [letter, d] of DAY_LETTERS) {
        const b = el('button', 'day' + (m.schedule.days.includes(d) ? ' on' : ''), letter);
        b.type = 'button';
        b.title = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d];
        b.addEventListener('click', () => {
          const set = new Set(m.schedule.days);
          if (set.has(d)) set.delete(d); else set.add(d);
          m.schedule.days = [...set].sort();
          saveNow(); renderMessages();
        });
        days.appendChild(b);
      }
      const from = el('input'); from.type = 'time'; from.value = m.schedule.from; from.dataset.role = 'from';
      const to = el('input'); to.type = 'time'; to.value = m.schedule.to; to.dataset.role = 'to';
      from.addEventListener('change', () => { m.schedule.from = from.value; saveNow(); refreshLive(); });
      to.addEventListener('change', () => { m.schedule.to = to.value; saveNow(); refreshLive(); });
      const clear = el('button', 'ctl', 'Always');
      clear.type = 'button';
      clear.title = 'Clear the schedule';
      clear.addEventListener('click', () => { m.schedule = { days: [], from: '', to: '' }; saveNow(); renderMessages(); });
      l2.append(days, el('span', 'lbl', 'from'), from, el('span', 'lbl', 'to'), to, clear);

      const l3 = el('div', 'line');
      const test = el('button', 'ctl', '▶ Test');
      test.type = 'button';
      test.addEventListener('click', () => preview(m.chime === 'none' ? 'coin' : m.chime));
      l3.append(el('span', 'lbl', 'Chime when it starts'), chimeSelect(m.chime, (v) => { m.chime = v; saveNow(); preview(v); }), test);

      li.append(head, live, l1, l2, l3);
      list.appendChild(li);
    });
    if (focusId && focusRole) {
      const t = list.querySelector(`.timer[data-id="${CSS.escape(focusId)}"] [data-role="${focusRole}"]`);
      if (t) t.focus();
    }
    refreshLive(now);
    $('add-text').disabled = state.messages.length >= WT.store.MAX_MESSAGES;
  }

  function refreshLive(now) {
    now = now || Date.now();
    document.querySelectorAll('#msg-list .timer').forEach((li) => {
      const m = state.messages.find((x) => x.id === li.dataset.id);
      if (!m) return;
      const showing = WT.ticker.isActive(m, now);
      const shown = WT.ticker.fill(m.text, now, state.use24h).toUpperCase();
      li.querySelector('[data-role=live]').textContent = (showing ? 'Showing now · ' : (m.enabled ? 'Scheduled, not showing now · ' : 'Off · ')) + shown;
    });
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.messages.length) return;
    [state.messages[i], state.messages[j]] = [state.messages[j], state.messages[i]];
    saveNow(); renderMessages();
  }

  // ---- styles -----------------------------------------------------------------------
  function renderStyles() {
    const list = $('style-list');
    list.textContent = '';
    state.styles.forEach((s, i) => {
      const info = STYLES[s.id];
      const li = el('li', 'timer' + (s.enabled ? '' : ' off'));
      const head = el('div', 'head');
      const title = el('label', 'ptitle-strong', info.title);
      const on = el('input'); on.type = 'checkbox'; on.checked = s.enabled;
      on.addEventListener('change', () => { s.enabled = on.checked; saveNow(); renderStyles(); });
      title.prepend(on);
      const spacer = el('span'); spacer.style.flex = '1';
      head.append(title, spacer,
        iconBtn('▲', 'Move up', () => moveStyle(i, -1), i === 0),
        iconBtn('▼', 'Move down', () => moveStyle(i, 1), i === state.styles.length - 1));
      li.append(head, el('div', 'summary', info.desc));
      if (s.id === 'tagged' || s.id === 'board') {
        const line = el('div', 'line');
        const key = s.id === 'tagged' ? 'tag' : 'title';
        const ckey = s.id === 'tagged' ? 'tagColor' : 'titleColor';
        const inp = el('input', 'grow');
        inp.type = 'text'; inp.value = s[key]; inp.maxLength = s.id === 'tagged' ? 16 : 60; inp.spellcheck = false;
        inp.addEventListener('input', () => { s[key] = inp.value; saveSoon(); });
        const c = el('input'); c.type = 'color'; c.value = s[ckey];
        c.addEventListener('input', () => { s[ckey] = c.value; saveSoon(); });
        line.append(el('span', 'lbl', s.id === 'tagged' ? 'Tag' : 'Title'), inp, c);
        li.appendChild(line);
      }
      list.appendChild(li);
    });
  }
  function moveStyle(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.styles.length) return;
    [state.styles[i], state.styles[j]] = [state.styles[j], state.styles[i]];
    saveNow(); renderStyles();
  }

  // ---- motion / appearance ----------------------------------------------------------
  const matched = () => !!(state.matchWorldTime && wtLook);

  function renderRest() {
    $('opt-speed').value = state.speed;
    $('out-speed').textContent = state.speed + ' dots/s';
    document.querySelector(`input[name=dir][value="${state.direction}"]`).checked = true;
    $('opt-hold').value = state.holdSeconds;
    $('out-hold').textContent = state.holdSeconds + ' s';
    $('opt-sep').value = state.separator;
    $('opt-pause').checked = state.pauseOnHover;
    document.querySelector(`input[name=fmt][value="${state.use24h ? 24 : 12}"]`).checked = true;
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
    $('add-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('add-text').value.trim();
      if (!v || state.messages.length >= WT.store.MAX_MESSAGES) return;
      state.messages.push(WT.store.newMessage(v));
      $('add-text').value = '';
      saveNow(); renderMessages();
    });
    $('opt-speed').addEventListener('input', (e) => { state.speed = Number(e.target.value); $('out-speed').textContent = state.speed + ' dots/s'; saveSoon(); });
    document.querySelectorAll('input[name=dir]').forEach((r) => r.addEventListener('change', () => { state.direction = r.value; saveNow(); }));
    $('opt-hold').addEventListener('input', (e) => { state.holdSeconds = Number(e.target.value); $('out-hold').textContent = state.holdSeconds + ' s'; saveSoon(); });
    $('opt-sep').addEventListener('input', (e) => { state.separator = e.target.value; saveSoon(); });
    $('opt-pause').addEventListener('change', (e) => { state.pauseOnHover = e.target.checked; saveNow(); });
    document.querySelectorAll('input[name=fmt]').forEach((r) => r.addEventListener('change', () => { state.use24h = r.value === '24'; saveNow(); refreshLive(); }));
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

  function renderAll() { renderMessages(); renderStyles(); renderRest(); }

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
  $('about').textContent = 'Dot Ticker 1.1.0 · works fully offline';
  setInterval(() => { if (!document.hidden) refreshLive(); }, 15000);
  setInterval(refreshWorldTime, 3000);
})();
