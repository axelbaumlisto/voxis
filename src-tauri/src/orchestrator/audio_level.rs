//! Audio level polling for overlay spectrum visualization.
//!
//! SRP: This module handles audio level polling and overlay updates only.
//! Uses FFT-based spectrum analysis for Winamp-style frequency visualization.

use crate::audio::{AudioRecorder, SpectrumAnalyzer};
use crate::overlay_native::OverlayBackend;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

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

            if count % 5 == 0 {
                // Log peak frequency for debugging
                let peak_bar = spectrum
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                tracing::info!(
                    "Spectrum [{}]: {} samples, peak bar {}, max {:.3}",
                    count,
                    samples.len(),
                    peak_bar,
                    spectrum.iter().cloned().fold(0.0f32, f32::max)
                );
            }

            // Derive scalar audio level for webview overlays (peak of spectrum).
            // SRP: spectrum analyzer keeps owning FFT math; this is just a
            // collapse to a single visualizer input that NSPanel/webview needs.
            let audio_level = spectrum.iter().cloned().fold(0.0f32, f32::max).min(1.0);

            // Send both signals to the overlay backend. Backends that don't
            // need a separate level (e.g. egui subprocess) get a no-op on
            // send_audio_level; NSPanel forwards it as `overlay://audio-level`.
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
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(80)) => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay_native::NoopOverlay;

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
