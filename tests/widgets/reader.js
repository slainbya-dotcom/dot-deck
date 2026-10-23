// Plain Node tests for the pure logic (no browser needed): `npm test`
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console, Intl, Date, Math, JSON, URL, navigator: {}, setTimeout, clearTimeout };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['time.js', 'dotmatrix.js', 'reader.js', 'store.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'widgets', 'reader', 'js', f), 'utf8'), ctx, { filename: f });
}
const WT = ctx.WT;
const R = WT.reader;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}
const article = {
  url: 'https://example.com/a', title: 'A test article',
  blocks: [
    { t: 'h1', r: [['A test article']] },
    { t: 'meta', r: [['2 min read']] },
    { t: 'p', r: [['Some text with a ', {}], ['link in it', { href: 'https://example.com/b' }], [' and more words after the link so that it wraps over several lines.', {}]] },
    { t: 'h2', r: [['A heading']] },
    { t: 'li', r: [['First point']] }, { t: 'li', r: [['Second point']], n: 0 },
    { t: 'li', r: [['Numbered']], n: 12 },
    { t: 'quote', r: [['A quote that is quite long and should wrap onto a second line in a narrow widget.']] },
    { t: 'pre', r: [['line one\n  line two']] },
    { t: 'img', r: [['A caption']] },
    { t: 'hr' },
    { t: 'p', r: [['https://a-very-long-address.example.com/with/a/path/that/does/not/fit/on/one/line/at/all']] },
  ],
};
const build = (o) => {
  const W = (o && o.W) || 180;
  const laid = R.layout(article.blocks, W - 10);
  return R.build(Object.assign({ W, H: 130, page: article, laid, scroll: 0, nav: { back: true, fwd: false }, editing: null, loading: false, error: null, t: 0, color: '#ffb000' }, o || {}));
};

test('lower case has proper shapes, with tails below the line', () => {
  const g = R.glyph('g'), a = R.glyph('a'), A = R.glyph('A');
  assert.ok(g.some((m) => m & (1 << 8)), 'g dips to row 9');
  assert.ok(!a.some((m) => m & (1 << 8)), 'a sits on the line');
  assert.ok(A.some((m) => m & 1), 'capitals reach the top');
  assert.ok(R.glyph('i').length < R.glyph('m').length, 'narrow letters are narrower');
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') assert.ok(R.glyph(ch).length >= 1 && R.glyph(ch).some(Boolean), ch);
});
test('plain() keeps case, fixes quotes, dashes, accents', () => {
  assert.strictEqual(R.plain('Café “quoted” — it’s naïve'), 'Cafe "quoted" - it\'s naive');
  assert.strictEqual(R.plain('a b'), 'a b');
});
test('wrapping fits the width, and very long words are broken', () => {
  for (const W of [110, 180, 400]) {
    const tw = W - 10;
    const laid = R.layout(article.blocks, tw);
    for (const l of laid.lines) for (const r of l.runs || []) assert.ok(r.x + R.widthOf(r.text) <= tw + 1, `W${W}: "${r.text}" at ${r.x}`);
  }
  const narrow = R.layout(article.blocks, 100), wide = R.layout(article.blocks, 400);
  assert.ok(narrow.height > wide.height, 'narrower = taller');
});
test('links keep their address on every word', () => {
  const laid = R.layout(article.blocks, 170);
  const linked = laid.lines.flatMap((l) => l.runs || []).filter((r) => r.href);
  assert.ok(linked.length >= 2);
  assert.ok(linked.every((r) => r.href === 'https://example.com/b'));
});
test('lists: bullets and numbers', () => {
  const laid = R.layout(article.blocks, 170);
  const firsts = laid.lines.filter((l) => l.kind === 'li' && l.first);
  assert.strictEqual(firsts[0].bullet, true);
  assert.strictEqual(firsts[2].bullet, '12.');
  assert.ok(firsts[2].runs[0].x > firsts[0].runs[0].x, 'room for the number');
});
test('the widget: fixed size, chrome hits, link hits, scrolling', () => {
  const g = build();
  assert.strictEqual(g.w, 180); assert.strictEqual(g.h, 130);
  const acts = g.hits.map((h) => h.action);
  for (const a of ['back', 'home', 'address', 'external', 'link']) assert.ok(acts.includes(a), a);
  assert.ok(!acts.includes('fwd'));
  assert.ok(g.maxScroll > 0);
  const s = build({ scroll: 60 });
  assert.strictEqual(s.scrollTop, 60);
  assert.notStrictEqual(s.cidx.join(''), g.cidx.join(''));
  assert.strictEqual(build({ scroll: 1e9 }).scrollTop, g.maxScroll, 'clamped');
  // Nothing drawn outside the page area except the bars.
});
test('loading, typing the address, errors and hover', () => {
  const plain = build();
  assert.notStrictEqual(build({ loading: true }).cidx.join(''), plain.cidx.join(''));
  const a = build({ editing: 'bbc.co.uk', t: 0 }), b = build({ editing: 'bbc.co.uk', t: 0.5 });
  assert.notStrictEqual(a.cidx.join(''), b.cidx.join(''), 'cursor blinks');
  const err = build({ error: 'the site answered 404', laid: null });
  assert.ok(err.hits.some((h) => h.action === 'external'), 'offers your browser');
  assert.notStrictEqual(build({ hoverHref: 'https://example.com/b' }).cidx.join(''), plain.cidx.join(''));
});
test('nothing is drawn in the margins, at any size', () => {
  for (const [W, H] of [[110, 60], [180, 130], [420, 320]]) for (const o of [{}, { scroll: 37 }, { editing: 'a'.repeat(300) }, { loading: true }]) {
    const g = build(Object.assign({ W, H }, o));
    for (let y = 0; y < g.h; y++) for (const x of [0, 1, 2, g.w - 1, g.w - 2, g.w - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${W}x${H} x${x} y${y}`);
    for (let x = 0; x < g.w; x++) for (const y of [0, 1, 2, g.h - 1, g.h - 2, g.h - 3]) assert.strictEqual(g.cidx[y * g.w + x], 0, `${W}x${H} x${x} y${y}`);
  }
});
test('built-in pages lay out', () => {
  for (const p of Object.values(R.BUILTIN)) assert.ok(R.layout(p.blocks, 170).height > 50, p.url);
});
test('addresses', () => {
  const n = WT.store.normalizeUrl;
  assert.strictEqual(n('bbc.co.uk/news'), 'https://bbc.co.uk/news');
  assert.strictEqual(n('http://example.com'), 'http://example.com/');
  assert.strictEqual(n('dot:welcome'), 'dot:welcome');
  assert.strictEqual(n('javascript:alert(1)'), '');
  assert.strictEqual(n('file:///etc/passwd'), '');
  assert.strictEqual(n('hello'), '');
});
test('store: own size, repair', () => {
  const s = WT.store.normalize({ W: 5000, H: 10, home: 'not a url', color: 'red' });
  assert.strictEqual(s.W, 420); assert.strictEqual(s.H, 60);
  assert.strictEqual(s.home, 'dot:welcome');
  assert.strictEqual(s.color, '#ffb000');
});

console.log(`\n${passed} passed, ${failed} failed`);
module.exports = { passed, failed };
