//! macOS: since macOS 15.4 apps can't read the system-wide "Now Playing" info,
//! so Dot Player asks Spotify and Apple Music directly (AppleScript; macOS asks
//! the user's permission once per app). Volume and devices use Core Audio.

use std::ffi::c_void;
use std::process::Command;
use std::sync::Mutex;

use super::{Audio, Device, NowPlaying};

// ---- now playing (AppleScript) ----------------------------------------------------------------

struct App {
    /// Process name (to check it's running without launching it)
    process: &'static str,
    /// Application name for AppleScript
    name: &'static str,
    /// Spotify reports track length in milliseconds, Music in seconds
    duration_ms: bool,
}
const SPOTIFY: App = App { process: "Spotify", name: "Spotify", duration_ms: true };
const MUSIC: App = App { process: "Music", name: "Music", duration_ms: false };

/// Which app the last reading came from, so the buttons control the right one.
static LAST: Mutex<Option<&'static str>> = Mutex::new(None);

fn running(app: &App) -> bool {
    Command::new("/usr/bin/pgrep")
        .args(["-xq", app.process])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn osascript(script: &str) -> Option<String> {
    let out = Command::new("/usr/bin/osascript").arg("-e").arg(script).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim_end_matches(['\n', '\r']).to_string())
}

fn num(s: &str) -> f64 {
    // AppleScript uses the system's decimal separator ("12,5" in many countries).
    s.trim().replace(',', ".").parse().unwrap_or(0.0)
}

fn query(app: &App) -> Option<NowPlaying> {
    if !running(app) {
        return None;
    }
    let length = if app.duration_ms { "((duration of t) / 1000)" } else { "(duration of t)" };
    let script = format!(
        r#"tell application "{name}"
  set s to player state as string
  if s is "stopped" then return "stopped"
  set t to current track
  return s & tab & (name of t) & tab & (artist of t) & tab & (player position as string) & tab & ({length} as string)
end tell"#,
        name = app.name,
        length = length
    );
    let out = osascript(&script)?;
    let f: Vec<&str> = out.split('\t').collect();
    if f.len() < 5 {
        return None;
    }
    Some(NowPlaying {
        available: !f[1].is_empty(),
        source: app.name.to_string(),
        title: f[1].to_string(),
        artist: f[2].to_string(),
        playing: f[0] == "playing",
        position: num(f[3]),
        duration: num(f[4]),
    })
}

pub fn read_player(source: &str) -> Result<NowPlaying, String> {
    let apps: Vec<&App> = match source {
        "spotify" => vec![&SPOTIFY],
        "music" => vec![&MUSIC],
        _ => vec![&SPOTIFY, &MUSIC],
    };
    let found: Vec<(&App, NowPlaying)> =
        apps.into_iter().filter_map(|a| query(a).map(|np| (a, np))).filter(|(_, np)| np.available).collect();
    // Prefer whichever is actually playing.
    let pick = found.iter().find(|(_, np)| np.playing).or_else(|| found.first());
    match pick {
        Some((app, np)) => {
            *LAST.lock().unwrap() = Some(app.name);
            Ok(np.clone())
        }
        None => Ok(NowPlaying::default()),
    }
}

pub fn player_action(action: &str, position: f64) -> Result<(), String> {
    let name = match *LAST.lock().unwrap() {
        Some(n) => n,
        None => return Ok(()),
    };
    let cmd = match action {
        "toggle" => "playpause".to_string(),
        "next" => "next track".to_string(),
        "prev" => "previous track".to_string(),
        "seek" => format!("set player position to {:.2}", position.max(0.0)),
        _ => return Ok(()),
    };
    osascript(&format!(r#"tell application "{}" to {}"#, name, cmd))
        .map(|_| ())
        .ok_or_else(|| format!("{} didn't respond", name))
}

// ---- Core Audio -----------------------------------------------------------------------------------

#[repr(C)]
struct Addr {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectHasProperty(id: u32, addr: *const Addr) -> u8;
    fn AudioObjectGetPropertyDataSize(id: u32, addr: *const Addr, qsize: u32, q: *const c_void, size: *mut u32) -> i32;
    fn AudioObjectGetPropertyData(id: u32, addr: *const Addr, qsize: u32, q: *const c_void, size: *mut u32, data: *mut c_void) -> i32;
    fn AudioObjectSetPropertyData(id: u32, addr: *const Addr, qsize: u32, q: *const c_void, size: u32, data: *const c_void) -> i32;
}

const fn code(s: &[u8; 4]) -> u32 {
    ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
}
const SYSTEM: u32 = 1; // kAudioObjectSystemObject
const DEVICES: u32 = code(b"dev#");
const DEFAULT_OUT: u32 = code(b"dOut");
const DEFAULT_IN: u32 = code(b"dIn ");
const STREAMS: u32 = code(b"stm#");
const NAME: u32 = code(b"name");
const VOLUME: u32 = code(b"volm");
const MUTE: u32 = code(b"mute");
const GLOBAL: u32 = code(b"glob");
const OUTPUT: u32 = code(b"outp");
const INPUT: u32 = code(b"inpt");

fn addr(selector: u32, scope: u32, element: u32) -> Addr {
    Addr { selector, scope, element }
}

fn has(id: u32, a: &Addr) -> bool {
    unsafe { AudioObjectHasProperty(id, a) != 0 }
}

fn get<T: Copy + Default>(id: u32, a: &Addr) -> Option<T> {
    let mut v = T::default();
    let mut size = std::mem::size_of::<T>() as u32;
    let st = unsafe { AudioObjectGetPropertyData(id, a, 0, std::ptr::null(), &mut size, &mut v as *mut T as *mut c_void) };
    (st == 0).then_some(v)
}

fn set<T: Copy>(id: u32, a: &Addr, v: T) -> Result<(), String> {
    let st = unsafe {
        AudioObjectSetPropertyData(id, a, 0, std::ptr::null(), std::mem::size_of::<T>() as u32, &v as *const T as *const c_void)
    };
    if st == 0 { Ok(()) } else { Err(format!("Core Audio error {}", st)) }
}

fn size_of_prop(id: u32, a: &Addr) -> u32 {
    let mut size = 0u32;
    let st = unsafe { AudioObjectGetPropertyDataSize(id, a, 0, std::ptr::null(), &mut size) };
    if st == 0 { size } else { 0 }
}

fn all_devices() -> Vec<u32> {
    let a = addr(DEVICES, GLOBAL, 0);
    let n = size_of_prop(SYSTEM, &a) as usize / 4;
    let mut ids = vec![0u32; n];
    let mut size = (n * 4) as u32;
    let st = unsafe { AudioObjectGetPropertyData(SYSTEM, &a, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void) };
    if st != 0 {
        return vec![];
    }
    ids.truncate(size as usize / 4);
    ids
}

fn name(id: u32) -> String {
    let a = addr(NAME, GLOBAL, 0);
    let mut buf = [0u8; 256];
    let mut size = buf.len() as u32;
    let st = unsafe { AudioObjectGetPropertyData(id, &a, 0, std::ptr::null(), &mut size, buf.as_mut_ptr() as *mut c_void) };
    if st != 0 {
        return "Unknown device".into();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(size as usize);
    String::from_utf8_lossy(&buf[..end]).to_string()
}

fn devices(scope: u32) -> Vec<Device> {
    all_devices()
        .into_iter()
        .filter(|&id| size_of_prop(id, &addr(STREAMS, scope, 0)) > 0)
        .map(|id| Device { id: id.to_string(), name: name(id) })
        .collect()
}

fn default_device(input: bool) -> u32 {
    get::<u32>(SYSTEM, &addr(if input { DEFAULT_IN } else { DEFAULT_OUT }, GLOBAL, 0)).unwrap_or(0)
}

/// The main volume, or the left/right channels when the device has no main control.
fn volume_elements(id: u32) -> Vec<u32> {
    if has(id, &addr(VOLUME, OUTPUT, 0)) {
        vec![0]
    } else {
        [1, 2].into_iter().filter(|&e| has(id, &addr(VOLUME, OUTPUT, e))).collect()
    }
}

pub fn read_audio() -> Result<Audio, String> {
    let out = default_device(false);
    let inp = default_device(true);
    let els = volume_elements(out);
    let vols: Vec<f32> = els.iter().filter_map(|&e| get::<f32>(out, &addr(VOLUME, OUTPUT, e))).collect();
    let mic_mute = addr(MUTE, INPUT, 0);
    Ok(Audio {
        volume: if vols.is_empty() { None } else { Some(vols.iter().sum::<f32>() / vols.len() as f32) },
        muted: get::<u32>(out, &addr(MUTE, OUTPUT, 0)).map(|m| m != 0).unwrap_or(false),
        outputs: devices(OUTPUT),
        output: out.to_string(),
        inputs: devices(INPUT),
        input: inp.to_string(),
        mic_muted: if has(inp, &mic_mute) { get::<u32>(inp, &mic_mute).map(|m| m != 0) } else { None },
    })
}

pub fn set_volume(level: f32) -> Result<(), String> {
    let out = default_device(false);
    let els = volume_elements(out);
    if els.is_empty() {
        return Err("this output has no volume control".into());
    }
    for e in els {
        set(out, &addr(VOLUME, OUTPUT, e), level)?;
    }
    Ok(())
}

pub fn set_muted(muted: bool) -> Result<(), String> {
    set(default_device(false), &addr(MUTE, OUTPUT, 0), muted as u32)
}

pub fn set_mic_muted(muted: bool) -> Result<(), String> {
    set(default_device(true), &addr(MUTE, INPUT, 0), muted as u32)
}

pub fn set_device(input: bool, id: &str) -> Result<(), String> {
    let id: u32 = id.parse().map_err(|_| "bad device id".to_string())?;
    set(SYSTEM, &addr(if input { DEFAULT_IN } else { DEFAULT_OUT }, GLOBAL, 0), id)
}
