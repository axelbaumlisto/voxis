# ТОП-10 Самых Слабых Мест — План Улучшения

## Методика Оценки

**Формула:** `ratio = lines / tests` (чем выше ratio, тем хуже покрытие)

| Оценка | Ratio | Статус |
|--------|-------|--------|
| 10/10 | < 15 | Отлично |
| 8/10 | 15-30 | Хорошо |
| 6/10 | 30-50 | Нормально |
| 4/10 | 50-100 | Плохо |
| 2/10 | > 100 | Критично |

---

## ТОП-10 Слабых Мест (Отсортировано по Критичности)

| # | Файл | Строк | Тестов | Ratio | Оценка | Проблема |
|---|------|-------|--------|-------|--------|----------|
| 1 | `llm/processor.rs` | 346 | 2 | **173** | 2/10 | TDD: Критически мало тестов |
| 2 | `storage/config_ini.rs` | 329 | 2 | **164** | 2/10 | TDD: Почти без тестов |
| 3 | `commands/suggestions.rs` | 285 | 3 | **95** | 3/10 | TDD: Недостаточно тестов |
| 4 | `storage/providers.rs` | 384 | 5 | **76** | 4/10 | TDD: Слабое покрытие |
| 5 | `storage/debug_storage.rs` | 221 | 3 | **73** | 4/10 | TDD: Слабое покрытие |
| 6 | `storage/config_sqlite.rs` | 286 | 4 | **71** | 4/10 | TDD: Слабое покрытие |
| 7 | `audio/mod.rs` | 433 | 8 | **54** | 5/10 | TDD + SRP: Большой файл |
| 8 | `setup.rs` | 367 | 7 | **52** | 5/10 | TDD: Слабое покрытие |
| 9 | `transcription/mod.rs` | 470 | 9 | **52** | 5/10 | TDD: Нужно больше тестов |
| 10 | `storage/corrections_sqlite.rs` | 467 | 9 | **51** | 5/10 | TDD: Нужно больше тестов |

**DRY Проблемы (дополнительно):**
- 4× дублирование `fn connect(&self)` в storage модулях
- 65× использование `Box<dyn std::error::Error>` (нет единого Result type)

---

## План Улучшения

### Приоритет 1: Критические (ratio > 100)

#### 1.1 `llm/processor.rs` (346 строк, 2 теста → +15 тестов)

**Текущее состояние:** Только 2 теста для пустого/whitespace текста.

**Нужно добавить тесты:**
```rust
#[cfg(test)]
mod tests {
    // Существующие
    #[test] fn test_process_empty_text() { }
    #[test] fn test_process_whitespace_only() { }

    // НОВЫЕ (mockito integration)
    #[tokio::test] async fn test_successful_processing() { }
    #[tokio::test] async fn test_api_error_401() { }
    #[tokio::test] async fn test_api_error_500() { }
    #[tokio::test] async fn test_rate_limit_429() { }
    #[tokio::test] async fn test_empty_choices_response() { }
    #[tokio::test] async fn test_malformed_json_response() { }
    #[tokio::test] async fn test_timeout_error() { }

    // Unit tests
    #[test] fn test_processor_new() { }
    #[test] fn test_config_fields() { }
}
```

**Ожидаемый результат:** ratio 346/17 ≈ 20 (8/10)

---

#### 1.2 `storage/config_ini.rs` (329 строк, 2 теста → +12 тестов)

**Проблема:** INI парсер без тестов для edge cases.

**Нужно добавить тесты:**
```rust
#[cfg(test)]
mod tests {
    #[test] fn test_load_nonexistent_file() { }
    #[test] fn test_load_empty_file() { }
    #[test] fn test_load_api_section() { }
    #[test] fn test_load_groq_section_compatibility() { }
    #[test] fn test_load_recording_section() { }
    #[test] fn test_load_behavior_section() { }
    #[test] fn test_load_text_section() { }
    #[test] fn test_load_llm_section() { }
    #[test] fn test_save_and_reload() { }
    #[test] fn test_partial_config() { }
    #[test] fn test_boolean_parsing() { }
    #[test] fn test_integer_parsing_invalid() { }
}
```

**Ожидаемый результат:** ratio 329/14 ≈ 23 (8/10)

---

### Приоритет 2: Плохие (ratio 50-100)

#### 2.1 `commands/suggestions.rs` (285 строк, 3 теста → +10 тестов)

**Тесты для добавления:**
```rust
#[test] fn test_create_tracker() { }
#[test] fn test_execute_approve_by_id() { }
#[test] fn test_execute_reject_by_id() { }
#[test] fn test_execute_approve_by_source() { }
#[test] fn test_execute_reject_by_source() { }
#[test] fn test_build_batch_llm_config() { }
#[test] fn test_collect_history_texts() { }
#[test] fn test_collect_history_texts_empty() { }
#[test] fn test_process_llm_suggestions() { }
#[test] fn test_process_llm_suggestions_filters_invalid() { }
```

**Ожидаемый результат:** ratio 285/13 ≈ 22 (8/10)

---

#### 2.2 `storage/providers.rs` (384 строк, 5 тестов → +10 тестов)

**Тесты для добавления:**
```rust
#[test] fn test_provider_serialize_deserialize() { }
#[test] fn test_provider_with_models() { }
#[test] fn test_provider_with_format() { }
#[test] fn test_load_empty_db() { }
#[test] fn test_save_and_load_provider() { }
#[test] fn test_update_existing_provider() { }
#[test] fn test_remove_nonexistent_provider() { }
#[test] fn test_list_all_providers() { }
#[test] fn test_builtin_providers_immutable() { }
#[test] fn test_connect_creates_schema() { }
```

**Ожидаемый результат:** ratio 384/15 ≈ 25 (8/10)

---

#### 2.3 `storage/debug_storage.rs` (221 строк, 3 теста → +8 тестов)

**Тесты для добавления:**
```rust
#[test] fn test_new_creates_directory() { }
#[test] fn test_save_audio_creates_file() { }
#[test] fn test_save_audio_filename_format() { }
#[test] fn test_rotate_keeps_max_files() { }
#[test] fn test_save_debug_entry() { }
#[test] fn test_load_debug_entries() { }
#[test] fn test_clear_old_entries() { }
#[test] fn test_save_with_transcription_log() { }
```

**Ожидаемый результат:** ratio 221/11 ≈ 20 (8/10)

---

#### 2.4 `storage/config_sqlite.rs` (286 строк, 4 теста → +8 тестов)

**Тесты для добавления:**
```rust
#[test] fn test_load_nonexistent_db() { }
#[test] fn test_save_creates_db() { }
#[test] fn test_save_and_load_cycle() { }
#[test] fn test_save_partial_update() { }
#[test] fn test_load_with_migration() { }
#[test] fn test_concurrent_access() { }
#[test] fn test_invalid_json_handling() { }
#[test] fn test_default_values_on_missing_keys() { }
```

**Ожидаемый результат:** ratio 286/12 ≈ 24 (8/10)

---

### Приоритет 3: DRY Рефакторинг

#### 3.1 Унифицировать `connect()` методы

**Проблема:** 4 файла дублируют паттерн:
```rust
fn connect(&self) -> Result<Connection, Box<dyn std::error::Error>> {
    open_with_schema(&self.path, |conn| { ... })
}
```

**Решение:** Создать trait `SqliteStorage`:
```rust
// storage/sqlite_base.rs
pub trait SqliteStorage {
    fn path(&self) -> &Path;
    fn init_schema(conn: &Connection) -> Result<(), Box<dyn std::error::Error>>;

    fn connect(&self) -> Result<Connection, Box<dyn std::error::Error>> {
        open_with_schema(self.path(), Self::init_schema)
    }
}
```

**Файлы для изменения:**
- `history_sqlite.rs` — impl SqliteStorage
- `corrections_sqlite.rs` — impl SqliteStorage
- `config_sqlite.rs` — impl SqliteStorage
- `providers.rs` — impl SqliteStorage

**Результат:** -40 строк дублирования

---

#### 3.2 Создать единый `AppResult` type alias

**Проблема:** 65 раз используется `Box<dyn std::error::Error>`

**Решение:**
```rust
// error.rs
pub type AppResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub type StorageResult<T> = Result<T, Box<dyn std::error::Error>>;
```

**Результат:** Более читаемый код, единообразие

---

## Ожидаемые Результаты

| Файл | До (ratio) | После (ratio) | Оценка |
|------|------------|---------------|--------|
| `llm/processor.rs` | 173 | ~20 | 2→8 |
| `storage/config_ini.rs` | 164 | ~23 | 2→8 |
| `commands/suggestions.rs` | 95 | ~22 | 3→8 |
| `storage/providers.rs` | 76 | ~25 | 4→8 |
| `storage/debug_storage.rs` | 73 | ~20 | 4→8 |
| `storage/config_sqlite.rs` | 71 | ~24 | 4→8 |

**Общее изменение:**
- Rust тестов: 442 → ~505 (+63)
- Средняя оценка: ~5.5/10 → ~8/10

---

## Время Выполнения

| Шаг | Задача | Время |
|-----|--------|-------|
| 1 | llm/processor.rs тесты | 1.5 часа |
| 2 | storage/config_ini.rs тесты | 1 час |
| 3 | commands/suggestions.rs тесты | 1 час |
| 4 | storage/providers.rs тесты | 45 мин |
| 5 | storage/debug_storage.rs тесты | 45 мин |
| 6 | storage/config_sqlite.rs тесты | 45 мин |
| 7 | DRY: SqliteStorage trait | 30 мин |
| **Итого** | | **~6.5 часов** |

---

## Команды для Верификации

```bash
# После каждого шага
cd src-tauri && cargo test && cargo clippy -- -D warnings

# Подсчёт тестов
cargo test 2>&1 | grep "test result"
# Цель: 500+ passed

# Проверка ratio
for f in $(find . -name "*.rs" -type f); do
  tests=$(grep -c "#\[test\]" "$f" 2>/dev/null || echo 0)
  lines=$(wc -l < "$f")
  if [ "$lines" -gt 100 ]; then
    ratio=$((lines / (tests + 1)))
    echo "ratio:$ratio tests:$tests $f"
  fi
done | sort -t: -k2 -rn | head -10
```
