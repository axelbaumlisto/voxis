# Handy Themes Migration — Execution Guide (для слабых агентов)

**Сопроводительный документ к** `handy-themes-migration.md`.
**Цель**: разбить миграцию на атомарные задачи, каждая из которых:
- занимает 30-90 мин у одного агента;
- начинается с RED-теста (TDD), кончается GREEN-кодом;
- содержит явные WHY / WHAT / HOW / DONE WHEN;
- улучшает затрагиваемую подсистему по SOLID/DRY/KISS;
- описывает явные «не-цели» (что НЕ трогать).

---

## Сквозные правила (read me first)

1. **TDD strict**: каждый таск начинается с написания тестов. Тест должен **сначала упасть**, потом написать код, чтобы прошёл. Зелёный → коммит.
2. **One task = one commit**. Commit message по conventional commits:
   `feat(scope): subject` или `test(scope): subject` или `refactor(scope): subject`.
3. **Не выходить за scope**. Любое улучшение в соседней области → отдельный таск.
4. **Не ломать существующее**: после каждого таска запустить:
   ```bash
   cd src-tauri && cargo test --lib 2>&1 | tail -3
   cd .. && bun run test:run 2>&1 | grep "Test"
   bun run test:e2e 2>&1 | tail -5
   ```
   Все должно остаться зелёным.
5. **Improve where you touch**: SOLID/DRY/KISS/clarity опционально-обязательны в радиусе ±20 строк от правки. Например, добавляя поле — переименуй неудачно названное соседнее поле, если очевидно.
6. **Skill triggers**: при работе с планами или TDD — читать соответствующие SKILL.md в `~/.pi/agent/git/github.com/obra/superpowers/skills/`.

---

## Phase 0 · Baseline (1 задача, ~10 мин)

### T0.1 · Снять baseline

**WHY**: убедиться, что main зелёная и зафиксировать счётчики.

**WHAT**: запустить полный test-stack, записать результаты в коммит-сообщение.

**HOW**:
```bash
cd src-tauri && cargo test --lib 2>&1 | tail -3 > /tmp/baseline-rust.txt
cd .. && bun run test:run 2>&1 | grep "Test " > /tmp/baseline-frontend.txt
bun run test:e2e 2>&1 | tail -3 > /tmp/baseline-e2e.txt
cd src-tauri && cargo clippy --lib --tests 2>&1 | grep -E "^warning|^error" > /tmp/baseline-clippy.txt
```

Сохранить в memo: должно быть **755 cargo / 976 vitest / 112 e2e / 0 warnings**.

**DONE WHEN**: счётчики совпадают, есть пометка в `.pi/plans/handy-themes-execution.md` под этой задачей с датой.

---

## Phase 1 · TypeScript schema + resolver (3 задачи, ~3 ч)

### T1.1 · RED: тесты для `HandyPillTheme` schema

**WHY**: TDD — сначала тесты, чтобы зафиксировать API до того, как написать код.

**WHAT**: создать `src/themes/__tests__/handy.test.ts` с 8 тестами, описывающими поведение `resolveHandyTheme` / `themeToCssVars` / `themeBarMath`.

**HOW** (тесты, которые должны упасть с `Cannot find module '../handy'`):
```ts
import { describe, it, expect } from "vitest";
import {
  resolveHandyTheme,
  themeToCssVars,
  themeBarMath,
  DEFAULT_HANDY_THEME,
} from "../handy";

describe("HandyPillTheme · resolver", () => {
  it("returns DEFAULT_HANDY_THEME when input is null", () => {
    expect(resolveHandyTheme(null)).toEqual(DEFAULT_HANDY_THEME);
  });
  it("returns DEFAULT_HANDY_THEME when input lacks handy_pill block", () => {
    expect(resolveHandyTheme({ name: "x", family: "organic_ring" })).toEqual(DEFAULT_HANDY_THEME);
  });
  it("merges partial palette with default animations", () => {
    const r = resolveHandyTheme({
      handy_pill: { palette: { icon_color: "#7cc287" } },
    });
    expect(r.palette.icon_color).toBe("#7cc287");
    expect(r.animation.smoothing_alpha).toBe(DEFAULT_HANDY_THEME.animation.smoothing_alpha);
  });
  it("merges partial animation with default palette", () => {
    const r = resolveHandyTheme({
      handy_pill: { animation: { smoothing_alpha: 0.55 } },
    });
    expect(r.animation.smoothing_alpha).toBe(0.55);
    expect(r.palette.icon_color).toBe(DEFAULT_HANDY_THEME.palette.icon_color);
  });
  it("preserves all 18 fields when fully specified", () => {
    const full = { handy_pill: {
      palette: { icon_color: "#abc", bar_color: "#def", bar_glow: "#012",
                 shadow: "rgba(1,2,3,0.4)", transcribing_text: "#fff",
                 cancel_hover_bg: "rgba(1,2,3,0.2)" },
      animation: { smoothing_alpha: 0.3, power_curve: 0.7, peak_decay: 0.85,
                   bar_min_height_px: 4, bar_min_opacity: 0.2, bar_opacity_gain: 1.7,
                   bar_height_ms: 60, bar_opacity_ms: 120, pill_fade_ms: 300,
                   transcribing_pulse_ms: 1500, idle_breathing_amplitude: 0,
                   idle_breathing_period_ms: 3000, cancel_hover_ms: 150 },
    }};
    expect(resolveHandyTheme(full).palette.icon_color).toBe("#abc");
    expect(resolveHandyTheme(full).animation.idle_breathing_amplitude).toBe(0);
  });
  it("clamps amplitude to [0, 0.3] and alpha to [0.05, 1]", () => {
    const r = resolveHandyTheme({ handy_pill: { animation: {
      idle_breathing_amplitude: 5,
      smoothing_alpha: -1,
    }}});
    expect(r.animation.idle_breathing_amplitude).toBe(0.3);
    expect(r.animation.smoothing_alpha).toBe(0.05);
  });
});

describe("themeToCssVars", () => {
  it("exports 18 CSS-variable keys (6 palette + 12 animation)", () => {
    const vars = themeToCssVars(DEFAULT_HANDY_THEME);
    const keys = Object.keys(vars);
    expect(keys.length).toBe(18);
    expect(keys).toContain("--hp-icon");
    expect(keys).toContain("--hp-bar-height-ms");
    expect(keys).toContain("--hp-breathing-amplitude");
  });
  it("ms-fields are stringified with 'ms' suffix", () => {
    const vars = themeToCssVars(DEFAULT_HANDY_THEME);
    expect(vars["--hp-bar-height-ms"]).toBe("60ms");
    expect(vars["--hp-pill-fade-ms"]).toBe("300ms");
  });
});

describe("themeBarMath", () => {
  it("returns only the 3 JS-driven fields", () => {
    const math = themeBarMath(DEFAULT_HANDY_THEME);
    expect(math).toEqual({
      smoothing_alpha: 0.3,
      power_curve: 0.7,
      peak_decay: 0.85,
    });
  });
});
```

**DONE WHEN**:
- `bunx vitest run src/themes/__tests__/handy.test.ts` падает с ENOENT/import error;
- В коммите только `src/themes/__tests__/handy.test.ts` (+1 файл).
- Commit message: `test(themes): RED — HandyPillTheme resolver + helpers (Phase 1.1)`.

**ЧТО НЕ ТРОГАТЬ**: не создавать `src/themes/handy.ts` в этом коммите.

---

### T1.2 · GREEN: реализовать `src/themes/handy.ts`

**WHY**: сделать тесты T1.1 зелёными минимальным кодом.

**WHAT**: написать модуль `src/themes/handy.ts`. Никаких зависимостей кроме `zod` (опц. — можно ручной clamp).

**HOW**:
1. Создать константы `DEFAULT_HANDY_THEME` (палитра pink Handy, анимации из таблицы для `default`).
2. Функция `resolveHandyTheme(input: unknown): HandyPillTheme`:
   - если input нет/null/без handy_pill → вернуть DEFAULT
   - иначе merge: для каждой части (palette, animation) — partial.with-defaults
   - clamp ranges (amplitude ∈ [0, 0.3], alpha ∈ [0.05, 1], все ms > 0)
3. Функция `themeToCssVars(t: HandyPillTheme): Record<string, string>` — 18 пар. ms-поля имеют суффикс `"ms"`.
4. Функция `themeBarMath(t: HandyPillTheme): BarMath` — три числа.

**Не делать**: ни zod, ни io-ts. Достаточно ручных type guards. KISS.

**Improve где касаешься**:
- Если есть `src/themes/` папка уже — проверить, что не пересекаемся с существующим (сейчас её нет, ОК).

**DONE WHEN**:
- `bunx vitest run src/themes/__tests__/handy.test.ts` 8/8 GREEN;
- `bun run test:run` остался 976/976;
- Commit: `feat(themes): HandyPillTheme schema + resolver + CSS vars (Phase 1.2 GREEN)`.

---

### T1.3 · «Improve»: пересмотреть `useSmoothBars` API

**WHY**: до Фазы 2 хук уже захардкодил α=0.3. Чистый рефактор интерфейса под TDD: добавить опциональный объект `{alpha, peak_decay}` + дефолты, чтобы Фаза 2 могла подключить без поломки.

**WHAT**:
1. Расширить интерфейс `useSmoothBars(spectrumBins, options?)`.
2. Добавить тесты в `src/hooks/__tests__/useSmoothBars.test.ts`:
   - options.alpha по умолчанию = 0.3 (back-compat);
   - options.peak_decay = 1.0 по умолчанию (без peak-tracker, как сейчас);
   - при `peak_decay < 1.0` каждый бар получает peak-tracker.
3. Реализация: hook хранит `peaksRef`, для каждого бара `peak = max(current, peak * decay)`. Возвращает `max(smoothed[i], peak[i])`.

**Improve**:
- Вынести магическое 0.3 в константу `DEFAULT_SMOOTHING_ALPHA`.
- Добавить JSDoc для каждого поля options.

**DONE WHEN**:
- +3 vitest теста GREEN;
- Старые 10 тестов проходят без изменений (back-compat);
- Commit: `refactor(hooks): useSmoothBars accepts {alpha, peak_decay} options (Phase 1.3)`.

**Не делать**: пока не подключать к `HandyBars` (это Фаза 2).

---

## Phase 2 · ThemeProvider + CSS vars + breathing (4 задачи, ~4 ч)

### T2.1 · RED: тесты для `HandyThemeProvider`

**WHY**: TDD.

**WHAT**: `src/themes/__tests__/HandyThemeProvider.test.tsx` с 6 тестами:
1. mount применяет 18 CSS-vars на `document.documentElement`;
2. unmount удаляет их (cleanup);
3. theme prop меняется → vars обновляются в одном рендере;
4. `useHandyTheme()` внутри Provider возвращает текущую theme;
5. `useHandyBarMath()` возвращает `{alpha, power_curve, peak_decay}`;
6. `useHandyBarMath()` без Provider → throws с понятным сообщением (`useHandyBarMath must be called inside <HandyThemeProvider>`).

**HOW**: тесты Render + waitFor + `document.documentElement.style.getPropertyValue('--hp-icon')`.

**DONE WHEN**:
- 6 тестов падают с ENOENT/missing component;
- Commit: `test(themes): RED — HandyThemeProvider + hooks (Phase 2.1)`.

---

### T2.2 · GREEN: `HandyThemeProvider` + хуки

**WHY**: сделать T2.1 зелёным.

**WHAT**:
- `src/themes/HandyThemeProvider.tsx`: React context.Provider + 2 хука.
- useEffect устанавливает + cleanup удаляет CSS-vars.
- Хуки бросают понятное сообщение если без Provider'а.

**HOW**: см. план миграции, секция «Phase 2».

**DONE WHEN**: 6 GREEN, 976 не сломаны. Commit: `feat(themes): HandyThemeProvider + useHandyTheme/BarMath hooks (Phase 2.2 GREEN)`.

---

### T2.3 · Refactor `HandyPill.module.css` → CSS vars

**WHY**: дать UI «слушать» CSS-переменные, заданные Provider'ом.

**WHAT**: заменить hardcoded color/ms на `var(--hp-*, fallback)`. Добавить `@keyframes hp-breathe`. Применить к `.overlay-left svg` при `data-mode="idle"`.

**HOW**:
1. Найти все hex / ms в HandyPill.module.css.
2. Каждое значение → `var(--hp-icon, #FAA2CA)` и т. п.
3. Добавить:
```css
@keyframes hp-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: calc(1 - var(--hp-breathing-amplitude, 0)); }
}
.recording-overlay[data-mode="idle"] .overlay-left {
  animation: hp-breathe var(--hp-breathing-period-ms, 3000ms) ease-in-out infinite;
}
```
4. **Не трогать** `transition: opacity 300ms ease-out` на `.recording-overlay` если он есть — заменить только хардкод.

**Improve**:
- Удалить дублированный комментарий с устаревшим описанием;
- Сгруппировать `:where(.recording-overlay)` для DRY если есть смысл.

**Тесты**: vitest snapshot существующего `HandyPill.test.tsx` ДОЛЖЕН остаться зелёным (он проверяет ARIA + структуру, не цвета).

**DONE WHEN**:
- 976 vitest GREEN;
- Visual смотрит так же, как до (default theme = pink, idle breathing amplitude=0 ⇒ flat);
- Commit: `refactor(overlay): HandyPill.module.css → CSS vars (Phase 2.3)`.

---

### T2.4 · Подключение Provider'а в `OverlayApp` + использование math из хука

**WHY**: финальный wire. Provider должен оборачивать HandyPill в `src/overlay.tsx`. `HandyBars` начинает уважать `power_curve` из темы.

**WHAT**:
1. `src/overlay.tsx`: импортировать `HandyThemeProvider`, обернуть `<HandyPill>`.
   - Тему пока брать из локальной переменной `DEFAULT_HANDY_THEME` (загрузка из Rust — Фаза 5).
2. `src/components/overlay/HandyBars.tsx`: в `barHeight()` использовать `power_curve` из `useHandyBarMath()`.
   - Сделать хук опциональным (через `useContext` с дефолтом) — чтобы юнит-тесты без Provider'а работали.
3. `src/components/overlay/__tests__/HandyBars.test.tsx`: добавить тест «custom power_curve меняет высоту бара».

**Improve**:
- Удалить unused импорт `useEffect` если уже не нужен.
- Поправить любое `as any` рядом.

**DONE WHEN**:
- +1 vitest, 976+1 = 977/977 GREEN;
- Cargo / e2e не тронуты;
- Commit: `feat(overlay): wire HandyThemeProvider in OverlayApp + HandyBars uses theme math (Phase 2.4)`.

---

## Phase 3 · Rust schema + Tauri command (2 задачи, ~3 ч)

### T3.1 · RED: cargo тесты для `overlay/themes/handy.rs`

**WHY**: TDD на Rust-стороне.

**WHAT**: создать `src-tauri/src/overlay/themes/handy.rs` (пустой stub) и `src-tauri/src/overlay/themes/handy_tests.rs` с 6 тестами:
1. parse без `handy_pill` → DEFAULT (pink + дефолтные анимации);
2. parse частичный palette → animation = DEFAULT;
3. parse частичный animation → palette = DEFAULT;
4. parse full → точное совпадение;
5. парс всех 7 файлов `themes/<name>/theme.json` → не падает;
6. amplitude/alpha/ms клампятся при deserialize.

**DONE WHEN**: 6 RED тестов; commit: `test(rust): RED — handy.rs parser + repository tests (Phase 3.1)`.

---

### T3.2 · GREEN: реализация + Tauri-команда `get_handy_theme`

**WHY**: GREEN T3.1 + предоставить runtime API.

**WHAT**:
1. `overlay/themes/handy.rs`: struct'ы `HandyPillPalette`, `HandyPillAnimation`, `HandyPillTheme`, парсинг через `serde`, fallback'ы в `Default`.
2. `commands/overlay.rs`: `#[tauri::command] #[specta::specta] pub fn get_handy_theme(id: String, app: AppHandle) -> Result<HandyPillTheme, String>` — читает из `ThemeLoader`, конвертит в `HandyPillTheme` через resolver.
3. `lib.rs`: зарегистрировать команду + добавить в specta collect.
4. `bun run test:run` пересоберёт bindings.ts; убедиться что добавлен `getHandyTheme`.

**Improve**:
- Если в `commands/overlay.rs` есть `#[allow(...)]` атрибуты — проверить актуальность.
- Если есть дублированный JSDoc → убрать.

**DONE WHEN**:
- 6 cargo GREEN, +0 frontend изменений;
- bindings.ts регенерирован (есть `commands.getHandyTheme`);
- Commit: `feat(rust): get_handy_theme + HandyPillTheme DTO (Phase 3.2 GREEN)`.

---

## Phase 4 · Заполнить `handy_pill` в 7 темах (1 задача, ~1 ч)

### T4.1 · Populate 7 `theme.json` с handy_pill блоком

**WHY**: данные для тестов Фазы 5.

**WHAT**: добавить в каждый `src-tauri/themes/<name>/theme.json` блок:
```json
{
  ...,
  "handy_pill": {
    "palette": { ... },     // из таблицы маппинга
    "animation": { ... }    // из таблицы маппинга
  }
}
```

**HOW**: использовать таблицы из `handy-themes-migration.md` (палитра + анимации). Старые поля (`colors`, `gradient`, `organic_ring`) НЕ ТРОГАТЬ.

**Improve**:
- Если в каком-то JSON неконсистентные `name` vs папка — поправить с пометкой в commit.

**DONE WHEN**:
- cargo тест T3.1 «парсит все 7» проходит;
- Все темы имеют distinct `icon_color` (можно добавить тест);
- Commit: `feat(themes): populate handy_pill (palette+animation) in 7 themes (Phase 4)`.

---

## Phase 5 · Wire + live gallery (5 задач, ~6 ч)

### T5.1 · Подключение `getHandyTheme` в OverlayApp + Tauri event подписка

**WHY**: оверлей должен получать тему из Rust и реагировать на смену.

**WHAT**:
- `src/overlay.tsx`: `useEffect(() => commands.getHandyTheme(themeId).then(setTheme))` + подписка на `overlay://theme` для смены.
- `src/hooks/useOverlayState.ts`: при `overlay://theme` payload — публиковать новый themeId.

**DONE WHEN**:
- 976+ vitest зелёные;
- При запуске voice pill показывает текущую тему из config.db;
- Commit: `feat(overlay): runtime getHandyTheme + react to overlay://theme event (Phase 5.1)`.

---

### T5.2 · Debug-команды для e2e (set_handy_theme, debug_emit_spectrum, debug_emit_silence)

**WHY**: e2e должен уметь переключать темы и подменять спектр без реального микрофона.

**WHAT**: 3 новых команды в `src-tauri/src/commands/debug.rs` (или новый файл) под `#[cfg(debug_assertions)]`:
- `set_handy_theme(id: String) -> Result<(), String>`: emit `overlay://theme` с payload `id`. Не пишет в config.
- `debug_emit_spectrum(bins: Vec<f32>) -> Result<(), String>`: подменяет следующее значение в audio_level polling.
- `debug_emit_silence() -> Result<(), String>`: bins=0 для следующих N итераций.

Реализация: для emit_spectrum/silence — `OnceCell<Mutex<Option<Vec<f32>>>>` в `audio_level.rs`, polling сначала проверяет override.

**Improve**:
- Если в `audio_level.rs` есть unused-warning — поправить.
- Добавить debug-only assertion на размер bins.

**DONE WHEN**:
- 3 команды в bindings.ts;
- +2 cargo unit-теста на override-механизм;
- Commit: `feat(debug): test-only commands for theme/spectrum override (Phase 5.2)`.

---

### T5.3 · Синтетические e2e (Chrome, без voice)

**WHY**: быстрая регрессия в CI без зависимости от screencapture/X11.

**WHAT**: расширить `e2e/handy-theme-switch.spec.ts` (3 color теста) и `e2e/handy-theme-animation.spec.ts` (3 animation).

**HOW**: `page.goto("/overlay.html?theme=living_reed")` → подменить через URL-param (добавить в `overlay.tsx` URL-param `?theme=` → setTheme). Сравнить пиксели.

**DONE WHEN**:
- 6 новых e2e GREEN;
- Commit: `test(e2e): synthetic theme + animation tests (Phase 5.3)`.

---

### T5.4 · Хелперы для живой галереи

**WHY**: подготовить инфраструктуру для T5.5.

**WHAT**: новые файлы в `e2e/helpers/`:
- `captureFrames.ts` — ring-буфер PNG (использует существующий `captureWindowDirect`).
- `saveGif.ts` — Python+PIL append_images через execFile.
- `countPalette.ts` — count pixels близких к (r,g,b) с tolerance (расширение `countLightPixels`).
- `setOverlayTheme.ts` — обёртка над `commands.setHandyTheme`.
- `injectFakeAudioPeak.ts` / `injectFakeAudioSilence.ts` — обёртки.
- `saveDiffOverlay.ts` — PIL diff overlay.

**Improve**:
- В существующих helpers `captureScreen.ts` — есть `countLightPixels`, дополнить тестом в `e2e/helpers/__tests__/`.

**DONE WHEN**:
- Все 6 хелперов покрыты vitest unit-тестами (на mock PNG);
- Commit: `feat(test-utils): captureFrames/saveGif/countPalette/setOverlayTheme/injectFakeAudio (Phase 5.4)`.

---

### T5.5 · Live gallery spec (7 тем × 8 кадров = 56 проверок)

**WHY**: главная метрика успеха миграции.

**WHAT**: `e2e/handy-themes-live-gallery.spec.ts` — циклом по 7 темам:
- Каждая тема: 8 тестов из trigger matrix.
- Сохраняет PNG в `test-results/handy-gallery/<theme>/0X-name.png`.
- Каждый тест содержит pixel assertion.

**DONE WHEN**:
- 56 e2e GREEN на mac (NSPanel) и Linux (WebView);
- Commit: `test(e2e): live handy-themes-live-gallery (7 themes × 8 frames) (Phase 5.5)`.

---

### T5.6 · Live animations spec + globalTeardown HTML index

**WHAT**:
- `e2e/handy-themes-live-animations.spec.ts` — 3 теста (breathing on/off + peak-decay).
- `e2e/global-teardown.ts` — после всех e2e строит `test-results/handy-gallery/index.html` из найденных PNG/GIF.

**DONE WHEN**:
- 3 e2e GREEN + index.html генерится;
- Commit: `test(e2e): live animations gallery + auto HTML index (Phase 5.6)`.

---

## Phase 6 · UI selector (2 задачи, ~2 ч)

### T6.1 · `list_handy_themes` команда + бэкенд

**WHAT**: `list_handy_themes() -> Vec<HandyThemeSummary>` — возвращает `{id, name, preview_palette}` для всех 7. +cargo тесты.

**DONE WHEN**: Commit `feat(rust): list_handy_themes for selector (Phase 6.1)`.

---

### T6.2 · `ThemeSelector` component + интеграция в Settings

**WHAT**:
- `src/components/settings/ThemeSelector.tsx` — список с preview-пилюлями.
- `settingsRegistry.ts`: `key: "overlay_theme"` теперь `widgetType: "custom"`, customComponent: `"theme-selector"`.
- vitest на selector.

**DONE WHEN**: +3 vitest, +1 e2e «выбор темы в Settings меняет pill за <500ms». Commit: `feat(settings): ThemeSelector with preview pills (Phase 6.2)`.

---

## Phase 7 · Cleanup legacy (1 задача, отдельный PR)

### T7.1 · Удалить organic_ring legacy

**WHY**: Handy полностью покрывает функциональность; legacy — балласт.

**WHAT** (отдельный PR, после стабилизации Phase 5/6):
- удалить `OrganicRing.tsx`, `OverlayCanvas.tsx`, `ringGeometry.ts`, `__tests__`;
- удалить `src-tauri/src/overlay_bin/**` + binary `soupawhisper-overlay`;
- удалить `src-tauri/src/overlay_native/subprocess.rs`, `native.rs`;
- очистить unused типы из `bindings.ts` (OrganicRingShape, OrganicRingMotion, family);
- удалить wgpu/egui/glfw зависимости из `Cargo.toml`;
- удалить `cocoa`, `objc` если только overlay_bin их использовал;
- очистить `overlay/themes` от полей `family`, `organic_ring{}`, `colors`, `use_gradient`, `gradient` — оставить только `name`, `description`, `handy_pill`.

**DONE WHEN**:
- cargo test --lib: -~16 тестов (overlay_bin tests удалены);
- -1900 LoC;
- bundle size frontend: -~6 KB;
- voice binary бандл: -6 МБ;
- Commit: `refactor(overlay): remove organic_ring legacy (Phase 7)`.

---

## Master checklist (для слабого агента)

После КАЖДОГО таска:
- [ ] `cd src-tauri && cargo test --lib 2>&1 | tail -3` — 755+N GREEN
- [ ] `cd src-tauri && cargo clippy --lib --tests 2>&1 | grep -E "warning|error"` — пусто
- [ ] `bun run test:run 2>&1 | grep "Test "` — 976+N GREEN
- [ ] `bun run test:e2e 2>&1 | tail -3` — 109+N GREEN
- [ ] `git status --short` — только expected files
- [ ] commit message соблюдает conventional commits
- [ ] `git push` (только если предыдущие 5 пунктов GREEN)

Если что-то красное: НЕ КОММИТИТЬ. Откатить → починить → пере-тестить.

---

## Прогресс (обновлять после каждого таска)

| Task | Status | Commit | Date |
|------|--------|--------|------|
| T0.1 baseline | ✅ 755/976/113/0 | (no commit, snapshot only) | 2026-05-13 09:40 |
| T1.1 RED schema | ✅ 15 RED | d966034 | 2026-05-13 09:44 |
| T1.2 GREEN schema | ✅ 15 GREEN (991 total) | 89c85e3 | 2026-05-13 09:47 |
| T1.3 useSmoothBars refactor | ✅ 13/13 (994 total) | df594ae | 2026-05-13 09:50 |
| T2.1 RED Provider | ✅ 8 RED | (squashed into 9a20248) | 2026-05-13 09:54 |
| T2.2 GREEN Provider | ✅ 8 GREEN (1002 total) | 9a20248 | 2026-05-13 09:55 |
| T2.3 CSS vars refactor | ✅ 1002 still GREEN | 37fef6c | 2026-05-13 09:57 |
| T2.4 Wire OverlayApp | ✅ 1003 + 7 e2e GREEN | e57d42f | 2026-05-13 10:01 |
| T3.1 RED Rust | ✅ 9 RED | (in T3.2 commit) | 2026-05-13 10:08 |
| T3.2 GREEN Rust + command | ✅ 9 GREEN (764 total) | 7298825 | 2026-05-13 10:11 |
| T4.1 Populate 7 themes | ✅ +1 distinct test (765 total) | f7784ef | 2026-05-13 10:18 |
| T5.1 getHandyTheme wire | ✅ 1003 vitest + 7 e2e | 68f1009 | 2026-05-13 10:25 |
| T5.2 Debug commands | 🔜 (pending live gallery) | — | — |
| T5.3 Synthetic e2e | ✅ 15 new · 128 total | 9add194 | 2026-05-13 10:35 |
| T5.4 E2E helpers | — | — | — |
| T5.5 Live gallery spec | — | — | — |
| T5.6 Animations + index | — | — | — |
| T6.1 list_handy_themes | — | — | — |
| T6.2 ThemeSelector | — | — | — |
| T7.1 Cleanup legacy | — | — | — |

---

**Старт: T0.1**
