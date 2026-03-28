# SOLID/DRY/KISS/TDD Analysis Report — Round 6

**Дата:** 2026-02-19
**Кодовая база:** ~15,000 LOC (10,000 Rust + 5,000 TypeScript)
**Текущее покрытие:** 287 тестов Rust, 721 тест TypeScript

---

## Сводка найденных нарушений

| Категория | Rust | TypeScript | Всего |
|-----------|------|------------|-------|
| HIGH | 4 | 2 | 6 |
| MEDIUM | 5 | 4 | 9 |
| LOW | 2 | 3 | 5 |
| **Всего** | **11** | **9** | **20** |

---

# Топ-10 рекомендаций

## Рекомендация #1: Разделить save_config на специализированные обработчики (SRP)

**Файл:** `src-tauri/src/commands/mod.rs` (строки 145-187)
**Проблема:** Функция выполняет 5 разных задач: валидация, сохранение, управление hotkey, overlay и события
**Серьезность:** HIGH
**Оценка:** 1.5-2 часа

### Текущий код:
```rust
pub async fn save_config(...) -> Result<(), String> {
    // 1. Load old config for change detection
    let old_config = factory.config().load().unwrap_or_default();

    // 2. Validate config
    let errors = crate::config::validate_config(&config);
    if !errors.is_empty() { return Err(...); }

    // 3. Save config
    factory.config().save(&config).cmd_err()?;

    // 4. Restart hotkey if changed
    if old_config.hotkey != config.hotkey {
        listener.restart(app.clone(), &config.hotkey);
    }

    // 5. Reinit overlay if changed
    if old_config.overlay != config.overlay {
        app_state.orchestrator.reinit_overlay(&config).await;
    }

    // 6. Emit event
    app.emit("config-changed", ())?;
}
```

### План:
1. Создать `src-tauri/src/config/change_handler.rs`
2. Реализовать trait `ConfigChangeHandler`:
   ```rust
   pub trait ConfigChangeHandler: Send + Sync {
       fn should_handle(&self, old: &AppConfig, new: &AppConfig) -> bool;
       async fn handle(&self, app: &AppHandle, new: &AppConfig) -> Result<(), String>;
   }
   ```
3. Реализовать `HotkeyChangeHandler`, `OverlayChangeHandler`
4. Упростить `save_config` до ~15 строк

---

## Рекомендация #2: Извлечь создание tracker в execute_suggestion_action (DRY)

**Файл:** `src-tauri/src/commands/mod.rs` (строки 71-96)
**Проблема:** `create_tracker` вызывается 3-4 раза в match-выражении
**Серьезность:** MEDIUM
**Оценка:** 30 минут

### Текущий код:
```rust
fn execute_suggestion_action(
    factory: &StorageFactory,
    action: SuggestionAction,
    target: SuggestionTarget,
) -> Result<(), String> {
    match (action, target) {
        (SuggestionAction::Approve, SuggestionTarget::ById(id)) => {
            let tracker = create_tracker(factory)?;  // Создается здесь
            tracker.approve(id).cmd_err()
        }
        (SuggestionAction::Approve, SuggestionTarget::BySource(source, replacement)) => {
            let tracker = create_tracker(factory)?;  // И здесь
            tracker.approve_by_source(&source, &replacement).cmd_err()
        }
        (SuggestionAction::Reject, SuggestionTarget::ById(id)) => {
            let tracker = create_tracker(factory)?;  // И здесь
            tracker.reject(id).cmd_err()
        }
        (SuggestionAction::Reject, SuggestionTarget::BySource(source, replacement)) => {
            factory.corrections().reject_by_source(&source, &replacement).cmd_err()
            // Внимание: здесь нет tracker! Несогласованность
        }
    }
}
```

### План:
1. Создать tracker один раз перед match:
   ```rust
   fn execute_suggestion_action(...) -> Result<(), String> {
       let tracker = create_tracker(factory)?;  // Один раз
       match (action, target) {
           (Approve, ById(id)) => tracker.approve(id).cmd_err(),
           (Approve, BySource(s, r)) => tracker.approve_by_source(&s, &r).cmd_err(),
           (Reject, ById(id)) => tracker.reject(id).cmd_err(),
           (Reject, BySource(s, r)) => tracker.reject_by_source(&s, &r).cmd_err(),
       }
   }
   ```

---

## Рекомендация #3: Создать PositionCalculator для overlay (KISS/SRP)

**Файл:** `src-tauri/src/overlay_native/mod.rs` (строки 334-355)
**Проблема:** 7-way match с вложенными closures для вычисления позиции
**Серьезность:** MEDIUM
**Оценка:** 1 час

### Текущий код:
```rust
fn calculate_position(&self, glfw_backend: &mut GlfwBackend, w: i32, h: i32) -> (i32, i32) {
    let mut result = (0, 0);
    let m = self.state_mgr.margin as i32;
    let position_config = self.state_mgr.position_config;

    glfw_backend.glfw.with_primary_monitor(|_, monitor| {
        if let Some(monitor) = monitor {
            let (_, _, mw, mh) = monitor.get_workarea();
            result = match position_config {
                OverlayPositionConfig::BottomLeft => (m, mh - h - m),
                OverlayPositionConfig::BottomRight => (mw - w - m, mh - h - m),
                OverlayPositionConfig::TopLeft => (m, m),
                OverlayPositionConfig::TopRight => (mw - w - m, m),
                OverlayPositionConfig::Center => ((mw - w) / 2, (mh - h) / 2),
                OverlayPositionConfig::TopCenter => ((mw - w) / 2, m),
                OverlayPositionConfig::BottomCenter => ((mw - w) / 2, mh - h - m),
            };
        }
    });
    result
}
```

### План:
1. Создать `src-tauri/src/overlay_native/position.rs`
2. Реализовать чистую функцию (без side effects, без closures):
   ```rust
   impl OverlayPositionConfig {
       pub fn calculate(
           self,
           monitor_width: i32,
           monitor_height: i32,
           window_width: i32,
           window_height: i32,
           margin: i32,
       ) -> (i32, i32) {
           let (mw, mh, w, h, m) = (monitor_width, monitor_height, window_width, window_height, margin);
           match self {
               Self::BottomLeft => (m, mh - h - m),
               Self::BottomRight => (mw - w - m, mh - h - m),
               // ...
           }
       }
   }
   ```
3. Покрыть unit-тестами все 7 вариантов

---

## Рекомендация #4: Извлечь mutex helper методы в AudioRecorder (DRY)

**Файл:** `src-tauri/src/audio/mod.rs` (строки 310-346)
**Проблема:** Повторяющийся паттерн lock-operate-release в 3+ блоках
**Серьезность:** MEDIUM
**Оценка:** 45 минут

### Текущий код:
```rust
pub fn stop(&self) -> Result<Vec<u8>, AudioError> {
    // Block 1: Send stop command
    {
        let stop_tx = self.stop_tx.lock().unwrap();
        if let Some(ref tx) = *stop_tx {
            let _ = tx.send(RecordCommand::Stop);
        }
    }

    // Block 2: Wait for thread
    {
        let mut thread_handle = self.thread_handle.lock().unwrap();
        if let Some(handle) = thread_handle.take() {
            let _ = handle.join();
        }
    }

    // Block 3: Clear sender
    {
        let mut stop_tx = self.stop_tx.lock().unwrap();
        *stop_tx = None;
    }

    // Block 4: Get samples
    let samples = {
        let samples_guard = self.samples.lock().unwrap();
        samples_guard.clone()
    };
    // ...
}
```

### План:
1. Создать helper методы:
   ```rust
   impl AudioRecorder {
       fn send_stop_command(&self) {
           if let Some(ref tx) = *self.stop_tx.lock().unwrap() {
               let _ = tx.send(RecordCommand::Stop);
           }
       }

       fn join_recording_thread(&self) {
           if let Some(handle) = self.thread_handle.lock().unwrap().take() {
               let _ = handle.join();
           }
       }

       fn clear_stop_sender(&self) {
           *self.stop_tx.lock().unwrap() = None;
       }

       fn get_samples(&self) -> Vec<f32> {
           self.samples.lock().unwrap().clone()
       }
   }
   ```
2. Упростить `stop()`:
   ```rust
   pub fn stop(&self) -> Result<Vec<u8>, AudioError> {
       if !self.is_recording.load(Ordering::SeqCst) {
           return Err(AudioError::NotRecording);
       }
       self.send_stop_command();
       self.join_recording_thread();
       self.clear_stop_sender();
       let samples = self.get_samples();
       samples_to_wav(&samples, self.sample_rate.load(Ordering::SeqCst))
   }
   ```

---

## Рекомендация #5: Создать ResponseParser для LLM (KISS/OCP)

**Файл:** `src-tauri/src/llm/processor.rs` (строки 137-165)
**Проблема:** 3 fallback-стратегии парсинга с локальной struct definition
**Серьезность:** MEDIUM
**Оценка:** 1-1.5 часа

### Текущий код:
```rust
fn parse_response(&self, content: &str, original_text: &str) -> Result<LlmResult, ...> {
    let json_str = self.extract_json(content);

    // Try 1: Parse as LlmResult
    if let Ok(result) = serde_json::from_str::<LlmResult>(&json_str) {
        return Ok(self.validate_result(result, original_text));
    }

    // Try 2: Parse as suggestions-only (LOCAL STRUCT!)
    #[derive(Deserialize)]
    struct SuggestionsOnlyResult { suggestions: Vec<DictionarySuggestion> }

    if let Ok(result) = serde_json::from_str::<SuggestionsOnlyResult>(&json_str) {
        return Ok(LlmResult { text: original_text.to_string(), suggestions: result.suggestions });
    }

    // Try 3: Fallback
    tracing::warn!("Failed to parse LLM response as JSON: {}", content);
    Ok(LlmResult { text: original_text.to_string(), suggestions: Vec::new() })
}
```

### План:
1. Создать `src-tauri/src/llm/parser.rs`
2. Вынести `SuggestionsOnlyResult` на уровень модуля
3. Создать отдельные функции-парсеры:
   ```rust
   fn try_parse_full_result(json: &str) -> Option<LlmResult>;
   fn try_parse_suggestions_only(json: &str, original: &str) -> Option<LlmResult>;
   fn fallback_result(original: &str) -> LlmResult;
   ```
4. Добавить unit-тесты для каждого формата

---

## Рекомендация #6: Создать useProviderForm hook (DRY/SRP)

**Файл:** `src/components/settings/ProviderModal.tsx` (186 строк)
**Проблема:** Form state, validation и UI смешаны в одном компоненте
**Серьезность:** HIGH
**Оценка:** 1.5 часа

### Текущий код:
```typescript
// ProviderModal.tsx - 6 useState + validation + submit logic
const [name, setName] = useState(provider?.name ?? "");
const [apiUrl, setApiUrl] = useState(provider?.api_url ?? "");
const [modelsText, setModelsText] = useState("");
const [defaultModel, setDefaultModel] = useState(provider?.default_model ?? "");
const [error, setError] = useState<string | null>(null);
const [saving, setSaving] = useState(false);

const handleSubmit = () => {
    // 40 lines of validation + transform + submit logic
};
```

### План:
1. Создать `src/hooks/useProviderForm.ts`:
   ```typescript
   interface UseProviderFormResult {
     fields: {
       name: string; setName: (v: string) => void;
       apiUrl: string; setApiUrl: (v: string) => void;
       modelsText: string; setModelsText: (v: string) => void;
       defaultModel: string; setDefaultModel: (v: string) => void;
     };
     error: string | null;
     saving: boolean;
     handleSubmit: () => Promise<void>;
     reset: () => void;
   }

   export function useProviderForm(
     provider: LlmProvider | undefined,
     onSave: (p: Omit<LlmProvider, "builtin">) => Promise<void>,
     onClose: () => void
   ): UseProviderFormResult;
   ```
2. Упростить ProviderModal до ~80 строк чистого UI
3. Добавить тесты для hook

---

## Рекомендация #7: Извлечь EntryDisplay компонент (DRY)

**Файлы:** `src/components/dictionary/DictionaryEntry.tsx`, `PendingSection.tsx`, `AddEntryForm.tsx`
**Проблема:** Повторяющийся паттерн "source → replacement" отображения
**Серьезность:** LOW-MEDIUM
**Оценка:** 30 минут

### Текущий код:
```typescript
// DictionaryEntry.tsx:75
<span className="dictionary-source">{entry.source}</span>
<span className="dictionary-arrow">→</span>
<span className="dictionary-replacement">{entry.replacement}</span>

// PendingSection.tsx:91-93
<span className="pending-source">{suggestion.source}</span>
<span className="pending-arrow">→</span>
<span className="pending-replacement">{suggestion.replacement}</span>

// AddEntryForm.tsx:37
<span className="dictionary-arrow">→</span>
```

### План:
1. Создать `src/components/dictionary/EntryDisplay.tsx`:
   ```typescript
   interface EntryDisplayProps {
     source: string;
     replacement: string;
     classPrefix?: "dictionary" | "pending";
   }

   function EntryDisplay({ source, replacement, classPrefix = "dictionary" }: EntryDisplayProps) {
     return (
       <>
         <span className={`${classPrefix}-source`}>{source}</span>
         <span className={`${classPrefix}-arrow`}>→</span>
         <span className={`${classPrefix}-replacement`}>{replacement}</span>
       </>
     );
   }
   ```
2. Использовать во всех 3 местах
3. Добавить тесты

---

## Рекомендация #8: Разбить ProviderSelect на подкомпоненты (SRP)

**Файл:** `src/components/settings/ProviderSelect.tsx` (143 строки)
**Проблема:** Компонент управляет provider select, model select, API URL display и modal state
**Серьезность:** MEDIUM
**Оценка:** 1 час

### Текущая структура (слишком много ответственностей):
- Provider dropdown
- Model dropdown
- API URL display
- Add/Edit/Delete buttons
- Modal state management

### План:
1. Уже извлечён `ProviderActions.tsx` (done)
2. Извлечь `ProviderDropdown.tsx` — только выбор провайдера
3. Извлечь `ModelDropdown.tsx` — только выбор модели
4. Оставить `ProviderSelect.tsx` как composition wrapper (~60 строк)
5. Тесты для каждого подкомпонента

---

## Рекомендация #9: Упростить setNestedValue (KISS)

**Файл:** `src/hooks/useSettings.ts` (строки 22-44)
**Проблема:** Избыточная конвертация `Object.fromEntries(Object.entries(...))`
**Серьезность:** LOW
**Оценка:** 15 минут

### Текущий код:
```typescript
function setNestedValue(obj: AppConfig, path: string, value: unknown): AppConfig {
  const parts = path.split(".");
  if (parts.length === 1) {
    return { ...obj, [path]: value } as AppConfig;
  }

  const [parent, child] = parts;
  const parentObj = obj[parent as keyof AppConfig];
  if (typeof parentObj === "object" && parentObj !== null) {
    return {
      ...obj,
      [parent]: {
        ...Object.fromEntries(Object.entries(parentObj as object)),  // Избыточно!
        [child]: value,
      },
    };
  }
  return obj;
}
```

### План:
1. Упростить до:
   ```typescript
   return {
     ...obj,
     [parent]: {
       ...(parentObj as Record<string, unknown>),
       [child]: value,
     },
   };
   ```

---

## Рекомендация #10: Извлечь EditDictionaryEntryForm (SRP)

**Файл:** `src/components/dictionary/DictionaryEntry.tsx` (90 строк)
**Проблема:** Компонент обрабатывает и view и edit режимы с разной логикой
**Серьезность:** LOW-MEDIUM
**Оценка:** 45 минут

### Текущий код:
```typescript
function DictionaryEntry({ entry, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(entry.source);
  const [replacement, setReplacement] = useState(entry.replacement);
  const [saving, setSaving] = useState(false);

  // ... handlers

  return editing ? (
    // 30+ lines of edit form UI
    <div className="dictionary-entry editing">...</div>
  ) : (
    // 20+ lines of view mode UI
    <div className="dictionary-entry">...</div>
  );
}
```

### План:
1. Создать `src/components/dictionary/EditDictionaryEntryForm.tsx`:
   ```typescript
   interface Props {
     entry: DictionaryEntryType;
     onSave: (source: string, replacement: string) => Promise<void>;
     onCancel: () => void;
   }

   function EditDictionaryEntryForm({ entry, onSave, onCancel }: Props) {
     // Form state and handlers
     // Return edit form UI only
   }
   ```
2. Упростить `DictionaryEntry.tsx`:
   ```typescript
   return editing ? (
     <EditDictionaryEntryForm entry={entry} onSave={handleSave} onCancel={handleCancel} />
   ) : (
     <div className="dictionary-entry">
       <EntryDisplay source={entry.source} replacement={entry.replacement} />
       {/* buttons */}
     </div>
   );
   ```
3. Тесты для EditDictionaryEntryForm

---

# Сводная таблица

| # | Описание | Тип | Файл | Оценка |
|---|----------|-----|------|--------|
| 1 | ConfigChangeHandler trait | SRP | commands/mod.rs | 1.5-2ч |
| 2 | Извлечь tracker creation | DRY | commands/mod.rs | 30мин |
| 3 | PositionCalculator | KISS/SRP | overlay_native/mod.rs | 1ч |
| 4 | Mutex helper методы | DRY | audio/mod.rs | 45мин |
| 5 | ResponseParser chain | KISS/OCP | llm/processor.rs | 1-1.5ч |
| 6 | useProviderForm hook | DRY/SRP | ProviderModal.tsx | 1.5ч |
| 7 | EntryDisplay компонент | DRY | dictionary/*.tsx | 30мин |
| 8 | ProviderSelect подкомпоненты | SRP | ProviderSelect.tsx | 1ч |
| 9 | Упростить setNestedValue | KISS | useSettings.ts | 15мин |
| 10 | EditDictionaryEntryForm | SRP | DictionaryEntry.tsx | 45мин |

**Общая оценка:** 8-10 часов

---

# Порядок выполнения

## Приоритет 1 (HIGH impact):
1. **#1** — ConfigChangeHandler (SRP, Rust) — наибольший impact
2. **#6** — useProviderForm hook (DRY/SRP, TypeScript) — 186 строк → 80 строк

## Приоритет 2 (MEDIUM impact):
3. **#3** — PositionCalculator (KISS) — чистая функция + тесты
4. **#5** — ResponseParser (KISS/OCP) — убрать локальную struct
5. **#2** — Tracker creation (DRY) — быстрый fix
6. **#4** — Mutex helpers (DRY) — улучшение читаемости

## Приоритет 3 (LOW-MEDIUM impact):
7. **#8** — ProviderSelect subcomponents (SRP)
8. **#7** — EntryDisplay component (DRY)
9. **#10** — EditDictionaryEntryForm (SRP)
10. **#9** — setNestedValue simplification (KISS) — 15 минут

---

# Позитивные паттерны (сохранить)

- ✅ **fieldRegistry** — OCP-совместимая система полей
- ✅ **settingsRegistry** — декларативные настройки
- ✅ **useAsyncData/useAsyncAction** — DRY для async операций
- ✅ **AsyncPageContent** — централизованный loading/error/empty
- ✅ **Waveform reducer** — правильное использование useReducer
- ✅ **ProviderActions** — уже извлечён (Round 5)
- ✅ **Тестовое покрытие** — 721 тест TypeScript, 287 тестов Rust

---

# Верификация

```bash
# Rust
cd src-tauri && cargo test && cargo clippy -- -D warnings

# TypeScript
bun run vitest run
bun run tsc --noEmit

# Full check
bun run tauri dev
```
