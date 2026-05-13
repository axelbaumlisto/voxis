# Top 10 рекомендаций из Handy для TALRI (cloud-only)

Изучен `github.com/cjpais/Handy@HEAD` (≈14k LoC Rust + 12k LoC TS). Handy
сам по себе local-first (Whisper-rs + Parakeet), но его cloud-часть —
LLM post-process через 7 провайдеров (OpenAI, Z.AI, OpenRouter,
Anthropic, Groq, Cerebras, Bedrock + Apple Intelligence) — почти 1:1
наш use-case. Архитектурные идеи переносимы вне зависимости от того,
где живёт транскрипция.

Все 10 пунктов отсортированы по **value/effort** (сверху — самые
выгодные при минимальной работе). Каждый помечен с предполагаемой
сложностью и существующими файлами Handy для референса.

---

## #1 — Multi-prompt LLM templates 🔥 high-value · ~1 день

**Текущее у нас**: одна строка `llm_prompt` в config. Хочешь сменить тон
письма → лезешь в Settings, редактируешь, сохраняешь.

**У Handy**: `post_process_prompts: Vec<LLMPrompt { id, name, prompt }>`
+ `post_process_selected_prompt_id`. UI: выбор активного промпта из
dropdown, кнопки `+/edit/delete`. Дефолты: "Fix grammar", "Email tone",
"Translate to formal", "Bullet list", "Summarize".

**Файлы для копирования**:
- `src-tauri/src/settings.rs::LLMPrompt`
- `src/components/settings/PostProcessingSettingsPrompts.tsx`
- Persistence в SQLite: один INSERT ... в таблицу `llm_prompts(id, name, prompt)`.

**Применимость к нам**: 100%. Большой UX win за пол дня.

---

## #2 — Multi-binding shortcuts (per-action hotkeys) 🔥 high-value · ~2 дня

**Текущее**: только один AltGr → "record + transcribe + paste".

**У Handy**: `ShortcutBinding { id, name, description, default, current }`
+ `ShortcutAction` trait. Каждый binding запускает свой action:
- `transcribe` — обычная диктовка
- `transcribe_post_process` — диктовка + LLM по выбранному промпту
- кастомные — диктовка + конкретный промпт по id

**Пример сценария**:
- `AltGr` → быстрая заметка (raw)
- `Ctrl+AltGr` → диктовка + Email tone
- `Cmd+AltGr` → диктовка + Bullet list для Slack

**Файлы**:
- `src-tauri/src/actions.rs` (ShortcutAction trait + dispatch)
- `src-tauri/src/shortcut/{handler.rs, handy_keys.rs}`

**Применимость**: 100%. Сильно усиливает power-user поток.

---

## #3 — Push-to-talk vs Toggle mode 🟡 medium-value · ~3 часа

**Текущее**: только hold-mode (держишь AltGr пока говоришь).

**У Handy**: `push_to_talk: bool` toggle. Если выключен — tap-to-start,
tap-to-stop. Удобнее для долгой диктовки (рука не устаёт).

**Реализация**: модификация `Orchestrator::on_hotkey_pressed` — если
toggle mode и уже recording, то stop вместо игнора повторного press.

**Файлы**:
- `src/components/settings/PushToTalk.tsx` (10 строк toggle)
- `src-tauri/src/actions.rs` (логика в `TranscribeAction::start`)

**Применимость**: 100%.

---

## #4 — Auto-submit (Enter / Cmd+Enter / Shift+Enter) 🔥 high-value · ~4 часа

**Текущее**: после ввода текста — ничего, пользователь жмёт Enter сам.

**У Handy**: `auto_submit: bool` + `auto_submit_key: enter | cmd_enter | shift_enter`.
После того как текст напечатан/вставлен, посылает заданный keycode →
сообщение отправляется в Telegram/iMessage/Slack/чат-клиент.

**Реализация**: добавить вызов `rdev::simulate(EventType::KeyPress(key))`
сразу после паста в `output/mod.rs`. Один enum, один dropdown в UI.

**UX win**: «Hold AltGr → говорю → отпустил → сообщение улетело в чат
без касания клавиатуры». Это killer feature для мобильно-настольной
коммуникации.

**Файлы**:
- `src/components/settings/AutoSubmit.tsx`
- `src-tauri/src/output/mod.rs` (1 вставка в конец `type_text`)

**Применимость**: 100%.

---

## #5 — Recording retention period 🟢 medium-value · ~1 час

**Текущее**: `history_days: 7` (один параметр, гранулярность дни).

**У Handy**:
```rust
enum RecordingRetentionPeriod {
    Never,           // никогда не удалять
    PreserveLimit,   // только последние N штук
    Days3, Weeks2, Months3,
}
```
+ автоматический cleanup при старте + опциональное удаление аудио-файлов
вместе с записью в БД.

**Применимость**: 100%. Privacy-friendly + предсказуемый объём диска.
Готовый enum + миграция SQLite — час работы.

---

## #6 — Audio feedback (beeps на start/stop/error) 🟡 medium-value · ~3 часа

**Текущее**: ничего. Пользователь не слышит подтверждения что hotkey
зарегистрирован — особенно проблема для незрячих и при глубокой
концентрации.

**У Handy**:
- `audio_feedback: bool` + `feedback_sound_theme: SoundTheme`
+ `feedback_volume: f32` (0..1)
- 3 sound events: `RecordingStarted`, `RecordingStopped`, `Error`
- Bundled темы (можно копировать из их `assets/sounds/`)

**Файлы**:
- `src-tauri/src/audio_feedback.rs` (≈200 LoC, очень прямолинейно)
- `src/components/settings/AudioFeedback.tsx` + `SoundPicker.tsx` + `VolumeSlider.tsx`

**Применимость**: 100%. Бренди важно особенно с always-visible pill.
Поможет отличать «hotkey сработал» от «hotkey пропустили» (debounce у
нас уже есть, но обратной связи нет).

---

## #7 — Append trailing space toggle 🟢 small but real polish · ~30 минут

**Текущее**: после `"привет"` курсор сразу после `т` — следующая фраза
прилипает: `"приветкак дела"`.

**У Handy**: `append_trailing_space: bool` — печатает `"привет "` с
концевым пробелом.

**Реализация**: одна строка в `output/mod.rs`:
```rust
let final_text = if settings.append_trailing_space { format!("{} ", text) } else { text };
```

**Применимость**: 100%. Тривиальная фича, заметный комфорт.

---

## #8 — Always-on microphone mode 🟡 medium-value · ~2 дня

**Текущее**: cpal-стрим открывается на каждый AltGr → 100-300мс cold-start
прежде чем первые сэмплы попадут в буфер. Кончик первой буквы теряется.

**У Handy**: `always_on_microphone: bool`. Если включено — cpal-stream
держится открытым постоянно, при hotkey просто начинаем накапливать
сэмплы. Latency 0.

**Trade-off**: непрерывное «прослушивание» → privacy concerns + расход
батареи (mic chip не уходит в low-power). У Handy это в "Debug" разделе
именно из-за privacy.

**Применимость**: 100% если есть пользователи диктующие много (например
почасовая стенография). Опциональный toggle с честным warning в UI.

---

## #9 — "Translate to English" toggle 🟢 small but cool · ~1 час

**Текущее**: используем Whisper для транскрипции, текст всегда на языке
говорящего.

**У Handy**: `translate_to_english: bool` → передаёт `task=translate` в
Whisper API. Whisper понимает 99 языков, выдаёт английский.

**Применимость**: 100% и **уже работает** на Groq Whisper и OpenAI Whisper
API (оба принимают `task=translate`). Просто добавить:
- toggle в UI (5 строк)
- `request.task = "translate"` в `transcription/whisper.rs` если включено

Для двуязычных пользователей (rus→eng) — мощная фича: говоришь по-русски,
получаешь готовый английский текст в коде/документе.

---

## #10 — Onboarding flow на первый запуск 🟢 polish · ~1 день

**Текущее**: запустил → черный квадрат, разбирайся как хочешь.

**У Handy**: `src/components/onboarding/Onboarding.tsx`:
1. Логотип + tagline
2. **Mic permission test** — кнопка "Test mic" с live waveform, чтобы
   убедиться что разрешения есть и нужный девайс выбран
3. **Hotkey picker** — записать желаемый shortcut
4. **First transcription** — записать тест-фразу, посмотреть что в
   clipboard оказался текст
5. Готово, дальше Settings

**Файлы**: `src/components/onboarding/{Onboarding.tsx, ModelCard.tsx,
AccessibilityOnboarding.tsx}` (Handy спрашивает permission для accessibility
на macOS для типизации; нам тоже надо).

**Применимость**: 100%. Резко снижает churn новых пользователей и
поддержку «не работает / не пойму».

---

## Что НЕ берём (намеренно)

| Фича Handy | Почему пропускаем |
|------------|-------------------|
| `WhisperAcceleratorSetting` / `OrtAcceleratorSetting` (CUDA, CoreML, DirectML) | Локальные модели не используем |
| `ModelUnloadTimeout`, `LazyStreamClose` | Локальные модели не используем |
| `AccelerationSelector` UI | Локальные модели не используем |
| `Parakeet` / model downloader | Локальные модели не используем |
| Apple Intelligence provider | User явно отказался |
| `TypingTool` (wtype/ydotool/xdotool selector) | Linux-only, у нас уже `enigo+x11rb` |
| `ferrous_opencc` (Chinese variants) | Out of scope |

---

## Bonus runner-ups (не вошли в топ-10, но достойны)

| Фича | Effort | Value |
|------|--------|-------|
| `start_hidden` (start minimised to tray) | 5 мин | low |
| `autostart` on login (Tauri autostart plugin) | 30 мин | medium |
| `mute_while_recording` (pause music/notifications) | 1 день | medium |
| `update_checks` (in-app version banner) | 4 часа | medium |
| Output device selector (for feedback sounds) | 2 часа | low |
| App language i18n (en/ru/de/zh/fr) | 2 дня | high if non-RU users coming |
| Debug mode behind secret shortcut (Cmd+Shift+D) | 2 часа | low (мы уже имеем debug socket) |
| Custom base URL для provider (OpenAI-compatible self-host) | 1 час | medium |
| Per-provider model list refresh (`/models` endpoint) | 2 часа | medium |
| `experimental_enabled` toggle (gate beta features) | 1 час | low-medium |

---

## Предлагаемый порядок реализации

Если делать всё подряд оптимизируя по «отдача / время»:

```
Phase A (~2 дня, hit-hard wins):
  #4 Auto-submit            — мгновенный UX-удар
  #1 Multi-prompt templates  — power feature
  #7 Append trailing space   — тривиальное счастье
  #9 Translate-to-English    — уже работает в API, нужен toggle

Phase B (~3 дня, depth):
  #2 Multi-binding shortcuts — настоящий power-user mode
  #6 Audio feedback          — accessibility + confidence
  #10 Onboarding flow        — снижает churn новичков

Phase C (~2 дня, polish):
  #3 Push-to-talk vs toggle  — preference
  #5 Recording retention     — privacy + диск
  #8 Always-on mic           — latency для heavy users (с warning)
```

Итого ~1 рабочая неделя на топ-10. Каждый пункт самодостаточен и
коммитится отдельно — можно делать по одному в день и каждый commit
будет давать видимое улучшение.
