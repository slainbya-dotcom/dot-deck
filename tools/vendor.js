// Copies Mozilla Readability (the code behind Firefox's Reader View) from node_modules
// into src/widgets/reader/js/vendor so the app can use it. Runs automatically before `tauri build` / `tauri dev`.
// If it isn't installed, the placeholder stays and Dot Reader uses its own simpler article finder.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'widgets', 'reader', 'js', 'vendor');
let dir = null;
try { dir = path.dirname(require.resolve('@mozilla/readability/package.json', { paths: [root] })); } catch (e) { /* not installed */ }
fs.mkdirSync(out, { recursive: true });
if (dir) {
  const src = fs.readFileSync(path.join(dir, 'Readability.js'), 'utf8');
  // The file exports with `module.exports` when it can; in the app it's a plain script, so make it a global.
  fs.writeFileSync(path.join(out, 'Readability.js'), src + '\nif (typeof window !== "undefined") window.Readability = Readability;\n');
  for (const lic of ['LICENSE.md', 'LICENSE']) {
    if (fs.existsSync(path.join(dir, lic))) { fs.copyFileSync(path.join(dir, lic), path.join(out, 'Readability-LICENSE.md')); break; }
  }
  console.log('Readability copied into src/widgets/reader/js/vendor');
} else {
  fs.writeFileSync(path.join(out, 'Readability.js'), '/* Mozilla Readability is not installed (run `npm install`); Dot Reader uses its built-in article finder. */\n');
  console.log('Readability not installed: using the built-in article finder (run `npm install` to add it)');
}
