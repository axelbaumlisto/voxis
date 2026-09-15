// `host-min`: the minimal Tauri 2 host embedding `tauri-plugin-voxis`
// (Task 4's own manual verification harness; Task 3.5 builds its
// tracer-bullet CI-path/real-mic wiring on top of it -- see this
// crate's own README.md for the exact run commands).
//
// Capture backend selection via `VOXIS_CAPTURE` (the switch lives here
// in host-min, not the plugin -- plan Task 4 step 2):
// - unset or `mock` (default): `tauri_plugin_voxis::init()` -- a plain,
//   unscripted `MockCapture`. No real microphone/hotkey involved.
// - `mock:<path-to-wav>`: a `MockCapture` scripted from the WAV fixture
//   (`wav_to_level_script`, per-250ms RMS/peak windows -- the same
//   cadence `voxis_core::config::GUARD_POLL_MS` polls at) via
//   `tauri_plugin_voxis::init_with_capture`, ticked once every 250ms by
//   a background thread for as long as the backend is running, and
//   `set_fixture_wav` so `stop()` copies the WAV's own bytes to the
//   session path -- the pipeline then uploads REAL bytes, so
//   `voxis-fake-stt`'s sha256 lookup matches this exact fixture.
// - `cpal`: `tauri_plugin_voxis::init_desktop()` -- real `CpalCapture` +
//   `RdevHotkey`. Prompts for microphone permission on first use.
//
// STT endpoint / API key (Task 3.5's own "no new plugin command" path,
// per the plan's step text: read `pipeline.rs`'s `PipelineDeps` and
// reach into the plugin's already-`pub` `PluginState` fields directly
// from this host's own `setup` hook instead of a new
// `apply_profile`/`get_profile` call -- those two remain
// `PluginError::NotImplemented` stubs until Task 2/6/7):
// - `VOXIS_STT_URL`: written into `PipelineConfig.app_config.
//   api_url_override` (exactly what `pipeline::run_transcription` reads
//   to build its `TranscriptionClient`) -- point this at a running
//   `voxis-fake-stt` for the CI/mock path.
// - `VOXIS_API_KEY`: seeded into the plugin's own `SecretStore` under
//   `pipeline::API_KEY_SECRET_NAME` -- for the mock/CI path any
//   non-empty string works (`voxis-fake-stt` never checks the bearer
//   token); the real HUMAN GATE run sets this to a real Groq key.
// - `VOXIS_SILENCE_TIMEOUT_MS` (default 3000): `AppConfig::
//   silence_timeout_ms` is 60_000 by default -- far longer than this
//   tracer bullet's 17s `silence.wav`/real silence gate ever waits, so
//   host-min always shortens it (real desktop Voxis's own configured
//   value would normally reach the plugin via `apply_profile`, Task
//   2/6/7 -- until then, host-min picks a sane fixed default itself).
//
// `VOXIS_SMOKE_AUTOSTART=1` (read only by `scripts/host-min-smoke.sh`):
// starts a `Mode::Toggle` session ~300ms after boot and prints every
// `voxis://result`/`voxis://state` event to stdout as `RESULT_EVENT
// <json>` / `STATE_EVENT <json>` lines -- the smoke script's real-binary
// assertion point (no browser/webview driver involved). The session
// itself ends on its own: once the scripted `MockCapture`'s ticks run
// out (the WAV finishes "playing"), the guard's own liveness check
// reports `StreamDied` a moment later and the pipeline finalizes exactly
// like any other stop trigger; a genuinely silent fixture instead
// self-triggers `SilenceTimeoutNoSpeech` well before that point.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tauri::{Listener, Manager};

use tauri_plugin_voxis::capture::{AudioCapture, LevelSample, MockCapture};
use tauri_plugin_voxis::models::{Mode, RESULT_EVENT, STATE_EVENT};
use tauri_plugin_voxis::pipeline::API_KEY_SECRET_NAME;
use tauri_plugin_voxis::PluginState;
use voxis_core::profile::Secret;

/// Matches `voxis_core::config::GUARD_POLL_MS` -- the guard's own poll
/// cadence -- so a scripted `MockCapture` drives exactly the same
/// silence/liveness decisions a real backend would for the same audio.
const WINDOW_MS: u32 = 250;

/// Matches `voxis_fake_stt::silence_gen::SilenceGenParams::sub_chunk_ms`'s
/// default -- see that module's `windowed_peak_rms` doc comment for why
/// the guard's own `peak` field is the MAX of several small sub-chunk
/// RMS values within a 250ms window (`desktop.rs`'s real
/// `WindowPeakAccumulator`), not the window's own overall RMS: using the
/// latter here would systematically under-report how "peaky" a fixture
/// reads to the guard, silently drifting from what a real capture
/// backend would decide for the same audio.
const SUB_CHUNK_MS: u32 = 10;

/// Decodes a WAV file (any channel count/bit depth `hound` supports)
/// into per-`WINDOW_MS` RMS/peak windows for `MockCapture::set_script`.
fn wav_to_level_script(path: &Path) -> Vec<LevelSample> {
    let mut reader = hound::WavReader::open(path)
        .unwrap_or_else(|e| panic!("VOXIS_CAPTURE mock fixture {}: {e}", path.display()));
    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader.samples::<i32>().map(|s| s.unwrap() as f32 / max).collect()
        }
        hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap()).collect(),
    };
    let channels = spec.channels.max(1) as usize;
    let mono: Vec<f32> = if channels == 1 {
        samples
    } else {
        samples.chunks(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32).collect()
    };
    let sample_rate = spec.sample_rate;
    let samples_per_window = ((WINDOW_MS as u64 * sample_rate as u64) / 1000).max(1) as usize;
    let window_rms = |chunk: &[f32]| -> f32 {
        let sum_sq: f64 = chunk.iter().map(|&s| (s as f64) * (s as f64)).sum();
        (sum_sq / chunk.len() as f64).sqrt() as f32
    };
    let samples_per_sub_chunk = ((SUB_CHUNK_MS as u64 * sample_rate as u64) / 1000).max(1) as usize;
    mono.chunks(samples_per_window)
        .map(|window| {
            let peak = window.chunks(samples_per_sub_chunk).map(window_rms).fold(0f32, f32::max);
            let rms = window_rms(window);
            LevelSample::new(rms, peak)
        })
        .collect()
}

/// Builds a `MockCapture` scripted from `fixture_path` and spawns the
/// background ticking thread that replays it in real time -- see the
/// module doc's `VOXIS_CAPTURE=mock:<path>` section. Returns the script
/// length too (`smoke_autostart`'s own "stop after the WAV finishes
/// playing" scheduling needs it).
///
/// **One session per process**: this `MockCapture` is scripted exactly
/// once, at startup, from a single fixture -- `set_script` loads a
/// `VecDeque` that `tick()` drains and never refills. A *second*
/// `start()`/`stop()` cycle in the same `host-min` process would find an
/// empty script (every subsequent tick a silent no-op, indistinguishable
/// from `StreamDied`/no signal at all) rather than replaying the fixture
/// again. Fine for this tracer bullet (`host-min-smoke.sh` always starts
/// a fresh process per scenario) -- a host wanting a re-armable scripted
/// mock across multiple sessions would need to re-`set_script` on every
/// `start()`, which this constructor deliberately does not attempt (KISS
/// for what Task 3.5 actually needs).
fn scripted_mock_capture(fixture_path: PathBuf) -> (Arc<dyn AudioCapture>, usize) {
    let mock = Arc::new(MockCapture::new());
    let script = wav_to_level_script(&fixture_path);
    let script_len = script.len();
    mock.set_script(script);
    mock.set_fixture_wav(fixture_path);

    let ticking_mock = mock.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(WINDOW_MS as u64));
        // `AudioCapture::level_rx` is a `tokio::sync::watch` channel
        // (coalescing by design, see that trait's own doc comment): if
        // the guard's 250ms poll loop is ever descheduled for longer
        // than one tick (a loaded CI runner, a debugger pause), the
        // NEXT poll only ever observes the LATEST `tick()`'s sample --
        // any samples ticked in between are silently dropped, never
        // queued. That is the correct behaviour for a live level meter
        // (a stale queued sample would be a lie about "now"), but it
        // does mean this thread's own real-time cadence is a best
        // effort, not a delivery guarantee -- `smoke_autostart`'s
        // `script_len * WINDOW_MS` duration estimate below is
        // approximate for the same reason.
        ticking_mock.tick();
    });

    (mock, script_len)
}

fn main() {
    let capture_mode = std::env::var("VOXIS_CAPTURE").unwrap_or_else(|_| "mock".to_string());
    let stt_url = std::env::var("VOXIS_STT_URL").ok();
    let api_key = std::env::var("VOXIS_API_KEY").ok();
    let silence_timeout_ms: u32 =
        std::env::var("VOXIS_SILENCE_TIMEOUT_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(3_000);
    let smoke_autostart = std::env::var("VOXIS_SMOKE_AUTOSTART").is_ok();
    // REJECT-FIX F2: by default, `smoke_autostart` schedules an explicit
    // `stop()` call `script_len * WINDOW_MS + 500`ms after `start()` --
    // i.e. shortly after the scripted WAV "finishes playing" but well
    // before the ~1s `StreamDied` liveness threshold would fire on its
    // own -- so the NORMAL stop path (`ExternalStop` ->
    // `GuardOutcome::Finalized`) is what most scenarios actually
    // exercise, matching what a real UI's Stop button would trigger.
    // `VOXIS_SMOKE_NO_STOP=1` disables that scheduled stop so a scenario
    // can instead exercise the liveness/`StreamDied` recovery path on
    // purpose (`host-min-smoke.sh`'s `speech-streamdied` scenario) --
    // silence fixtures are unaffected either way, since the guard's own
    // `SilenceTimeoutNoSpeech` always fires first and the (still
    // scheduled) stop then lands on an already-ended session, a harmless
    // no-op/`UnknownSession`.
    let smoke_no_stop = std::env::var("VOXIS_SMOKE_NO_STOP").is_ok();
    let mut mock_script_len: Option<usize> = None;

    let mut builder = tauri::Builder::default();
    builder = if let Some(fixture_path) = capture_mode.strip_prefix("mock:") {
        let (capture, script_len) = scripted_mock_capture(PathBuf::from(fixture_path));
        mock_script_len = Some(script_len);
        builder.plugin(tauri_plugin_voxis::init_with_capture(capture))
    } else if capture_mode.starts_with("cpal") {
        builder.plugin(tauri_plugin_voxis::init_desktop())
    } else {
        builder.plugin(tauri_plugin_voxis::init())
    };

    builder = builder.setup(move |app| {
        let state = app.state::<PluginState>();

        // STT URL / API key: seeded directly into the plugin's already-
        // `pub` `PluginState` fields (`pipeline_config`/`secrets`) --
        // see the module doc for why this isn't `apply_profile`.
        let key = api_key.clone().unwrap_or_else(|| "voxis-fake-stt-dummy-key".to_string());
        state.secrets.set(API_KEY_SECRET_NAME, &Secret::new(key)).expect("seeding SecretStore api key");
        {
            let mut cfg = state.pipeline_config.lock().unwrap();
            cfg.app_config.silence_timeout_ms = silence_timeout_ms;
            if let Some(url) = &stt_url {
                cfg.app_config.api_url_override = Some(url.clone());
            }
        }

        if smoke_autostart {
            // The smoke script drives `start()` directly (no webview JS
            // runs `setConsent(true)` for it) -- grant consent the same
            // way `main.js`'s own startup call would, straight through
            // the plugin's already-`pub` `ConsentStore` field.
            state.consent.set_consent(&state.host_id, &state.provider_host, true).expect("granting smoke-mode consent");
            install_smoke_listeners(app);
            let app_handle = app.handle().clone();
            let stop_after_ms = if smoke_no_stop {
                None
            } else {
                mock_script_len.map(|n| (n as u64) * WINDOW_MS as u64 + 500)
            };
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                let state = app_handle.state::<PluginState>();
                match tauri_plugin_voxis::commands::start(state, Mode::Toggle).await {
                    Ok(id) => {
                        println!("SMOKE_STARTED {}", id.as_str());
                        if let Some(delay_ms) = stop_after_ms {
                            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                            let state = app_handle.state::<PluginState>();
                            match tauri_plugin_voxis::commands::stop(state, id).await {
                                Ok(_) => println!("SMOKE_STOPPED"),
                                // Harmless if the session already ended on
                                // its own (e.g. a silence fixture's
                                // `SilenceTimeoutNoSpeech` firing before
                                // this scheduled stop lands) -- the
                                // `RESULT_EVENT` from that natural ending
                                // already fired.
                                Err(e) => println!("SMOKE_STOP_ERROR {e:?}"),
                            }
                        }
                    }
                    Err(e) => println!("SMOKE_START_ERROR {e:?}"),
                }
            });
        }

        Ok(())
    });

    builder.run(tauri::generate_context!()).expect("error while running host-min");
}

/// Prints every `voxis://result`/`voxis://state` event to stdout as
/// parseable `RESULT_EVENT <json>` / `STATE_EVENT <json>` lines --
/// `scripts/host-min-smoke.sh`'s only observation point into the real
/// binary (no webview/browser driver involved).
fn install_smoke_listeners<R: tauri::Runtime>(app: &tauri::App<R>) {
    app.listen(RESULT_EVENT, |event| {
        println!("RESULT_EVENT {}", event.payload());
    });
    app.listen(STATE_EVENT, |event| {
        println!("STATE_EVENT {}", event.payload());
    });
    // `voxis://level` is deliberately NOT subscribed here -- one print
    // per 250ms poll would flood the log for no assertion this smoke
    // test needs.
}
