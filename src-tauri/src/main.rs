// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK 2.48+ DMA-BUF renderer flickers/blanks transparent windows on
    // Arch/Fedora with AMD Mesa and on NVIDIA (tauri-apps/tauri#9394, #14924;
    // https://v2.tauri.app/develop/debug/linux-graphics/). Our overlay is a
    // transparent animated window, so it blinked during animations/fades. Use
    // the SHM renderer unless the user explicitly chose otherwise. Set before
    // any webview (and any thread) exists.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    voice_lib::run()
}
