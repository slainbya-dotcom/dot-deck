// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'system.js', 'chimes.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'system', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const S = WT.system;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const reading = (o) => Object.assign({ cpu: 0.42, mem: 0.6, disk: 0.48, net_down: 2.5e6, net_up: 5e5, battery: 0.84, plugged: false, battery_minutes: 190 }, o || {});
const colors = { cpu: '#ffb000', mem: '#5ad1ff', dsk: '#ff6bd5', net: '#39ff7a', bat: '#b8ff5a' };
const all = { cpu: true, mem: true, dsk: true, net: true, bat: true };
const filled = () => { const h = S.createHistory(); for (let i = 0; i < 300; i++) S.push(h, reading({ cpu: (i % 50) / 50 })); return h; };

test('push normalises and keeps bounded history', () => {
  const h = S.createHistory();
  for (let i = 0; i < 1000; i++) S.push(h, reading({ cpu: 1.7, mem: -1 }));
  assert.strictEqual(h.cpu.length, 400);
  assert.strictEqual(h.last.v.cpu, 1);
  assert.strictEqual(h.last.v.mem, 0);
});
test('network scales to recent peak (at least 1 MB/s)', () => {
  const h = S.createHistory();
  const v1 = S.push(h, reading({ net_down: 2e5, net_up: 0 }));
  assert.ok(Math.abs(v1.net - 0.2) < 1e-9);
  const v2 = S.push(h, reading({ net_down: 8e6, net_up: 0 }));
  assert.strictEqual(v2.net, 1);
});
test('value text is short', () => {
  const h = S.createHistory();
  S.push(h, reading({ net_down: 2.1e7, net_up: 0 }));
  assert.strictEqual(S.valueText('net', h), '21M');
  S.push(h, reading({ net_down: 640000, net_up: 0 }));
  assert.strictEqual(S.valueText('net', h), '640K');
  assert.strictEqual(S.valueText('cpu', h), '42%');
  S.push(h, reading({ battery: null }));
  assert.strictEqual(S.valueText('bat', h), '--');
});
test('each style draws at a fixed size whatever is ticked', () => {
  const h = filled();
  for (const style of S.STYLES) {
    const sizes = new Set();
    for (const m of [all, { cpu: true }, { mem: true, bat: true }, { net: true, dsk: true, cpu: true }]) {
      const g = S.build({ W: 141, style, metrics: m, colors, h, hasBattery: true });
      sizes.add(g.w + 'x' + g.h);
    }
    assert.strictEqual(sizes.size, 1, style);
  }
});
test('columns: one column per ticked monitor, evenly spaced', () => {
  const h = filled();
  const count = (metrics) => {
    const g = S.build({ W: 141, style: 'columns', metrics, colors, h, hasBattery: true });
    // count distinct column runs on the bottom row of the bar area
    const y = 3 + 15;
    let runs = 0, inRun = false;
    for (let x = 0; x < g.w; x++) { const lit = !!g.cidx[y * g.w + x]; if (lit && !inRun) runs++; inRun = lit; }
    return runs;
  };
  assert.strictEqual(count(all), 5);
  assert.strictEqual(count({ cpu: true, dsk: true }), 2);
  assert.strictEqual(count({ cpu: true, mem: true, dsk: true, net: true, bat: false }), 4);
});
test('battery is hidden when the machine has none', () => {
  const h = filled();
  const a = S.build({ W: 141, style: 'dials', metrics: { cpu: true, bat: true }, colors, h, hasBattery: false });
  const b = S.build({ W: 141, style: 'dials', metrics: { cpu: true }, colors, h, hasBattery: false });
  assert.deepStrictEqual([...a.cidx], [...b.cidx]);
});
test('nothing is drawn in the margins', () => {
  const h = filled();
  for (const style of S.STYLES) {
    const g = S.build({ W: 141, style, metrics: all, colors, h, hasBattery: true });
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, style + ' x' + x + ' y' + y);
  }
});
test('nothing ticked shows a hint instead', () => {
  const g = S.build({ W: 141, style: 'graph', metrics: {}, colors, h: filled(), hasBattery: true });
  assert.ok(g.cidx.some((v) => v));
});
test('store: defaults remember monitors per style; repair', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.style, 'columns');
  assert.strictEqual(d.metrics.graph.dsk, false);
  assert.strictEqual(d.metrics.columns.dsk, true);
  const s = WT.store.normalize({ style: 'nope', interval: 3, metrics: { dials: { net: true } }, colors: { cpu: 'red' } });
  assert.strictEqual(s.style, 'columns');
  assert.strictEqual(s.interval, 1);
  assert.strictEqual(s.metrics.dials.net, true);
  assert.strictEqual(s.metrics.dials.cpu, true);
  assert.strictEqual(s.colors.cpu, '#ffb000');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
