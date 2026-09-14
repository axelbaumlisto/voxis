//! Recording guard: silence-timeout + max-duration auto-stop —
//! defense-in-depth *behind* the deterministic press/release fix
//! (`press_release.rs`). That fix closes the specific race that used to
//! leave a recording running forever; this guard is the backstop for
//! everything else that can leave the mic open with nobody watching it
//! (a hold-mode key stuck at the OS level, a lost hotkey event class we
//! haven't found yet, a future regression, ...). It is what the user
//! literally asked for: "if the mic has been silent for more than a
//! minute, stop."
//!
//! # Design
//!
//! One task (`spawn_recording_guard`), polling on a fixed interval
//! (`GuardCfg::poll_ms`, default 250ms), driving one pure decision
//! function (`guard_step`) that owns ALL policy — the task itself is a
//! thin, untested-by-necessity shell around it (mirrors
//! `orchestrator::recording`'s `stop_decision`/`press_action` split:
//! policy lives in a function that doesn't need a device or a runtime, so
//! it's exhaustively unit-tested; the task wrapper is exercised only
//! implicitly). Two independent conditions can end a recording:
//!
//! - **Silence**: a sliding window of the last `SILENCE_WINDOW_MS` polls
//!   (`SilenceWindow`, ring buffer of "was this poll silent") must be
//!   both *full* and at least `SILENCE_FRACTION` silent before any
//!   silent duration starts accumulating at all — this is what makes a
//!   single loud poll (a keyboard click, a cough) not reset a real
//!   silence in progress. Once `silent_ms` reaches `silence_timeout_ms`,
//!   stop — as `SilenceTimeout` (`Finalize`) if the guard heard any
//!   sound at all earlier in the take, or `SilenceTimeoutNoSpeech`
//!   (`Discard`) if it never did (see `GuardState::ever_loud`): an
//!   all-silent take risks a Whisper silence hallucination being
//!   auto-typed with no human in the loop, so it is thrown away instead
//!   of transcribed.
//! - **Max duration**: poll-accumulated `elapsed_ms` since the guard
//!   started (≤ wall-clock — see `GuardState::elapsed_ms`), independent
//!   of silence — the "active stop" half of the buffer cap (the cpal
//!   callback's own `AudioRecorder::set_max_samples`/`cap_hit` only
//!   stops *pushing* into the buffer; this guard is what actually calls
//!   `stop_recording` when that cap is hit, or when accumulated poll
//!   time alone exceeds the limit). The guard clamps its own elapsed
//!   check to `MAX_RECORDING_MS_CEILING` (see `guard_max_recording_ms`)
//!   — stricter than the raw buffer's `ABS_MAX_RECORDING_MS` backstop —
//!   so this condition can never be truly "off" even if the user's
//!   `max_recording_ms` config is `0` or a hand-edited out-of-range value,
//!   AND never produces a take too large to ever transcribe.
//!
//! Max-duration is checked (and, if true, returned) *before* silence in
//! `guard_step` — deliberate precedence: if both conditions are satisfied
//! on the same poll, the event is always `MaxDuration`
//! (`test_max_duration_wins_over_simultaneous_silence_timeout`).
//!
//! This module replaces the ad-hoc "silence detector"
//! (`silent_iters`/`SILENT_ITER_THRESHOLD`/`warned_silent`) that used to
//! live inside `orchestrator::audio_level`'s overlay-spectrum poller —
//! that detector only ever logged a one-time `WARN` and, critically, only
//! ran when `overlay.enabled` was true. This guard is spawned
//! unconditionally, regardless of the overlay setting, so it is also the
//! only place that notices a recording thread dying on its own: if
//! `AudioRecorder::is_recording()` ever goes false while the guard is
//! still polling, it calls `stop_recording(StopReason::StreamDied)`
//! (resolves to `StopDecision::Recover`) instead of silently exiting —
//! otherwise the coordinator would stay pinned at `Stage::Recording`
//! until the user's next gesture.
//!
//! # Locking discipline
//!
//! `spawn_recording_guard`'s task holds **no lock of its own** — not
//! `stop_lock`, not `guard_cancel`, not `polling_cancel`. It reads
//! `AudioRecorder`'s lock-free atomics (`is_recording`, `take_rms_peak`,
//! `cap_hit`) and, on a stop decision, calls
//! `RecordingCoordinator::stop_recording` (an owned `Clone`, not a
//! borrow) — which takes `stop_lock` *internally* and is unconditionally
//! safe to call from here: it silently tolerates `StopDecision::Skip`
//! (the release beat the guard to it) via `stop_decision`'s own logic,
//! and cancellation of this task's own token is what the caller
//! (`stop_recording`) uses to end the guard's lifetime — never
//! `JoinHandle::abort()`: an abort mid-way through a `stop_recording`
//! call holding `stop_lock` would be fatal, so cancellation is always
//! cooperative (`CancellationToken`).
//!
//! # A subtlety in `guard_step`'s ordering
//!
//! Evaluating the silence/beep/timeout checks on every poll, with only
//! the *accumulation* step ("silent_ms += poll_ms") gated behind
//! `window.is_full()`, has a real bug: falling through to the
//! timeout/beep comparisons against `silent_ms`'s current (possibly
//! still-zero) value regardless means `pre_cutoff_beep_ms >
//! silence_timeout_ms` (reachable via a hand-edited config row, since
//! load is unvalidated) saturating-subs `beep_at` to `0`, and
//! `silent_ms(0) >= beep_at(0)` is trivially true — firing
//! `PreCutoffBeep` on literally the FIRST poll of every recording,
//! before the window has even filled once, let alone measured any real
//! silence. This implementation instead gates the *entire*
//! silence/beep/timeout block behind `window.is_full()`, returning
//! `GuardEvent::None` early otherwise — see
//! `test_beep_lead_time_exceeding_timeout_does_not_fire_before_window_fills`
//! for the exact scenario this fixes, and `test_window_not_full_yields_no_decision`
//! for the (unchanged) normal case this same gate also covers.

use super::recording::{RecordingCoordinator, StopReason};
use crate::audio::AudioRecorder;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
pub(crate) use voxis_core::guard::GuardCfg;
use voxis_core::guard::{guard_step, GuardEvent, GuardState};

// `SilenceWindow`, `GuardCfg`/`from_app_config`, `GuardState`, `GuardEvent`,
// `guard_step`, `native_cap_samples`, `effective_max_recording_ms`,
// `guard_max_recording_ms`, and their unit tests (including the
// `SILENCE_RMS` hardware-calibration block) all moved to `voxis_core::guard`
// in Task 1b — pure decision logic with no `AudioRecorder`/`AppHandle`/tokio
// dependency, see that module's doc comment for the full split rationale
// (including the two dropped test cross-checks against this crate's own
// `stop_decision`). Only re-imported here for `spawn_recording_guard`'s
// task loop, which stays here: it owns the tokio task, breadcrumbs,
// audio-feedback beeps, and everything touching
// `AudioRecorder`/`RecordingCoordinator`. `GuardCfg` and `native_cap_samples`
// are re-exported `pub(crate)` (not just imported) so
// `orchestrator::recording`'s `recording_guard::GuardCfg::from_app_config(...)`
// / `recording_guard::native_cap_samples(...)` call sites keep resolving.
pub(crate) use voxis_core::guard::native_cap_samples;

/// Spawn the recording guard task. Runs unconditionally
/// (regardless of `overlay.enabled`, see module doc) for the lifetime of
/// one recording; ends when either `token` is cancelled (a normal stop
/// beat the guard to it) or the recorder itself stops recording (mirrors
/// `orchestrator::audio_level`'s poller's own exit condition), or when
/// `guard_step` decides to stop and this task's own call to
/// `coordinator.stop_recording` returns.
///
/// Holds no lock of its own — see module doc, "Locking discipline".
pub(crate) fn spawn_recording_guard(
    recorder: Arc<AudioRecorder>,
    coordinator: RecordingCoordinator,
    cfg: GuardCfg,
    token: CancellationToken,
) {
    tracing::info!("Starting recording guard (silence timeout + max duration)");

    tauri::async_runtime::spawn(async move {
        let mut state = GuardState::new(&cfg);
        let poll = std::time::Duration::from_millis(cfg.poll_ms() as u64);

        loop {
            // Check the token FIRST on every iteration — `select!`
            // resolves immediately if already cancelled, without waiting
            // out the sleep.
            tokio::select! {
                _ = token.cancelled() => {
                    tracing::debug!(
                        "Recording guard cancelled (elapsed={}ms, max_rms_peak={:.4}, \
                         last_window_silent_fraction={:.2})",
                        state.elapsed_ms,
                        state.max_rms_peak,
                        state.last_window_silent_fraction
                    );
                    break;
                }
                _ = tokio::time::sleep(poll) => {}
            }

            if !recorder.is_recording() {
                // The recording thread stopped on its own — nobody called
                // `stop_recording` (that path cancels this task's token
                // instead, handled above). Route through the shared stop
                // path so the coordinator actually returns to Idle
                // (`StopDecision::Recover`, since `is_recording()` now
                // disagrees with `Stage::Recording`) instead of silently
                // exiting and leaving the hotkey dead until the user's
                // next gesture.
                tracing::warn!(
                    "Recording guard: recorder stopped recording on its own (no matching \
                     stop_recording call) — recovering to Idle"
                );
                if token.is_cancelled() {
                    // A release already took stop_lock and is (or just
                    // did) handle this the normal way — nothing left for
                    // us to do.
                    break;
                }
                coordinator.stop_recording(StopReason::StreamDied).await;
                break;
            }

            let rms_peak = recorder.take_rms_peak();
            let cap_hit = recorder.cap_hit();

            match guard_step(&mut state, rms_peak, cap_hit, &cfg) {
                GuardEvent::None => {}
                GuardEvent::PreCutoffBeep => {
                    // `cfg.audio_feedback` (not a fresh `load_config_from_app`
                    // read) — KISS: this task holds no `AppHandle` at all
                    // (module doc, "Locking discipline"/GuardCfg doc), the
                    // same snapshot-at-spawn-time discipline every other
                    // field on `cfg` already follows.
                    //
                    // `SoundType` has exactly three variants (Start/Stop/
                    // Error) and none means "warning, recording
                    // continues" — adding a fourth is out of this step's
                    // scope (`audio_feedback/mod.rs` isn't in Files:).
                    // `Error` is the closest existing connotation to "this
                    // needs your attention" without implying the
                    // recording already ended (which `Stop` would, and
                    // could make the user think they were cut off early).
                    // Documented deviation, reported to the parent: a
                    // genuine `StopDecision::Recover` error beep (this
                    // same `SoundType`, in `recording.rs`) will sound
                    // identical to this routine pre-cutoff warning.
                    let _ = crate::audio_feedback::play(
                        crate::audio_feedback::SoundType::Error,
                        cfg.audio_feedback(),
                        &crate::audio_feedback::RodioPlayer,
                    );
                    crate::diagnostics::breadcrumbs::sites::recording_guard_pre_cutoff_beep();
                }
                GuardEvent::Stop(reason) => {
                    match reason {
                        StopReason::SilenceTimeout => {
                            crate::diagnostics::breadcrumbs::sites::recording_auto_stopped_silence();
                        }
                        StopReason::SilenceTimeoutNoSpeech => {
                            crate::diagnostics::breadcrumbs::sites::recording_auto_stopped_silence_no_speech();
                        }
                        StopReason::MaxDuration => {
                            crate::diagnostics::breadcrumbs::sites::recording_auto_stopped_max_duration();
                        }
                        other => unreachable!(
                            "guard_step only ever returns StopReason::SilenceTimeout, \
                             SilenceTimeoutNoSpeech, or MaxDuration, got {other:?}"
                        ),
                    }
                    tracing::warn!(
                        "recording guard: auto-stopping ({reason:?}) after {}ms elapsed \
                         ({}ms accumulated silence, max_rms_peak={:.4}, \
                         last_window_silent_fraction={:.2})",
                        state.elapsed_ms,
                        state.silent_ms,
                        state.max_rms_peak,
                        state.last_window_silent_fraction
                    );
                    // The decision-to-stop above was made OUTSIDE
                    // `stop_lock`. A release that already took the lock
                    // cancels this token inside `stop_recording` — so
                    // re-checking it here (cheap, lock-free) narrows the
                    // stale-guard window from "one poll interval" to
                    // microseconds. The breadcrumb + warn! above are intentionally emitted
                    // BEFORE this check so the cause stays visible even
                    // when the stop is (correctly) skipped or hangs.
                    if token.is_cancelled() {
                        tracing::debug!(
                            "guard: token cancelled before stop — release won the race"
                        );
                        break;
                    }
                    // No lock held here (module doc, "Locking
                    // discipline") — `stop_recording` takes `stop_lock`
                    // itself and silently tolerates having lost a race
                    // to a concurrent release (`StopDecision::Skip`).
                    coordinator.stop_recording(reason).await;
                    break;
                }
            }
        }
    });
}

// All unit tests for this module's decision logic (`SilenceWindow`,
// `GuardCfg`, `GuardState`, `GuardEvent`, `guard_step`,
// `native_cap_samples`, `effective_max_recording_ms`,
// `guard_max_recording_ms` — including the `SILENCE_RMS` hardware-
// calibration block) moved to `voxis_core::guard`'s own `#[cfg(test)] mod
// tests` in Task 1b, alongside the code they test (their private-field
// `GuardCfg { .. }` struct literals can no longer compile from this crate
// once the fields live in a different crate). `spawn_recording_guard`
// itself remains untestable without a `tauri/test` harness for the same
// reason documented before this move — see the module doc's "Design"
// section and `voxis_core::guard`'s own doc comment for exactly which two
// test assertions were dropped (not lost: still covered by
// `orchestrator::recording`'s own `stop_decision` tests) as part of the
// split.
