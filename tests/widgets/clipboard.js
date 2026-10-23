// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, JSON, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'clipboard.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'clipboard', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const C = WT.clip;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const NOW = Date.UTC(2026, 9, 22, 12);
let n = 0;
const id = () => 'c' + (++n);
const clip = (text, minsAgo, pinned) => ({ id: id(), text, at: NOW - minsAgo * 60000, pinned: !!pinned });
const st = (o) => Object.assign(WT.store.defaults(), o || {});
const sample = () => [clip('https://github.com/slainbya-dotcom/dot-clock', 2), clip('Meeting moved to 3pm Thursday, same room', 9), clip('07700 900123', 40, true), clip('£1,249.99', 300)];
const build = (o) => C.build(Object.assign({ W: 141, state: st({ clips: sample() }), now: NOW, hover: null, scroll: 0, index: 0, copied: null, t: 0, color: '#ffb000' }, o || {}));
const acts = (g) => g.hits.map((h) => h.action);

test('adding: newest on top, duplicates move up and keep their pin, limit ignores pinned', () => {
  let c = [clip('a', 5, true), clip('b', 3)];
  c = C.addClip(c, 'new', NOW, 2, id);
  assert.strictEqual(c[0].text, 'new');
  c = C.addClip(c, 'a', NOW + 1, 2, id);
  assert.strictEqual(c.filter((x) => x.text === 'a').length, 1);
  assert.strictEqual(c.find((x) => x.text === 'a').pinned, true);
  c = C.addClip(c, 'x', NOW + 2, 2, id);
  c = C.addClip(c, 'y', NOW + 3, 2, id);
  assert.deepStrictEqual(c.filter((x) => !x.pinned).map((x) => x.text).join(), 'y,x');
  assert.ok(c.some((x) => x.text === 'a'), 'pinned kept beyond the limit');
  assert.strictEqual(C.addClip(c, '   ', NOW, 2, id), c, 'blank ignored');
});
test('order: pinned first, then newest; latest style the other way round', () => {
  const s = sample();
  assert.strictEqual(C.ordered(s)[0].text, '07700 900123');
  assert.strictEqual(C.latestOrder(s)[0].text.slice(0, 5), 'https');
  assert.strictEqual(C.latestOrder(s)[s.length - 1].pinned, true);
});
test('kinds and ages', () => {
  assert.strictEqual(C.kindOf('https://open-meteo.com'), 'link');
  assert.strictEqual(C.kindOf('42.195'), 'number');
  assert.strictEqual(C.kindOf('£1,249.99'), 'number');
  assert.strictEqual(C.kindOf('line one\nline two'), 'lines');
  assert.strictEqual(C.kindOf('Hello there'), 'text');
  assert.strictEqual(C.ago(10e3), 'NOW');
  assert.strictEqual(C.ago(5 * 60e3), '5M');
  assert.strictEqual(C.ago(3 * 3600e3), '3H');
  assert.strictEqual(C.ago(50 * 3600e3), '2D');
});
test('history: rows setting, hover gives pin and delete, scroll', () => {
  const g = build();
  assert.strictEqual(g.h, 3 * 2 + 4 * 10 - 3);
  assert.deepStrictEqual(acts(g).join(), 'copy,copy,copy,copy');
  const first = C.ordered(sample())[0];
  const s = st({ clips: sample() });
  const hov = build({ state: s, hover: C.ordered(s.clips)[1].id });
  assert.ok(acts(hov).includes('pin') && acts(hov).includes('del'));
  const many = st({ clips: Array.from({ length: 15 }, (_, i) => clip('clip ' + i, i)), rows: 5 });
  const a = build({ state: many }), b = build({ state: many, scroll: 4 });
  assert.strictEqual(a.maxScroll, 10);
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''));
  assert.ok(first);
});
test('copying flashes COPIED', () => {
  const s = st({ clips: sample() });
  const c = C.ordered(s.clips)[1];
  const a = build({ state: s }), b = build({ state: s, copied: { id: c.id, at: NOW - 100 } });
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''));
  assert.ok(b.colors.includes(C.GREEN));
  const later = build({ state: s, copied: { id: c.id, at: NOW - 5000 } });
  assert.strictEqual(later.cidx.join(''), a.cidx.join(''), 'gone after a moment');
});
test('paused shows on the widget and can be resumed', () => {
  const g = build({ state: st({ clips: sample(), paused: true }) });
  assert.ok(acts(g).includes('resume'));
  const empty = build({ state: st({ clips: [], paused: true }) });
  assert.ok(acts(empty).includes('resume'));
  assert.ok(!acts(build({ state: st({ clips: [] }) })).includes('resume'));
});
test('latest style: one line, arrows, copy', () => {
  const s = st({ clips: sample(), style: 'latest' });
  const g = build({ state: s });
  assert.strictEqual(g.h, 3 * 2 + 12);
  assert.ok(acts(g).includes('next') && !acts(g).includes('prev'));
  const mid = build({ state: s, index: 1 });
  assert.ok(acts(mid).includes('prev') && acts(mid).includes('next'));
  assert.strictEqual(build({ state: s, index: 99 }).index, 3, 'clamped');
  assert.ok(g.scrolling, 'long text scrolls');
});
test('nothing is drawn in the margins, any style or width', () => {
  const long = sample().concat([clip('A very very long piece of text copied from somewhere with lots of words in it', 1), clip('multi\nline\ntext', 3)]);
  for (const W of [80, 141, 400]) for (const style of ['history', 'latest']) for (const o of [{}, { hover: long[4].id, hoverScroll: 2 }, { copied: { id: long[0].id, at: NOW } }, { index: 2, t: 3 }]) {
    const g = build(Object.assign({ W, state: st({ clips: long, style, paused: !!o.index }) }, o));
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${style} W${W} x${x}`);
    for (let x = 0; x < g.w; x++) for (const y of [0, 1, 2, g.h - 1, g.h - 2, g.h - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${style} W${W} y${y}`);
  }
});
test('£ $ € draw', () => {
  assert.strictEqual(WT.dots.normalizeText('£1 $2 €3'), '£1 $2 €3');
});
test('store: repair and the limit', () => {
  const clips = Array.from({ length: 30 }, (_, i) => clip('t' + i, i)).concat([clip('pinned one', 99, true), { text: '' }, null]);
  const s = WT.store.normalize({ max: 10, rows: 1, style: 'grid', clips });
  assert.strictEqual(s.rows, 3);
  assert.strictEqual(s.style, 'history');
  assert.strictEqual(s.clips.filter((c) => !c.pinned).length, 10);
  assert.strictEqual(s.clips.filter((c) => c.pinned).length, 1);
  assert.strictEqual(WT.store.normalize(null).clips.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
