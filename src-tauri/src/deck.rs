//! Dot Deck's own job: which widgets are on, their windows, where they sit on each
//! screen setup, snapping and Alt-drag stacks, and the scale.
//!
//! Positions are stored in physical pixels per *screen setup* (the set of connected
//! monitors), so the laptop on its own and the laptop plus a big monitor each keep
//! their own arrangement. A background thread notices when the setup changes and
//! moves the widgets to the layout for the new one.
//!
//! Rule used throughout: never call a window method while holding one of Deck's
//! locks. Window calls can make the OS send "moved" events straight back to us, and
//! those need the locks.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Every widget Dot Deck knows: id, name, the separate app's identifier (to import
/// its settings) and a starting window size (the page resizes itself on load).
pub struct Def {
    pub id: &'static str,
    pub name: &'static str,
    pub old_identifier: &'static str,
    pub w: f64,
    pub h: f64,
}
pub const WIDGETS: &[Def] = &[
    Def { id: "clock", name: "Clock", old_identifier: "app.worldtime.dotmatrix", w: 423.0, h: 111.0 },
    Def { id: "timer", name: "Timer", old_identifier: "app.worldtime.dottimer", w: 423.0, h: 60.0 },
    Def { id: "focus", name: "Focus", old_identifier: "app.worldtime.dotfocus", w: 423.0, h: 60.0 },
    Def { id: "calendar", name: "Calendar", old_identifier: "app.worldtime.dotcalendar", w: 423.0, h: 90.0 },
    Def { id: "sun", name: "Sun", old_identifier: "app.worldtime.dotsun", w: 423.0, h: 60.0 },
    Def { id: "ticker", name: "Ticker", old_identifier: "app.worldtime.dotticker", w: 423.0, h: 40.0 },
    Def { id: "planner", name: "Planner", old_identifier: "app.worldtime.dotplanner", w: 423.0, h: 90.0 },
    Def { id: "system", name: "System", old_identifier: "app.worldtime.dotsystem", w: 423.0, h: 90.0 },
    Def { id: "player", name: "Player", old_identifier: "app.worldtime.dotplayer", w: 423.0, h: 120.0 },
    Def { id: "weather", name: "Weather", old_identifier: "app.worldtime.dotweather", w: 423.0, h: 93.0 },
    Def { id: "dice", name: "Dice", old_identifier: "app.worldtime.dotdice", w: 423.0, h: 260.0 },
    Def { id: "visualiser", name: "Visualiser", old_identifier: "app.worldtime.dotvisualiser", w: 423.0, h: 80.0 },
    Def { id: "list", name: "List", old_identifier: "app.worldtime.dotlist", w: 423.0, h: 150.0 },
    Def { id: "launcher", name: "Launcher", old_identifier: "app.worldtime.dotlauncher", w: 423.0, h: 150.0 },
    Def { id: "clipboard", name: "Clipboard", old_identifier: "app.worldtime.dotclipboard", w: 423.0, h: 170.0 },
    Def { id: "reader", name: "Reader", old_identifier: "app.worldtime.dotreader", w: 540.0, h: 390.0 },
];
pub fn def(id: &str) -> Option<&'static Def> {
    WIDGETS.iter().find(|d| d.id == id)
}
pub fn label_of(id: &str) -> String {
    format!("w-{}", id)
}
pub fn id_of_label(label: &str) -> Option<&'static str> {
    label.strip_prefix("w-").and_then(|id| def(id)).map(|d| d.id)
}

/// Same for every webview: WebView2 refuses to mix different arguments in one app.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

// ---- saved settings (deck.json) --------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Setup {
    /// "Laptop + 27-inch" style name shown in settings (you can rename it)
    pub name: String,
    pub renamed: bool,
    /// widget id -> top-left in physical pixels
    pub pos: BTreeMap<String, (i32, i32)>,
    /// when this setup was last in use (seconds since 1970), to copy the most recent
    pub used: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Config {
    pub enabled: BTreeMap<String, bool>,
    pub scale: f64,
    pub widget_scale: BTreeMap<String, f64>,
    pub lock: bool,
    pub snap: bool,
    pub setups: BTreeMap<String, Setup>,
    pub imported: bool,
}
impl Default for Config {
    fn default() -> Self {
        Config {
            enabled: BTreeMap::new(),
            scale: 1.0,
            widget_scale: BTreeMap::new(),
            lock: false,
            snap: true,
            setups: BTreeMap::new(),
            imported: false,
        }
    }
}

// ---- geometry (pure; see the tests at the bottom) ----------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}
impl Rect {
    fn right(&self) -> i32 {
        self.x + self.w
    }
    fn bottom(&self) -> i32 {
        self.y + self.h
    }
    fn contains_point(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }
}

/// The candidate closest to `v`, if it's within `threshold`.
pub fn snap_axis(v: i32, candidates: &[i32], threshold: i32) -> i32 {
    candidates
        .iter()
        .copied()
        .filter(|c| (c - v).abs() <= threshold)
        .min_by_key(|c| (c - v).abs())
        .unwrap_or(v)
}

/// Where `me` should settle: lined up with, or stacked a small gap from, other widgets,
/// or a small margin in from a screen edge, when it's close enough.
pub fn snap_rect(me: Rect, others: &[Rect], screens: &[Rect], threshold: i32, gap: i32, margin: i32) -> (i32, i32) {
    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for s in screens {
        xs.extend([s.x + margin, s.right() - margin - me.w]);
        ys.extend([s.y + margin, s.bottom() - margin - me.h]);
    }
    for o in others {
        // Only things near us in the other direction count (so far-away widgets don't pull).
        let near_y = me.bottom() + threshold >= o.y && me.y - threshold <= o.bottom();
        let near_x = me.right() + threshold >= o.x && me.x - threshold <= o.right();
        if near_y || near_x {
            xs.extend([o.x, o.right() - me.w, o.right() + gap, o.x - me.w - gap]);
            ys.extend([o.y, o.bottom() - me.h, o.bottom() + gap, o.y - me.h - gap]);
        }
    }
    (snap_axis(me.x, &xs, threshold), snap_axis(me.y, &ys, threshold))
}

/// True when two widgets are snapped together (touching, or within `gap` + a little).
pub fn touching(a: Rect, b: Rect, gap: i32) -> bool {
    let overlap_x = a.right().min(b.right()) - a.x.max(b.x);
    let overlap_y = a.bottom().min(b.bottom()) - a.y.max(b.y);
    let gap_x = (b.x - a.right()).max(a.x - b.right());
    let gap_y = (b.y - a.bottom()).max(a.y - b.bottom());
    (overlap_x > 0 && gap_y <= gap) || (overlap_y > 0 && gap_x <= gap)
}

/// If `r` is mostly off every screen, a position that brings it back onto the nearest one.
pub fn rescue(r: Rect, screens: &[Rect], margin: i32) -> Option<(i32, i32)> {
    if screens.is_empty() {
        return None;
    }
    let (cx, cy) = (r.x + r.w / 2, r.y + r.h / 2);
    if screens.iter().any(|s| s.contains_point(cx, cy)) {
        return None;
    }
    let s = screens
        .iter()
        .min_by_key(|s| {
            let dx = (cx - (s.x + s.w / 2)) as i64;
            let dy = (cy - (s.y + s.h / 2)) as i64;
            dx * dx + dy * dy
        })
        .unwrap();
    let x = r.x.max(s.x + margin).min((s.right() - margin - r.w).max(s.x + margin));
    let y = r.y.max(s.y + margin).min((s.bottom() - margin - r.h).max(s.y + margin));
    Some((x, y))
}

/// A free spot for a new widget: down the right-hand side of `screen`, below anything already there.
pub fn free_spot(size: (i32, i32), taken: &[Rect], screen: Rect, margin: i32, gap: i32) -> (i32, i32) {
    let x = screen.right() - margin - size.0;
    let mut y = screen.y + margin;
    loop {
        let me = Rect { x, y, w: size.0, h: size.1 };
        match taken.iter().find(|t| overlaps(me, **t, gap)) {
            Some(t) => y = t.bottom() + gap,
            None => return (x, y),
        }
        if y > screen.bottom() {
            return (x, screen.y + margin);
        }
    }
}
fn overlaps(a: Rect, b: Rect, gap: i32) -> bool {
    a.x < b.right() + gap && b.x < a.right() + gap && a.y < b.bottom() + gap && b.y < a.bottom() + gap
}

/// A key for the set of connected screens, and a friendly name for it.
pub fn setup_key(screens: &[(Rect, f64)]) -> (String, String) {
    let mut s: Vec<_> = screens.to_vec();
    s.sort_by_key(|(r, _)| (r.x, r.y));
    let key = s.iter().map(|(r, _)| format!("{}x{}@{},{}", r.w, r.h, r.x, r.y)).collect::<Vec<_>>().join("|");
    let sizes = s
        .iter()
        .map(|(r, f)| format!("{}×{}", (r.w as f64 / f).round(), (r.h as f64 / f).round()))
        .collect::<Vec<_>>()
        .join(" + ");
    let name = if s.len() == 1 { format!("1 screen ({})", sizes) } else { format!("{} screens ({})", s.len(), sizes) };
    (key, name)
}

// ---- runtime -----------------------------------------------------------------------------------

struct Group {
    leader: String,
    start: (i32, i32),
    members: Vec<(String, (i32, i32))>,
}

#[derive(Default)]
struct Runtime {
    setup: String,
    /// natural (unscaled) size each widget page asked for
    base: HashMap<String, (f64, f64)>,
    /// positions we set ourselves, so the "moved" event they cause isn't taken as a drag
    expected: HashMap<String, (i32, i32)>,
    /// last time each widget moved (snapping happens once it has been still a moment)
    moved: HashMap<String, Instant>,
    group: Option<Group>,
    dirty: bool,
    arrange: bool,
    hidden: bool,
}

pub struct Deck {
    path: PathBuf,
    cfg: Mutex<Config>,
    rt: Mutex<Runtime>,
}

#[derive(Serialize, Clone)]
pub struct WidgetStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub enabled: bool,
    pub scale: f64,
    pub importable: bool,
}
#[derive(Serialize, Clone)]
pub struct SetupStatus {
    pub key: String,
    pub name: String,
    pub current: bool,
    pub widgets: usize,
}
#[derive(Serialize, Clone)]
pub struct Status {
    pub widgets: Vec<WidgetStatus>,
    pub scale: f64,
    pub lock: bool,
    pub snap: bool,
    pub arrange: bool,
    pub hidden: bool,
    pub setups: Vec<SetupStatus>,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Every screen as (rect, scale factor).
pub fn screens(app: &AppHandle) -> Vec<(Rect, f64)> {
    let win = app.get_webview_window("settings").or_else(|| app.webview_windows().into_values().next());
    let Some(win) = win else { return vec![] };
    win.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let (p, s) = (m.position(), m.size());
            (Rect { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 }, m.scale_factor())
        })
        .collect()
}

fn rect_of(win: &WebviewWindow) -> Option<Rect> {
    let p = win.outer_position().ok()?;
    let s = win.outer_size().ok()?;
    Some(Rect { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 })
}

impl Deck {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("deck.json");
        let cfg = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<Config>(&s).ok());
        let fresh = cfg.is_none();
        let mut cfg = cfg.unwrap_or_default();
        if fresh {
            for id in ["clock", "weather", "list"] {
                cfg.enabled.insert(id.into(), true);
            }
        }
        cfg.scale = cfg.scale.clamp(0.5, 3.0);
        Deck { path, cfg: Mutex::new(cfg), rt: Mutex::new(Runtime::default()) }
    }

    pub fn save(&self) {
        let json = { serde_json::to_string_pretty(&*self.cfg.lock().unwrap()).unwrap_or_default() };
        let tmp = self.path.with_extension("json.tmp");
        if fs::write(&tmp, json).is_ok() {
            let _ = fs::rename(&tmp, &self.path);
        }
        self.rt.lock().unwrap().dirty = false;
    }
    fn mark_dirty(&self) {
        self.rt.lock().unwrap().dirty = true;
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        *self.cfg.lock().unwrap().enabled.get(id).unwrap_or(&false)
    }
    pub fn enabled_ids(&self) -> Vec<&'static str> {
        let c = self.cfg.lock().unwrap();
        WIDGETS.iter().filter(|d| *c.enabled.get(d.id).unwrap_or(&false)).map(|d| d.id).collect()
    }
    pub fn zoom(&self, id: &str) -> f64 {
        let c = self.cfg.lock().unwrap();
        (c.scale * c.widget_scale.get(id).copied().unwrap_or(1.0)).clamp(0.25, 6.0)
    }
    pub fn locked(&self) -> bool {
        self.cfg.lock().unwrap().lock
    }
    pub fn arrange(&self) -> bool {
        self.rt.lock().unwrap().arrange
    }
    /// What every widget window needs to know: arrange mode (outline) and lock (no dragging).
    pub fn flags(&self) -> serde_json::Value {
        serde_json::json!({ "arrange": self.arrange(), "lock": self.locked() })
    }

    pub fn status(&self, imported_from: &dyn Fn(&str) -> bool) -> Status {
        let c = self.cfg.lock().unwrap().clone();
        let rt = self.rt.lock().unwrap();
        let mut setups: Vec<_> = c
            .setups
            .iter()
            .map(|(k, s)| SetupStatus { key: k.clone(), name: s.name.clone(), current: *k == rt.setup, widgets: s.pos.len() })
            .collect();
        setups.sort_by_key(|s| !s.current);
        Status {
            widgets: WIDGETS
                .iter()
                .map(|d| WidgetStatus {
                    id: d.id,
                    name: d.name,
                    enabled: *c.enabled.get(d.id).unwrap_or(&false),
                    scale: c.widget_scale.get(d.id).copied().unwrap_or(1.0),
                    importable: imported_from(d.id),
                })
                .collect(),
            scale: c.scale,
            lock: c.lock,
            snap: c.snap,
            arrange: rt.arrange,
            hidden: rt.hidden,
            setups,
        }
    }

    // ---- turning widgets on and off ----

    pub fn set_enabled(&self, app: &AppHandle, id: &str, on: bool) {
        if def(id).is_none() {
            return;
        }
        self.cfg.lock().unwrap().enabled.insert(id.to_string(), on);
        self.save();
        if on {
            let _ = self.open_widget(app, id);
        } else if let Some(w) = app.get_webview_window(&label_of(id)) {
            let _ = w.destroy();
        }
        crate::on_widget_toggled(app, id, on);
        self.changed(app);
    }

    /// Opens (or shows) a widget's window, at its place for the current screen setup.
    pub fn open_widget(&self, app: &AppHandle, id: &str) -> tauri::Result<()> {
        let label = label_of(id);
        if let Some(w) = app.get_webview_window(&label) {
            if !self.rt.lock().unwrap().hidden {
                w.show()?;
            }
            return Ok(());
        }
        let Some(d) = def(id) else { return Ok(()) };
        let z = self.zoom(id);
        let url = WebviewUrl::App(format!("widgets/{}/index.html", id).into());
        let builder = WebviewWindowBuilder::new(app, &label, url)
            .title(format!("Dot {}", d.name))
            .inner_size(d.w * z, d.h * z)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .focused(false)
            .visible(false);
        #[cfg(windows)]
        let builder = builder.additional_browser_args(BROWSER_ARGS);
        #[cfg(target_os = "macos")]
        let builder = builder.accept_first_mouse(true);
        let win = builder.build()?;
        let _ = win.set_zoom(z);
        self.place(app, id, &win);
        if !self.rt.lock().unwrap().hidden {
            win.show()?;
        }
        Ok(())
    }

    /// Puts a widget where it belongs for this setup (or somewhere free if it's new here).
    fn place(&self, app: &AppHandle, id: &str, win: &WebviewWindow) {
        let saved = {
            let c = self.cfg.lock().unwrap();
            let rt = self.rt.lock().unwrap();
            c.setups.get(&rt.setup).and_then(|s| s.pos.get(id).copied())
        };
        let scr: Vec<Rect> = screens(app).into_iter().map(|(r, _)| r).collect();
        let size = rect_of(win).map(|r| (r.w, r.h)).unwrap_or((400, 100));
        let sf = win.scale_factor().unwrap_or(1.0);
        let (margin, gap) = ((20.0 * sf) as i32, (8.0 * sf) as i32);
        let pos = match saved {
            Some(p) => rescue(Rect { x: p.0, y: p.1, w: size.0, h: size.1 }, &scr, margin).unwrap_or(p),
            None => {
                let taken: Vec<Rect> = self.other_rects(app, id);
                let main = primary(app).unwrap_or(Rect { x: 0, y: 0, w: 1280, h: 800 });
                free_spot(size, &taken, main, margin, gap)
            }
        };
        self.move_to(win, id, pos);
        self.record(id, pos);
    }

    fn other_rects(&self, app: &AppHandle, except: &str) -> Vec<Rect> {
        self.enabled_ids()
            .into_iter()
            .filter(|i| *i != except)
            .filter_map(|i| app.get_webview_window(&label_of(i)).and_then(|w| rect_of(&w)))
            .collect()
    }

    /// Moves a window ourselves (the resulting "moved" event is ignored).
    fn move_to(&self, win: &WebviewWindow, id: &str, pos: (i32, i32)) {
        self.rt.lock().unwrap().expected.insert(label_of(id), pos);
        let _ = win.set_position(PhysicalPosition::new(pos.0, pos.1));
    }

    fn record(&self, id: &str, pos: (i32, i32)) {
        let setup = self.rt.lock().unwrap().setup.clone();
        {
            let mut c = self.cfg.lock().unwrap();
            let s = c.setups.entry(setup).or_default();
            s.pos.insert(id.to_string(), pos);
            s.used = now_secs();
        }
        self.mark_dirty();
    }

    // ---- size and scale ----

    /// The widget page asked to be `w` x `h` (its natural size); apply the scale.
    pub fn set_size(&self, app: &AppHandle, id: &str, w: f64, h: f64) {
        self.rt.lock().unwrap().base.insert(id.to_string(), (w, h));
        let z = self.zoom(id);
        if let Some(win) = app.get_webview_window(&label_of(id)) {
            let _ = win.set_size(LogicalSize::new((w * z).ceil(), (h * z).ceil()));
        }
    }

    pub fn set_scale(&self, app: &AppHandle, scale: f64, widget: Option<&str>) {
        {
            let mut c = self.cfg.lock().unwrap();
            match widget {
                Some(id) => {
                    c.widget_scale.insert(id.to_string(), scale.clamp(0.5, 2.0));
                }
                None => c.scale = scale.clamp(0.5, 3.0),
            }
        }
        self.mark_dirty();
        let ids: Vec<&str> = match widget {
            Some(id) => def(id).map(|d| vec![d.id]).unwrap_or_default(),
            None => WIDGETS.iter().map(|d| d.id).collect(),
        };
        for id in ids {
            let Some(win) = app.get_webview_window(&label_of(id)) else { continue };
            let z = self.zoom(id);
            let _ = win.set_zoom(z);
            let base = self.rt.lock().unwrap().base.get(id).copied();
            if let Some((w, h)) = base {
                let _ = win.set_size(LogicalSize::new((w * z).ceil(), (h * z).ceil()));
            }
        }
    }

    pub fn set_option(&self, app: &AppHandle, name: &str, value: bool) {
        match name {
            "lock" => self.cfg.lock().unwrap().lock = value,
            "snap" => self.cfg.lock().unwrap().snap = value,
            "arrange" => self.rt.lock().unwrap().arrange = value,
            _ => {}
        }
        // Every widget window wants this one (it's Deck's own, so it isn't per widget).
        let _ = app.emit("deck-flags", self.flags());
        self.save();
        self.changed(app);
    }

    pub fn set_hidden(&self, app: &AppHandle, hidden: bool) {
        self.rt.lock().unwrap().hidden = hidden;
        for id in self.enabled_ids() {
            if let Some(w) = app.get_webview_window(&label_of(id)) {
                let _ = if hidden { w.hide() } else { w.show() };
            }
        }
        self.changed(app);
    }
    pub fn hidden(&self) -> bool {
        self.rt.lock().unwrap().hidden
    }

    // ---- dragging, snapping and stacks ----

    /// A widget is about to be dragged. Returns false if positions are locked.
    pub fn drag_start(&self, app: &AppHandle, id: &str, alt: bool) -> bool {
        if self.locked() {
            return false;
        }
        let label = label_of(id);
        let Some(win) = app.get_webview_window(&label) else { return true };
        let Some(me) = rect_of(&win) else { return true };
        let mut members = Vec::new();
        if alt {
            // Everything snapped to this widget, and to those, and so on.
            let sf = win.scale_factor().unwrap_or(1.0);
            let gap = (14.0 * sf) as i32;
            let all: Vec<(String, Rect)> = self
                .enabled_ids()
                .into_iter()
                .filter(|i| *i != id)
                .filter_map(|i| app.get_webview_window(&label_of(i)).and_then(|w| rect_of(&w)).map(|r| (label_of(i), r)))
                .collect();
            let mut group = vec![me];
            let mut left = all;
            loop {
                let (near, far): (Vec<_>, Vec<_>) = left.into_iter().partition(|(_, r)| group.iter().any(|g| touching(*g, *r, gap)));
                if near.is_empty() {
                    break;
                }
                for (l, r) in near {
                    group.push(r);
                    members.push((l, (r.x, r.y)));
                }
                left = far;
            }
        }
        self.rt.lock().unwrap().group = Some(Group { leader: label, start: (me.x, me.y), members });
        true
    }

    /// The OS moved a widget window (a drag, or our own set_position).
    pub fn on_moved(&self, app: &AppHandle, label: &str, pos: (i32, i32)) {
        let Some(id) = id_of_label(label) else { return };
        let follow: Vec<(String, (i32, i32))> = {
            let mut rt = self.rt.lock().unwrap();
            if rt.expected.get(label) == Some(&pos) {
                rt.expected.remove(label);
                return;
            }
            rt.moved.insert(label.to_string(), Instant::now());
            match &rt.group {
                Some(g) if g.leader == label => {
                    let (dx, dy) = (pos.0 - g.start.0, pos.1 - g.start.1);
                    g.members.iter().map(|(l, s)| (l.clone(), (s.0 + dx, s.1 + dy))).collect()
                }
                _ => vec![],
            }
        };
        self.record(id, pos);
        // Alt-drag: the rest of the stack follows.
        for (l, p) in follow {
            if let (Some(w), Some(mid)) = (app.get_webview_window(&l), id_of_label(&l)) {
                self.move_to(&w, mid, p);
                self.record(mid, p);
            }
        }
    }

    /// Runs every ~120 ms: snaps widgets that have just stopped moving, saves, watches screens.
    pub fn tick(&self, app: &AppHandle, check_screens: bool) {
        if check_screens {
            self.check_setup(app);
        }
        let settled: Vec<String> = {
            let mut rt = self.rt.lock().unwrap();
            let now = Instant::now();
            let done: Vec<String> = rt
                .moved
                .iter()
                .filter(|(_, t)| now.duration_since(**t) > Duration::from_millis(450))
                .map(|(l, _)| l.clone())
                .collect();
            for l in &done {
                rt.moved.remove(l);
                if rt.group.as_ref().map(|g| &g.leader == l).unwrap_or(false) {
                    rt.group = None;
                }
            }
            done
        };
        let snap_on = self.cfg.lock().unwrap().snap;
        for label in settled {
            if snap_on {
                self.snap(app, &label);
            }
        }
        if self.rt.lock().unwrap().dirty {
            self.save();
        }
    }

    fn snap(&self, app: &AppHandle, label: &str) {
        let Some(id) = id_of_label(label) else { return };
        let Some(win) = app.get_webview_window(label) else { return };
        let Some(me) = rect_of(&win) else { return };
        let sf = win.scale_factor().unwrap_or(1.0);
        let scr: Vec<Rect> = screens(app).into_iter().map(|(r, _)| r).collect();
        let others = self.other_rects(app, id);
        let (thr, gap, margin) = ((16.0 * sf) as i32, (8.0 * sf) as i32, (10.0 * sf) as i32);
        let mut pos = snap_rect(me, &others, &scr, thr, gap, margin);
        if let Some(p) = rescue(Rect { x: pos.0, y: pos.1, ..me }, &scr, margin) {
            pos = p;
        }
        if pos != (me.x, me.y) {
            self.move_to(&win, id, pos);
            self.record(id, pos);
        }
    }

    /// Lines every widget up in a column at the top right of a screen.
    pub fn tidy(&self, app: &AppHandle, on_settings_screen: bool) {
        let target = if on_settings_screen {
            app.get_webview_window("settings").and_then(|w| w.current_monitor().ok().flatten()).map(|m| {
                let (p, s) = (m.position(), m.size());
                Rect { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 }
            })
        } else {
            None
        };
        let Some(screen) = target.or_else(|| primary(app)) else { return };
        let mut y = None;
        for id in self.enabled_ids() {
            let Some(win) = app.get_webview_window(&label_of(id)) else { continue };
            let Some(r) = rect_of(&win) else { continue };
            let sf = win.scale_factor().unwrap_or(1.0);
            let (margin, gap) = ((24.0 * sf) as i32, (8.0 * sf) as i32);
            let top = y.unwrap_or(screen.y + margin);
            let pos = (screen.right() - margin - r.w, top);
            self.move_to(&win, id, pos);
            self.record(id, pos);
            y = Some(top + r.h + gap);
        }
        self.save();
    }

    // ---- screen setups ----

    /// Notices a new set of screens and switches to its layout.
    pub fn check_setup(&self, app: &AppHandle) {
        let scr = screens(app);
        if scr.is_empty() {
            return;
        }
        let (key, name) = setup_key(&scr);
        let previous = {
            let mut rt = self.rt.lock().unwrap();
            if rt.setup == key {
                return;
            }
            std::mem::replace(&mut rt.setup, key.clone())
        };
        {
            let mut c = self.cfg.lock().unwrap();
            if !c.setups.contains_key(&key) {
                // A setup we haven't seen: start from the most recently used layout.
                let from = c.setups.get(&previous).cloned().or_else(|| c.setups.values().max_by_key(|s| s.used).cloned());
                let mut s = from.unwrap_or_default();
                s.name = name.clone();
                s.renamed = false;
                c.setups.insert(key.clone(), s);
            } else if let Some(s) = c.setups.get_mut(&key) {
                if !s.renamed {
                    s.name = name;
                }
            }
            if let Some(s) = c.setups.get_mut(&key) {
                s.used = now_secs();
            }
        }
        self.save();
        for id in self.enabled_ids() {
            if let Some(w) = app.get_webview_window(&label_of(id)) {
                self.place(app, id, &w);
            }
        }
        self.changed(app);
    }

    pub fn reset_setup(&self, app: &AppHandle, key: &str) {
        let current = self.rt.lock().unwrap().setup == key;
        if let Some(s) = self.cfg.lock().unwrap().setups.get_mut(key) {
            s.pos.clear();
        }
        if current {
            self.tidy(app, false);
        }
        self.save();
        self.changed(app);
    }
    pub fn forget_setup(&self, app: &AppHandle, key: &str) {
        if self.rt.lock().unwrap().setup != key {
            self.cfg.lock().unwrap().setups.remove(key);
            self.save();
        }
        self.changed(app);
    }
    pub fn rename_setup(&self, app: &AppHandle, key: &str, name: &str) {
        if let Some(s) = self.cfg.lock().unwrap().setups.get_mut(key) {
            let n = name.trim();
            s.renamed = !n.is_empty();
            if !n.is_empty() {
                s.name = n.chars().take(60).collect();
            }
        }
        self.save();
        self.changed(app);
    }

    /// Tell the settings window something changed (tray, a widget's own close button...).
    pub fn changed(&self, app: &AppHandle) {
        let _ = app.emit_to("settings", "deck-changed", ());
        crate::refresh_tray(app);
    }

    pub fn mark_imported(&self) {
        self.cfg.lock().unwrap().imported = true;
        self.save();
    }
    pub fn was_imported(&self) -> bool {
        self.cfg.lock().unwrap().imported
    }
    pub fn enable_quietly(&self, ids: &[&str]) {
        let mut c = self.cfg.lock().unwrap();
        for id in ids {
            c.enabled.insert(id.to_string(), true);
        }
    }
}

fn primary(app: &AppHandle) -> Option<Rect> {
    let win = app.get_webview_window("settings")?;
    let m = win.primary_monitor().ok().flatten()?;
    let (p, s) = (m.position(), m.size());
    Some(Rect { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 })
}

/// The background thread: snapping, saving and watching for screen changes.
pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let mut n: u32 = 0;
        loop {
            thread::sleep(Duration::from_millis(120));
            n = n.wrapping_add(1);
            let deck = app.state::<Deck>();
            deck.tick(&app, n % 16 == 0);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(non_snake_case)]
    fn R(x: i32, y: i32, w: i32, h: i32) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn snaps_to_screen_edges_and_other_widgets() {
        let screen = [R(0, 0, 1920, 1080)];
        // Near the top-right corner: pulled into the margin.
        assert_eq!(snap_rect(R(1495, 4, 400, 100), &[], &screen, 16, 8, 10), (1510, 10));
        // Just under another widget, a little left of it: lines up and stacks with the gap.
        let other = [R(1000, 200, 400, 100)];
        assert_eq!(snap_rect(R(1006, 302, 400, 80), &other, &screen, 16, 8, 10), (1000, 308));
        // Far away: left alone.
        assert_eq!(snap_rect(R(300, 600, 400, 80), &other, &screen, 16, 8, 10), (300, 600));
    }

    #[test]
    fn stacks_are_widgets_touching() {
        assert!(touching(R(0, 0, 100, 50), R(0, 58, 100, 50), 10));
        assert!(touching(R(0, 0, 100, 50), R(105, 10, 100, 50), 10));
        assert!(!touching(R(0, 0, 100, 50), R(0, 90, 100, 50), 10));
        assert!(!touching(R(0, 0, 100, 50), R(300, 0, 100, 50), 10));
    }

    #[test]
    fn rescues_widgets_off_screen() {
        let laptop = [R(0, 0, 1440, 900)];
        assert_eq!(rescue(R(100, 100, 400, 100), &laptop, 20), None);
        // Was on a monitor to the right that's gone.
        assert_eq!(rescue(R(2600, 300, 400, 100), &laptop, 20), Some((1020, 300)));
    }

    #[test]
    fn free_spots_go_down_the_right() {
        let s = R(0, 0, 1440, 900);
        assert_eq!(free_spot((400, 100), &[], s, 20, 8), (1020, 20));
        assert_eq!(free_spot((400, 100), &[R(1020, 20, 400, 100)], s, 20, 8), (1020, 128));
    }

    #[test]
    fn setup_keys_ignore_order() {
        let a = [(R(0, 0, 2560, 1440), 1.0), (R(2560, 540, 2880, 1800), 2.0)];
        let b = [a[1], a[0]];
        assert_eq!(setup_key(&a), setup_key(&b));
        assert_eq!(setup_key(&a).1, "2 screens (2560×1440 + 1440×900)");
        assert_eq!(setup_key(&[(R(0, 0, 2880, 1800), 2.0)]).1, "1 screen (1440×900)");
    }
}
