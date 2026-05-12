//! Error handling utilities for Tauri commands.
//!
//! DRY: Provides IntoCommandError trait to replace repeated
//! `.map_err(|e| e.to_string())` patterns throughout the codebase.

/// Extension trait for converting Result<T, E> to Result<T, String>.
///
/// DRY: Replaces 20+ occurrences of `.map_err(|e| e.to_string())`.
///
/// # Example
/// ```ignore
/// use crate::error::IntoCommandError;
///
/// fn my_command() -> Result<(), String> {
///     some_operation().cmd_err()?;
///     Ok(())
/// }
/// ```
pub trait IntoCommandError<T> {
    /// Convert error to String for Tauri command return.
    fn cmd_err(self) -> Result<T, String>;
}

impl<T, E: std::error::Error> IntoCommandError<T> for Result<T, E> {
    fn cmd_err(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}

/// Extension trait for converting Result<T, Box<dyn Error>> to Result<T, String>.
pub trait BoxedIntoCommandError<T> {
    /// Convert boxed error to String for Tauri command return.
    fn cmd_err(self) -> Result<T, String>;
}

impl<T> BoxedIntoCommandError<T> for Result<T, Box<dyn std::error::Error>> {
    fn cmd_err(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}

impl<T> BoxedIntoCommandError<T> for Result<T, Box<dyn std::error::Error + Send + Sync>> {
    fn cmd_err(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[test]
    fn test_into_command_error_success() {
        let result: Result<i32, io::Error> = Ok(42);
        assert_eq!(result.cmd_err(), Ok(42));
    }

    #[test]
    fn test_into_command_error_failure() {
        let result: Result<i32, io::Error> =
            Err(io::Error::new(io::ErrorKind::NotFound, "file not found"));
        let cmd_result = result.cmd_err();
        assert!(cmd_result.is_err());
        assert!(cmd_result.unwrap_err().contains("file not found"));
    }

    #[test]
    fn test_boxed_error() {
        let result: Result<i32, Box<dyn std::error::Error>> =
            Err(Box::new(io::Error::other("boxed error")));
        let cmd_result = result.cmd_err();
        assert!(cmd_result.is_err());
        assert!(cmd_result.unwrap_err().contains("boxed error"));
    }
}
