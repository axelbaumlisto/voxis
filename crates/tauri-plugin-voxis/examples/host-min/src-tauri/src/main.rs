// Prevents an additional console window on Windows in release, not that
// this tracer-bullet harness targets Windows, but Tauri's own scaffold
// includes it and there is no reason to drop it. All real logic lives in
// `lib.rs` (Task 8.5: iOS builds a library target, not a `[[bin]]` --
// `main.rs` is desktop-only and just calls the shared entry point).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    host_min_lib::run();
}
