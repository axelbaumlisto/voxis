---
title: Troubleshooting
layout: default
---

# Troubleshooting

## No transcription or empty output

1. Verify that the app settings contain a transcription API key.
2. Check that the selected audio input device actually produces sound.
3. On Linux/PipeWire, try setting the working microphone as the system default input and select `Default` in SoupaWhisper.
4. If VAD is enabled, switch the VAD backend to `Off (no filtering)` or tune onset/hangover/prefill so speech is not trimmed away.
5. Remember that recordings shorter than the minimum captured-audio duration are dropped before API submission. The default is 300 ms after VAD.
6. Check app logs in the platform config directory's `logs/` directory and debug files in `debug/` when debug mode is enabled.

## Wrong microphone on Linux

The device names shown by ALSA/CPAL may differ from the names shown by KDE/PipeWire. A working PipeWire input can be selected as system default with `wpctl set-default <id>`, then SoupaWhisper can use `Default`.

Useful commands:

```bash
wpctl status
pactl list sources short
arecord -l
```

## Permissions

Microphone permission is required for recording. Auto-typing and global hotkeys may also require OS accessibility/input permissions. The app includes permission commands and a permission banner that can request microphone/accessibility permission and open the relevant system settings where supported.

## Theme changes do not appear

User themes are preserved on startup. If a v2 theme already exists in the user themes directory, updating the bundled copy alone will not overwrite it. Copy updated `theme.js` and `theme.json` into the user theme directory, then reload/reselect the theme or use Reload + Preview.

## Missing API key after setting environment variables

The application stores API keys in local config and does not automatically read `GROQ_API_KEY` or `OPENAI_API_KEY` from the shell. Enter keys in Settings.

## Provider selection confusion

The transcription Provider setting offers Groq and OpenAI labels, but the current transcription client does not route by that label; it uses the default Groq-compatible transcription URL unless `api_url_override` is set by tests or a custom build. Use a Groq `gsk_...` key for the default endpoint. OpenAI `sk-...` is only an example of OpenAI credential format. LLM provider settings are separate from transcription and support builtin Groq, OpenAI, and OpenRouter chat-completions providers plus custom provider definitions.

## Build failures on Linux

Install Tauri/WebKitGTK and audio development dependencies for your distribution. The GitHub test workflow lists the Ubuntu packages used in CI: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, and `libasound2-dev`.
