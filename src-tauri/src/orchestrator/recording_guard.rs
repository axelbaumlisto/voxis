//! Recording guard: silence-timeout + max-duration auto-stop (plan §3
//! Layer 2/3) — defense-in-depth *behind* the deterministic press/release
//! fix (`press_release.rs`). That fix closes the specific race that used
//! to leave a recording running forever; this guard is the backstop for
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
//! `orchestrator::recording`'s `stop_decision`/`press_action` split, and
//! the plan §4 harness choice: policy lives in a function that doesn't
//! need a device or a runtime, so it's exhaustively unit-tested; the task
//! wrapper is exercised only implicitly). Two independent conditions can
//! end a recording:
//!
//! - **Silence**: a sliding window of the last `SILENCE_WINDOW_MS` polls
//!   (`SilenceWindow`, ring buffer of "was this poll silent") must be
//!   both *full* and at least `SILENCE_FRACTION` silent before any
//!   silent duration starts accumulating at all — this is what makes a
//!   single loud poll (a keyboard click, a cough) not reset a real
//!   silence in progress, plan §3 Layer 2. Once `silent_ms` reaches
//!   `silence_timeout_ms`, stop.
//! - **Max duration**: wall-clock `elapsed_ms` since the guard started,
//!   independent of silence — plan §3 Layer 3's "active stop" half (the
//!   cpal callback's own `AudioRecorder::set_max_samples`/`cap_hit` only
//!   stops *pushing* into the buffer; this guard is what actually calls
//!   `stop_recording` when that cap is hit, or when wall-clock time alone
//!   exceeds the limit). `effective_max_recording_ms` folds in the
//!   `ABS_MAX_RECORDING_MS` backstop, so this condition can never be
//!   truly "off" even if the user's `max_recording_ms` config is `0` or a
//!   hand-edited out-of-range value (T1 r1 review, R1).
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
//! ran when `overlay.enabled` was true (plan §1.4: "не два толкователя
//! тишины", i.e. don't leave two independent silence interpreters in the
//! codebase). This guard is spawned unconditionally, regardless of the
//! overlay setting.
//!
//! # Locking discipline (T3 r1 review, carry-forward C4)
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
//! `JoinHandle::abort()` (plan §3 Layer 2: "отмена только через
//! `CancellationToken`, никогда `JoinHandle::abort()`" — an abort mid-way
//! through a `stop_recording` call holding `stop_lock` would be fatal).
//!
//! # Disclosed deviation from the plan's literal `guard_step` sketch
//!
//! The plan's pseudocode evaluates the silence/beep/timeout checks on
//! every poll, with only the *accumulation* step ("silent_ms += poll_ms")
//! gated behind `window.is_full()` — falling through to the timeout/beep
//! comparisons against `silent_ms`'s current (possibly still-zero) value
//! regardless. That has a real bug: `pre_cutoff_beep_ms > silence_timeout_ms`
//! (reachable via a hand-edited config row, since load is unvalidated —
//! T1 r1 review) saturating-subs `beep_at` to `0`, and `silent_ms(0) >=
//! beep_at(0)` is trivially true — firing `PreCutoffBeep` on literally
//! the FIRST poll of every recording, before the window has even filled
//! once, let alone measured any real silence. This implementation instead
//! gates the *entire* silence/beep/timeout block behind
//! `window.is_full()`, returning `GuardEvent::None` early otherwise — see
//! `test_beep_lead_time_exceeding_timeout_does_not_fire_before_window_fills`
//! for the exact scenario this fixes, and `test_window_not_full_yields_no_decision`
//! for the (unchanged) normal case this same gate also covers.

use super::recording::{RecordingCoordinator, StopReason};
use crate::audio::AudioRecorder;
use crate::config::{
    AppConfig, ABS_MAX_RECORDING_MS, GUARD_POLL_MS, PRE_CUTOFF_BEEP_MS, SILENCE_FRACTION,
    SILENCE_RMS, SILENCE_WINDOW_MS,
};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Ring buffer of "was this poll silent" over the last `capacity` polls.
/// Capacity is fixed for the buffer's lifetime (derived once from
/// `GuardCfg::window_ms / poll_ms` — plan §3 Layer 2).
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
/// from `AppConfig` + tuning constants at guard-spawn time (plan §3 Layer
/// 2). Also carries `audio_feedback` (the pre-cutoff beep's volume/
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
    /// `on_hotkey_pressed`'s start-critical section (plan §3 Layer 2) —
    /// the guard's whole lifetime uses this single snapshot, same as
    /// every other per-recording config read in that function.
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
    /// Wall-clock milliseconds elapsed since the guard started (i.e.
    /// since `recorder.start()` returned `Ok` for this recording).
    elapsed_ms: u32,
    /// Whether the pre-cutoff beep has already fired for the CURRENT
    /// silence run — reset to `false` alongside `silent_ms` on a genuine
    /// un-silence, so a later silence run can beep again
    /// (`test_speech_burst_resets_silent_ms_and_rearms_beep`).
    beeped: bool,
}

impl GuardState {
    fn new(cfg: &GuardCfg) -> Self {
        let capacity = (cfg.window_ms / cfg.poll_ms.max(1)) as usize;
        Self {
            window: SilenceWindow::new(capacity),
            silent_ms: 0,
            elapsed_ms: 0,
            beeped: false,
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
/// value to what the guard and the buffer cap actually enforce: `0`
/// (silence-only, "no max" as far as the user is concerned) still gets
/// the absolute backstop `ABS_MAX_RECORDING_MS`, and any configured value
/// above the backstop is clamped down to it. Single source of truth so
/// `native_cap_samples` (the buffer cap) and `guard_step`'s own
/// wall-clock check can never disagree about "how long is too long" — T1
/// r1 review R1 (config load is intentionally unvalidated, matching
/// `hotkey_hold_ms`/`typing_delay`; a hand-edited out-of-range DB value
/// must not silently produce an unbounded buffer).
fn effective_max_recording_ms(max_recording_ms: u32) -> u32 {
    if max_recording_ms == 0 {
        ABS_MAX_RECORDING_MS
    } else {
        max_recording_ms.min(ABS_MAX_RECORDING_MS)
    }
}

/// Native-rate (pre-downsample) sample-buffer cap for
/// `AudioRecorder::set_max_samples` — plan §3 Layer 3. `max_recording_ms`
/// is the raw config value (see `effective_max_recording_ms` for the
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
/// `AppHandle` — testable without a device or a runtime (plan §4 harness
/// option B, same shape as `orchestrator::recording`'s `stop_decision`).
///
/// `rms_peak` is boost-independent pre-boost peak RMS since the last poll
/// (`AudioRecorder::take_rms_peak`); `cap_hit` is whether the native
/// sample buffer has hit its cap (`AudioRecorder::cap_hit`) since the
/// last poll.
fn guard_step(state: &mut GuardState, rms_peak: f32, cap_hit: bool, cfg: &GuardCfg) -> GuardEvent {
    state.elapsed_ms = state.elapsed_ms.saturating_add(cfg.poll_ms);
    state.window.push(rms_peak < cfg.silence_rms);

    // Max-duration: checked (and, if true, returned) BEFORE silence,
    // unconditionally — plan §3 Layer 3's "active stop" half, and never
    // truly "off" (see `effective_max_recording_ms`). Deliberate
    // precedence: if both conditions hold on the same poll, the event is
    // always `MaxDuration` —
    // `test_max_duration_wins_over_simultaneous_silence_timeout`.
    let effective_max_ms = effective_max_recording_ms(cfg.max_recording_ms);
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

    if state.window.silent_fraction() >= cfg.silence_fraction {
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
        return GuardEvent::Stop(StopReason::SilenceTimeout);
    }

    let beep_at_ms = cfg.silence_timeout_ms.saturating_sub(cfg.pre_cutoff_beep_ms);
    if !state.beeped && state.silent_ms >= beep_at_ms {
        state.beeped = true;
        return GuardEvent::PreCutoffBeep;
    }

    GuardEvent::None
}

/// Spawn the recording guard task — plan §3 Layer 2. Runs unconditionally
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
            // Check the token FIRST on every iteration (plan §3 Layer 2,
            // T3 r1 review carry-forward C5) — `select!` resolves
            // immediately if already cancelled, without waiting out the
            // sleep.
            tokio::select! {
                _ = token.cancelled() => {
                    tracing::debug!("Recording guard cancelled");
                    break;
                }
                _ = tokio::time::sleep(poll) => {}
            }

            if !recorder.is_recording() {
                tracing::debug!("Recording guard stopping: recorder no longer recording");
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
                        StopReason::MaxDuration => {
                            crate::diagnostics::breadcrumbs::sites::recording_auto_stopped_max_duration();
                        }
                        other => unreachable!(
                            "guard_step only ever returns StopReason::SilenceTimeout or \
                             MaxDuration, got {other:?}"
                        ),
                    }
                    tracing::warn!(
                        "recording guard: auto-stopping ({reason:?}) after {}ms elapsed \
                         ({}ms accumulated silence)",
                        state.elapsed_ms,
                        state.silent_ms
                    );
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

    // ---- t12: full + >=fraction silent for >= timeout -> Stop(SilenceTimeout),
    // ---- at exactly the poll where silent_ms reaches timeout -------------

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
            GuardEvent::Stop(StopReason::SilenceTimeout)
        ); // silent_ms=300 >= timeout(300)
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
    // ---- works; max_recording_ms=0 -> ABS_MAX_RECORDING_MS still applies --

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
    fn test_max_recording_zero_still_stops_at_absolute_backstop() {
        assert_eq!(effective_max_recording_ms(0), ABS_MAX_RECORDING_MS);

        let cfg = GuardCfg {
            silence_timeout_ms: 0,
            max_recording_ms: 0, // "off" per the user, but ABS_MAX_RECORDING_MS still applies
            poll_ms: 100,
            window_ms: 200,
            silence_fraction: 0.5,
            silence_rms: 0.01,
            pre_cutoff_beep_ms: 0,
            audio_feedback: Default::default(),
        };
        // Fast-forward instead of looping 18,000 times (ABS_MAX_RECORDING_MS
        // / poll_ms): construct the state already almost at the backstop.
        let mut state = GuardState::new(&cfg);
        state.elapsed_ms = ABS_MAX_RECORDING_MS - cfg.poll_ms;

        assert_eq!(
            loud_step(&mut state, &cfg),
            GuardEvent::Stop(StopReason::MaxDuration)
        );
    }

    // ---- t17: PreCutoffBeep exactly once, then Stop at timeout; a
    // ---- pathological pre_cutoff_beep_ms > silence_timeout_ms (hand-edited
    // ---- DB, T1 r1 review) must not fire before the window ever fills ----

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
                GuardEvent::Stop(StopReason::SilenceTimeout) => {
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
            GuardEvent::Stop(StopReason::SilenceTimeout)
        ); // silent_ms=50
    }

    // ---- t18: a speech burst resets silent_ms AND re-arms the beep latch -

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

    // t20 (runtime: `spawn_recording_guard` end-to-end) is NOT implemented —
    // `RecordingCoordinator::new` requires a real `AppHandle`, and this
    // crate has no `tauri/test` feature (plan §4 harness discussion,
    // option A vs B; this codebase already chose B for exactly this
    // reason). The policy this task would exercise is guard_step, fully
    // covered above; the task wrapper's only untested-here behaviour is
    // its cancellation/exit plumbing, which mirrors
    // `orchestrator::audio_level::start_audio_level_polling`'s
    // already-tested shape (`test_polling_stops_when_not_recording`,
    // `test_polling_stops_on_cancellation`) closely enough that a
    // reviewer can inspect the two side by side.
}
