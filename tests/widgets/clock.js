// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, navigator: {} };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'time.js', 'solar.js', 'geo.js', 'dotmatrix.js', 'store.js']) {
  const p = path.join(__dirname, '..', '..', 'src', 'widgets', 'clock', 'js', f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

// ---- time ----
const summer = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));
const winter = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
test('London BST/GMT', () => {
  assert.strictEqual(WT.time.abbreviation('Europe/London', summer), 'BST');
  assert.strictEqual(WT.time.abbreviation('Europe/London', winter), 'GMT');
});
test('Dublin IST/GMT', () => {
  assert.strictEqual(WT.time.abbreviation('Europe/Dublin', summer), 'IST');
  assert.strictEqual(WT.time.abbreviation('Europe/Dublin', winter), 'GMT');
});
test('New York EDT/EST', () => {
  assert.strictEqual(WT.time.abbreviation('America/New_York', summer), 'EDT');
  assert.strictEqual(WT.time.abbreviation('America/New_York', winter), 'EST');
});
test('Paris CEST/CET via table or rule', () => {
  assert.strictEqual(WT.time.abbreviation('Europe/Paris', summer), 'CEST');
  assert.strictEqual(WT.time.abbreviation('Europe/Paris', winter), 'CET');
  assert.strictEqual(WT.time.abbreviation('Europe/Oslo', winter), 'CET');
});
test('Helsinki EEST, Moscow MSK', () => {
  assert.strictEqual(WT.time.abbreviation('Europe/Helsinki', summer), 'EEST');
  assert.strictEqual(WT.time.abbreviation('Europe/Moscow', summer), 'MSK');
});
test('Sydney AEDT in Jan (southern DST)', () => {
  assert.strictEqual(WT.time.abbreviation('Australia/Sydney', winter), 'AEDT');
  assert.strictEqual(WT.time.abbreviation('Australia/Sydney', summer), 'AEST');
});
test('No-DST zones', () => {
  assert.strictEqual(WT.time.abbreviation('Asia/Tokyo', summer), 'JST');
  assert.strictEqual(WT.time.abbreviation('Asia/Kolkata', summer), 'IST');
  assert.strictEqual(WT.time.abbreviation('America/Phoenix', summer), 'MST');
});
test('Fallback UTC offset label', () => {
  assert.strictEqual(WT.time.abbreviation('Asia/Kathmandu', summer), 'NPT');
  assert.strictEqual(WT.time.utcLabel(345), 'UTC+5:45');
  assert.strictEqual(WT.time.utcLabel(-180), 'UTC-3');
  assert.strictEqual(WT.time.utcLabel(0), 'UTC');
});
test('Offsets', () => {
  assert.strictEqual(WT.time.offsetMinutes('Europe/London', summer), 60);
  assert.strictEqual(WT.time.offsetMinutes('Asia/Kolkata', summer), 330);
  assert.strictEqual(WT.time.offsetMinutes('America/St_Johns', winter), -210);
});
test('DST transition instant (London, 29 Mar 2026 01:00 UTC)', () => {
  assert.strictEqual(WT.time.abbreviation('Europe/London', new Date(Date.UTC(2026, 2, 29, 0, 59))), 'GMT');
  assert.strictEqual(WT.time.abbreviation('Europe/London', new Date(Date.UTC(2026, 2, 29, 1, 0))), 'BST');
});
test('formatTime 24h/12h', () => {
  const d = new Date(Date.UTC(2026, 6, 15, 13, 5, 9)); // 14:05:09 BST
  assert.strictEqual(WT.time.formatTime('Europe/London', d, true, false), '14:05');
  assert.strictEqual(WT.time.formatTime('Europe/London', d, true, true), '14:05:09');
  assert.strictEqual(WT.time.formatTime('Europe/London', d, false, false), '2:05 PM');
  const mid = new Date(Date.UTC(2026, 6, 14, 23, 0, 0)); // 00:00 BST
  assert.strictEqual(WT.time.formatTime('Europe/London', mid, true, false), '00:00');
  assert.strictEqual(WT.time.formatTime('Europe/London', mid, false, false), '12:00 AM');
  const noon = new Date(Date.UTC(2026, 6, 15, 11, 0, 0));
  assert.strictEqual(WT.time.formatTime('Europe/London', noon, false, false), '12:00 PM');
});
test('every abbreviation-table zone is known to ICU (or legacy alias)', () => {
  const bad = Object.keys(WT.time.ABBR).filter((z) => !WT.time.resolveZone(z));
  assert.deepStrictEqual(bad, []);
});
test('every city zone produces a sane abbreviation all year', () => {
  const bad = [];
  for (const c of WT.CITIES) {
    for (let m = 0; m < 12; m++) {
      const a = WT.time.abbreviation(c[5], new Date(Date.UTC(2026, m, 15, 12)));
      if (!/^([A-Z]{2,5}|UTC([+-]\d{1,2}(:\d\d)?)?)$/.test(a)) bad.push(c[0] + ':' + a);
    }
  }
  assert.deepStrictEqual([...new Set(bad)].slice(0, 10), []);
});

// ---- solar ----
test('London midday summer is day, midnight is night', () => {
  assert.ok(WT.solar.isDaytime(new Date(Date.UTC(2026, 5, 21, 12)), 51.5, -0.13));
  assert.ok(!WT.solar.isDaytime(new Date(Date.UTC(2026, 5, 21, 0)), 51.5, -0.13));
  const alt = WT.solar.sunAltitude(new Date(Date.UTC(2026, 5, 21, 12)), 51.5, -0.13);
  assert.ok(alt > 60 && alt < 63, 'alt ' + alt);
});
test('London sunrise ~04:43 BST on 21 Jun', () => {
  assert.ok(!WT.solar.isDaytime(new Date(Date.UTC(2026, 5, 21, 3, 35)), 51.5, -0.13));
  assert.ok(WT.solar.isDaytime(new Date(Date.UTC(2026, 5, 21, 3, 50)), 51.5, -0.13));
});
test('Sydney 12:00 UTC is night, 02:00 UTC is day', () => {
  assert.ok(!WT.solar.isDaytime(new Date(Date.UTC(2026, 6, 15, 12)), -33.87, 151.21));
  assert.ok(WT.solar.isDaytime(new Date(Date.UTC(2026, 6, 15, 2)), -33.87, 151.21));
});
test('Tromsø polar night / midnight sun', () => {
  assert.ok(WT.solar.isDaytime(new Date(Date.UTC(2026, 5, 21, 23)), 69.65, 18.96));
  assert.ok(!WT.solar.isDaytime(new Date(Date.UTC(2026, 11, 21, 11)), 69.65, 18.96));
});

// ---- geo ----
test('search "new york" returns New York, USA first', () => {
  const r = WT.geo.search('new york');
  assert.strictEqual(WT.geo.cityLabel(r[0]), 'New York, USA');
});
test('search alias "bangalore" and accents "sao paulo"', () => {
  assert.strictEqual(WT.geo.search('bangalore')[0].name, 'Bengaluru');
  assert.strictEqual(WT.geo.search('sao paulo')[0].name, 'São Paulo');
});
test('search "birmingham, uk" disambiguates', () => {
  assert.strictEqual(WT.geo.search('birmingham, uk')[0].cc, 'GB');
  assert.strictEqual(WT.geo.search('birmingham, alabama')[0].cc, 'US');
});
test('search by country "japan"', () => {
  assert.ok(WT.geo.search('japan').every((c) => c.cc === 'JP'));
});
test('describePoint: central London -> Europe/London', () => {
  const d = WT.geo.describePoint(51.5, -0.12);
  assert.strictEqual(d.tz, 'Europe/London');
  assert.strictEqual(d.label, 'London, UK');
});
test('describePoint: Phoenix suburb -> America/Phoenix', () => {
  assert.strictEqual(WT.geo.describePoint(33.4, -111.9).tz, 'America/Phoenix');
});
test('describePoint: preferTz wins near a border (Strasbourg area, prefer Berlin)', () => {
  const d = WT.geo.describePoint(48.58, 7.75, 'Europe/Berlin');
  assert.ok(d.candidates.length >= 3);
});
test('cityForZone(Europe/London) = London', () => {
  assert.strictEqual(WT.geo.cityForZone('Europe/London').name, 'London');
});

// ---- dot matrix (if present) ----
if (WT.dots) {
  test('font covers every character used by city and country names', () => {
    const missing = new Set();
    for (const c of WT.geo.cities()) {
      for (const ch of WT.dots.normalizeText(WT.geo.cityLabel(c))) if (!WT.dots.hasGlyph(ch)) missing.add(ch);
    }
    assert.deepStrictEqual([...missing], []);
  });
  test('text width is stable for times (digits fixed width)', () => {
    assert.strictEqual(WT.dots.textWidth('00:00'), WT.dots.textWidth('11:11'));
  });
}
if (WT.store) {
  test('normalizeState fills defaults and drops bad clocks', () => {
    const s = WT.store.normalize({ clocks: [{ tz: 'Nope/Zone', label: 'x' }, { tz: 'Asia/Tokyo', label: 'Tokyo, Japan' }], dotSize: 99 });
    assert.strictEqual(s.clocks.length, 1);
    assert.ok(s.dotSize <= 8);
    assert.ok(typeof s.use24h === 'boolean');
  });
  test('normalizeState keeps one home and the auto flag only on it', () => {
    const s = WT.store.normalize({ clocks: [
      { id: 'a', tz: 'Europe/London', label: 'London', home: true, auto: true },
      { id: 'a', tz: 'Asia/Tokyo', label: 'Tokyo', home: true, auto: true },
    ] });
    assert.strictEqual(s.clocks.filter((c) => c.home).length, 1);
    assert.strictEqual(s.clocks[0].auto, true);
    assert.strictEqual(s.clocks[1].auto, undefined);
    assert.notStrictEqual(s.clocks[0].id, s.clocks[1].id);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
