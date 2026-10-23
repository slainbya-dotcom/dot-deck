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
for (const f of ['time.js', 'dotmatrix.js', 'solar.js', 'data.js', 'geo.js', 'sun.js', 'panels.js', 'chimes.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'sun', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const S = WT.sun;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const at = (s) => new Date(s).getTime();
const LONDON = { label: 'London, UK', tz: 'Europe/London', lat: 51.507, lng: -0.128 };
const hm = (t, tz) => WT.time.formatTime(tz || 'Europe/London', new Date(t), true, false);
const mins = (a, b) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); return Math.abs(h1 * 60 + m1 - h2 * 60 - m2); };

// Reference times from published almanacs (timeanddate.com), within 3 minutes.
test('London 21 Jun 2026: sunrise ~04:43, sunset ~21:21 (BST)', () => {
  const s = S.sunTimes(LONDON, at('2026-06-21T12:00:00'));
  assert.ok(mins(hm(s.sunrise), '04:43') <= 3, hm(s.sunrise));
  assert.ok(mins(hm(s.sunset), '21:21') <= 3, hm(s.sunset));
  assert.ok(Math.abs(s.dayLength / 3600000 - 16.63) < 0.1);
});
test('London 21 Dec 2026: sunrise ~08:04, sunset ~15:53 (GMT)', () => {
  const s = S.sunTimes(LONDON, at('2026-12-21T12:00:00'));
  assert.ok(mins(hm(s.sunrise), '08:04') <= 3, hm(s.sunrise));
  assert.ok(mins(hm(s.sunset), '15:53') <= 3, hm(s.sunset));
});
test('Sydney 21 Dec 2026 (southern summer): sunrise ~05:42, sunset ~20:05', () => {
  const p = { tz: 'Australia/Sydney', lat: -33.87, lng: 151.21 };
  const s = S.sunTimes(p, at('2026-12-21T02:00:00Z'));
  assert.ok(mins(hm(s.sunrise, p.tz), '05:42') <= 4, hm(s.sunrise, p.tz));
  assert.ok(mins(hm(s.sunset, p.tz), '20:05') <= 4, hm(s.sunset, p.tz));
});
test('golden hour sits just after sunrise and just before sunset', () => {
  const s = S.sunTimes(LONDON, at('2026-10-22T12:00:00'));
  assert.ok(s.goldenMorningEnd > s.sunrise && s.goldenMorningEnd - s.sunrise < 2 * 3600000);
  assert.ok(s.goldenEveningStart < s.sunset && s.sunset - s.goldenEveningStart < 2 * 3600000);
});
test('Tromsø: midnight sun in June, polar night in December', () => {
  const p = { tz: 'Europe/Oslo', lat: 69.65, lng: 18.96 };
  assert.strictEqual(S.sunTimes(p, at('2026-06-21T12:00:00Z')).polar, 'day');
  assert.strictEqual(S.sunTimes(p, at('2026-12-21T12:00:00Z')).polar, 'night');
  assert.strictEqual(S.sunTimes(p, at('2026-06-21T12:00:00Z')).dayLength, 24 * 3600000);
});
test('daylight fraction runs 0 → 1 between sunrise and sunset', () => {
  const s = S.sunTimes(LONDON, at('2026-10-22T12:00:00'));
  assert.strictEqual(S.daylightFraction(s, s.sunrise - 1000), 0);
  assert.strictEqual(S.daylightFraction(s, s.sunset + 1000), 1);
  assert.ok(Math.abs(S.daylightFraction(s, (s.sunrise + s.sunset) / 2) - 0.5) < 1e-9);
});
test('moon phases on known dates', () => {
  // Full moon 26 Oct 2026 ~04:12 UTC; new moon 10 Oct 2026 ~15:50 UTC.
  const full = S.moon(at('2026-10-26T04:12:00Z'));
  assert.strictEqual(full.name, 'FULL MOON');
  assert.ok(full.illumination > 0.98, full.illumination);
  const nw = S.moon(at('2026-10-10T15:50:00Z'));
  assert.strictEqual(nw.name, 'NEW MOON');
  assert.ok(nw.illumination < 0.02, nw.illumination);
  assert.ok(Math.abs(S.nextFullMoon(at('2026-10-20T00:00:00Z')) - at('2026-10-26T04:12:00Z')) < 18 * 3600000);
});
test('moon drawing: crescent lights the right side in the north, left in the south', () => {
  const m = S.moon(at('2026-10-15T12:00:00Z')); // waxing crescent, ~4 days old
  assert.ok(m.waxing);
  assert.ok(S.moonLit(8, 0, 9, m, false) && !S.moonLit(-8, 0, 9, m, false));
  assert.ok(S.moonLit(-8, 0, 9, m, true) && !S.moonLit(8, 0, 9, m, true));
});
test('panels: heights add up, any combination fits the Dot Clock width', () => {
  const s = S.sunTimes(LONDON, at('2026-10-22T12:00:00'));
  const base = { W: 141, now: at('2026-10-22T12:00:00'), s, m: S.moon(at('2026-10-22T12:00:00')), place: LONDON, fmt: (t) => hm(t), southern: false,
    colors: { text: '#ffb000', sun: '#ffd25a', moon: '#e8e4d0', sky: '#5ad1ff' } };
  const combos = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [0, 0, 0]];
  for (const [a, r, c] of combos) {
    const panels = [{ id: 'arc', enabled: !!a }, { id: 'rows', enabled: !!r }, { id: 'compact', enabled: !!c }];
    const g = WT.panels.build(Object.assign({}, base, { panels, rows: { bar: true, golden: true, length: true, moon: true } }));
    assert.strictEqual(g.w, 141);
    const expect = (a ? 30 : 0) + (r ? 16 + 3 * 7 + 3 * 4 : 0) + (c ? 7 : 0) + (a + r + c - 1) * 4 + 6;
    assert.strictEqual(g.h, a + r + c ? expect : 13, JSON.stringify([a, r, c]));
  }
});
test('store defaults and repair', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.panels.map((p) => p.id + ':' + p.enabled).join(), 'arc:true,rows:true,compact:false');
  const s = WT.store.normalize({ panels: [{ id: 'compact', enabled: true }, { id: 'nope' }], place: { tz: 'Mars/Base', lat: 0, lng: 0 } });
  assert.strictEqual(s.panels[0].id, 'compact');
  assert.strictEqual(s.panels.length, 3);
  assert.strictEqual(s.place, null);
});
test('Dot Clock home city is read', () => {
  const h = WT.worldTime.homeFrom(JSON.stringify({ clocks: [{ label: 'Paris', tz: 'Europe/Paris', lat: 48.86, lng: 2.35 }, { label: 'Home', tz: 'Europe/London', lat: 51.5, lng: -0.1, home: true }] }));
  assert.strictEqual(h.label, 'Home');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
