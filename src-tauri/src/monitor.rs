//! Live CPU / memory / disk / network / battery readings for the widget.

use std::{sync::Mutex, time::Instant};

use serde::Serialize;
use sysinfo::{Disks, Networks, System};

pub struct Monitor {
    sys: Mutex<System>,
    nets: Mutex<(Networks, Instant)>,
}

impl Monitor {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage(); // first sample; usage is measured between refreshes
        sys.refresh_memory();
        Monitor {
            sys: Mutex::new(sys),
            nets: Mutex::new((Networks::new_with_refreshed_list(), Instant::now())),
        }
    }
}

#[derive(Serialize)]
pub struct Reading {
    /// 0–1 across all cores
    cpu: f32,
    /// 0–1 of physical memory in use
    mem: f64,
    /// 0–1 of the system disk's space in use
    disk: f64,
    /// bytes per second since the last reading
    net_down: f64,
    net_up: f64,
    /// 0–1, or null on machines without a battery
    battery: Option<f32>,
    /// plugged in (charging or full)
    plugged: bool,
    /// minutes until empty while discharging, if the OS knows
    battery_minutes: Option<u32>,
}

/// The disk that holds the operating system: "/" on macOS, C:\ on Windows.
fn system_disk_usage() -> f64 {
    let disks = Disks::new_with_refreshed_list();
    let pick = disks
        .list()
        .iter()
        .find(|d| {
            let m = d.mount_point().to_string_lossy().to_uppercase();
            m == "/" || m.starts_with("C:")
        })
        .or_else(|| disks.list().iter().max_by_key(|d| d.total_space()));
    match pick {
        Some(d) if d.total_space() > 0 => {
            d.total_space().saturating_sub(d.available_space()) as f64 / d.total_space() as f64
        }
        _ => 0.0,
    }
}

fn battery() -> (Option<f32>, bool, Option<u32>) {
    let Ok(manager) = starship_battery::Manager::new() else {
        return (None, false, None);
    };
    let Ok(mut batteries) = manager.batteries() else {
        return (None, false, None);
    };
    match batteries.next() {
        Some(Ok(b)) => {
            let level = b.state_of_charge().value; // a 0–1 ratio
            let plugged = matches!(
                b.state(),
                starship_battery::State::Charging | starship_battery::State::Full
            );
            let minutes = b.time_to_empty().map(|t| (t.value / 60.0) as u32); // seconds → minutes
            (Some(level.clamp(0.0, 1.0)), plugged, minutes)
        }
        _ => (None, false, None),
    }
}

/// One reading. Call it every second or two; CPU and network are measured
/// over the time since the previous call.
#[tauri::command]
pub fn read_system(monitor: tauri::State<'_, Monitor>) -> Reading {
    let (cpu, mem) = {
        let mut sys = monitor.sys.lock().unwrap();
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let total = sys.total_memory();
        let mem = if total > 0 { sys.used_memory() as f64 / total as f64 } else { 0.0 };
        ((sys.global_cpu_usage() / 100.0).clamp(0.0, 1.0), mem)
    };

    let (net_down, net_up) = {
        let mut guard = monitor.nets.lock().unwrap();
        let (nets, last) = &mut *guard;
        nets.refresh();
        let secs = last.elapsed().as_secs_f64().max(0.05);
        *last = Instant::now();
        let (mut rx, mut tx) = (0u64, 0u64);
        for (_name, data) in nets.list() {
            rx += data.received();
            tx += data.transmitted();
        }
        (rx as f64 / secs, tx as f64 / secs)
    };

    let (battery, plugged, battery_minutes) = battery();

    Reading {
        cpu,
        mem,
        disk: system_disk_usage(),
        net_down,
        net_up,
        battery,
        plugged,
        battery_minutes,
    }
}
