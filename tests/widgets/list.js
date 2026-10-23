// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, JSON, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'list.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'list', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const L = WT.list;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const NOW = new Date(2026, 9, 22, 15, 0).getTime();
const tk = (id, text, done, ago) => ({ id, text, done: !!done, doneAt: done ? NOW - (ago || 5000) : 0 });
const st = (o) => Object.assign(WT.store.defaults(), o || {});
const build = (o) => L.build(Object.assign({ W: 141, state: st(), now: NOW, t: 0, hover: null, scroll: 0, editing: null, color: '#ffb000' }, o || {}));
const acts = (g) => g.hits.map((h) => h.action);

test('done tasks sink to the bottom once settled (or hide)', () => {
  const tasks = [tk('a', 'A', true), tk('b', 'B'), tk('c', 'C', true, 100), tk('d', 'D')];
  assert.strictEqual(L.ordered(tasks, 'sink', NOW).map((x) => x.id).join(''), 'bcda', 'c was ticked a moment ago: stays put');
  assert.strictEqual(L.ordered(tasks, 'hide', NOW).map((x) => x.id).join(''), 'bcd');
});
test('clear overnight drops only tasks ticked before today', () => {
  const yesterday = new Date(2026, 9, 21, 23, 0).getTime();
  const tasks = [Object.assign(tk('a', 'A', true), { doneAt: yesterday }), tk('b', 'B', true), tk('c', 'C')];
  assert.strictEqual(L.clearOvernight(tasks, NOW).map((x) => x.id).join(''), 'bc');
});
test('height grows with the list up to the rows setting', () => {
  const h = (n, rows) => build({ state: st({ tasks: Array.from({ length: n }, (_, i) => tk('t' + i, 'Task ' + i)), rows }) }).h;
  assert.strictEqual(h(0, 5), 3 * 2 + 2 * 10 - 3);
  assert.strictEqual(h(2, 5), 3 * 2 + 3 * 10 - 3);
  assert.strictEqual(h(5, 5), h(20, 5));
  assert.strictEqual(h(20, 8), 3 * 2 + 9 * 10 - 3);
});
test('click regions: tick per row, delete only when hovered, add', () => {
  const s = st({ tasks: [tk('a', 'One'), tk('b', 'Two')] });
  const g = build({ state: s });
  assert.strictEqual(g.hits.filter((h) => h.action === 'tick').length, 2);
  assert.ok(!acts(g).includes('del'));
  assert.ok(acts(g).includes('add'));
  const hov = build({ state: s, hover: 'b' });
  const del = hov.hits.find((h) => h.action === 'del');
  assert.strictEqual(del.id, 'b');
  assert.strictEqual(L.hitAt(hov, del.x0 + 2, del.y0 + 3).action, 'del');
});
test('long lists scroll', () => {
  const s = st({ tasks: Array.from({ length: 12 }, (_, i) => tk('t' + i, 'Task ' + i)), rows: 5 });
  const a = build({ state: s, scroll: 0 }), b = build({ state: s, scroll: 3 }), c = build({ state: s, scroll: 99 });
  assert.strictEqual(a.maxScroll, 7);
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''));
  assert.strictEqual(c.scrollTop, 7, 'clamped');
  assert.strictEqual(b.hits.find((h) => h.action === 'tick').id, 't3');
});
test('done tasks look different; long text trims, or scrolls when hovered', () => {
  const s1 = st({ tasks: [tk('a', 'Water plants')] }), s2 = st({ tasks: [tk('a', 'Water plants', true)] });
  assert.notStrictEqual(build({ state: s1 }).cidx.join(''), build({ state: s2 }).cidx.join(''));
  const long = st({ tasks: [tk('a', 'Pick up the parcel from the post office on Friday afternoon')] });
  const h0 = build({ state: long, hover: 'a', hoverScroll: 0 }), h1 = build({ state: long, hover: 'a', hoverScroll: 2 });
  assert.notStrictEqual(h0.cidx.join(''), h1.cidx.join(''));
});
test('typing shows on the add row with a blinking cursor', () => {
  const a = build({ editing: { text: 'Buy milk' }, t: 0 }), b = build({ editing: { text: 'Buy milk' }, t: 0.5 });
  assert.notStrictEqual(a.cidx.join(''), build().cidx.join(''));
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''), 'cursor blinks');
  const long = build({ editing: { text: 'x'.repeat(80) } });   // never overflows the margins (checked below)
  assert.ok(long);
});
test('nothing is drawn in the margins, any width', () => {
  const tasks = [tk('a', 'A really quite long task name that will not fit'), tk('b', 'Short', true), tk('c', 'Third')];
  for (const W of [80, 141, 400]) for (const o of [{}, { hover: 'a', hoverScroll: 1.3 }, { editing: { text: 'Typing something very long indeed here' } }]) {
    const g = build(Object.assign({ W, state: st({ tasks }) }, o));
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `W${W} x${x} y${y}`);
    for (let x = 0; x < g.w; x++) for (const y of [0, 1, 2, g.h - 1, g.h - 2, g.h - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `W${W} x${x} y${y}`);
  }
});
test('store: adding, cleaning and repair', () => {
  const s = st({ tasks: [tk('a', 'A'), tk('b', 'B', true)] });
  WT.store.addTask(s, '  Top\nline  ');
  assert.strictEqual(s.tasks[0].text, 'Top line');
  s.addAt = 'bottom';
  WT.store.addTask(s, 'Bottom');
  assert.strictEqual(s.tasks.map((x) => x.text).join(','), 'Top line,A,Bottom,B', 'above the done ones');
  assert.strictEqual(WT.store.addTask(s, '   '), null);
  const full = st({ tasks: Array.from({ length: 100 }, (_, i) => tk('t' + i, 'T')) });
  assert.strictEqual(WT.store.addTask(full, 'One more'), null);
  const n = WT.store.normalize({ rows: 50, doneMode: 'x', tasks: [{ text: '' }, { text: 'Ok', done: 'yes' }, null, { id: 'z', text: 'y'.repeat(200), done: true, doneAt: 5 }] });
  assert.strictEqual(n.rows, 10);
  assert.strictEqual(n.doneMode, 'sink');
  assert.strictEqual(n.tasks.length, 2);
  assert.strictEqual(n.tasks[0].done, false);
  assert.strictEqual(n.tasks[1].text.length, 80);
  assert.strictEqual(WT.store.normalize({ tasks: [] }).tasks.length, 0, 'an emptied list stays empty');
  assert.strictEqual(WT.store.normalize(null).tasks.length, 3, 'first run has three how-to tasks');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
