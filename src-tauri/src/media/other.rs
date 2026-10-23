//! Other platforms (e.g. Linux during development): nothing playing, no controls.

use super::{Audio, NowPlaying};

pub fn read_player(_source: &str) -> Result<NowPlaying, String> {
    Ok(NowPlaying::default())
}
pub fn player_action(_action: &str, _position: f64) -> Result<(), String> {
    Ok(())
}
pub fn read_audio() -> Result<Audio, String> {
    Ok(Audio::default())
}
pub fn set_volume(_level: f32) -> Result<(), String> {
    Err("not supported on this system".into())
}
pub fn set_muted(_muted: bool) -> Result<(), String> {
    Err("not supported on this system".into())
}
pub fn set_mic_muted(_muted: bool) -> Result<(), String> {
    Err("not supported on this system".into())
}
pub fn set_device(_input: bool, _id: &str) -> Result<(), String> {
    Err("not supported on this system".into())
}
