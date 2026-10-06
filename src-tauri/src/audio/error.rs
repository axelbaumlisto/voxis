//! Audio error types.

use thiserror::Error;

/// Audio recording errors.
#[derive(Error, Debug)]
pub enum AudioError {
    #[error("No input devices available")]
    NoInputDevices,
    #[error("Device not found: {0}")]
    DeviceNotFound(String),
    #[error("Failed to get default input config: {0}")]
    ConfigError(String),
    #[error("Failed to build stream: {0}")]
    StreamError(String),
    #[error("Failed to write WAV: {0}")]
    WavError(String),
    #[error("Recording not started")]
    NotRecording,
    /// A `stop()` call is already in flight (single-flight guard CAS
    /// failed). Distinct from `NotRecording` — the recorder IS recording
    /// (or was, a moment ago); another caller just got there first. See
    /// `AudioRecorder::stop()` / `StoppingGuard`.
    #[error("Stop already in progress")]
    StopInProgress,
    #[error("Recording thread error: {0}")]
    ThreadError(String),
    /// The input stream started without error and was held for `held_ms`,
    /// yet delivered not one buffer — the device behind it is gone or
    /// muted at the hardware level (a re-plugged USB mic, a Bluetooth mic
    /// that dropped). Surfaced as a user-facing error, never filed as a
    /// "too short" recording.
    #[error("Microphone delivered no audio for {}s — check the device or pick another one in Settings", held_ms / 1000)]
    NoAudioFromDevice { held_ms: u64 },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_error_messages() {
        let errors = vec![
            (AudioError::NoInputDevices, "No input devices"),
            (AudioError::DeviceNotFound("mic".into()), "mic"),
            (AudioError::ConfigError("config fail".into()), "config fail"),
            (AudioError::StreamError("stream fail".into()), "stream fail"),
            (AudioError::WavError("wav fail".into()), "wav fail"),
            (AudioError::NotRecording, "not started"),
            (AudioError::StopInProgress, "already in progress"),
            (AudioError::ThreadError("thread fail".into()), "thread fail"),
        ];

        for (error, expected_substr) in errors {
            let msg = error.to_string().to_lowercase();
            assert!(
                msg.contains(&expected_substr.to_lowercase()),
                "Error '{}' should contain '{}'",
                msg,
                expected_substr
            );
        }
    }
}
