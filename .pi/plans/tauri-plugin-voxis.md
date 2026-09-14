# tauri-plugin-voxis — диктовка Voxis как встраиваемый плагин (desktop + iOS), первый хост: naked

> **Ревизия v2 (2026-09-07)** после blind-раунда 1 (`research/plugin-plan/BLIND_review_{1,3,4}_*.md`:
> architecture / safety-security / migration-ordering; iOS-platform — отдельно). Все три —
> GO-WITH-CHANGES. Изменения помечены `[R1-<роль> <id>]` со ссылкой на находку.

## Context

Voxis сегодня — монолит `voice_lib` для macOS/Linux/Windows: hotkey (rdev) → запись (cpal)
→ Whisper HTTP (Groq-совместимый) → словарь → LLM → auto-type (enigo) / буфер. Хотим ту же
диктовку внутри чужого приложения — первым хостом будет **naked** (Tauri 2, React 19, Rust;
desktop macOS/Linux + iPadOS/iOS + Android), у которого уже есть готовый паттерн мобильных
плагинов (`crates/naked-plugin-{capture,lifecycle,spotlight}/` = `src/mobile.rs` +
`ios/Sources/*.swift` + `permissions/`).

Исследование (см. диалог 2026-09-07, источники: Apple docs, WWDC24 #10157, WWDC25 #253,
Wispr Flow docs «Adapting to iOS 26.4», OpenSuperWhisper #135, hex-iphone 6fff87f) зафиксировало
границы iOS, которые план **не пытается обойти**:

- Кнопки громкости как триггер — reject по guideline 2.5.9; `AVCaptureEventInteraction`
  работает только у приложения с активной камерой. **Не делаем.**
- Оверлей поверх *всех* приложений у third-party не существует. Есть: оверлей поверх
  **хоста** (легально, тривиально) + **Live Activity / Dynamic Island**, который система
  показывает, когда хост в фоне.
- Запись стартует только из foreground; keyboard-extension без микрофона; авто-возврат в
  предыдущее приложение закрыт в iOS 26.4. Всё это **не касается** нашего кейса — плагин живёт
  в процессе хоста.

Что просит пользователь: (1) плагин сбоку Voxis, импортируемый в чужой Tauri-хост;
(2) desktop Voxis **транслирует свои настройки и базу** в плагин; (3) на тач-экране — оверлей,
перемещаемый по экрану (как панели в naked), с продолжением в Dynamic Island; (4) горячая
клавиша; (5) активировать сначала в naked desktop, потом на iOS.

## Approach

**Три слоя, один контракт** (SOLID: плагин зависит от абстракций, хост — от плагина, Voxis
desktop — от того же ядра):

```
voxis-core (pure Rust, без Tauri/desktop-deps)         ← из voice_lib выносим ядро
   AppConfig + validation · storage traits + sqlite    · TranscriptionClient (reqwest/rustls)
   dictionary · llm · learning · stop_decision/guard-logic · VoxisProfile (export/import)
        ▲                                   ▲
voice_lib (Voxis desktop, без изменений     tauri-plugin-voxis  (crates/tauri-plugin-voxis)
поведения: cpal, rdev, enigo, tray, …)        Rust: commands + pipeline + AudioCapture trait
                                              desktop: cpal capture, global-shortcut hotkey
                                              ios/: Swift AVAudioEngine capture, Live Activity
                                              guest-js: <voxis-overlay> (theme-engine, drag),
                                                        in-app hotkey (keydown/keyup)
                                                    ▲
                                            хост (naked): кнопка/клавиша/hotkey → dictate()
                                                          → Promise<text> → вставка в терминал
```

Ключевые решения:

1. **Ядро выносится в `voxis-core`**, а не копируется. `voice_lib` становится его
   потребителем; тесты ядра переезжают. Критерий чистоты: `cargo build -p voxis-core
   --target aarch64-apple-ios` без feature-флагов. Это самый большой и самый ценный шаг.
2. **Плагин возвращает текст хосту, ничего не печатает и не кладёт в буфер сам** (хост знает,
   куда вставлять). Опция `copyToClipboard` — явная.
3. **Захват аудио — файл, не стрим** (KISS): Swift/cpal пишут 16 kHz mono WAV в
   **выделенный каталог плагина** `<host-cache>/voxis-plugin/rec/<session-uuid>.wav` (0600 на
   desktop; iOS `FileProtectionType.completeUnlessOpen` + `isExcludedFromBackup`), по `stop`
   отдают путь; уровень сигнала (RMS/пики) идёт отдельным `Channel` для оверлея.
   `[R1-Safety S5]` Файл удаляется в `Drop`/finally при **любом** исходе (result, cancel,
   NoSpeech, error), `init()` плагина безусловно чистит `rec/` (любой файл там — сирота).
   `[R1-Arch S2/S3]` Контракт `AudioCapture` переносит **оба** страховочных слоя desktop:
   (a) **self-cap** внутри бэкенда (`native_cap_samples`-эквивалент: cpal-callback / Swift
   перестают писать сами, даже если guard-task умер); (b) **liveness** — отсутствие тика
   `level_rx` N опросов при «running» = `StreamDied → Recover`, как `is_recording()==false` на
   desktop (ловит любую тихую смерть, не только именованное прерывание). Guard по тишине/длительности работает на тех же RMS-окнах, что и на desktop
   (`SILENCE_RMS` 0.02 — откалибровано на железе 2026-09-07; для iPhone-микрофона
   перекалибровать по реальному WAV, как делали для MacBook).
4. **Оверлей — веб-компонент в webview хоста**, монтирует существующий theme-engine
   (contract v1) — визуальный паритет с desktop. `[R1-Safety S3 / Arch T1]` Встроенные темы
   **бандлятся статически** как ES-модули (`ThemeRegistry` по id); `loader.ts` (Blob/data-URL
   `import()`) в плагин **не входит** — CSP naked `script-src 'self'` его блокирует, а
   ослаблять CSP терминала с SSH-ключами нельзя. Профиль несёт `theme` = id; неизвестный id →
   default + warn; пользовательские `theme.js` в хостах — вне scope. Перемещаемость:
   pointer-drag с персистом позиции (как `KeyPanel` в naked), прилипание к краям, safe-area.
   Dynamic Island — **iOS-only дополнение**: Live Activity показывается системой, когда хост
   ушёл в фон при идущей записи (audio background mode); там кнопка Stop. Пока хост в
   foreground, Dynamic Island не показывает свои же Live Activity — это поведение iOS, а не баг.
5. **Горячая клавиша — две реализации за одним интерфейсом**: desktop — **rdev**, как в
   `voice_lib::hotkey` `[R1-Migration S6]`: default Voxis `ctrl_r`/`alt_r` — *одиночный*
   модификатор, который `tauri-plugin-global-shortcut` не умеет (см. комментарий
   `src-tauri/src/hotkey/mod.rs:3-5`); модуль парсинга/машины hotkey переезжает в
   `voxis-core::hotkey` (feature `rdev`), плагин и Voxis используют один код. iPad с внешней
   клавиатурой / desktop-webview — `keydown`/`keyup` в JS (когда хост в фокусе). Обе — один
   `HotkeySpec`. `[R1-Safety S4]` Hold-режим имеет **Rust-side lease**: guest-js шлёт
   heartbeat `hold_lease` раз в 1 с; 3 пропуска → `cancel(LeaseLost)`; Tauri-хуки
   `on_page_load`/web-content-process-terminated → `cancel_all(Hold)`. Иначе смерть webview
   (naked F77: WebKit-процесс умирает, окно blank) оставляет микрофон открытым до 10 мин.
   Hold-режим дополнительно ограничен **120 с** независимо от профиля `[R1-Safety T4]`.
6. **Синк настроек и базы = `VoxisProfile`** (версионный JSON): provider, `api_url_override`,
   модель, язык, guard-таймауты, LLM (провайдеры + промпты, включая ключи), словарь, тема,
   hotkey. **Не синкаем** history / corrections / debug / failed_audio. Транспорт v1 —
   **снимок по требованию**, три пути:
   - **naked desktop на той же машине**: плагин читает профиль напрямую из config-dir
     Voxis (`voxis-core::storage::paths`) — ноль настройки, «активировать в naked desktop».
   - **iOS**: в Voxis desktop → «Поделиться профилем» → QR `[R1-Safety S1]` несёт
     `host, port, token, k_qr` (**256-битный случайный ключ**); `key = HKDF-SHA256(k_qr,
     info = "voxis-profile-v1" || code)`, где 6-значный код на экране — **только второй фактор**
     (защита от фото QR), не источник энтропии. Критик собрал Argon2-пробу: 10^6 кодов при
     OWASP-минимуме ≈ 18 ч на 8 потоках → «код + KDF» брутфорсится с перехваченного LAN-трафика;
     с `k_qr` шифртекст ≥ 2^128. Сервер слушает **только LAN-IP из QR** (не `0.0.0.0`), ответ
     константного размера, токен привязан к первому IP. QR сканирует **хост** (in-app) или
     строка вставляется руками — **без URL-схемы `voxis://`** `[R1-Safety T1]`: чужое
     приложение может зарегистрировать схему и получить токен+ключ.
   - **Файл** `voxis-profile.vxp` — **не 6-значный код**: случайная парольная фраза 5–6 слов
     (≥ 64 бит) или 26-символьный base32-ключ, показан один раз; Argon2id m=64 MiB, t=3, p=1
     (RFC 9106 вариант 2, p=1 для телефона) → ChaCha20-Poly1305. AirDrop/почта, импорт в плагине.
   - **Секреты не в sqlite** `[R1-Safety S2]`: API-ключи (`api_key`, `llm.api_key`) в профиле
     — bearer-креды с биллингом. Плагин объявляет `pub trait SecretStore { get/set/delete }`;
     хост инжектит свой (**naked уже имеет** `naked_core::SecretStore` с envelope-шифрованием и
     SECURITY.md о нём); default: iOS → Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`),
     desktop → `keyring` crate / 0600-файл с warn. `ProfileConfig` хранит `api_key_ref`;
     `apply_profile` отделяет секреты до записи в sqlite. Ключи — newtype `Secret(String)` с
     `Debug = [REDACTED]` и явным `expose()` `[R1-Safety S8]`.
   Живой двусторонний синк и сервер-хаб на spex — **вне этого плана** (см. Follow-ups).
7. **Транскрипция v1 — сервер** (тот же `TranscriptionClient`, Groq/`api_url_override`), как
   на desktop. On-device iOS 26 `SpeechAnalyzer` — Follow-up за `TranscriptionEngine` trait.
8. **Согласие и приватность хоста** `[R1-Safety S6]`: аудио и текст уходят third-party AI →
   App Store 5.1.2(i) требует явного согласия. `dictate()` отказывает до `set_consent(true)`
   (один раз на host+provider); плагин поставляет фрагмент `PrivacyInfo.xcprivacy` («Audio Data /
   Other User Content → App Functionality → shared with third-party AI: <provider>») и чеклист
   хосту (usage-description с именем STT-провайдера, абзац privacy policy, обоснование
   `UIBackgroundModes: audio` по 2.5.4). В Toggle-режиме оверлей держит **постоянный индикатор
   записи** (2.5.14) `[R1-Safety T7]`.

Что НЕ входит: standalone iOS-приложение Voxis (keyboard extension), Android (Kotlin-сторона
плагина — отдельный план после iOS), кнопки громкости, сервер-хаб.

## Гейты консистентности (чтобы не выяснить в конце, что не работает)

Вертикальная сборка происходит **дважды до naked**, а не один раз в T10:

1. **Tracer bullets**: T3.5 (desktop, `examples/host-min` + `MockCapture` + fake-STT, Playwright в
   CI) блокирует T4/T6/T7; T8.5 (iOS, `host-min` на iPad-стенде, реальный микрофон + fake-STT по
   LAN) блокирует T9/T11.
2. **Один контракт — одни фикстуры**: `crates/tauri-plugin-voxis/contract/fixtures/*.json`
   (команды, события, `DictationResult`, `VoxisProfile`) читают Rust-тесты плагина, vitest guest-js
   и позже обёртка naked. Расхождение типов = красное с обеих сторон в том же коммите.
3. **Детерминированный STT**: `crates/voxis-fake-stt` (axum, `/v1/audio/transcriptions`): на
   фикстурный WAV речи → фиксированный текст; на тишину → реальная галлюцинация из инцидента
   («Продолжение следует… Субтитры создавал DimaTorzok»). Без Groq/сети; один бинарь для CI,
   desktop и iPad (по LAN).
4. **Золотые WAV из hardware-сессии 2026-09-07** (`fixtures/audio/`: речь через динамики 5 с;
   тишина 17 с; шумовой пол 87 с MacBook Air) — фикстуры guard/pipeline на всех слоях; iOS-захват
   (T8) обязан проходить те же guard-тесты на своём выходе.
5. **iOS cross-build с T1** (`scripts/check-ios-build.sh` = `cargo build -p voxis-core
   -p tauri-plugin-voxis --target aarch64-apple-ios`). `[R1-Migration S5]` Честно: `ci.yml`
   — Linux-docker без Apple SDK, per-commit macOS-lane нет. Гейт исполняется (a) **в Verify
   каждой задачи через /ado на этом Mac** (Xcode есть) — это и есть per-commit enforcement на
   время плана; (b) в release-time macOS-VM lane (`release.yml`, Task 12 добавляет вызов
   скрипта, `continue-on-error: false` для этого шага). Не «блокирующий CI-гейт», а
   «блокирующий Verify-гейт».
6. **Регресс-гейт Voxis desktop после T1** (блокирующий): `cargo test --lib` ≥ 1037 зелёных +
   hardware-прогоны A/B/C на MacBook идентичны v0.1.5.
7. **Профиль round-trip**: `export(desktop-fixture) → import(plugin) → get_profile()` — хэш
   совпадает; в host-min автоматизировано — **владелец: Task 6** (Files/Verify) `[R1-Migration S4]`.
8. **naked** интегрируется против **тега** плагина; Playwright naked с mock-плагином на тех же
   фикстурах контракта.

## Tasks

### Phase 0 — ядро

### Task 1a: `voxis-core` — workspace + `config` + `storage` (механика, много тестов, низкий риск)
**Files:** `src-tauri/Cargo.toml` (workspace), `crates/voxis-core/{Cargo.toml,src/**}`,
`src-tauri/src/config/**` (кроме `change_handler.rs`), `src-tauri/src/storage/**` (кроме
`debug_storage.rs`, `failed_audio.rs`), `src-tauri/src/lib.rs`, `scripts/check-ios-build.sh`
**Acceptance:** `voxis-core` не зависит от `tauri`, `cpal`, `rdev`, `enigo`, `arboard`, `objc2*`,
`core-foundation`; `scripts/check-ios-build.sh` проходит; `[R1-Arch S1 / Migration S2]`
`storage/{mod.rs,paths.rs}` **разделены явно**: в core — чистая часть (`AppPaths::from_config_dir`,
path-builders, traits, sqlite, factory, `voxis_desktop_config_dir()`), в `voice_lib::storage` остаётся
тонкий tauri-shim (`AppPaths::new(&AppHandle)`, `get_app_paths`, `get_storage_factory`) с теми же
сигнатурами — вызовы из `orchestrator/mod.rs:38`, `setup/mod.rs:38`, `tray/mod.rs`,
`commands/overlay.rs`, `orchestrator/post_process.rs`, `orchestrator/transcription/*` не меняются;
`voice_lib` делает `pub use voxis_core::{config, storage}` + shim; `cargo test --lib` в `src-tauri`
= те же зелёные (≥ 1037 суммарно с core). `[R1-Safety T5]` **Data-gate**: фикстурный тест — снимок
реальной pre-T1 config-dir (config.db + history.db + dictionary.txt + providers.db + prompts.db) в
tempdir → post-T1 `factory` загружает → каждое поле равно golden JSON; лог старта утверждает
`config_dir == <путь v0.1.5>`.
**Verify:** `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && scripts/check-ios-build.sh`
**Steps:**
1. Workspace: `[workspace] members = [".", "crates/voxis-core"]` в `src-tauri/Cargo.toml`.
2. Перенести `config/` (AppConfig, consts, validation); `change_handler.rs` остаётся.
3. `storage/`: split `mod.rs`/`paths.rs` как в Acceptance; `libc::EXDEV`-миграция путей идёт в core
   (без tauri); shim в voice_lib.
4. `pub use` в `voice_lib`; перенести тесты; data-gate фикстура.
5. `scripts/check-ios-build.sh` (rustup target add, cargo build); прогнать.

### Task 1b: `voxis-core` — `transcription`, `llm`, `learning`, `audio_wav`, `hotkey`, guard-логика
**Files:** `src-tauri/src/{transcription,llm,learning}/**`, `src-tauri/src/audio/encoder.rs` →
`crates/voxis-core/src/audio_wav.rs`, `src-tauri/src/hotkey/**` → `crates/voxis-core/src/hotkey/**`
(feature `rdev`), `src-tauri/src/orchestrator/{recording.rs,recording_guard.rs}` (вынос чистых
функций), `src-tauri/src/lib.rs`, `crates/voxis-core/Cargo.toml`
**Depends:** Task 1a
**Acceptance:** `transcription/llm/learning` перенесены (grep подтверждает: там нет tauri/cpal —
`[R1-Arch verified]`); `[R1-Arch S4]` `audio::encoder` (`downsample`, `samples_to_wav`,
`wav_duration_ms`, `TRANSCRIPTION_SAMPLE_RATE`) → `voxis_core::audio_wav` — единственный
WAV-код для voice_lib, плагина и Swift-контракта; `[R1-Migration S6]` `hotkey` (парсинг
`HotkeySpec`, машина press/release, rdev-listener) → `voxis_core::hotkey` за feature `rdev`
(off по умолчанию → iOS-сборка без rdev); `[R1-Arch T2]` чистые функции `stop_decision`,
`press_action`, `StopReason/StopDecision/PressAction`, `guard_step`, `SilenceWindow`,
`native_cap_samples`, `effective_max_recording_ms` → `voxis_core::guard` с `pub`
(было `pub(crate)`), tokio-task остаётся в voice_lib; `reqwest` уже `rustls-tls`
(`Cargo.toml:87`, подтверждено) — только перенос; `mockito` → dev-dep core.
**Verify:** `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && scripts/check-ios-build.sh`
**Steps:**
1. Перенос трёх модулей + тестов.
2. `audio_wav.rs` из `encoder.rs`; voice_lib импортирует из core.
3. `hotkey` за feature; voice_lib включает feature.
4. `guard.rs`: вынос чистых функций, `pub`, тесты вместе с ними (включая калибровочный блок
   `SILENCE_RMS`).
5. iOS-таргет; `cfg`-утечки.

### Task 2: `VoxisProfile` — модель, экспорт/импорт, шифрование
**Files:** `crates/voxis-core/src/profile/{mod.rs,crypto.rs,tests.rs}`
**Depends:** Task 1b
**Acceptance:** `VoxisProfile { version: 1, config: ProfileConfig, dictionary: Vec<(String,String)>,
llm: { providers, prompts }, theme: String, hotkey: HotkeySpec }`; `Profile::from_storage(&dyn
ConfigStorage, &dyn DictionaryStorage, &dyn ProvidersStorage, &dyn PromptsStorage)` и
`apply_to(…)`; `[R1-Safety S1]` два источника ключа за одним `seal/open`:
`KeySource::Qr { k_qr: [u8;32], code }` → HKDF-SHA256(info=`voxis-profile-v1`||code) и
`KeySource::Passphrase(str)` → Argon2id(m=64 MiB, t=3, p=1, salt 16) — оба → ChaCha20-Poly1305,
формат `VXP1` + kdf-tag + salt + nonce + ct; неверный ключ → ошибка без паники;
`[R1-Safety S8]` `Secret(String)` newtype: `Debug` → `[REDACTED]`, `Serialize` только через
`expose()`; тест `format!("{:?}", profile)` не содержит ключа; `ProfileConfig` содержит
`api_key_ref`, секреты — отдельным `ProfileSecrets` (идёт в `SecretStore`, не в sqlite);
round-trip оба `KeySource`; тест «history не попадает»; версия: unknown field → игнор,
`version: 2` → явная ошибка; фикстура `contract/fixtures/profile-v1.json`.
**Verify:** `cargo test -p voxis-core profile::`
**Steps:**
1. Модель + serde (camelCase), `#[serde(deny_unknown_fields)]` НЕ ставить — forward-compat.
2. Сборка из storage-traits; применение в storage-traits (транзакционно: сначала валидация
   всего профиля через `config::validation`, потом запись).
3. `crypto.rs`: `hkdf`+`sha2`, `argon2`, `chacha20poly1305`; формат `VXP1` + kdf-tag(1) + salt(16) + nonce(12) + ct.
3b. `secret.rs`: newtype + тесты редактирования.
4. Тесты.

### Phase 1 — плагин

### Task 3: Каркас `tauri-plugin-voxis` (Rust) + контракт команд/событий
**Files:** `crates/tauri-plugin-voxis/{Cargo.toml,build.rs,src/{lib.rs,commands.rs,models.rs,
pipeline.rs,capture.rs,desktop.rs,mobile.rs},permissions/**,guest-js/**}`
**Depends:** Task 1b
**Acceptance:** плагин регистрируется в любом Tauri-2 хосте `.plugin(tauri_plugin_voxis::init())`;
команды: `start(mode: Hold|Toggle) -> SessionId`, `stop(id) -> DictationResult{ text,
language?, duration_ms, guard_outcome }`, `cancel(id)`, `state() -> State`, `get_profile()`,
`apply_profile(bytes, key_source)`, `import_profile_from_desktop()` (см. Task 6),
`import_profile_from_qr(payload)`, `set_hotkey(spec)`, `set_consent(bool)` `[R1-Safety S6]`,
`hold_lease(id)` `[R1-Safety S4]`; `init_with(SecretStore)` / default `[R1-Safety S2]`;
события `voxis://state` (Idle|Recording|Transcribing|Error), `voxis://level {rms, peak, muted}` (≤ 20 Hz),
`voxis://result`; `AudioCapture` trait `{ start(path, cap_samples) ; stop() -> Result<CaptureStats> ;
level_rx }` `[R1-Arch S2/S3]` — контракт требует self-cap по `cap_samples` внутри бэкенда и
liveness: закрытие/таймаут `level_rx` (4 опроса без тика при running) = `StreamDied → Recover`;
`[R1-Safety S5]` владение путём и cleanup — в контракте (`rec/` dir, Drop, sweep on init);
`MockCapture` для тестов (умеет «умереть молча»); pipeline = capture → guard-decision → `TranscriptionClient` →
dictionary → llm(opt) → result; повторный `start` при активной сессии → `AlreadyRecording`
(single-flight, как `PressReleaseMachine` на desktop, без гонок press/release).
**Verify:** `cargo test -p tauri-plugin-voxis` (mockito для HTTP, MockCapture), `cargo clippy -p tauri-plugin-voxis --all-targets -- -D warnings`
**Steps:**
1. `tauri-plugin` build.rs с `COMMANDS`; `permissions/` autogen + `default.toml`.
2. `models.rs`: типы выше, serde camelCase, `specta`/ts-rs — НЕ добавлять, типы в guest-js
   вручную (KISS), синхронность проверяется тестом-снапшотом JSON.
3. `pipeline.rs`: async, tokio; guard как на desktop: тишина ≥ `silence_timeout_ms` →
   `SilenceTimeout` (при `ever_loud=false` → Discard + `NoSpeech`), `max_recording_ms` → стоп.
4. `capture.rs`: trait + `MockCapture` (воспроизводит заданные RMS-окна и WAV-фикстуру).
5. `secrets.rs`: `SecretStore` trait + default impls (desktop `keyring`/0600; iOS Keychain — Swift в
   Task 8); `consent.rs`.
6. Тесты: happy-path, NoSpeech-discard, AlreadyRecording, cancel во время Transcribing,
   HTTP 5xx → `Error` + файл удалён; **capture умер молча → Recover ≤ 1 с**; **guard-task убит →
   capture self-cap срабатывает**; **Hold без heartbeat 3 с → LeaseLost, файл удалён**;
   **SIGKILL хоста во время Recording → relaunch → `rec/` пуст**; `dictate` без consent → отказ;
   `grep -c sk- <plugin-config>/*.db == 0` после apply_profile.

### Task 4: Desktop-реализация: cpal capture + rdev hotkey
**Files:** `crates/tauri-plugin-voxis/src/desktop.rs`, `…/src/hotkey.rs`, `…/Cargo.toml`
**Depends:** Task 3.5
**Acceptance:** `CpalCapture` пишет 16 kHz mono WAV через `voxis_core::audio_wav` в `rec/`,
`level_rx` RMS каждые 250 мс, **self-cap** по `cap_samples` в cpal-callback `[R1-Arch S2]`;
`[R1-Migration S6]` hotkey через `voxis_core::hotkey` (rdev): одиночные модификаторы
(`ctrl_r`, `alt_r` — паритет с Voxis default) и комбинации; Pressed/Released → hold, Pressed → toggle;
невалидная комбинация → `Err`; `set_hotkey` перерегистрирует; Accessibility-разрешение на macOS
проверяется и репортится хосту (как в Voxis). Ручная проверка: hold `alt_r` в `host-min` → запись →
текст.
**Verify:** `cargo test -p tauri-plugin-voxis desktop::` + запуск `examples/host-min` (macOS)
**Steps:**
1. `desktop.rs`: `CpalCapture` на `voxis_core::audio_wav` (перенесён в T1b).
2. `hotkey_desktop.rs`: адаптер над `voxis_core::hotkey` (rdev listener → plugin start/stop).
3. Тесты `HotkeySpec` ↔ строка (`"alt_r"`, `"Ctrl+Shift+V"`).

### Task 5: guest-js: `@voxis/tauri-plugin-voxis` — API, `<voxis-overlay>`, in-app hotkey
**Files:** `crates/tauri-plugin-voxis/guest-js/{package.json,src/{index.ts,overlay.ts,drag.ts,
hotkey.ts,lease.ts,theme-bridge.ts,themes/registry.ts},__tests__/**}`, `src/theme-engine/builtin/**`
(build-time копирование в guest-js как статические ES-модули; `loader.ts`/`fetchModule.ts` **не**
экспортируются) `[R1-Safety S3]`
**Depends:** Task 3
**Acceptance:** `dictate({mode}) : Promise<DictationResult>`; `onState/onLevel/onResult`;
`mountOverlay(container?, {theme, draggable: true, storageKey})` — веб-компонент, берёт тему из
статического `ThemeRegistry` (contract v1 `mount(container, themeApi)`), **без Blob/data-URL
`import()`** — работает под CSP `default-src 'self'; script-src 'self'`; неизвестный id → default;
постоянный индикатор записи в Toggle-режиме; прокидывает `level`/`state`/`muted`;
drag: pointer events (mouse+touch+pen), позиция в `localStorage[storageKey]`, snap к краям,
учёт `env(safe-area-inset-*)`, не перекрывает клавиатуру iOS (`visualViewport`); hold-to-talk
на самом оверлее (pointerdown/up/cancel — **pointercancel = stop**, не «зависшая запись»);
`bindHotkey(spec)` через keydown/keyup c защитой от auto-repeat и потери keyup (blur → stop);
`lease.ts`: heartbeat `hold_lease` 1 Гц пока Hold активен `[R1-Safety S4]`;
vitest: drag-persist, safe-area clamp, pointercancel→stop, keyup-lost→stop, theme mount **под CSP
naked** (jsdom + CSP meta), lease-тик.
**Verify:** `bun run test:run` в guest-js; harness `bun run harness` показывает оверлей с mock-level
**Steps:**
1. Па��ет ESM + d.ts; `@tauri-apps/api` peer.
2. `overlay.ts`: custom element `voxis-overlay`, shadow DOM, слоты для темы.
3. `drag.ts`: чистая функция `clampToViewport(pos, size, safeArea, viewport)` + контроллер.
4. `hotkey.ts`: чистая машина Pressed/Released с таймаутом потери keyup.
5. `theme-bridge.ts`: адаптер ThemeApi (уровень, состояние) → существующий контракт тем.
6. Тесты + harness-страница.

### Task 3.5: Tracer bullet (desktop) — `examples/host-min` + `voxis-fake-stt` + Playwright
**Files:** `crates/voxis-fake-stt/**`, `crates/tauri-plugin-voxis/examples/host-min/**` (в т.ч.
`src-tauri/tauri.conf.json` с **CSP, идентичной naked** `[R1-Safety S3]`),
`crates/tauri-plugin-voxis/contract/fixtures/*.json` (включая `profile-qr.json` `[R1-Safety T1]`),
`fixtures/audio/*.wav`, `.forgejo/workflows/ci.yml`
**Depends:** Task 3, Task 5
**Acceptance:** `host-min` (одна страница: `<voxis-overlay>`, кнопка, `<pre id=result>`) собирается и
запускается на macOS/Linux; `voxis-fake-stt` отдаёт фиксированный текст на `fixtures/audio/speech.wav`
и галлюцинацию на `silence.wav`; Playwright: клик → state Recording → Transcribing → текст в
`#result`; сценарий тишины → `NoSpeech`, `#result` пуст, toast показан; **reload webview во время Hold →
запись остановлена ≤ 3 с** (lease) `[R1-Safety S4]`; оверлей рендерится под CSP naked; контрактные фикстуры
парсятся Rust-тестами и vitest (тест-снапшот с обеих сторон); всё это — job в `ci.yml` (Linux,
Docker `voxis-ci`). **Гейт**: до зелёного T4/T6/T7 не стартуют.
**Verify:** `cargo test -p tauri-plugin-voxis && bun run test:run && bun run e2e:host-min` локально и в CI
**Steps:**
1. `voxis-fake-stt`: axum, multipart как у Groq, маппинг по sha256 WAV → текст, иначе 400.
2. `host-min`: Tauri-хост с плагином, `MockCapture` подключается через env `VOXIS_CAPTURE=mock:<wav>`.
3. Контрактные фикстуры + тесты-снапшоты Rust/TS.
4. Playwright-сценарии речь/тишина; CI job.

### Task 6: Desktop-источник профиля для «той же машины» + `import_profile_from_desktop`
**Files:** `crates/tauri-plugin-voxis/src/profile_source.rs`, `crates/voxis-core/src/storage/sqlite_base.rs`
(`open_read_only`), `crates/voxis-core/src/storage/{config_sqlite,providers/storage,prompts_sqlite/*}.rs`
(`::read_only(path)` конструкторы), `crates/tauri-plugin-voxis/examples/host-min/**` (round-trip e2e)
**Depends:** Task 2, Task 3.5
**Acceptance:** на desktop `import_profile_from_desktop()` находит config-dir установленного Voxis
(macOS `~/Library/Application Support/voxis`, Linux XDG, Windows AppData), открывает базы
**read-only** `[R1-Safety S7]`: новый `sqlite_base::open_read_only(path)` с
`SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`, `busy_timeout(2 s)`, **без `init_schema`**
(текущий `connect()` всегда делает `CREATE TABLE`/INSERT builtin-провайдеров → `SQLITE_READONLY`;
нет WAL/busy_timeout → `SQLITE_BUSY` при записи Voxis); четыре storage получают `::read_only(path)`;
строит `VoxisProfile`; секреты → `SecretStore`, остальное → хранилище плагина
(`<host-config>/voxis-plugin/`); Voxis не установлен → `NotFound`; отсутствует `prompts.db` (старый
Voxis) → профиль без промптов, не ошибка. Тесты: импорт при удерживаемой write-транзакции другого
соединения → успех в пределах таймаута; mtime+sha256 исходных БД неизменны; tempdir-фикстура;
**round-trip e2e в host-min** (gate 7): `export(fixture) → import → get_profile()` хэш совпадает.
**Verify:** `cargo test -p voxis-core storage::read_only && cargo test -p tauri-plugin-voxis profile_source:: && bun run e2e:host-min -- --grep profile`
**Steps:**
1. `open_read_only` + `::read_only()`; тесты блокировок.
2. `profile_source.rs`: поиск config-dir (`voxis_desktop_config_dir()` из T1a), сборка профиля.
3. Хранилище плагина: sqlite для не-секретов (тот же `factory` с другим путём) + `SecretStore`.
4. Round-trip сценарий в host-min.

### Task 7: Voxis desktop → «Поделиться профилем» (QR + LAN + файл)
**Files:** `src-tauri/src/commands/profile_share.rs`, `src-tauri/src/profile_share/{server.rs,mod.rs}`,
`src/components/settings/ProfileShare.tsx`, `src/lib/commands.ts`, `src-tauri/capabilities/*.json`
**Depends:** Task 2, Task 3.5 (формат QR-payload = `contract/fixtures/profile-qr.json`) `[R1-Migration S1]`
**Acceptance `[R1-Safety S1/T1/T2]`:** «Share profile to device»: генерирует `k_qr` (32 байта
CSPRNG), одноразовый токен, 6-значный код; HTTP (`axum`) слушает **только выбранный LAN-IP**
(не `0.0.0.0`; список интерфейсов — выбор пользователя, default первый non-loopback), **120 с** или до
первого успешного GET; отдаёт `seal(profile, KeySource::Qr{k_qr, code})`; QR-payload — JSON по
`contract/fixtures/profile-qr.json` `{v:1, host, port, token, k: base64url(k_qr)}` **без URL-схемы**;
код показан отдельно от QR (второй фактор, вводится на телефоне); токен привязан к первому IP,
повторный GET → 410, ответ константного размера; access-log без токена; «Save profile file…» →
`KeySource::Passphrase` с показанной один раз фразой (≥ 64 бит); сервер закрывается RAII/таймаут;
тесты: токен/таймаут/IP-bind, GET→open(k_qr, code) ок, GET→open(k_qr, wrong code) — ошибка,
`k_qr` не в логах.
**Verify:** `cargo test --lib profile_share::` + `bun run test:run` (компонент) + ручной прогон QR
**Steps:**
1. Rust: сервер с single-use token, IP-bind, таймер, `seal(KeySource::Qr)`.
2. QR — `qrcode` crate → SVG в UI (без внешних сервисов); payload по фикстуре контракта.
3. UI-компонент + команда в `commands.ts`; capability на новую команду.
4. Тесты.

### Phase 2 — iOS

### Task 8: iOS Swift-сторона: `AVAudioEngine` capture + разрешения
**Files:** `crates/tauri-plugin-voxis/ios/{Package.swift,Sources/VoxisPlugin.swift,
Sources/AudioCapture.swift}`, `…/src/mobile.rs`
**Depends:** Task 3
**Acceptance:** `startCapture(path, capSamples)` пишет 16 kHz mono PCM WAV (AVAudioConverter из
`inputNode` формата) в `rec/` с `FileProtectionType.completeUnlessOpen` + `isExcludedFromBackup`
`[R1-Safety S5]`, **self-cap** по `capSamples` в tap-callback `[R1-Arch S2]`, шлёт `level`
через `Channel` каждые 250 мс (его прекращение = liveness-сигнал `[R1-Arch S3]`); `stopCapture`
возвращает `{durationMs, samples, peakRms}`; Keychain-реализация `SecretStore`
(`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) `[R1-Safety S2]`; `AVAudioSession` category `.record`/`.playAndRecord` с
`.duckOthers`, активация/деактивация симметричны; прерывание (звонок) → `interrupted` событие
→ pipeline финализирует как `StreamDied → Recover` (как на desktop); отсутствие разрешения →
явная ошибка `MicrophoneDenied` с деep-link в Settings; `NSMicrophoneUsageDescription`
документирован для хоста. Проверка на реальном iPad (skill `ipad-physical-testing`): запись
5 с речи → WAV валидный, транскрипт непустой.
**Verify:** `cargo build -p tauri-plugin-voxis --target aarch64-apple-ios`; прогон на устройстве
**Steps:**
1. Скопировать структуру из `naked-plugin-capture/ios` (Package.swift, `Plugin` subclass,
   `@objc func … (_ invoke: Invoke)`).
2. `AudioCapture.swift`: engine, converter, WAV-writer (заголовок дописывается на stop), RMS.
3. `mobile.rs`: `PluginHandle::run_mobile_plugin` для `start/stop/cancel`, `Channel` уровней.
4. Прерывания/route change → события.
5. **Системный mute микрофона** (iOS 17+/26: кнопка mute в Dynamic Island и Control Center для
   пишущего приложения): наблюдать `AVAudioApplication.inputMuteStateChangeNotification`
   (`AVAudioApplicationMuteStateKey`), `#available(iOS 17, *)`; `muted: bool` → **немедленное**
   состояние `Muted` в оверлее/событии `level` (не «60 с тишины до реакции») `[R1-Safety T3]`;
   guard трактует muted как тишину; иначе запишем нули и получим галлюцинацию.
6. Haptics (`UIImpactFeedbackGenerator`) на start/stop — как у Wispr Flow.

### Task 8.5: Tracer bullet (iOS) — `host-min` на iPad-стенде с реальным микрофоном
**Files:** `crates/tauri-plugin-voxis/examples/host-min/src-tauri/gen/apple/**`, `docs/PLUGIN_IOS_HOST.md` (черновик)
**Depends:** Task 8, Task 3.5
**Acceptance:** `host-min` собирается под iOS и ставится на стенд (skill `ipad-physical-testing`);
`voxis-fake-stt` на Маке по LAN (`api_url_override`); тап на оверлее → реальная запись → WAV
проходит те же guard-тесты, что desktop (`take_rms_peak` окна на фикстуре тишины с iPad) → текст
в `#result`; тишина 75 с → `NoSpeech`, ничего не показано; системная mute-кнопка → guard;
измерен шумовой пол iPad-микрофона (median/p90/max per-250ms RMS) и записан в `consts.rs`
рядом с MacBook. **Гейт**: до зелёного T9/T11 не стартуют.
**Verify:** протокол прогона + WAV + лог как evidence в `research/plugin-ios/`
**Steps:**
1. `tauri ios init` для host-min, `NSMicrophoneUsageDescription`, dev-подпись.
2. Прогоны речь/тишина/mute; сбор WAV с устройства.
3. Калибровка порога при расхождении.

### Task 9a: iOS Live Activity — Swift-реализация + `docs/PLUGIN_IOS_HOST.md`
**Files:** `crates/tauri-plugin-voxis/ios/Sources/LiveActivity.swift`,
`crates/tauri-plugin-voxis/ios/LiveActivityWidget/{VoxisActivityAttributes.swift,VoxisActivityView.swift}`
(файлы для **существующего** WidgetBundle хоста), `docs/PLUGIN_IOS_HOST.md`
**Depends:** Task 8.5
`[R1-Migration S3 / Safety T6]` Разделено: 9a — реализация + документ (проверяемо без хоста:
unit-тесты Swift-моделей, компиляция, fallback); **9b** — сквозная проверка на устройстве после
появления хоста. **naked уже имеет** таргет `NakedLiveActivity` (`project.yml:254-261`,
`NakedLiveActivityWidget.swift` с `@main WidgetBundle`, `NSSupportsLiveActivities: true`) —
плагин **не добавляет второе расширение**, а поставляет `ActivityAttributes` + `ActivityConfiguration`
для включения в существующий `WidgetBundle`; инструкция «новый таргет» — только для хостов без него.
**Acceptance:** при `start` из foreground плагин запускает Live Activity (`ActivityKit`);
при уходе хоста в фон запись продолжается (хост включает `audio` background mode — документировано)
и в Dynamic Island видны состояние/таймер и кнопка **Stop** (интент → `stop` через App Group
флаг, который плагин опрашивает/получает Darwin-notification); при `stop`/`cancel` активность
завершается ≤ 1 с; если ActivityKit недоступен/запрещён — плагин работает без него (`warn`, не
ошибка). Честно задокументировано: в foreground Dynamic Island свою активность не показывает.
Widget-код поставляется хосту для его WidgetBundle (или новый таргет по инструкции, если у хоста
его нет).
**Verify:** `swift build` пакета плагина (iOS SDK), unit-тесты `ActivityAttributes`/state; ревью документа
**Steps:**
0. **Делать как Share Extension в clipshot** (`~/work/clipshot/gen/apple/project.yml`, таргет
   `ClipshotShare`, + `scripts/ios-build.sh`) — там уже оплачены все грабли Tauri-iOS-расширений:
   - Таргет объявляется в `gen/apple/project.yml` (XcodeGen): `type: app-extension`, а у
     app-таргета `dependencies: - target: VoxisWidget, embed: true`. `gen/apple` под git.
   - **`cargo tauri ios build` НЕ запускает xcodegen** — он правит существующий `.xcodeproj`.
     Правка `project.yml` молча не доезжает до сборки → перед сборкой всегда
     `(cd gen/apple && xcodegen generate)` (clipshot `ios-build.sh:59-70`, инцидент 2026-09-01).
   - **xcodegen ПЕРЕПИСЫВАЕТ `Info.plist` и `.entitlements` расширения** из `info.properties` /
     `entitlements.properties` — ручные правки файлов стираются; `NSExtension`-словарь и
     entitlements живут только в `project.yml` (иначе на устройстве `installd`:
     «extensionDictionary must be set in placeholder attributes»).
   - Расширению нужен **свой `DEVELOPMENT_TEAM`** — `tauri.conf.json` инжектит team только в
     app-таргет («Signing for … requires a development team»).
   - Если расширение линкует Rust (`libapp.a`): **оно** владеет `outputFiles` скрипта сборки
     Rust и собирается первым; app-таргет своих `outputFiles` не объявляет — иначе «Multiple
     commands produce libapp.a» / «Cycle in dependencies» (2026-09-11). Наш widget Rust
     **не линкует** (только SwiftUI-рендер) → проще: без preBuildScripts вовсе.
   - **App Group** `group.io.clipshot.desktop` у clipshot уже зарегистрирован и работает на этом же
     team `GZL949D756` (коммиты 09.2026, `com.apple.security.application-groups` в обоих
     таргетах через `entitlements.properties` в `project.yml`) — регистрация на портале для
     `group.top.voxis.*` — 5 минут по тому же пути. Для Live Activity он всё равно не обязателен:
     ActivityKit стартует из приложения, а `LiveActivityIntent` (Stop) система выполняет
     **в процессе приложения** → флаг доходит напрямую в плагин (проверить на устройстве;
     fallback — App Group + Darwin notification).
   - **Hand-off расширение → приложение** (для standalone-follow-up, образец
     `gen/apple/ClipshotShare/ShareHandoff.swift` + `ContainingAppOpener`): URL-схема в
     `project.yml` `CFBundleURLTypes` (без неё `open` молча фейлится), payload — заметка в App
     Group, а `UIApplication.open` через responder chain работает **только после
     `viewDidAppear`** (из `viewDidLoad` — false за 2 мс, измерено 2026-09-13).
     `ShareMemoryProbe.swift` — методика измерения jetsam в расширении на железе.
   Альтернатива для генерации — `npx @choochmeque/tauri-apple-extensions ios add …` (тот же
   XcodeGen под капотом); референс App Group — `tauri-plugin-widgets` `init-ios`.
1. `ActivityAttributes` + состояние; запуск/обновление/финиш из Swift-стороны плагина.
2. `StopDictationIntent: LiveActivityIntent` (in-process) → `stop` в плагине.
3. Инструкция хосту (`docs/PLUGIN_IOS_HOST.md`): блок для `project.yml` (таргет + embed +
   DEVELOPMENT_TEAM + Info.plist properties: `NSExtensionPointIdentifier
   com.apple.widgetkit-extension`), `UIBackgroundModes: audio`, `NSSupportsLiveActivities: true`,
   команда `xcodegen generate` перед сборкой.
4. Fallback-путь без ActivityKit.

### Task 9b: iOS Live Activity — сквозная проверка на устройстве (naked)
**Files (naked-cli):** `src-tauri/gen/apple/NakedLiveActivity/**` (добавить Voxis-активность в
существующий `WidgetBundle`), `src-tauri/gen/apple/project.yml` (`UIBackgroundModes: audio` +
обоснование), `docs/IPHONE_STAND.md`
**Depends:** Task 9a, Task 11
**Acceptance:** начать запись в naked → свернуть → Dynamic Island показывает запись/таймер → Stop из
острова → текст в терминале после возврата; `stop`/`cancel` завершает активность ≤ 1 с; подтверждено,
что `LiveActivityIntent.perform()` идёт в процессе приложения (лог pid), иначе — включить fallback
App Group + Darwin notification (App Group у naked уже есть: `project.yml:93,155`).
**Verify:** прогон на iPad/iPhone, evidence в `research/plugin-ios/`

### Phase 3 — интеграция в naked

### Task 10: naked desktop: подключить плагин, кнопка + hotkey + вставка в терминал
**Files (repo naked-cli):** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/*.json`,
`src/components/AppMainToolbar.tsx`, `src/components/KeyPanel.tsx`, `src/lib/voxis.ts`,
`src/components/settings/*` (hotkey, consent), `package.json`, `crates/naked-core/src/voxis_secrets.rs`
(адаптер `naked_core::SecretStore` → plugin `SecretStore`) `[R1-Safety S2]`
**Depends:** Task 4, Task 5, Task 6
**Acceptance:** `tauri-plugin-voxis = { git = "…/voxis", tag = "plugin-v0.1.0" }`; кнопка-микрофон
в тулбаре + клавиша-чип hold-to-talk в KeyPanel; `init_with(NakedSecretStoreAdapter)` — ключи в
шифрованном стор naked, `grep -c sk- <config>/voxis-plugin/*.db == 0`; экран согласия перед первой
диктовкой (`set_consent`) с именем провайдера `[R1-Safety S6]`; настройка hotkey в Settings naked
(default — паритет с Voxis `alt_r`; проверить конфликт со списком биндингов naked); при первом запуске
`import_profile_from_desktop()` если Voxis установлен, иначе — предложение импортировать
файл/QR; результат → вставка в **активный** терминальный pane тем же путём, что paste
(без auto-type); оверлей монтируется поверх панелей и перемещается как KeyPanel; e2e Playwright:
mock-плагин → кнопка → текст в pane.
**Verify:** `scripts/ci-check.sh core && scripts/ci-check.sh ui` в naked + ручной прогон на macOS
**Steps:**
1. Зависимость + `init()` + permissions в capabilities.
2. `src/lib/voxis.ts`: обёртка над guest-js с типами naked.
3. UI: кнопка, чип, оверлей, настройка hotkey.
4. Вставка в pane через существующий API отправки текста.
5. Тесты.

### Task 11: naked iOS: сборка с плагином, разрешения, прогон на живом iPad
**Files (naked-cli):** `src-tauri/gen/apple/project.yml` (`info.properties`: `NSMicrophoneUsageDescription`
с именем STT-провайдера; **без** `UIBackgroundModes: audio` до Task 9b), `src-tauri/gen/apple/PrivacyInfo.xcprivacy`
(Audio Data / Other User Content → third-party AI) `[R1-Safety S6]`, `src-tauri/Cargo.toml` (ios target dep),
`docs/IPHONE_STAND.md`. Skill для стенда: `~/.pi/agent/skills/ipad-physical-testing/SKILL.md` (глобальный,
не в репо) `[R1-Migration tactical]`
**Depends:** Task 8.5, Task 10
**Acceptance:** iOS-сборка naked с плагином собирается и устанавливается на стенд
(skill `ipad-physical-testing`); тач-оверлей: hold на пилюле → запись → текст в терминал;
перемещение оверлея пальцем с персистом позиции между запусками; внешняя клавиатура iPad: hotkey
hold → запись; QR-импорт профиля с Voxis desktop (Task 7) → те же провайдер/словарь/тема;
guard: 75 с тишины → Discard + сообщение, ничего не вставлено (`SILENCE_RMS` при необходимости
перекалибровать по WAV с iPad-микрофона, зафиксировать числа в `consts.rs`).
**Verify:** протокол прогона в `docs/IPHONE_STAND.md`, скриншоты/лог как evidence
**Steps:**
1. Info.plist + capabilities iOS.
2. Сборка и установка по skill.
3. Прогоны A (речь), B (drag+persist), C (тишина), D (hotkey с клавиатуры), E (QR-импорт),
   F (системная mute-кнопка во время записи → guard/индикация).
3b. Опция: Apple Pencil Pro squeeze как hold-to-talk (`UIPencilInteraction`, уважать
   `preferredSqueezeAction`) — дёшево, только foreground хоста.
4. Калибровка порога при расхождении; записать измерения.

### Task 11b: iOS Siri / Action Button / Control Center → диктовка в naked (App Intents)
**Files (naked-cli):** `src-tauri/gen/apple/Sources/naked/VoxisIntents.swift` (AppIntent +
AppShortcutsProvider), `src-tauri/gen/apple/naked_iOS/naked_iOS.entitlements`
(`com.apple.developer.siri`), `crates/tauri-plugin-voxis/ios/Sources/IntentBridge.swift`
**Depends:** Task 11
**Acceptance:** `StartDictationIntent: AppIntent` с `openAppWhenRun = true` (хост должен быть в
foreground для микрофона — это правило iOS, не наш выбор); `AppShortcutsProvider` с фразами
`"Диктуй в \(.applicationName)"`, `"Start dictation in \(.applicationName)"` (токен имени
обязателен — иначе Siri молча не регистрирует); entitlement Siri включён; после установки без
настройки: «Привет Siri, диктуй в naked» → хост открывается → плагин стартует запись → оверлей;
тот же интент назначается на Action Button / Back Tap / Control Center (iOS 18 `ControlWidget`
— опционально); `AppShortcutsProvider.updateAppShortcutParameters()` на запуске; интент во
время активной записи → игнор (single-flight). Проверка на устройстве: Siri-фраза, Action Button.
**Verify:** прогон на iPad/iPhone; Settings → Apps → naked → Siri & Search показывает шорткаты
**Steps:**
1. Entitlement `com.apple.developer.siri` — в `project.yml` `entitlements.properties`
   app-таргета (xcodegen перезаписывает файл, см. Task 9), затем `xcodegen generate`.
2. Intent (`openAppWhenRun = true`) выполняется в процессе приложения → `NotificationCenter`
   → Swift-сторона плагина → `start`. App Group не нужен.
3. Provider + фразы (ru/en в String Catalog).
4. Прогон.

### Task 12: Документация, версии, релиз плагина
**Files:** `docs/PLUGIN.md`, `docs/PLUGIN_IOS_HOST.md` (+ чеклист хоста: consent, privacy label,
2.5.4/2.5.14), `CHANGELOG.md`, `crates/tauri-plugin-voxis/README.md`, `.forgejo/workflows/ci.yml`
(job core+plugin: `cargo test --workspace` в Linux-docker), `.forgejo/workflows/release.yml`
(macOS-VM lane: `scripts/check-ios-build.sh`, для этого шага `continue-on-error: false`) `[R1-Migration S5]`
**Depends:** Task 10, Task 11, Task 9b
**Acceptance:** README плагина: установка, команды/события, HotkeySpec, профиль (3 пути),
iOS-требования, `SecretStore`/consent/privacy; `ci.yml` гоняет `cargo test --workspace` (Linux);
`release.yml` macOS-VM lane гоняет `scripts/check-ios-build.sh` (проверка, не артефакт); тег
`plugin-v0.1.0` в voxis (подтверждено: `release.yml` триггерится только на `v*` — тег `plugin-*`
DMG-сборку не запустит `[R1-Migration verified]`); naked фиксирует тег в `Cargo.toml`.
**Verify:** CI зелёный; `git ls-remote --tags forgejo | grep plugin-v0.1.0`

## Verification

1. `cargo test --workspace` (voxis) — core + voice_lib + plugin зелёные; счётчик тестов ≥ 1037 + новые.
2. `cargo build -p voxis-core -p tauri-plugin-voxis --target aarch64-apple-ios` — чистая сборка.
3. Voxis desktop v0.1.x после Task 1 ведёт себя идентично: прогоны A/B/C из hardware-протокола
   (речь → auto-type; тишина → Discard) на MacBook — регресс-гейт рефакторинга.
4. naked desktop (macOS): кнопка/hotkey ⌥R → оверлей → текст в терминале; профиль подтянут из
   установленного Voxis (провайдер, словарь, тема совпадают).
5. naked iOS на живом iPad: прогоны A–E из Task 11 с evidence.
6. Безопасность: профиль в транзите/файле только зашифрован (QR-путь: ключ ≥ 2^128 в оптическом
   канале; файл: фраза ≥ 64 бит + Argon2id); сервер share слушает LAN-IP ≤ 120 с; секреты только в
   `SecretStore` (`grep -c sk- *.db == 0`); `Secret` newtype — тест на `Debug`; consent до первой
   диктовки; `rec/` пуст после SIGKILL; Hold без lease останавливается ≤ 3 с.

## Follow-ups (вне плана)

- **Каталог механизмов Apple** (исследование 2026-09-07, вердикты):
  - Триггеры standalone: **Vocal Shortcuts** (iOS 18, Accessibility) — своя фраза без «Привет
    Siri» и без имени приложения, on-device, с lock screen (пользователь обучает 3 повтора —
    показать в onboarding); **AirPods stem** через `MPRemoteCommandCenter.togglePlayPause`
    (приложение должно быть Now Playing с `.playback`; в `.playAndRecord` команды могут не
    приходить → переключать категорию); Shortcuts «Dictate Text» (Siri STT, язык задавать
    явно); `requestValue()` (Siri спрашивает и отдаёт текст, приложение не открывается);
    Apple Watch companion.
  - Транскрипция on-device: `SpeechTranscriber` — русского в `supportedLocales` по одним данным
    нет → для ru использовать `DictationTranscriber` (+ `AnalysisContext.contextualStrings` до
    100 фраз = наш словарь на этапе распознавания). Проверять `supportedLocales` на устройстве.
  - Пост-обработка on-device: **Foundation Models** (iOS 26, `LanguageModelSession`,
    `@Generable`) для пунктуации/чистки вместо облачного LLM — измерить качество на ru.
  - Мост iPhone → Mac без сервера: **Universal Clipboard** (Continuity) — скопировано на iPhone,
    ⌘V на Mac; macOS 26 показывает Live Activities iPhone в меню-баре.
  - Не работает для нас: `AVCaptureEventInteraction` (только камера), автовозврат (26.4),
    замена системной диктовки Siri.

- `TranscriptionEngine` trait + on-device iOS 26 `DictationTranscriber` (WER 2.12 %, офлайн;
  проверить `supportedLocales` для ru-RU) и WhisperKit-fallback.
- Живой двусторонний синк профиля и словаря через сервер-хаб на spex (Voxis-server =
  `TranscriptionClient + dictionary + LLM` за `/v1/audio/transcriptions` + `/profile`).
- Android (Kotlin `AudioRecord`, тот же контракт).
- **Standalone Voxis iOS («наш Wispr Flow»)** — отдельный продукт; исследовано 2026-09-07, путь
  индустрии единственный и публичный, спецразрешений от Apple нет:
  - Триггеры: `AppShortcutsProvider` (Siri-фразы с обязательным `\(.applicationName)`,
    регистрируются при установке) + `AudioRecordingIntent & LiveActivityIntent` (iOS 18) —
    запись стартует **в фоне** из Siri / Action Button / Back Tap / Control Center, если
    `AVAudioSession` уже активирована; первая активация после запуска — только из foreground
    (открыть приложение один раз, дальше держать сессию audio background mode). Требует
    `com.apple.developer.siri` entitlement.
  - «Оверлей» = Live Activity в Dynamic Island / Lock Screen с кнопками Stop/Save
    (`LiveActivityIntent`).
  - Вывод текста в чужое приложение: keyboard extension (без микрофона, ~30–60 МБ) читает
    результат из App Group и вставляет `insertText`; либо буфер обмена; либо
    `requestValue()` — Siri сама диктует своим STT и отдаёт текст в `perform()` без открытия
    приложения (качество Siri, не Whisper).
  - Авто-возврат в предыдущее приложение закрыт в iOS 26.4 — только ручной свайп.
  - Заменить системную диктовку Siri нельзя; iOS 27 private hooks «Siri Extensions / Model
    Delegation» не включены (вероятно EU-only) — следить.
- Voxis desktop сам как хост своего плагина (dogfooding, убирает дублирование `audio/`).
