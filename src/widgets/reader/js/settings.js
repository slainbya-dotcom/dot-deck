/* Dot Reader settings window. */
(async function () {
  'use strict';
  const WT = window.WT;
  const $ = (id) => document.getElementById(id);

  let state = null;
  let early = null;
  let saveTimer = null;

  function saveNow() { clearTimeout(saveTimer); saveTimer = null; WT.store.save(state).catch(console.error); }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }

  function render() {
    $('opt-home').value = state.home === 'dot:welcome' ? '' : state.home;
    $('btn-home-last').disabled = !state.last;
    $('opt-remember').checked = state.rememberLast;
    $('opt-w').value = state.W; $('out-w').textContent = state.W + ' dots';
    $('opt-h').value = state.H; $('out-h').textContent = state.H + ' dots';
    $('opt-size').value = state.dotSize; $('out-size').textContent = state.dotSize + ' px';
    note();
    $('opt-color').value = state.color;
    $('opt-text').value = state.textColor;
    document.querySelector(`input[name=shape][value="${state.dotShape}"]`).checked = true;
    $('opt-unlit').checked = state.showUnlit;
    $('opt-bg').value = state.bgColor;
    $('opt-opacity').value = Math.round(state.bgOpacity * 100);
    $('out-opacity').textContent = state.bgOpacity === 0 ? 'Transparent' : Math.round(state.bgOpacity * 100) + '%';
    $('opt-top').checked = state.alwaysOnTop;
  }
  function note() {
    // Roughly how much text fits: ~6 dots per character, 11 per line.
    const chars = Math.floor((state.W - 10) / 6), lines = Math.floor((state.H - 31) / 11);
    $('size-note').textContent = `About ${chars} letters per line and ${lines} lines of text, ${state.W * state.dotSize} × ${state.H * state.dotSize} pixels on screen.`;
  }

  function bind() {
    const setHome = () => {
      const v = $('opt-home').value.trim();
      state.home = v ? WT.store.normalizeUrl(v) || state.home : 'dot:welcome';
      saveNow(); render();
    };
    $('opt-home').addEventListener('change', setHome);
    $('opt-home').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setHome(); } });
    $('btn-home-last').addEventListener('click', () => { if (state.last) { state.home = state.last; saveNow(); render(); } });
    $('opt-remember').addEventListener('change', (e) => { state.rememberLast = e.target.checked; saveNow(); });
    $('opt-w').addEventListener('input', (e) => { state.W = parseInt(e.target.value, 10); $('out-w').textContent = state.W + ' dots'; note(); saveSoon(); });
    $('opt-h').addEventListener('input', (e) => { state.H = parseInt(e.target.value, 10); $('out-h').textContent = state.H + ' dots'; note(); saveSoon(); });
    $('opt-size').addEventListener('input', (e) => { state.dotSize = parseInt(e.target.value, 10); $('out-size').textContent = state.dotSize + ' px'; note(); saveSoon(); });
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const [c, t] = b.dataset.preset.split(',');
      state.color = c; state.textColor = t;
      saveNow(); render();
    }));
    $('opt-color').addEventListener('input', (e) => { state.color = e.target.value; saveSoon(); });
    $('opt-text').addEventListener('input', (e) => { state.textColor = e.target.value; saveSoon(); });
    document.querySelectorAll('input[name=shape]').forEach((r) => r.addEventListener('change', () => { state.dotShape = r.value; saveNow(); }));
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

  await WT.store.subscribe((s, own) => {
    if (!state) { early = s; return; }
    if (own) return;
    state = s;
    render();
  });
  state = await WT.store.load();
  if (early) state = early;
  bind();
  render();
  $('about').textContent = 'Dot Reader 1.0.0 · reading mode by Mozilla Readability';
})();
