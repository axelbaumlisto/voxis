use std::path::PathBuf;

/// Initialize X11 thread support (must be called before any X11/GTK operations).
/// Required for rdev hotkey listener to work safely alongside GTK.
#[cfg(target_os = "linux")]
pub fn init_x11_threads() {
    unsafe {
        x11::xlib::XInitThreads();
    }
}

/// Stub on non-Linux platforms.
#[cfg(not(target_os = "linux"))]
pub fn init_x11_threads() {}

/// Initialize the logging subsystem with tracing.
/// Logs to both stderr and rotating file in ~/.config/soupawhisper/logs/
pub fn init_logging() {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    let log_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("soupawhisper")
        .join("logs");

    let _ = std::fs::create_dir_all(&log_dir);

    let file_appender = tracing_appender::rolling::daily(&log_dir, "voice.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    std::mem::forget(guard);

    let env_filter = tracing_subscriber::EnvFilter::from_default_env()
        .add_directive(tracing::Level::DEBUG.into());

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false),
        )
        .init();

    tracing::info!("Logging initialized, file: {:?}", log_dir.join("voice.log"));

    // Capture panics from any thread — without this, panics in background
    // threads (writer/health/coordinator/audio polling) exit the process
    // silently with no panic message in our logs, which makes settings-save
    // and hotkey crashes opaque.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("<non-string panic payload>");
        let backtrace = std::backtrace::Backtrace::force_capture();
        let thread_name = std::thread::current()
            .name()
            .unwrap_or("<unnamed>")
            .to_string();
        tracing::error!(
            target: "panic",
            thread = %thread_name,
            location = %location,
            payload = %payload,
            backtrace = ?backtrace,
            "PANIC: {} at {}",
            payload,
            location
        );
        // Defer to the default hook too — keeps stderr backtrace on tty.
        default_hook(info);
    }));

    let stale_log = log_dir.join("soupawhisper.log");
    if stale_log.exists() {
        let _ = std::fs::remove_file(&stale_log);
    }
}
