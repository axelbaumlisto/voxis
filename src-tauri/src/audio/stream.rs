use crate::audio::level::process_chunk;
use crate::audio::sync::lock_or_recover;
use crate::audio::AudioError;
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, StreamConfig};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;

/// Command to control recording thread.
pub(crate) enum RecordCommand {
    /// Resume/start recording.
    #[cfg(target_os = "macos")]
    Play,
    /// Pause the stream (keeps it open for fast restart).
    #[cfg(target_os = "macos")]
    Pause,
    /// Close the stream and exit the thread.
    Close,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_recording_thread(
    device: cpal::Device,
    config: cpal::SupportedStreamConfig,
    rx: mpsc::Receiver<RecordCommand>,
    samples: Arc<Mutex<Vec<f32>>>,
    audio_level: Arc<AtomicU32>,
    audio_boost: Arc<AtomicU32>,
    is_recording: Arc<AtomicBool>,
    is_ready: Arc<AtomicBool>,
) -> JoinHandle<()> {
    let stream_config: StreamConfig = config.clone().into();
    let channels = stream_config.channels as usize;
    let sample_format = config.sample_format();

    is_recording.store(true, Ordering::SeqCst);
    is_ready.store(false, Ordering::SeqCst);

    thread::spawn(move || {
        let stream = match build_and_play_stream(
            sample_format,
            device,
            &stream_config,
            samples,
            audio_level.clone(),
            audio_boost.clone(),
            channels,
            &is_recording,
            &is_ready,
        ) {
            Some(s) => s,
            None => return,
        };

        run_command_loop(rx, &stream, &audio_level, &is_recording);
    })
}

/// Build the audio stream and start playback, handling cpal panics.
/// Returns `Some(stream)` on success, or `None` if an error occurred
/// (with `is_recording` set to false).
#[allow(clippy::too_many_arguments)] // Audio stream setup requires all parameters
fn build_and_play_stream(
    sample_format: SampleFormat,
    device: cpal::Device,
    stream_config: &StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    audio_level: Arc<AtomicU32>,
    audio_boost: Arc<AtomicU32>,
    channels: usize,
    is_recording: &AtomicBool,
    is_ready: &AtomicBool,
) -> Option<cpal::Stream> {
    // Wrap build_stream_for_format in catch_unwind to handle cpal panics
    // when microphone permission is denied
    let stream_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        build_stream_for_format(
            sample_format,
            &device,
            stream_config,
            samples,
            audio_level.clone(),
            audio_boost.clone(),
            channels,
        )
    }));

    // Drop device early - we don't need it after stream is created.
    // On macOS, device drop can take 200-400ms due to CoreAudio cleanup,
    // so letting it go out of scope while recording (instead of during stop)
    // prevents the delay from affecting stop() latency.
    let _ = device;

    let stream = match stream_result {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            eprintln!("Failed to build stream: {}", e);
            is_recording.store(false, Ordering::SeqCst);
            return None;
        }
        Err(_) => {
            eprintln!("Audio system panic - microphone permission denied?");
            is_recording.store(false, Ordering::SeqCst);
            return None;
        }
    };

    // Wrap stream.play() in catch_unwind as it can also panic without permissions
    let play_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| stream.play()));

    match play_result {
        Ok(Ok(())) => {
            is_ready.store(true, Ordering::SeqCst);
        }
        Ok(Err(e)) => {
            eprintln!("Failed to play stream: {}", e);
            is_recording.store(false, Ordering::SeqCst);
            return None;
        }
        Err(_) => {
            eprintln!("Audio playback panic - microphone permission denied?");
            is_recording.store(false, Ordering::SeqCst);
            return None;
        }
    }

    Some(stream)
}

/// Run the command loop: handle Pause/Play/Close commands on the recording thread.
///
/// On macOS, this loops to handle Pause/Play/Close commands (stream pause/resume).
/// On other platforms, Pause/Play are not supported so we just wait for Close.
#[allow(unused_variables)] // `stream` is used on macOS for pause/play
pub(crate) fn run_command_loop(
    rx: mpsc::Receiver<RecordCommand>,
    stream: &cpal::Stream,
    audio_level: &AtomicU32,
    is_recording: &AtomicBool,
) {
    #[cfg(target_os = "macos")]
    loop {
        match rx.recv() {
            Ok(RecordCommand::Pause) => {
                // Set is_recording to false BEFORE pause() so stop() returns quickly
                audio_level.store(0, Ordering::SeqCst);
                is_recording.store(false, Ordering::SeqCst);

                // Pause stream - fast on macOS, keeps stream alive for quick restart
                let _ = stream.pause();
                // Continue loop - thread stays alive for fast restart
            }
            Ok(RecordCommand::Play) => {
                // Resume recording
                is_recording.store(true, Ordering::SeqCst);
                let _ = stream.play();
            }
            Ok(RecordCommand::Close) | Err(_) => {
                // Close: exit thread (stream will be dropped by caller)
                audio_level.store(0, Ordering::SeqCst);
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        }
    }

    // On non-macOS: no Pause/Play support, just wait for Close (or channel drop).
    #[cfg(not(target_os = "macos"))]
    {
        let _ = rx.recv();
        audio_level.store(0, Ordering::SeqCst);
        is_recording.store(false, Ordering::SeqCst);
    }
}

/// Build audio stream for the detected sample format.
/// KISS: Dispatches to generic build_stream based on format.
fn build_stream_for_format(
    format: SampleFormat,
    device: &cpal::Device,
    config: &StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    audio_level: Arc<AtomicU32>,
    audio_boost: Arc<AtomicU32>,
    channels: usize,
) -> Result<cpal::Stream, AudioError> {
    match format {
        SampleFormat::F32 => {
            build_stream::<f32>(device, config, samples, audio_level, audio_boost, channels)
        }
        SampleFormat::I16 => {
            build_stream::<i16>(device, config, samples, audio_level, audio_boost, channels)
        }
        SampleFormat::U16 => {
            build_stream::<u16>(device, config, samples, audio_level, audio_boost, channels)
        }
        _ => Err(AudioError::StreamError("Unsupported sample format".into())),
    }
}

/// Build audio stream for a specific sample type.
fn build_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    audio_level: Arc<AtomicU32>,
    audio_boost: Arc<AtomicU32>,
    channels: usize,
) -> Result<cpal::Stream, AudioError>
where
    T: cpal::Sample + cpal::SizedSample,
    f32: FromSample<T>,
{
    let err_fn = |err| eprintln!("Audio stream error: {}", err);

    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let mut samples_guard = lock_or_recover(&samples);
                process_chunk(
                    data,
                    channels,
                    &mut samples_guard,
                    &audio_level,
                    &audio_boost,
                );
            },
            err_fn,
            None,
        )
        .map_err(|e| AudioError::StreamError(e.to_string()))
}
