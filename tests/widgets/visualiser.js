// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, JSON, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'viz.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'visualiser', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const V = WT.viz;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const lit = (g) => g.cidx.reduce((n, v) => n + (v ? 1 : 0), 0);
const sim = V.simulator();
const warm = (sens) => { const s = V.createState(); for (let i = 0; i < 60; i++) V.update(s, sim(i / 30), 1 / 30, sens); return s; };
const build = (o) => V.build(Object.assign({ W: 141, style: 'bars', s: warm(), showTrack: false, np: { available: false }, scroll: 0, colorMode: 'meter', color: '#ffb000', peaks: true }, o || {}));
const silent = { bands: new Array(32).fill(-100), wave: new Array(128).fill(0), left: 0, right: 0, active: false };

test('dB to 0..1 with sensitivity', () => {
  assert.strictEqual(V.fromDb(0, 0.5), 1);
  assert.strictEqual(V.fromDb(-100, 0.5), 0);
  assert.ok(V.fromDb(-50, 1) > V.fromDb(-50, 0), 'more sensitive = taller');
  assert.strictEqual(V.fromDb(-50, 0), 0, 'least sensitive ignores -50 dB');
});
test('bars jump up and fall back smoothly; silence decays to nothing', () => {
  const s = V.createState();
  const loud = { bands: new Array(32).fill(0), wave: [], left: 0.3, right: 0.3, active: true };
  V.update(s, loud, 1 / 30, 0.5);
  assert.strictEqual(s.level[0], 1, 'instant attack');
  V.update(s, silent, 1 / 30, 0.5);
  assert.ok(s.level[0] < 1 && s.level[0] > 0.5, 'smooth fall: ' + s.level[0]);
  assert.ok(s.peak[0] > s.level[0], 'peak cap hangs above');
  for (let i = 0; i < 120; i++) V.update(s, silent, 1 / 30, 0.5);
  assert.ok(s.level.every((v) => v < 0.001) && s.vuL < 0.001);
  assert.strictEqual(s.active, false);
});
test('the scope fills the height even for quiet music', () => {
  const s = V.createState();
  const quiet = { bands: new Array(32).fill(-60), wave: Array.from({ length: 128 }, (_, i) => 0.02 * Math.sin(i / 5)), left: 0.01, right: 0.01, active: true };
  for (let i = 0; i < 30; i++) V.update(s, quiet, 1 / 30, 0.5);
  const m = Math.max(...s.wave.map(Math.abs));
  assert.ok(m > 0.35, 'auto-gain: ' + m);
});
test('every style draws, and heights are fixed (+ track line when ticked)', () => {
  for (const style of V.STYLES) {
    const g = build({ style });
    assert.strictEqual(g.h, V.height(style, false), style);
    assert.ok(lit(g) > 20, style + ' draws something');
    const t = build({ style, showTrack: true, np: { available: true, title: 'Neon Harbour', artist: 'The Low Satellites', playing: true } });
    assert.strictEqual(t.h, g.h + V.TRACK_H, style + ' track line');
    assert.strictEqual(build({ style, showTrack: true }).h, t.h, 'nothing playing: same size');
  }
});
test('long track names scroll, short ones do not; paused ones hold still', () => {
  const long = { available: true, title: 'A really rather long song title', artist: 'Somebody', playing: true };
  const st0 = warm();
  const a = build({ s: st0, showTrack: true, np: long, scroll: 0 }), b = build({ s: st0, showTrack: true, np: long, scroll: 30 });
  assert.ok(a.scrolling);
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''));
  assert.strictEqual(build({ showTrack: true, np: { available: true, title: 'Hi', artist: '', playing: true } }).scrolling, false);
  const same = warm();
  const p1 = build({ s: same, showTrack: true, np: Object.assign({}, long, { playing: false }), scroll: 0 });
  const p2 = build({ s: same, showTrack: true, np: Object.assign({}, long, { playing: false }), scroll: 30 });
  assert.strictEqual(p1.cidx.join(''), p2.cidx.join(''));
});
test('sensitivity changes how tall things get', () => {
  assert.ok(lit(build({ s: warm(1) })) > lit(build({ s: warm(0) })));
});
test('one-colour mode and peak caps', () => {
  const g = build({ colorMode: 'one' });
  assert.ok(g.colors.every((c) => c === '#ffb000' || c === V.WHITE), g.colors.join());
  const meter = build();
  assert.ok(meter.colors.includes(V.GREEN));
  assert.ok(lit(build({ peaks: false })) <= lit(meter));
});
test('nothing is drawn in the margins, any style or width', () => {
  for (const W of [80, 141, 400]) for (const style of V.STYLES) for (const showTrack of [false, true]) {
    const g = build({ W, style, showTrack, np: { available: true, title: 'X Y Z long long long long long long', artist: 'Q', playing: true }, scroll: 13 });
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${style} W${W} x${x}`);
    for (let x = 0; x < g.w; x++) for (const y of [0, 1, 2, g.h - 1, g.h - 2, g.h - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${style} W${W} y${y}`);
  }
});
test('store: defaults and repair', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.style, 'bars');
  assert.strictEqual(d.track.falls, true);
  assert.strictEqual(d.track.bars, false);
  assert.strictEqual(d.source, 'system');
  const s = WT.store.normalize({ style: 'disco', track: { scope: true, vu: 'yes' }, sensitivity: 7, colorMode: 'rainbow', source: '' });
  assert.strictEqual(s.style, 'bars');
  assert.strictEqual(s.track.scope, true);
  assert.strictEqual(s.track.vu, false);
  assert.strictEqual(s.sensitivity, 1);
  assert.strictEqual(s.colorMode, 'meter');
  assert.strictEqual(s.source, 'system');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
