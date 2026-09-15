# T3.5 HUMAN GATE — headless variant (2026-09-15, MacBook Air built-in mic, real Groq)

Probe: temporary example `real_mic_probe.rs` (deleted after): real `CpalCapture` → WAV → real
`voxis_core::guard::guard_step` over the live level stream → real `TranscriptionClient` (Groq,
whisper-large-v3-turbo, ru). Speech played through the speakers (`afplay speech.aiff`); real room.

| Test | Result |
|---|---|
| A speech, 12 s | ticks=46, peak_rms=0.3879, ever_loud=true → Groq text (Russian), language=Russian |
| C silence, 22 s, silence_timeout 7000 | PreCutoffBeep @13.9 s; **Stop(SilenceTimeoutNoSpeech) @16.9 s**; max_peak=0.0130 < SILENCE_RMS 0.02; ever_loud=false; **HTTP skipped** |

Finding (hardware-only): `CpalCapture::new()` = system default input = **BY-V** lavalier (the device
behind the original incident) → 12 s of all-zero samples, 2 level ticks in 6.5 s, Groq hallucinated
"Продолжение следует…". Pinning `with_device_id("Микрофон MacBook Air")` fixed it. → Plan amendment:
plugin must select the input device from the profile (`audio_device`), not the OS default; revisit the
T2 decision that excluded `audio_device` from `ProfileConfig`.

Not covered headless (needs GUI session + user): hold `alt_r` via rdev, CSP console check in the real
webview, Cmd+R during Hold (lease). Voice_lib `audio_integration` real-mic tests flake with
SimAudioProc/heard holding CoreAudio — quit iOS Simulator before hardware runs.
