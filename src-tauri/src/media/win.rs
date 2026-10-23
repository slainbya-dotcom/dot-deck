//! Windows: what's playing comes from the media API behind the volume flyout
//! (works with Spotify, browsers, the Media Player app and most others).
//! Volume and devices use Core Audio. Switching the default device uses
//! `IPolicyConfig`: Windows has no public API for that, so this is the same
//! long-standing interface used by sound-switching tools such as EarTrumpet.

use std::ffi::c_void;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::core::{Interface, IUnknown, GUID, HRESULT, HSTRING, PCWSTR};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::BOOL;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eMultimedia, eRender, EDataFlow, ERole, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};

use super::{pretty_source, Audio, Device, NowPlaying};

type WinResult<T> = windows::core::Result<T>;
fn err(e: windows::core::Error) -> String {
    e.message().to_string()
}

/// Each background thread needs COM switched on once; repeat calls are harmless.
fn com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

// ---- now playing ------------------------------------------------------------------------

fn session() -> Option<Session> {
    let manager = Manager::RequestAsync().ok()?.get().ok()?;
    manager.GetCurrentSession().ok()
}

/// 100-nanosecond ticks since 1601 (Windows `DateTime`).
fn now_ticks() -> i64 {
    let unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() / 100)
        .unwrap_or(0) as i64;
    unix + 116_444_736_000_000_000
}

fn read(s: &Session) -> WinResult<NowPlaying> {
    let props = s.TryGetMediaPropertiesAsync()?.get()?;
    let title = props.Title()?.to_string();
    let mut artist = props.Artist()?.to_string();
    if artist.is_empty() {
        artist = props.AlbumArtist().map(|a| a.to_string()).unwrap_or_default();
    }
    let playing = s.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
    let tl = s.GetTimelineProperties()?;
    let start = tl.StartTime()?.Duration;
    let end = tl.EndTime()?.Duration;
    let mut pos = tl.Position()?.Duration - start;
    // Apps only report the position now and then, so add the time since their last update.
    let updated = tl.LastUpdatedTime()?.UniversalTime;
    if playing && updated > 0 {
        let since = now_ticks() - updated;
        if since > 0 && since < 24 * 3600 * 10_000_000 {
            pos += since;
        }
    }
    let duration = ((end - start).max(0)) as f64 / 1e7;
    let mut position = (pos.max(0)) as f64 / 1e7;
    if duration > 0.0 {
        position = position.min(duration);
    }
    Ok(NowPlaying {
        available: !title.is_empty(),
        source: pretty_source(&s.SourceAppUserModelId()?.to_string()),
        title,
        artist,
        playing,
        position,
        duration,
    })
}

pub fn read_player(_source: &str) -> Result<NowPlaying, String> {
    match session() {
        Some(s) => read(&s).map_err(err),
        None => Ok(NowPlaying::default()),
    }
}

pub fn player_action(action: &str, position: f64) -> Result<(), String> {
    let s = match session() {
        Some(s) => s,
        None => return Ok(()),
    };
    let run = || -> WinResult<()> {
        match action {
            "toggle" => {
                s.TryTogglePlayPauseAsync()?.get()?;
            }
            "next" => {
                s.TrySkipNextAsync()?.get()?;
            }
            "prev" => {
                s.TrySkipPreviousAsync()?.get()?;
            }
            "seek" => {
                let start = s.GetTimelineProperties()?.StartTime()?.Duration;
                s.TryChangePlaybackPositionAsync(start + (position * 1e7) as i64)?.get()?;
            }
            _ => {}
        }
        Ok(())
    };
    run().map_err(err)
}

// ---- Core Audio ---------------------------------------------------------------------------

fn enumerator() -> WinResult<IMMDeviceEnumerator> {
    com();
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

fn device_id(d: &IMMDevice) -> String {
    unsafe {
        match d.GetId() {
            Ok(p) => {
                let s = p.to_string().unwrap_or_default();
                CoTaskMemFree(Some(p.0 as *const c_void));
                s
            }
            Err(_) => String::new(),
        }
    }
}

fn device_name(d: &IMMDevice) -> String {
    unsafe {
        d.OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
            .map(|v| v.to_string())
            .unwrap_or_else(|_| "Unknown device".to_string())
    }
}

fn list(en: &IMMDeviceEnumerator, flow: EDataFlow) -> Vec<Device> {
    let mut out = Vec::new();
    unsafe {
        if let Ok(col) = en.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) {
            for i in 0..col.GetCount().unwrap_or(0) {
                if let Ok(d) = col.Item(i) {
                    out.push(Device { id: device_id(&d), name: device_name(&d) });
                }
            }
        }
    }
    out
}

fn default_device(en: &IMMDeviceEnumerator, flow: EDataFlow) -> Option<IMMDevice> {
    unsafe { en.GetDefaultAudioEndpoint(flow, eConsole).ok() }
}

fn endpoint_volume(d: &IMMDevice) -> WinResult<IAudioEndpointVolume> {
    unsafe { d.Activate(CLSCTX_ALL, None) }
}

pub fn read_audio() -> Result<Audio, String> {
    let en = enumerator().map_err(err)?;
    let mut a = Audio {
        outputs: list(&en, eRender),
        inputs: list(&en, eCapture),
        ..Default::default()
    };
    if let Some(out) = default_device(&en, eRender) {
        a.output = device_id(&out);
        if let Ok(v) = endpoint_volume(&out) {
            unsafe {
                a.volume = v.GetMasterVolumeLevelScalar().ok();
                a.muted = v.GetMute().map(|b| b.as_bool()).unwrap_or(false);
            }
        }
    }
    if let Some(inp) = default_device(&en, eCapture) {
        a.input = device_id(&inp);
        if let Ok(v) = endpoint_volume(&inp) {
            unsafe {
                a.mic_muted = v.GetMute().map(|b| b.as_bool()).ok();
            }
        }
    }
    Ok(a)
}

fn with_volume(flow: EDataFlow, f: impl FnOnce(&IAudioEndpointVolume) -> WinResult<()>) -> Result<(), String> {
    let en = enumerator().map_err(err)?;
    let d = default_device(&en, flow).ok_or("no audio device")?;
    let v = endpoint_volume(&d).map_err(err)?;
    f(&v).map_err(err)
}

pub fn set_volume(level: f32) -> Result<(), String> {
    with_volume(eRender, |v| unsafe { v.SetMasterVolumeLevelScalar(level, std::ptr::null()) })
}

pub fn set_muted(muted: bool) -> Result<(), String> {
    with_volume(eRender, |v| unsafe { v.SetMute(BOOL::from(muted), std::ptr::null()) })
}

pub fn set_mic_muted(muted: bool) -> Result<(), String> {
    with_volume(eCapture, |v| unsafe { v.SetMute(BOOL::from(muted), std::ptr::null()) })
}

// ---- switching the default device (IPolicyConfig) -----------------------------------------

const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
const IID_POLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
/// Position of SetDefaultEndpoint in IPolicyConfig's table of functions
/// (3 IUnknown functions + 10 before it).
const SET_DEFAULT_ENDPOINT: usize = 13;

pub fn set_device(_input: bool, id: &str) -> Result<(), String> {
    com();
    unsafe {
        let unk: IUnknown = CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL).map_err(err)?;
        let mut raw: *mut c_void = std::ptr::null_mut();
        unk.query(&IID_POLICY_CONFIG, &mut raw).ok().map_err(err)?;
        if raw.is_null() {
            return Err("audio switching isn't available on this version of Windows".into());
        }
        type SetDefault = unsafe extern "system" fn(*mut c_void, PCWSTR, ERole) -> HRESULT;
        type Release = unsafe extern "system" fn(*mut c_void) -> u32;
        let vtbl = *(raw as *const *const usize);
        let set: SetDefault = std::mem::transmute(*vtbl.add(SET_DEFAULT_ENDPOINT));
        let release: Release = std::mem::transmute(*vtbl.add(2));
        let wide = HSTRING::from(id);
        let mut result = Ok(());
        // The same device for everything: apps, system sounds and calls.
        for role in [eConsole, eMultimedia, eCommunications] {
            if let Err(e) = set(raw, PCWSTR(wide.as_ptr()), role).ok() {
                result = Err(err(e));
            }
        }
        release(raw);
        result
    }
}
