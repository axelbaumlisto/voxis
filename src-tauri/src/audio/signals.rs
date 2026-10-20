//! `StreamSignals` — everything the cpal input callback reports back to
//! `AudioRecorder` BESIDES the samples themselves (level, guard peak, cap,
//! liveness counters). One struct because they travel together through five
//! call layers: adding the next signal must not touch every signature
//! (2026-10-20: `nonzero_seen` did, and that was the review's point).
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize};
use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct StreamSignals {
    /// Boosted 0–100 level for the overlay visualizer.
    pub audio_level: Arc<AtomicU32>,
    /// Visualizer gain (tenths).
    pub audio_boost: Arc<AtomicU32>,
    /// Boost-independent peak RMS since the last drain — the guard's signal.
    pub rms_peak_bits: Arc<AtomicU32>,
    /// Soft cap on buffered samples.
    pub max_samples: Arc<AtomicUsize>,
    /// Set once the cap is reached.
    pub cap_hit: Arc<AtomicBool>,
    /// Input callbacks delivered by the CURRENT stream (liveness).
    pub callbacks: Arc<AtomicU64>,
    /// Set the moment any sample in this session is non-zero. A stream that
    /// re-enumerated under CoreAudio keeps calling back with exact zeros;
    /// "no callbacks" and "callbacks of digital silence" are the same dead
    /// device, and this is the half that survives a live IOProc.
    pub nonzero_seen: Arc<AtomicBool>,
}

impl Default for StreamSignals {
    fn default() -> Self {
        Self {
            audio_level: Arc::new(AtomicU32::new(0)),
            audio_boost: Arc::new(AtomicU32::new(0)),
            rms_peak_bits: Arc::new(AtomicU32::new(0)),
            // "No cap" — a derived Default would be 0 and silently drop every
            // sample, which is exactly the bug this struct is meant to avoid.
            max_samples: Arc::new(AtomicUsize::new(usize::MAX)),
            cap_hit: Arc::new(AtomicBool::new(false)),
            callbacks: Arc::new(AtomicU64::new(0)),
            nonzero_seen: Arc::new(AtomicBool::new(false)),
        }
    }
}
