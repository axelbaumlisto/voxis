# tauri-plugin-voxis — диктовка Voxis как встраиваемый плагин (desktop + iOS), первый хост: naked

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
3. **Захват аудио — файл, не стрим** (KISS): Swift/cpal пишут 16 kHz mono WAV во временный
   файл, по `stop` отдают путь; уровень сигнала (RMS/пики) идёт отдельным `Channel` для
   оверлея. Guard по тишине/длительности работает на тех же RMS-окнах, что и на desktop
   (`SILENCE_RMS` 0.02 — откалибровано на железе 2026-09-07; для iPhone-микрофона
   перекалибровать по реальному WAV, как делали для MacBook).
4. **Оверлей — веб-компонент в webview хоста**, монтирует существующий theme-engine
   (`theme.js`, contract v1) — визуальный паритет с desktop бесплатно. Перемещаемость:
   pointer-drag с персистом позиции (как `KeyPanel` в naked), прилипание к краям, safe-area.
   Dynamic Island — **iOS-only дополнение**: Live Activity показывается системой, когда хост
   ушёл в фон при идущей записи (audio background mode); там кнопка Stop. Пока хост в
   foreground, Dynamic Island не показывает свои же Live Activity — это поведение iOS, а не баг.
5. **Горячая клавиша — две реализации за одним интерфейсом**: desktop — `tauri-plugin-global-
   shortcut` (Pressed/Released → hold-режим системно, пока хост запущен); iPad с внешней
   клавиатурой / desktop-webview — `keydown`/`keyup` в JS (работает, когда хост в фокусе).
   Обе настраиваются хостом одним и тем же `HotkeySpec`.
6. **Синк настроек и базы = `VoxisProfile`** (версионный JSON): provider, `api_url_override`,
   модель, язык, guard-таймауты, LLM (провайдеры + промпты, включая ключи), словарь, тема,
   hotkey. **Не синкаем** history / corrections / debug / failed_audio. Транспорт v1 —
   **снимок по требованию**, три пути:
   - **naked desktop на той же машине**: плагин читает профиль напрямую из config-dir
     Voxis (`voxis-core::storage::paths`) — ноль настройки, «активировать в naked desktop».
   - **iOS**: в Voxis desktop → «Поделиться профилем» → QR (одноразовый токен + LAN-адрес);
     профиль зашифрован ChaCha20-Poly1305 ключом из 6-значного кода на экране (Argon2id);
     плагин на телефоне сканирует QR → GET по LAN → расшифровка → `apply_profile`.
   - **Файл** `voxis-profile.json` (тот же шифр) — AirDrop/почта, импорт в плагине.
   Живой двусторонний синк и сервер-хаб на spex — **вне этого плана** (см. Follow-ups).
7. **Транскрипция v1 — сервер** (тот же `TranscriptionClient`, Groq/`api_url_override`), как
   на desktop. On-device iOS 26 `SpeechAnalyzer` — Follow-up за `TranscriptionEngine` trait.

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
5. **iOS cross-build в CI с T1** (`cargo build -p voxis-core -p tauri-plugin-voxis --target
   aarch64-apple-ios`) — утечка desktop-зависимости ловится в коммите, не в T8.
6. **Регресс-гейт Voxis desktop после T1** (блокирующий): `cargo test --lib` ≥ 1037 зелёных +
   hardware-прогоны A/B/C на MacBook идентичны v0.1.5.
7. **Профиль round-trip**: `export(desktop-fixture) → import(plugin) → get_profile()` — хэш
   совпадает; в host-min автоматизировано.
8. **naked** интегрируется против **тега** плагина; Playwright naked с mock-плагином на тех же
   фикстурах контракта.

## Tasks

### Phase 0 — ядро

### Task 1: Выделить `voxis-core` из `voice_lib`
**Files:** `src-tauri/Cargo.toml` (workspace), `crates/voxis-core/{Cargo.toml,src/**}`,
`src-tauri/src/{config,storage,transcription,llm,learning}/` → move, `src-tauri/src/lib.rs`
**Acceptance:** `voxis-core` не зависит от `tauri`, `cpal`, `rdev`, `enigo`, `arboard`,
`objc2*`, `core-foundation`; `cargo build -p voxis-core --target aarch64-apple-ios`
проходит (rustup target добавлен); `voice_lib` использует `voxis_core::*` через `pub use`
re-export так, что ни один существующий тест/команда не меняется; `cargo test --lib`
в `src-tauri` = те же 1037 зелёных (минус переехавшие, плюс те же в core).
**Verify:** `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo build -p voxis-core --target aarch64-apple-ios`
**Steps:**
1. Workspace: `[workspace] members = [".", "crates/voxis-core"]` в `src-tauri/Cargo.toml`
   (или корневой `Cargo.toml` — выбрать один, документировать).
2. Перенести `config/` (AppConfig, consts, validation — `change_handler` остаётся в voice_lib,
   он завязан на Tauri-state), `storage/` (traits, sqlite, dictionary, paths, factory;
   `debug_storage`/`failed_audio` остаются), `transcription/`, `llm/`, `learning/`,
   `orchestrator::stop_decision` + чистая логика guard-окон (`recording_guard` — только
   функции решения, без tokio-task) в `voxis-core`.
3. `reqwest` в core: `default-features = false, features = ["json","multipart","rustls-tls"]`
   (OpenSSL на iOS не собирается).
4. В `voice_lib`: `pub use voxis_core::{config, storage, transcription, llm, learning};` —
   API совместим, импорты в остальном коде не трогаем.
5. Перенести тесты вместе с модулями; `mockito` → dev-dep core.
6. Проверить iOS-таргет; исправить `cfg`-утечки.

### Task 2: `VoxisProfile` — модель, экспорт/импорт, шифрование
**Files:** `crates/voxis-core/src/profile/{mod.rs,crypto.rs,tests.rs}`
**Depends:** Task 1
**Acceptance:** `VoxisProfile { version: 1, config: ProfileConfig, dictionary: Vec<(String,String)>,
llm: { providers, prompts }, theme: String, hotkey: HotkeySpec }`; `Profile::from_storage(&dyn
ConfigStorage, &dyn DictionaryStorage, &dyn ProvidersStorage, &dyn PromptsStorage)` и
`apply_to(…)`; `seal(profile, code: &str) -> Vec<u8>` / `open(bytes, code) -> Result<Profile>`
(Argon2id → ChaCha20-Poly1305, random salt+nonce в заголовке); неверный код → ошибка без паники;
round-trip тест; тест «history не попадает в профиль»; тест совместимости версии (unknown
field → игнор, `version: 2` → явная ошибка).
**Verify:** `cargo test -p voxis-core profile::`
**Steps:**
1. Модель + serde (camelCase), `#[serde(deny_unknown_fields)]` НЕ ставить — forward-compat.
2. Сборка из storage-traits; применение в storage-traits (транзакционно: сначала валидация
   всего профиля через `config::validation`, потом запись).
3. `crypto.rs`: `argon2` + `chacha20poly1305` crates; формат `VXP1` + salt(16) + nonce(12) + ct.
4. Тесты.

### Phase 1 — плагин

### Task 3: Каркас `tauri-plugin-voxis` (Rust) + контракт команд/событий
**Files:** `crates/tauri-plugin-voxis/{Cargo.toml,build.rs,src/{lib.rs,commands.rs,models.rs,
pipeline.rs,capture.rs,desktop.rs,mobile.rs},permissions/**,guest-js/**}`
**Depends:** Task 1
**Acceptance:** плагин регистрируется в любом Tauri-2 хосте `.plugin(tauri_plugin_voxis::init())`;
команды: `start(mode: Hold|Toggle) -> SessionId`, `stop(id) -> DictationResult{ text,
language?, duration_ms, guard_outcome }`, `cancel(id)`, `state() -> State`, `get_profile()`,
`apply_profile(bytes, code?)`, `import_profile_from_desktop()` (см. Task 6), `set_hotkey(spec)`;
события `voxis://state` (Idle|Recording|Transcribing|Error), `voxis://level {rms, peak}` (≤ 20 Hz),
`voxis://result`; `AudioCapture` trait `{ start(path) ; stop() -> Result<CaptureStats> ; level_rx }`
с `MockCapture` для тестов; pipeline = capture → guard-decision → `TranscriptionClient` →
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
5. Тесты: happy-path, NoSpeech-discard, AlreadyRecording, cancel во время Transcribing,
   HTTP 5xx → `Error` событие + очистка temp-файла.

### Task 4: Desktop-реализация: cpal capture + global-shortcut hotkey
**Files:** `crates/tauri-plugin-voxis/src/desktop.rs`, `…/src/hotkey.rs`, `…/Cargo.toml`
**Depends:** Task 3.5
**Acceptance:** `CpalCapture` пишет 16 kHz mono WAV (ресемплинг как в `voice_lib::audio`),
`level_rx` даёт RMS каждые 250 мс; `HotkeySpec { key, modifiers, mode }` → регистрация через
`tauri-plugin-global-shortcut` с `ShortcutState::{Pressed,Released}` (hold) или Pressed (toggle);
конфликт/невалидная комбинация → `Result::Err`, не паника; перерегистрация при `set_hotkey`
снимает старую. Ручная проверка на macOS: hold ⌥R в тестовом хосте (`examples/host-min`) →
запись → текст в консоль.
**Verify:** `cargo test -p tauri-plugin-voxis desktop::` + запуск `examples/host-min` (macOS)
**Steps:**
1. Вынести из `voice_lib::audio` то, что нужно (writer WAV, resample) в core или дублировать
   минимально — предпочесть перенос в `voxis-core::audio_wav` (Task 1 может подхватить).
2. `desktop.rs`: `CpalCapture`.
3. `hotkey.rs`: адаптер над global-shortcut; тест парсинга `HotkeySpec` ↔ строка (`"Alt+R"`).
4. `examples/host-min`: минимальный Tauri-хост (одна кнопка + консоль) для ручных прогонов.

### Task 5: guest-js: `@voxis/tauri-plugin-voxis` — API, `<voxis-overlay>`, in-app hotkey
**Files:** `crates/tauri-plugin-voxis/guest-js/{package.json,src/{index.ts,overlay.ts,drag.ts,
hotkey.ts,theme-bridge.ts},__tests__/**}`, `src/theme-engine/` (экспорт renderer как пакет-часть)
**Depends:** Task 3
**Acceptance:** `dictate({mode}) : Promise<DictationResult>`; `onState/onLevel/onResult`;
`mountOverlay(container?, {theme, draggable: true, storageKey})` — веб-компонент, монтирует
theme-engine `theme.js` (contract v1, `mount(container, themeApi)`) и прокидывает `level`/`state`;
drag: pointer events (mouse+touch+pen), позиция в `localStorage[storageKey]`, snap к краям,
учёт `env(safe-area-inset-*)`, не перекрывает клавиатуру iOS (`visualViewport`); hold-to-talk
на самом оверлее (pointerdown/up/cancel — **pointercancel = stop**, не «зависшая запись»);
`bindHotkey(spec)` через keydown/keyup c защитой от auto-repeat и потери keyup (blur → stop);
vitest: drag-persist, safe-area clamp, pointercancel→stop, keyup-lost→stop, theme mount.
**Verify:** `bun run test:run` в guest-js; harness `bun run harness` показывает оверлей с mock-level
**Steps:**
1. Па��ет ESM + d.ts; `@tauri-apps/api` peer.
2. `overlay.ts`: custom element `voxis-overlay`, shadow DOM, слоты для темы.
3. `drag.ts`: чистая функция `clampToViewport(pos, size, safeArea, viewport)` + контроллер.
4. `hotkey.ts`: чистая машина Pressed/Released с таймаутом потери keyup.
5. `theme-bridge.ts`: адаптер ThemeApi (уровень, состояние) → существующий контракт тем.
6. Тесты + harness-страница.

### Task 3.5: Tracer bullet (desktop) — `examples/host-min` + `voxis-fake-stt` + Playwright
**Files:** `crates/voxis-fake-stt/**`, `crates/tauri-plugin-voxis/examples/host-min/**`,
`crates/tauri-plugin-voxis/contract/fixtures/*.json`, `fixtures/audio/*.wav`, `.forgejo/workflows/ci.yml`
**Depends:** Task 3, Task 5
**Acceptance:** `host-min` (одна страница: `<voxis-overlay>`, кнопка, `<pre id=result>`) собирается и
запускается на macOS/Linux; `voxis-fake-stt` отдаёт фиксированный текст на `fixtures/audio/speech.wav`
и галлюцинацию на `silence.wav`; Playwright: клик → state Recording → Transcribing → текст в
`#result`; сценарий тишины → `NoSpeech`, `#result` пуст, toast показан; контрактные фикстуры
парсятся Rust-тестами и vitest (тест-снапшот с обеих сторон); всё это — job в `ci.yml` (Linux,
Docker `voxis-ci`). **Гейт**: до зелёного T4/T6/T7 не стартуют.
**Verify:** `cargo test -p tauri-plugin-voxis && bun run test:run && bun run e2e:host-min` локально и в CI
**Steps:**
1. `voxis-fake-stt`: axum, multipart как у Groq, маппинг по sha256 WAV → текст, иначе 400.
2. `host-min`: Tauri-хост с плагином, `MockCapture` подключается через env `VOXIS_CAPTURE=mock:<wav>`.
3. Контрактные фикстуры + тесты-снапшоты Rust/TS.
4. Playwright-сценарии речь/тишина; CI job.

### Task 6: Desktop-источник профиля для «той же машины» + `import_profile_from_desktop`
**Files:** `crates/tauri-plugin-voxis/src/profile_source.rs`, `crates/voxis-core/src/storage/paths.rs`
**Depends:** Task 2, Task 3.5
**Acceptance:** на desktop `import_profile_from_desktop()` находит config-dir установленного Voxis
(macOS `~/Library/Application Support/voxis`, Linux XDG, Windows AppData), открывает базы
**read-only** (`SQLITE_OPEN_READ_ONLY`, никакой записи в базы Voxis), строит `VoxisProfile`,
применяет в собственное хранилище плагина (`<host-config>/voxis-plugin/`); Voxis не установлен →
`NotFound` с понятным текстом; тест с tempdir-фикстурой в формате Voxis.
**Verify:** `cargo test -p tauri-plugin-voxis profile_source::`
**Steps:**
1. `paths.rs`: `voxis_desktop_config_dir()` — общая функция для обоих потребителей.
2. Read-only открытие; сборка через `Profile::from_storage`.
3. Хранилище плагина — те же sqlite-реализации из core с другим базовым путём (переиспользуем `factory`).

### Task 7: Voxis desktop → «Поделиться профилем» (QR + LAN + файл)
**Files:** `src-tauri/src/commands/profile_share.rs`, `src-tauri/src/profile_share/{server.rs,mod.rs}`,
`src/components/settings/ProfileShare.tsx`, `src/lib/commands.ts`, `src-tauri/capabilities/*.json`
**Depends:** Task 2
**Acceptance:** в Settings появляется «Share profile to device»: генерирует 6-значный код +
одноразовый токен, поднимает локальный HTTP (`axum`/`tiny_http`, `0.0.0.0:<random>`) на
**120 с** или до первого успешного GET, отдаёт `seal(profile, code)`; QR = `voxis://import?
host=<lan-ip>&port=&token=`; кнопка «Save profile file…» пишет зашифрованный файл; сервер
гарантированно закрывается (RAII/таймаут), повторный GET с тем же токеном → 410; ключи API
никогда не логируются; unit-тесты токена/таймаута, интеграционный тест GET→open(code).
**Verify:** `cargo test --lib profile_share::` + `bun run test:run` (компонент) + ручной прогон QR
**Steps:**
1. Rust: сервер с single-use token, таймер, `seal`.
2. QR — `qrcode` crate → SVG в UI (без внешних сервисов).
3. UI-компонент + команда в `commands.ts`; capability на новую команду.
4. Тесты.

### Phase 2 — iOS

### Task 8: iOS Swift-сторона: `AVAudioEngine` capture + разрешения
**Files:** `crates/tauri-plugin-voxis/ios/{Package.swift,Sources/VoxisPlugin.swift,
Sources/AudioCapture.swift}`, `…/src/mobile.rs`
**Depends:** Task 3
**Acceptance:** `startCapture(path)` пишет 16 kHz mono PCM WAV (AVAudioConverter из
`inputNode` формата), шлёт `level` через `Channel` каждые 250 мс; `stopCapture` возвращает
`{durationMs, samples, peakRms}`; `AVAudioSession` category `.record`/`.playAndRecord` с
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
   (`AVAudioApplicationMuteStateKey`), пробрасывать `muted: bool` в pipeline → guard считает
   mute как тишину и показывает состояние в оверлее; иначе запишем нули и получим галлюцинацию.
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

### Task 9: iOS Live Activity (Dynamic Island) при записи в фоне
**Files:** `crates/tauri-plugin-voxis/ios/Sources/LiveActivity.swift`,
`crates/tauri-plugin-voxis/ios/WidgetExtension/**` (шаблон для хоста), `docs/PLUGIN_IOS_HOST.md`
**Depends:** Task 8.5
**Acceptance:** при `start` из foreground плагин запускает Live Activity (`ActivityKit`);
при уходе хоста в фон запись продолжается (хост включает `audio` background mode — документировано)
и в Dynamic Island видны состояние/таймер и кнопка **Stop** (интент → `stop` через App Group
флаг, который плагин опрашивает/получает Darwin-notification); при `stop`/`cancel` активность
завершается ≤ 1 с; если ActivityKit недоступен/запрещён — плагин работает без него (`warn`, не
ошибка). Честно задокументировано: в foreground Dynamic Island свою активность не показывает.
Widget-extension в Tauri-генерируемый Xcode-проект добавляется хостом по инструкции (это его
таргет, плагин даёт готовые Swift-файлы). Проверка на устройстве: начать запись → свернуть
хост → остров показывает запись → Stop из острова → текст пришёл в хост после возврата.
**Verify:** прогон на iPad/iPhone по скрипту из `docs/PLUGIN_IOS_HOST.md`
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

### Phase 3 — интеграция в naked

### Task 10: naked desktop: подключить плагин, кнопка + hotkey + вставка в терминал
**Files (repo naked-cli):** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/*.json`,
`src/components/AppMainToolbar.tsx`, `src/components/KeyPanel.tsx`, `src/lib/voxis.ts`,
`src/components/settings/*` (hotkey), `package.json`
**Depends:** Task 4, Task 5, Task 6
**Acceptance:** `tauri-plugin-voxis = { git = "…/voxis", tag = "plugin-v0.1.0" }`; кнопка-микрофон
в тулбаре + клавиша-чип hold-to-talk в KeyPanel; настройка hotkey в Settings naked (default ⌥R,
не конфликтует с существующими биндингами naked — проверить список); при первом запуске
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
**Files (naked-cli):** `src-tauri/gen/apple/**` (Info.plist: `NSMicrophoneUsageDescription`,
`UIBackgroundModes: audio`), `src-tauri/Cargo.toml` (ios target dep), `docs/IPHONE_STAND.md`
**Depends:** Task 8.5, Task 10 (Task 9 — опционально в этом релизе)
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
**Files:** `docs/PLUGIN.md`, `docs/PLUGIN_IOS_HOST.md`, `CHANGELOG.md`, `crates/tauri-plugin-voxis/README.md`,
`.forgejo/workflows/ci.yml` (job для core+plugin: `cargo test --workspace`, iOS cross-build check)
**Depends:** Task 10, Task 11
**Acceptance:** README плагина: установка, команды/события, HotkeySpec, профиль (3 пути),
iOS-требования; CI собирает `voxis-core` и плагин под `aarch64-apple-ios` в macOS-lane
(`scripts/macos-vm.sh` уже есть — добавить `cargo build --target aarch64-apple-ios` как проверку,
не артефакт); тег `plugin-v0.1.0` в voxis; naked фиксирует его в `Cargo.toml`.
**Verify:** CI зелёный; `git ls-remote --tags forgejo | grep plugin-v0.1.0`

## Verification

1. `cargo test --workspace` (voxis) — core + voice_lib + plugin зелёные; счётчик тестов ≥ 1037 + новые.
2. `cargo build -p voxis-core -p tauri-plugin-voxis --target aarch64-apple-ios` — чистая сборка.
3. Voxis desktop v0.1.x после Task 1 ведёт себя идентично: прогоны A/B/C из hardware-протокола
   (речь → auto-type; тишина → Discard) на MacBook — регресс-гейт рефакторинга.
4. naked desktop (macOS): кнопка/hotkey ⌥R → оверлей → текст в терминале; профиль подтянут из
   установленного Voxis (провайдер, словарь, тема совпадают).
5. naked iOS на живом iPad: прогоны A–E из Task 11 с evidence.
6. Безопасность: профиль в транзите/файле только зашифрован; сервер share живёт ≤ 120 с;
   ключи не в логах (`grep -i "api_key\|sk-" logs` пусто).

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
