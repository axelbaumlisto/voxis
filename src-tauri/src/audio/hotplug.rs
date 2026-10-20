//! macOS audio-device hotplug: a NORMAL event, not an error.
//!
//! A USB microphone that blinks (unplug/replug, hub reset, sleep) comes back
//! as a NEW CoreAudio device. `AudioRecorder`'s always-on stream stays bound
//! to the OLD device object, which CoreAudio keeps alive: callbacks keep
//! arriving and every sample is 0.0 (2026-10-20, BY-V: `deactivating device
//! 9079` → `activating device 10198`, then every take was digital silence
//! until the app was restarted).
//!
//! The cure is not to report this to the user — the device is fine — but to
//! notice the re-enumeration and let the NEXT `start()` open the current
//! device by name. This module is that notice: one system-level listener on
//! `kAudioHardwarePropertyDevices`, one process-wide latch.
//!
//! Scope: `AudioObjectAddPropertyListener` + a plain C callback (no blocks,
//! no new crates). Registration is idempotent (`Once`) and the listener is
//! never removed — it lives as long as the process, which is also the
//! lifetime of the thing it protects.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;

/// Set by the CoreAudio listener, cleared by whoever acts on it.
static DEVICES_CHANGED: AtomicBool = AtomicBool::new(false);
static ARM: Once = Once::new();

/// Did the OS re-enumerate audio devices since the last call? Consumes the
/// latch (the caller is expected to drop its stale stream immediately).
pub(crate) fn take_device_change() -> bool {
    arm();
    DEVICES_CHANGED.swap(false, Ordering::SeqCst)
}

/// Pure decision seam: a paused always-on stream must be dropped (not
/// resumed) when the device list changed under it. Extracted so the rule is
/// testable without CoreAudio.
pub(crate) fn must_rebind(devices_changed: bool, stream_ready: bool) -> bool {
    devices_changed && stream_ready
}

fn arm() {
    ARM.call_once(|| unsafe {
        use std::os::raw::{c_uint, c_void};

        type AudioObjectID = c_uint;
        type OSStatus = i32;
        type ListenerProc = unsafe extern "C" fn(
            AudioObjectID,
            c_uint,
            *const AudioObjectPropertyAddress,
            *mut c_void,
        ) -> OSStatus;

        #[repr(C)]
        struct AudioObjectPropertyAddress {
            selector: c_uint,
            scope: c_uint,
            element: c_uint,
        }

        extern "C" {
            fn AudioObjectAddPropertyListener(
                object: AudioObjectID,
                address: *const AudioObjectPropertyAddress,
                listener: Option<ListenerProc>,
                data: *mut c_void,
            ) -> OSStatus;
        }

        const fn fourcc(code: &[u8; 4]) -> c_uint {
            ((code[0] as c_uint) << 24)
                | ((code[1] as c_uint) << 16)
                | ((code[2] as c_uint) << 8)
                | (code[3] as c_uint)
        }

        const K_AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;
        // 'dev#' — kAudioHardwarePropertyDevices
        const K_AUDIO_HARDWARE_PROPERTY_DEVICES: c_uint = fourcc(b"dev#");
        // 'glob' — kAudioObjectPropertyScopeGlobal
        const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: c_uint = fourcc(b"glob");
        // kAudioObjectPropertyElementMain
        const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: c_uint = 0;

        unsafe extern "C" fn on_devices_changed(
            _object: AudioObjectID,
            _n: c_uint,
            _addresses: *const AudioObjectPropertyAddress,
            _data: *mut c_void,
        ) -> OSStatus {
            // Runs on a CoreAudio thread: latch only, no locks, no allocation.
            DEVICES_CHANGED.store(true, Ordering::SeqCst);
            0
        }

        let address = AudioObjectPropertyAddress {
            selector: K_AUDIO_HARDWARE_PROPERTY_DEVICES,
            scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };
        let status = AudioObjectAddPropertyListener(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &address,
            Some(on_devices_changed),
            std::ptr::null_mut(),
        );
        if status != 0 {
            // Not fatal: without the listener we fall back to the recording
            // guard's digital-silence stop (2 s) instead of a silent rebind.
            tracing::warn!(status, "AudioObjectAddPropertyListener(devices) failed — hotplug rebind unavailable, the 2 s digital-silence guard still applies");
        } else {
            tracing::info!("audio hotplug: listening for device-list changes (stale always-on streams will be rebound)");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_only_forces_a_rebind_when_a_stream_is_actually_ready() {
        assert!(must_rebind(true, true));
        assert!(!must_rebind(true, false), "nothing open: the next start opens fresh anyway");
        assert!(!must_rebind(false, true), "no change: keep the fast Pause/Play resume");
    }

    #[test]
    fn the_latch_is_consumed_once() {
        DEVICES_CHANGED.store(true, Ordering::SeqCst);
        assert!(take_device_change(), "first reader sees the change");
        assert!(!take_device_change(), "and it is consumed, so the next start() resumes normally");
    }
}
