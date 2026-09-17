# План остатка — довести tauri-plugin-voxis + naked до продакшена (2026-09-16)

Состояние: voxis main `abf62ae` (пушено); naked `voxis-plugin` = 13 коммитов над origin/main, НЕ пушено.
Правило: каждый шаг = worker → fresh reviewer → commit; реальное железо для всего, что касается устройства.

## A. Пилюля до продакшена (naked) — сейчас
A1. Дефолт placement bottom-right / offsetY 96 (на iPad bottom-left накрывает «Settings & status»); перепрогон
    Playwright-подмножества (sheetOverflow, voxis*, micToggle…) + полный ui-suite: без COVERED от оверлея.
A2. `routeVoxisResult`: активный pane закрыт («Session closed») → fallback clipboard + notice (сейчас текст молча теряется).
A3. Деплой на iPad (`ios-device-deploy.sh`, DEVTOOLS=1): CDP-tap → запись → стоп → текст в pane; **владелец**: drag пальцем
    (~0.5 с hold → перенос → снап), перезапуск naked → позиция сохранилась. Evidence в research/plugin-plan/T11_ipad_run.
A4. Review пилюли раунд 2 (fresh) → commit. ✅ A1/A2 `naked@8ebd9e98`; A3 drag пальцем — владелец: «да, вижу, хорошо».
A5. ✅ `naked@dcce7737`→rebased. (владелец) **Клавиатура**: когда экранная клавиатура перекрывает пилюлю, она должна подниматься РОВНО на высоту, нужную чтобы быть видимой
    (прилипнуть к верхнему краю клавиатуры/нижнему краю видимой области панелей), а не прыгать вверх на пол-экрана. Разобраться, что сейчас
    двигает её (visualViewport vs layout viewport vs `--keyboard-inset` naked) — замерить на iPad через CDP при открытой клавиатуре.
A7. ✅ селектор тем в naked Settings `e6c21b72` (корень: deps.theme не доходил до пилюли). A5b. ✅ KeyPanel-зазор от реального top `.keypanel` `b50f6b7d`+`bb0e5db9` (iPad: 632 vs 644). iOS floor обратно 16 (владелец): voxis `0a7ac08`, naked `9fcdc014` — собрано на 16.1, установлено.
A6. ✅ voxis `616cc2c` (guest-js 0.2.0, review R1 REJECT-FIX→fixed) + naked контейнер. **PR naked#1** `voxis-plugin→main` открыт (rebased на 4d7f5812). (владелец) **Полная поддержка тем Voxis** в пилюле: размер из манифеста темы (`overlay_width/height`, напр. lavalamp 120×120,
    all_aquarium 340×170), тема рендерится как в Voxis desktop (WebGL и т.д.), а не сплющена в 64px («пунктир»). Дизайн: idle = компактная
    ручка (кольцо в цвете темы, 44–64px, без GPU-анимации → батарея); recording/transcribing = раскрытие до размера темы, рост от угла
    placement внутрь экрана; тема монтируется при старте и размонтируется при idle. Guest-js (`<voxis-overlay>`: size from ThemeRegistry
    manifest, `compact`/`expanded` состояния для host-driven) + naked (контейнер под размер, anchor учитывает размер). Проверить все 18
    builtin-тем в harness (скриншоты idle/recording) и на iPad.

## B. Плагин — хвосты качества (voxis)
B1. Flaky `profile_source::import_from_qr_happy_path` (mockito): изоляция сервера/порта или `#[serial]`; 10 прогонов зелёные.
B2. `[ADO-2/3]` zeroize ключей/plaintext в `voxis-core::profile::crypto` (если без изменения API).
B3. `[ADO-4]` HotkeyTracker + таблица клавиш → `voxis_core::hotkey` (один трекер для desktop Voxis и плагина) — если ≤ 60 мин, иначе follow-up.

## C. T9b — Live Activity на устройстве (naked + voxis)
C1. naked project.yml: `VoxisActivityAttributes/View/StopDictationIntent.swift` в target `NakedLiveActivity` (copy из plugin ios/LiveActivityWidget,
    зафиксировать источник/rev в комментарии), регистрация `VoxisActivityWidget` в `NakedLiveActivityBundle`; `xcodegen generate` → commit метаданных.
C2. Деплой на iPad → запись → Live Activity видна на lock screen/в Notification Center (скриншот с устройства через WDA не покажет lock screen —
    evidence: `ActivityKit` state через plugin-лог/CDP + **фото владельца**); Stop-кнопка в Live Activity → сессия финализируется (pid intent в app-процессе).
C3. Review → commit.

## D. T11b — Siri / Action Button (naked iOS)
D1. `AppShortcutsProvider` «Dictate in naked» (`AudioRecordingIntent`, foreground), интент → плагин start в активную сессию; без Siri-entitlement.
D2. Проверка на iPad: Shortcuts-app → интент → запись; Action Button (если настроен владельцем).
D3. Review → commit.

## E. Финальный blind review + релиз
E1. Phase-5 blind areview (3 fresh критика: архитектура/безопасность/iOS) над `ddfb30d..HEAD` voxis + `origin/main..voxis-plugin` naked;
    stop rule — только миноры. Фиксы → commit.
E2. voxis: тег `plugin-v0.1.0`; Forgejo-релиз с `voxis-tauri-plugin-voxis-0.1.1.tgz` (+sha256); naked `Cargo.toml` rev → `tag = "plugin-v0.1.0"`,
    vendor/README обновить; clean-clone проверка naked (`cargo check`, `bun install --frozen-lockfile`).
E3. Voxis desktop **v0.1.6** через CI (skill voxis-deploy): тег `v0.1.6` → DMG/Linux/Windows/Homebrew; проверка spctl/stapler; установка на Mac,
    smoke: настройки `api_url_override`/`min_recording_ms` переживают рестарт (сам баг релиза).
E4. naked: rebase на origin/main → push `voxis-plugin` → PR/merge — **после решения владельца по CI-auth** (A PAT-secret / B subtree / C public).

## F. Решения владельца (блокируют)
F1. CI-auth к приватному voxis для naked CI (A/B/C).
F2. tmux-сервер на spex перезапускался 11:42 и 15:21 рядом с переустановками naked — ты или naked? Если naked — расследование до E4.
F3. Drag пилюли пальцем (A3) и фото Live Activity (C2).

## G. Вне плана (записать, не делать)
- naked: `SftpPanel` refresh сбрасывает скролл (вакуумный `theListKeepsItsPlace` вскрыт честным моком); `playwright.config` webServer `--host 127.0.0.1`;
  `ios-device-deploy.sh` без `xcodegen` → правило «project.yml изменил — xcodegen — commit»; краш по raw-тапу Settings (WDA) не воспроизведён.
- voxis: `[ADO-*]` оставшиеся миноры (см. tauri-plugin-voxis.md Follow-ups); `.vxp` UTI/Share-sheet регистрация; host-driven QR-импорт UI на iOS.


## Phase SDK — SOLID/DRY/KISS refactor (blind design review 3×REFACTOR-FIRST, 2026-09-17; reports research/plugin-plan/BLIND_SDK_{rust,ts,swift}.md)
Правило: правим то, что снижает цену поддержки; поведение фиксируют существующие тесты (должны остаться зелёными), новые тесты — на новые seams.
R1 (L) `do_start`: handles создаются и `attach_handles` ДО `spawn_blocking(capture.start)`; pipeline-таск ждёт «capture ready/failed». Удалить `pending`, `stop_waiters`, `StopRequest`, ветки в `trigger_stop/request_stop`, 4 blocking-window теста + `BlockingStartCapture`.
R2 (M) удалить production-dead `SessionGuard::signal()`; тесты через `request_stop/request_cancel`.
R3 (M) одна точка решения «cancelled»: `ExternalCancel` как обычный Trigger до finalize; убрать повторные `cancelled.load()` в run_transcription (или хотя бы override внутрь `decide`).
R4 (M) `BlockingLatch` helper + `spawn_session(deps)` test helper вместо трёх дублей и 12 прологов.
R5 (S/M) `finish(result, file, id, sessions, events)` — порядок drop→end→emit→send закреплён структурой.
T2 (S) host-mode: убрать недостижимый `voxis-overlay-press` (host = чисто визуал) — или честно пометить.
T3 (M) `<voxis-overlay>`: `setPosition(p)` и `setTheme(id)` — без пересоздания элемента/WebGL; naked `useVoxisOverlayMount` использует их вместо remount.
T4 (M) naked: `voxisHoldChip` мёртв? → удалить или `voxisPillPress` компонует его; один release-funnel.
T1 (L) `overlay.ts` split: `OverlaySessionController` (client-only) + чистая геометрия (`anchorGrow`/grow/shrink) вне элемента.
T5 (L) naked `useVoxisRuntime` → `useVoxisSession` + `useVoxisSettings` (+ consent hook); дубль гонки pendingStart/stopRequested — один владелец.
S1 (S) iOS PERMISSION_DENIED доходит до фронта как `permissionDenied`: `mobile.rs::map_invoke_error` маппит `code`, лишний `data: settingsUrl` убрать.
S2 (M) Swift: чистые функции (sub-chunk RMS, self-cap, mute-heuristic) + SwiftPM test target на тех же фикстурах, `WavWriter.selfCheck` → XCTest.
S3 (M) `VoxisAudioCapture` SRP: permission resolver + level/cap math вынести.
S4 (L) wire-структуры Swift↔Rust: принять + задокументировать (без генератора).
Порядок: R1→R2→R3→R4→R5 одним воркером (Rust); S1→S2→S3 (Swift); T2→T3 (guest-js) → naked T3-хост+T4; затем T1, T5. Каждый шаг — fresh reviewer.

## Итог 2026-09-17 (ночь)
- Voxis **v0.1.6 опубликован** (Forgejo+GitHub, 8 артефактов, DMG notarized/stapled, установлен на dev Mac; фикс 6 настроек проверен round-trip). Релизные лейны починены: target/ в корне (Dockerfile.gui-linux, macos-vm.sh), iOS-gate skip без SDK, disk preflight 60G.
- CI voxis: host-min-e2e впервые зелёный (xauth в образе, CARGO_TARGET_DIR, гонка лога); AddEntryForm teardown-флейк.
- **plugin-v0.1.0** тег + релиз с guest-js 0.3.1 tgz; naked запинен на тег (PR #2 `3e869f21`), собран под iOS 16.1 и прогнан на iPad (start→expanded→silence→compact).
- Phase SDK закрыт: R1–R5 (−207 LOC, APPROVE), T1 (overlay split), T2/T3 (live seams), T4/T5 (naked hooks split, APPROVE), S1–S3 (permissionDenied, VoxisAudioMath + 24 XCTest, MicPermission). S4 принят как риск.
- Хвосты: seal() zeroize, rms/peak документированы.
- Решение владельца: naked-как-платформа с плагинами (VNC/браузер) — ОТЛОЖЕНО («оставляем пока так»); продажа плагина — отложено; iOS cross-app — объяснено, не делаем.
- Открыто: PR #2 merge (после CI), T9b Live Activity на устройстве, T11b Siri, QR-импорт на устройстве, экран ручного ввода ключа в naked, `.vxp` UTI, Windows/Android матрица.
