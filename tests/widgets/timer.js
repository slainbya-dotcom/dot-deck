// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
process.env.TZ = 'Europe/London'; // makes the DST tests deterministic
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'timers.js', 'chimes.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'timer', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const T = WT.timers;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const at = (s) => new Date(s).getTime();

// ---- lengths & calendar ----
test('31 Jan + 1 month = end of Feb (leap and non-leap)', () => {
  assert.strictEqual(new Date(T.addLength(at('2027-01-31T10:00:00'), { mo: 1 })).toISOString(), '2027-02-28T10:00:00.000Z');
  assert.strictEqual(new Date(T.addLength(at('2028-01-31T10:00:00'), { mo: 1 })).getDate(), 29);
});
test('+1 day across the spring DST change keeps the wall-clock time (23 real hours)', () => {
  const start = at('2026-03-28T09:00:00');
  const end = T.addLength(start, { d: 1 });
  assert.strictEqual(new Date(end).getHours(), 9);
  assert.strictEqual((end - start) / 3600000, 23);
});
test('+1 year from 29 Feb lands on 28 Feb', () => {
  assert.strictEqual(new Date(T.addLength(at('2028-02-29T12:00:00'), { y: 1 })).getDate(), 28);
});
test('breakdown recovers every unit', () => {
  const now = at('2026-01-10T08:00:00');
  const len = { y: 1, mo: 2, d: 3, h: 4, mi: 5, s: 6 };
  const b = T.breakdown(now, T.addLength(now, len));
  assert.deepStrictEqual({ ...b }, len);
});
test('breakdown rounds up to the next whole second', () => {
  const b = T.breakdown(0, 1500);
  assert.strictEqual(b.s, 2);
});
test('readout formats', () => {
  assert.strictEqual(T.formatParts({ y: 0, mo: 0, d: 0, h: 0, mi: 5, s: 0 }), '00:05:00');
  assert.strictEqual(T.formatParts({ y: 0, mo: 0, d: 3, h: 4, mi: 5, s: 6 }), '3D 04:05:06');
  assert.strictEqual(T.formatParts({ y: 0, mo: 2, d: 3, h: 4, mi: 5, s: 6 }), '2M 03D 04H');
  assert.strictEqual(T.formatParts({ y: 1, mo: 2, d: 3, h: 4, mi: 5, s: 6 }), '1Y 02M 03D');
});
test('describeLength', () => {
  assert.strictEqual(T.describeLength({ y: 1, mo: 0, d: 0, h: 2, mi: 1, s: 0 }), '1 year 2 hours 1 minute');
});

// ---- start / pause / finish ----
function timer(len, extra) { return WT.store.normalizeTimer(Object.assign({ label: 'TEST', length: len }, extra || {})); }
test('start → pause → resume keeps the remaining time', () => {
  const t = timer({ mi: 10 });
  T.start(t, 0);
  assert.strictEqual(t.endAt, 600000);
  T.pause(t, 120000);
  assert.strictEqual(t.remainingMs, 480000);
  T.start(t, 1000000);
  assert.strictEqual(t.endAt, 1480000);
  assert.strictEqual(T.remainingMs(t, 1000000), 480000);
});
test('progress and bar fraction (fill vs empty)', () => {
  const t = timer({ s: 100 }, { direction: 'fill' });
  T.start(t, 0);
  assert.ok(Math.abs(T.barFraction(t, 25000) - 0.25) < 1e-9);
  t.direction = 'empty';
  assert.ok(Math.abs(T.barFraction(t, 25000) - 0.75) < 1e-9);
});
test('overdue timers finish and alert; toggle on done starts again', () => {
  const t = timer({ s: 5 });
  T.start(t, 0);
  assert.strictEqual(T.overdue([t], 4999).length, 0);
  assert.strictEqual(T.overdue([t], 5000).length, 1);
  T.finish(t, 5000);
  assert.strictEqual(t.status, 'done');
  assert.ok(t.alerting);
  assert.strictEqual(T.readout(t, 6000), 'DONE');
  T.toggle(t, 7000);
  assert.strictEqual(t.status, 'running');
  assert.strictEqual(t.endAt, 12000);
  assert.strictEqual(t.alerting, false);
});
test('readout never wider than the reserved slot (no widget resizing)', () => {
  const lens = [{ s: 30 }, { h: 23, mi: 59, s: 59 }, { d: 1 }, { d: 30, h: 23 }, { mo: 11, d: 30 }, { y: 99, mo: 11, d: 30 }, { y: 1 }];
  const now = at('2026-05-31T23:59:59');
  for (const len of lens) {
    const t = timer(len);
    const slot = Math.max(...T.slotSamples(t).map(WT.dots.textWidth));
    T.start(t, now);
    for (const frac of [0, 0.001, 0.3, 0.5, 0.9, 0.9999]) {
      const r = T.readout(t, now + t.totalMs * frac);
      assert.ok(WT.dots.textWidth(r) <= slot, JSON.stringify(len) + ' ' + r);
    }
  }
});

// ---- layout ----
test('widget size is fixed while a timer counts down', () => {
  const sizes = new Set();
  for (const time of ['00:05:00', '00:00:01', 'DONE', '30D 23:59:59', '1Y 02M 03D']) {
    const g = WT.dots.layoutTimers([{ label: 'TEA BREAK', time, slot: WT.dots.textWidth('30D 23:59:59'), frac: 0.5, color: '#fff' }], 140);
    sizes.add(g.w + 'x' + g.h);
  }
  assert.strictEqual(sizes.size, 1);
});
test('long labels are trimmed to fit, never overlapping the time', () => {
  const W = 120, slot = WT.dots.textWidth('00:00:00');
  const g = WT.dots.layoutTimers([{ label: 'A VERY VERY LONG TIMER LABEL THAT GOES ON', time: '00:00:00', slot, frac: 0, color: '#fff' }], W);
  const timeX = W - WT.dots.MARGIN - slot;
  // the column just left of the time slot (the gap) must be dark on the text rows
  for (let y = 3; y < 10; y++) for (let x = timeX - WT.dots.GAP; x < timeX; x++) assert.strictEqual(g.cidx[y * W + x], 0);
});
test('height grows by one timer block per timer', () => {
  const h1 = WT.dots.timersHeight(1), h2 = WT.dots.timersHeight(2);
  assert.strictEqual(h2 - h1, WT.dots.TIMER_H + 4);
});
test('bar lights the right number of columns', () => {
  const W = 104; // inner = 98, fill area = 94
  const g = WT.dots.layoutTimers([{ label: '', time: '', slot: 0, frac: 0.5, color: '#fff' }], W);
  const y = WT.dots.timerTop(0) + WT.dots.ROW_H + WT.dots.TEXT_BAR_GAP + 3;
  let lit = 0;
  for (let x = 5; x < W - 5; x++) if (g.cidx[y * W + x] && g.alpha[y * W + x] === 1) lit++;
  assert.strictEqual(lit, 47);
});

// ---- chimes ----
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
test('ten chimes: 3 hi, 4 dual, 3 lo, both 8- and 16-bit', () => {
  const C = WT.chimes.CHIMES;
  assert.strictEqual(C.length, 10);
  assert.strictEqual(C.filter((c) => c.kind === 'Hi').length, 3);
  assert.strictEqual(C.filter((c) => c.kind === 'Dual').length, 4);
  assert.strictEqual(C.filter((c) => c.kind === 'Lo').length, 3);
  assert.ok(C.some((c) => c.bits === 8) && C.some((c) => c.bits === 16));
});
test('every chime fits a major scale (bright, no minor)', () => {
  for (const c of WT.chimes.CHIMES) {
    const pcs = new Set(c.notes.map((n) => n[2] % 12));
    const ok = [...Array(12).keys()].some((root) => [...pcs].every((p) => MAJOR.includes((p - root + 12) % 12)));
    assert.ok(ok, c.id);
  }
});
test('no chime stacks a minor chord (simultaneous notes)', () => {
  for (const c of WT.chimes.CHIMES) {
    const starts = [...new Set(c.notes.map((n) => n[0]))];
    for (const s of starts) {
      const pcs = [...new Set(c.notes.filter((n) => n[0] === s).map((n) => n[2] % 12))];
      for (const r of pcs) assert.ok(!(pcs.includes((r + 3) % 12) && pcs.includes((r + 7) % 12)), c.id + ' minor triad');
    }
  }
});
test('hi chimes sit higher than lo chimes', () => {
  const avg = (c) => c.notes.reduce((s, n) => s + n[2], 0) / c.notes.length;
  const hi = WT.chimes.CHIMES.filter((c) => c.kind === 'Hi').map(avg);
  const lo = WT.chimes.CHIMES.filter((c) => c.kind === 'Lo').map(avg);
  assert.ok(Math.min(...hi) > Math.max(...lo));
});

// ---- Dot Clock matching ----
test('Dot Clock width is measured exactly as its widget lays out', () => {
  const wt = { clocks: [{ label: 'London, UK', tz: 'Europe/London' }, { label: 'Sydney, Australia', tz: 'Australia/Sydney' }], use24h: true, dotSize: 4, dotColor: '#39ff7a' };
  const look = WT.worldTime.lookFrom(JSON.stringify(wt), new Date(at('2026-07-01T12:00:00')));
  const rows = wt.clocks.map((c) => ({ label: c.label, time: '12:00', zone: WT.time.abbreviation(c.tz, new Date(at('2026-07-01T12:00:00'))), day: true }));
  assert.strictEqual(look.width, WT.dots.layout(rows).w);
  assert.strictEqual(look.dotSize, 4);
  assert.strictEqual(look.dotColor, '#39ff7a');
});
test('unreadable Dot Clock settings are ignored', () => {
  assert.strictEqual(WT.worldTime.lookFrom('not json', new Date()), null);
});

// ---- store ----
test('first run gets one example timer; bad data is repaired', () => {
  assert.strictEqual(WT.store.normalize(null).timers.length, 1);
  const s = WT.store.normalize({ timers: [{ label: 'X', length: {}, status: 'running' }, { label: 'Y', chime: 'nope', length: { s: 9 } }] });
  assert.strictEqual(s.timers[0].status, 'idle');   // running without an end time
  assert.strictEqual(s.timers[0].length.mi, 5);     // empty length -> default
  assert.strictEqual(s.timers[1].chime, 'coin');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
