// Dot Deck tests (Node, no browser needed): `npm test`
//  1. Deck's own pieces: the bridge, the widget list, the copied pages.
//  2. Every widget's own test suite, run against the copy inside Dot Deck.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);
async function runAll() {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
  }
}
const BRIDGE = fs.readFileSync(path.join(ROOT, 'src', 'deck', 'bridge.js'), 'utf8');
const widgetsDir = path.join(ROOT, 'src', 'widgets');
const installed = fs.readdirSync(widgetsDir).filter((d) => fs.existsSync(path.join(widgetsDir, d, 'index.html')));
const rustIds = [...fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'deck.rs'), 'utf8').matchAll(/Def \{ id: "([a-z]+)"/g)].map((m) => m[1]);

/** A pretend Tauri API that records what the pages ask for. */
function fakeTauri() {
  const calls = [], listens = [], listenOpts = {};
  class Window {
    constructor(label) { this.label = label; }
    setSize(s) { calls.push(['native-setSize', this.label, s]); return Promise.resolve(); }
    startDragging() { calls.push(['native-drag', this.label]); return Promise.resolve(); }
  }
  return {
    calls, listens, listenOpts, Window,
    api: {
      core: { invoke: (cmd, args) => { calls.push([cmd, args]); return Promise.resolve(cmd === 'deck_flags' ? { arrange: false, lock: false } : null); } },
      event: { listen: (name, cb, o) => { listens.push(name); listenOpts[name] = o; return Promise.resolve(() => {}); } },
      window: { Window, getCurrentWindow: () => new Window('w-clock') },
    },
  };
}
function runBridge({ pathname, frame, tauri }) {
  const listeners = {};
  const doc = { readyState: 'complete', addEventListener() {}, getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }), body: { appendChild() {} } };
  const win = { location: { pathname }, document: doc, addEventListener: (n, f) => { listeners[n] = f; }, console };
  if (frame) { win.parent = { __TAURI__: tauri.api }; } else { win.parent = win; win.__TAURI__ = tauri.api; }
  const ctx = Object.assign(win, { window: win, Promise, String, Object });
  vm.createContext(ctx);
  vm.runInContext(BRIDGE, ctx, { filename: 'bridge.js' });
  return { win, listeners };
}

test('every widget is known to Rust and copied in with its pages', () => {
  assert.ok(installed.length >= 4, 'widgets copied in: ' + installed.join(', '));
  for (const id of installed) assert.ok(rustIds.includes(id), id + ' missing from deck.rs');
  assert.strictEqual(new Set(rustIds).size, rustIds.length, 'no duplicate ids');
});
test('every page loads the bridge before its own scripts', () => {
  for (const id of installed) for (const page of ['index.html', 'settings.html']) {
    const html = fs.readFileSync(path.join(widgetsDir, id, page), 'utf8');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(scripts[0], '../../deck/bridge.js', id + '/' + page);
  }
});
test('the widgets’ code reads the bridge’s Tauri API', () => {
  for (const id of installed) {
    const dir = path.join(widgetsDir, id, 'js');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const code = fs.readFileSync(path.join(dir, f), 'utf8');
      const bare = code.replace(/\(window\.__DECK_TAURI__ \|\| window\.__TAURI__\)/g, '');
      assert.ok(!/window\.__TAURI__/.test(bare), `${id}/${f} still reads window.__TAURI__ directly`);
    }
  }
});
test('bridge, settings page: commands say which widget, events are its own', () => {
  const t = fakeTauri();
  const { win } = runBridge({ pathname: '/widgets/weather/settings.html', frame: true, tauri: t });
  const T = win.__DECK_TAURI__;
  assert.ok(T && T !== t.api, 'its own copy of the API');
  T.core.invoke('load_state');
  T.core.invoke('save_state', { json: '{}' });
  T.core.invoke('plugin:event|listen', { event: 'x' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.calls[0])), ['load_state', { app: 'weather' }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.calls[1])), ['save_state', { app: 'weather', json: '{}' }]);
  assert.ok(!('app' in t.calls[2][1]), 'plugin calls are left alone');
  T.event.listen('state-changed', () => {});
  T.event.listen('tauri://drag-drop', () => {});
  assert.deepStrictEqual(t.listens, ['state-changed:weather', 'tauri://drag-drop']);
});
test('bridge, widget window: size goes through Deck, drags ask Deck first', async () => {
  const t = fakeTauri();
  const { win, listeners } = runBridge({ pathname: '/widgets/clock/index.html', frame: false, tauri: t });
  assert.strictEqual(win.__DECK_TAURI__.core, t.api.core, 'commands go straight through (Rust knows the window)');
  await new t.Window('w-clock').setSize({ width: 423, height: 111 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.calls.find((c) => c[0] === 'deck_set_size'))), ['deck_set_size', { width: 423, height: 111 }]);
  assert.ok(!t.calls.some((c) => c[0] === 'native-setSize'), 'not resized directly');
  listeners.mousedown({ altKey: true });
  await new t.Window('w-clock').startDragging();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.calls.find((c) => c[0] === 'deck_drag_start'))), ['deck_drag_start', { alt: true }]);
  assert.ok(t.calls.some((c) => c[0] === 'native-drag'), 'then drags');
  // The settings window's own size isn't touched.
  await new t.Window('settings').setSize({ width: 10, height: 10 });
  assert.ok(t.calls.some((c) => c[0] === 'native-setSize' && c[1] === 'settings'));
  assert.ok(t.listens.includes('deck-flags'), 'Deck’s own event, not per widget');
  // Its own events only, so widgets can't hear each other's settings.
  win.__DECK_TAURI__.event.listen('state-changed', () => {});
  win.__DECK_TAURI__.event.listen('clip', () => {});
  win.__DECK_TAURI__.event.listen('tauri://drag-drop', () => {});
  assert.ok(t.listens.includes('state-changed:clock') && t.listens.includes('clip:clock'));
  assert.ok(!t.listens.includes('state-changed'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(t.listenOpts['tauri://drag-drop'])), { target: 'w-clock' }, 'window events: this window only');
});
test('Rust tells each widget about its own settings only', () => {
  const rs = (fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'clipboard.rs'), 'utf8')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/"state-changed"/.test(rs), 'no plain state-changed events');
  assert.ok(/state-changed:\{\}/.test(rs));
  assert.ok(/"clip:clipboard"/.test(rs));
});
test('bridge, widget window: no dragging while positions are locked', async () => {
  const t = fakeTauri();
  t.api.core.invoke = (cmd, args) => { t.calls.push([cmd, args]); return Promise.resolve(cmd === 'deck_flags' ? { arrange: true, lock: true } : null); };
  runBridge({ pathname: '/widgets/list/index.html', frame: false, tauri: t });
  await new Promise((r) => setTimeout(r, 0));
  await new t.Window('w-list').startDragging();
  assert.ok(!t.calls.some((c) => c[0] === 'native-drag'), 'locked: no drag');
});
test('bridge does nothing outside Dot Deck', () => {
  const { win } = runBridge({ pathname: '/index.html', frame: false, tauri: { api: null } });
  assert.strictEqual(win.__DECK_TAURI__, undefined);
});
test('the Deck settings page knows every widget', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src', 'deck', 'settings.js'), 'utf8');
  for (const id of rustIds) assert.ok(new RegExp('\\b' + id + ':').test(js), 'description for ' + id);
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.strictEqual(conf.app.windows[0].url, 'deck/settings.html');
  assert.ok(conf.app.security.csp.includes('https://api.open-meteo.com'), 'weather can fetch');
});

(async () => {
await runAll();
console.log(`Dot Deck: ${passed} passed, ${failed} failed`);

// ---- each widget's own tests ----
let wp = 0, wf = 0;
for (const f of fs.readdirSync(path.join(__dirname, 'widgets')).filter((x) => x.endsWith('.js')).sort()) {
  const id = f.replace(/\.js$/, '');
  if (!installed.includes(id)) continue;
  const log = console.log;
  let out = '';
  console.log = (...a) => { out += a.join(' ') + '\n'; };
  let r;
  try { r = require(path.join(__dirname, 'widgets', f)); } catch (e) { r = { passed: 0, failed: 1 }; out += String(e && e.stack) + '\n'; }
  console.log = log;
  wp += r.passed; wf += r.failed;
  console.log(`  ${id.padEnd(11)} ${r.passed} passed, ${r.failed} failed`);
  if (r.failed) console.log(out.split('\n').filter((l) => /FAIL|Error|^\s{4}/.test(l)).slice(0, 12).join('\n'));
}
console.log(`Widgets: ${wp} passed, ${wf} failed`);
process.exitCode = failed || wf ? 1 : 0;
})();
