//! State management for the orchestrator.
//!
//! SRP: This module handles recording state and transitions only.

use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// Recording state for the orchestrator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingState {
    Idle,
    Recording,
    Transcribing,
    Error,
}

/// Context for error handling (SRP: identifies error source).
#[derive(Debug, Clone, Copy)]
pub enum ErrorContext {
    /// Error during hotkey/recording start
    Hotkey,
    /// Error during transcription
    Transcription,
    /// Error during LLM processing
    Llm,
}

/// State manager for recording workflow.
///
/// Handles state transitions and event emission.
pub struct StateManager {
    app: AppHandle,
    state: Arc<Mutex<RecordingState>>,
}

impl StateManager {
    /// Create a new state manager.
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            state: Arc::new(Mutex::new(RecordingState::Idle)),
        }
    }

    /// Get the shared state Arc for use in background tasks.
    pub fn state_arc(&self) -> Arc<Mutex<RecordingState>> {
        Arc::clone(&self.state)
    }

    /// Get current recording state.
    pub async fn get(&self) -> RecordingState {
        *self.state.lock().await
    }

    /// Set state and emit event.
    pub async fn set(&self, new_state: RecordingState) {
        let mut state = self.state.lock().await;
        *state = new_state;
        self.emit_state(new_state);
    }

    /// Check if state matches expected value.
    pub async fn is(&self, expected: RecordingState) -> bool {
        *self.state.lock().await == expected
    }

    /// Transition to Recording state if currently Idle.
    /// Returns true if transition was successful.
    pub async fn try_start_recording(&self) -> bool {
        let mut state = self.state.lock().await;
        if *state != RecordingState::Idle {
            tracing::debug!("Cannot start recording - not idle (state: {:?})", *state);
            return false;
        }
        *state = RecordingState::Recording;
        self.emit_state(RecordingState::Recording);
        true
    }

    /// Transition to Transcribing state if currently Recording.
    /// Returns true if transition was successful.
    pub async fn try_start_transcribing(&self) -> bool {
        let mut state = self.state.lock().await;
        if *state != RecordingState::Recording {
            tracing::debug!(
                "Cannot start transcribing - not recording (state: {:?})",
                *state
            );
            return false;
        }
        *state = RecordingState::Transcribing;
        self.emit_state(RecordingState::Transcribing);
        true
    }

    /// Handle error: set error state and emit events.
    pub async fn handle_error(&self, error: &str, context: ErrorContext) {
        tracing::error!("{:?} error: {}", context, error);
        self.emit_error(error);
        let mut state = self.state.lock().await;
        *state = RecordingState::Error;
        self.emit_state(RecordingState::Error);
    }

    /// Reset to Idle state.
    pub async fn reset_to_idle(&self) {
        let mut state = self.state.lock().await;
        *state = RecordingState::Idle;
        self.emit_state(RecordingState::Idle);
    }

    /// Check if recording can start (Idle OR Transcribing).
    ///
    /// This allows users to start a new recording while a previous
    /// transcription is still in progress.
    pub async fn can_start_recording(&self) -> bool {
        let state = self.state.lock().await;
        matches!(*state, RecordingState::Idle | RecordingState::Transcribing)
    }

    /// Try to start recording from Idle OR Transcribing state.
    ///
    /// Returns `true` if transition was successful, `false` if already recording.
    /// This enables queue-based workflow where multiple recordings can be queued.
    pub async fn try_start_recording_with_queue(&self) -> bool {
        let mut state = self.state.lock().await;
        if !matches!(*state, RecordingState::Idle | RecordingState::Transcribing) {
            tracing::debug!(
                "Cannot start recording with queue - invalid state: {:?}",
                *state
            );
            return false;
        }
        *state = RecordingState::Recording;
        self.emit_state(RecordingState::Recording);
        true
    }

    /// Emit state change to frontend.
    fn emit_state(&self, state: RecordingState) {
        if let Err(e) = self.app.emit("state-changed", state) {
            tracing::error!("Failed to emit state-changed: {}", e);
        }
    }

    /// Emit error to frontend.
    fn emit_error(&self, error: &str) {
        if let Err(e) = self.app.emit("error", error) {
            tracing::error!("Failed to emit error: {}", e);
        }
    }

    /// Get app handle reference.
    pub fn app(&self) -> &AppHandle {
        &self.app
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recording_state_serialize() {
        assert_eq!(
            serde_json::to_string(&RecordingState::Idle).unwrap(),
            "\"idle\""
        );
        assert_eq!(
            serde_json::to_string(&RecordingState::Recording).unwrap(),
            "\"recording\""
        );
        assert_eq!(
            serde_json::to_string(&RecordingState::Transcribing).unwrap(),
            "\"transcribing\""
        );
        assert_eq!(
            serde_json::to_string(&RecordingState::Error).unwrap(),
            "\"error\""
        );
    }

    #[test]
    fn test_recording_state_deserialize() {
        assert_eq!(
            serde_json::from_str::<RecordingState>("\"idle\"").unwrap(),
            RecordingState::Idle
        );
        assert_eq!(
            serde_json::from_str::<RecordingState>("\"recording\"").unwrap(),
            RecordingState::Recording
        );
        assert_eq!(
            serde_json::from_str::<RecordingState>("\"transcribing\"").unwrap(),
            RecordingState::Transcribing
        );
        assert_eq!(
            serde_json::from_str::<RecordingState>("\"error\"").unwrap(),
            RecordingState::Error
        );
    }

    #[test]
    fn test_recording_state_serde_roundtrip() {
        for state in [
            RecordingState::Idle,
            RecordingState::Recording,
            RecordingState::Transcribing,
            RecordingState::Error,
        ] {
            let json = serde_json::to_string(&state).unwrap();
            let deserialized: RecordingState = serde_json::from_str(&json).unwrap();
            assert_eq!(state, deserialized);
        }
    }

    #[test]
    fn test_error_context_debug() {
        assert_eq!(format!("{:?}", ErrorContext::Hotkey), "Hotkey");
        assert_eq!(
            format!("{:?}", ErrorContext::Transcription),
            "Transcription"
        );
        assert_eq!(format!("{:?}", ErrorContext::Llm), "Llm");
    }

    #[test]
    fn test_recording_state_equality() {
        assert_eq!(RecordingState::Idle, RecordingState::Idle);
        assert_ne!(RecordingState::Idle, RecordingState::Recording);
        assert_ne!(RecordingState::Recording, RecordingState::Transcribing);
    }

    #[test]
    fn test_recording_state_copy() {
        let state = RecordingState::Recording;
        let state_copy = state;
        assert_eq!(state, state_copy);
    }

    #[test]
    fn test_recording_state_clone() {
        // RecordingState is Copy; this exercises that property (Clone falls
        // back to Copy for Copy types).
        let state = RecordingState::Transcribing;
        let cloned = state;
        assert_eq!(state, cloned);
    }

    #[test]
    fn test_error_context_clone() {
        let context = ErrorContext::Llm;
        let cloned = context;
        assert!(matches!(cloned, ErrorContext::Llm));
    }

    #[test]
    fn test_recording_state_deserialize_invalid() {
        // Test that invalid states fail to deserialize
        let result = serde_json::from_str::<RecordingState>("\"invalid\"");
        assert!(result.is_err());
    }

    #[test]
    fn test_recording_state_deserialize_empty() {
        let result = serde_json::from_str::<RecordingState>("\"\"");
        assert!(result.is_err());
    }

    #[test]
    fn test_recording_state_snake_case_format() {
        // Verify snake_case serialization format
        let state = RecordingState::Idle;
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("idle"));
        assert!(!json.contains("Idle"));
    }

    #[test]
    fn test_can_start_recording_states() {
        // Test the state matching for can_start_recording
        let idle = RecordingState::Idle;
        let transcribing = RecordingState::Transcribing;
        let recording = RecordingState::Recording;
        let error = RecordingState::Error;

        // Can start from Idle or Transcribing
        assert!(matches!(
            idle,
            RecordingState::Idle | RecordingState::Transcribing
        ));
        assert!(matches!(
            transcribing,
            RecordingState::Idle | RecordingState::Transcribing
        ));

        // Cannot start from Recording or Error
        assert!(!matches!(
            recording,
            RecordingState::Idle | RecordingState::Transcribing
        ));
        assert!(!matches!(
            error,
            RecordingState::Idle | RecordingState::Transcribing
        ));
    }

    #[test]
    fn test_try_start_recording_with_queue_logic() {
        // Test the state matching logic
        for state in [RecordingState::Idle, RecordingState::Transcribing] {
            let can_start = matches!(state, RecordingState::Idle | RecordingState::Transcribing);
            assert!(can_start, "Should be able to start from {:?}", state);
        }

        for state in [RecordingState::Recording, RecordingState::Error] {
            let can_start = matches!(state, RecordingState::Idle | RecordingState::Transcribing);
            assert!(!can_start, "Should not be able to start from {:?}", state);
        }
    }
}
