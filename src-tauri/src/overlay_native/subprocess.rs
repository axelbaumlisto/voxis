use super::backend::OverlayBackend;
use super::OverlayState;

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const MAX_RESTART_ATTEMPTS: u32 = 3;
const HEARTBEAT_CHECK_INTERVAL: Duration = Duration::from_secs(10);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(15);

pub struct SubprocessOverlay {
    child: Arc<Mutex<Option<Child>>>,
    command_tx: std::sync::mpsc::Sender<String>,
    running: Arc<AtomicBool>,
    #[allow(dead_code)]
    restart_count: Arc<AtomicU32>,
    heartbeat_path: PathBuf,
    #[allow(dead_code)]
    binary_path: PathBuf,
    health_thread: Option<thread::JoinHandle<()>>,
    writer_thread: Option<thread::JoinHandle<()>>,
}

impl SubprocessOverlay {
    fn sidecar_binary_name() -> &'static str {
        #[cfg(target_os = "macos")]
        {
            #[cfg(target_arch = "aarch64")]
            {
                "soupawhisper-overlay-aarch64-apple-darwin"
            }
            #[cfg(target_arch = "x86_64")]
            {
                "soupawhisper-overlay-x86_64-apple-darwin"
            }
            #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
            {
                "soupawhisper-overlay"
            }
        }
        #[cfg(target_os = "linux")]
        {
            "soupawhisper-overlay-x86_64-unknown-linux-gnu"
        }
        #[cfg(target_os = "windows")]
        {
            "soupawhisper-overlay-x86_64-pc-windows-msvc.exe"
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            "soupawhisper-overlay"
        }
    }

    pub fn find_binary() -> Option<PathBuf> {
        let dev_path = PathBuf::from("target/debug/soupawhisper-overlay");
        if dev_path.exists() {
            return Some(dev_path);
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let sidecar_name = Self::sidecar_binary_name();
                let sidecar_path = dir.join(sidecar_name);
                if sidecar_path.exists() {
                    return Some(sidecar_path);
                }

                let sibling = dir.join("soupawhisper-overlay");
                if sibling.exists() {
                    return Some(sibling);
                }

                #[cfg(target_os = "macos")]
                {
                    if let Some(parent) = dir.parent() {
                        let resources_sidecar = parent.join("Resources").join(sidecar_name);
                        if resources_sidecar.exists() {
                            return Some(resources_sidecar);
                        }

                        let resources_path = parent.join("Resources/soupawhisper-overlay");
                        if resources_path.exists() {
                            return Some(resources_path);
                        }
                    }
                }
            }
        }

        None
    }

    pub fn new() -> Option<Self> {
        let binary_path = Self::find_binary()?;
        let heartbeat_path = std::env::temp_dir().join("soupawhisper-overlay-heartbeat");

        let running = Arc::new(AtomicBool::new(true));
        let restart_count = Arc::new(AtomicU32::new(0));
        let child = Arc::new(Mutex::new(None));
        let (command_tx, command_rx) = std::sync::mpsc::channel::<String>();

        let spawned_child = Self::spawn_process(&binary_path, &heartbeat_path)?;
        *child.lock().unwrap() = Some(spawned_child);

        let child_clone = Arc::clone(&child);
        let running_clone = Arc::clone(&running);
        let writer_thread = thread::spawn(move || {
            Self::writer_thread(child_clone, command_rx, running_clone);
        });

        let child_clone = Arc::clone(&child);
        let running_clone = Arc::clone(&running);
        let restart_count_clone = Arc::clone(&restart_count);
        let heartbeat_path_clone = heartbeat_path.clone();
        let binary_path_clone = binary_path.clone();
        let health_thread = thread::spawn(move || {
            Self::health_monitor(
                child_clone,
                running_clone,
                restart_count_clone,
                heartbeat_path_clone,
                binary_path_clone,
            );
        });

        Some(Self {
            child,
            command_tx,
            running,
            restart_count,
            heartbeat_path,
            binary_path,
            health_thread: Some(health_thread),
            writer_thread: Some(writer_thread),
        })
    }

    fn spawn_process(binary_path: &PathBuf, heartbeat_path: &PathBuf) -> Option<Child> {
        Command::new(binary_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .env("OVERLAY_HEARTBEAT_FILE", heartbeat_path)
            .spawn()
            .ok()
    }

    fn writer_thread(
        child: Arc<Mutex<Option<Child>>>,
        rx: std::sync::mpsc::Receiver<String>,
        running: Arc<AtomicBool>,
    ) {
        while running.load(Ordering::SeqCst) {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(cmd) => {
                    if let Some(ref mut process) = *child.lock().unwrap() {
                        if let Some(ref mut stdin) = process.stdin {
                            let _ = writeln!(stdin, "{}", cmd);
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    fn health_monitor(
        child: Arc<Mutex<Option<Child>>>,
        running: Arc<AtomicBool>,
        restart_count: Arc<AtomicU32>,
        heartbeat_path: PathBuf,
        binary_path: PathBuf,
    ) {
        let mut last_heartbeat = Instant::now();
        let check_interval_ms = HEARTBEAT_CHECK_INTERVAL.as_millis() as u64;

        while running.load(Ordering::SeqCst) {
            for _ in 0..(check_interval_ms / 100) {
                if !running.load(Ordering::SeqCst) {
                    return;
                }
                thread::sleep(Duration::from_millis(100));
            }

            let process_alive = {
                let mut guard = child.lock().unwrap();
                if let Some(ref mut process) = *guard {
                    matches!(process.try_wait(), Ok(None))
                } else {
                    false
                }
            };

            let heartbeat_ok = if let Ok(metadata) = std::fs::metadata(&heartbeat_path) {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(elapsed) = std::time::SystemTime::now().duration_since(modified) {
                        if elapsed < HEARTBEAT_TIMEOUT {
                            last_heartbeat = Instant::now();
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    process_alive
                }
            } else {
                process_alive
            };

            if !process_alive || (!heartbeat_ok && last_heartbeat.elapsed() > HEARTBEAT_TIMEOUT) {
                let count = restart_count.fetch_add(1, Ordering::SeqCst) + 1;

                if count > MAX_RESTART_ATTEMPTS {
                    running.store(false, Ordering::SeqCst);
                    break;
                }

                if let Some(mut process) = child.lock().unwrap().take() {
                    let _ = process.kill();
                }

                let backoff = Duration::from_millis(100 * (1 << count.min(5)));
                thread::sleep(backoff);

                if let Some(new_child) = Self::spawn_process(&binary_path, &heartbeat_path) {
                    *child.lock().unwrap() = Some(new_child);
                    last_heartbeat = Instant::now();
                }
            }
        }
    }

    fn send_command(&self, cmd: &str) {
        if !self.running.load(Ordering::SeqCst) {
            return;
        }
        let _ = self.command_tx.send(cmd.to_string());
    }

    fn state_to_command(state: OverlayState) -> &'static str {
        match state {
            OverlayState::Recording => "recording",
            OverlayState::Transcribing => "transcribing",
            OverlayState::Queued(_) => "transcribing",
            OverlayState::Idle => "idle",
            OverlayState::Hidden => "idle",
        }
    }
}

impl OverlayBackend for SubprocessOverlay {
    fn show(&self, state: OverlayState) {
        self.send_command(&format!("show {}", Self::state_to_command(state)));
    }

    fn hide(&self) {
        self.send_command("hide");
    }

    fn send_audio_level(&self, level: f32) {
        self.send_command(&format!("level {:.3}", level));
    }

    fn send_spectrum_bins(&self, bins: [f32; crate::audio::SPECTRUM_BARS]) {
        let bins_str = bins
            .iter()
            .map(|v| format!("{:.3}", v))
            .collect::<Vec<_>>()
            .join(",");
        self.send_command(&format!("spectrum [{}]", bins_str));
    }

    fn update_position(&self, x: i32, y: i32, width: u32, height: u32) {
        self.send_command(&format!("pos {} {} {} {}", x, y, width, height));
    }

    fn set_theme(&self, theme_name: &str) {
        self.send_command(&format!("theme {}", theme_name));
    }

    fn shutdown(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        self.send_command("quit");
        thread::sleep(Duration::from_millis(100));

        if let Some(mut process) = self.child.lock().unwrap().take() {
            let _ = process.kill();
        }

        if let Some(handle) = self.health_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.writer_thread.take() {
            let _ = handle.join();
        }

        let _ = std::fs::remove_file(&self.heartbeat_path);
    }

    fn is_running(&self) -> bool {
        if !self.running.load(Ordering::SeqCst) {
            return false;
        }

        self.child.lock().unwrap().is_some()
    }
}

impl Drop for SubprocessOverlay {
    fn drop(&mut self) {
        self.shutdown();
    }
}
