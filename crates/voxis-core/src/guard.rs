//! Pure recording-guard decision logic (silence-timeout + max-duration
//! auto-stop) and the pure stop/press decision enums, moved here in
//! Task 1b from `voice_lib::orchestrator::{recording, recording_guard}`.
//!
//! # What moved and what stayed (Task 1b split)
//!
//! From `orchestrator::recording.rs`: the pure enums `StopReason`,
//! `StopDecision`, `PressAction` (no dependencies at all) moved here as
//! `pub` (were `pub(crate)`). The FUNCTIONS that consume them —
//! `stop_decision(stage: Stage, ...)`, `press_action(is_toggle_mode, stage:
//! Stage)`, `stage_to_state(stage: Stage) -> RecordingState` — did **not**
//! move: `Stage` (`orchestrator::coordinator::Stage`) and `RecordingState`
//! (`orchestrator::state::RecordingState`) are orchestrator-internal types
//! living in files outside this step's scope, so those three functions
//! stay in `voice_lib::orchestrator::recording`, importing `StopReason`/
//! `StopDecision`/`PressAction` from here instead of defining them
//! locally. `map_stop_error`/`StopErrorAction` also stay — they take
//! `&AudioError`, voice_lib's cpal-backed recording error type, never
//! part of this move.
//!
//! From `orchestrator::recording_guard.rs`: every pure decision type/
//! function — `SilenceWindow`, `GuardCfg` (+ `from_app_config`),
//! `GuardState`, `GuardEvent`, `guard_step`, `native_cap_samples`,
//! `effective_max_recording_ms`, `guard_max_recording_ms` — moved here
//! along with their unit tests (including the `SILENCE_RMS` hardware-
//! calibration block). `spawn_recording_guard` (the tokio task itself,
//! plus breadcrumbs, audio-feedback beeps, and everything touching
//! `AudioRecorder`/`RecordingCoordinator`/`AppHandle`) stays in
//! voice_lib's `recording_guard.rs`, which imports the pure pieces from
//! here — see that module's own doc comment (preserved) for the full
//! design/locking-discipline narrative, which still applies to the task
//! wrapper that stayed there.
//!
//! Two of the original test module's assertions (in
//! `test_silence_timeout_with_no_speech_ever_discards` and
//! `test_silence_timeout_after_earlier_speech_finalizes_normally`) also
//! called `voice_lib::orchestrator::recording::stop_decision(Stage::
//! Recording, true, reason)` as a cross-check that the emitted
//! `StopReason` maps to the expected `StopDecision`. That function can't
//! be called from here (it lives in voice_lib, the reverse dependency
//! direction), so those two assertions were dropped when the tests moved
//! — the mappings they checked
//! (`SilenceTimeoutNoSpeech -> Discard`, `SilenceTimeout -> Finalize`) are
//! still exhaustively covered by `voice_lib::orchestrator::recording`'s
//! own `test_stop_decision_silence_timeout_no_speech_discards` and
//! `test_stop_decision_toggle_and_pending_reasons_finalize_like_release`.
//! No coverage was lost, only a redundant cross-crate cross-check.

use crate::config::{
    AppConfig, ABS_MAX_RECORDING_MS, GUARD_POLL_MS, MAX_RECORDING_MS_CEILING, PRE_CUTOFF_BEEP_MS,
    SILENCE_FRACTION, SILENCE_RMS, SILENCE_WINDOW_MS,
};
use std::collections::VecDeque;

// =============================================================================
// Pure stop/press decision enums (moved from orchestrator::recording.rs)
// =============================================================================

/// How long a take may run on EXACT digital silence before the guard stops
/// it — see [`is_digital_silence`] and `StopReason::DeviceSilent`.
pub const DEAD_STREAM_SILENCE_MS: u32 = 2_000;

/// A hold at least this long with no audible sample is a dead device at
/// `stop()`; anything shorter is a tap (which legitimately produces nothing).
pub const DEAD_DEVICE_MIN_HOLD_MS: u64 = 1_000;

/// Exact digital silence: every sample 0.0. NOT "quiet" — a live microphone
/// always carries a noise floor. Sustained zeros mean the stream is attached
/// to a device the OS already deactivated (USB re-enumeration under a running
/// stream: CoreAudio keeps the old IOProc alive and feeds zeros — 2026-10-20,
/// BY-V) or the mic is hardware-muted. The two windows that act on it differ
/// on purpose: `DEAD_STREAM_SILENCE_MS` stops a take that is still running
/// (the user is dictating into the void), `DEAD_DEVICE_MIN_HOLD_MS` is the
/// floor for reporting it at `stop()`.
pub fn is_digital_silence(peak: f32) -> bool {
    peak == 0.0
}

/// Why `stop_recording` is being called.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    /// Normal hotkey release.
    Release,
    /// Toggle-mode second press (was dead code — previously routed through
    /// `on_hotkey_released`'s toggle guard, which returns immediately in
    /// toggle mode and never reached `recorder.stop()`).
    TogglePress,
    /// `Orchestrator::cancel()` — discard path, no `queue.push`.
    Cancel,
    /// Layer 0: the press-side residual-window check found a release that
    /// arrived after `await_stage(Recording)` but wasn't seen in time by
    /// the release task itself.
    ReleasePending,
    /// Layer 2 recording guard (`recording_guard.rs`): continuous
    /// near-silence exceeded the configured timeout, and the guard heard
    /// some sound above `SILENCE_RMS` at some point earlier in this same
    /// recording (the user spoke, then presumably walked away) — finalize
    /// and transcribe as usual.
    SilenceTimeout,
    /// Layer 2 recording guard, safety variant: continuous near-silence
    /// exceeded the configured timeout AND the guard never once heard
    /// anything above `SILENCE_RMS` during the whole recording (VAD
    /// disabled or unavailable, mic muted/disconnected for the entire
    /// take). Routes to `StopDecision::Discard` instead of `Finalize`:
    /// sending pure room noise to the transcription API risks a
    /// well-known Whisper silence hallucination (e.g. "Thank you for
    /// watching") being auto-typed into whatever window has focus, with
    /// no human in the loop to notice it was never real speech.
    SilenceTimeoutNoSpeech,
    /// Layer 2/3 recording guard: recording exceeded the configured (or
    /// absolute) maximum duration.
    MaxDuration,
    /// Layer 2 recording guard: the session heard EXACTLY zero — not "quiet",
    /// which is a noise floor, but digital silence, every sample 0.0. A live
    /// microphone never does that; a stream attached to a device CoreAudio
    /// already deactivated does (USB re-enumeration under a running stream,
    /// 2026-10-20: BY-V blinked at 15:21 and every later take was zeros), as
    /// does a hardware-muted mic. The guard stops the take fast instead of
    /// letting the user dictate into the void; `AudioRecorder::stop` then
    /// reports `NoAudioFromDevice`, closes the stale stream and the next
    /// press reopens the device — no restart.
    DeviceSilent,
    /// The recording guard observed `AudioRecorder::is_recording() ==
    /// false` while it was still polling — the recording thread stopped
    /// on its own (a stream build/play failure after `start()` returned
    /// `Ok`, a panic) rather than via any `stop_recording` call. Always
    /// resolves to `StopDecision::Recover` (any reason does, once
    /// `is_recording` disagrees with the coordinator's stage) — this is a
    /// distinct variant purely so the resulting `warn!`/breadcrumb says
    /// why, instead of borrowing `MaxDuration`/`SilenceTimeout` for
    /// something neither describes.
    StreamDied,
}

/// Outcome of checking whether a `stop_recording` call should actually touch
/// the recorder, and if so, how.
///
/// SRP: pure decision, no side effects — `stop_recording` performs the
/// logging/recorder/queue/overlay side effects based on this value. Kept
/// free of any `AppHandle`/`Arc` dependency so it's unit-testable without a
/// running Tauri app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopDecision {
    /// Nothing to stop: the coordinator isn't in `Stage::Recording` at
    /// all. Silent — this is the loser of a real race (the winner holds
    /// `stop_lock` through its own stage transition, so a loser only ever
    /// observes `Processing`/`Idle`, never `Recording` with a dead
    /// recorder — see `Recover`), or a stray call with nothing to do.
    Skip,
    /// Abnormal: the coordinator still says `Stage::Recording` but
    /// `AudioRecorder::is_recording()` is already `false`. Under
    /// `stop_lock` this can NEVER be a benign race-loser (the winner of a
    /// real race holds the lock through its own stage transition, so a
    /// loser only ever observes `Processing`/`Idle`) — it means the
    /// recording thread died after `start()`
    /// returned `Ok` (stream build/play failure, a panic, device
    /// unplugged). `stop_recording` must NOT call `recorder.stop()`
    /// (nothing to stop) and must still return the coordinator to `Idle`
    /// — leaving it pinned at `Recording` makes the hotkey dead until
    /// restart (`press_action` ignores/skips every subsequent
    /// press/toggle/cancel while stage is `Recording`).
    Recover,
    /// Stop the recorder but throw the audio away: no `queue.push`, no
    /// transcription. Used only by `StopReason::Cancel`.
    Discard,
    /// Stop the recorder and, unless the capture turns out to be
    /// too-short, queue it for transcription. Used by every reason other
    /// than `Cancel`.
    Finalize,
}

/// What a hotkey/tap press should do, given the current hotkey mode and
/// coordinator stage. Mirrors the two checks `on_hotkey_pressed` used to
/// perform inline (toggle-stops-recording branch, then the TALRI
/// Idle/Processing gate) as one pure, exhaustively-tested decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PressAction {
    /// Toggle mode, already `Recording`: this press stops the current
    /// take (routes to `stop_recording(StopReason::TogglePress)`) instead
    /// of starting a new one.
    StopToggle,
    /// `Idle` or `Processing` (TALRI: a new recording may start while the
    /// previous transcription is still running): proceed to debounce /
    /// permission-check / `recorder.start()`.
    Start,
    /// Any other combination (hold-mode press while already `Recording`):
    /// ignored.
    Ignore,
}

// =============================================================================
// Pure recording-guard decision logic (moved from
// orchestrator::recording_guard.rs)
// =============================================================================

/// Ring buffer of "was this poll silent" over the last `capacity` polls.
/// Capacity is fixed for the buffer's lifetime (derived once from
/// `GuardCfg::window_ms / poll_ms`).
pub struct SilenceWindow {
    buf: VecDeque<bool>,
    capacity: usize,
}

impl SilenceWindow {
    pub fn new(capacity: usize) -> Self {
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

    /// Record one silence-detection poll result into the sliding window.
    ///
    /// `is_silent` is `true` when the sampled audio frame was below the
    /// silence threshold, `false` when it contained audible signal. Once the
    /// window is full the oldest entry is evicted before the new one is
    /// appended, keeping the buffer at exactly `capacity` entries.
    pub fn push(&mut self, is_silent: bool) {
        if self.buf.len() == self.capacity {
            self.buf.pop_front();
        }
        self.buf.push_back(is_silent);
    }

    pub fn is_full(&self) -> bool {
        self.buf.len() == self.capacity
    }

    /// Fraction of polls currently in the window that were silent. Only
    /// meaningful once `is_full()` — callers must check that first (this
    /// method doesn't gate on it itself, to keep it a plain, honest query
    /// over whatever's in the buffer right now).
    pub fn silent_fraction(&self) -> f32 {
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
/// Field access outside this module is deliberately minimal — two plain
/// getters (`poll_ms`, `audio_feedback`) for `voice_lib::orchestrator::
/// recording_guard`'s task loop (a different crate since Task 1b; it
/// needs the poll interval and the pre-cutoff beep's settings, nothing
/// else). `RecordingCoordinator`'s wiring site (`voice_lib::orchestrator::
/// recording`) only ever needs `from_app_config` and `native_cap_samples`.
#[derive(Debug, Clone, Copy)]
pub struct GuardCfg {
    silence_timeout_ms: u32,
    max_recording_ms: u32,
    poll_ms: u32,
    window_ms: u32,
    silence_fraction: f32,
    silence_rms: f32,
    pre_cutoff_beep_ms: u32,
    audio_feedback: crate::audio_feedback_types::AudioFeedbackSettings,
}

impl GuardCfg {
    /// Snapshot the user-configurable fields plus the (currently fixed,
    /// not user-configurable) tuning constants. Read once, at
    /// `on_hotkey_pressed`'s start-critical section — the guard's whole
    /// lifetime uses this single snapshot, same as every other
    /// per-recording config read in that function.
    pub fn from_app_config(config: &AppConfig) -> Self {
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

    /// Poll interval — `voice_lib`'s `spawn_recording_guard` task loop
    /// sleeps this long between polls.
    pub fn poll_ms(&self) -> u32 {
        self.poll_ms
    }

    /// Pre-cutoff beep's volume/enabled settings — `voice_lib`'s
    /// `spawn_recording_guard` plays this on `GuardEvent::PreCutoffBeep`.
    pub fn audio_feedback(&self) -> crate::audio_feedback_types::AudioFeedbackSettings {
        self.audio_feedback
    }
}

/// Per-recording mutable state the guard task carries across polls.
///
/// Fields are `pub` (were private in voice_lib's pre-Task-1b module) so
/// `voice_lib::orchestrator::recording_guard`'s task wrapper — a
/// different crate now — can log `elapsed_ms`/`max_rms_peak`/
/// `last_window_silent_fraction`/`silent_ms` the same way it always has.
pub struct GuardState {
    pub window: SilenceWindow,
    /// Accumulated milliseconds where the window has been full AND at
    /// least `silence_fraction` silent, reset to 0 the moment either
    /// condition stops holding (a real "un-silence": speech, not just one
    /// loud poll — the fraction test already absorbs those).
    pub silent_ms: u32,
    /// Poll-accumulated milliseconds since the guard started (i.e. since
    /// `recorder.start()` returned `Ok` for this recording): poll count ×
    /// `poll_ms`, NOT a wall-clock reading — so it is ≤ wall-clock (tokio
    /// `sleep` never fires early; per-poll processing time is not
    /// counted). Consequence: `MaxDuration` may fire *late* by the
    /// accumulated processing time, never early; `cap_hit` is the exact
    /// byte-level backstop. Deliberately not an `Instant` — that would
    /// make `guard_step` impure/untestable without a clock.
    pub elapsed_ms: u32,
    /// Whether the pre-cutoff beep has already fired for the CURRENT
    /// silence run — reset to `false` alongside `silent_ms` on a genuine
    /// un-silence, so a later silence run can beep again
    /// (`test_speech_burst_resets_silent_ms_and_rearms_beep`).
    pub beeped: bool,
    /// Whether ANY poll during this recording's WHOLE lifetime (not just
    /// the current silence run — unlike `silent_ms`/`beeped`, never reset)
    /// has seen `rms_peak >= silence_rms`. If a silence-timeout stop fires
    /// and this is still `false`, the recording never had any detectable
    /// sound at all, so it is routed to `StopReason::SilenceTimeoutNoSpeech`
    /// (→ `StopDecision::Discard`) instead of the normal `SilenceTimeout`
    /// (→ `Finalize`) — sending an all-silent take to transcription risks
    /// a Whisper silence hallucination being auto-typed with no human in
    /// the loop.
    pub ever_loud: bool,
    /// Whole-take maximum `rms_peak` ever observed (before any threshold
    /// comparison), never reset. Pure observability: the 2026-09-07
    /// `SILENCE_RMS` recalibration (see its doc comment) required pulling
    /// this exact number out of an offline WAV analysis because nothing
    /// logged it — logged in both the auto-stop `warn!` and the
    /// normal-release `Recording guard cancelled` debug so every take's
    /// peak is visible in the log for the NEXT calibration, on whatever
    /// hardware needs it.
    pub max_rms_peak: f32,
    /// The most recent `SilenceWindow::silent_fraction()` computed once
    /// the window became full (`0.0` before that) — same observability
    /// purpose as `max_rms_peak`: lets a future calibration see how close
    /// a take came to arming the guard without needing offline analysis.
    pub last_window_silent_fraction: f32,
}

impl GuardState {
    pub fn new(cfg: &GuardCfg) -> Self {
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
pub enum GuardEvent {
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
pub fn effective_max_recording_ms(max_recording_ms: u32) -> u32 {
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
pub fn guard_max_recording_ms(max_recording_ms: u32) -> u32 {
    effective_max_recording_ms(max_recording_ms).min(MAX_RECORDING_MS_CEILING)
}

/// Native-rate (pre-downsample) sample-buffer cap for
/// `AudioRecorder::set_max_samples`. `max_recording_ms` is the raw config value (see `effective_max_recording_ms` for the
/// clamping this applies first); `native_rate` is
/// `AudioRecorder::sample_rate()`, valid once `recorder.start()` has
/// returned `Ok`.
pub fn native_cap_samples(max_recording_ms: u32, native_rate: u32) -> usize {
    let ms = effective_max_recording_ms(max_recording_ms) as u64;
    let rate = native_rate as u64;
    ((ms * rate) / 1000) as usize
}

/// The ONLY place with policy (module doc, "Design") — decide what, if
/// anything, the guard should do this poll. Pure: no I/O, no locks, no
/// `AppHandle` — testable without a device or a runtime, same shape as
/// `voice_lib::orchestrator::recording`'s `stop_decision`.
///
/// `rms_peak` is boost-independent pre-boost peak RMS since the last poll
/// (`AudioRecorder::take_rms_peak`); `cap_hit` is whether the native
/// sample buffer has hit its cap (`AudioRecorder::cap_hit`) since the
/// last poll.
pub fn guard_step(
    state: &mut GuardState,
    rms_peak: f32,
    cap_hit: bool,
    cfg: &GuardCfg,
) -> GuardEvent {
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

    let beep_at_ms = cfg
        .silence_timeout_ms
        .saturating_sub(cfg.pre_cutoff_beep_ms);
    if !state.beeped && state.silent_ms >= beep_at_ms {
        state.beeped = true;
        return GuardEvent::PreCutoffBeep;
    }

    GuardEvent::None
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // (The `stop_decision(...) == StopDecision::Discard` cross-check
        // this test used to also assert lives in voice_lib, not here —
        // see this module's doc comment.)
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
        // (Same dropped cross-check as the test above — see module doc.)
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
            window_ms: SILENCE_WINDOW_MS,       // capacity 40
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
            silence_timeout_ms: 100,  // deliberately tiny: would fire immediately
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
        assert_eq!(
            cfg.silence_timeout_ms
                .saturating_sub(cfg.pre_cutoff_beep_ms),
            0
        );
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
            window_ms: 200,        // capacity 2
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
        assert_eq!(
            state.silent_ms, 0,
            "a genuine un-silence must reset silent_ms"
        );
        assert!(
            !state.beeped,
            "a genuine un-silence must re-arm the beep latch"
        );

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
        assert_eq!(
            guard_max_recording_ms(MAX_RECORDING_MS_CEILING),
            MAX_RECORDING_MS_CEILING
        );
        assert_eq!(
            guard_max_recording_ms(ABS_MAX_RECORDING_MS),
            MAX_RECORDING_MS_CEILING
        );
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
}
