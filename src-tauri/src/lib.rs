//! Dot Deck: every Dot widget in one app.
//!
//! Each widget runs its own page (the same code as its separate app) in its own small
//! window, labelled "w-<id>". Its settings page runs inside the Deck settings window.
//! This file holds:
//!   * the commands every widget page calls (load/save its settings, open settings...),
//!     answered for the widget that's calling (from its window label, or the `app`
//!     argument that the bridge adds for settings pages)
//!   * Deck's own commands (on/off, scale, layout), see deck.rs
//!   * the widgets' extra commands (system readings, media, audio, clipboard, launcher,
//!     reader), see their modules
//!   * the tray menu, and importing settings from the separate apps

mod audio;
mod clipboard;
mod deck;
mod media;
mod monitor;
mod tools;

use std::collections::HashMap;
use std::{fs, path::PathBuf, sync::Mutex};

use deck::{def, label_of, Deck, WIDGETS};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent, Wry,
};

// ---- each widget's settings ----------------------------------------------------------------

/// Every widget's settings JSON, one file each (<id>.json) in Deck's config folder.
pub struct Store {
    dir: PathBuf,
    cache: Mutex<HashMap<String, String>>,
}
impl Store {
    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.json", id))
    }
    /// The saved JSON, or "null" if this widget has never saved anything.
    pub fn get(&self, id: &str) -> String {
        if let Some(j) = self.cache.lock().unwrap().get(id) {
            return j.clone();
        }
        let j = fs::read_to_string(self.path(id))
            .ok()
            .filter(|s| serde_json::from_str::<serde_json::Value>(s).is_ok())
            .unwrap_or_else(|| "null".to_string());
        self.cache.lock().unwrap().insert(id.to_string(), j.clone());
        j
    }
    fn exists(&self, id: &str) -> bool {
        self.path(id).exists()
    }
    fn clear(&self, id: &str) -> Result<(), String> {
        let p = self.path(id);
        if p.exists() {
            fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
        self.cache.lock().unwrap().insert(id.to_string(), "null".to_string());
        Ok(())
    }
    fn put(&self, id: &str, json: &str) -> Result<(), String> {
        serde_json::from_str::<serde_json::Value>(json).map_err(|e| e.to_string())?;
        let tmp = self.dir.join(format!("{}.json.tmp", id));
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, self.path(id)).map_err(|e| e.to_string())?;
        self.cache.lock().unwrap().insert(id.to_string(), json.to_string());
        Ok(())
    }
}

/// Which widget is calling: settings pages say so (`app`); widget windows are "w-<id>".
fn widget_id(window: &tauri::Window, app: &Option<String>) -> Result<&'static str, String> {
    if let Some(a) = app {
        return def(a).map(|d| d.id).ok_or_else(|| format!("unknown widget {}", a));
    }
    deck::id_of_label(window.label()).ok_or_else(|| "not a widget window".to_string())
}

#[tauri::command]
fn load_state(window: tauri::Window, store: State<'_, Store>, app: Option<String>) -> Result<String, String> {
    Ok(store.get(widget_id(&window, &app)?))
}

/// Saves a widget's settings and tells its window and its settings page.
#[tauri::command]
fn save_state(handle: AppHandle, window: tauri::Window, store: State<'_, Store>, app: Option<String>, json: String) -> Result<(), String> {
    let id = widget_id(&window, &app)?;
    store.put(id, &json)?;
    announce(&handle, id, json);
    Ok(())
}

/// Tells one widget (its window and its settings page) that its settings changed.
///
/// The event name carries the widget's id, and the bridge makes each page listen only to
/// its own: a page's listeners hear events sent to *any* window, so a plain
/// "state-changed" would reach every widget and they'd overwrite each other.
fn announce(handle: &AppHandle, id: &str, json: String) {
    let _ = handle.emit(&format!("state-changed:{}", id), json);
}

/// Dot Clock's settings: the shared look ("Match Dot Clock") for every other widget.
#[tauri::command]
fn read_world_time(store: State<'_, Store>) -> Option<String> {
    let j = store.get("clock");
    if j == "null" { None } else { Some(j) }
}

/// Shows the Deck settings window on this widget's tab (optionally a section of it).
#[tauri::command]
fn open_settings(handle: AppHandle, window: tauri::Window, app: Option<String>, section: Option<String>) -> Result<(), String> {
    let id = widget_id(&window, &app).ok();
    show_settings(&handle, id);
    if let (Some(id), Some(section)) = (id, section) {
        let _ = handle.emit(&format!("open-section:{}", id), section);
    }
    Ok(())
}

fn show_settings(handle: &AppHandle, tab: Option<&str>) {
    if let Some(win) = handle.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    if let Some(tab) = tab {
        let _ = handle.emit_to("settings", "deck-open", tab.to_string());
    }
}

/// Moves this widget back to the middle of its screen (rescue if it's lost).
#[tauri::command]
fn recenter_widget(handle: AppHandle, window: tauri::Window, app: Option<String>) -> Result<(), String> {
    let id = widget_id(&window, &app)?;
    let win = handle.get_webview_window(&label_of(id)).ok_or("that widget is off")?;
    win.center().map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())
}

/// A widget's own "quit" (its close button, or "Turn this widget off") switches it off.
#[tauri::command]
async fn quit(handle: AppHandle, window: tauri::Window, app: Option<String>) -> Result<(), String> {
    match widget_id(&window, &app) {
        Ok(id) => handle.state::<Deck>().set_enabled(&handle, id, false),
        Err(_) => handle.exit(0),
    }
    Ok(())
}

// ---- Deck's own commands ---------------------------------------------------------------------

fn old_state_path(handle: &AppHandle, id: &str) -> Option<PathBuf> {
    let d = def(id)?;
    let p = handle.path().config_dir().ok()?.join(d.old_identifier).join("state.json");
    if p.exists() { Some(p) } else { None }
}

#[tauri::command]
fn deck_status(handle: AppHandle, deck: State<'_, Deck>) -> deck::Status {
    let h = handle.clone();
    deck.status(&move |id: &str| old_state_path(&h, id).is_some())
}

/// Async: on Windows, creating a window from a plain (main-thread) command can deadlock.
#[tauri::command]
async fn deck_set_enabled(handle: AppHandle, id: String, on: bool) -> Result<(), String> {
    handle.state::<Deck>().set_enabled(&handle, &id, on);
    Ok(())
}

/// `id` None = the overall scale; Some = one widget's own scale on top of it.
#[tauri::command]
fn deck_set_scale(handle: AppHandle, deck: State<'_, Deck>, scale: f64, id: Option<String>) {
    deck.set_scale(&handle, scale, id.as_deref());
}

/// "lock", "snap" or "arrange".
#[tauri::command]
fn deck_set_option(handle: AppHandle, deck: State<'_, Deck>, name: String, value: bool) {
    deck.set_option(&handle, &name, value);
}

#[tauri::command]
fn deck_set_hidden(handle: AppHandle, deck: State<'_, Deck>, hidden: bool) {
    deck.set_hidden(&handle, hidden);
}

/// Lines the widgets up in a column; `here` = on the screen the settings window is on.
#[tauri::command]
fn deck_tidy(handle: AppHandle, deck: State<'_, Deck>, here: bool) {
    deck.tidy(&handle, here);
}

#[tauri::command]
fn deck_setup(handle: AppHandle, deck: State<'_, Deck>, key: String, action: String, name: Option<String>) {
    match action.as_str() {
        "reset" => deck.reset_setup(&handle, &key),
        "forget" => deck.forget_setup(&handle, &key),
        "rename" => deck.rename_setup(&handle, &key, name.as_deref().unwrap_or("")),
        _ => {}
    }
}

/// Copies a widget's settings from its separate app (all of them if `ids` is empty).
#[tauri::command]
fn deck_import(handle: AppHandle, store: State<'_, Store>, ids: Vec<String>) -> Vec<String> {
    let wanted: Vec<&str> = if ids.is_empty() { WIDGETS.iter().map(|d| d.id).collect() } else { ids.iter().map(|s| s.as_str()).collect() };
    let mut done = Vec::new();
    for id in wanted {
        let Some(p) = old_state_path(&handle, id) else { continue };
        let Ok(json) = fs::read_to_string(&p) else { continue };
        if store.put(id, &json).is_ok() {
            if let Some(d) = def(id) {
                announce(&handle, d.id, json);
                done.push(d.id.to_string());
            }
        }
    }
    done
}

/// Puts a widget back to its first-run settings (for when they've got into a muddle).
#[tauri::command]
fn deck_reset_widget(handle: AppHandle, store: State<'_, Store>, id: String) -> Result<(), String> {
    let d = def(&id).ok_or("unknown widget")?;
    store.clear(d.id)?;
    announce(&handle, d.id, "null".to_string());
    Ok(())
}

/// From a widget page (through the bridge): its natural size; Deck applies the scale.
#[tauri::command]
fn deck_set_size(handle: AppHandle, window: tauri::Window, deck: State<'_, Deck>, width: f64, height: f64) {
    if let Some(id) = deck::id_of_label(window.label()) {
        deck.set_size(&handle, id, width, height);
    }
}

/// From a widget page just before it starts a drag. False = positions are locked.
#[tauri::command]
fn deck_drag_start(handle: AppHandle, window: tauri::Window, deck: State<'_, Deck>, alt: bool) -> bool {
    match deck::id_of_label(window.label()) {
        Some(id) => deck.drag_start(&handle, id, alt),
        None => true,
    }
}

/// Arrange mode and lock, for a widget window that has just opened.
#[tauri::command]
fn deck_flags(deck: State<'_, Deck>) -> serde_json::Value {
    deck.flags()
}

#[tauri::command]
fn deck_quit(handle: AppHandle, deck: State<'_, Deck>) {
    deck.save();
    handle.exit(0);
}

// ---- things that only run while their widget is on -----------------------------------------------

/// Starts or stops the background work some widgets need.
pub fn on_widget_toggled(handle: &AppHandle, id: &str, on: bool) {
    use std::sync::atomic::Ordering;
    match id {
        "visualiser" => audio::ACTIVE.store(on, Ordering::SeqCst),
        "clipboard" => {
            clipboard::ENABLED.store(on, Ordering::SeqCst);
            if on {
                clipboard::start(handle.clone());
            }
        }
        _ => {}
    }
}

// ---- tray menu ----------------------------------------------------------------------------------

struct Tray {
    arrange: CheckMenuItem<Wry>,
    hidden: CheckMenuItem<Wry>,
    widgets: Vec<(&'static str, CheckMenuItem<Wry>)>,
}

/// Brings the tray menu's ticks in line with the settings.
pub fn refresh_tray(handle: &AppHandle) {
    let (Some(tray), Some(deck)) = (handle.try_state::<Tray>(), handle.try_state::<Deck>()) else { return };
    let _ = tray.arrange.set_checked(deck.arrange());
    let _ = tray.hidden.set_checked(deck.hidden());
    for (id, item) in &tray.widgets {
        let _ = item.set_checked(deck.is_enabled(id));
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let deck = app.state::<Deck>();
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let hidden = CheckMenuItem::with_id(app, "hidden", "Hide all widgets", true, false, None::<&str>)?;
    let arrange = CheckMenuItem::with_id(app, "arrange", "Arrange mode", true, false, None::<&str>)?;
    let tidy = MenuItem::with_id(app, "tidy", "Tidy into a column", true, None::<&str>)?;
    let mut widgets = Vec::new();
    for d in WIDGETS {
        widgets.push((d.id, CheckMenuItem::with_id(app, format!("w:{}", d.id), d.name, true, deck.is_enabled(d.id), None::<&str>)?));
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = widgets.iter().map(|(_, i)| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    let sub = Submenu::with_items(app, "Widgets", true, &refs)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Dot Deck", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &sub, &hidden, &arrange, &tidy, &sep, &quit_item])?;

    let mut tray = TrayIconBuilder::with_id("tray")
        .tooltip("Dot Deck")
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let deck = app.state::<Deck>();
            let id = event.id.as_ref();
            match id {
                "settings" => show_settings(app, None),
                "hidden" => deck.set_hidden(app, !deck.hidden()),
                "arrange" => deck.set_option(app, "arrange", !deck.arrange()),
                "tidy" => deck.tidy(app, false),
                "quit" => {
                    deck.save();
                    app.exit(0);
                }
                other => {
                    if let Some(w) = other.strip_prefix("w:") {
                        // Off the main thread: opening a widget creates a window.
                        let (h, w, on) = (app.clone(), w.to_string(), !deck.is_enabled(w));
                        std::thread::spawn(move || h.state::<Deck>().set_enabled(&h, &w, on));
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_settings(tray.app_handle(), None);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(Tray { arrange, hidden, widgets });
    Ok(())
}

// ---- start-up -------------------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Launching Dot Deck again just opens its settings.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_settings(app, None)))
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            fs::create_dir_all(&dir)?;
            app.manage(Store { dir: dir.clone(), cache: Mutex::new(HashMap::new()) });
            app.manage(Deck::load(dir));
            app.manage(monitor::Monitor::new());
            app.manage(audio::Audio::new());
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let deck = app.state::<Deck>();
            let store = app.state::<Store>();
            let first_run = !deck.was_imported();
            if first_run {
                // Bring over the settings of any separate Dot apps you've used, and switch those widgets on.
                let found: Vec<&str> = WIDGETS.iter().map(|d| d.id).filter(|id| !store.exists(id) && old_state_path(&handle, id).is_some()).collect();
                let imported = deck_import(handle.clone(), store.clone(), found.iter().map(|s| s.to_string()).collect());
                if !imported.is_empty() {
                    let ids: Vec<&str> = imported.iter().map(|s| s.as_str()).collect();
                    deck.enable_quietly(&ids);
                }
                deck.mark_imported();
            }
            build_tray(app)?;
            deck.check_setup(&handle);
            for id in deck.enabled_ids() {
                if let Err(e) = deck.open_widget(&handle, id) {
                    eprintln!("couldn't open {}: {}", id, e);
                }
                on_widget_toggled(&handle, id, true);
            }
            if first_run || deck.enabled_ids().is_empty() {
                show_settings(&handle, None);
            }
            deck::start(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if label == "settings" {
                        // Closing settings just hides it, so it opens instantly next time.
                        let _ = window.hide();
                    } else if let Some(id) = deck::id_of_label(&label) {
                        // Closing a widget's window (e.g. Alt+F4) switches that widget off.
                        let app = window.app_handle().clone();
                        app.state::<Deck>().set_enabled(&app, id, false);
                    }
                }
                WindowEvent::Moved(p) => {
                    if label.starts_with("w-") {
                        let app = window.app_handle().clone();
                        app.state::<Deck>().on_moved(&app, &label, (p.x, p.y));
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            read_world_time,
            open_settings,
            recenter_widget,
            quit,
            deck_status,
            deck_set_enabled,
            deck_set_scale,
            deck_set_option,
            deck_set_hidden,
            deck_tidy,
            deck_setup,
            deck_import,
            deck_reset_widget,
            deck_set_size,
            deck_drag_start,
            deck_flags,
            deck_quit,
            monitor::read_system,
            media::read_player,
            media::player_action,
            media::read_audio,
            media::set_volume,
            media::set_muted,
            media::set_device,
            media::set_mic_muted,
            audio::audio_frame,
            audio::audio_sources,
            audio::set_audio_source,
            clipboard::copy_clip,
            clipboard::set_paused,
            tools::launch,
            tools::pick_path,
            tools::fetch_page,
            tools::open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dot Deck");
}
