// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'player.js', 'store.js', 'worldtime.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'player', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const P = WT.player;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const colors = { track: '#ffb000', progress: '#39ff7a', buttons: '#ffb000', volume: '#5ad1ff', output: '#ff6bd5', input: '#b8ff5a' };
const np = (o) => Object.assign({ available: true, title: 'Neon Harbour', artist: 'The Low Satellites', playing: true, position: 42, duration: 233, source: 'Spotify' }, o || {});
const audio = (o) => Object.assign({
  volume: 0.62, muted: false, mic_muted: false,
  outputs: [{ id: 'a', name: 'Speakers' }, { id: 'b', name: 'Headphones' }], output: 'b',
  inputs: [{ id: 'x', name: 'Mic' }], input: 'x',
}, o || {});
const st = (o) => Object.assign(WT.store.defaults(), o || {});
const build = (o) => P.build(Object.assign({ W: 141, state: st(), np: np(), audio: audio(), scroll: 0, colors }, o || {}));
const actions = (g) => g.hits.map((h) => h.action);

test('time format', () => {
  assert.strictEqual(P.fmt(0), '0:00');
  assert.strictEqual(P.fmt(75.9), '1:15');
  assert.strictEqual(P.fmt(3725), '1:02:05');
  assert.strictEqual(P.fmt(-5), '0:00');
});
test('height follows views and ticks, not the music', () => {
  const full = build();
  assert.strictEqual(full.h, 3 * 2 + 6 * 7 + 5 * 3);
  assert.strictEqual(build({ np: { available: false } }).h, full.h);
  assert.strictEqual(build({ np: np({ title: 'A much much longer title than will ever fit on the widget' }) }).h, full.h);
  const two = build({ state: st({ layout: 'two' }) });
  assert.strictEqual(two.h, full.h + 10);
});
test('views switch whole groups of rows', () => {
  const noSound = build({ state: st({ views: { player: true, sound: false } }) });
  assert.strictEqual(noSound.h, 3 * 2 + 3 * 7 + 2 * 3);
  assert.ok(!actions(noSound).includes('volume') && !actions(noSound).includes('device'));
  const soundOnly = build({ state: st({ views: { player: false, sound: true } }) });
  assert.strictEqual(soundOnly.h, 3 * 2 + 3 * 7 + 2 * 3);
  assert.ok(!actions(soundOnly).includes('toggle'));
  assert.ok(actions(soundOnly).includes('volume'));
  const none = build({ state: st({ views: { player: false, sound: false } }) });
  assert.ok(none.cidx.some((v) => v), 'hint drawn');
  assert.strictEqual(none.hits.length, 0);
});
test('rows inside a view have their own ticks', () => {
  const s = st(); s.rows.output = false; s.rows.buttons = false;
  const g = build({ state: s });
  assert.strictEqual(g.h, 3 * 2 + 4 * 7 + 3 * 3);
  assert.ok(!actions(g).includes('prev'));
  assert.strictEqual(g.hits.filter((h) => h.action === 'device').length, 0, 'input has only one device so no arrows');
});
test('long text scrolls, short text does not', () => {
  assert.strictEqual(build({ np: np({ title: 'Hi', artist: 'Yo' }), state: st({ rows: { progress: true, buttons: true, volume: true, output: false, input: false } }) }).scrolling, false);
  assert.strictEqual(build().scrolling, true);
  const a = build({ scroll: 0 }), b = build({ scroll: 37 });
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''));
});
test('click regions', () => {
  const g = build();
  for (const a of ['toggle', 'prev', 'next', 'seek', 'volume', 'mute', 'device', 'fold', 'mic']) assert.ok(actions(g).includes(a), a);
  const seek = g.hits.find((h) => h.action === 'seek');
  assert.strictEqual(P.hitAt(g, (seek.x0 + seek.x1) / 2, seek.y0 + 3).action, 'seek');
  assert.strictEqual(P.hitAt(g, 1, 1), null);
});
test('nothing playing / live streams / no volume control', () => {
  const g = build({ np: { available: false } });
  assert.ok(!actions(g).includes('seek'));
  const live = build({ np: np({ duration: 0 }) });
  assert.ok(!actions(live).includes('seek'));
  const noVol = build({ audio: audio({ volume: null }) });
  assert.ok(!actions(noVol).includes('volume'));
  const loading = build({ audio: null });
  assert.ok(!actions(loading).includes('mute') && !actions(loading).includes('device'));
  const noMic = build({ audio: audio({ mic_muted: null }) });
  assert.ok(!actions(noMic).includes('mic'));
});
test('device cycling wraps', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.strictEqual(P.cycle(list, 'c', 1), 'a');
  assert.strictEqual(P.cycle(list, 'a', -1), 'c');
  assert.strictEqual(P.cycle(list, 'zzz', 1), 'b');
  assert.strictEqual(P.cycle([], 'a', 1), null);
});
test('nothing is drawn in the margins, at any width', () => {
  for (const W of [80, 141, 400]) {
    for (const layout of ['one', 'two']) {
      const g = build({ W, state: st({ layout }), scroll: 55 });
      for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `W${W} ${layout} x${x} y${y}`);
      for (let x = 0; x < g.w; x++) for (const y of [0, 1, 2, g.h - 1, g.h - 2, g.h - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `W${W} ${layout} x${x} y${y}`);
    }
  }
});
test('simulator behaves like a player', () => {
  const s = P.simulator();
  const a = s.readPlayer();
  assert.ok(a.available && a.duration > 0);
  s.action('next'); assert.notStrictEqual(s.readPlayer().title, a.title);
  s.action('toggle'); assert.strictEqual(s.readPlayer().playing, false);
  s.setDevice('output', 'o3'); assert.strictEqual(s.readAudio().output, 'o3');
});
test('store: defaults and repair', () => {
  const d = WT.store.normalize(null);
  assert.strictEqual(d.views.player, true);
  assert.strictEqual(d.views.sound, true);
  assert.strictEqual(d.layout, 'one');
  const s = WT.store.normalize({ views: { sound: false }, rows: { input: 'yes' }, speed: 3, source: 'winamp', colors: { track: 'red', volume: '#ABCDEF' }, layout: 'two' });
  assert.strictEqual(s.views.sound, false);
  assert.strictEqual(s.views.player, true);
  assert.strictEqual(s.rows.input, true);
  assert.strictEqual(s.speed, 2);
  assert.strictEqual(s.source, 'auto');
  assert.strictEqual(s.colors.track, '#ffb000');
  assert.strictEqual(s.colors.volume, '#abcdef');
  assert.strictEqual(s.layout, 'two');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
