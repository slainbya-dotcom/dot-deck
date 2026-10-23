"""Copies each separate Dot app's UI into Dot Deck (src/widgets/<id>/) and its tests
into tests/widgets/<id>.js, adding the small Deck bridge to every page.

  python3 tools/import_widgets.py <folder holding dot-clock, dot-timer, ...> [id ...]

Run it again after changing one of the separate apps to bring the change into Dot Deck."""
import os, re, shutil, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..")
ONLY = sys.argv[2:]
# Deck id -> the separate app's folder
APPS = {
    "clock": "dot-clock", "timer": "dot-timer", "focus": "dot-focus", "calendar": "dot-calendar",
    "sun": "dot-sun", "ticker": "dot-ticker", "planner": "dot-planner", "system": "dot-system",
    "player": "dot-player", "weather": "dot-weather", "dice": "dot-dice", "visualiser": "dot-visualiser",
    "list": "dot-list", "launcher": "dot-launcher", "clipboard": "dot-clipboard", "reader": "dot-reader",
}
BRIDGE = '<script src="../../deck/bridge.js"></script>\n  '

for wid, folder in APPS.items():
    if ONLY and wid not in ONLY:
        continue
    src = os.path.join(SRC, folder, "src")
    if not os.path.isdir(src):
        print("skip", wid, "(", src, "not found )")
        continue
    dst = os.path.join(ROOT, "src", "widgets", wid)
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("Readability-LICENSE.md"))
    for page in ("index.html", "settings.html"):
        p = os.path.join(dst, page)
        html = open(p, encoding="utf-8").read()
        if "deck/bridge.js" not in html:
            # The bridge must run before any of the page's own scripts.
            html = html.replace("<script src=", BRIDGE + "<script src=", 1)
        open(p, "w", encoding="utf-8").write(html)
    # Point the app's code at the bridge's version of the Tauri API.
    for dirpath, _, files in os.walk(os.path.join(dst, "js")):
        for f in files:
            if f.endswith(".js") and "vendor" not in dirpath:
                q = os.path.join(dirpath, f)
                code = open(q, encoding="utf-8").read()
                if "window.__TAURI__" in code and "__DECK_TAURI__" not in code:
                    open(q, "w", encoding="utf-8").write(code.replace("window.__TAURI__", "(window.__DECK_TAURI__ || window.__TAURI__)"))
    if wid == "reader":
        open(os.path.join(dst, "js", "vendor", "Readability.js"), "w").write(
            "/* Filled in by tools/vendor.js before each build. */\n")
    # The app's own tests, pointed at the copy inside Dot Deck.
    t = os.path.join(SRC, folder, "tests", "run-tests.js")
    if os.path.exists(t):
        code = open(t, encoding="utf-8").read()
        code = code.replace("path.join(__dirname, '..', 'src', 'js', f)", "path.join(__dirname, '..', '..', 'src', 'widgets', '%s', 'js', f)" % wid)
        code = code.replace("process.exit(failed ? 1 : 0);", "module.exports = { passed, failed };")
        os.makedirs(os.path.join(ROOT, "tests", "widgets"), exist_ok=True)
        open(os.path.join(ROOT, "tests", "widgets", wid + ".js"), "w", encoding="utf-8").write(code)
    print("imported", wid)
