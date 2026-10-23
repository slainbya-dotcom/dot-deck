// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, JSON, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'data.js', 'geo.js', 'weather.js', 'forecast.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'weather', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const Wx = WT.weather;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

// A small Open-Meteo-shaped reply for London in BST (UTC+1), fetched 2026-10-22 14:20 local.
const OFF = 3600;
const hours = [], temps = [], codes = [], rain = [], isDay = [];
for (let i = 0; i < 48; i++) {
  const d = 22 + Math.floor(i / 24), h = i % 24;
  hours.push(`2026-10-${d}T${String(h).padStart(2, '0')}:00`);
  temps.push(10 + i % 10); codes.push(i % 2 ? 61 : 2); rain.push(i * 2); isDay.push(h >= 7 && h < 18 ? 1 : 0);
}
const reply = {
  utc_offset_seconds: OFF,
  current: { time: '2026-10-22T14:15', temperature_2m: 16.6, weather_code: 3, is_day: 1 },
  hourly: { time: hours, temperature_2m: temps, weather_code: codes, precipitation_probability: rain, is_day: isDay },
  daily: { time: ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'], weather_code: [61, 2, 0, 95, 3], temperature_2m_max: [19, 17, 22, 20, 14], temperature_2m_min: [11, 9, 12, 13, 8] },
};
const at = (s) => Wx.localToEpoch(s, OFF);   // local time at the place -> epoch
const NOW = at('2026-10-22T14:20');
const model = Wx.parse(reply, NOW);
const place = { id: 'a', label: 'London, UK', name: 'London, England, UK', lat: 51.5, lng: -0.13, tz: 'Europe/London' };
const opts = (o) => Object.assign({ W: 141, style: 'now', places: [{ place, view: Wx.view(model, NOW), status: 'ok' }], frame: 3, unit: 'C', use24h: true, days: 4, color: '#ffb000', icons: 'natural' }, o || {});
const lit = (g) => g.cidx.reduce((n, v) => n + (v ? 1 : 0), 0);

test('weather codes -> icon and words', () => {
  assert.strictEqual(Wx.describe(0, true).icon, 'sun');
  assert.strictEqual(Wx.describe(0, false).icon, 'night');
  assert.strictEqual(Wx.describe(2, false).icon, 'nightpart');
  assert.strictEqual(Wx.describe(63).text, 'RAIN');
  assert.strictEqual(Wx.describe(67).icon, 'sleet');
  assert.strictEqual(Wx.describe(86).icon, 'snow');
  assert.strictEqual(Wx.describe(99).icon, 'storm');
  for (const c of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) {
    const d = Wx.describe(c, true);
    assert.ok(d.text && WT.dots.normalizeText(d.text) === d.text, 'drawable text for ' + c);
  }
});
test('request asks for everything in one call', () => {
  const u = Wx.url(place);
  assert.ok(u.startsWith('https://api.open-meteo.com/v1/forecast?'));
  for (const p of ['latitude=51.500', 'longitude=-0.130', 'current=', 'hourly=', 'daily=', 'timezone=auto']) assert.ok(u.includes(p), p);
});
test('parse + view: current, hours from now, days from today', () => {
  const v = Wx.view(model, NOW);
  assert.strictEqual(v.now.t, 16.6);
  assert.strictEqual(v.now.text, 'CLOUDY');
  assert.strictEqual(v.hours[0].hour, 14);
  assert.strictEqual(v.hours.length, 24);
  assert.strictEqual(v.days[0].today, true);
  assert.strictEqual(v.days[0].dow, 'THU');
  assert.strictEqual(v.days[1].dow, 'FRI');
});
test('an old forecast moves on with the clock', () => {
  const later = at('2026-10-23T09:10');
  const v = Wx.view(model, later);
  assert.strictEqual(v.hours[0].hour, 9);
  assert.strictEqual(v.days[0].dow, 'FRI');
  assert.strictEqual(v.days[0].today, true);
  assert.strictEqual(v.now.t, v.hours[0].t, 'stale "current" is replaced by the hour');
});
test('bad replies are rejected', () => {
  assert.throws(() => Wx.parse({ error: true, reason: 'Latitude must be in range' }), /Latitude/);
  assert.throws(() => Wx.parse('{}'));
});
test('style sizes are fixed (C follows the days setting)', () => {
  const h = (o) => Wx.build(opts(o)).h;
  assert.strictEqual(h({ style: 'now' }), 31);
  assert.strictEqual(h({ style: 'hours' }), 33);
  assert.strictEqual(h({ style: 'graph' }), 41);
  assert.strictEqual(h({ style: 'days', days: 1 }), 13);
  assert.strictEqual(h({ style: 'days', days: 4 }), 43);
  // no data yet: same size, so the widget doesn't jump when the forecast arrives
  assert.strictEqual(Wx.build(opts({ style: 'now', places: [{ place, view: null, status: 'loading' }] })).h, 31);
});
test('A and D show the place name; changing it changes the picture', () => {
  for (const style of ['now', 'graph']) {
    const a = Wx.build(opts({ style }));
    const b = Wx.build(opts({ style, places: [{ place: Object.assign({}, place, { label: 'Home' }), view: Wx.view(model, NOW), status: 'ok' }] }));
    assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''), style);
  }
});
test('C shows 1 to 4 days', () => {
  const n1 = lit(Wx.build(opts({ style: 'days', days: 1 }))), n4 = lit(Wx.build(opts({ style: 'days', days: 4 })));
  assert.ok(n1 > 20 && n4 > n1 * 2.5);
});
test('E: one row per place, offline places say so', () => {
  const two = [{ place, view: Wx.view(model, NOW), status: 'ok' }, { place: Object.assign({}, place, { id: 'b', label: 'Tokyo' }), view: null, status: 'error' }];
  const g = Wx.build(opts({ style: 'cities', places: two }));
  assert.strictEqual(g.h, 3 * 2 + 2 * 7 + WT.dots.GAP);
  assert.strictEqual(Wx.build(opts({ style: 'cities', places: [] })).h, 3 * 2 + 7);
});
test('°F and 12-hour change the drawing', () => {
  assert.notStrictEqual(Wx.build(opts({ unit: 'F' })).cidx.join(''), Wx.build(opts()).cidx.join(''));
  assert.notStrictEqual(Wx.build(opts({ style: 'hours', use24h: false })).cidx.join(''), Wx.build(opts({ style: 'hours' })).cidx.join(''));
});
test('icons animate', () => {
  const sig = (g) => g.cidx.join('') + Array.from(g.alpha, (a) => a.toFixed(2)).join('');
  assert.notStrictEqual(sig(Wx.build(opts({ style: 'hours', frame: 0 }))), sig(Wx.build(opts({ style: 'hours', frame: 3 }))));
  const rainy = Wx.view(Wx.parse(Object.assign({}, reply, { current: Object.assign({}, reply.current, { weather_code: 63 }) }), NOW), NOW);
  const r = (f) => Wx.build(opts({ frame: f, places: [{ place, view: rainy, status: 'ok' }] })).cidx.join('');
  assert.notStrictEqual(r(0), r(2), 'rain falls');
});
test('nothing is drawn in the margins, any style, width, data', () => {
  const views = [Wx.view(model, NOW), null];
  for (const W of [80, 141, 400]) for (const style of Wx.STYLES) for (const view of views) for (const unit of ['C', 'F']) {
    const g = Wx.build(opts({ W, style, unit, places: [{ place: Object.assign({}, place, { label: 'A very long place name indeed' }), view, status: 'ok' }] }));
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${style} W${W} x${x}`);
    for (let x = 0; x < g.w; x++) for (const y of [0, 1, 2, g.h - 1, g.h - 2, g.h - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${style} W${W} y${y}`);
  }
});
test('simulated reply parses (preview mode)', () => {
  const m = Wx.parse(Wx.simulate(place, Date.now()));
  const v = Wx.view(m, Date.now());
  assert.ok(v && v.hours.length >= 20 && v.days.length >= 4);
});
test('store: defaults, starting place and repair', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.style, 'now');
  assert.strictEqual(d.days, 4);
  const s = WT.store.normalize({ style: 'nope', days: 9, unit: 'K', places: [{ label: 'X', lat: 91, lng: 0 }, { label: '  Home ', lat: 51.5, lng: -0.1, tz: 'Bad/Zone' }, null] });
  assert.strictEqual(s.style, 'now');
  assert.strictEqual(s.days, 4);
  assert.ok(s.unit === 'C' || s.unit === 'F');
  assert.strictEqual(s.places.length, 1);
  assert.strictEqual(s.places[0].label, 'Home');
  assert.strictEqual(s.places[0].tz, 'UTC');
  const clock = JSON.stringify({ clocks: [{ label: 'Bristol, UK', tz: 'Europe/London', lat: 51.45, lng: -2.59, home: true }] });
  const p = WT.store.startingPlace(clock);
  assert.strictEqual(p.label, 'Bristol, UK');
  assert.ok(WT.store.startingPlace(null), 'falls back to the system time zone');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
