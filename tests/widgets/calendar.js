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
for (const f of ['time.js', 'dotmatrix.js', 'calendar.js', 'chimes.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'calendar', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const C = WT.calendar;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const at = (s) => new Date(s).getTime();
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' ' + a + ' vs ' + b);
const now = at('2026-10-22T14:37:42'); // Thursday, ISO week 43, day 295 of 365
const mon = { weekStart: 1 };

test('minute counts seconds', () => {
  close(C.fraction('minute', now, mon), 42 / 60);
  assert.strictEqual(C.value('minute', now, mon), 'SEC 42');
  assert.strictEqual(C.count('minute', now, mon), '42/60');
});
test('hour counts minutes', () => {
  close(C.fraction('hour', now, mon, true), 37 / 60);
  assert.strictEqual(C.value('hour', now, mon), 'MIN 37');
});
test('day counts hours (stepped = 14 of 24)', () => {
  close(C.fraction('day', now, mon, true), 14 / 24);
  assert.strictEqual(C.value('day', now, mon), 'HR 14');
  assert.strictEqual(C.count('day', now, mon), '14/24');
});
test('clock-change days have 23 or 25 hours', () => {
  assert.strictEqual(C.period('day', at('2026-03-29T12:00:00'), mon).units, 23);
  assert.strictEqual(C.period('day', at('2026-10-25T12:00:00'), mon).units, 25);
});
test('week counts days; Monday vs Sunday start', () => {
  close(C.fraction('week', now, mon, true), 3 / 7);           // Mon, Tue, Wed complete
  close(C.fraction('week', now, { weekStart: 0 }, true), 4 / 7); // Sun..Wed complete
  assert.strictEqual(C.value('week', now, mon), 'WK 43');
  assert.strictEqual(C.count('week', now, mon), '4/7');
});
test('ISO week numbers at year edges', () => {
  assert.strictEqual(C.isoWeek(new Date(2026, 0, 1)).week, 1);   // Thu 1 Jan 2026
  assert.strictEqual(C.isoWeek(new Date(2027, 0, 1)).week, 53);  // Fri 1 Jan 2027 is in 2026-W53
  assert.strictEqual(C.isoWeek(new Date(2026, 6, 1)).weeks, 53);
});
test('month counts days', () => {
  close(C.fraction('month', now, mon, true), 21 / 31);
  assert.strictEqual(C.value('month', now, mon), '22 OCT');
  assert.strictEqual(C.count('month', now, mon), '22/31');
});
test('year counts days, weeks or months', () => {
  close(C.fraction('year', now, { yearCounts: 'days' }, true), 294 / 365);
  close(C.fraction('year', now, { yearCounts: 'months' }, true), 9 / 12);
  assert.strictEqual(C.value('year', now, { yearCounts: 'days' }), '22 OCT');
  assert.strictEqual(C.value('year', now, { yearCounts: 'weeks' }), 'WK 43');
  assert.strictEqual(C.value('year', now, { yearCounts: 'months' }), 'OCT');
  assert.strictEqual(C.count('year', now, { yearCounts: 'days' }), '295/365');
  assert.strictEqual(C.count('year', now, { yearCounts: 'months' }), '10/12');
});
test('percent read-out and fractions stay within 0..1', () => {
  const t = { kind: 'year', show: 'percent', yearCounts: 'days' };
  assert.strictEqual(C.readout(t, now, mon), '80%');
  for (const k of C.KINDS) for (const s of ['2026-01-01T00:00:00', '2026-12-31T23:59:59', now]) {
    const f = C.fraction(k, typeof s === 'number' ? s : at(s), mon);
    assert.ok(f >= 0 && f <= 1, k + ' ' + f);
  }
});
test('% has a glyph', () => { assert.ok(WT.dots.hasGlyph('%')); });
test('label tokens', () => {
  assert.strictEqual(C.label('{WEEKDAY}', now), 'THURSDAY');
  assert.strictEqual(C.label('{MONTH} {YEAR}', now), 'OCTOBER 2026');
  assert.strictEqual(C.label('{DATE} · {WEEK}', now), '22 OCT · WEEK 43');
});
test('every read-out fits its reserved slot (rows never change size)', () => {
  const t0 = at('2026-01-01T00:00:00');
  for (const show of ['value', 'count', 'percent']) {
    for (const kind of C.KINDS) for (const yc of ['days', 'weeks', 'months']) {
      const t = { kind, show, yearCounts: yc };
      const slot = Math.max(...C.slotSamples(t).map(WT.dots.textWidth));
      for (let i = 0; i < 400; i++) {
        const when = t0 + i * 86400000 * 0.93 + i * 3723000;
        const r = C.readout(t, when, mon);
        assert.ok(WT.dots.textWidth(r) <= slot, kind + ' ' + show + ' ' + r);
      }
    }
  }
});
test('period key changes exactly when a bar completes', () => {
  assert.notStrictEqual(C.periodKey('minute', at('2026-10-22T14:37:59.9'), mon), C.periodKey('minute', at('2026-10-22T14:38:00'), mon));
  assert.strictEqual(C.periodKey('hour', at('2026-10-22T14:00:00'), mon), C.periodKey('hour', at('2026-10-22T14:59:59'), mon));
});
test('store: one tracker of each kind, all on by default, order kept', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.trackers.map((t) => t.kind).join(), 'minute,hour,day,week,month,year');
  assert.ok(d.trackers.every((t) => t.enabled));
  const s = WT.store.normalize({ trackers: [{ kind: 'year', show: 'percent' }, { kind: 'year' }, { kind: 'bogus' }] });
  assert.strictEqual(s.trackers[0].kind, 'year');
  assert.strictEqual(s.trackers[0].show, 'percent');
  assert.strictEqual(s.trackers.length, 6);
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
