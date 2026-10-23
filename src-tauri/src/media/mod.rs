//! What's playing, play/skip, volume and audio devices (Dot Player; Dot Visualiser
//! uses `read_player` for its track line).
//!
//! The commands here are the same on every platform; the work is done by
//! `win.rs` or `macos.rs`. Everything runs on a background thread so a slow
//! media app can never freeze the widget.

use serde::Serialize;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as os;
#[cfg(windows)]
mod win;
#[cfg(windows)]
use win as os;
#[cfg(not(any(windows, target_os = "macos")))]
mod other;
#[cfg(not(any(windows, target_os = "macos")))]
use other as os;

#[derive(Serialize, Default, Clone, Debug)]
pub struct NowPlaying {
    /// false = nothing playing (or no supported player open)
    pub available: bool,
    /// The app it came from, e.g. "Spotify"
    pub source: String,
    pub title: String,
    pub artist: String,
    pub playing: bool,
    /// Seconds
    pub position: f64,
    /// Seconds; 0 when the app doesn't say (e.g. a live stream)
    pub duration: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Device {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Default, Clone, Debug)]
pub struct Audio {
    /// 0..1, or None when the output device has no volume control (e.g. some HDMI screens)
    pub volume: Option<f32>,
    pub muted: bool,
    pub outputs: Vec<Device>,
    /// id of the current output device
    pub output: String,
    pub inputs: Vec<Device>,
    pub input: String,
    /// None when the microphone can't be muted from software
    pub mic_muted: Option<bool>,
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// `source`: "auto", "spotify" or "music" (the last two only matter on macOS).
#[tauri::command]
pub async fn read_player(source: Option<String>) -> Result<NowPlaying, String> {
    let source = source.unwrap_or_else(|| "auto".into());
    blocking(move || os::read_player(&source)).await
}

/// `action`: "toggle", "next", "prev" or "seek" (with `position` in seconds).
#[tauri::command]
pub async fn player_action(action: String, position: Option<f64>) -> Result<(), String> {
    blocking(move || os::player_action(&action, position.unwrap_or(0.0))).await
}

#[tauri::command]
pub async fn read_audio() -> Result<Audio, String> {
    blocking(os::read_audio).await
}

#[tauri::command]
pub async fn set_volume(level: f32) -> Result<(), String> {
    blocking(move || os::set_volume(level.clamp(0.0, 1.0))).await
}

#[tauri::command]
pub async fn set_muted(muted: bool) -> Result<(), String> {
    blocking(move || os::set_muted(muted)).await
}

/// `kind`: "output" or "input".
#[tauri::command]
pub async fn set_device(kind: String, id: String) -> Result<(), String> {
    blocking(move || os::set_device(kind == "input", &id)).await
}

#[tauri::command]
pub async fn set_mic_muted(muted: bool) -> Result<(), String> {
    blocking(move || os::set_mic_muted(muted)).await
}

/// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" / "Spotify.exe" / "chrome" -> "Spotify" / "Chrome".
pub fn pretty_source(id: &str) -> String {
    let mut s = id.rsplit('!').next().unwrap_or(id);
    if let Some(stripped) = s.strip_suffix(".exe").or_else(|| s.strip_suffix(".EXE")) {
        s = stripped;
    }
    if let Some(last) = s.rsplit(['\\', '/']).next() {
        s = last;
    }
    let s = match s.to_ascii_lowercase().as_str() {
        "msedge" => "Edge".to_string(),
        "chrome" => "Chrome".to_string(),
        "firefox" | "308046b0af4a39cb" => "Firefox".to_string(),
        _ => {
            let mut c = s.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        }
    };
    s
}
