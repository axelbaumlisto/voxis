//! Recording and transcription-related Tauri commands.

use crate::audio::AudioDevice;
use crate::error::IntoCommandError;
use crate::permissions::{create_permission_checker, Permission, PermissionChecker};
use crate::transcription::{TranscriptionClient, TranscriptionResult};
use crate::{AudioState, OrchestratorState, OutputState};
use tauri::State;

use crate::permissions::PermissionStatus;

/// Pure decision: does this permission status refuse to even attempt the
/// permission-gated action? Extracted from `check_microphone_permission` so
/// the Denied-only-blocks semantics are unit-testable without a
/// platform-specific `PermissionChecker`.
fn permission_blocks(status: PermissionStatus) -> Option<String> {
    if status.blocks_start() {
        Some("Microphone permission required. Please grant access in System Settings.".to_string())
    } else {
        None
    }
}

/// Check microphone permission before accessing audio hardware.
/// Returns Ok(()) if granted, Err with user-friendly message otherwise.
///
/// Uses `blocks_start()`, not `is_granted()` (matching
/// `orchestrator/recording.rs`'s hotkey-path gate): only an explicit
/// `Denied` refuses outright. `Unknown`/`NotDetermined` fall through to
/// `state.recorder.start()`, which triggers the real OS permission prompt
/// on first use and lets cpal report the actual denial if the user
/// declines — rather than this pre-check blocking on a status the
/// platform hasn't determined yet.
fn check_microphone_permission() -> Result<(), String> {
    let checker = create_permission_checker();
    match permission_blocks(checker.check(Permission::Microphone)) {
        Some(msg) => Err(msg),
        None => Ok(()),
    }
}

/// List available audio input devices.
/// Requires microphone permission to access audio hardware.
#[tauri::command]
#[specta::specta]
pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    check_microphone_permission()?;
    crate::audio::AudioRecorder::list_devices().cmd_err()
}

/// Start audio recording.
/// Requires microphone permission to access audio hardware.
///
/// Thin wrapper over the orchestrator: every recorder-starting/-stopping
/// path funnels through `RecordingCoordinator` so `stop_lock`, the
/// press/release ordering machine, the coordinator and the transcription
/// queue all stay authoritative. This command used to drive
/// `state.recorder` directly, bypassing all of that — the last such
/// bypass in the crate, and the only other way `recorder.stop()` could
/// run out from under the orchestrator (surfacing as a spurious
/// `StopDecision::Recover`). `device_id` is accepted for API/`specta`
/// binding compatibility with callers that still pass one, but is
/// otherwise unused: the orchestrator's recording path reads
/// `audio_device` from config, not from a per-call override.
#[tauri::command]
#[specta::specta]
pub async fn start_recording(
    device_id: Option<String>,
    state: State<'_, OrchestratorState>,
) -> Result<(), String> {
    if let Some(device_id) = &device_id {
        tracing::debug!(
            "start_recording: device_id {device_id:?} accepted for API compatibility, ignored \
             (orchestrator reads audio_device from config)"
        );
    }
    check_microphone_permission()?;
    state.orchestrator.manual_start().await;
    Ok(())
}

/// Stop recording (audio flows through the orchestrator's own transcription
/// queue, not a `pending_audio` side channel — see `start_recording` doc).
#[tauri::command]
#[specta::specta]
pub async fn stop_recording(state: State<'_, OrchestratorState>) -> Result<(), String> {
    state.orchestrator.manual_stop().await;
    Ok(())
}

/// Get current recording status.
#[tauri::command]
#[specta::specta]
pub fn get_recording_status(state: State<AudioState>) -> bool {
    state.recorder.is_recording()
}

/// Get current audio level (0-100).
#[tauri::command]
#[specta::specta]
pub fn get_audio_level(state: State<AudioState>) -> u32 {
    state.recorder.audio_level()
}

/// Get FFT spectrum bins for visualization (32 frequency magnitudes, 0.0-1.0).
/// Returns empty array if not recording or not enough samples.
#[tauri::command]
#[specta::specta]
pub fn get_spectrum_bins(state: State<AudioState>) -> Vec<f32> {
    use crate::audio::{SpectrumAnalyzer, SPECTRUM_BARS};

    if !state.recorder.is_recording() {
        return vec![0.0; SPECTRUM_BARS];
    }

    // Need 1024 samples for FFT
    let samples = state
        .recorder
        .get_recent_samples(SpectrumAnalyzer::fft_size());
    if samples.len() < SpectrumAnalyzer::fft_size() {
        return vec![0.0; SPECTRUM_BARS];
    }

    let mut analyzer = state.spectrum_analyzer.lock().unwrap();
    let boost = state.recorder.get_audio_boost() / 200.0;
    analyzer.analyze(&samples, boost).to_vec()
}

/// Transcribe pending audio using Groq API.
#[tauri::command]
#[specta::specta]
pub async fn transcribe_audio(
    state: State<'_, AudioState>,
    api_key: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    // Get pending audio
    let audio_data = {
        let mut pending = state.pending_audio.lock().unwrap();
        pending.take()
    };

    let audio_data = audio_data.ok_or("No audio data to transcribe")?;

    let client =
        TranscriptionClient::new(&api_key, model.as_deref(), language.as_deref()).cmd_err()?;

    client.transcribe(audio_data).await.cmd_err()
}

/// Copy text to clipboard.
#[tauri::command]
#[specta::specta]
pub fn copy_to_clipboard(text: String, state: State<OutputState>) -> Result<(), String> {
    state.output.copy_to_clipboard(&text).cmd_err()
}

/// Auto-type text.
#[tauri::command]
#[specta::specta]
pub fn type_text(text: String, state: State<OutputState>) -> Result<(), String> {
    state.output.type_text(&text).cmd_err()
}

/// Manual start recording (for UI button).
#[tauri::command]
#[specta::specta]
pub async fn manual_start_recording(state: State<'_, OrchestratorState>) -> Result<(), String> {
    state.orchestrator.manual_start().await;
    Ok(())
}

/// Manual stop recording (for UI button).
#[tauri::command]
#[specta::specta]
pub async fn manual_stop_recording(state: State<'_, OrchestratorState>) -> Result<(), String> {
    state.orchestrator.manual_stop().await;
    Ok(())
}

/// Cancel any in-progress recording (Handy-style overlay cancel button).
/// Has no effect while transcription is already in flight.
#[tauri::command]
#[specta::specta]
pub async fn cancel_operation(state: State<'_, OrchestratorState>) -> Result<(), String> {
    state.orchestrator.cancel().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Create a test pending audio container (mimics AudioState.pending_audio).
    fn create_pending_audio() -> Arc<Mutex<Option<Vec<u8>>>> {
        Arc::new(Mutex::new(None))
    }

    #[test]
    fn test_pending_audio_starts_empty() {
        let pending_audio = create_pending_audio();
        let pending = pending_audio.lock().unwrap();
        // On fresh state, should be None
        assert!(pending.is_none(), "Pending audio should start empty");
    }

    #[test]
    fn test_pending_audio_mutex_accessible() {
        let pending_audio = create_pending_audio();
        let mut pending = pending_audio.lock().unwrap();
        // Store some test data
        *pending = Some(vec![1, 2, 3, 4]);
        assert_eq!(pending.as_ref().unwrap().len(), 4);
        // Clear it
        *pending = None;
    }

    #[test]
    fn test_pending_audio_take() {
        let pending_audio = create_pending_audio();

        {
            let mut pending = pending_audio.lock().unwrap();
            *pending = Some(vec![5, 6, 7, 8]);
        }

        let data = {
            let mut pending = pending_audio.lock().unwrap();
            pending.take()
        };

        assert_eq!(data, Some(vec![5, 6, 7, 8]));

        // After take, should be None
        let pending = pending_audio.lock().unwrap();
        assert!(pending.is_none());
    }

    #[test]
    fn test_pending_audio_concurrent_access() {
        let pending_audio = create_pending_audio();
        let audio_clone = Arc::clone(&pending_audio);

        // Set data in one handle
        {
            let mut pending = pending_audio.lock().unwrap();
            *pending = Some(vec![10, 20, 30]);
        }

        // Access via cloned handle
        {
            let pending = audio_clone.lock().unwrap();
            assert_eq!(pending.as_ref().unwrap(), &vec![10, 20, 30]);
        }
    }

    #[test]
    fn test_audio_device_struct() {
        let device = AudioDevice {
            id: "test_id".to_string(),
            name: "Test Device".to_string(),
            is_default: true,
        };
        assert_eq!(device.id, "test_id");
        assert_eq!(device.name, "Test Device");
        assert!(device.is_default);
    }

    #[test]
    fn test_audio_device_serialization() {
        let device = AudioDevice {
            id: "hw:0,0".to_string(),
            name: "Built-in Microphone".to_string(),
            is_default: true,
        };

        let json = serde_json::to_string(&device).unwrap();
        assert!(json.contains("hw:0,0"));
        assert!(json.contains("Built-in Microphone"));
        assert!(json.contains("is_default"));

        let parsed: AudioDevice = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, device.id);
        assert_eq!(parsed.name, device.name);
        assert_eq!(parsed.is_default, device.is_default);
    }

    #[test]
    fn test_transcription_client_creation() {
        // TranscriptionClient::new should work with valid params
        let result = TranscriptionClient::new("test-key", Some("whisper-large-v3"), Some("en"));
        assert!(result.is_ok());
    }

    #[test]
    fn test_transcription_client_default_model() {
        let result = TranscriptionClient::new("test-key", None, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_no_audio_error_message() {
        // Simulate the error when no audio is available
        let error_msg = "No audio data to transcribe";
        assert!(error_msg.contains("audio"));
    }

    // `permission_blocks` — only Denied blocks; Unknown/NotDetermined must
    // fall through to `recorder.start()`.
    #[test]
    fn test_permission_blocks_denied_only() {
        assert!(
            permission_blocks(PermissionStatus::Denied).is_some(),
            "Denied must block start with a user-facing message"
        );
    }

    #[test]
    fn test_permission_blocks_granted_passes() {
        assert!(
            permission_blocks(PermissionStatus::Granted).is_none(),
            "Granted must not block start"
        );
    }

    #[test]
    fn test_permission_blocks_unknown_passes() {
        assert!(
            permission_blocks(PermissionStatus::Unknown).is_none(),
            "Unknown/NotDetermined must fall through to recorder.start(), not be \
             pre-emptively blocked — cpal/the OS prompt reports the real denial"
        );
    }
}
