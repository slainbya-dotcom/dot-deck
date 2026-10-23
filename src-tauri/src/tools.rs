//! Commands from Dot Launcher (opening things, file pickers) and Dot Reader
//! (downloading pages, opening the normal browser), unchanged apart from where the
//! launcher's settings are read from.

use tauri::State;

use crate::Store;

/// Opens a launcher item (app, file, folder or website) by its id. The target is
/// looked up in the saved settings, so only things you added can be opened.
#[tauri::command]
pub fn launch(store: State<'_, Store>, id: String) -> Result<(), String> {
    let json = store.get("launcher");
    let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let target = v["items"]
        .as_array()
        .and_then(|items| items.iter().find(|i| i["id"].as_str() == Some(id.as_str())))
        .and_then(|i| i["target"].as_str())
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .ok_or("that item isn't in the launcher any more")?;
    open_target(&target)
}

#[cfg(windows)]
fn open_target(target: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // Explorer opens apps, shortcuts (.lnk), files, folders and web links with their usual program.
    std::process::Command::new("explorer.exe")
        .arg(target)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_target(target: &str) -> Result<(), String> {
    // `open` handles .app bundles, files, folders and web links.
    let status = std::process::Command::new("/usr/bin/open").arg(target).status().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err(format!("couldn't open {}", target)) }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn open_target(target: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Shows the system's file picker. `kind`: "app", "file" or "folder". Returns the path, or None if cancelled.
#[tauri::command]
pub fn pick_path(kind: String) -> Option<String> {
    let d = rfd::FileDialog::new();
    let picked = match kind.as_str() {
        "folder" => d.set_title("Choose a folder").pick_folder(),
        "app" => {
            #[cfg(windows)]
            let d = d
                .set_title("Choose an app (or its shortcut)")
                .add_filter("Apps and shortcuts", &["exe", "lnk", "url", "appref-ms"])
                .set_directory(std::env::var("ProgramData").map(|p| format!("{}\\Microsoft\\Windows\\Start Menu\\Programs", p)).unwrap_or_default());
            #[cfg(target_os = "macos")]
            let d = d.set_title("Choose an app").add_filter("Apps", &["app"]).set_directory("/Applications");
            d.pick_file()
        }
        _ => d.set_title("Choose a file").pick_file(),
    };
    picked.map(|p| p.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct Page {
    /// Where we ended up after any redirects
    url: String,
    html: String,
}

const MAX_PAGE: u64 = 8 * 1024 * 1024;

/// Downloads a web page (http/https only) for reading mode. The page's own scripts
/// never run: the widget only reads its text.
#[tauri::command]
pub async fn fetch_page(url: String) -> Result<Page, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lower = url.to_ascii_lowercase();
        if !(lower.starts_with("http://") || lower.starts_with("https://")) {
            return Err("only web addresses (http / https) can be opened".to_string());
        }
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(20))
            .redirects(8)
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DotReader/1.0")
            .build();
        let resp = match agent.get(&url).set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5").set("Accept-Language", "en-GB,en;q=0.8").call() {
            Ok(r) => r,
            Err(ureq::Error::Status(code, _)) => return Err(format!("the site answered {}", code)),
            Err(e) => return Err(e.to_string()),
        };
        let final_url = resp.get_url().to_string();
        let kind = resp.content_type().to_ascii_lowercase();
        if !(kind.contains("html") || kind.contains("xml") || kind.starts_with("text/")) {
            return Err(format!("that's not a web page ({})", kind));
        }
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut std::io::Read::take(resp.into_reader(), MAX_PAGE), &mut bytes).map_err(|e| e.to_string())?;
        Ok(Page { url: final_url, html: String::from_utf8_lossy(&bytes).to_string() })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens a web address in the normal browser (for pages reading mode can't handle).
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only web addresses can be opened".into());
    }
    #[cfg(windows)]
    let cmd = std::process::Command::new("explorer.exe").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let cmd = std::process::Command::new("/usr/bin/open").arg(&url).spawn();
    #[cfg(not(any(windows, target_os = "macos")))]
    let cmd = std::process::Command::new("xdg-open").arg(&url).spawn();
    cmd.map(|_| ()).map_err(|e| e.to_string())
}

