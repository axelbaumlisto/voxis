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
    #[error("Recording thread error: {0}")]
    ThreadError(String),
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
