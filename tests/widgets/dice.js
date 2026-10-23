// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const nodeCrypto = require('crypto');

const ctx = { console, Intl, Date, Math, JSON, navigator: {}, setTimeout, clearTimeout, crypto: nodeCrypto.webcrypto, Uint32Array };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'dice.js', 'chimes.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'dice', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const X = WT.dice;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const st = (o) => Object.assign(WT.store.defaults(), o || {});
const build = (o) => X.build(Object.assign({ W: 141, t: 1.2, state: st(), last: null, savedResults: {}, spin: {}, color: '#ffb000' }, o || {}));
const actions = (g) => g.hits.map((h) => h.action);
const lit = (g) => g.cidx.reduce((n, v) => n + (v ? 1 : 0), 0);

test('every die rolls every face, evenly', () => {
  for (const d of X.DICE) {
    const seen = new Map(), N = d.sides * 3000;
    for (let i = 0; i < N; i++) { const v = X.roll1(d); seen.set(v, (seen.get(v) || 0) + 1); }
    const faces = d.tens ? [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] : Array.from({ length: d.sides }, (_, i) => i + 1);
    assert.deepStrictEqual([...seen.keys()].sort((a, b) => a - b).join(), faces.join(), d.id);
    for (const f of faces) assert.ok(Math.abs(seen.get(f) / N - 1 / d.sides) < 0.012, d.id + ' face ' + f);
  }
});
test('d00 + d10 is a fair 1-100', () => {
  const c = new Array(101).fill(0);
  for (let i = 0; i < 100000; i++) { const v = X.sum(X.rollCounts({ d00: 1, d10: 1 }), 0); c[v]++; }
  assert.strictEqual(c[0], 0);
  for (let v = 1; v <= 100; v++) assert.ok(c[v] > 800 && c[v] < 1200, 'value ' + v + ': ' + c[v]);
});
test('formula and totals', () => {
  assert.strictEqual(X.formula({ d20: 2, d6: 1 }, 5), '1D6+2D20+5');
  assert.strictEqual(X.formula({ d8: 1 }, -1), '1D8-1');
  assert.strictEqual(X.formula({}, 0), '');
  assert.strictEqual(X.sum([{ id: 'd6', value: 4 }, { id: 'd6', value: 6 }], 3), 13);
  assert.strictEqual(X.show('d00', 0), '00');
  assert.strictEqual(X.show('d00', 30), '30');
  assert.strictEqual(X.show('d20', 7), '7');
  const r = X.rollCounts({ d4: 2, d20: 1 }, () => 0);
  assert.deepStrictEqual(r.map((v) => v.id + ':' + v.value).join(), 'd4:1,d4:1,d20:1');
});
test('wireframes look like their dice', () => {
  const n = (id) => X.byId(id).shape;
  assert.strictEqual(n('d4').v.length, 4); assert.strictEqual(n('d4').e.length, 6);
  assert.strictEqual(n('d6').v.length, 8); assert.strictEqual(n('d6').e.length, 12);
  assert.strictEqual(n('d8').v.length, 6); assert.strictEqual(n('d8').e.length, 12);
  assert.strictEqual(n('d10').v.length, 12); assert.strictEqual(n('d10').e.length, 20);
  assert.strictEqual(n('d12').v.length, 20); assert.strictEqual(n('d12').e.length, 30);
  assert.strictEqual(n('d20').v.length, 12); assert.strictEqual(n('d20').e.length, 30);
});
test('dice spin', () => {
  assert.notStrictEqual(build({ t: 0 }).cidx.join(''), build({ t: 1 }).cidx.join(''));
});
test('heights: views and number of saved rolls', () => {
  const both = build().h, dice = build({ state: st({ views: { dice: true, saved: false } }) }).h;
  assert.strictEqual(dice, 3 * 2 + 17 + 1 + 7 + 3 + 16 + 3 + 9);
  assert.strictEqual(both, dice + 7 + 2 * 7 + 3);
  const savedOnly = build({ state: st({ views: { dice: false, saved: true } }) });
  assert.strictEqual(savedOnly.h, 3 * 2 + 2 * 7 + 3);
  assert.ok(!actions(savedOnly).includes('die'));
  const none = build({ state: st({ views: { dice: false, saved: false } }) });
  assert.strictEqual(none.hits.length, 0);
  assert.ok(lit(none) > 0);
  // the result doesn't change the size
  assert.strictEqual(build({ last: { vals: X.rollCounts({ d20: 10 }), settling: false } }).h, both);
});
test('click regions', () => {
  const g = build({ state: st({ pool: Object.assign(X.emptyCounts(), { d20: 2 }) }) });
  for (const a of ['die', 'roll', 'clear', 'sum', 'each', 'saved']) assert.ok(actions(g).includes(a), a);
  assert.strictEqual(g.hits.filter((h) => h.action === 'die').length, 7);
  assert.strictEqual(g.hits.filter((h) => h.action === 'saved').length, 2);
  const empty = build();
  assert.ok(!actions(empty).includes('roll'), 'nothing to roll');
  const d20 = g.hits.find((h) => h.die === 'd20');
  assert.strictEqual(X.hitAt(g, (d20.x0 + d20.x1) / 2, d20.y0 + 5).die, 'd20');
});
test('sum vs each look different for the same roll', () => {
  const vals = [{ id: 'd20', value: 17 }, { id: 'd20', value: 4 }];
  const pool = Object.assign(X.emptyCounts(), { d20: 2 });
  const a = build({ state: st({ pool, mode: 'sum' }), last: { vals, settling: false } });
  const b = build({ state: st({ pool, mode: 'each' }), last: { vals, settling: false } });
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''));
});
test('natural 20 and 1 are highlighted (and can be turned off)', () => {
  const pool = Object.assign(X.emptyCounts(), { d20: 2 });
  const vals = [{ id: 'd20', value: 20 }, { id: 'd20', value: 1 }];
  const g = build({ state: st({ pool, mode: 'each' }), last: { vals, settling: false } });
  assert.ok(g.colors.includes(X.GREEN) && g.colors.includes(X.RED));
  const off = build({ state: st({ pool, mode: 'each' }), last: { vals, settling: false }, crits: false });
  assert.ok(!off.colors.includes(X.GREEN));
});
test('saved rolls: modifier added once (sum) or to each die (each)', () => {
  const saved = [{ id: 'a', label: 'Adv', counts: Object.assign(X.emptyCounts(), { d20: 2 }), mod: 5, mode: 'each' }];
  const vals = [{ id: 'd20', value: 12 }, { id: 'd20', value: 3 }];
  const each = build({ state: st({ saved, views: { dice: false, saved: true } }), savedResults: { a: { vals, settling: false } } });
  const unrolled = build({ state: st({ saved, views: { dice: false, saved: true } }) });
  assert.ok(lit(each) > lit(unrolled), 'results drawn');
  // "17 8" vs "20": different drawings
  const sum = build({ state: st({ saved: [Object.assign({}, saved[0], { mode: 'sum' })], views: { dice: false, saved: true } }), savedResults: { a: { vals, settling: false } } });
  assert.notStrictEqual(each.cidx.join(''), sum.cidx.join(''));
});
test('ten dice of any mix still fit; nothing in the margins', () => {
  const pools = [{ d20: 10 }, { d4: 2, d6: 2, d8: 2, d10: 1, d12: 1, d20: 1, d00: 1 }, { d00: 10 }];
  for (const W of [80, 141, 400]) for (const p of pools) for (const mode of ['sum', 'each']) {
    const pool = Object.assign(X.emptyCounts(), p);
    const saved = [{ id: 'a', label: 'A long label here', counts: pool, mod: -12, mode }];
    const vals = X.rollCounts(pool);
    const g = build({ W, state: st({ pool, mode, saved }), last: { vals, settling: false }, savedResults: { a: { vals, settling: false } } });
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `W${W} x${x} y${y}`);
    for (let x = 0; x < g.w; x++) for (const y of [0, 1, 2, g.h - 1, g.h - 2, g.h - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `W${W} x${x} y${y}`);
  }
});
test('store: defaults and repair', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.views.dice, true);
  assert.strictEqual(d.saved.length, 2);
  assert.strictEqual(X.count(d.pool), 0);
  const s = WT.store.normalize({ pool: { d20: 8, d6: 8 }, mode: 'x', sound: 'boom', critSound: 'rattle', saved: [{ label: 'X', counts: { d4: 50 }, mod: 500, mode: 'each' }, null, 5] });
  assert.strictEqual(X.count(s.pool), 10, 'capped at 10 dice');
  assert.strictEqual(s.mode, 'sum');
  assert.strictEqual(s.sound, 'rattle');
  assert.strictEqual(s.critSound, 'none');
  assert.strictEqual(s.saved.length, 1);
  assert.strictEqual(s.saved[0].counts.d4, 10);
  assert.strictEqual(s.saved[0].mod, 99);
  assert.strictEqual(WT.store.normalize({ saved: [] }).saved.length, 0, 'an emptied list stays empty');
  const n = WT.store.newSaved({ label: 'Fireball', counts: { d6: 8 } });
  assert.strictEqual(X.formula(n.counts, n.mod), '8D6');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
