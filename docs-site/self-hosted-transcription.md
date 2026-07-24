---
title: Self-Hosted Transcription
layout: default
---

# Self-Hosted & Alternative Transcription Providers

Voxis's transcription client speaks the standard OpenAI-compatible
`/audio/transcriptions` protocol: a multipart form (`file`, `model`,
`response_format=verbose_json`, optional `language`/`translate`) sent with
an `Authorization: Bearer <api_key>` header, expecting back a JSON body
with at least `text`. Any server implementing that same contract — another
cloud provider, or a fully self-hosted Whisper-compatible server — works by
pointing the app's `api_url_override` at it. No code changes are required,
and the app does not ship a provider-specific SDK per vendor or a
platform-native transcription backend by design.

`api_url_override` is not exposed in the Settings UI; it is a config field
used through tests or a custom build. See the full write-up linked below
for exact steps, verified endpoints, and worked examples.

## Quick start: self-hosted with Docker

This repository ships
[`docker-compose.selfhost.yml`](https://github.com/axelbaumlisto/voxis/blob/main/docker-compose.selfhost.yml)
at the project root — a thin wrapper around the upstream
[`speaches`](https://github.com/speaches-ai/speaches) image (OpenAI-compatible,
backed by `faster-whisper`), with sane local defaults (binds to
`127.0.0.1` only, persists downloaded models in a named volume).

```bash
docker compose -f docker-compose.selfhost.yml up -d
docker compose -f docker-compose.selfhost.yml exec speaches \
  curl -sX POST "http://localhost:8000/v1/models/Systran/faster-whisper-large-v3"
```

Then in Voxis Settings, set:

- **API URL override**: `http://localhost:8000/v1/audio/transcriptions`
- **Model**: `Systran/faster-whisper-large-v3` (or whichever model you pulled)
- **API key**: any non-empty placeholder — the server doesn't check it, but
  the Voxis client always sends an `Authorization: Bearer <key>` header

A `--profile gpu` variant is included for NVIDIA GPU acceleration.

## macOS-native option: Apple SpeechAnalyzer

On Apple Silicon Macs running macOS 26+, community projects (e.g.
[`ohr`](https://github.com/Arthur-Ficial/ohr)) wrap Apple's on-device
`SpeechAnalyzer`/`SpeechTranscriber` API in an OpenAI-compatible HTTP
server, so it plugs into `api_url_override` the same way as any other
self-hosted option. It is fast and lightweight (verified ~10MB RSS growth
in the calling process, out-of-process inference on the Neural Engine) and
tested to be accurate for English, **but it only supports 30 locales and
does not support Russian** (or most other non-English/es/fr/de/it/ja/ko/pt/
yue/zh languages) — for unsupported languages, use the Docker/`speaches`
option above with a `large-v3` model instead.

## Full details

See **[docs/SELF_HOSTED_TRANSCRIPTION.md](https://github.com/axelbaumlisto/voxis/blob/main/docs/SELF_HOSTED_TRANSCRIPTION.md)**
in the repository for:

- The exact request/response protocol shape Voxis expects.
- A table of known cloud endpoints (Groq default, OpenAI, Azure OpenAI).
- Other protocol-compatible self-hosted options (whisper.cpp wrappers,
  LocalAI).
- Verified memory, accuracy, and language-support results for both
  `speaches` and the macOS `SpeechAnalyzer` option, measured against this
  project's real transcription client code.
- Notes on servers with no authentication (the API key field still can't
  be left empty).

See also [Settings](settings.md) and [Installation](installation.md#api-keys).
