---
title: Разработка
layout: default
---

# Разработка

## Команды из `package.json`

```bash
bun install
bun run dev                 # Vite frontend dev server
bun run harness             # Vite server для /harness.html
bun run build               # темы + tsc + Vite build
bun run build:themes        # сборка builtin-тем в src-tauri/themes/
bun run tauri dev           # Tauri dev app
bun run tauri build         # production-сборка Tauri
bun run test:run            # Vitest один раз
bun run test:coverage       # Vitest coverage
bun run test:e2e            # Playwright
bun run test:all            # Vitest + Playwright
bun run test:rust           # cargo build --examples + cargo test
bun run lint                # ESLint по src/**/*.ts(x)
```

Тесты Rust также можно запускать напрямую:

```bash
cd src-tauri && cargo test
```

## Архитектура

Фронтенд в `src/`: React 18, TypeScript, Vite, React Router и обёртки Tauri `invoke`. Публичные маршруты: Settings (`/settings`), History (`/` и `/history`), Dictionary (`/dictionary`), Onboarding (`/onboarding`).

Важные области фронтенда:

- `src/lib/commands.ts` и `src/bindings.ts` — обёртки invoke и сгенерированные bindings.
- `src/lib/settingsRegistry.ts` и `src/lib/constants.ts` — реестр UI настроек и списки опций.
- `src/hooks/` — async data, settings, audio devices, recording, overlay, providers, themes.
- `src/components/` — layout, dictionary, history, settings, spectrum.
- `src/theme-engine/` — ThemeHost, контракт (`apiVersion` 1), builtin-исходники и рендереры.
- `src/overlay.tsx` — entrypoint оверлея и press/release запись по opaque-пикселям.

Бэкенд в `src-tauri/`: Rust + Tauri v2. Два бинарника: `voice` (основное приложение) и `typing_bench` (бенчмарк задержки автопечати).

Важные модули:

- `audio/` — запись через CPAL, уровни, VAD, WAV.
- `orchestrator/` — hotkey → запись → очередь транскрипции → постобработка → вывод.
- `transcription/` — HTTP-клиент, совместимый с Whisper (по умолчанию Groq; кастомный URL только через `api_url_override`).
- `output/` — буфер обмена, paste shortcuts, auto-type, auto-submit.
- `hotkey/` — низкоуровневый ввод через rdev.
- `storage/` — config/history/dictionary/corrections/providers/prompts/failed_audio/themes/debug в каталоге `voxis`.
- `theme_engine/` и `overlay_native/` — манифесты/скрипты и окно оверлея (webview; стандартный размер 172×36 logical px, если тема не задаёт валидные `overlay_width`/`overlay_height`).
- `llm/` и `learning/` — опциональная LLM-постобработка и обучение словаря.
- `commands/` — команды Tauri для фронтенда.

### Поток данных

1. Нажатие hotkey → `HotkeyListener` → `Orchestrator::on_hotkey_pressed()` запускает `AudioRecorder`.
2. Отпускание (hold) или повторный tap (toggle) ставит аудио в `TranscriptionQueue`.
3. Воркер: транскрипция → словарь → опциональный LLM → clipboard/auto-type.
4. Фронтенд получает события `state-changed` и `error`.

## GitHub Pages docs

Сайт документации в `docs-site/` собирается workflow `.github/workflows/pages.yml` при push в `main`, затрагивающем `docs-site/**` или сам workflow. Используются `actions/configure-pages`, `actions/jekyll-build-pages` (source = `docs-site`), `actions/upload-pages-artifact` и `actions/deploy-pages`.

Не добавляйте в публичные docs учётные данные, содержимое локальных БД или выдуманные hosted URL/скриншоты.
