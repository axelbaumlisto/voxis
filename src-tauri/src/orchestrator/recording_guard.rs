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
use crate::config::{
    AppConfig, ABS_MAX_RECORDING_MS, GUARD_POLL_MS, MAX_RECORDING_MS_CEILING, PRE_CUTOFF_BEEP_MS,
    SILENCE_FRACTION, SILENCE_RMS, SILENCE_WINDOW_MS,
};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Ring buffer of "was this poll silent" over the last `capacity` polls.
/// Capacity is fixed for the buffer's lifetime (derived once from
/// `GuardCfg::window_ms / poll_ms`).
struct SilenceWindow {
    buf: VecDeque<bool>,
    capacity: usize,
}

impl SilenceWindow {
    fn new(capacity: usize) -> Self {
        // A capacity of 0 (e.g. `poll_ms` misconfigured larger than
        // `window_ms`) would make `is_full()` trivially true on an empty
        // buffer, firing silence decisions off zero real measurements —
        // floor it at 1.
        let capacity = capacity.max(1);
        Self {
            buf: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    fn push(&mut self, is_silent: bool) {
        if self.buf.len() == self.capacity {
            self.buf.pop_front();
        }
        self.buf.push_back(is_silent);
    }

    fn is_full(&self) -> bool {
        self.buf.len() == self.capacity
    }

    /// Fraction of polls currently in the window that were silent. Only
    /// meaningful once `is_full()` — callers must check that first (this
    /// method doesn't gate on it itself, to keep it a plain, honest query
    /// over whatever's in the buffer right now).
    fn silent_fraction(&self) -> f32 {
        if self.buf.is_empty() {
            return 0.0;
        }
        let silent = self.buf.iter().filter(|&&s| s).count();
        silent as f32 / self.buf.len() as f32
    }
}

/// Everything `guard_step` needs to make a decision, snapshotted once
/// from `AppConfig` + tuning constants at guard-spawn time. Also carries
/// `audio_feedback` (the pre-cutoff beep's volume/
/// enabled settings) so `spawn_recording_guard`'s task never needs an
/// `AppHandle` of its own — KISS: the guard's only dependencies are the
/// recorder's atomics and an owned `RecordingCoordinator` clone: it has
/// no business re-reading live config or touching `AppHandle` machinery
/// it doesn't otherwise need, and `stop_recording` already re-reads
/// config itself for its own beeps at the moment it actually runs.
/// Deliberately has no public field access outside this module —
/// `RecordingCoordinator`'s wiring site (`recording.rs`) only ever needs
/// `from_app_config` and `native_cap_samples`, never the individual
/// fields.
#[derive(Debug, Clone, Copy)]
pub(crate) struct GuardCfg {
    silence_timeout_ms: u32,
    max_recording_ms: u32,
    poll_ms: u32,
    window_ms: u32,
    silence_fraction: f32,
    silence_rms: f32,
    pre_cutoff_beep_ms: u32,
    audio_feedback: crate::audio_feedback::AudioFeedbackSettings,
}

impl GuardCfg {
    /// Snapshot the user-configurable fields plus the (currently fixed,
    /// not user-configurable) tuning constants. Read once, at
    /// `on_hotkey_pressed`'s start-critical section — the guard's whole
    /// lifetime uses this single snapshot, same as every other
    /// per-recording config read in that function.
    pub(crate) fn from_app_config(config: &AppConfig) -> Self {
        Self {
            silence_timeout_ms: config.silence_timeout_ms,
            max_recording_ms: config.max_recording_ms,
            poll_ms: GUARD_POLL_MS,
            window_ms: SILENCE_WINDOW_MS,
            silence_fraction: SILENCE_FRACTION,
            silence_rms: SILENCE_RMS,
            pre_cutoff_beep_ms: PRE_CUTOFF_BEEP_MS,
            audio_feedback: config.audio_feedback,
        }
    }
}

/// Per-recording mutable state the guard task carries across polls.
struct GuardState {
    window: SilenceWindow,
    /// Accumulated milliseconds where the window has been full AND at
    /// least `silence_fraction` silent, reset to 0 the moment either
    /// condition stops holding (a real "un-silence": speech, not just one
    /// loud poll — the fraction test already absorbs those).
    silent_ms: u32,
    /// Poll-accumulated milliseconds since the guard started (i.e. since
    /// `recorder.start()` returned `Ok` for this recording): poll count ×
    /// `poll_ms`, NOT a wall-clock reading — so it is ≤ wall-clock (tokio
    /// `sleep` never fires early; per-poll processing time is not
    /// counted). Consequence: `MaxDuration` may fire *late* by the
    /// accumulated processing time, never early; `cap_hit` is the exact
    /// byte-level backstop. Deliberately not an `Instant` — that would
    /// make `guard_step` impure/untestable without a clock.
    elapsed_ms: u32,
    /// Whether the pre-cutoff beep has already fired for the CURRENT
    /// silence run — reset to `false` alongside `silent_ms` on a genuine
    /// un-silence, so a later silence run can beep again
    /// (`test_speech_burst_resets_silent_ms_and_rearms_beep`).
    beeped: bool,
    /// Whether ANY poll during this recording's WHOLE lifetime (not just
    /// the current silence run — unlike `silent_ms`/`beeped`, never reset)
    /// has seen `rms_peak >= silence_rms`. If a silence-timeout stop fires
    /// and this is still `false`, the recording never had any detectable
    /// sound at all, so it is routed to `StopReason::SilenceTimeoutNoSpeech`
    /// (→ `StopDecision::Discard`) instead of the normal `SilenceTimeout`
    /// (→ `Finalize`) — sending an all-silent take to transcription risks
    /// a Whisper silence hallucination being auto-typed with no human in
    /// the loop.
    ever_loud: bool,
    /// Whole-take maximum `rms_peak` ever observed (before any threshold
    /// comparison), never reset. Pure observability: the 2026-09-07
    /// `SILENCE_RMS` recalibration (see its doc comment) required pulling
    /// this exact number out of an offline WAV analysis because nothing
    /// logged it — logged in both the auto-stop `warn!` and the
    /// normal-release `Recording guard cancelled` debug so every take's
    /// peak is visible in the log for the NEXT calibration, on whatever
    /// hardware needs it.
    max_rms_peak: f32,
    /// The most recent `SilenceWindow::silent_fraction()` computed once
    /// the window became full (`0.0` before that) — same observability
    /// purpose as `max_rms_peak`: lets a future calibration see how close
    /// a take came to arming the guard without needing offline analysis.
    last_window_silent_fraction: f32,
}

impl GuardState {
    fn new(cfg: &GuardCfg) -> Self {
        let capacity = (cfg.window_ms / cfg.poll_ms.max(1)) as usize;
        Self {
            window: SilenceWindow::new(capacity),
            silent_ms: 0,
            elapsed_ms: 0,
            beeped: false,
            ever_loud: false,
            max_rms_peak: 0.0,
            last_window_silent_fraction: 0.0,
        }
    }
}

/// What `guard_step` decided this poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GuardEvent {
    /// Nothing to do this poll.
    None,
    /// Warn the user (audio cue) that a silence-triggered stop is
    /// imminent — fires exactly once per silence run,
    /// `pre_cutoff_beep_ms` before the run would reach
    /// `silence_timeout_ms`.
    PreCutoffBeep,
    /// Stop the recording now.
    Stop(StopReason),
}

/// Clamp a possibly-zero, possibly-out-of-range `max_recording_ms` config
/// value to the RAW-BUFFER backstop: `0` (silence-only, "no max" as far as
/// the user is concerned) still gets `ABS_MAX_RECORDING_MS`, and any
/// configured value above it is clamped down to it — config load is
/// intentionally unvalidated (matching `hotkey_hold_ms`/`typing_delay`), so
/// a hand-edited out-of-range DB value must not silently produce an
/// unbounded buffer. This is `native_cap_samples`'s cap; the guard's own
/// elapsed-time check applies a STRICTER second clamp on top of this one
/// (`guard_max_recording_ms`, below) — the two are deliberately allowed to
/// disagree, see that function's doc for why.
fn effective_max_recording_ms(max_recording_ms: u32) -> u32 {
    if max_recording_ms == 0 {
        ABS_MAX_RECORDING_MS
    } else {
        max_recording_ms.min(ABS_MAX_RECORDING_MS)
    }
}

/// The cap the guard's OWN elapsed-time check actually stops at — distinct
/// from `native_cap_samples`'s raw-buffer cap, which keeps using the full
/// `effective_max_recording_ms` (up to `ABS_MAX_RECORDING_MS`, 30 min)
/// unchanged: that cap only bounds memory. `max_recording_ms = 0` ("off",
/// or a hand-edited out-of-range value) still clamps to
/// `ABS_MAX_RECORDING_MS` via `effective_max_recording_ms`, but 30 min of
/// 16 kHz/16-bit audio is 57.6 MB — always over `MAX_AUDIO_BYTES` (25 MiB)
/// — so a recording that actually reached that backstop would be
/// guaranteed-rejected with no failed-audio dump to retry from. The guard
/// clamps a second time to `MAX_RECORDING_MS_CEILING` (the longest take
/// that's actually transcribable) so "off" produces the longest USABLE
/// recording instead of a guaranteed-useless one; the raw buffer is still
/// allowed to grow all the way to the 30-minute backstop in the meantime
/// (belt and suspenders — the guard is expected to fire first).
fn guard_max_recording_ms(max_recording_ms: u32) -> u32 {
    effective_max_recording_ms(max_recording_ms).min(MAX_RECORDING_MS_CEILING)
}

/// Native-rate (pre-downsample) sample-buffer cap for
/// `AudioRecorder::set_max_samples`. `max_recording_ms` is the raw config value (see `effective_max_recording_ms` for the
/// clamping this applies first); `native_rate` is
/// `AudioRecorder::sample_rate()`, valid once `recorder.start()` has
/// returned `Ok`.
pub(crate) fn native_cap_samples(max_recording_ms: u32, native_rate: u32) -> usize {
    let ms = effective_max_recording_ms(max_recording_ms) as u64;
    let rate = native_rate as u64;
    ((ms * rate) / 1000) as usize
}

/// The ONLY place with policy (module doc, "Design") — decide what, if
/// anything, the guard should do this poll. Pure: no I/O, no locks, no
/// `AppHandle` — testable without a device or a runtime, same shape as
/// `orchestrator::recording`'s `stop_decision`.
///
/// `rms_peak` is boost-independent pre-boost peak RMS since the last poll
/// (`AudioRecorder::take_rms_peak`); `cap_hit` is whether the native
/// sample buffer has hit its cap (`AudioRecorder::cap_hit`) since the
/// last poll.
fn guard_step(state: &mut GuardState, rms_peak: f32, cap_hit: bool, cfg: &GuardCfg) -> GuardEvent {
    state.elapsed_ms = state.elapsed_ms.saturating_add(cfg.poll_ms);
    state.max_rms_peak = state.max_rms_peak.max(rms_peak);
    let is_silent = rms_peak < cfg.silence_rms;
    if !is_silent {
        // Whole-recording flag, independent of the window/fraction gate
        // below and never reset — see `GuardState::ever_loud` doc.
        state.ever_loud = true;
    }
    state.window.push(is_silent);

    // Max-duration: checked (and, if true, returned) BEFORE silence,
    // unconditionally — the guard's "active stop" half of the buffer cap,
    // and never truly "off" (see `effective_max_recording_ms`). Deliberate
    // precedence: if both conditions hold on the same poll, the event is
    // always `MaxDuration` —
    // `test_max_duration_wins_over_simultaneous_silence_timeout`.
    let effective_max_ms = guard_max_recording_ms(cfg.max_recording_ms);
    if cap_hit || state.elapsed_ms >= effective_max_ms {
        return GuardEvent::Stop(StopReason::MaxDuration);
    }

    if cfg.silence_timeout_ms == 0 {
        // Silence guard disabled for this recording; max-duration above
        // still applies unconditionally.
        return GuardEvent::None;
    }

    if !state.window.is_full() {
        // Not enough data yet to make ANY silence-based decision — see
        // this module's doc comment ("Disclosed deviation") for why this
        // early return exists: without it, a pathological
        // `pre_cutoff_beep_ms > silence_timeout_ms` config fires a
        // `PreCutoffBeep` on the very first poll of every recording.
        return GuardEvent::None;
    }

    state.last_window_silent_fraction = state.window.silent_fraction();
    if state.last_window_silent_fraction >= cfg.silence_fraction {
        state.silent_ms = state.silent_ms.saturating_add(cfg.poll_ms);
    } else {
        // A real un-silence (not just one loud poll among many — the
        // fraction test already absorbed that case above): reset both
        // the accumulated duration and the beep latch so a later silence
        // run can warn again.
        state.silent_ms = 0;
        state.beeped = false;
    }

    if state.silent_ms >= cfg.silence_timeout_ms {
        // Whether this take ever had any detectable sound decides Finalize
        // (SilenceTimeout) vs. Discard (SilenceTimeoutNoSpeech) — see
        // `GuardState::ever_loud` doc.
        return GuardEvent::Stop(if state.ever_loud {
            StopReason::SilenceTimeout
        } else {
            StopReason::SilenceTimeoutNoSpeech
        });
    }

    let beep_at_ms = cfg.silence_timeout_ms.saturating_sub(cfg.pre_cutoff_beep_ms);
    if !state.beeped && state.silent_ms >= beep_at_ms {
        state.beeped = true;
        return GuardEvent::PreCutoffBeep;
    }

    GuardEvent::None
}

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
        let poll = std::time::Duration::from_millis(cfg.poll_ms as u64);

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
                        cfg.audio_feedback,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrator::coordinator::Stage;
    use crate::orchestrator::recording::{stop_decision, StopDecision};

    // ---- SilenceWindow --------------------------------------------------

    #[test]
    fn test_silence_window_not_full_until_capacity_reached() {
        let mut w = SilenceWindow::new(3);
        assert!(!w.is_full());
        w.push(true);
        assert!(!w.is_full());
        w.push(true);
        assert!(!w.is_full());
        w.push(true);
        assert!(w.is_full());
    }

    #[test]
    fn test_silence_window_evicts_oldest_past_capacity() {
        let mut w = SilenceWindow::new(2);
        w.push(true);
        w.push(true);
        assert_eq!(w.silent_fraction(), 1.0);
        w.push(false); // evicts the oldest `true`, leaving [true, false]
        assert_eq!(w.silent_fraction(), 0.5);
    }

    #[test]
    fn test_silence_window_capacity_floored_at_one() {
        // A misconfigured poll_ms > window_ms would compute capacity 0;
        // GuardState::new floors it, and SilenceWindow itself floors
        // defensively too (belt and suspenders — this is the one place a
        // div-by-zero-adjacent config value could otherwise make
        // `is_full()` trivially true on zero real data).
        let mut w = SilenceWindow::new(0);
        assert!(!w.is_full());
        w.push(true);
        assert!(w.is_full());
    }

    #[test]
    fn test_silence_window_empty_fraction_is_zero() {
        let w = SilenceWindow::new(4);
        assert_eq!(w.silent_fraction(), 0.0);
    }

    // ---- guard_step: shared test helpers ---------------------------------

    /// One poll where the mic was silent (rms below any reasonable
    /// threshold used in these tests).
    fn silent_step(state: &mut GuardState, cfg: &GuardCfg) -> GuardEvent {
        guard_step(state, 0.0, false, cfg)
    }

    /// One poll where the mic was loud (rms above any reasonable
    /// threshold used in these tests).
    fn loud_step(state: &mut GuardState, cfg: &GuardCfg) -> GuardEvent {
        guard_step(state, 1.0, false, cfg)
    }

    // ---- t12: full + >=fraction silent for >= timeout -> Stop, at exactly
    // ---- the poll where silent_ms reaches timeout. This recording never
    // ---- had a loud poll, so the reason is the Discard-routing
    // ---- `SilenceTimeoutNoSpeech`, not `SilenceTimeout` — see the
    // ---- `_after_earlier_speech` variant below for the Finalize case. ----

    #[test]
    fn test_silence_timeout_fires_at_exact_poll_silent_ms_reaches_timeout() {
        let cfg = GuardCfg {
            silence_timeout_ms: 300,
            max_recording_ms: 60_000,
            poll_ms: 100,
            window_ms: 400, // capacity 4
            silence_fraction: 0.75,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 100,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        // Fill (4 polls to reach capacity): no decision possible yet.
        for _ in 0..3 {
            assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None);
        }
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None); // window full now, silent_ms=100
        assert_eq!(state.silent_ms, 100);

        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::PreCutoffBeep); // silent_ms=200, beep_at=200
        assert_eq!(
            silent_step(&mut state, &cfg),
            GuardEvent::Stop(StopReason::SilenceTimeoutNoSpeech)
        ); // silent_ms=300 >= timeout(300), never loud -> NoSpeech
    }

    // ---- never-loud vs. loud-then-silent: the two SilenceTimeout reasons -

    #[test]
    fn test_silence_timeout_with_no_speech_ever_discards() {
        // A recording that is silent from the very first poll (mic muted,
        // VAD off, nobody spoke) must route to the Discard-mapped reason,
        // not the normal Finalize one — sending pure room noise to
        // transcription risks an auto-typed Whisper silence hallucination.
        let cfg = GuardCfg {
            silence_timeout_ms: 300,
            max_recording_ms: 60_000,
            poll_ms: 100,
            window_ms: 400,
            silence_fraction: 0.75,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 100,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);
        assert!(!state.ever_loud);

        for _ in 0..10 {
            match silent_step(&mut state, &cfg) {
                GuardEvent::Stop(reason) => {
                    assert_eq!(reason, StopReason::SilenceTimeoutNoSpeech);
                    assert_eq!(
                        stop_decision(Stage::Recording, true, reason),
                        StopDecision::Discard,
                        "SilenceTimeoutNoSpeech must Discard, not Finalize"
                    );
                    return;
                }
                _ => continue,
            }
        }
        panic!("expected a Stop(SilenceTimeoutNoSpeech) within 10 polls");
    }

    #[test]
    fn test_silence_timeout_after_earlier_speech_finalizes_normally() {
        // The user spoke early in the take, then fell silent (walked away,
        // finished dictating): the eventual silence-timeout stop must
        // still Finalize — they want the earlier speech transcribed.
        let cfg = GuardCfg {
            silence_timeout_ms: 300,
            max_recording_ms: 60_000,
            poll_ms: 100,
            window_ms: 400,
            silence_fraction: 0.75,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 100,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        assert_eq!(loud_step(&mut state, &cfg), GuardEvent::None); // the user's speech
        assert!(state.ever_loud);
        assert_eq!(
            state.max_rms_peak, 1.0,
            "max_rms_peak must equal the max of pushed peaks (loud_step pushes 1.0)"
        );

        for _ in 0..10 {
            match silent_step(&mut state, &cfg) {
                GuardEvent::Stop(reason) => {
                    assert_eq!(reason, StopReason::SilenceTimeout);
                    assert_eq!(
                        state.max_rms_peak, 1.0,
                        "max_rms_peak must never decrease once set, even through later silent polls"
                    );
                    assert_eq!(
                        stop_decision(Stage::Recording, true, reason),
                        StopDecision::Finalize,
                        "SilenceTimeout after earlier speech must Finalize"
                    );
                    return;
                }
                _ => continue,
            }
        }
        panic!("expected a Stop(SilenceTimeout) within 10 polls");
    }

    // ---- t13: one loud poll inside an otherwise silent window (real
    // ---- defaults: 1/40 = 2.5% loud < 20% tolerance) does NOT reset -----

    #[test]
    fn test_single_loud_poll_within_fraction_tolerance_does_not_reset() {
        let cfg = GuardCfg {
            silence_timeout_ms: 3_600_000, // effectively "never" for this test
            max_recording_ms: 3_600_000,
            poll_ms: GUARD_POLL_MS,
            window_ms: SILENCE_WINDOW_MS, // capacity 40
            silence_fraction: SILENCE_FRACTION, // 0.80
            silence_rms: SILENCE_RMS,
            pre_cutoff_beep_ms: PRE_CUTOFF_BEEP_MS,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        for _ in 0..39 {
            assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None);
        }
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None); // 40th: window full, silent_ms=250
        assert_eq!(state.silent_ms, 250);

        // One loud poll: window is now 39/40 = 97.5% silent, still >= 80%.
        assert_eq!(loud_step(&mut state, &cfg), GuardEvent::None);
        assert_eq!(
            state.silent_ms, 500,
            "a single loud poll within the fraction's tolerance must NOT reset silent_ms"
        );
    }

    // ---- t14: window not full -> no decision, silent_ms stays 0, even if
    // ---- every poll so far was silent -------------------------------------

    #[test]
    fn test_window_not_full_yields_no_decision() {
        let cfg = GuardCfg {
            silence_timeout_ms: 100, // deliberately tiny: would fire immediately
            max_recording_ms: 60_000, // if the window-not-full gate didn't exist
            poll_ms: 100,
            window_ms: 1_000, // capacity 10
            silence_fraction: 0.5,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 0,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        for _ in 0..9 {
            assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None);
            assert_eq!(state.silent_ms, 0);
        }
    }

    // ---- t15: max-duration ------------------------------------------------

    #[test]
    fn test_elapsed_reaching_max_stops_regardless_of_silence() {
        let cfg = GuardCfg {
            silence_timeout_ms: 0, // silence guard off; only max matters here
            max_recording_ms: 300,
            poll_ms: 100,
            window_ms: 1_000,
            silence_fraction: 0.5,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 0,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        assert_eq!(loud_step(&mut state, &cfg), GuardEvent::None); // elapsed 100
        assert_eq!(loud_step(&mut state, &cfg), GuardEvent::None); // elapsed 200
        assert_eq!(
            loud_step(&mut state, &cfg),
            GuardEvent::Stop(StopReason::MaxDuration)
        ); // elapsed 300 >= max(300)
    }

    #[test]
    fn test_cap_hit_stops_immediately_regardless_of_elapsed() {
        let cfg = GuardCfg {
            silence_timeout_ms: 0,
            max_recording_ms: 60_000,
            poll_ms: 100,
            window_ms: 1_000,
            silence_fraction: 0.5,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 0,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        let ev = guard_step(&mut state, 1.0, true, &cfg); // cap_hit=true on the very first poll
        assert_eq!(ev, GuardEvent::Stop(StopReason::MaxDuration));
    }

    #[test]
    fn test_max_duration_wins_over_simultaneous_silence_timeout() {
        // Constructed so that at the 3rd poll, BOTH the max-duration
        // check (elapsed=300 >= max=300) and, were it evaluated, the
        // silence check (silent_ms would become 200 >= timeout=200)
        // would independently fire. `guard_step` must report
        // `MaxDuration` — if the checks were ever reordered, this test
        // would start failing with `SilenceTimeout` instead.
        let cfg = GuardCfg {
            silence_timeout_ms: 200,
            max_recording_ms: 300,
            poll_ms: 100,
            window_ms: 200, // capacity 2
            silence_fraction: 0.5,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 50,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None); // elapsed 100, window filling
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None); // elapsed 200, window full, silent_ms=100
        assert_eq!(
            silent_step(&mut state, &cfg),
            GuardEvent::Stop(StopReason::MaxDuration),
            "both conditions hold at this poll; MaxDuration must take precedence"
        );
    }

    // ---- t16: silence_timeout_ms=0 -> silence never fires, max still
    // ---- works; max_recording_ms=0 -> the guard still stops, at the
    // ---- transcribable ceiling (not the raw buffer's larger backstop) ----

    #[test]
    fn test_silence_disabled_never_fires_even_when_fully_silent() {
        let cfg = GuardCfg {
            silence_timeout_ms: 0,
            max_recording_ms: 1_000_000, // effective_max = min(1_000_000, ABS) = 1_000_000
            poll_ms: 100,
            window_ms: 200,
            silence_fraction: 0.5,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 0,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        for _ in 0..50 {
            assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None);
        }
    }

    #[test]
    fn test_max_recording_zero_still_stops_at_the_guards_transcribable_ceiling() {
        // The raw-buffer clamp (`effective_max_recording_ms`, feeding
        // `native_cap_samples`) still allows the full 30-minute backstop—
        // that part is unchanged and covered by
        // `test_native_cap_samples_zero_uses_absolute_backstop` below.
        assert_eq!(effective_max_recording_ms(0), ABS_MAX_RECORDING_MS);
        // But the GUARD's own elapsed check clamps a second time, to the
        // largest take that's actually transcribable — "off" must not
        // produce a recording that's guaranteed to be rejected with no
        // failed-audio dump to retry from.
        assert_eq!(guard_max_recording_ms(0), MAX_RECORDING_MS_CEILING);

        let cfg = GuardCfg {
            silence_timeout_ms: 0,
            max_recording_ms: 0, // "off" per the user
            poll_ms: 100,
            window_ms: 200,
            silence_fraction: 0.5,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 0,
            audio_feedback: Default::default(),
        };
        // Fast-forward instead of looping thousands of times: construct the
        // state already almost at the guard's (ceiling-clamped) backstop.
        let mut state = GuardState::new(&cfg);
        state.elapsed_ms = MAX_RECORDING_MS_CEILING - cfg.poll_ms;

        assert_eq!(
            loud_step(&mut state, &cfg),
            GuardEvent::Stop(StopReason::MaxDuration)
        );
    }

    // ---- t17: PreCutoffBeep exactly once, then Stop at timeout; a
    // ---- pathological pre_cutoff_beep_ms > silence_timeout_ms (hand-edited
    // ---- DB, load is unvalidated) must not fire before the window ever
    // ---- fills -------------------------------------------------------

    #[test]
    fn test_pre_cutoff_beep_fires_exactly_once_then_stops() {
        let cfg = GuardCfg {
            silence_timeout_ms: 300,
            max_recording_ms: 60_000,
            poll_ms: 100,
            window_ms: 400,
            silence_fraction: 0.75,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 100,
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        let mut beeps = 0;
        let mut stopped = false;
        for _ in 0..10 {
            match silent_step(&mut state, &cfg) {
                GuardEvent::PreCutoffBeep => beeps += 1,
                // Never a loud poll in this test -> NoSpeech, not SilenceTimeout.
                GuardEvent::Stop(StopReason::SilenceTimeoutNoSpeech) => {
                    stopped = true;
                    break;
                }
                GuardEvent::Stop(other) => panic!("unexpected stop reason: {other:?}"),
                GuardEvent::None => {}
            }
        }
        assert_eq!(beeps, 1, "beep must fire exactly once");
        assert!(stopped, "must eventually stop on silence timeout");
    }

    #[test]
    fn test_beep_lead_time_exceeding_timeout_does_not_fire_before_window_fills() {
        // pre_cutoff_beep_ms(3000) > silence_timeout_ms(50) saturating-subs
        // beep_at to 0 — the bug this test guards against is
        // GuardEvent::PreCutoffBeep firing on the very first poll (before
        // the window has ever been full), which the module's early
        // `!state.window.is_full()` return prevents.
        let cfg = GuardCfg {
            silence_timeout_ms: 50,
            max_recording_ms: 1_000_000,
            poll_ms: 10,
            window_ms: 20, // capacity 2
            silence_fraction: 0.5,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 3_000,
            audio_feedback: Default::default(),
        };
        assert_eq!(cfg.silence_timeout_ms.saturating_sub(cfg.pre_cutoff_beep_ms), 0);
        let mut state = GuardState::new(&cfg);

        // First poll: window not full yet — must be None, NOT a premature beep.
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None);
        // Second poll: window becomes full for the first time; this is the
        // earliest point a beep is legitimate (beep_at == 0).
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::PreCutoffBeep);
        // Then it must not double-fire, and must eventually stop cleanly
        // (no panic) once silent_ms reaches the timeout.
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None); // silent_ms=20
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None); // silent_ms=30
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None); // silent_ms=40
        assert_eq!(
            silent_step(&mut state, &cfg),
            GuardEvent::Stop(StopReason::SilenceTimeoutNoSpeech)
        ); // silent_ms=50, never loud -> NoSpeech
    }

    // ---- t17b (extra coverage beyond the core test list): a speech burst
    // ---- resets silent_ms AND re-arms the beep latch ----------------------

    #[test]
    fn test_speech_burst_resets_silent_ms_and_rearms_beep() {
        let cfg = GuardCfg {
            silence_timeout_ms: 1000,
            max_recording_ms: 100_000,
            poll_ms: 100,
            window_ms: 200, // capacity 2
            silence_fraction: 0.6, // 1/2=0.5 < 0.6 (un-silences); 2/2=1.0 >= 0.6 (silent)
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 900, // beep_at = 100
            audio_feedback: Default::default(),
        };
        let mut state = GuardState::new(&cfg);

        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None); // fill 1/2
        // Full 2/2, silent_ms becomes 100 — which is ALSO beep_at (100), so
        // the ordinary pre-cutoff beep fires right here (not simulated;
        // this is the real, natural first beep of this silence run).
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::PreCutoffBeep);
        assert_eq!(state.silent_ms, 100);
        assert!(state.beeped);

        // Speech burst: window -> [silent(evicted oldest), loud], frac 0.5 < 0.6.
        let ev = loud_step(&mut state, &cfg);
        assert_eq!(ev, GuardEvent::None);
        assert_eq!(state.silent_ms, 0, "a genuine un-silence must reset silent_ms");
        assert!(!state.beeped, "a genuine un-silence must re-arm the beep latch");

        // Refill with silence: first poll only replaces one of the two
        // slots (still 1 loud in the window, frac 0.5 < 0.6 -> stays reset).
        assert_eq!(silent_step(&mut state, &cfg), GuardEvent::None);
        assert_eq!(state.silent_ms, 0);
        // Second silent poll: window fully silent again (frac 1.0 >= 0.6),
        // silent_ms becomes 100 == beep_at again -> beep must be able to
        // fire again, proving the re-arm actually took effect.
        assert_eq!(
            silent_step(&mut state, &cfg),
            GuardEvent::PreCutoffBeep,
            "a later silence run must be able to beep again after a burst reset `beeped`"
        );
    }

    // ---- t19: pure cap-arithmetic ------------------------------------------

    #[test]
    fn test_native_cap_samples_normal_value() {
        assert_eq!(native_cap_samples(600_000, 48_000), 28_800_000);
    }

    #[test]
    fn test_native_cap_samples_zero_uses_absolute_backstop() {
        assert_eq!(native_cap_samples(0, 48_000), 86_400_000);
    }

    #[test]
    fn test_native_cap_samples_out_of_range_clamped_to_backstop() {
        assert_eq!(
            native_cap_samples(4_000_000_000, 48_000),
            native_cap_samples(0, 48_000),
            "an out-of-range max_recording_ms must clamp to the same backstop as 0"
        );
    }

    #[test]
    fn test_effective_max_recording_ms_passthrough_within_range() {
        assert_eq!(effective_max_recording_ms(600_000), 600_000);
    }

    #[test]
    fn test_guard_max_recording_ms_clamps_stricter_than_buffer_cap() {
        // Default (600_000) is under the ceiling: passes through unchanged,
        // matching the buffer cap.
        assert_eq!(guard_max_recording_ms(600_000), 600_000);
        // Anything at or above the ceiling clamps to it, even though the
        // buffer cap (`effective_max_recording_ms`) would allow up to
        // ABS_MAX_RECORDING_MS (30 min) — the two are deliberately
        // different once past MAX_RECORDING_MS_CEILING.
        assert_eq!(guard_max_recording_ms(MAX_RECORDING_MS_CEILING), MAX_RECORDING_MS_CEILING);
        assert_eq!(guard_max_recording_ms(ABS_MAX_RECORDING_MS), MAX_RECORDING_MS_CEILING);
        assert_eq!(guard_max_recording_ms(0), MAX_RECORDING_MS_CEILING);
    }

    // ---- SILENCE_RMS hardware calibration (2026-09-07) --------------------

    #[test]
    fn test_reference_room_floor_reads_silent_at_calibrated_threshold() {
        // Replays the exact 40-poll peak-RMS distribution measured from a
        // REAL 87s silent recording (MacBook Air M3, built-in mic, quiet
        // room, v0.1.4, 2026-09-07): p10=0.0035, median=0.0061,
        // p90=0.0104, max=0.0156 — the same numbers `SILENCE_RMS`'s doc
        // comment cites, and `SILENCE_WINDOW_MS`/`GUARD_POLL_MS`'s shipped
        // ratio (40) as the window capacity.
        let peaks: Vec<f32> = [0.0035_f32; 4]
            .iter()
            .chain([0.0061_f32; 20].iter())
            .chain([0.0104_f32; 12].iter())
            .chain([0.0156_f32; 4].iter())
            .copied()
            .collect();
        assert_eq!(
            peaks.len(),
            (SILENCE_WINDOW_MS / GUARD_POLL_MS) as usize,
            "the replayed distribution must match the shipped window capacity"
        );

        let fraction_at = |threshold: f32| {
            let mut window = SilenceWindow::new(peaks.len());
            for &p in &peaks {
                window.push(p < threshold);
            }
            window.silent_fraction()
        };

        // Calibrated threshold (this change, 0.02): the reference room
        // floor reads silent often enough to arm the guard — every
        // measured peak (max 0.0156) is below it, so the window is fully
        // silent (fraction 1.0).
        let calibrated = fraction_at(SILENCE_RMS);
        assert_eq!(
            calibrated, 1.0,
            "calibrated SILENCE_RMS ({SILENCE_RMS}) must read every measured room-floor peak as silent"
        );
        assert!(calibrated >= SILENCE_FRACTION);

        // The OLD constant (0.005, -46 dBFS): documents why v0.1.4's guard
        // never armed in 87s of real silence — only the 4 quietest polls
        // (p10=0.0035) were ever below it; fraction 4/40 = 0.10.
        let pre_calibration = fraction_at(0.005);
        assert_eq!(
            pre_calibration, 0.10,
            "the pre-calibration constant (0.005) must read most of the measured room floor as loud"
        );
        assert!(
            pre_calibration < SILENCE_FRACTION,
            "documents the bug: 0.005 never reaches the 80% window fraction on this hardware"
        );
    }

    // Runtime behavior NOT automatable without a `tauri/test` harness
    // (release cancels the guard's token; a rapid restart leaves exactly
    // one guard alive) — verified by inspection; tracked on the manual
    // hardware checklist instead.
    //
    // Runtime `spawn_recording_guard` end-to-end is NOT implemented —
    // `RecordingCoordinator::new` requires a real `AppHandle`, and this
    // crate has no `tauri/test` feature; the pure-decision-function split
    // used throughout this module was chosen specifically to avoid
    // needing one. The policy this task would exercise is guard_step, fully
    // covered above; the task wrapper's only untested-here behaviour is
    // its cancellation/exit plumbing, which mirrors
    // `orchestrator::audio_level::start_audio_level_polling`'s
    // already-tested shape (`test_polling_stops_when_not_recording`,
    // `test_polling_stops_on_cancellation`) closely enough that a
    // reviewer can inspect the two side by side.
}
