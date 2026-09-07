//! Audio level polling for overlay spectrum visualization.
//!
//! SRP: This module handles audio level polling and overlay updates only.
//! Uses FFT-based spectrum analysis for Winamp-style frequency visualization.
//! Silence detection (and auto-stop) is NOT this module's concern — it used
//! to live here (a one-time `WARN` log, active only while this poller ran,
//! i.e. only when `overlay.enabled`) and has moved to
//! `orchestrator::recording_guard`, which runs unconditionally and can
//! actually act on what it detects — don't leave two independent silence
//! interpreters in the codebase.

use crate::audio::{AudioRecorder, SpectrumAnalyzer};
use crate::overlay_native::OverlayBackend;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Overlay spectrum poll interval. Named (not an inline literal) so the
/// `Spectrum [N]` log throttle below is DERIVED from it instead of
/// hardcoding a second, independent magic number that could silently drift
/// out of sync if this interval ever changes.
const POLL_INTERVAL_MS: u32 = 80;

/// At most one `Spectrum [N]` line per this many milliseconds. The file
/// appender already records at DEBUG (`setup/logging.rs`), so an earlier
/// INFO→DEBUG change alone did not reduce disk writes — a stuck ~10 h
/// recording produced 87 053 of 87 097 total log lines this way.
/// `tracing::trace!` plus this throttle keeps the spam down even when
/// trace-level logging is enabled for diagnosis.
const SPECTRUM_LOG_INTERVAL_MS: u32 = 5_000;

/// Pure: true once every `interval_ms / poll_ms` polls (at least every
/// poll, never less often than every poll). Free of the loop's `count`
/// state and any async/task context so it's directly unit-testable
/// without spinning up the polling task.
pub(crate) fn should_log_spectrum(count: u32, poll_ms: u32, interval_ms: u32) -> bool {
    let every = (interval_ms / poll_ms.max(1)).max(1);
    count % every == 0
}

/// Start polling audio levels and sending FFT spectrum to overlay.
///
/// This spawns a background task that polls the audio recorder,
/// performs FFT analysis, and sends spectrum bins to the overlay
/// for Winamp-style frequency visualization.
///
/// The polling stops when either:
/// - The `cancel_token` is cancelled (immediate stop)
/// - The recorder is no longer recording
pub fn start_audio_level_polling(
    recorder: Arc<AudioRecorder>,
    overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    cancel_token: CancellationToken,
) {
    tracing::info!("Starting FFT spectrum polling for overlay visualization");

    tauri::async_runtime::spawn(async move {
        // Small delay to ensure recording thread has started
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        // Create spectrum analyzer for FFT processing
        let mut analyzer = SpectrumAnalyzer::new();
        let fft_size = SpectrumAnalyzer::fft_size();

        let mut count = 0u32;
        loop {
            // Check cancellation FIRST for immediate stop
            if cancel_token.is_cancelled() {
                tracing::info!("Audio level polling cancelled after {} iterations", count);
                break;
            }

            // Then check recording state
            if !recorder.is_recording() {
                tracing::info!(
                    "Spectrum polling stopped (not recording) after {} iterations",
                    count
                );
                break;
            }

            // Get recent samples for FFT analysis
            let samples = recorder.get_recent_samples(fft_size);

            // Fixed spectrum boost for consistent visualization
            // FFT magnitudes are typically 0.001-0.01, multiplier 80 gives good visibility
            let spectrum_boost = 80.0;

            // Compute FFT spectrum bins
            let spectrum = analyzer.analyze(&samples, spectrum_boost);

            if should_log_spectrum(count, POLL_INTERVAL_MS, SPECTRUM_LOG_INTERVAL_MS) {
                // Log peak frequency for debugging. `trace!`, not `info!`/
                // `debug!`: the file appender already records DEBUG, so this
                // is the only level change that actually reduces bytes
                // written for a long recording.
                let peak_bar = spectrum
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                tracing::trace!(
                    "Spectrum [{}]: {} samples, peak bar {}, max {:.3}",
                    count,
                    samples.len(),
                    peak_bar,
                    spectrum.iter().cloned().fold(0.0f32, f32::max)
                );
            }

            // Derive scalar audio level for webview overlays (peak of spectrum).
            // SRP: spectrum analyzer keeps owning FFT math; this is just a
            // collapse to a single visualizer input that the overlay webview needs.
            let audio_level = spectrum.iter().cloned().fold(0.0f32, f32::max).min(1.0);

            // Send both signals to the overlay backend. Backends that don't
            // need a separate level (e.g. egui subprocess) get a no-op on
            // send_audio_level; the webview forwards it as `overlay://audio-level`.
            {
                let overlay_guard = overlay.lock().await;
                overlay_guard.send_audio_level(audio_level);
                overlay_guard.send_spectrum_bins(spectrum);
            }

            count += 1;

            // Use select to respond to cancellation during sleep
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    tracing::info!("Audio level polling cancelled during sleep after {} iterations", count);
                    break;
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(POLL_INTERVAL_MS as u64)) => {}
            }
        }

        // Loop exited (recording stopped OR token cancelled). The
        // overlay's React side only updates bars on incoming events,
        // and smoothing (theme-engine/renderers/smoothing.ts) decays
        // toward the target only when a new event arrives — a SINGLE
        // silence frame would leave bars frozen at ~70% of their last
        // value forever. Emit a short burst of zeros so the smoothing
        // curve naturally decays the bars + peak-ticks back to idle
        // min-height.
        //
        // ~12 frames × 80 ms = 0.96 s of decay — long enough for
        // alpha=0.3 smoothing to reach <1% of the peak value.
        //
        // NB: we deliberately IGNORE `cancel_token` here. The token
        // is set by `on_hotkey_released` BEFORE the main loop bails,
        // so re-checking it would short-circuit the burst on every
        // normal stop (which is the common case). The burst is
        // short, idempotent, and only stops if a fresh recording
        // restarts (`recorder.is_recording()` flips back to true).
        let zeros = [0.0f32; crate::audio::SPECTRUM_BARS];
        for _ in 0..12 {
            if recorder.is_recording() {
                // A new recording started while we were decaying —
                // its own polling loop will overwrite our zeros, so
                // bail out instead of fighting it.
                tracing::debug!("silence burst aborted: new recording started");
                break;
            }
            {
                let overlay_guard = overlay.lock().await;
                overlay_guard.send_audio_level(0.0);
                overlay_guard.send_spectrum_bins(zeros);
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay_native::NoopOverlay;

    // ---- Spectrum log throttle (pure, no task/loop) -----------------

    #[test]
    fn should_log_spectrum_fires_at_multiples_of_interval() {
        // 5000ms / 80ms = 62 (integer division) polls between log lines.
        assert!(should_log_spectrum(0, POLL_INTERVAL_MS, SPECTRUM_LOG_INTERVAL_MS));
        assert!(!should_log_spectrum(1, POLL_INTERVAL_MS, SPECTRUM_LOG_INTERVAL_MS));
        assert!(!should_log_spectrum(61, POLL_INTERVAL_MS, SPECTRUM_LOG_INTERVAL_MS));
        assert!(should_log_spectrum(62, POLL_INTERVAL_MS, SPECTRUM_LOG_INTERVAL_MS));
        assert!(should_log_spectrum(124, POLL_INTERVAL_MS, SPECTRUM_LOG_INTERVAL_MS));
    }

    #[test]
    fn should_log_spectrum_at_most_one_line_per_five_seconds() {
        // Over a simulated 10 h stuck recording (450_000 polls @ 80ms), the
        // number of log lines must stay near "total duration / 5s", not
        // "total duration / 80ms" (the pre-fix behavior that produced
        // 87_053 of 87_097 lines).
        let total_polls = (10 * 3600 * 1000) / POLL_INTERVAL_MS; // ~450_000
        let logged = (0..total_polls)
            .filter(|&c| should_log_spectrum(c, POLL_INTERVAL_MS, SPECTRUM_LOG_INTERVAL_MS))
            .count() as u32;
        // `every` truncates (5000/80 = 62, not 62.5), so the real period is
        // 62 * 80ms = 4960ms, slightly under the nominal 5s — the bound must
        // be derived from the same truncated integer division the
        // implementation uses, not the idealized 5000ms period, or this
        // assertion is tighter than the code actually guarantees.
        let every = SPECTRUM_LOG_INTERVAL_MS / POLL_INTERVAL_MS;
        let expected_max = total_polls / every + 1;
        assert!(
            logged <= expected_max,
            "logged {logged} lines, expected at most {expected_max} (one per ~5s)"
        );
        assert!(logged < total_polls / 10, "throttle did not meaningfully reduce log volume");
    }

    #[test]
    fn should_log_spectrum_never_divides_by_zero_poll_interval() {
        // Defensive: a misconfigured poll_ms=0 must not panic (div-by-zero).
        assert!(should_log_spectrum(0, 0, SPECTRUM_LOG_INTERVAL_MS));
    }

    #[tokio::test]
    async fn test_polling_stops_when_not_recording() {
        let recorder = Arc::new(AudioRecorder::new());
        let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
            Arc::new(Mutex::new(Box::new(NoopOverlay::new())));
        let cancel_token = CancellationToken::new();

        // Recorder is not recording, so polling should stop immediately
        start_audio_level_polling(Arc::clone(&recorder), Arc::clone(&overlay), cancel_token);

        // Wait a bit for the task to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // No assertion needed - we just verify it doesn't panic
    }

    #[tokio::test]
    async fn test_polling_stops_on_cancellation() {
        let recorder = Arc::new(AudioRecorder::new());
        let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
            Arc::new(Mutex::new(Box::new(NoopOverlay::new())));
        let cancel_token = CancellationToken::new();

        // Start polling
        start_audio_level_polling(
            Arc::clone(&recorder),
            Arc::clone(&overlay),
            cancel_token.clone(),
        );

        // Cancel immediately
        cancel_token.cancel();

        // Wait a bit for the task to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Should stop without issues
    }

    #[tokio::test]
    async fn test_multiple_polling_with_cancellation() {
        // Test that starting polling multiple times with proper cancellation works
        let recorder = Arc::new(AudioRecorder::new());
        let overlay: Arc<Mutex<Box<dyn OverlayBackend>>> =
            Arc::new(Mutex::new(Box::new(NoopOverlay::new())));

        // Start multiple polling tasks with separate tokens
        let token1 = CancellationToken::new();
        let token2 = CancellationToken::new();
        let token3 = CancellationToken::new();

        start_audio_level_polling(Arc::clone(&recorder), Arc::clone(&overlay), token1.clone());
        token1.cancel(); // Cancel before starting next

        start_audio_level_polling(Arc::clone(&recorder), Arc::clone(&overlay), token2.clone());
        token2.cancel();

        start_audio_level_polling(Arc::clone(&recorder), Arc::clone(&overlay), token3.clone());
        token3.cancel();

        // Wait for tasks to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        // Should not panic or deadlock
    }

    #[test]
    fn test_arc_clone_for_polling() {
        // Test that Arc cloning works correctly
        let recorder = Arc::new(AudioRecorder::new());
        let cloned = Arc::clone(&recorder);

        assert!(Arc::ptr_eq(&recorder, &cloned));
    }

    #[test]
    fn test_cancellation_token_clone() {
        // Test that CancellationToken can be cloned and both clones work
        let token = CancellationToken::new();
        let token_clone = token.clone();

        assert!(!token.is_cancelled());
        assert!(!token_clone.is_cancelled());

        token.cancel();

        assert!(token.is_cancelled());
        assert!(token_clone.is_cancelled());
    }
}
