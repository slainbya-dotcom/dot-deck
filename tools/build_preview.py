"""Builds a single-file preview of the Dot Deck settings window (with a pretend
Dot Deck behind it) so the UI can be checked in any browser without building.
Every widget's real settings page is included, running through the real bridge.

  python3 tools/build_preview.py [out_dir]"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "preview")
os.makedirs(OUT, exist_ok=True)
SRC = os.path.join(ROOT, "src")
WIDGETS = [d for d in sorted(os.listdir(os.path.join(SRC, "widgets"))) if os.path.exists(os.path.join(SRC, "widgets", d, "settings.html"))]


def inline(path, head=""):
    base = os.path.dirname(path)
    src = open(path, encoding="utf-8").read()
    src = re.sub(r'<link rel="stylesheet" href="([^"]+)">',
                 lambda m: "<style>" + open(os.path.normpath(os.path.join(base, m.group(1))), encoding="utf-8").read() + "</style>", src)
    src = re.sub(r'<script src="([^"]+)"></script>',
                 lambda m: "<script>" + open(os.path.normpath(os.path.join(base, m.group(1))), encoding="utf-8").read()
                 .replace("</script", "<\\/script") + "</script>", src)
    return src.replace("<head>", "<head>" + head, 1)


docs = {}
for w in WIDGETS:
    docs[w] = inline(os.path.join(SRC, "widgets", w, "settings.html"), "<script>window.__DECK_APP__ = %s;</script>" % json.dumps(w))

CLOCK = {"clocks": [{"id": "h", "label": "London, UK", "tz": "Europe/London", "lat": 51.51, "lng": -0.13, "home": True},
                    {"id": "a", "label": "New York, USA", "tz": "America/New_York", "lat": 40.71, "lng": -74.01},
                    {"id": "b", "label": "Tokyo, Japan", "tz": "Asia/Tokyo", "lat": 35.68, "lng": 139.69}],
         "use24h": True, "dotColor": "#ffb000", "dotSize": 3, "bgColor": "#101010", "bgOpacity": 0.85}
NAMES = {"clock": "Clock", "timer": "Timer", "focus": "Focus", "calendar": "Calendar", "sun": "Sun", "ticker": "Ticker",
         "planner": "Planner", "system": "System", "player": "Player", "weather": "Weather", "dice": "Dice",
         "visualiser": "Visualiser", "list": "List", "launcher": "Launcher", "clipboard": "Clipboard", "reader": "Reader"}

shim = """<script>
(function () {
  const DOCS = %(docs)s;
  const ALL = %(names)s;
  const ids = Object.keys(ALL).filter((k) => DOCS[k]);
  const deck = {
    on: { clock: true, weather: true, list: true }, scale: 1, own: {}, lock: false, snap: true, arrange: false, hidden: false,
    setups: [
      { key: 'a', name: '1 screen (1440×900)', current: true, widgets: 3 },
      { key: 'b', name: '2 screens (2560×1440 + 1440×900)', current: false, widgets: 3 },
    ],
  };
  const states = { clock: JSON.stringify(%(clock)s) };
  const handlers = {};
  const emit = (name, payload) => (handlers[name] || []).forEach((f) => { try { f({ event: name, payload }); } catch (e) { console.error(e); } });
  const status = () => ({
    widgets: ids.map((id) => ({ id, name: ALL[id], enabled: !!deck.on[id], scale: deck.own[id] || 1, importable: id === 'timer' || id === 'list' })),
    scale: deck.scale, lock: deck.lock, snap: deck.snap, arrange: deck.arrange, hidden: deck.hidden, setups: deck.setups,
  });
  window.__TAURI__ = {
    core: { invoke: async (cmd, a) => {
      a = a || {};
      switch (cmd) {
        case 'deck_status': return status();
        case 'deck_set_enabled': deck.on[a.id] = a.on; return;
        case 'deck_set_scale': if (a.id) deck.own[a.id] = a.scale; else deck.scale = a.scale; return;
        case 'deck_set_option': deck[a.name] = a.value; return;
        case 'deck_set_hidden': deck.hidden = a.hidden; return;
        case 'deck_setup': if (a.action === 'rename') deck.setups.find((s) => s.key === a.key).name = a.name; if (a.action === 'forget') deck.setups = deck.setups.filter((s) => s.key !== a.key); return;
        case 'deck_import': return ['timer', 'list'];
        case 'load_state': return states[a.app] || 'null';
        case 'save_state': states[a.app] = a.json; setTimeout(() => emit('state-changed:' + a.app, a.json), 0); return;
        case 'read_world_time': return states.clock;
        case 'quit': deck.on[a.app] = false; emit('deck-changed'); return;
        default: return null;
      }
    } },
    event: { listen: async (name, cb) => { (handlers[name] = handlers[name] || []).push(cb); return () => {}; } },
    window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => {}, setSize: async () => {} }) },
  };
  window.__DECK_FRAME_SRC__ = (frame, id) => { frame.srcdoc = DOCS[id] || '<p>Not in this preview.</p>'; };
})();
</script>""" % {"docs": json.dumps(docs).replace("</", "<\\/"), "names": json.dumps(NAMES), "clock": json.dumps(CLOCK)}

page = inline(os.path.join(SRC, "deck", "settings.html"), shim)
open(os.path.join(OUT, "deck-settings-preview.html"), "w", encoding="utf-8").write(page)
# The same, opened on a widget's tab and on the Layout tab.
for tab in ("weather", "layout"):
    p = inline(os.path.join(SRC, "deck", "settings.html"), shim + "<script>window.__DECK_START_TAB__ = %s;</script>" % json.dumps(tab))
    open(os.path.join(OUT, "deck-settings-%s-preview.html" % tab), "w", encoding="utf-8").write(p)
print("preview written to", os.path.abspath(OUT), "(%d widgets)" % len(WIDGETS))
