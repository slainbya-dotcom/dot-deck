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
for (const f of ['time.js', 'dotmatrix.js', 'data.js', 'geo.js', 'planner.js', 'chimes.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'planner', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const P = WT.planner;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const at = (s) => new Date(s).getTime();
const city = (name, tz, extra) => Object.assign(WT.store.newCity({ name, tz }), extra || {});
const LON = city('London, UK', 'Europe/London');
const NYC = city('New York, USA', 'America/New_York');
const TYO = city('Tokyo, Japan', 'Asia/Tokyo');
const DEL = city('Delhi, India', 'Asia/Kolkata');
const thu = at('2026-10-22T14:30:00Z'); // Thu 15:30 BST, 10:30 EDT, 23:30 JST, 20:00 IST

test('status: working / awake / asleep', () => {
  assert.strictEqual(P.status(LON, thu), 2);
  assert.strictEqual(P.status(NYC, thu), 2);
  assert.strictEqual(P.status(TYO, thu), 0);        // 23:30 JST: past the 07–23 awake window
});
test('awake window ends at its end hour', () => {
  assert.strictEqual(P.status(TYO, at('2026-10-22T13:59:00Z')), 1); // 22:59 JST
  assert.strictEqual(P.status(TYO, at('2026-10-22T14:00:00Z')), 0); // 23:00 JST asleep
});
test('weekends are off unless ticked', () => {
  const sat = at('2026-10-24T11:00:00Z'); // Sat 12:00 BST
  assert.strictEqual(P.status(LON, sat), 1);
  assert.strictEqual(P.status(city('London', 'Europe/London', { weekends: true }), sat), 2);
});
test('hours past midnight (awake 08–01)', () => {
  const owl = city('London', 'Europe/London', { awake: [8, 1] });
  assert.strictEqual(P.status(owl, at('2026-10-22T23:30:00Z')), 1);  // 00:30 BST next day
  assert.strictEqual(P.status(owl, at('2026-10-23T00:30:00Z')), 0);  // 01:30
});
test('half-hour zones: Delhi 20:00 is awake, hours read from its own clock', () => {
  assert.strictEqual(P.status(DEL, thu), 1);
  assert.strictEqual(P.local('Asia/Kolkata', thu).h, 20);
});
test('next overlap London + New York on a Thursday = 14:00–17:00 BST', () => {
  const w = P.nextOverlap([LON, NYC], at('2026-10-22T07:00:00Z'), 48);
  assert.strictEqual(WT.time.formatTime('Europe/London', new Date(w.start), true, false), '14:00');
  assert.strictEqual(WT.time.formatTime('Europe/London', new Date(w.end), true, false), '17:00');
});
test('London + New York + Tokyo never all work on standard hours', () => {
  assert.strictEqual(P.nextOverlap([LON, NYC, TYO], thu, 7 * 24), null);
});
test('hour labels', () => {
  assert.strictEqual(P.hourLabel(9, true), '09');
  assert.strictEqual(P.hourLabel(0, false), '12A');
  assert.strictEqual(P.hourLabel(14, false), '2P');
});
test('default codes', () => {
  assert.strictEqual(P.defaultCode('London, UK'), 'LON');
  assert.strictEqual(P.defaultCode('New York, USA'), 'NYC');
  assert.strictEqual(P.defaultCode('São Paulo, Brazil'), 'SAO');
});

const build = (panels, cities, extra) => P.build(Object.assign({
  W: 141, now: thu, cities, panels: P.PANEL_IDS.map((id) => ({ id, enabled: panels.includes(id) })),
  hours: 12, use24h: true, defaultColor: '#ffb000', highlight: '#39ff7a', scaleColor: '#e8e4d0',
}, extra || {}));
test('panel heights stack like the other widgets', () => {
  const g = build(['blocks', 'numbers'], [LON, NYC, TYO]);
  assert.strictEqual(g.w, 141);
  assert.strictEqual(g.h, 6 + P.HEIGHT.blocks(3) + 4 + P.HEIGHT.numbers(3));
  assert.strictEqual(build(['blocks'], [LON]).h, 6 + P.HEIGHT.blocks(1));
});
test('blocks and numbers both draw, inside the margins, for 6/12/24 hours', () => {
  for (const hours of [6, 12, 24]) for (const p of ['blocks', 'numbers']) {
    const g = build([p], [LON, NYC, TYO, DEL], { hours });
    let lit = 0;
    for (let i = 0; i < g.cidx.length; i++) if (g.cidx[i]) lit++;
    assert.ok(lit > 50, p + hours);
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, p + ' ' + hours + ' x' + x);
  }
});
test('everyone-working bar lights only in shared hours', () => {
  const g = build(['blocks'], [LON, NYC]); // 15:30 now: shared until 17:00 → first 2 hour cells lit
  const lw = Math.max(WT.dots.textWidth('XXX'), WT.dots.textWidth('LON'), WT.dots.textWidth('NYC'));
  const x0 = 3 + lw + 4, cw = Math.floor((141 - 3 - x0 + 1) / 12);
  const barLit = (i) => !!g.cidx[3 * 141 + x0 + i * cw];
  assert.ok(barLit(0) && barLit(1) && !barLit(2) && !barLit(5));
});
test('store: defaults and repair', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.panels.map((p) => p.id).join(), 'blocks,numbers');
  const s = WT.store.normalize({ cities: [{ name: 'X', tz: 'Mars/Base' }, { name: 'Paris', tz: 'Europe/Paris', work: [8, 30] }], hours: 7 });
  assert.strictEqual(s.cities.length, 1);
  assert.strictEqual(s.cities[0].work.join(), '8,24');
  assert.strictEqual(s.cities[0].label, 'PAR');
  assert.strictEqual(s.hours, 12);
});
test('Dot Clock cities import with home first', () => {
  const list = WT.worldTime.clocksFrom(JSON.stringify({ clocks: [{ label: 'Tokyo', tz: 'Asia/Tokyo' }, { label: 'Home', tz: 'Europe/London', home: true }] }));
  assert.strictEqual(list[0].label, 'Home');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
