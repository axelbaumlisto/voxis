//! Audio device listing.

use super::error::AudioError;
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::Device;
use std::panic;

/// Safely get cpal host, catching any panics (e.g., permission denied on macOS).
fn safe_default_host() -> Result<cpal::Host, AudioError> {
    panic::catch_unwind(cpal::default_host).map_err(|_| {
        AudioError::ConfigError(
            "Cannot access audio system. Please grant microphone permission in System Settings."
                .into(),
        )
    })
}

/// Audio device info for UI display.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// List available audio input devices.
///
/// On Linux, uses `arecord -L` for human-readable names (same as Python).
/// Falls back to cpal if arecord is not available.
pub fn list_devices() -> Result<Vec<AudioDevice>, AudioError> {
    // Try platform-specific method first
    #[cfg(target_os = "linux")]
    {
        if let Ok(devices) = list_devices_arecord() {
            if !devices.is_empty() {
                return Ok(devices);
            }
        }
    }

    // Fallback to cpal
    list_devices_cpal()
}

/// List devices using cpal (cross-platform fallback).
/// Uses catch_unwind to protect against cpal panics when microphone permission is denied.
fn list_devices_cpal() -> Result<Vec<AudioDevice>, AudioError> {
    let host = safe_default_host()?;

    // Wrap in catch_unwind - these calls can panic without microphone permission
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
        let default_device = host.default_input_device();
        let default_name = default_device.as_ref().and_then(|d| d.name().ok());

        let devices: Vec<AudioDevice> = host
            .input_devices()
            .ok()?
            .filter_map(|device| {
                let id = device.name().ok()?;
                let is_default = default_name.as_ref() == Some(&id);
                Some(AudioDevice {
                    id: id.clone(),
                    name: id,
                    is_default,
                })
            })
            .collect();

        if devices.is_empty() {
            None
        } else {
            Some(devices)
        }
    }));

    match result {
        Ok(Some(devices)) => Ok(devices),
        Ok(None) => Err(AudioError::NoInputDevices),
        Err(_) => Err(AudioError::ConfigError(
            "Microphone permission required. Please grant access in System Settings.".into(),
        )),
    }
}

/// List devices using arecord -L (Linux only, gives human-readable names).
#[cfg(target_os = "linux")]
fn list_devices_arecord() -> Result<Vec<AudioDevice>, AudioError> {
    use std::process::Command;

    let output = Command::new("arecord")
        .arg("-L")
        .output()
        .map_err(|e| AudioError::ConfigError(format!("arecord failed: {}", e)))?;

    if !output.status.success() {
        return Err(AudioError::ConfigError("arecord returned error".into()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut devices = Vec::new();
    let mut current_id: Option<String> = None;

    for line in stdout.lines() {
        if !line.starts_with(' ') && !line.starts_with('\t') {
            // Device ID line (not indented)
            current_id = Some(line.trim().to_string());
        } else if let Some(ref id) = current_id {
            // Description line (indented)
            let name = line.trim().to_string();
            // Filter for useful devices (same logic as Python)
            if id == "default"
                || id == "pulse"
                || id == "pipewire"
                || id.starts_with("hw:")
                || id.starts_with("plughw:")
                || id.starts_with("sysdefault:")
            {
                let is_default = id == "default";
                devices.push(AudioDevice {
                    id: id.clone(),
                    name,
                    is_default,
                });
            }
            current_id = None;
        }
    }

    Ok(devices)
}

/// Get device by name, or default if "default" or not found.
/// Uses catch_unwind to protect against cpal panics when microphone permission is denied.
pub fn get_device(device_id: &str) -> Result<Device, AudioError> {
    let host = safe_default_host()?;
    let device_id_owned = device_id.to_string();

    // Wrap in catch_unwind - these calls can panic without microphone permission
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
        if device_id_owned == "default" {
            return host.default_input_device();
        }

        // Try to find by name
        if let Ok(mut devices) = host.input_devices() {
            if let Some(device) = devices.find(|d| d.name().ok().as_ref() == Some(&device_id_owned))
            {
                return Some(device);
            }
        }

        // Fallback to default
        host.default_input_device()
    }));

    match result {
        Ok(Some(device)) => Ok(device),
        Ok(None) => Err(AudioError::NoInputDevices),
        Err(_) => Err(AudioError::ConfigError(
            "Microphone permission required. Please grant access in System Settings.".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_device_serialization() {
        let device = AudioDevice {
            id: "hw:0,0".to_string(),
            name: "Built-in Microphone".to_string(),
            is_default: true,
        };

        let json = serde_json::to_string(&device).unwrap();
        assert!(json.contains("Built-in Microphone"));
        assert!(json.contains("is_default"));

        let parsed: AudioDevice = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, device.name);
        assert_eq!(parsed.is_default, device.is_default);
    }

    #[test]
    fn test_list_devices() {
        // This test runs on real hardware, so behavior depends on system
        match list_devices() {
            Ok(devices) => {
                println!("Found {} audio devices:", devices.len());
                for d in &devices {
                    println!("  - id={}, name={}, default={}", d.id, d.name, d.is_default);
                }
                // At least one device should be marked as default
                let has_default = devices.iter().any(|d| d.is_default);
                if !devices.is_empty() {
                    assert!(has_default, "Should have at least one default device");
                }
            }
            Err(AudioError::NoInputDevices) => {
                println!("No input devices found (expected on headless systems)");
            }
            Err(e) => {
                panic!("Unexpected error listing devices: {}", e);
            }
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_list_devices_arecord() {
        // Test arecord parsing on Linux
        match list_devices_arecord() {
            Ok(devices) => {
                println!("arecord found {} devices:", devices.len());
                for d in &devices {
                    println!("  - id={}, name={}", d.id, d.name);
                }
                // Should have readable names, not ALSA codes
                for d in &devices {
                    // Names should be descriptions, not technical IDs
                    if d.id == "default" || d.id == "pulse" || d.id == "pipewire" {
                        assert!(!d.name.is_empty(), "Should have description");
                    }
                }
            }
            Err(e) => {
                println!("arecord not available: {}", e);
            }
        }
    }
}
