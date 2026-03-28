use crate::audio::stream::{spawn_recording_thread, RecordCommand};
use crate::audio::sync::lock_or_recover;
use crate::audio::TRANSCRIPTION_SAMPLE_RATE;
use crate::audio::{downsample, get_device, list_devices, samples_to_wav, AudioDevice, AudioError};
use cpal::traits::DeviceTrait;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

pub struct AudioRecorder {
    is_recording: Arc<AtomicBool>,
    is_ready: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<f32>>>,
    audio_level: Arc<AtomicU32>,
    sample_rate: Arc<AtomicU32>,
    audio_boost: Arc<AtomicU32>,
    stop_tx: Mutex<Option<mpsc::Sender<RecordCommand>>>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
}

impl Default for AudioRecorder {
    fn default() -> Self {
        Self::new()
    }
}

// Safe because all shared state is Arc/Mutex and stream stays on the recording thread.
unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            is_ready: Arc::new(AtomicBool::new(false)),
            samples: Arc::new(Mutex::new(Vec::new())),
            audio_level: Arc::new(AtomicU32::new(0)),
            sample_rate: Arc::new(AtomicU32::new(44100)),
            audio_boost: Arc::new(AtomicU32::new(8000)),
            stop_tx: Mutex::new(None),
            thread_handle: Mutex::new(None),
        }
    }

    pub fn set_audio_boost(&self, boost: f32) {
        let boost_u32 = (boost * 10.0).clamp(100.0, 10000.0) as u32;
        self.audio_boost.store(boost_u32, Ordering::SeqCst);
    }

    pub fn get_audio_boost(&self) -> f32 {
        self.audio_boost.load(Ordering::SeqCst) as f32 / 10.0
    }

    pub fn list_devices() -> Result<Vec<AudioDevice>, AudioError> {
        list_devices()
    }

    pub fn start(&self, device_id: &str) -> Result<(), AudioError> {
        if self.is_recording.load(Ordering::SeqCst) {
            return Ok(());
        }

        self.clear_samples();

        #[cfg(target_os = "macos")]
        {
            if self.try_resume_recording() {
                return Ok(());
            }
        }

        let (device, config) = self.get_device_config(device_id)?;
        let rx = self.setup_stop_channel();
        let handle = spawn_recording_thread(
            device,
            config,
            rx,
            Arc::clone(&self.samples),
            Arc::clone(&self.audio_level),
            Arc::clone(&self.audio_boost),
            Arc::clone(&self.is_recording),
            Arc::clone(&self.is_ready),
        );

        let mut thread_handle = lock_or_recover(&self.thread_handle);
        *thread_handle = Some(handle);
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn try_resume_recording(&self) -> bool {
        if !self.is_ready.load(Ordering::SeqCst) {
            return false;
        }

        let stop_tx = lock_or_recover(&self.stop_tx);
        if let Some(ref tx) = *stop_tx {
            if tx.send(RecordCommand::Play).is_ok() {
                drop(stop_tx);
                for _ in 0..100 {
                    if self.is_recording.load(Ordering::SeqCst) {
                        return true;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }
        }
        false
    }

    fn clear_samples(&self) {
        let mut samples = lock_or_recover(&self.samples);
        samples.clear();
    }

    fn get_device_config(
        &self,
        device_id: &str,
    ) -> Result<(cpal::Device, cpal::SupportedStreamConfig), AudioError> {
        let device = get_device(device_id)?;
        let config = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            device.default_input_config()
        }))
        .map_err(|_| {
            AudioError::ConfigError(
                "Cannot access microphone. Grant permission in System Settings.".into(),
            )
        })?
        .map_err(|e| AudioError::ConfigError(e.to_string()))?;

        self.sample_rate
            .store(config.sample_rate().0, Ordering::SeqCst);
        Ok((device, config))
    }

    fn setup_stop_channel(&self) -> mpsc::Receiver<RecordCommand> {
        let (tx, rx) = mpsc::channel::<RecordCommand>();
        let mut stop_tx = lock_or_recover(&self.stop_tx);
        *stop_tx = Some(tx);
        rx
    }

    #[cfg(target_os = "macos")]
    fn send_pause_command(&self) {
        let stop_tx = lock_or_recover(&self.stop_tx);
        if let Some(ref tx) = *stop_tx {
            let _ = tx.send(RecordCommand::Pause);
        }
    }

    fn join_recording_thread(&self) {
        let mut thread_handle = lock_or_recover(&self.thread_handle);
        if let Some(handle) = thread_handle.take() {
            let _ = handle.join();
        }
    }

    fn clear_stop_sender(&self) {
        let mut stop_tx = lock_or_recover(&self.stop_tx);
        *stop_tx = None;
    }

    fn get_samples(&self) -> Vec<f32> {
        let samples_guard = lock_or_recover(&self.samples);
        samples_guard.clone()
    }

    pub fn stop(&self) -> Result<Vec<u8>, AudioError> {
        if !self.is_recording.load(Ordering::SeqCst) {
            return Err(AudioError::NotRecording);
        }

        #[cfg(target_os = "macos")]
        self.stop_macos_pause();

        #[cfg(not(target_os = "macos"))]
        self.stop_linux();

        let samples = self.get_samples();
        let sample_rate = self.sample_rate.load(Ordering::SeqCst);

        let (final_samples, final_rate) = if sample_rate > TRANSCRIPTION_SAMPLE_RATE {
            (
                downsample(&samples, sample_rate, TRANSCRIPTION_SAMPLE_RATE),
                TRANSCRIPTION_SAMPLE_RATE,
            )
        } else {
            (samples, sample_rate)
        };

        samples_to_wav(&final_samples, final_rate)
    }

    #[cfg(target_os = "macos")]
    fn stop_macos_pause(&self) {
        self.send_pause_command();

        let start = std::time::Instant::now();
        let timeout = if self.is_ready.load(Ordering::SeqCst) {
            std::time::Duration::from_millis(500)
        } else {
            std::time::Duration::from_secs(3)
        };

        while self.is_recording.load(Ordering::SeqCst) {
            if start.elapsed() > timeout {
                break;
            }
            std::thread::yield_now();
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn stop_linux(&self) {
        let stop_tx = lock_or_recover(&self.stop_tx);
        if let Some(ref tx) = *stop_tx {
            let _ = tx.send(RecordCommand::Close);
        }
        drop(stop_tx);

        self.join_recording_thread();
        self.clear_stop_sender();
    }

    pub fn close(&self) {
        self.send_close_command();
        self.join_recording_thread();
        self.clear_stop_sender();
    }

    fn send_close_command(&self) {
        let stop_tx = lock_or_recover(&self.stop_tx);
        if let Some(ref tx) = *stop_tx {
            let _ = tx.send(RecordCommand::Close);
        }
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    pub fn audio_level(&self) -> u32 {
        self.audio_level.load(Ordering::SeqCst)
    }

    pub fn get_recent_samples(&self, count: usize) -> Vec<f32> {
        let samples_guard = lock_or_recover(&self.samples);
        let len = samples_guard.len();
        if len >= count {
            samples_guard[len - count..].to_vec()
        } else {
            samples_guard.clone()
        }
    }
}

#[cfg(test)]
mod tests;
