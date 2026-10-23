//! Listens to the computer's sound and turns it into what the widget draws:
//! 32 frequency bands (in decibels), a short waveform, and left/right loudness.
//!
//! * Windows: "system" = whatever is going to the speakers (WASAPI loopback;
//!   no permission needed). It follows the default output if you switch it.
//! * macOS: apps can't simply listen to system audio, so "system" means the
//!   default input device. Choosing a loopback driver (e.g. BlackHole) as the
//!   input gives true system audio; a microphone shows the room.
//!
//! The stream lives on its own thread (audio streams can't move between
//! threads on every platform) and is rebuilt when the source changes, the
//! default device changes, or the device reports an error.

use std::sync::atomic::{AtomicBool, Ordering};

/// Dot Deck: only listen while the Visualiser widget is on.
pub static ACTIVE: AtomicBool = AtomicBool::new(false);
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::Serialize;

pub const SYSTEM: &str = "system";
const N: usize = 2048; // samples per analysis (about 45 ms at 44.1 kHz)
const BANDS: usize = 32;
const WAVE: usize = 128;

struct Buffer {
    ring: Vec<f32>,
    pos: usize,
    left: f32,
    right: f32,
    rate: u32,
    last_data: Option<Instant>,
    error: Option<String>,
    device: String,
}

pub struct Audio {
    buf: Arc<Mutex<Buffer>>,
    source: Arc<Mutex<String>>,
    restart: Arc<AtomicBool>,
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Frame {
    /// Loudness of each band in dB (-100 to 0), low notes first
    pub bands: Vec<f32>,
    /// The last few milliseconds of the sound wave, -1..1
    pub wave: Vec<f32>,
    /// RMS loudness 0..1
    pub left: f32,
    pub right: f32,
    /// false when nothing is coming through
    pub active: bool,
    pub device: String,
    pub error: Option<String>,
}

fn es(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl Audio {
    pub fn new() -> Self {
        let buf = Arc::new(Mutex::new(Buffer {
            ring: vec![0.0; N],
            pos: 0,
            left: 0.0,
            right: 0.0,
            rate: 48_000,
            last_data: None,
            error: None,
            device: String::new(),
        }));
        let source = Arc::new(Mutex::new(SYSTEM.to_string()));
        let restart = Arc::new(AtomicBool::new(false));
        {
            let (buf, source, restart) = (buf.clone(), source.clone(), restart.clone());
            thread::spawn(move || capture_loop(buf, source, restart));
        }
        let fft = FftPlanner::<f32>::new().plan_fft_forward(N);
        // Hann window: stops the edges of each slice smearing across the bands.
        let window = (0..N)
            .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (N as f32 - 1.0)).cos())
            .collect();
        Audio { buf, source, restart, fft, window }
    }

    fn frame(&self) -> Frame {
        let (samples, left, right, active, rate, error, device) = {
            let b = self.buf.lock().unwrap();
            let mut s = Vec::with_capacity(N);
            s.extend_from_slice(&b.ring[b.pos..]);
            s.extend_from_slice(&b.ring[..b.pos]);
            let active = b.last_data.map(|t| t.elapsed() < Duration::from_millis(300)).unwrap_or(false);
            (s, b.left, b.right, active, b.rate, b.error.clone(), b.device.clone())
        };
        if !active {
            return Frame {
                bands: vec![-100.0; BANDS],
                wave: vec![0.0; WAVE],
                left: 0.0,
                right: 0.0,
                active: false,
                device,
                error,
            };
        }
        let mut spec: Vec<Complex<f32>> = samples
            .iter()
            .zip(&self.window)
            .map(|(s, w)| Complex::new(s * w, 0.0))
            .collect();
        self.fft.process(&mut spec);
        let scale = 4.0 / N as f32; // 2 for one-sided, 2 for the Hann window's loss
        let mags: Vec<f32> = spec[..N / 2].iter().map(|c| c.norm() * scale).collect();
        // Bands spaced like hearing: 40 Hz to 16 kHz, each a fixed ratio wider.
        let lo = 40.0f32;
        let hi = (rate as f32 / 2.0).min(16_000.0);
        let bin = |f: f32| ((f * N as f32 / rate as f32).round() as usize).clamp(1, N / 2 - 1);
        let bands = (0..BANDS)
            .map(|k| {
                let f0 = lo * (hi / lo).powf(k as f32 / BANDS as f32);
                let f1 = lo * (hi / lo).powf((k + 1) as f32 / BANDS as f32);
                let (b0, b1) = (bin(f0), bin(f1).max(bin(f0)));
                let m = mags[b0..=b1].iter().cloned().fold(0.0f32, f32::max);
                (20.0 * (m + 1e-9).log10()).clamp(-100.0, 0.0)
            })
            .collect();
        let tail = &samples[N - WAVE * 2..];
        let wave = (0..WAVE).map(|i| tail[i * 2].clamp(-1.0, 1.0)).collect();
        Frame { bands, wave, left: left.min(1.0), right: right.min(1.0), active, device, error }
    }
}

fn default_output_name() -> String {
    cpal::default_host()
        .default_output_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default()
}

fn capture_loop(buf: Arc<Mutex<Buffer>>, source: Arc<Mutex<String>>, restart: Arc<AtomicBool>) {
    loop {
        // Dot Deck: nothing is opened until the Visualiser is switched on.
        while !ACTIVE.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(300));
        }
        let src = source.lock().unwrap().clone();
        restart.store(false, Ordering::SeqCst);
        match open(&src, buf.clone()) {
            Ok((stream, name)) => {
                {
                    let mut b = buf.lock().unwrap();
                    b.error = None;
                    b.device = name.clone();
                }
                let follow = cfg!(windows) && src == SYSTEM;
                let mut checked = Instant::now();
                loop {
                    thread::sleep(Duration::from_millis(250));
                    if restart.load(Ordering::SeqCst) || buf.lock().unwrap().error.is_some() || !ACTIVE.load(Ordering::SeqCst) {
                        break;
                    }
                    // Switched speakers / headphones: listen to the new one.
                    if follow && checked.elapsed() > Duration::from_secs(2) {
                        checked = Instant::now();
                        if default_output_name() != name {
                            break;
                        }
                    }
                }
                drop(stream);
            }
            Err(e) => {
                buf.lock().unwrap().error = Some(e);
                // Try again shortly (a device may have been plugged back in).
                for _ in 0..12 {
                    thread::sleep(Duration::from_millis(250));
                    if restart.load(Ordering::SeqCst) {
                        break;
                    }
                }
            }
        }
    }
}

fn open(src: &str, buf: Arc<Mutex<Buffer>>) -> Result<(cpal::Stream, String), String> {
    let host = cpal::default_host();
    let (device, config) = if src == SYSTEM {
        if cfg!(windows) {
            // An *output* device opened for input = loopback on Windows.
            let d = host.default_output_device().ok_or("no speakers or headphones found")?;
            let c = d.default_output_config().map_err(es)?;
            (d, c)
        } else {
            let d = host.default_input_device().ok_or("no sound input found")?;
            let c = d.default_input_config().map_err(es)?;
            (d, c)
        }
    } else {
        let d = host
            .input_devices()
            .map_err(es)?
            .find(|d| d.name().map(|n| n == src).unwrap_or(false))
            .ok_or("that input device isn't connected")?;
        let c = d.default_input_config().map_err(es)?;
        (d, c)
    };
    let name = device.name().unwrap_or_default();
    let channels = config.channels() as usize;
    buf.lock().unwrap().rate = config.sample_rate().0;
    let cfg: cpal::StreamConfig = config.config();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => build::<f32>(&device, &cfg, channels, buf),
        cpal::SampleFormat::I16 => build::<i16>(&device, &cfg, channels, buf),
        cpal::SampleFormat::U16 => build::<u16>(&device, &cfg, channels, buf),
        cpal::SampleFormat::I32 => build::<i32>(&device, &cfg, channels, buf),
        f => return Err(format!("unsupported sound format {:?}", f)),
    }?;
    stream.play().map_err(es)?;
    Ok((stream, name))
}

fn build<T>(device: &cpal::Device, cfg: &cpal::StreamConfig, ch: usize, buf: Arc<Mutex<Buffer>>) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let ch = ch.max(1);
    let err_buf = buf.clone();
    device
        .build_input_stream(
            cfg,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let frames = data.len() / ch;
                if frames == 0 {
                    return;
                }
                let mut b = buf.lock().unwrap();
                let (mut l2, mut r2) = (0.0f32, 0.0f32);
                for f in 0..frames {
                    let l: f32 = data[f * ch].to_sample::<f32>();
                    let r: f32 = if ch > 1 { data[f * ch + 1].to_sample::<f32>() } else { l };
                    l2 += l * l;
                    r2 += r * r;
                    let p = b.pos;
                    b.ring[p] = (l + r) * 0.5;
                    b.pos = (p + 1) % N;
                }
                b.left = (l2 / frames as f32).sqrt();
                b.right = (r2 / frames as f32).sqrt();
                // Windows keeps sending silence while paused; treat near-silence as "nothing playing".
                if b.left + b.right > 1e-5 {
                    b.last_data = Some(Instant::now());
                }
            },
            move |e| {
                err_buf.lock().unwrap().error = Some(e.to_string());
            },
            None,
        )
        .map_err(es)
}

// ---- commands -----------------------------------------------------------------------------------

#[tauri::command]
pub fn audio_frame(audio: tauri::State<'_, Audio>) -> Frame {
    audio.frame()
}

/// What can be listened to: "system" first, then every input device by name.
#[tauri::command]
pub fn audio_sources() -> Vec<String> {
    let mut out = vec![SYSTEM.to_string()];
    if let Ok(devs) = cpal::default_host().input_devices() {
        for d in devs {
            if let Ok(n) = d.name() {
                if !out.contains(&n) {
                    out.push(n);
                }
            }
        }
    }
    out
}

#[tauri::command]
pub fn set_audio_source(audio: tauri::State<'_, Audio>, source: String) {
    let mut s = audio.source.lock().unwrap();
    if *s != source {
        *s = source;
        audio.restart.store(true, Ordering::SeqCst);
    }
}
