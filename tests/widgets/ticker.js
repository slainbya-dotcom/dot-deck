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
for (const f of ['time.js', 'dotmatrix.js', 'ticker.js', 'chimes.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'ticker', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const K = WT.ticker;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const at = (s) => new Date(s).getTime();
const thu = at('2026-10-22T14:05:00'); // Thursday
const msg = (extra) => WT.store.normalize({ messages: [Object.assign({ text: 'HI' }, extra)] }).messages[0];

test('tokens fill in', () => {
  assert.strictEqual(K.fill('IT IS {TIME} ON {DAY}', thu, true), 'IT IS 14:05 ON THURSDAY');
  assert.strictEqual(K.fill('{DATE}', thu), '22 OCT');
  assert.strictEqual(K.fill('XMAS IN {UNTIL 25 DEC}', thu), 'XMAS IN 64 DAYS');
  assert.strictEqual(K.fill('{until 22 oct}', thu), 'TODAY');
  assert.strictEqual(K.fill('{UNTIL 21 OCT}', thu), '364 DAYS');   // already passed → next year
  assert.strictEqual(K.fill('{UNTIL 40 XYZ}', thu), '{UNTIL 40 XYZ}');
});
test('schedules: days and time windows', () => {
  assert.ok(K.isActive(msg({}), thu));                                                    // always
  assert.ok(K.isActive(msg({ schedule: { days: [4] } }), thu));                           // Thursdays
  assert.ok(!K.isActive(msg({ schedule: { days: [1, 2] } }), thu));
  assert.ok(K.isActive(msg({ schedule: { from: '09:00', to: '17:00' } }), thu));
  assert.ok(!K.isActive(msg({ schedule: { from: '15:00', to: '17:00' } }), thu));
  assert.ok(K.isActive(msg({ schedule: { from: '14:00' } }), thu));
  assert.ok(!K.isActive(msg({ schedule: { to: '14:00' } }), thu));
});
test('overnight window belongs to the day it started', () => {
  const m = msg({ schedule: { days: [3], from: '22:00', to: '02:00' } });               // Wednesday night
  assert.ok(K.isActive(m, at('2026-10-21T23:00:00')));
  assert.ok(K.isActive(m, at('2026-10-22T01:30:00')));                                  // early Thursday
  assert.ok(!K.isActive(m, at('2026-10-22T23:00:00')));                                 // Thursday night
});
test('disabled or empty messages never show', () => {
  assert.ok(!K.isActive(msg({ enabled: false }), thu));
  assert.ok(!K.isActive(msg({ text: '   ' }), thu));
});

const baseCtx = (styles, extra) => Object.assign({
  W: 141, t: 0, now: thu, use24h: true, msgs: [{ text: 'HELLO WORLD', color: '#ff0000' }, { text: "DON'T FORGET THE BINS", color: null, urgent: true }],
  styles, speed: 33, dir: 'left', hold: 3000, sep: '*', defaultColor: '#ffb000', sepColor: '#ffb000',
}, extra || {});
const all = (on) => K.STYLE_IDS.map((id) => ({ id, enabled: on.includes(id), tag: 'NOTE', title: '{DAY}' }));
const litCount = (g) => g.cidx.reduce((n, v) => n + (v ? 1 : 0), 0);

test('heights: one row per style, two for the board', () => {
  assert.strictEqual(K.height(all(['scroll'])), 13);
  assert.strictEqual(K.height(all(['board'])), 6 + 18);
  assert.strictEqual(K.height(all(K.STYLE_IDS)), 6 + 7 * 4 + 18 + 4 * 4);
  assert.strictEqual(K.height(all([])), 13);
});
test('every style draws something, at a fixed width, at many moments', () => {
  for (const id of K.STYLE_IDS) {
    let total = 0;
    for (let t = 0; t < 20000; t += 777) {
      const g = K.build(baseCtx(all([id]), { t }));
      assert.strictEqual(g.w, 141);
      total += litCount(g);
    }
    assert.ok(total > 0, id);
  }
});
test('scroll moves left (or right) over time', () => {
  const firstLitX = (g) => { for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) if (g.cidx[y * g.w + x]) return x; return -1; };
  const a = K.build(baseCtx(all(['scroll']), { t: 2000 })), b = K.build(baseCtx(all(['scroll']), { t: 2500 }));
  assert.ok(firstLitX(b) < firstLitX(a));
});
test('nothing is ever drawn in the margins', () => {
  for (const id of K.STYLE_IDS) for (let t = 0; t < 15000; t += 1234) {
    const g = K.build(baseCtx(all([id]), { t }));
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, id + ' ' + x);
  }
});
test('store: defaults, repair and caps', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.messages.length, 3);
  assert.strictEqual(d.styles.map((s) => s.id).join(), 'scroll,flip,tagged,board,type');
  const s = WT.store.normalize({ messages: [{ text: 'A', schedule: { days: [9, 1, 1], from: '25:00', to: '07:30' } }], speed: 9999, styles: [{ id: 'type', enabled: true }] });
  assert.strictEqual(s.messages[0].schedule.days.join(), '1');
  assert.strictEqual(s.messages[0].schedule.from, '');
  assert.strictEqual(s.messages[0].schedule.to, '07:30');
  assert.strictEqual(s.speed, 120);
  assert.strictEqual(s.styles[0].id, 'type');
  assert.strictEqual(s.styles.length, 5);
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
