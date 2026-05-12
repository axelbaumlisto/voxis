//! Apple Intelligence integration for on-device LLM post-processing.
//!
//! Uses macOS Foundation Models framework (macOS 26.0+ / Apple Silicon) via
//! Swift FFI bridge compiled in build.rs. On non-macOS or non-aarch64 targets,
//! stubs return `false` / `Err` so the module is always importable.
//!
//! Design (OCP): exposes a standalone API today; a future `LlmProvider` trait
//! implementation can wrap these functions without modifying them.

// ---------------------------------------------------------------------------
// Real implementation — macOS aarch64 only
// ---------------------------------------------------------------------------
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod inner {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};

    /// FFI response struct — must match `AppleLLMResponse` in the bridge header.
    #[repr(C)]
    pub struct AppleLLMResponse {
        pub response: *mut c_char,
        pub success: c_int,
        pub error_message: *mut c_char,
    }

    extern "C" {
        fn is_apple_intelligence_available() -> c_int;
        fn process_text_with_system_prompt_apple(
            system_prompt: *const c_char,
            user_content: *const c_char,
            max_tokens: i32,
        ) -> *mut AppleLLMResponse;
        fn free_apple_llm_response(response: *mut AppleLLMResponse);
    }

    /// Returns `true` when Apple Intelligence is available at runtime.
    pub fn check_availability() -> bool {
        unsafe { is_apple_intelligence_available() == 1 }
    }

    /// Process text through the on-device LLM.
    ///
    /// * `system_prompt` – instruction context (e.g. "fix grammar")
    /// * `user_content`  – the transcription to post-process
    /// * `max_tokens`    – approximate word-count limit (0 = unlimited)
    pub fn process_text(
        system_prompt: &str,
        user_content: &str,
        max_tokens: i32,
    ) -> Result<String, String> {
        let sys = CString::new(system_prompt).map_err(|e| e.to_string())?;
        let usr = CString::new(user_content).map_err(|e| e.to_string())?;

        let ptr =
            unsafe { process_text_with_system_prompt_apple(sys.as_ptr(), usr.as_ptr(), max_tokens) };

        if ptr.is_null() {
            return Err("Null response from Apple Intelligence".into());
        }

        let resp = unsafe { &*ptr };

        let result = if resp.success == 1 {
            if resp.response.is_null() {
                Ok(String::new())
            } else {
                Ok(unsafe { CStr::from_ptr(resp.response) }
                    .to_string_lossy()
                    .into_owned())
            }
        } else {
            let msg = if resp.error_message.is_null() {
                "Unknown Apple Intelligence error".to_string()
            } else {
                unsafe { CStr::from_ptr(resp.error_message) }
                    .to_string_lossy()
                    .into_owned()
            };
            Err(msg)
        };

        unsafe { free_apple_llm_response(ptr) };
        result
    }
}

// ---------------------------------------------------------------------------
// Stub implementation — every other platform
// ---------------------------------------------------------------------------
#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
mod inner {
    /// Always `false` on non-Apple-Silicon platforms.
    pub fn check_availability() -> bool {
        false
    }

    /// Always returns `Err` on non-Apple-Silicon platforms.
    pub fn process_text(
        _system_prompt: &str,
        _user_content: &str,
        _max_tokens: i32,
    ) -> Result<String, String> {
        Err("Apple Intelligence is only available on macOS Apple Silicon".into())
    }
}

// ---------------------------------------------------------------------------
// Public re-exports (platform-agnostic API)
// ---------------------------------------------------------------------------

/// Check whether Apple Intelligence is available on this device.
pub fn is_available() -> bool {
    inner::check_availability()
}

/// Post-process text through Apple's on-device LLM.
///
/// Returns the improved text on success, or a human-readable error string.
pub fn process_text_with_system_prompt(
    system_prompt: &str,
    user_content: &str,
    max_tokens: i32,
) -> Result<String, String> {
    inner::process_text(system_prompt, user_content, max_tokens)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_availability_does_not_panic() {
        // Must not panic on any platform — returns bool.
        let _available = is_available();
    }

    #[test]
    fn test_process_text_does_not_panic() {
        // Must not panic even when unavailable — returns Result.
        let result = process_text_with_system_prompt("fix grammar", "hello world", 0);
        // On non-Apple-Silicon this is always Err; on Apple Silicon it depends
        // on runtime availability. Either way, no panic.
        let _ = result;
    }

    #[test]
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    fn test_stub_returns_false() {
        assert!(!is_available());
    }

    #[test]
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    fn test_stub_returns_err() {
        let result = process_text_with_system_prompt("sys", "usr", 100);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("only available on macOS Apple Silicon"));
    }
}
