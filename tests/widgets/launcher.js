// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, JSON, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'launcher.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'launcher', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const Ln = WT.launcher;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const items = (n) => Array.from({ length: n }, (_, i) => WT.store.newItem('C:\\Apps\\App ' + i + '.exe'));
const st = (o) => Object.assign(WT.store.defaults(), o || {});
const build = (o) => Ln.build(Object.assign({ W: 141, state: st({ items: items(9) }), hover: null, scroll: 0, opening: null, color: '#ffb000' }, o || {}));

test('guesses kind, name and icon from a path or link', () => {
  assert.strictEqual(Ln.kindOf('https://www.bbc.co.uk/news'), 'web');
  assert.strictEqual(Ln.kindOf('C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk'), 'app');
  assert.strictEqual(Ln.kindOf('/Applications/Spotify.app'), 'app');
  assert.strictEqual(Ln.kindOf('C:\\Users\\Me\\Downloads'), 'folder');
  assert.strictEqual(Ln.kindOf('/Users/me/Documents/Budget.xlsx'), 'file');
  assert.strictEqual(Ln.nameOf('https://www.bbc.co.uk/news'), 'bbc.co.uk');
  assert.strictEqual(Ln.nameOf('C:\\X\\Google Chrome.lnk'), 'Google Chrome');
  assert.strictEqual(Ln.nameOf('/Applications/Visual Studio Code.app/'), 'Visual Studio Code');
  assert.strictEqual(Ln.iconFor('Google Chrome', 'app'), 'globe');
  assert.strictEqual(Ln.iconFor('Spotify', 'app'), 'music');
  assert.strictEqual(Ln.iconFor('Microsoft Teams', 'app'), 'chat');
  assert.strictEqual(Ln.iconFor('Budget', 'file', 'Budget.xlsx'), 'doc');
  assert.strictEqual(Ln.iconFor('Something', 'folder'), 'folder');
  assert.strictEqual(Ln.iconFor('Mystery', 'app'), 'app');
  const w = WT.store.newItem('www.example.com');
  assert.strictEqual(w.target, 'https://www.example.com');
  assert.strictEqual(w.kind, 'web');
});
test('every icon is 7x7', () => {
  for (const [n, rows] of Object.entries(Ln.ICON)) {
    assert.strictEqual(rows.length, 7, n);
    for (const r of rows) assert.strictEqual(r.length, 7, n);
  }
});
test('icon style: 1, 2 or 3 rows; height follows the setting', () => {
  const h = (rows) => build({ state: st({ items: items(9), rows }) }).h;
  assert.strictEqual(h(1), 3 * 2 + 14 + 3 + 7);
  assert.strictEqual(h(2), 3 * 2 + 14 * 2 + 4 + 3 + 7);
  assert.strictEqual(h(3), 3 * 2 + 14 * 3 + 8 + 3 + 7);
  assert.strictEqual(Ln.perRow(141), 7);
  const one = build({ state: st({ items: items(9), rows: 1 }) });
  assert.strictEqual(one.hits.length, 7, 'one row of seven');
  assert.strictEqual(one.maxScroll, 1, 'the rest scroll');
  const three = build({ state: st({ items: items(9), rows: 3 }) });
  assert.strictEqual(three.hits.length, 9);
  assert.strictEqual(three.maxScroll, 0);
});
test('scrolling by rows', () => {
  const s = st({ items: items(20), rows: 1 });
  const a = build({ state: s, scroll: 0 }), b = build({ state: s, scroll: 2 });
  assert.strictEqual(b.hits[0].id, s.items[14].id);
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''));
  assert.strictEqual(build({ state: s, scroll: 99 }).scrollTop, 2);
});
test('hover shows the name; opening shows OPENING; empty shows a hint', () => {
  const s = st({ items: items(3) });
  const plain = build({ state: s }), hov = build({ state: s, hover: s.items[1].id }), op = build({ state: s, opening: { id: s.items[1].id } });
  assert.notStrictEqual(plain.cidx.join(''), hov.cidx.join(''));
  assert.notStrictEqual(hov.cidx.join(''), op.cidx.join(''));
  assert.ok(op.colors.includes(Ln.GREEN));
  const empty = build({ state: st() });
  assert.ok(empty.cidx.some((v) => v));
  assert.strictEqual(empty.hits.length, 0);
});
test('list style: two columns, rows setting, scroll', () => {
  const s = st({ style: 'list', listRows: 3, items: items(9) });
  const g = build({ state: s });
  assert.strictEqual(g.h, 3 * 2 + 3 * 10 - 3);
  assert.strictEqual(g.hits.length, 6);
  assert.strictEqual(g.maxScroll, 2);
  assert.ok(g.hits[1].x0 > g.hits[0].x0, 'second column');
  const few = build({ state: st({ style: 'list', listRows: 5, items: items(3) }) });
  assert.strictEqual(few.h, 3 * 2 + 2 * 10 - 3, 'shrinks to fit');
});
test('nothing is drawn in the margins, any style or width', () => {
  const long = items(30).map((x, i) => Object.assign(x, { name: 'A very long application name ' + i, icon: Ln.ICON_NAMES[i % Ln.ICON_NAMES.length] }));
  for (const W of [80, 141, 400]) for (const style of ['icons', 'list']) for (const rows of [1, 2, 3]) {
    const s = st({ style, rows, items: long });
    for (const o of [{}, { hover: long[0].id }, { opening: { id: long[1].id, failed: true } }]) {
      const g = build(Object.assign({ W, state: s }, o));
      for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${style} W${W} x${x}`);
      for (let x = 0; x < g.w; x++) for (const y of [0, 1, 2, g.h - 1, g.h - 2, g.h - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${style} W${W} y${y}`);
    }
  }
});
test('£ $ € draw', () => {
  assert.strictEqual(WT.dots.normalizeText('£5 $5 €5'), '£5 $5 €5');
});
test('store: repair', () => {
  const s = WT.store.normalize({ style: 'grid', rows: 7, items: [{ target: '' }, { target: 'https://a.com', icon: 'nope', color: 'red' }, { name: 'X', target: 'C:\\x.exe', kind: 'weird' }] });
  assert.strictEqual(s.style, 'icons');
  assert.strictEqual(s.rows, 3);
  assert.strictEqual(s.items.length, 2);
  assert.strictEqual(s.items[0].icon, 'globe');
  assert.strictEqual(s.items[0].color, '#ffb000');
  assert.strictEqual(s.items[1].kind, 'app');
  assert.strictEqual(WT.store.normalize(null).items.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
