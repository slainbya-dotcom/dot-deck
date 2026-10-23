/* Dot Deck bridge. Loaded first on every widget page (its floating window, and its
 * settings page inside the Deck settings window) so the separate apps' code runs
 * unchanged inside one app.
 *
 * Keeping widgets apart: a page's event listeners hear events sent to *any* window,
 * so every widget's events carry its id ("state-changed:timer", "clip:clipboard").
 * The bridge gives each page a copy of the Tauri API whose listen() adds the id, so
 * the Timer only ever hears the Timer's settings. Tauri's own window events
 * ("tauri://drag-drop" etc.) are limited to the page's own window instead.
 *
 *  - Widget windows ("w-<id>"): Rust knows which widget is calling from the window
 *    label. The bridge also routes setSize through Deck (for the scale slider),
 *    honours "lock positions", tells Deck about Alt-drags, and draws arrange mode.
 *  - Settings pages (an iframe in the Deck settings window): the bridge borrows the
 *    parent's Tauri API and adds { app: <id> } to every command.
 */
(function () {
  'use strict';
  const m = /\/widgets\/([a-z]+)\//.exec(location.pathname);
  const APP = window.__DECK_APP__ || (m && m[1]) || null;
  window.__DECK_APP__ = APP;
  const inFrame = window.parent && window.parent !== window;
  let parentT = null;
  if (inFrame) { try { parentT = window.parent.__TAURI__ || null; } catch (e) { parentT = null; } }
  const T = parentT || window.__TAURI__;
  if (!T || !T.core || !APP) return;

  let myLabel = null;
  if (!inFrame) { try { myLabel = T.window.getCurrentWindow().label; } catch (e) { myLabel = 'w-' + APP; } }

  /** This widget's name for an event. */
  const own = (name) => String(name) + ':' + APP;
  const api = Object.assign({}, T);
  api.event = Object.assign({}, T.event, {
    listen: (name, cb, o) => {
      const n = String(name);
      if (n.startsWith('tauri://')) {
        // Window events (drag-drop...): only this window's.
        return T.event.listen(n, cb, myLabel ? Object.assign({ target: myLabel }, o || {}) : o);
      }
      return T.event.listen(own(n), cb, o);
    },
  });
  if (inFrame) {
    api.core = Object.assign({}, T.core, {
      invoke: (cmd, args, opts) => T.core.invoke(cmd, String(cmd).includes(':') ? args : Object.assign({ app: APP }, args || {}), opts),
    });
  }
  // The widgets' code reads window.__DECK_TAURI__ first (tools/import_widgets.py sees to that).
  window.__DECK_TAURI__ = api;

  if (inFrame) {
    // "Quit Dot X" turns the widget off in Dot Deck.
    document.addEventListener('DOMContentLoaded', () => {
      const q = document.getElementById('btn-quit');
      if (q) q.textContent = 'Turn this widget off';
    });
    return;
  }

  // ---- the widget's own floating window ----
  const flags = { arrange: false, lock: false };
  const W = T.window && T.window.Window;
  if (W && W.prototype) {
    const P = W.prototype;
    const origSize = P.setSize, origDrag = P.startDragging;
    // The page asks for its natural size; Deck multiplies it by the scale.
    P.setSize = function (size) {
      if (String(this.label || '').startsWith('w-') && size && size.width) {
        return T.core.invoke('deck_set_size', { width: size.width, height: size.height });
      }
      return origSize.apply(this, arguments);
    };
    // Positions may be locked; Alt-drag moves a whole stack. Deck is told first (in order,
    // before the drag starts) but not waited for, so the drag starts while the button is down.
    let alt = false;
    window.addEventListener('mousedown', (e) => { alt = e.altKey; }, true);
    P.startDragging = function () {
      if (flags.lock) return Promise.resolve();
      T.core.invoke('deck_drag_start', { alt }).catch(() => {});
      return origDrag.apply(this, arguments);
    };
  }

  // Arrange mode: a dashed outline and the widget's name, so everything is easy to find.
  const NAMES = { clock: 'Clock', timer: 'Timer', focus: 'Focus', calendar: 'Calendar', sun: 'Sun', ticker: 'Ticker', planner: 'Planner', system: 'System', player: 'Player', weather: 'Weather', dice: 'Dice', visualiser: 'Visualiser', list: 'List', launcher: 'Launcher', clipboard: 'Clipboard', reader: 'Reader' };
  function arrange(on) {
    let o = document.getElementById('deck-arrange');
    if (!on) { if (o) o.remove(); return; }
    if (o) return;
    o = document.createElement('div');
    o.id = 'deck-arrange';
    o.style.cssText = 'position:fixed;inset:0;border:2px dashed #ffb000;border-radius:10px;pointer-events:none;z-index:99;';
    const tag = document.createElement('span');
    tag.textContent = NAMES[APP] || APP;
    tag.style.cssText = 'position:absolute;left:6px;top:4px;font:600 11px system-ui;background:#ffb000;color:#1a1200;padding:1px 6px;border-radius:4px;';
    o.appendChild(tag);
    (document.body || document.documentElement).appendChild(o);
  }
  const apply = (f) => { if (f && typeof f === 'object') { flags.arrange = !!f.arrange; flags.lock = !!f.lock; } arrange(flags.arrange); };
  // Deck's own event, the same for every widget (so not given an id).
  T.event.listen('deck-flags', (e) => apply(e.payload));
  const ready = () => T.core.invoke('deck_flags').then(apply).catch(() => {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
