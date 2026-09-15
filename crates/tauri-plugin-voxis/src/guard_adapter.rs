//! Adapts `voxis_core::guard` (RMS-window silence/max-duration decision
//! logic, unchanged from desktop Voxis) to the plugin's per-poll input:
//! an `Option<LevelSample>` read off `AudioCapture::level_rx` instead of
//! `AudioRecorder::take_rms_peak()`/`cap_hit()`.

use voxis_core::config::AppConfig;
use voxis_core::guard::{GuardCfg, GuardEvent, GuardState};

use crate::capture::LevelSample;
use crate::models::Mode;

/// Hold-mode's additional absolute cap (`[R1-Safety T4]`), independent of
/// whatever `max_recording_ms` the active profile configures \u2014 a
/// hold-to-talk trigger stuck "held" (stuck key, dead keyup) must not be
/// able to run longer than this via profile configuration alone.
pub const HOLD_MAX_MS: u32 = 120_000;

/// Builds the `GuardCfg` a session's Recording-phase loop uses for its
/// whole lifetime, applying the Hold-mode cap on top of the profile's
/// `max_recording_ms` (the self-cap's own `native_cap_samples` ceiling,
/// computed separately in `commands.rs`, deliberately does NOT get this
/// same clamp \u2014 same split as `voxis_core::guard::{effective_max_recording_ms,
/// guard_max_recording_ms}` upstream: the raw buffer cap and the guard's
/// own elapsed-time cap are allowed to disagree).
pub fn guard_cfg_for(app_config: &AppConfig, mode: Mode) -> GuardCfg {
    let mut cfg = app_config.clone();
    if mode == Mode::Hold {
        cfg.max_recording_ms = if cfg.max_recording_ms == 0 {
            HOLD_MAX_MS
        } else {
            cfg.max_recording_ms.min(HOLD_MAX_MS)
        };
    }
    GuardCfg::from_app_config(&cfg)
}

/// One poll's worth of adaptation: pulls `rms_peak`/`cap_hit` out of a
/// `LevelSample` (`muted` is treated as silence \u2014 `[R1-Safety T3]`: a
/// muted take must not be able to defeat the silence timeout just
/// because it reports literal-zero RMS instead of a normal quiet room)
/// and feeds them to the real `guard_step`. `None` (no sample has ever
/// arrived yet \u2014 capture just started) makes no decision at all: an
/// absent sample is not the same claim as "the mic reported silence".
pub fn poll(state: &mut GuardState, cfg: &GuardCfg, sample: Option<LevelSample>) -> Option<GuardEvent> {
    let sample = sample?;
    let rms_peak = if sample.muted { 0.0 } else { sample.peak };
    Some(voxis_core::guard::guard_step(state, rms_peak, sample.cap_hit, cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(max_recording_ms: u32) -> AppConfig {
        AppConfig { max_recording_ms, silence_timeout_ms: 0, ..AppConfig::default() }
    }

    #[test]
    fn hold_mode_clamps_max_recording_ms_to_120s() {
        let guard_cfg = guard_cfg_for(&cfg(600_000), Mode::Hold);
        let mut state = GuardState::new(&guard_cfg);
        // Fast-forward to just under the clamp; one more poll must stop.
        for _ in 0..(HOLD_MAX_MS / voxis_core::config::GUARD_POLL_MS - 1) {
            assert_eq!(
                voxis_core::guard::guard_step(&mut state, 1.0, false, &guard_cfg),
                GuardEvent::None
            );
        }
        assert_eq!(
            voxis_core::guard::guard_step(&mut state, 1.0, false, &guard_cfg),
            GuardEvent::Stop(voxis_core::guard::StopReason::MaxDuration)
        );
    }

    #[test]
    fn hold_mode_does_not_relax_a_stricter_profile_cap() {
        let guard_cfg = guard_cfg_for(&cfg(5_000), Mode::Hold);
        // A 5s profile cap must survive Hold's 120s clamp unchanged (min(), not overwrite).
        let mut state = GuardState::new(&guard_cfg);
        for _ in 0..19 {
            assert_eq!(voxis_core::guard::guard_step(&mut state, 1.0, false, &guard_cfg), GuardEvent::None);
        }
        assert_eq!(
            voxis_core::guard::guard_step(&mut state, 1.0, false, &guard_cfg),
            GuardEvent::Stop(voxis_core::guard::StopReason::MaxDuration)
        );
    }

    #[test]
    fn toggle_mode_is_not_clamped_by_hold_max() {
        let guard_cfg = guard_cfg_for(&cfg(600_000), Mode::Toggle);
        let mut state = GuardState::new(&guard_cfg);
        for _ in 0..(HOLD_MAX_MS / voxis_core::config::GUARD_POLL_MS + 4) {
            assert_eq!(
                voxis_core::guard::guard_step(&mut state, 1.0, false, &guard_cfg),
                GuardEvent::None,
                "toggle mode must not stop at the hold-only 120s cap"
            );
        }
    }

    #[test]
    fn poll_treats_muted_sample_as_silence() {
        let guard_cfg = {
            let mut c = cfg(600_000);
            c.silence_timeout_ms = 300;
            GuardCfg::from_app_config(&c)
        };
        let mut state = GuardState::new(&guard_cfg);
        let muted_loud = crate::capture::LevelSample { rms: 0.9, peak: 0.9, muted: true, cap_hit: false };
        // The silence window's capacity is fixed at
        // `SILENCE_WINDOW_MS / GUARD_POLL_MS` = 40 polls (independent of
        // `silence_timeout_ms`); it must fill before any silence decision
        // is possible, then take a couple more polls for `silent_ms` to
        // reach the configured 300ms timeout.
        for _ in 0..39 {
            assert_eq!(poll(&mut state, &guard_cfg, Some(muted_loud)), Some(GuardEvent::None));
        }
        // 40th poll: window becomes full (silent_ms=250); `pre_cutoff_beep_ms`
        // (a fixed constant, 3000ms) saturating-subtracted from this test's
        // 300ms timeout floors `beep_at` to 0, so the pre-cutoff beep fires
        // here rather than `None` — same boundary behaviour
        // `voxis_core::guard`'s own tests document, not specific to muting.
        assert_eq!(poll(&mut state, &guard_cfg, Some(muted_loud)), Some(GuardEvent::PreCutoffBeep));
        assert_eq!(
            poll(&mut state, &guard_cfg, Some(muted_loud)),
            Some(GuardEvent::Stop(voxis_core::guard::StopReason::SilenceTimeoutNoSpeech)),
            "a loud-but-muted sample must be treated as silence by the guard"
        );
    }

    #[test]
    fn poll_returns_none_for_no_sample_yet() {
        let guard_cfg = guard_cfg_for(&cfg(600_000), Mode::Toggle);
        let mut state = GuardState::new(&guard_cfg);
        assert_eq!(poll(&mut state, &guard_cfg, None), None);
    }

    #[test]
    fn poll_reports_cap_hit_as_max_duration_immediately() {
        let guard_cfg = guard_cfg_for(&cfg(600_000), Mode::Toggle);
        let mut state = GuardState::new(&guard_cfg);
        let capped = LevelSample { rms: 0.0, peak: 0.0, muted: false, cap_hit: true };
        assert_eq!(
            poll(&mut state, &guard_cfg, Some(capped)),
            Some(GuardEvent::Stop(voxis_core::guard::StopReason::MaxDuration))
        );
    }
}
