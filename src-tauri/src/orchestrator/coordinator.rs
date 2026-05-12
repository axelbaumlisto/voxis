//! Transcription Coordinator — single-thread state machine.
//!
//! Serialises all transcription lifecycle events through a single thread to
//! eliminate race conditions between hotkey events, cancellations, and the
//! async transcribe-paste pipeline.
//!
//! ## Architecture (SOLID + KISS)
//!
//! - **SRP**: This module owns only the state-machine transitions. Action
//!   side-effects (start audio, run transcription) live outside.
//! - **OCP**: Callers extend behaviour by listening to `Stage` changes via
//!   `current_stage()`, not by modifying the worker thread.
//! - **DIP**: No dependency on Tauri/AppHandle — pure state machine. Caller
//!   wires it into the orchestrator.
//! - **KISS**: One mpsc channel, one worker thread, one `Mutex<Stage>`. No
//!   async, no `Arc<Mutex<...>>` everywhere.
//!
//! ## State Machine
//!
//! ```text
//!     Press                  Release             ProcessingFinished
//!   ┌────────────┐         ┌─────────────┐    ┌─────────────────────┐
//!   │            ▼         │             ▼    │                     │
//! ┌───────┐                ┌───────────┐                ┌────────────┐
//! │ Idle  │ ──────────────►│ Recording │ ──────────────►│ Processing │
//! └───────┘                └───────────┘                └────────────┘
//!   ▲                          │                              │
//!   │                          │                              │
//!   │                          ▼ Cancel                       │
//!   └──────────────────────────┘                              │
//!   │                                                         │
//!   │ Cancel during Processing is IGNORED                     │
//!   └─────────────────────────────────────────────────────────┘
//! ```
//!
//! Rapid `Press` events within 30 ms are debounced (key-repeat / double-tap).

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Minimum time between two `Press` events before the second is honoured.
/// Filters keyboard key-repeat and accidental double-taps.
pub const DEBOUNCE: Duration = Duration::from_millis(30);

/// Pipeline lifecycle, observable by callers via `current_stage()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// No recording, no transcription in flight.
    Idle,
    /// Audio is being captured.
    Recording,
    /// Recording stopped; transcription / output pipeline running.
    Processing,
}

/// Commands processed sequentially by the coordinator thread.
#[derive(Debug)]
enum Command {
    Press,
    Release,
    Cancel,
    ProcessingFinished,
}

/// Single-thread state machine that serialises transcription lifecycle events.
///
/// Cheap to clone references (`Arc`-friendly) — the worker thread owns the
/// receiver and the public methods send through a `Sender`.
pub struct TranscriptionCoordinator {
    tx: Option<Sender<Command>>,
    stage: Arc<Mutex<Stage>>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl Default for TranscriptionCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl TranscriptionCoordinator {
    /// Spawn the worker thread.
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<Command>();
        let stage = Arc::new(Mutex::new(Stage::Idle));
        let stage_for_worker = Arc::clone(&stage);

        let handle = thread::Builder::new()
            .name("transcription-coordinator".into())
            .spawn(move || worker_loop(rx, stage_for_worker))
            .expect("failed to spawn coordinator thread");

        Self {
            tx: Some(tx),
            stage,
            handle: Mutex::new(Some(handle)),
        }
    }

    /// Read the current pipeline stage. Lock is held only for the read.
    pub fn current_stage(&self) -> Stage {
        *self.stage.lock().expect("stage mutex poisoned")
    }

    /// Hotkey pressed — request transition `Idle → Recording`.
    /// Debounced 30 ms.
    pub fn on_press(&self) {
        self.send(Command::Press);
    }

    /// Hotkey released — request transition `Recording → Processing`.
    pub fn on_release(&self) {
        self.send(Command::Release);
    }

    /// Cancel any active recording.
    /// Has no effect while `Processing` (we wait for the pipeline to finish).
    pub fn cancel(&self) {
        self.send(Command::Cancel);
    }

    /// Notify that the transcription pipeline has finished — transition
    /// `Processing → Idle`.
    pub fn notify_processing_finished(&self) {
        self.send(Command::ProcessingFinished);
    }

    /// RAII guard: when dropped (incl. on panic), sends `ProcessingFinished`.
    ///
    /// Use it inside the async pipeline so the coordinator returns to
    /// `Idle` even if the pipeline panics.
    pub fn finish_guard(&self) -> FinishGuard {
        FinishGuard {
            tx: self
                .tx
                .as_ref()
                .expect("coordinator already shut down")
                .clone(),
            disarmed: false,
        }
    }

    fn send(&self, cmd: Command) {
        let Some(tx) = self.tx.as_ref() else {
            tracing::warn!("Coordinator already shut down; command dropped");
            return;
        };
        if tx.send(cmd).is_err() {
            tracing::warn!("Coordinator channel closed; command dropped");
        }
    }
}

impl Drop for TranscriptionCoordinator {
    fn drop(&mut self) {
        // Drop the Sender FIRST so the worker's `rx.recv()` returns Err and
        // it exits. Any `FinishGuard` instances still alive keep their own
        // cloned Sender, so the worker stays alive until they drop too.
        drop(self.tx.take());
        if let Some(handle) = self.handle.lock().ok().and_then(|mut h| h.take()) {
            let _ = handle.join();
        }
    }
}

/// Drop-time signal that the pipeline finished. Survives panics by design
/// (`Drop` runs during unwind).
pub struct FinishGuard {
    tx: Sender<Command>,
    disarmed: bool,
}

impl FinishGuard {
    /// Disarm the guard — `Drop` will NOT send `ProcessingFinished`.
    /// Use this when finished-notification is delivered some other way.
    pub fn disarm(mut self) {
        self.disarmed = true;
    }
}

impl Drop for FinishGuard {
    fn drop(&mut self) {
        if !self.disarmed {
            let _ = self.tx.send(Command::ProcessingFinished);
        }
    }
}

fn worker_loop(rx: mpsc::Receiver<Command>, stage: Arc<Mutex<Stage>>) {
    let mut last_press: Option<Instant> = None;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            Command::Press => {
                // Debounce rapid presses (key repeat / double-tap).
                let now = Instant::now();
                if last_press.is_some_and(|t| now.duration_since(t) < DEBOUNCE) {
                    tracing::debug!("Coordinator: debounced press");
                    continue;
                }
                last_press = Some(now);

                let mut s = stage.lock().expect("stage mutex poisoned");
                // TALRI semantics: pressing during Processing starts a new
                // recording while previous transcription continues in queue.
                // Press during Recording is ignored (already recording).
                if matches!(*s, Stage::Idle | Stage::Processing) {
                    *s = Stage::Recording;
                } else {
                    tracing::debug!("Coordinator: press ignored in stage {:?}", *s);
                }
            }
            Command::Release => {
                let mut s = stage.lock().expect("stage mutex poisoned");
                if matches!(*s, Stage::Recording) {
                    *s = Stage::Processing;
                } else {
                    tracing::debug!("Coordinator: release ignored in stage {:?}", *s);
                }
            }
            Command::Cancel => {
                let mut s = stage.lock().expect("stage mutex poisoned");
                // Don't reset during Processing — let the pipeline finish.
                if matches!(*s, Stage::Recording) {
                    *s = Stage::Idle;
                } else {
                    tracing::debug!("Coordinator: cancel ignored in stage {:?}", *s);
                }
            }
            Command::ProcessingFinished => {
                let mut s = stage.lock().expect("stage mutex poisoned");
                // Only transition to Idle from Processing. If a new recording
                // started before previous transcription finished, stay in
                // Recording.
                if matches!(*s, Stage::Processing) {
                    *s = Stage::Idle;
                } else {
                    tracing::debug!(
                        "Coordinator: ProcessingFinished while in {:?}; stage unchanged",
                        *s
                    );
                }
            }
        }
    }
    tracing::debug!("Coordinator worker exited");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Wait until the worker observes events: tiny but enough for an mpsc
    /// hand-off. We poll the stage instead of sleeping arbitrarily.
    fn wait_for_stage(coord: &TranscriptionCoordinator, expected: Stage, label: &str) {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let s = coord.current_stage();
            if s == expected {
                return;
            }
            if Instant::now() > deadline {
                panic!("timeout waiting for {expected:?} at '{label}', got {s:?}");
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    #[test]
    fn test_starts_in_idle() {
        let coord = TranscriptionCoordinator::new();
        assert_eq!(coord.current_stage(), Stage::Idle);
    }

    #[test]
    fn test_idle_to_recording_on_press() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after press");
    }

    #[test]
    fn test_recording_to_processing_on_release() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after press");
        coord.on_release();
        wait_for_stage(&coord, Stage::Processing, "after release");
    }

    #[test]
    fn test_processing_to_idle_on_finish() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after press");
        coord.on_release();
        wait_for_stage(&coord, Stage::Processing, "after release");
        coord.notify_processing_finished();
        wait_for_stage(&coord, Stage::Idle, "after finished");
    }

    #[test]
    fn test_debounce_rapid_presses() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after first press");

        // Cancel back to Idle so a second press *could* re-enter Recording.
        coord.cancel();
        wait_for_stage(&coord, Stage::Idle, "after cancel");

        // Send a second press immediately — within the 30 ms debounce window
        // since `last_press` was set above. It should be dropped.
        coord.on_press();
        // Give the worker a few ms to process the (debounced) command.
        std::thread::sleep(Duration::from_millis(10));
        assert_eq!(
            coord.current_stage(),
            Stage::Idle,
            "second press within {:?} should be debounced",
            DEBOUNCE
        );

        // After the debounce window passes, a press is honoured again.
        std::thread::sleep(DEBOUNCE + Duration::from_millis(10));
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after debounce window");
    }

    #[test]
    fn test_cancel_during_recording() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after press");
        coord.cancel();
        wait_for_stage(&coord, Stage::Idle, "after cancel");
    }

    #[test]
    fn test_cancel_during_processing_ignored() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after press");
        coord.on_release();
        wait_for_stage(&coord, Stage::Processing, "after release");

        coord.cancel();
        // Give worker time to *not* change state.
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(
            coord.current_stage(),
            Stage::Processing,
            "cancel during Processing must be ignored"
        );

        // Pipeline finishes normally.
        coord.notify_processing_finished();
        wait_for_stage(&coord, Stage::Idle, "after finish");
    }

    #[test]
    fn test_release_in_idle_is_noop() {
        let coord = TranscriptionCoordinator::new();
        coord.on_release();
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(coord.current_stage(), Stage::Idle);
    }

    #[test]
    fn test_finish_guard_normal_drop_resets_stage() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after press");
        coord.on_release();
        wait_for_stage(&coord, Stage::Processing, "after release");

        {
            let _guard = coord.finish_guard();
            // pretend the pipeline runs here
        }
        wait_for_stage(&coord, Stage::Idle, "after guard drop");
    }

    #[test]
    fn test_finish_guard_resets_stage_on_panic() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after press");
        coord.on_release();
        wait_for_stage(&coord, Stage::Processing, "after release");

        // Simulate an async pipeline that panics while holding a guard.
        // The guard's Drop must still fire during unwinding.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = coord.finish_guard();
            panic!("simulated transcription pipeline panic");
        }));
        assert!(result.is_err());

        wait_for_stage(&coord, Stage::Idle, "after panic-induced guard drop");
    }

    #[test]
    fn test_finish_guard_disarm_does_not_send() {
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "after press");
        coord.on_release();
        wait_for_stage(&coord, Stage::Processing, "after release");

        {
            let guard = coord.finish_guard();
            guard.disarm();
        }
        // Disarmed guard must NOT have sent ProcessingFinished.
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(
            coord.current_stage(),
            Stage::Processing,
            "disarmed guard must not reset stage"
        );
    }

    #[test]
    fn test_full_lifecycle_cycle() {
        let coord = TranscriptionCoordinator::new();
        for i in 0..3 {
            // Wait long enough to clear the debounce window each iteration.
            if i > 0 {
                std::thread::sleep(DEBOUNCE + Duration::from_millis(5));
            }
            coord.on_press();
            wait_for_stage(&coord, Stage::Recording, &format!("iter {i} press"));
            coord.on_release();
            wait_for_stage(&coord, Stage::Processing, &format!("iter {i} release"));
            coord.notify_processing_finished();
            wait_for_stage(&coord, Stage::Idle, &format!("iter {i} finish"));
        }
    }

    #[test]
    fn test_press_during_processing_starts_new_recording() {
        // TALRI semantics: pressing while previous transcription is in progress
        // begins a new recording without waiting.
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "first press");
        coord.on_release();
        wait_for_stage(&coord, Stage::Processing, "first release");

        // Now press again before ProcessingFinished arrives.
        std::thread::sleep(DEBOUNCE + Duration::from_millis(5));
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "second press during processing");
    }

    #[test]
    fn test_processing_finished_during_recording_stays_recording() {
        // If the previous transcription completes while user is mid-recording
        // of the next utterance, stage must NOT switch to Idle.
        let coord = TranscriptionCoordinator::new();
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "press");
        coord.on_release();
        wait_for_stage(&coord, Stage::Processing, "release");
        std::thread::sleep(DEBOUNCE + Duration::from_millis(5));
        coord.on_press();
        wait_for_stage(&coord, Stage::Recording, "new press");

        // Late ProcessingFinished from the FIRST transcription:
        coord.notify_processing_finished();
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(coord.current_stage(), Stage::Recording);
    }
}
