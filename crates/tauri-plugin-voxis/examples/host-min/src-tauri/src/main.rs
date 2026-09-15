// `host-min`: the minimal Tauri 2 host embedding `tauri-plugin-voxis`
// (Task 4's own manual verification harness, and the base T3.5 builds its
// CI-path/real-mic tracer bullet on top of). No framework, no bundler on
// the frontend side (`../ui/index.html` + `main.js`, `withGlobalTauri`).
//
// Capture backend selection via `VOXIS_CAPTURE`:
// - unset or `mock[:<wav>]` (default): `tauri_plugin_voxis::init()` \u2014
//   `MockCapture`, no real microphone/hotkey involved. Scripting
//   `MockCapture` from the `mock:<wav>` fixture path (so Task 3.5 can
//   drive a deterministic "loud window" through it) is that task's own
//   wiring, not required here \u2014 Task 4 only needs the two backends to be
//   selectable and buildable.
// - `cpal`: `tauri_plugin_voxis::init_desktop()` \u2014 real `CpalCapture` +
//   `RdevHotkey` (Task 4's own backends). Prompts for microphone
//   permission on first use.
//
// `VOXIS_STT_URL` (read here, not yet threaded into the plugin's
// pipeline config \u2014 that plumbing is Task 2/6/7's `VoxisProfile`/
// `apply_profile` job) is accepted as a no-op today so the two documented
// run commands in `README.md` don't need to change once that lands.

fn main() {
    let capture_mode = std::env::var("VOXIS_CAPTURE").unwrap_or_else(|_| "mock".to_string());
    if let Ok(stt_url) = std::env::var("VOXIS_STT_URL") {
        eprintln!("VOXIS_STT_URL={stt_url} (not yet wired into the plugin's pipeline config -- Task 2/6/7)");
    }

    let mut builder = tauri::Builder::default();
    builder = if capture_mode.starts_with("cpal") {
        builder.plugin(tauri_plugin_voxis::init_desktop())
    } else {
        builder.plugin(tauri_plugin_voxis::init())
    };

    builder
        .run(tauri::generate_context!())
        .expect("error while running host-min");
}
