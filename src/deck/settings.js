/* Dot Deck settings window: the sidebar, Widgets / Layout / Look & scale, and each
 * widget's own settings page (shown in a frame below a small Deck header). */
(async function () {
  'use strict';
  const T = window.__TAURI__;
  const invoke = (cmd, args) => T.core.invoke(cmd, args || {});
  const $ = (id) => document.getElementById(id);
  const DESC = {
    clock: 'World clocks with sun and moon', timer: 'Countdowns with chimes', focus: 'Focus and break cycles',
    calendar: 'Day, week, month and year progress', sun: 'Sunrise, sunset and the moon', ticker: 'Your own scrolling messages',
    planner: 'Meeting-friendly hours across cities', system: 'CPU, memory, disk, network, battery', player: 'Now playing and sound controls',
    weather: 'Forecasts from Open-Meteo', dice: 'Dice roller and saved rolls', visualiser: 'Moves with your music',
    list: 'A to-do checklist', launcher: 'Apps, files, folders and websites', clipboard: 'Your copy history', reader: 'Read web pages in dots',
  };

  let status = null;
  let tab = window.__DECK_START_TAB__ || 'widgets';   // previews can start on another tab
  const frames = {};

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function toggle(on, onChange, title) {
    const l = el('label', 'switch');
    if (title) l.title = title;
    const c = el('input'); c.type = 'checkbox'; c.checked = !!on;
    c.addEventListener('change', () => onChange(c.checked));
    l.append(c, el('i'));
    return l;
  }
  const widget = (id) => status.widgets.find((w) => w.id === id);
  const pct = (v) => Math.round(v * 100) + '%';

  async function refresh() {
    try { status = await invoke('deck_status'); } catch (e) { console.error('deck_status', e); return; }
    render();
  }

  // ---- sidebar ----
  function renderSide() {
    const side = $('side');
    side.textContent = '';
    side.appendChild(el('div', 'brand', 'Dot Deck'));
    const add = (id, label, w) => {
      const b = el('button', (tab === id ? 'on' : '') + (w && !w.enabled ? ' off' : ''));
      if (w) b.appendChild(el('span', 'dot' + (w.enabled ? ' lit' : '')));
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', () => go(id));
      side.appendChild(b);
    };
    add('widgets', 'Widgets'); add('layout', 'Layout'); add('look', 'Look & scale');
    side.appendChild(el('div', 'sep'));
    side.appendChild(el('div', 'group', 'Widgets'));
    for (const w of status.widgets) add(w.id, w.name, w);
  }

  function go(id) {
    tab = id;
    render();
  }

  // ---- Widgets ----
  function renderWidgets() {
    const list = $('widget-list');
    list.textContent = '';
    for (const w of status.widgets) {
      const li = el('li');
      const text = el('div', 'text');
      text.append(el('div', 'name', 'Dot ' + w.name), el('div', 'desc', DESC[w.id] || ''));
      const open = el('button', 'link', 'Settings ›');
      open.addEventListener('click', () => go(w.id));
      li.append(toggle(w.enabled, (on) => setEnabled(w.id, on), w.enabled ? 'Switch off' : 'Switch on'), text, open);
      list.appendChild(li);
    }
    $('btn-import-all').disabled = !status.widgets.some((w) => w.importable);
    $('btn-import-all').title = $('btn-import-all').disabled ? 'None of the separate Dot apps have saved settings on this computer' : 'Copies cities, timers, tasks and so on from the separate Dot apps';
  }
  async function setEnabled(id, on) {
    const w = widget(id);
    if (w) w.enabled = on;
    render();
    await invoke('deck_set_enabled', { id, on }).catch(console.error);
    refresh();
  }

  // ---- Layout ----
  function renderLayout() {
    const list = $('setup-list');
    list.textContent = '';
    for (const s of status.setups) {
      const li = el('li');
      const nm = el('div', 'nm');
      const input = el('input'); input.type = 'text'; input.value = s.name; input.title = 'Rename this setup';
      input.addEventListener('change', () => invoke('deck_setup', { key: s.key, action: 'rename', name: input.value }).then(refresh));
      nm.appendChild(input);
      li.appendChild(nm);
      if (s.current) li.appendChild(el('span', 'tag', 'In use now'));
      li.appendChild(el('span', 'meta', s.widgets + (s.widgets === 1 ? ' widget placed' : ' widgets placed')));
      const reset = el('button', 'link', 'Reset');
      reset.title = s.current ? 'Forget where everything goes on this setup and line them up in a column' : 'Forget where everything goes on this setup';
      reset.addEventListener('click', () => invoke('deck_setup', { key: s.key, action: 'reset' }).then(refresh));
      li.appendChild(reset);
      if (!s.current) {
        const forget = el('button', 'link', 'Remove');
        forget.addEventListener('click', () => invoke('deck_setup', { key: s.key, action: 'forget' }).then(refresh));
        li.appendChild(forget);
      }
      list.appendChild(li);
    }
    if (!status.setups.length) list.appendChild(el('li', 'muted', 'None yet: they appear as you use Dot Deck on different screens.'));
    $('opt-arrange').checked = status.arrange;
    $('opt-snap').checked = status.snap;
    $('opt-lock').checked = status.lock;
    $('opt-hidden').checked = status.hidden;
  }

  // ---- Look & scale ----
  function renderLook() {
    if (document.activeElement !== $('opt-scale')) $('opt-scale').value = Math.round(status.scale * 100);
    $('out-scale').textContent = pct(status.scale);
    const list = $('scale-list');
    list.textContent = '';
    const own = status.widgets.filter((w) => Math.abs(w.scale - 1) > 0.001);
    for (const w of own) {
      const li = el('li');
      li.append(el('span', '', 'Dot ' + w.name), el('span', 'muted', pct(w.scale)));
      const b = el('button', 'link', 'Same as the rest');
      b.addEventListener('click', () => invoke('deck_set_scale', { id: w.id, scale: 1 }).then(refresh));
      li.appendChild(b);
      list.appendChild(li);
    }
    if (!own.length) list.appendChild(el('li', 'muted', 'None: every widget uses the scale above.'));
  }

  // ---- one widget ----
  function frameFor(id) {
    if (frames[id]) return frames[id];
    const f = el('iframe');
    f.title = 'Dot ' + widget(id).name + ' settings';
    f.setAttribute('allow', 'geolocation; clipboard-read; clipboard-write; autoplay');
    if (window.__DECK_FRAME_SRC__) window.__DECK_FRAME_SRC__(f, id);   // previews fill it in themselves
    else f.src = '../widgets/' + id + '/settings.html';
    $('frames').appendChild(f);
    frames[id] = f;
    return f;
  }
  function renderWidget(id) {
    const w = widget(id);
    $('w-title').textContent = 'Dot ' + w.name;
    $('w-on').checked = w.enabled;
    $('w-off').hidden = w.enabled;
    $('w-find').disabled = !w.enabled;
    $('w-import').hidden = !w.importable;
    $('w-import').textContent = 'Copy from Dot ' + w.name;
    if (armedReset && armedReset.id !== id) disarmReset();
    if (document.activeElement !== $('w-scale')) $('w-scale').value = Math.round(w.scale * 100);
    $('w-scale-out').textContent = Math.abs(w.scale - 1) < 0.001 ? 'same as the rest' : pct(w.scale);
    const f = frameFor(id);
    for (const [k, x] of Object.entries(frames)) x.hidden = k !== id;
    return f;
  }

  function render() {
    if (!status) return;
    renderSide();
    const isWidget = !!widget(tab);
    for (const p of ['widgets', 'layout', 'look']) $('tab-' + p).hidden = tab !== p;
    $('tab-widget').hidden = !isWidget;
    if (tab === 'widgets') renderWidgets();
    else if (tab === 'layout') renderLayout();
    else if (tab === 'look') renderLook();
    else if (isWidget) renderWidget(tab);
  }

  // Two clicks (no pop-up dialogs) for anything that replaces a widget's settings.
  let armedReset = null;
  function disarmReset() {
    if (armedReset) clearTimeout(armedReset.timer);
    armedReset = null;
    $('w-reset').textContent = 'Reset';
  }
  function widgetNote(text) {
    $('w-status').textContent = text;
    $('w-status').hidden = !text;
    clearTimeout(widgetNote.t);
    widgetNote.t = setTimeout(() => { $('w-status').hidden = true; }, 5000);
  }

  // ---- wiring ----
  function bind() {
    $('w-reset').addEventListener('click', async () => {
      const id = tab;
      if (!armedReset) {
        $('w-reset').textContent = 'Click again to reset';
        armedReset = { id, timer: setTimeout(disarmReset, 5000) };
        return;
      }
      disarmReset();
      await invoke('deck_reset_widget', { id }).catch(console.error);
      widgetNote('Dot ' + widget(id).name + ' is back to how it starts.');
    });
    $('w-import').addEventListener('click', async () => {
      const id = tab;
      const done = await invoke('deck_import', { ids: [id] }).catch(() => []);
      widgetNote(done.length ? 'Copied Dot ' + widget(id).name + '’s settings from its app.' : 'Nothing to copy.');
    });
    $('btn-quit').addEventListener('click', () => invoke('deck_quit'));
    // Two clicks (no pop-up dialogs): it replaces those widgets' settings in Dot Deck.
    let armed = null;
    $('btn-import-all').addEventListener('click', async () => {
      const b = $('btn-import-all');
      if (!armed) {
        const names = status.widgets.filter((w) => w.importable).map((w) => w.name).join(', ');
        b.textContent = 'Click again to copy: replaces ' + names + ' in Dot Deck';
        armed = setTimeout(() => { armed = null; b.textContent = 'Copy settings from the separate apps…'; }, 6000);
        return;
      }
      clearTimeout(armed); armed = null;
      b.textContent = 'Copy settings from the separate apps…';
      const done = await invoke('deck_import', { ids: [] }).catch(() => []);
      $('import-status').textContent = done.length ? 'Copied settings for ' + done.length + (done.length === 1 ? ' widget.' : ' widgets.') : 'Nothing to copy.';
      refresh();
    });
    for (const [name, elId] of [['arrange', 'opt-arrange'], ['snap', 'opt-snap'], ['lock', 'opt-lock']]) {
      $(elId).addEventListener('change', (e) => invoke('deck_set_option', { name, value: e.target.checked }).then(refresh));
    }
    $('opt-hidden').addEventListener('change', (e) => invoke('deck_set_hidden', { hidden: e.target.checked }).then(refresh));
    $('btn-tidy-here').addEventListener('click', () => invoke('deck_tidy', { here: true }).then(refresh));
    $('btn-tidy-main').addEventListener('click', () => invoke('deck_tidy', { here: false }).then(refresh));
    let scaleTimer = null;
    $('opt-scale').addEventListener('input', (e) => {
      const v = Number(e.target.value) / 100;
      $('out-scale').textContent = pct(v);
      status.scale = v;
      clearTimeout(scaleTimer);
      scaleTimer = setTimeout(() => invoke('deck_set_scale', { scale: v }), 120);
    });
    $('opt-scale').addEventListener('change', refresh);
    $('w-on').addEventListener('change', (e) => setEnabled(tab, e.target.checked));
    let wTimer = null;
    $('w-scale').addEventListener('input', (e) => {
      const v = Number(e.target.value) / 100, id = tab;
      const w = widget(id); if (w) w.scale = v;
      $('w-scale-out').textContent = Math.abs(v - 1) < 0.001 ? 'same as the rest' : pct(v);
      clearTimeout(wTimer);
      wTimer = setTimeout(() => invoke('deck_set_scale', { id, scale: v }), 120);
    });
    $('w-find').addEventListener('click', () => invoke('recenter_widget', { app: tab }));
    document.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.goto); }));
  }

  if (!T || !T.core) { document.body.textContent = 'Dot Deck settings need the Dot Deck app.'; return; }
  await T.event.listen('deck-changed', refresh);
  await T.event.listen('deck-open', (e) => { const id = String(e.payload || ''); if (id) go(id); });
  bind();
  await refresh();
  window.DeckSettings = { go, refresh };
})();
