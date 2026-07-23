# Landing Showcase — реальные скриншоты (v2, после review)

> **Goal:** закрыть последний placeholder на лендинге voxis.top — секция
> Showcase (3 пустые плитки). Review (2 критика + vision-designer) вскрыл
> ship-блокеры в исходных скриншотах; план пересмотрен.

## Что review изменил (важно)

**Найдено и уже исправлено по ходу:**
- ✅ **docs baseurl** (designer нашёл как BLOCKER — весь docs-сайт без CSS,
  404 на links/images): оказалось **уже починено** (commit `c29238d`,
  `baseurl: ""`), live docs.voxis.top стилизован, links/images/RU-docs = 200.
  Designer анализировал устаревший live-снимок.
- ✅ **stale-бренд в скриншотах**: `history/settings/dictionary.png` показывают
  «SoupaWhisper 2» + RU-UI + мок-данные (детские стишки). Корень: приложение
  переименовано (`appTitle`=Voxis ✅), но PNG сняты 21.07 ДО ренейма, а
  docs-screenshotter агент остался с брендом SoupaWhisper/TALRI и RU-локалью.
  Исправлено (commit `a1fa03a`): агенты ре-брендированы → Voxis, форс EN-локали
  (`localStorage i18nextLng=en`), чистые EN-сэмплы (без стишков/жаргона).

**Осталось сделать:**
1. Регенерировать скриншоты свежим билдом (Voxis+EN+чистые данные).
2. Вписать их в Showcase-плитки.
3. Задеплоить + визуально проверить.

## Контекст (проверено)
- Лендинг = `github.com/axelbaumlisto/voxis-landing`, **Next.js 16.2** (не 15),
  React 19, Tailwind v4, деплой Vercel авто по push main.
- НЕ static export (`next.config.ts` пустой): `next/image` РАБОТАЛ бы, но нигде
  не используется → берём обычный `<img>` (осознанный выбор consistency, не
  необходимость).
- Showcase (`src/components/Showcase.tsx`): `shots = [t.cap1,t.cap2,t.cap3]`
  (массив строк), grid `md:grid-cols-3`, плитки `aspect-video` glass. Placeholder
  = `ImageIcon` глиф + `TODO(owner)`. Импорт `ImageIcon` в строке 1.
- Реальные скрины (после регенерации) 1280×720 (16:9): history/settings/dictionary;
  overlay-theme.png 640×320 (2:1).

---

## Задача 1: регенерировать чистые EN-скриншоты

**Механизм:** docs.yml (workflow_dispatch) → docs-screenshotter (уже
ре-брендирован) → свежие PNG в изолированном клоне → PR-to-main.

**Steps:**
1. Задиспатчить docs.yml (или дождаться — но лучше руками для этой задачи).
2. Проверить регенерированные `docs-site/images/{history,settings,dictionary,overlay-theme}.png`:
   - title bar = **Voxis** (не SoupaWhisper 2);
   - UI = **English**;
   - данные = чистые EN-сэмплы (не стишки/тесты).
3. Смёрджить docs PR (обновит и docs.voxis.top картинки заодно).

**Acceptance:** 4 PNG показывают Voxis+EN+чистые данные (визуальная проверка
чтением изображений).

---

## Задача 2: положить скриншоты в лендинг

**Files:** `voxis-landing/public/screenshots/*.png`

**Steps:**
1. `mkdir -p public/screenshots/`, скопировать регенерированные
   `overlay-theme.png`, `history.png`, `settings.png` (+ `dictionary.png` для
   4-плиточного варианта — см. Задачу 3).
2. Экспорт в 2× (2560×1440) для retina, если возможно (плитки ~350-400px, 1280×720
   — минимум). При регенерации указать scale=2.
3. Вес: цель <400KB суммарно (текущие 47-111KB укладываются).

**Acceptance:** файлы в `public/screenshots/`, вес разумный.

---

## Задача 3: заменить placeholder на `<img>` (с фиксами критика)

**Files:** `voxis-landing/src/components/Showcase.tsx`

**Обязательные фиксы из review:**
- **Удалить `import { ImageIcon }`** (строка 1) — иначе `no-unused-vars` = lint
  ERROR (валит `bun run lint`).
- **`@next/next/no-img-element`** = warn на `<img>`: добавить
  `{/* eslint-disable-next-line @next/next/no-img-element */}` над каждым `<img>`
  (иначе 3 warning'а — «eslint зелёные» будет неправдой).
- **Реструктурировать `shots`** из `string[]` в объекты
  `{ src, alt, fit, cap }` (не хардкодить src по индексу).
- overlay-theme.png (2:1) → `object-contain` на near-black фоне (letterbox
  невидим на #000) — **детерминированный выбор, не «на усмотрение»**.
  history/settings/dictionary (16:9) → `object-cover` (ноль искажений).

**Layout-решение (designer рекомендует 4 плитки):**
Дефолт — **4 плитки** `overlay / history / settings / dictionary`, каждая со
своей одно-словной подписью (dictionary — реальный дифференциатор, есть в
Features). Grid → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`.
Альтернатива (если 3): переименовать cap3 «Settings & dictionary» → «Settings»
(не показывать settings.png под подписью, обещающей dictionary).

**Steps:**
1. Убрать `ImageIcon` глиф + import + `TODO`-коммент.
2. `shots` → массив объектов с src/alt/fit; alt осмысленный («Voxis recording
   overlay» и т.п.), не дубль подписи.
3. `<img class="w-full h-full object-{cover|contain}" loading="lazy"
   decoding="async">` + eslint-disable-line.
4. Сохранить glass-токены плиток (`--glass-radius`, border, bg).
5. Grid на 4 колонки (или оставить 3 + переименовать cap3).

**Acceptance:**
- Showcase рендерит реальные скрины (нет ImageIcon/TODO), нет CLS/искажений.
- `bun run build` + `bun run lint` **реально** зелёные (0 errors; warning'и
  подавлены eslint-disable или явно приняты).
- Подпись↔картинка совпадают (нет «& dictionary» под одиночным settings).

**Verify:** локально `bun run build && bun run start`, скриншот Showcase.

---

## Задача 4: деплой + визуальная верификация

**Steps:**
1. Commit voxis-landing, push main → Vercel авто-деплой.
2. Снять live-скриншот voxis.top Showcase: десктоп+мобайл, EN+RU.
3. Убедиться: скрины грузятся (200), Voxis+EN, кадрирование чистое,
   консистентно с дизайн-системой, мобайл не ломается.

**Acceptance:** live Showcase = реальные Voxis-скрины, консистентно, RU/EN ок.

---

## Отложено (P2, из designer-отчёта)
- **Skin docs под лендинг**: docs = дефолтный minima (бело-serif), лендинг =
  cyan/dark. ~30-строчный `assets/main.scss` override ($brand-color #22d3ee,
  тёмный фон, mono-заголовки, back-to-voxis.top). MEDIUM — не блокер.
- **overlay-over-real-app композит** для плитки 1 (сейчас абстрактные блобы —
  on-brand, но не самоочевидно «оверлей»). Улучшение, не блокер.
- Проверить мобильный docs overflow после baseurl-фикса (должен уйти с minima CSS).

## Порядок
1 (регенерация) → 2 (копировать) → 3 (Showcase.tsx) → 4 (деплой+verify).
Последовательно (один репо-контекст на шаг).
