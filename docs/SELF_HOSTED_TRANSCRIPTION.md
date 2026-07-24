# Self-Hosted & Alternative Transcription Providers

> **TL;DR — Voxis speaks the standard OpenAI-compatible `/audio/transcriptions`
> protocol. Point `api_url_override` at any server implementing that same
> contract (cloud or self-hosted) and it works. No code changes required,
> and none are planned — see "Why we don't ship this built-in" below.**

This is the hands-on companion for running Voxis against something other
than the default Groq endpoint: another cloud provider, or a fully local
self-hosted Whisper server. If you just want the default Groq setup, see
the main [README.md](../README.md#configuration-and-credentials) instead.

---

## Why we don't ship this built-in

Voxis's transcription client (`src-tauri/src/transcription/mod.rs`) is
intentionally a thin, single-purpose HTTP client for one protocol shape. We
deliberately do **not**:

- Add a provider-specific SDK/adapter per vendor (Groq, OpenAI, Deepgram,
  etc. all speak close-enough dialects of the same multipart form)
- Add a platform-native transcription backend (e.g. macOS `SpeechAnalyzer`,
  Windows `Microsoft.Windows.AI.Speech`) as a bundled alternative engine

This keeps `transcription/` small, testable, and free of per-platform code
paths, in line with the project's SRP-focused module structure. The
supported extension point instead is `api_url_override`: if you want a
different backend, run something that speaks the same protocol and point
Voxis at it. This document explains what "the same protocol" means and how
to verify it yourself.

---

## The protocol Voxis expects

From `TranscriptionClient` (`src-tauri/src/transcription/mod.rs`):

- **Request**: `POST <api_url_override>`, `multipart/form-data`, always
  sending `Authorization: Bearer <api_key>` (the client requires a
  non-empty `api_key` string — see "servers with no auth" below)
  - `file`: the recorded audio (WAV)
  - `model`: model name string (whatever the target server expects)
  - `response_format`: always `verbose_json`
  - `language`: optional, omitted when `"auto"`
  - `translate`: optional boolean flag (uses the same endpoint, not a
    separate `/translations` route)
- **Response**: JSON body with at least `text` (string); `language`
  (string, optional) and `duration` (float, optional) are read if present.
  Anything else in the payload (segments, words, timestamps) is ignored.

Any server that accepts this multipart shape and returns this JSON shape is
a drop-in replacement. This is the same contract implemented by
OpenAI's own `/v1/audio/transcriptions` and by the projects listed below.

---

## Known cloud endpoints

Set **Settings → Provider → API Key** and, for anything other than Groq,
build with (or otherwise configure) `api_url_override`:

| Provider | URL | Notes |
|---|---|---|
| **Groq** (default) | `https://api.groq.com/openai/v1/audio/transcriptions` | Shipped default, verified in production |
| **OpenAI** | `https://api.openai.com/v1/audio/transcriptions` | Same protocol family; not verified by us end-to-end, verify current pricing/limits yourself |
| **Azure OpenAI / Azure AI Foundry** | your resource's `.../audio/transcriptions` deployment URL | Not verified by us; check your deployment's exact path |

---

## Self-hosted / fully offline options

If you want transcription with no cloud dependency at all, self-host a
Whisper-compatible server and point `api_url_override` at
`http://localhost:<port>/v1/audio/transcriptions` (adjust the path to match
the server you choose).

### ✅ Verified working: `speaches`

[speaches](https://github.com/speaches-ai/speaches) (OpenAI-compatible
server backed by `faster-whisper`) was **independently verified against
this project's actual transcription client code** on 2026-07-24 (see
"How this was verified" below). Recommended as the default self-host
option — works identically on Linux, macOS, and Windows (anywhere Docker
runs), unlike the macOS-only `SpeechAnalyzer` option below.

#### Quickest start: `docker-compose.selfhost.yml`

This repo ships
[`docker-compose.selfhost.yml`](../docker-compose.selfhost.yml) at the
project root — a thin wrapper around the upstream `speaches` image with
sane defaults (binds to `127.0.0.1` only, persists downloaded models in a
named volume so you don't re-download `large-v3` on every restart). We ran
this exact file end-to-end (`up` → pull a model → real transcription
request → `down`) as part of writing this doc; it works as described.

```bash
# from the repo root
docker compose -f docker-compose.selfhost.yml up -d

# pull a model once (large-v3 for best accuracy, ~3GB; use a smaller name
# like Systran/faster-whisper-small if that's too slow on your hardware)
docker compose -f docker-compose.selfhost.yml exec speaches \
  curl -sX POST "http://localhost:8000/v1/models/Systran/faster-whisper-large-v3"
```

Then in Voxis Settings, set:

- **API URL override**: `http://localhost:8000/v1/audio/transcriptions`
- **Model**: `Systran/faster-whisper-large-v3` (or whichever model you pulled)
- **API key**: any non-empty placeholder — the server doesn't check it, but
  the Voxis client always sends an `Authorization: Bearer <key>` header, so
  the field can't be left empty

For NVIDIA GPU acceleration (requires the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)):

```bash
docker compose -f docker-compose.selfhost.yml --profile gpu up -d speaches-gpu
```

To stop and remove everything (including the downloaded models):

```bash
docker compose -f docker-compose.selfhost.yml down -v
```

#### Manual start (no compose file)

If you'd rather not use the compose file:

```bash
docker run -d --name speaches -p 127.0.0.1:8000:8000 \
  ghcr.io/speaches-ai/speaches:latest-cpu
# (use ghcr.io/speaches-ai/speaches:latest-cuda for GPU acceleration)

curl -X POST "http://localhost:8000/v1/models/Systran/faster-whisper-large-v3"
```

Same `api_url_override` and model name as above.

### Other options (protocol-compatible, not independently tested by us)

- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) with an
  OpenAI-shaped HTTP wrapper — whisper.cpp's own `server` example, or
  community wrappers such as
  [whisper-gateway](https://github.com/christoph-det/whisper-gateway) or
  [whisper.api](https://github.com/innovatorved/whisper.api)
- [LocalAI](https://github.com/mudler/LocalAI) if you already run it for
  other models — it exposes `/v1/audio/transcriptions` alongside its
  chat/image endpoints

These implement the same contract on paper; we have not run them against
Voxis's client ourselves. If you verify one, a PR updating this doc with
your result is welcome.

### macOS-native option: Apple `SpeechAnalyzer` (macOS 26+, Apple Silicon)

Every Apple Silicon Mac on macOS 26 ("Tahoe") or newer ships an on-device
speech recognizer (`SpeechAnalyzer`/`SpeechTranscriber`, part of the
[Speech framework](https://developer.apple.com/documentation/speech),
introduced at
[WWDC 2025 session 277](https://developer.apple.com/videos/play/wwdc2025/277/)).
Independent community projects wrap it in an OpenAI-compatible HTTP server,
so it plugs into `api_url_override` exactly like `speaches`:

- **[ohr](https://github.com/Arthur-Ficial/ohr)** — CLI + `ohr --serve`
  OpenAI-compatible server, drop-in `POST /v1/audio/transcriptions`. Used
  for the verification below.
- **[macos-speech-server](https://github.com/dokterbob/macos-speech-server)** —
  explicitly advertises itself as "drop-in replacement for OpenAI audio
  endpoints", also does TTS and Home Assistant (Wyoming) support.
- **[ohr-speaker](https://github.com/yanhuicsdn/ohr-speaker)** — `ohr` fork
  adding speaker diarization via
  [FluidAudio](https://github.com/FluidInference/FluidAudio).
- **[openmeow](https://github.com/finch-xu/openmeow)** — macOS menu-bar app,
  OpenAI-compatible gateway supporting several local models.

None of these are shipped or maintained by us. We independently verified
`ohr` on 2026-07-24 on a real Apple Silicon Mac (M3, macOS 26.5.2) — see
results below.

#### Quick start (ohr)

```bash
git clone https://github.com/Arthur-Ficial/ohr.git
cd ohr
make install          # builds via Swift 6.3+, no Xcode required
ohr --serve            # OpenAI-compatible server on http://127.0.0.1:11434
```

Point `api_url_override` at `http://127.0.0.1:11434/v1/audio/transcriptions`
and set the model to `apple-speechanalyzer`. Like other self-hosted servers
with no real auth, the Voxis client still requires a non-empty API key —
enter any placeholder string.

#### Verified results (2026-07-24, real Apple Silicon Mac, M3, macOS 26.5.2)

**Memory footprint** — measured with a compiled Swift binary calling the
same `SpeechAnalyzer`/`SpeechTranscriber` APIs `ohr` wraps, using
`task_info(MACH_TASK_BASIC_INFO)` for resident memory (RSS), not the
`swift <file>` interpreter (which carries its own ~190MB baseline unrelated
to Speech):

| Stage | RSS |
|---|---|
| Baseline compiled binary, before touching Speech API | ~9 MB |
| After `SpeechAnalyzer.bestAvailableAudioFormat` (first model handshake) | ~13.7 MB (+4.7) |
| After `SpeechAnalyzer` created | ~14.8 MB (+1.1) |
| After full transcription of a 33s sample | ~19.1 MB (+4.3) |
| **Total growth in the calling process** | **~10 MB** |

Separately, the system-level speech daemons that actually hold the model
were observed at:

- `localspeechrecognition.xpc` — ~7.3 MB RSS
- `corespeechd` (long-running background daemon) — ~10.2 MB RSS

This matches Apple's documented architecture: inference runs
**out-of-process** (a separate system service, accelerated by the Neural
Engine), so a client app embedding this does not need to load a
multi-hundred-MB model into its own address space the way a bundled
Whisper model would. `SpeechAnalyzer.Options.ModelRetention` (`.whileInUse`,
`.lingering`, `.processLifetime`) lets a client explicitly control how long
the system keeps the model warm between calls.

**Accuracy (English)** — same public-domain Harvard-sentences sample used
in the `speaches` verification above
(`OSR_us_000_0010_8k.wav`, real human speaker):

> "The birch canoe slid on the smooth planks, glued the sheet to the dark
> blue background. It is easy to tell the depth of a well..."

Near-verbatim match to the reference text — visibly better than the
`faster-whisper-tiny` result from the `speaches` test (which mistranscribed
"canoe slid" as "can use lid"). This lines up with independent published
benchmarks (Inscribe, Argmax) showing `SpeechAnalyzer` beating Whisper
Small on LibriSpeech WER, at roughly a third of the compute.

**🔴 Russian is not supported — confirmed two ways:**

1. `SpeechTranscriber.supportedLocales` was queried directly on-device.
   The full list of 30 supported locales is: `de-AT, de-CH, de-DE, en-AU,
   en-CA, en-GB, en-IE, en-IN, en-NZ, en-SG, en-US, en-ZA, es-CL, es-ES,
   es-MX, es-US, fr-BE, fr-CA, fr-CH, fr-FR, it-CH, it-IT, ja-JP, ko-KR,
   pt-BR, pt-PT, yue-CN, zh-CN, zh-HK, zh-TW`. Russian is absent.
   `SpeechAnalyzer.bestAvailableAudioFormat` for a `ru-RU` transcriber
   returns `nil` — the API refuses to even set up a pipeline for an
   unsupported locale.
2. As a sanity check, we also fed the same Russian audio sample through an
   `en-US` transcriber (i.e. "maybe it'll recognize similar-sounding
   phonemes"). It does not: the model produced repetitive garbage
   (`"See you, you, you, you, you, you, you, you."`) with no relation to
   the actual Russian content. Acoustic models are trained on the phoneme
   inventory of their target language; feeding audio in an unsupported
   language does not degrade gracefully into something usable, it just
   produces noise.

**Bug found in `ohr` v0.1.6**: file transcription (`ohr <file>` and
`ohr --serve`) fails with `"No common audio format among modules"` on every
input we tried (WAV at 8/16/22kHz, AIFF via `say`, M4A/AAC) — even though
the same `SpeechAnalyzer`/`SpeechTranscriber` calls work fine when invoked
directly. The cause: `ohr`'s `transcribeFile()` never calls
`SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith:)` before
constructing the analyzer, unlike its own `streamMicrophone()` path (which
has a comment explaining exactly why that call is required to avoid a
`SIGTRAP`). We worked around this by calling the Speech framework directly
in a small test script; we did not patch `ohr` itself. If you rely on
`ohr`, check for a fix upstream or expect to hit this on file-based
transcription as of this version.

#### If your language isn't in the 30 supported locales

**Do not try to force it** — as shown above, feeding unsupported-language
audio through `SpeechAnalyzer` (using any locale, including `en-US`)
produces meaningless output, not degraded-but-usable output. If your
users' language isn't in Apple's list (Russian and most other languages
outside en/es/fr/de/it/ja/ko/pt/yue/zh are not covered), point them at a
proper multilingual model instead:

- **`speaches`** (verified above) with a `faster-whisper-large-v3` model —
  Whisper covers 99 languages including Russian
- **whisper.cpp** with a `large-v3` GGML/GGUF model, via one of the
  OpenAI-shaped wrappers listed earlier in this document

Both are configured the exact same way as the macOS-native option — just a
different `api_url_override` and model name. There is no reason to accept
a broken transcription from an unsupported-language SpeechAnalyzer setup
when a correctly-sized Whisper model is one Docker command away.

---

## How this was verified (speaches / faster-whisper, 2026-07-24)

(See the previous section for the separate `ohr` / Apple `SpeechAnalyzer`
verification, done the same day on real Apple Silicon hardware.)

This was a real test against the project's actual Rust client code, not a
protocol read-through or a bare `curl` check:

1. Ran `ghcr.io/speaches-ai/speaches:latest-cpu` in Docker on port 8000,
   pulled `Systran/faster-whisper-tiny` (English test) and
   `Systran/faster-whisper-small` (Russian test) via `POST /v1/models/<id>`.
2. Used two real speech samples (not silence/tone-generator fixtures):
   - English: `OSR_us_000_0010_8k.wav` from the public-domain
     [Open Speech Repository](https://www.voiptroubleshooter.com/open_speech/american.html)
     (Harvard sentences, real human speaker, 8kHz mono).
   - Russian: a synthesized `espeak-ng` sample of a known reference
     sentence (not a human recording — flagged as such; good enough to
     confirm the protocol and language detection, not for accuracy
     benchmarking).
3. Built a temporary throwaway binary
   (`src-tauri/src/bin/selfhost_verify.rs`, removed after the test, not
   committed) that called
   `voice_lib::transcription::TranscriptionClient::with_url(...)` — the
   exact same struct and `transcribe()` method the shipping app uses for
   Groq — pointed at `http://localhost:8000/v1/audio/transcriptions`
   instead of the Groq endpoint.
4. Confirmed the response was correctly parsed into `TranscriptionResult`
   (`text`, `language`, `duration` all populated) with no client changes.

**Results:**

| Sample | `language` returned | `text` returned |
|---|---|---|
| English (Harvard sentences, tiny model) | `en` | Near-verbatim transcription of the 10 reference sentences |
| Russian (synthetic espeak, small model) | `ru` | Recognizable Russian text with expected small-model/synthetic-voice errors |

**Conclusion:** the multipart request shape, `verbose_json` response
parsing, and language/duration field handling all work unmodified against
`speaches`. This confirms `api_url_override` is a real, working extension
point for self-hosting — not just a theoretical one.

**Scope of this verification:** protocol compatibility only. This was not
an accuracy benchmark (tiny/small models were used for speed, not
`large-v3`), not a load/latency test, and not a test of every self-hosted
project listed above — only `speaches`. If you need production-grade
accuracy locally, use a `large-v3`-class model.

**`docker-compose.selfhost.yml` was separately verified** the same day: ran
`docker compose up -d`, confirmed the healthcheck endpoint, pulled a model
via `docker compose exec`, sent a real transcription request against the
sample above (got the same `tiny`-model result shown here), confirmed the
named volume actually persists the downloaded model (147MB on disk after
one `tiny` pull), then `docker compose down -v` to confirm full cleanup.

**We also separately pulled and ran the actual `Systran/faster-whisper-large-v3`
model** (not just `tiny`) through the same compose file, to confirm the
"recommended" model in the quick-start above is real and not just a
suggestion we didn't check:

- Download took **~7 minutes** on this machine (CPU-only image); model
  footprint on disk was **5.8GB** (`~/.cache/huggingface` inside the
  container volume).
- `GET /v1/models` confirmed `large-v3` reports **99 supported languages**,
  including `ru` (Russian) — the language `SpeechAnalyzer` cannot handle at
  all (see above).
- Transcribing the same Harvard-sentences sample gave an **exact match**
  to the reference text: `"The birch canoe slid on the smooth planks...
  the juice of lemons makes fine punch... the box was thrown beside the
  parked truck..."` — noticeably better than the `tiny` model's errors
  ("can use lid" instead of "canoe slid", "pork chuck" instead of "parked
  truck").
- **CPU speed**: transcribing the 33-second sample took **~57 seconds**
  on the CPU-only image on this machine (slower than real-time, ~0.6x). If
  you need faster turnaround on CPU, use a smaller model
  (`faster-whisper-medium`/`small`) or the `--profile gpu` variant with an
  NVIDIA GPU. Groq's hosted `large-v3` (the shipped default) is
  effectively instant by comparison because it runs on dedicated LPU
  hardware — self-hosting on CPU trades that speed for being fully
  offline and free.

---

## Servers with no authentication

Since `TranscriptionClient` requires a non-empty `api_key` string and
always sends it as a `Bearer` token, self-hosted servers that don't check
authentication (like a default `speaches` install) still need *something*
non-empty entered in the API key field. Any placeholder string works; the
server will simply ignore the header if it doesn't check it.
