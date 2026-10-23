// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
process.env.TZ = 'Europe/London';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'focus.js', 'chimes.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'focus', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const F = WT.focus;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const M = 60000;
const settings = (over) => WT.store.normalize(Object.assign({}, over || {}));

test('defaults: 25 / 5 / 15 min, long break every 4, wait for click', () => {
  const s = settings();
  assert.strictEqual(F.lengthMs(s, 'focus'), 25 * M);
  assert.strictEqual(F.lengthMs(s, 'break'), 5 * M);
  assert.strictEqual(F.lengthMs(s, 'long'), 15 * M);
  assert.strictEqual(s.longEvery, 4);
  assert.strictEqual(s.next, 'wait');
});
test('phase order: F B F B F B F L F …', () => {
  const s = settings();
  const c = s.cycle;
  const seen = [c.phase];
  for (let i = 0; i < 9; i++) { const n = F.nextPhase(s, c); c.phase = n.phase; c.round = n.round; seen.push(c.phase); }
  assert.strictEqual(seen.join(' '), 'focus break focus break focus break focus long focus break');
});
test('long break off: just focus / break', () => {
  const s = settings({ longEnabled: false });
  const c = s.cycle;
  const seen = [];
  for (let i = 0; i < 10; i++) { const n = F.nextPhase(s, c); c.phase = n.phase; c.round = n.round; seen.push(c.phase); }
  assert.ok(!seen.includes('long'));
});
test('wait mode: phase end -> next phase waiting, alerting', () => {
  const s = settings();
  F.start(s.cycle, s, 0);
  assert.deepStrictEqual([...F.catchUp(s.cycle, s, 25 * M - 1)], []);
  assert.deepStrictEqual([...F.catchUp(s.cycle, s, 25 * M)], ['focus']);
  assert.strictEqual(s.cycle.phase, 'break');
  assert.strictEqual(s.cycle.status, 'waiting');
  assert.ok(s.cycle.alerting);
  assert.strictEqual(F.readout(s.cycle, s, 26 * M), '00:05:00');
});
test('auto mode: rolls on without drift, catches up after being closed', () => {
  const s = settings({ next: 'auto' });
  F.start(s.cycle, s, 0);
  // closed for 64 minutes: focus 25, break 5, focus 25, break 5 (=60), then 4 min into focus
  const ended = F.catchUp(s.cycle, s, 64 * M);
  assert.deepStrictEqual([...ended], ['focus', 'break', 'focus', 'break']);
  assert.strictEqual(s.cycle.phase, 'focus');
  assert.strictEqual(s.cycle.round, 2);
  assert.strictEqual(s.cycle.status, 'running');
  assert.strictEqual(s.cycle.endAt, 85 * M);
  assert.strictEqual(F.readout(s.cycle, s, 64 * M), '00:21:00');
});
test('pause / resume / skip / reset', () => {
  const s = settings();
  const c = s.cycle;
  F.start(c, s, 0);
  F.pause(c, 10 * M);
  assert.strictEqual(F.readout(c, s, 99 * M), '00:15:00');
  F.start(c, s, 20 * M);
  assert.strictEqual(c.endAt, 35 * M);
  F.skip(c, s, 21 * M);
  assert.strictEqual(c.phase, 'break');
  assert.strictEqual(c.status, 'running');      // skipping a running phase keeps going
  assert.strictEqual(c.endAt, 26 * M);
  F.reset(c);
  assert.strictEqual(c.phase, 'focus');
  assert.strictEqual(c.round, 0);
  assert.strictEqual(c.status, 'idle');
});
test('bar modes', () => {
  const s = settings({ lengths: { focus: { mi: 10 }, break: { mi: 10 }, long: { mi: 10 } } });
  F.start(s.cycle, s, 0);
  const at = 2.5 * M; // 25 %
  const frac = (mode, phase) => { s.barMode = mode; s.cycle.phase = phase; return F.barFraction(s.cycle, s, at); };
  assert.strictEqual(frac('focusFills', 'focus'), 0.25);
  assert.strictEqual(frac('focusFills', 'break'), 0.75);
  assert.strictEqual(frac('focusDrains', 'focus'), 0.75);
  assert.strictEqual(frac('focusDrains', 'long'), 0.25);
  assert.strictEqual(frac('allFill', 'break'), 0.25);
  assert.strictEqual(frac('allDrain', 'focus'), 0.75);
});
test('widget is one fixed-size block, same as a Dot Timer row', () => {
  const sizes = new Set();
  for (const label of ['FOCUS', 'BREAK', 'LONG BREAK', 'A VERY LONG CUSTOM PHASE NAME']) {
    const g = WT.dots.layoutTimers([{ label, time: '00:25:00', slot: WT.dots.textWidth('00:00:00'), frac: 0.4, color: '#fff' }], 141);
    sizes.add(g.w + 'x' + g.h);
  }
  assert.deepStrictEqual([...sizes], ['141x' + WT.dots.timersHeight(1)]);
});
test('store repairs bad data', () => {
  const s = WT.store.normalize({ lengths: { focus: { h: 0, mi: 0, s: 0 } }, longEvery: 99, cycle: { status: 'running' }, chimes: { focus: 'nope' } });
  assert.strictEqual(F.lengthMs(s, 'focus'), 25 * M);
  assert.strictEqual(s.longEvery, 12);
  assert.strictEqual(s.cycle.status, 'idle');
  assert.strictEqual(s.chimes.focus, 'coin');
});
test('same ten chimes as Dot Timer', () => {
  assert.strictEqual(WT.chimes.CHIMES.length, 10);
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
