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
// - `ios`: `tauri_plugin_voxis::init_ios()` (Task 8/8.5, `target_os =
//   "ios"` builds only) -- real Swift `AVAudioEngine` capture +
//   `Keychain` `SecretStore` via `mobile.rs`'s `run_mobile_plugin`
//   bridge. Prompts for microphone permission (`AVAudioApplication.
//   requestRecordPermission`) on first use; host-min's own iOS project
//   init (`tauri ios init`, `NSMicrophoneUsageDescription`, dev signing)
//   is Task 8.5, not this file.
//
// STT endpoint / API key: two paths now coexist (Task 6b closes plan gate
// 7 -- "profile round-trip in host-min" -- by adding the SECOND one):
// - **profile import** (`VOXIS_SMOKE_IMPORT=1`, new): calls the REAL
//   `import_profile_from_desktop` command (Task 6) at startup, which
//   populates `PluginState.pipeline_config`/`SecretStore` from whatever
//   Voxis-desktop-format config dir `VOXIS_DESKTOP_CONFIG_DIR` resolves to
//   (`VOXIS_SMOKE_SEED_DESKTOP_DIR`, below, is how this same binary can
//   also WRITE that dir first, for a self-contained smoke scenario with no
//   real Voxis desktop install needed). Prints `IMPORT_SUMMARY <json>` (or
//   `IMPORT_ERROR <debug>`) so the smoke script can assert on it. Host-min
//   does NOT also reach into `pipeline_config`/`secrets` directly for this
//   path -- the whole point of gate 7 is that the profile itself is the
//   only source of `api_url_override`/the API key here.
// - **env fallback** (`VOXIS_STT_URL`/`VOXIS_API_KEY`, reaching directly
//   into the plugin's already-`pub` `PluginState.pipeline_config`/
//   `secrets` fields from this host's own `setup` hook): the ORIGINAL
//   Task 3.5 wiring, from before `import_profile_from_desktop` existed.
//   Kept as the exception path for the two cases that have no desktop
//   profile to import from at all -- `VOXIS_SMOKE_IMPORT` unset:
//   - CI's `mock:<wav>` scenarios (`speech`/`silence`/`speech-streamdied`),
//     which point at a `voxis-fake-stt` instance that no desktop profile
//     could name in advance (its port is only known at CI runtime).
//   - a real `VOXIS_CAPTURE=cpal` hardware run against a real Groq key,
//     when the operator hasn't set up `import_profile_from_desktop`
//     against a real installed Voxis first.
//   - `VOXIS_STT_URL`: written into `PipelineConfig.app_config.
//     api_url_override` (exactly what `pipeline::run_transcription` reads
//     to build its `TranscriptionClient`).
//   - `VOXIS_API_KEY`: seeded into the plugin's own `SecretStore` under
//     `pipeline::API_KEY_SECRET_NAME` -- for the mock/CI path any
//     non-empty string works (`voxis-fake-stt` never checks the bearer
//     token); the real HUMAN GATE run sets this to a real Groq key.
// - `VOXIS_SILENCE_TIMEOUT_MS` (default 3000, applied regardless of which
//   of the two paths above ran): `AppConfig::silence_timeout_ms` is
//   60_000 by default -- far longer than this tracer bullet's 17s
//   `silence.wav`/real silence gate ever waits, so host-min always
//   shortens it; not a secret/endpoint, so this one small override stays
//   unconditional either way.
//
// `VOXIS_SMOKE_SEED_DESKTOP_DIR=<dir>` (smoke-only, Task 6b's own
// `profile-import` scenario): before building the plugin at all, writes a
// Voxis-desktop-format config dir at `<dir>` using voxis-core's OWN
// storage writers (`ConfigSqliteStorage::save`, `DictionaryStorage::add`,
// `ProvidersStorage::add` -- exactly what a real desktop install's own
// code produces, see `seed_desktop_config_dir` below). Pair this with
// setting `VOXIS_DESKTOP_CONFIG_DIR` to the SAME directory (which
// `import_profile_from_desktop`/`voxis_core::storage::paths::
// voxis_desktop_config_dir()` already honours) and `VOXIS_SMOKE_IMPORT=1`
// to import it back. `VOXIS_SMOKE_SEED_STT_URL` sets the seeded config's
// `api_url_override` (the smoke script points this at whichever
// `voxis-fake-stt` port it started for that run).
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
use tauri_plugin_voxis::models::{Mode, LEVEL_EVENT, RESULT_EVENT, STATE_EVENT};
use tauri_plugin_voxis::pipeline::API_KEY_SECRET_NAME;
use tauri_plugin_voxis::PluginState;
use voxis_core::profile::Secret;
use voxis_core::storage::{ConfigSqliteStorage, DictionaryStorage as CoreDictionaryStorage, LlmProvider, ProvidersStorage};

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

/// `VOXIS_SMOKE_SEED_DESKTOP_DIR=<dir>` (Task 6b's own `profile-import`
/// smoke scenario): writes a Voxis-desktop-format config dir at `dir`
/// using voxis-core's OWN storage writers -- the exact same construction
/// `profile_source.rs`'s own `#[cfg(test)] DesktopFixture::seed` test
/// helper uses, just from host-min's real binary instead of a unit test,
/// so `import_profile_from_desktop` (pointed here via
/// `VOXIS_DESKTOP_CONFIG_DIR`) has a real config/dictionary/providers
/// database to read. Fixed values (not configurable via env, KISS -- this
/// smoke scenario needs exactly one dictionary entry/provider, not an
/// arbitrary set) other than `stt_url`, which must be dynamic (the
/// smoke script only learns `voxis-fake-stt`'s port at runtime):
/// - `audio_device: "Mock Device"` -- Task 6b's own `[HW-GATE finding]`
///   acceptance value.
/// - dictionary: `разблюдовка = ПРОФИЛЬ` -- rewrites one word of
///   `fixtures/audio/speech.wav`'s fixed `voxis-fake-stt` transcript
///   ("...сегодняшняя разблюдовка."), so the smoke script can assert the
///   `RESULT_EVENT` text actually went through the IMPORTED dictionary,
///   not just an empty one.
/// - one custom (non-builtin) LLM provider -- proves `llm.providers` made
///   the round trip too (`IMPORT_SUMMARY.llmProviders` reflects it).
fn seed_desktop_config_dir(dir: &Path, stt_url: Option<&str>) {
    let mut config = voxis_core::config::AppConfig {
        api_key: "voxis-smoke-desktop-api-key".to_string(),
        audio_device: "Mock Device".to_string(),
        ..voxis_core::config::AppConfig::default()
    };
    if let Some(url) = stt_url {
        config.api_url_override = Some(url.to_string());
    }
    ConfigSqliteStorage::new(dir.join("config.db"))
        .save(&config)
        .expect("VOXIS_SMOKE_SEED_DESKTOP_DIR: seeding config.db");

    CoreDictionaryStorage::new(dir.join("dictionary.txt"))
        .add("разблюдовка", "ПРОФИЛЬ")
        .expect("VOXIS_SMOKE_SEED_DESKTOP_DIR: seeding dictionary.txt");

    let providers = ProvidersStorage::new(dir.join("providers.db"));
    providers.get_all().expect("VOXIS_SMOKE_SEED_DESKTOP_DIR: seeding providers.db (builtins)");
    providers
        .add(&LlmProvider {
            id: "smoke-desktop-provider".to_string(),
            name: "Smoke Desktop Provider".to_string(),
            api_url: "https://example.invalid/v1".to_string(),
            models: vec![],
            default_model: "model-x".to_string(),
            builtin: false,
        })
        .expect("VOXIS_SMOKE_SEED_DESKTOP_DIR: seeding providers.db (custom provider)");
}

/// Task 8.5: iOS builds need a library target (`staticlib`/`cdylib`) with a
/// `#[tauri::mobile_entry_point]`-tagged entry function -- `main.rs` (the
/// actual `[[bin]]`, desktop-only per Tauri's own mobile convention) just
/// calls this. Desktop keeps running the exact same `main()` body it always
/// did, just renamed/relocated -- no behaviour change for `cargo run -p
/// host-min`/`scripts/host-min-smoke.sh`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Task 6b: seeding must happen before ANYTHING reads
    // `VOXIS_DESKTOP_CONFIG_DIR` (the plugin's own `setup` hook, below,
    // via `import_profile_from_desktop`) -- do it first, synchronously,
    // before `tauri::Builder` is even constructed.
    if let Ok(seed_dir) = std::env::var("VOXIS_SMOKE_SEED_DESKTOP_DIR") {
        let seed_stt_url = std::env::var("VOXIS_SMOKE_SEED_STT_URL").ok();
        seed_desktop_config_dir(Path::new(&seed_dir), seed_stt_url.as_deref());
    }

    let capture_mode = std::env::var("VOXIS_CAPTURE").unwrap_or_else(|_| "mock".to_string());
    let stt_url = std::env::var("VOXIS_STT_URL").ok();
    let api_key = std::env::var("VOXIS_API_KEY").ok();
    let smoke_import = std::env::var("VOXIS_SMOKE_IMPORT").is_ok();
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
    // Task 8.5: the `mock_script_len*WINDOW_MS` scheduling below only
    // applies to the `mock:<wav>` capture (its own known, fixed replay
    // length) -- a real backend (`cpal`/`ios`) has no such fixed length,
    // so a scripted SPEECH scenario against a REAL microphone (Simulator
    // passthrough/iPad mic, `docs/PLUGIN_IOS_HOST.md`'s own device
    // checklist) needs an explicit, capture-mode-agnostic override to stop
    // after a fixed wall-clock delay instead of never stopping at all.
    let smoke_stop_after_ms: Option<u64> =
        std::env::var("VOXIS_SMOKE_STOP_AFTER_MS").ok().and_then(|v| v.parse().ok());
    let mut mock_script_len: Option<usize> = None;

    let mut builder = tauri::Builder::default();
    builder = if let Some(fixture_path) = capture_mode.strip_prefix("mock:") {
        let (capture, script_len) = scripted_mock_capture(PathBuf::from(fixture_path));
        mock_script_len = Some(script_len);
        builder.plugin(tauri_plugin_voxis::init_with_capture(capture))
    } else if capture_mode.starts_with("cpal") {
        // `desktop` feature/`init_desktop` is only linked for
        // `not(target_os = "ios")` builds (Task 8.5's own `Cargo.toml`
        // split: iOS pulls in no cpal/rdev at all) -- `VOXIS_CAPTURE=cpal`
        // on an iOS build is a misconfiguration, same shape as the
        // `ios`-on-desktop panic just below.
        #[cfg(not(target_os = "ios"))]
        {
            builder.plugin(tauri_plugin_voxis::init_desktop())
        }
        #[cfg(target_os = "ios")]
        {
            panic!("VOXIS_CAPTURE=cpal is only available when host-min itself is built for a desktop target (use VOXIS_CAPTURE=ios instead)");
        }
    } else if capture_mode.starts_with("ios") {
        // Task 8.5's own tracer bullet (iOS Simulator/iPad-stand, real
        // `AVAudioEngine` + Keychain via `mobile.rs`): `cfg`-gated the
        // same way `tauri_plugin_voxis::init_desktop` itself is gated
        // behind the `desktop` Cargo feature, except here it's a target
        // gate (iOS's Swift bridge only exists for `target_os = "ios"`,
        // not a Cargo feature this host toggles) -- `VOXIS_CAPTURE=ios`
        // on any other target falls through to the `mock`/`init()`
        // branch below instead of failing to compile.
        #[cfg(target_os = "ios")]
        {
            builder.plugin(tauri_plugin_voxis::init_ios())
        }
        #[cfg(not(target_os = "ios"))]
        {
            panic!("VOXIS_CAPTURE=ios is only available when host-min itself is built for target_os = \"ios\" (Task 8.5)");
        }
    } else {
        builder.plugin(tauri_plugin_voxis::init())
    };

    builder = builder.setup(move |app| {
        let state = app.state::<PluginState>();

        state.pipeline_config.lock().unwrap().app_config.silence_timeout_ms = silence_timeout_ms;

        if smoke_import {
            // The real `import_profile_from_desktop` command (Task 6) --
            // no direct reach into `pipeline_config`/`secrets` for this
            // path; see the module doc's "STT endpoint / API key" section.
            match tauri_plugin_voxis::commands::import_profile_from_desktop(app.state::<PluginState>()) {
                Ok(summary) => println!(
                    "IMPORT_SUMMARY {}",
                    serde_json::to_string(&summary).expect("serializing ImportSummary")
                ),
                Err(e) => println!("IMPORT_ERROR {e:?}"),
            }
        } else {
            // Env fallback -- see the module doc's "STT endpoint / API
            // key" section for exactly which scenarios still take this
            // path (mock-CI fixtures with no desktop profile to import,
            // or a real `VOXIS_CAPTURE=cpal` hardware run).
            let key = api_key.clone().unwrap_or_else(|| "voxis-fake-stt-dummy-key".to_string());
            state.secrets.set(API_KEY_SECRET_NAME, &Secret::new(key)).expect("seeding SecretStore api key");
            if let Some(url) = &stt_url {
                state.pipeline_config.lock().unwrap().app_config.api_url_override = Some(url.clone());
            }
        }

        if smoke_autostart {
            // The smoke script drives `start()` directly (no webview JS
            // runs `setConsent(true)` for it) -- grant consent the same
            // way `main.js`'s own startup call would, straight through
            // the plugin's already-`pub` `ConsentStore` field.
            state.consent.set_consent(&state.host_id, &state.provider_host, true).expect("granting smoke-mode consent");
            install_smoke_listeners(app);
            if std::env::var("VOXIS_SMOKE_LOG_LEVELS").is_ok() {
                install_level_summary_listener(app);
            }
            let app_handle = app.handle().clone();
            let stop_after_ms = if smoke_no_stop {
                None
            } else if let Some(fixed_ms) = smoke_stop_after_ms {
                Some(fixed_ms)
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
    // `voxis://level` is deliberately NOT subscribed here by default --
    // one print per 250ms poll would flood the log for no assertion this
    // smoke test needs. `VOXIS_SMOKE_LOG_LEVELS=1` opts into
    // `install_level_summary_listener` below instead (Task 8.5's own
    // evidence-gathering need: "level ticks observed (rms values
    // logged)" for the Simulator/iPad real-mic runs).
}

/// Task 8.5 (`VOXIS_SMOKE_LOG_LEVELS=1`, opt-in): prints every
/// `voxis://level` tick as a `LEVEL_EVENT <json>` line -- unlike
/// `install_smoke_listeners`'s `RESULT_EVENT`/`STATE_EVENT` pair (fired
/// once per session), this one fires every ~250ms poll for as long as a
/// session is recording, so it stays opt-in rather than always-on.
fn install_level_summary_listener<R: tauri::Runtime>(app: &tauri::App<R>) {
    app.listen(LEVEL_EVENT, |event| {
        println!("LEVEL_EVENT {}", event.payload());
    });
}
