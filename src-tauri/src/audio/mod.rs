//! Audio recording module using cpal.
//!
//! Provides low-latency audio capture for voice dictation.
//! KISS: `mod.rs` is a facade with focused submodules.

mod devices;
mod encoder;
mod error;
mod level;
mod recorder;
mod stream;
mod sync;
pub mod vad;

pub use devices::{get_device, list_devices, AudioDevice};
pub use encoder::{downsample, samples_to_wav, TRANSCRIPTION_SAMPLE_RATE};
pub use error::AudioError;
pub use level::{SpectrumAnalyzer, SPECTRUM_BARS};
pub use recorder::AudioRecorder;
