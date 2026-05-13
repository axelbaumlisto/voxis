# Handy → TALRI cloud features · execution plan для слабых агентов

> Декомпозиция топ-10 рекомендаций из `handy-recommendations-cloud-only.md`
> на атомарные TDD-таски ≤200 LoC. Каждый коммит self-contained и не
> ломает зелёный стек.

## Сквозные правила (read me first)

1. **Один таск = один коммит** в стиле `type(scope): subject` (conventional).
2. **TDD**: каждая фича начинается с RED (failing tests), потом GREEN
   (минимальная реализация), потом optional refactor.
3. **SOLID + DRY + KISS** строго:
   - SRP — каждый файл < 250 LoC, делает одну вещь.
   - OCP — расширения через данные/конфиг, не через `if-cascades`.
   - DIP — Rust depends on traits (specta-generated), TS depends on
     auto-generated `bindings.ts`.
   - DRY — общие константы / типы / валидаторы вынесены в один модуль.
   - KISS — никаких "future-proof" слоёв абстракции. Если есть один
     consumer — пиши прямой код.
4. **Validation gates перед `git push`**:
   ```bash
   cd src-tauri && cargo test --lib 2>&1 | tail -3                       # 771+N GREEN
   cd src-tauri && cargo clippy --lib --tests 2>&1 | grep -E "warning|error"  # empty
   bun run test:run 2>&1 | grep "Tests "                                  # 1018+N GREEN
   bun run test:e2e 2>&1 | tail -3                                        # 133+N GREEN
   git status -s                                                          # only expected files
   ```
5. **specta-regen** автоматически после Rust изменений в `commands/*.rs`
   или `settings.rs` — иначе TS bindings отстают и собирается всё, но
   с runtime ошибкой.
6. **Коммит-метаданные**: каждый коммит включает в body
   - что и зачем (1 параграф)
   - какой топ-N пункт реализует (e.g. "Closes #4 from
     handy-recommendations-cloud-only.md")
   - перечисление tests +N

---

## Phase 0 · Baseline snapshot (1 таск, ~5 мин)

### T0.1 · Снять baseline ✅ выполнен ранее, повторяем cвежее число

**DONE WHEN**: запомнили текущие числа в шапке tracker'а.

```bash
cd src-tauri && cargo test --lib 2>&1 | tail -3       # current: 771
cargo clippy --lib --tests 2>&1 | grep -E "warning|error" || echo clean
bun run test:run 2>&1 | grep "Tests "                  # current: 1018
bun run test:e2e 2>&1 | tail -3                        # current: 133/9 skip
```

---

## Phase A · Hit-hard wins (~2 дня, 4 features → 12 таско́в)

### Feature #7 · Append trailing space (~30 мин, 2 таска)

#### T-A7.1 · RED: тест для `append_trailing_space` в output pipeline

**WHY**: проверить контракт «если флаг → конец = пробел, иначе исходный».

**WHAT**: в `src-tauri/src/output/mod.rs` (или `tests.rs`) добавить
2 unit-теста:
- `output_with_trailing_space_appends_one_space`
- `output_without_trailing_space_unchanged`

**HOW**: тесты ассертят что функция `format_output_text(text, settings)`
возвращает `"hello "` если `settings.append_trailing_space = true`, и
`"hello"` иначе.

**DONE WHEN**: тесты есть, FAIL (функция ещё не существует).

**COMMIT**: `test(output): RED for append_trailing_space toggle`

#### T-A7.2 · GREEN: реализация + поле в AppConfig

**WHY**: сделать RED зелёным минимальным кодом.

**WHAT**:
- Добавить в `config/mod.rs`: `pub append_trailing_space: bool` (default false).
- В `output/mod.rs` или `clipboard.rs`: `if settings.append_trailing_space { format!("{} ", text) } else { text }`.
- В `src/lib/settingsRegistry.ts`: `{ key: "append_trailing_space", type: "toggle" }`.
- В `src-tauri/src/storage/config_sqlite.rs`: get/set.

**DONE WHEN**:
- T-A7.1 GREEN
- specta-bindings перегенерированы
- toggle виден в Settings UI

**COMMIT**: `feat(output): append_trailing_space toggle (#7 from Handy recommendations)`

---

### Feature #9 · Translate-to-English toggle (~1 час, 2 таска)

#### T-A9.1 · RED: тест на `translate=true` в Whisper request payload

**WHY**: гарантировать что Groq/OpenAI Whisper API получит `task=translate`
когда флаг включён.

**WHAT**: unit-тест в `transcription/whisper.rs` или `tests.rs`:
- `build_request_includes_translate_when_flag_set`
- `build_request_omits_translate_when_flag_off`

Использовать существующий request builder. Если его нет — сначала
вынести multipart construction в чистую функцию.

**DONE WHEN**: 2 теста FAIL.

**COMMIT**: `test(transcription): RED for translate_to_english toggle`

#### T-A9.2 · GREEN: добавить флаг в payload + UI toggle

**WHAT**:
- `config/mod.rs`: `pub translate_to_english: bool` (default false).
- `transcription/whisper.rs`: добавить `multipart.text("task", "translate")` если флаг.
- `settingsRegistry.ts`: toggle entry.

**DONE WHEN**: T-A9.1 GREEN + ручной smoke (опционально): говорю
по-русски, в clipboard английский.

**COMMIT**: `feat(transcription): translate_to_english toggle for Whisper API (#9)`

---

### Feature #1 · Multi-prompt LLM templates (~1 день, 5 тасков)

#### T-A1.1 · RED: cargo тесты для `LlmPrompt` schema + резолвер

**WHY**: zafiksirovat' kontrakt do tipov i serializatsii.

**WHAT**: в `src-tauri/src/llm/prompts.rs` (новый файл):
- `pub struct LlmPrompt { id: String, name: String, prompt: String }`
- `pub fn default_prompts() -> Vec<LlmPrompt>` (Fix grammar, Email tone, Bullet list, Summarize)
- `pub fn find_by_id<'a>(list: &'a [LlmPrompt], id: &str) -> Option<&'a LlmPrompt>`

Тесты в `tests.rs`:
- `default_prompts_has_4_entries`
- `find_by_id_returns_match_or_none`
- `default_prompts_have_unique_ids`
- `serde_roundtrip_preserves_fields`

**DONE WHEN**: 4 RED.

**COMMIT**: `test(llm): RED for LlmPrompt schema + default templates`

#### T-A1.2 · GREEN: реализация LlmPrompt

**WHAT**: минимальная реализация по T-A1.1.

**DONE WHEN**: 4 GREEN, clippy clean.

**COMMIT**: `feat(llm): LlmPrompt schema + 4 default templates (#1)`

#### T-A1.3 · Persistence в SQLite

**WHAT**:
- Таблица `llm_prompts(id TEXT PRIMARY KEY, name TEXT, prompt TEXT, created_at, updated_at)`.
- Миграция: на первый запуск seed 4 default prompts.
- В `config`: `pub llm_selected_prompt_id: Option<String>`.
- В `storage/config_sqlite.rs`: CRUD для prompts (list/get/insert/update/delete).
- Tauri commands: `list_llm_prompts`, `create_llm_prompt`, `update_llm_prompt`, `delete_llm_prompt`, `set_active_llm_prompt`.

**DONE WHEN**:
- 4 cargo tests для CRUD + миграции.
- specta auto-regen.

**COMMIT**: `feat(storage): SQLite CRUD for llm_prompts (#1)`

#### T-A1.4 · Активный промпт идёт в LLM call

**WHAT**: в `orchestrator/post_process.rs` (или там где сейчас читается
`llm_prompt`) — резолвить `settings.llm_selected_prompt_id` → искать в
таблице → если найден, использовать его `prompt`, иначе fallback на старый
`llm_prompt`.

**DONE WHEN**:
- existing tests still GREEN (back-compat preserved).
- 2 новых теста: `uses_selected_prompt_when_set`, `falls_back_to_legacy_prompt_when_no_selection`.

**COMMIT**: `feat(orchestrator): use selected llm_prompt by id (#1)`

#### T-A1.5 · UI · PromptManager component

**WHAT**: `src/components/settings/LlmPromptManager.tsx` (~150 LoC):
- Dropdown активного промпта (бинды на `llm_selected_prompt_id`).
- Список с inline edit (name + textarea для prompt).
- `+` / `-` кнопки.
- Все мутации через auto-generated `commands.*` из bindings.ts.

Vitest tests (≥4):
- renders list of prompts
- click '+' creates a new prompt
- typing in name calls update command
- selecting a different prompt fires `setActiveLlmPrompt`

**DONE WHEN**: 4 vitest GREEN, e2e existing GREEN.

**COMMIT**: `feat(settings): LlmPromptManager UI (#1)`

---

### Feature #4 · Auto-submit (~4 часа, 3 таска)

#### T-A4.1 · RED: тест для auto-submit логики

**WHY**: фиксируем что после `type_text` шлётся keycode когда включено.

**WHAT**: в `output/mod.rs::tests.rs`:
- `output_pipeline_emits_enter_when_auto_submit_enter`
- `output_pipeline_emits_cmd_enter_when_auto_submit_cmd_enter`
- `output_pipeline_emits_nothing_when_auto_submit_off`

Мокируем keyboard simulation через trait `KeyboardEmitter` (вводим
маленький trait в существующий output модуль для testability — это
DIP по SOLID).

**DONE WHEN**: 3 RED.

**COMMIT**: `test(output): RED for auto_submit modifier-aware enter`

#### T-A4.2 · GREEN: реализация

**WHAT**:
- `config/mod.rs`: `pub auto_submit_key: AutoSubmitKey` enum (`Off`, `Enter`, `CmdEnter`, `ShiftEnter`).
- `output/auto_submit.rs` (новый): `pub fn emit(key: AutoSubmitKey, emitter: &dyn KeyboardEmitter)`.
- Подключение в конец pipeline.

**DONE WHEN**: T-A4.1 GREEN, clippy clean.

**COMMIT**: `feat(output): auto_submit (Enter / Cmd+Enter / Shift+Enter) (#4)`

#### T-A4.3 · UI · AutoSubmit dropdown

**WHAT**: `src/components/settings/AutoSubmit.tsx` (≤80 LoC, mirror Handy):
- dropdown с 4 опциями
- per-OS label (Cmd vs Super)

Vitest tests (≥3):
- renders all 4 options
- selecting calls onChange with correct enum string
- defaults to 'off' when value is missing

**DONE WHEN**: vitest GREEN + setting visible in UI.

**COMMIT**: `feat(settings): AutoSubmit dropdown UI (#4)`

---

## Phase B · Depth (~3 дня, 3 features → 9 тасков)

### Feature #6 · Audio feedback (~3 часа, 3 таска)

#### T-B6.1 · RED: тесты `audio_feedback::play(kind)`

**WHY**: контракт «вызвали → проигрался .wav для нужного события».

**WHAT**: `src-tauri/src/audio_feedback.rs` (новый, ~100 LoC) +
`tests.rs`. Тесты:
- `play_returns_ok_when_feedback_enabled`
- `play_returns_ok_silently_when_disabled`
- `volume_clamped_to_0_1_range`

Использовать `rodio` (если ещё нет — добавить в Cargo) или
`cpal`+ resampled buffer.

**DONE WHEN**: 3 RED.

**COMMIT**: `test(audio): RED for audio_feedback module`

#### T-B6.2 · GREEN: bundled wavs + проигрыватель

**WHAT**:
- 3 .wav в `src-tauri/sounds/` (бандл через `include_bytes!`):
  - `recording_start.wav`
  - `recording_stop.wav`
  - `error.wav`
- `audio_feedback.rs` с `enum SoundType { Start, Stop, Error }` +
  `pub fn play(kind: SoundType, settings: &AudioFeedbackSettings)`.
- Config: `pub audio_feedback: bool`, `pub feedback_volume: f32` (0..1).

**DONE WHEN**: T-B6.1 GREEN.

**COMMIT**: `feat(audio): bundled audio_feedback sounds + player (#6)`

#### T-B6.3 · Wire + UI

**WHAT**:
- В `orchestrator/coordinator.rs`: вызов `play(Start)` при начале
  recording, `play(Stop)` при остановке, `play(Error)` в error path.
- UI: `src/components/settings/AudioFeedback.tsx` (toggle + volume slider).

**DONE WHEN**: 2 e2e тестa добавлены (toggle persists через save,
volume changes persist). Vitest ≥3.

**COMMIT**: `feat(settings): AudioFeedback toggle + volume + wiring (#6)`

---

### Feature #2 · Multi-binding shortcuts (~2 дня, 4 таска)

#### T-B2.1 · RED: cargo тесты `ShortcutBinding` schema

**WHAT**: новый файл `src-tauri/src/shortcut/binding.rs`:
- `pub struct ShortcutBinding { id, name, description, default_binding, current_binding }`
- `pub fn default_bindings() -> Vec<ShortcutBinding>` (3 дефолта:
  `transcribe`, `transcribe_post_process`, `transcribe_quick_note`).
- `pub fn parse_combo(s: &str) -> Result<Combo, _>` — переиспользовать
  существующий парсер если есть.

Тесты (≥4):
- defaults_have_3_entries
- defaults_have_unique_ids
- parse_combo_accepts_altgr_alt_r_modifiers
- serde_roundtrip

**DONE WHEN**: 4 RED.

**COMMIT**: `test(shortcut): RED for multi-binding schema`

#### T-B2.2 · GREEN + storage

**WHAT**:
- Реализация structs + дефолтов.
- В config: `pub shortcut_bindings: Vec<ShortcutBinding>` (default = default_bindings()).
- В config_sqlite: serialize as JSON column.
- Tauri commands: `list_shortcut_bindings`, `update_shortcut_binding(id, new_combo)`.

**DONE WHEN**: T-B2.1 GREEN + CRUD tests +2.

**COMMIT**: `feat(shortcut): multi-binding schema + storage (#2)`

#### T-B2.3 · Action dispatcher

**WHAT**: `src-tauri/src/shortcut/dispatcher.rs`:
- `pub enum ShortcutAction { Transcribe, TranscribePostProcess { prompt_id: Option<String> } }`
- На hotkey event резолвить binding_id → action → дёргать orchestrator
  с правильными параметрами (raw transcribe vs с post-process по
  указанному prompt_id).

Тесты (≥3): для каждого action дёрнуть mocked orchestrator,
ассертить правильный method called.

**DONE WHEN**: 3 cargo tests GREEN.

**COMMIT**: `feat(shortcut): action dispatcher per binding (#2)`

#### T-B2.4 · UI · ShortcutBindingList

**WHAT**: `src/components/settings/ShortcutBindingList.tsx` (~180 LoC):
- список биндингов
- inline edit current_binding через ShortcutInput component
- "Reset to default" кнопка
- "Action" dropdown (Transcribe / Transcribe+PostProcess / Transcribe+Prompt:X)

Vitest tests (≥5).

**DONE WHEN**: vitest GREEN + e2e существующий GREEN.

**COMMIT**: `feat(settings): multi-binding UI (#2)`

---

### Feature #10 · Onboarding flow (~1 день, 2 таска)

#### T-B10.1 · Schema + first-run detection

**WHAT**:
- `pub first_run_completed: bool` в config (default false).
- Tauri command `mark_first_run_complete()`.

Тесты (≥2).

**COMMIT**: `feat(config): first_run_completed flag (#10)`

#### T-B10.2 · Onboarding pages

**WHAT**: `src/pages/OnboardingPage.tsx` (3 шага в одном компоненте,
≤200 LoC):
1. Mic permission test (live waveform + "Test mic" кнопка).
2. Hotkey picker.
3. First transcription (запись → результат → "Готово").

Гейт в `App.tsx`: если `!first_run_completed` → редирект на
`/onboarding`.

Vitest tests (≥4): шаги проходимы по очереди, кнопка "Готово"
вызывает `mark_first_run_complete`.

**COMMIT**: `feat(onboarding): 3-step first-run flow (#10)`

---

## Phase C · Polish (~2 дня, 3 features → 7 тасков)

### Feature #3 · Push-to-talk vs Toggle mode (~3 часа, 2 таска)

#### T-C3.1 · RED: тест на toggle vs hold

**WHAT**: в `orchestrator/tests.rs`:
- `toggle_mode_starts_on_first_press_stops_on_second`
- `hold_mode_stops_on_release`
- `hold_mode_does_not_stop_on_repeated_press`

**COMMIT**: `test(orchestrator): RED for hotkey toggle vs hold mode`

#### T-C3.2 · GREEN: реализация + UI

**WHAT**:
- `config`: `pub hotkey_mode: HotkeyMode { Hold, Toggle }` (default Hold).
- В `orchestrator::on_hotkey_pressed` развилка по mode.
- UI: `src/components/settings/HotkeyMode.tsx` (radio: Hold / Toggle).

**DONE WHEN**: T-C3.1 GREEN, vitest +2, e2e GREEN.

**COMMIT**: `feat(orchestrator): toggle vs hold hotkey mode (#3)`

---

### Feature #5 · Recording retention period (~1 час, 2 таска)

#### T-C5.1 · RED: тесты для cleanup logic

**WHAT**: в `storage/history.rs::tests.rs`:
- `retention_never_keeps_everything`
- `retention_preserve_limit_keeps_only_N_recent`
- `retention_days3_drops_older_than_3_days`
- `retention_weeks2_drops_older_than_14_days`
- `retention_months3_drops_older_than_90_days`

**COMMIT**: `test(storage): RED for retention period cleanup`

#### T-C5.2 · GREEN + UI

**WHAT**:
- `pub enum RetentionPeriod { Never, PreserveLimit, Days3, Weeks2, Months3 }`.
- `cleanup_old_recordings(retention, limit)` в storage/history.rs.
- Шедулер: вызов на app startup + ежедневный timer (tokio interval).
- UI: dropdown в Settings.

**COMMIT**: `feat(storage): recording retention period (#5)`

---

### Feature #8 · Always-on microphone (~2 дня, 3 таска)

#### T-C8.1 · RED: тест на reuse cpal stream

**WHAT**: `audio/recorder.rs::tests.rs`:
- `always_on_mode_keeps_stream_open_between_recordings`
- `always_on_mode_zero_cold_start_latency` (мерим интервал между
  `start()` и первым sample push).
- `always_on_disabled_closes_stream_on_stop`.

**COMMIT**: `test(audio): RED for always_on_microphone mode`

#### T-C8.2 · GREEN: реализация

**WHAT**:
- `config`: `pub always_on_microphone: bool`.
- `AudioRecorder`: если флаг true, на `stop()` помечать `is_recording=false`
  но не закрывать cpal stream. На `start()` если stream открыт — просто
  переключить флаг.

**COMMIT**: `feat(audio): always_on_microphone (#8)`

#### T-C8.3 · UI + warning

**WHAT**: `src/components/settings/AlwaysOnMicrophone.tsx`:
- toggle
- inline warning: «Микрофон будет всегда активен. Возможно ↑ расход
  батареи. Поток данных НЕ передаётся в облако пока не нажат hotkey».

**COMMIT**: `feat(settings): AlwaysOnMicrophone toggle + privacy warning (#8)`

---

## Master checklist (для слабого агента, после КАЖДОГО таска)

- [ ] `cd src-tauri && cargo test --lib 2>&1 | tail -3` — 771+N GREEN
- [ ] `cd src-tauri && cargo clippy --lib --tests 2>&1 | grep -E "warning|error"` — empty
- [ ] specta-bindings перегенерированы если трогал `commands/*.rs` или `settings.rs`
- [ ] `bun run test:run 2>&1 | grep "Tests "` — 1018+N GREEN
- [ ] `bun run test:e2e 2>&1 | tail -3` — 133+N GREEN, 0 fail
- [ ] `git status -s` — только expected files
- [ ] commit message соблюдает conventional commits
- [ ] commit body ссылается на пункт `(#N from Handy recommendations)`
- [ ] `git push` (только если предыдущие 7 пунктов GREEN)

## Прогресс (обновлять после каждого таска)

| Task | Status | Commit | Date |
|------|--------|--------|------|
| T0.1 baseline | — | — | — |
| **Phase A · hit-hard wins** | | | |
| T-A7.1 RED trailing space | — | — | — |
| T-A7.2 GREEN trailing space | — | — | — |
| T-A9.1 RED translate-to-english | — | — | — |
| T-A9.2 GREEN translate-to-english | — | — | — |
| T-A1.1 RED LlmPrompt schema | — | — | — |
| T-A1.2 GREEN LlmPrompt schema | — | — | — |
| T-A1.3 SQLite CRUD | — | — | — |
| T-A1.4 Active prompt in LLM call | — | — | — |
| T-A1.5 PromptManager UI | — | — | — |
| T-A4.1 RED auto-submit | — | — | — |
| T-A4.2 GREEN auto-submit | — | — | — |
| T-A4.3 AutoSubmit UI | — | — | — |
| **Phase B · depth** | | | |
| T-B6.1 RED audio_feedback | — | — | — |
| T-B6.2 GREEN audio_feedback | — | — | — |
| T-B6.3 Audio feedback wire+UI | — | — | — |
| T-B2.1 RED multi-binding schema | — | — | — |
| T-B2.2 GREEN multi-binding storage | — | — | — |
| T-B2.3 Action dispatcher | — | — | — |
| T-B2.4 Binding UI | — | — | — |
| T-B10.1 first_run_completed flag | — | — | — |
| T-B10.2 Onboarding pages | — | — | — |
| **Phase C · polish** | | | |
| T-C3.1 RED hotkey mode | — | — | — |
| T-C3.2 GREEN hotkey mode | — | — | — |
| T-C5.1 RED retention | — | — | — |
| T-C5.2 GREEN retention | — | — | — |
| T-C8.1 RED always-on | — | — | — |
| T-C8.2 GREEN always-on | — | — | — |
| T-C8.3 AlwaysOn UI + warning | — | — | — |

## Totals

- Phase A: **12 тасков · ≈2 дня**
- Phase B: **9 тасков · ≈3 дня**
- Phase C: **7 тасков · ≈2 дня**
- Итого: **28 тасков · ≈7 рабочих дней · ≤200 LoC каждый**

## Принципы декомпозиции (для ревью этого плана)

1. **Каждая фича начинается с RED**. Не пишем код пока не показали как
   мы его проверим.
2. **Один таск меняет один слой**: schema OR storage OR UI OR wiring.
   Меньше merge-боли, меньше нагрузки на голову weak-agent.
3. **Зелёный стек после КАЖДОГО таска**. Никаких "соберём в конце".
4. **specta auto-regen** упомянута явно — это любимый источник багов.
5. **Никаких backend-агрегаторов**: каждый Tauri-commande один глагол
   (list_prompts, create_prompt, update_prompt, delete_prompt — не
   manage_prompts).
6. **UI компоненты ≤200 LoC** иначе SRP нарушен.
7. **Тесты сначала для контракта, потом для UI**. Контракт стабилен,
   UI меняется чаще — тесты UI нужны но писать после контрактных.
