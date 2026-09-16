# План остатка — довести tauri-plugin-voxis + naked до продакшена (2026-09-16)

Состояние: voxis main `abf62ae` (пушено); naked `voxis-plugin` = 13 коммитов над origin/main, НЕ пушено.
Правило: каждый шаг = worker → fresh reviewer → commit; реальное железо для всего, что касается устройства.

## A. Пилюля до продакшена (naked) — сейчас
A1. Дефолт placement bottom-right / offsetY 96 (на iPad bottom-left накрывает «Settings & status»); перепрогон
    Playwright-подмножества (sheetOverflow, voxis*, micToggle…) + полный ui-suite: без COVERED от оверлея.
A2. `routeVoxisResult`: активный pane закрыт («Session closed») → fallback clipboard + notice (сейчас текст молча теряется).
A3. Деплой на iPad (`ios-device-deploy.sh`, DEVTOOLS=1): CDP-tap → запись → стоп → текст в pane; **владелец**: drag пальцем
    (~0.5 с hold → перенос → снап), перезапуск naked → позиция сохранилась. Evidence в research/plugin-plan/T11_ipad_run.
A4. Review пилюли раунд 2 (fresh) → commit.

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
