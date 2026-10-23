# Building Dot Deck

The `.msi` has to be built on Windows and the `.dmg` on macOS. The steps are the same as for the separate Dot apps.

## build locally

### Windows (makes the .msi)

1. You already have the tools if you've built one of the other apps. If not, run these once in Terminal:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Rustlang.Rustup
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```

2. Open a terminal in this folder. In File Explorer, type `powershell` in the address bar of the folder that contains `package.json`.
3. Run:

   ```powershell
   npm install
   npm run build:win
   ```

4. The installer is written to `src-tauri\target\release\bundle\msi\Dot Deck_1.0.1_x64_en-US.msi`.

The first build takes a while (10–20 minutes), because it compiles every widget's Rust libraries. Later builds are much quicker.

### macOS (makes a universal .dmg)
 
1. Install the tools once, from Terminal. Skip any you already have.
 
   Xcode command line tools:
   ```
   xcode-select --install
   ```

   Rust. If you previously installed Rust through Homebrew, remove it first, because its older Cargo can't build this project and it conflicts with rustup:
   ```
   brew uninstall rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   Choose the standard installation, then load Rust into your current shell (or just open a new Terminal window):
   ```
   . "$HOME/.cargo/env"
   ```
 
   Node.js (with [Homebrew](https://brew.sh)):
   ```
   brew install node
   ```
   Or download the LTS installer from https://nodejs.org and open a new Terminal window afterwards.
 
   Check everything is in place. Each command should print a version, and `cargo` should be 1.85 or newer:
   ```
   node -v
   npm -v
   cargo --version
   rustup --version
   ```
 
2. Open Terminal in the project folder, the one that contains `package.json`. Type `cd ` (with a trailing space), drag the folder from Finder into the Terminal window and press Enter. For example:
   ```
   cd /Users/yourname/Downloads/dot-[widghetname]-main
   ```
 
3. Add the two Mac build targets and install the dependencies:
   ```
   rustup target add aarch64-apple-darwin x86_64-apple-darwin
   npm install
   ```
 
4. Build. The first run compiles a lot of Rust and can take several minutes:
   ```
   CI=true npm run build:mac
   ```
   `CI=true` skips the step where the DMG script uses AppleScript to arrange the window in Finder. That step can hang or fail depending on Automation permissions. The only effect is that the DMG window has no custom icon layout.
 
5. Open the output folder:
   ```
   open src-tauri/target/universal-apple-darwin/release/bundle/dmg/
   ```
   The installer is `Dot WIDGETNAME_X.X.X_universal.dmg`. If you only see `bundle_dmg.sh` and `icon.icns`, the build didn't finish; see Troubleshooting below.
 
### Troubleshooting (macOS)
 
- **`rustup: command not found`**: run `. "$HOME/.cargo/env"` or open a new Terminal window.
- **`npm: command not found`**: Node.js isn't installed; see step 1.
- **`feature edition2024 is required` / Cargo 1.84**: an old Homebrew Rust is being used instead of rustup's. Run `brew uninstall rust`, open a new Terminal window and check that `cargo --version` is 1.85 or newer.
- **No `.dmg` in the folder, and a "Dot WIDGET" disk is mounted**: a previous build was interrupted. Eject it with `hdiutil detach "/Volumes/Dot WIDGET"` (add `-force` if it's busy), then rebuild with `CI=true npm run build:mac`.

For development, `npm run dev` runs the app with live reload. `npm test` runs Dot Deck's own tests plus every widget's test suite against the copies inside Dot Deck.

## How it's put together

```
src/
  deck/settings.html, .css, .js   the Deck settings window (sidebar, Widgets, Layout, Look & scale)
  deck/bridge.js                  loaded first on every widget page so the apps' code runs unchanged
  widgets/<id>/                   each widget's own UI, copied from its separate app
src-tauri/src/
  lib.rs        the commands every widget calls, answered for the widget that's calling;
                Deck's own commands; tray menu; importing settings from the separate apps
  deck.rs       on/off, widget windows, layouts per screen setup, snapping, Alt-drag stacks, scale
  monitor.rs    Dot System's readings          media/      Dot Player's what's playing / sound
  audio.rs      Dot Visualiser's listening      clipboard.rs  Dot Clipboard's watcher
  tools.rs      Dot Launcher (open, file pickers) and Dot Reader (download pages)
tools/
  import_widgets.py   copies the separate apps' UI and tests in (run after changing one of them)
  vendor.js           copies Mozilla Readability in before each build
tests/                Dot Deck's tests, and tests/widgets/<id>.js (each app's tests)
```

**How a widget runs in Dot Deck:**
- Each widget is its own small window, labelled `w-<id>`, running exactly the same page as its separate app.
- When it calls `load_state` or `save_state`, Rust knows which widget it is from the window label, and keeps its settings in `<id>.json` in Dot Deck's config folder. Deck's own settings are in `deck.json` next to them.
- Its settings page runs in a frame inside the Deck settings window. The bridge adds the widget's id to every command there, and listens to that widget's events only (`state-changed:<id>`).
- **Every widget's events carry its id** (`state-changed:clock`, `clip:clipboard`). In Tauri a page's listeners hear events sent to *any* window, so plain names would let widgets overwrite each other's settings. The bridge adds the id to every `listen()`, and limits Tauri's own window events (like drag-and-drop) to the page's own window.

**To bring a change from a separate app into Dot Deck:**

```bash
python3 tools/import_widgets.py ..          # all of them, from the folder holding dot-clock, dot-timer, ...
python3 tools/import_widgets.py .. weather  # just one
```

## Things to know

- **First build, things to check.** The code that's new in Dot Deck (rather than copied from the separate apps) is:
  - opening a window per widget
  - the scale, using the webview's zoom (`set_zoom`)
  - recognising screen setups, snapping and stacks
  - the tray's tick boxes

  If the build fails, the error will point at `deck.rs` or `lib.rs`.
- **Scale.** Each widget's page asks for its natural size, and Deck multiplies it by the scale. If widgets ever look cut off at a scale other than 100%, that hand-off (`deck_set_size` in `bridge.js`) is the place to look.
- **Snapping happens when you let go**, once the widget has been still for about half a second. The window being dragged is moved by Windows or macOS itself, so it can't be pulled into place mid-drag (the rest of an Alt-drag stack does follow it live).
- **Settings are separate from the separate apps.** On first run Dot Deck copies their settings once and switches on the widgets you'd used. After that, changes in one don't affect the other. Use **Copy settings from the separate apps** to copy again.
- **The installers aren't code-signed.** As with the other apps, Windows shows a SmartScreen warning and macOS needs **Privacy & Security › Open Anyway**.
- **macOS asks permission** the first time a widget needs it:
  - location (Clock, Sun, Weather "use my location")
  - controlling Spotify / Music (Player, Visualiser)
  - the microphone (Visualiser)

  The wording is in `src-tauri/Info.plist`.
