// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Usage line for `--help`/`-h`.
const USAGE: &str = "usage: voxis [--version | -V | --help | -h]";

/// Answer for a command-line flag that must not start the GUI: the text to
/// print for `--version`/`-V` and `--help`/`-h`, `None` for a normal launch.
///
/// `--version` is a contract, not a nicety: Homebrew's formula test runs
/// `voxis --version` (homebrew-tap/Formula/voxis.rb), and without this check
/// the binary would boot the whole app instead of printing and exiting.
fn cli_response(args: impl IntoIterator<Item = String>) -> Option<String> {
    match args.into_iter().next().as_deref() {
        Some("--version" | "-V") => Some(format!("voxis {}", env!("CARGO_PKG_VERSION"))),
        Some("--help" | "-h") => Some(USAGE.to_string()),
        _ => None,
    }
}

fn main() {
    // Before the env tweaks and the app: a flag answer needs no webview.
    if let Some(text) = cli_response(std::env::args().skip(1)) {
        println!("{text}");
        return;
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| (*arg).to_string()).collect()
    }

    #[test]
    fn test_cli_response_prints_version_for_either_version_flag() {
        let expected = format!("voxis {}", env!("CARGO_PKG_VERSION"));
        assert_eq!(cli_response(args(&["--version"])), Some(expected.clone()));
        assert_eq!(cli_response(args(&["-V"])), Some(expected));
    }

    #[test]
    fn test_cli_response_prints_usage_for_either_help_flag() {
        assert_eq!(cli_response(args(&["--help"])), Some(USAGE.to_string()));
        assert_eq!(cli_response(args(&["-h"])), Some(USAGE.to_string()));
    }

    #[test]
    fn test_cli_response_is_none_without_a_flag_argument() {
        // A normal launch: no args, or args the app itself receives.
        assert_eq!(cli_response(args(&[])), None);
        assert_eq!(cli_response(args(&["--tray"])), None);
        assert_eq!(cli_response(args(&["--version=1"])), None);
        // Only the FIRST argument is the CLI flag.
        assert_eq!(cli_response(args(&["--tray", "--version"])), None);
    }
}
