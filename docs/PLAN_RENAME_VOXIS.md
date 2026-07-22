# План переименования: SoupaWhisper → Voxis (v2 — после areview)

Принципы: **SOLID** (единый источник правды), **DRY** (никаких повторов имени), **KISS** (минимум изменений, без переименования того, что не видит пользователь).

> **v2**: переработан после мульти-агентного ревью (reviewer-gpt55-arch + reviewer-gpt55-risk).
> Устранены 2 блокера: (B1) миграция скипалась, т.к. `init_logging()` создаёт новый каталог
> раньше `AppPaths::new()`; (B2) split-brain между `dirs::config_dir().join("voxis")` и
> Tauri `app_config_dir()` (= `config_dir/<identifier>`), используемым в `debug_socket.rs`.

## Ревью-вердикт (кратко)
| Находка | Severity | Как учтено |
|---|---|---|
| B1: миграция скипается — logging создаёт `voxis/logs` до `AppPaths::new()` | blocker | Миграция вынесена в самое начало `run()`, ДО `init_logging()`; толерантна к каталогу, где есть только `logs/` |
| B2: split-brain `voxis` vs `app_config_dir()`=`<identifier>` (debug_socket) | blocker | Единый резолвер в `storage::paths`; `debug_socket`/`logging`/`themes` берут путь ТОЛЬКО из него |
| `fs::rename` не робастен (EXDEV, гонки, частичный dst) | major | Copy-fallback при EXDEV; не удаляем старое при ошибке; идемпотентность |
| Смена identifier ломает macOS TCC/подпись/апдейты | major | Решение вынесено юзеру; по умолчанию — оставляем `com.soupawhisper.voice` |
| `APP_CONFIG_DIR` не место в `config/consts.rs` (SRP) | major | Константы+резолвер живут в `storage::paths` |
| Централизуется строка, а не поведение резолвинга | major | Централизуем функцию-резолвер, а не только строку |
| grep-проверка ломается о `soupawhisper.log` (logging.rs:83) | minor | Уточнён grep + строка за legacy-константой |
| Rust-тест читает реальный `~/.config/soupawhisper` | minor | Гейт за env-var, tempdir по умолчанию |
| debug_socket импортит unix-сокеты безусловно (Windows) | minor | Вне scope ребренда; помечено как отдельная задача |

## Классификация вхождений (что меняем, что НЕТ)

| Категория | Действие | Обоснование |
|---|---|---|
| Пользовательское брендирование (product/title/appTitle/welcome/диалоги) | **Меняем → Voxis** | Это лицо продукта |
| Имя config-директории `soupawhisper` (4 хардкода) | **Централизуем + мигрируем → `voxis`** | DRY + без потери данных юзеров |
| Bundle identifier `com.soupawhisper.voice` | **Меняем → `com.voxis.app`** | Ребренд; согласуем с config-dir |
| Комментарии "Python soupawhisper", "TALRI semantics" | **НЕ трогаем** | Корректная историческая ссылка на upstream |
| Внутр. крейт/бинарь `voice`/`voice_lib`, `localStorage talri.cell.*` | **НЕ трогаем** | KISS: не видно юзеру, переименование = лишний churn/риск |

---

## Фаза 1 — Единый резолвер пути (SOLID/SRP + DRY)

**Проблема:** `"soupawhisper"` захардкожено в 4 местах С РАЗНОЙ логикой fallback:
- `paths.rs:24-29` — `dirs::config_dir().ok_or(...)?.join("soupawhisper")`
- `state.rs:79-82` — `dirs::config_dir().unwrap_or_default().join("soupawhisper").join("themes")`
- `logging.rs:22-25` — `dirs::config_dir()...` fallback `"."`
- `debug_socket.rs:124-129` — `app.path().app_config_dir()` СНАЧАЛА, потом fallback `.join("soupawhisper")`

Централизуем **функцию-резолвер**, а не только строку (ревью: строки мало).

1. В `src-tauri/src/storage/paths.rs` (НЕ в `config/consts.rs` — SRP: это storage-слой):
   ```rust
   /// Имя каталога данных приложения в config_dir ОС. Единственная точка правды.
   pub const APP_CONFIG_DIR: &str = "voxis";
   /// Legacy-каталог для одноразовой миграции данных пользователя.
   pub const LEGACY_CONFIG_DIR: &str = "soupawhisper";

   /// Канонический каталог данных приложения. ОДИН резолвер для всех:
   /// storage, logging, themes, debug socket. НЕ использовать app_config_dir()
   /// напрямую нигде (иначе split-brain через identifier).
   pub fn app_config_dir() -> Option<PathBuf> {
       dirs::config_dir().map(|d| d.join(APP_CONFIG_DIR))
   }
   ```
2. `AppPaths::new()` использует `app_config_dir()`; `state.rs` берёт `AppPaths::themes_dir()` вместо своей конструкции; `logging.rs` берёт `paths::app_config_dir()`; `debug_socket.rs` берёт путь из общего резолвера (НЕ `app_config_dir()` Tauri).
3. **Единственная точка истины** — путь и его fallback-поведение определены один раз.

**Проверка:** `grep -rn 'app_config_dir()' src-tauri/src` — Tauri-версия НЕ используется для путей данных; `grep -rn '"soupawhisper"' src-tauri/src --include=*.rs | grep -viE "python|legacy|// |/// |LEGACY_CONFIG_DIR"` → пусто.

---

## Фаза 2 — Миграция данных (без потери) — КРИТИЧНО: до logging

**B1-фикс:** миграция ДОЛЖНА выполняться ПЕРВОЙ в `run()` (`lib.rs`), ДО `setup::init_logging()`
(стр.174), иначе logging создаст `voxis/logs` и наивный guard `!new_dir.exists()` пропустит
старые данные. Ревьюеры оба отметили это как блокер.

Чистая тестируемая функция `paths::migrate_legacy_config_dir()`:
```rust
pub fn migrate_legacy_config_dir() -> std::io::Result<()> {
    let Some(base) = dirs::config_dir() else { return Ok(()); };
    let new_dir = base.join(APP_CONFIG_DIR);
    let old_dir = base.join(LEGACY_CONFIG_DIR);
    if !old_dir.exists() { return Ok(()); }           // нечего мигрировать
    // Толерантность к частичному dst: считаем "мигрировано", только если в new
    // уже есть реальные данные (config.db). Наличие только logs/ не блокирует.
    let new_has_data = new_dir.join("config.db").exists();
    if new_has_data { return Ok(()); }                // уже мигрировано — идемпотентно
    match std::fs::rename(&old_dir, &new_dir) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(libc::EXDEV) => copy_dir_then_swap(&old_dir, &new_dir),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => merge_dirs(&old_dir, &new_dir), // dst=logs-only
        Err(e) => Err(e), // НЕ удаляем старое; поднимаем ошибку с логом
    }
}
```
Правила (из ревью):
- **Порядок:** вызвать в самом начале `run()` до `init_logging()`.
- **EXDEV / кросс-ФС:** copy → validate → atomic swap; старое НЕ удаляем до успеха.
- **Частичный dst (`voxis/logs` уже есть):** merge, а не skip.
- **Гонки/повторный старт:** идемпотентность через проверку `config.db`; `AlreadyExists` не фатально.
- **Никогда не стартуем с пустыми дефолтами, пока есть legacy-данные.**
- Логируем факт миграции (после init логгера — событие через eprintln до логгера).

**Тесты (все ветки, ревью п.6):** happy-path; dst содержит только `logs/`; обе папки с данными;
два параллельных вызова; ошибка rename (инъекция); EXDEV→copy-fallback. Всё на `tempdir`, без чтения реального `~/.config`.

---

## Фаза 3 — Брендирование (tauri.conf.json)

`src-tauri/tauri.conf.json`:
- `"productName": "SoupaWhisper"` → `"Voxis"`
- `app.windows[0].title: "SoupaWhisper"` → `"Voxis"`
- `bundle.macOS.signingIdentity: "TALRI Dev"` → `"Voxis Dev"`
- **`"identifier": "com.soupawhisper.voice"` → `"top.voxis.app"`** (решение юзера; совпадает с доменом `voxis.top`).
  Нюанс (ревью-major #4): на macOS это новая identity → сброс TCC-разрешений и потеря update-континуитета.
  Некритично: старое окружение всё равно будет удалено; пути данных отвязаны от identifier (Фаза 1),
  миграция истории/настроек работает независимо. На Linux (текущая платформа) без последствий.

`src-tauri/Cargo.toml`: `authors = ["SoupaWhisper"]` → `authors = ["Voxis"]`.

---

## Фаза 4 — Брендирование (frontend / i18n)

- `src/i18n/locales/en.json`: `appTitle "SoupaWhisper 2"` → `"Voxis"`; `welcome "Welcome to SoupaWhisper"` → `"Welcome to Voxis"`.
- `src/i18n/locales/ru.json`: `appTitle "SoupaWhisper 2"` → `"Voxis"`; `welcome "Добро пожаловать в SoupaWhisper"` → `"Добро пожаловать в Voxis"`.
- `src-tauri/src/permissions/macos.rs` (2 диалога): `"SoupaWhisper needs ..."` → `"Voxis needs ..."`.
- `src-tauri/src/commands/suggestions.rs:415`: пример `"SoupaWhisper"` → `"Voxis"`.
- `src-tauri/templates/theme_example.toml`: заголовок + путь в комментарии → `voxis`.
- `package.json`: `"name": "voice-tauri"` → `"voxis"` (косметика, безопасно).

---

## Фаза 5 — Обновление тестов (иначе упадут)

- `e2e/themes.spec.ts` (строки ~102,106,246): путь `soupawhisper` → `voxis`.
- `e2e/helpers/nativeOverlay.ts`, `handyGallery.ts`: пути/сокет `soupawhisper` → `voxis`; id `com.soupawhisper.voice` → `top.voxis.app`. Сокет теперь в `voxis/debug.sock` (единый резолвер, НЕ через identifier).
- `src/test/mocks/tauri.ts:174`, `src/lib/__tests__/commands.test.ts`: `.config/soupawhisper/debug` → `.config/voxis/debug`.
- `src/components/__tests__/Layout.test.tsx` (3 места): ожидание `"SoupaWhisper 2"` → `"Voxis"`.
- `storage/history_sqlite.rs:486-515` читает реальный `~/.config/soupawhisper/history.db` и печатает фрагменты истории (ревью-minor #7). Гейтим за `#[ignore]` + env `VOXIS_TEST_REAL_HISTORY_DB`; по умолчанию `cargo test` НЕ читает реальный `~/.config`.

---

## Фаза 6 — Верификация (evidence before done)

```bash
cd src-tauri && cargo test
bun run test:run
bun run lint
# Нет новых хардкодов имени (разрешены: python-комментарии, LEGACY_CONFIG_DIR, stale-log cleanup):
grep -rn '"soupawhisper"' src-tauri/src src --include=*.rs --include=*.ts --include=*.tsx \
  | grep -viE "python|legacy|LEGACY_CONFIG_DIR|soupawhisper\.log|// |/// "   # ожидаем пусто
# Tauri app_config_dir() НЕ используется для путей данных (единый резолвер):
grep -rn 'app_config_dir()' src-tauri/src
```
Сборка релиза (опционально): `bun run tauri build` — убедиться, что бандл называется `Voxis`.

### Отложено (вне scope ребренда — ревью-minor #5)
- `debug_socket.rs:31` безусловно импортирует `std::os::unix::net::UnixListener` — не соберётся на Windows debug. Предложено `#[cfg(all(debug_assertions, unix))]`. Отдельная задача.

---

## Фаза 7 — Переименование репозитория

1. **GitHub:** `axelbaumlisto/voice` → `axelbaumlisto/voxis` (Settings → Rename). GitHub держит редирект со старого URL.
2. **Локальный remote:**
   ```bash
   git remote set-url origin https://github.com/axelbaumlisto/voxis.git
   ```
3. **gitverse** remote — **ОСТАВЛЯЕМ как есть** (решение юзера): `zverozabr/voice` не переименовываем.
4. **Локальная папка** `~/work/soupawhisper` → `~/work/voxis` (решение юзера, последним шагом):
   ```bash
   cd ~/work && mv soupawhisper voxis
   ```
   Выполнять, когда нет запущенных сборок/dev-серверов из этой папки. Лаунчеры `~/.local/bin/soupawhisper*` — отдельно (ниже).
   ⚙️ После `mv` текущая pi-сессия останется в старом (удалённом) cwd — потребуется перезапуск/`cd`.

---

## Вне репозитория (отдельно, по желанию)
- `~/.local/bin/soupawhisper`, `soupawhisper-gui`, `~/.local/share/applications/soupawhisper.desktop` — установленные лаунчеры; обновляются при переустановке бандла.

---

## Порядок исполнения
Фаза 1 → 2 (код+миграция вместе, атомарный коммит) → 3 → 4 → 5 → 6 (верификация) → **коммит** → 7 (репозиторий).
Каждая фаза = отдельный логический коммит; ничего не пушим до зелёной верификации и твоего ОК на переименование репо.
