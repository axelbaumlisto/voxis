# Voxis Landing — контент и читаемость (v2)

> **Goal:** сделать homepage содержательной и связной. Реальная жалоба:
> «контент тонкий, архитектура читается по частям». 3 контент-критика
> единогласно: страница НЕ пустая — она **mis-weighted**. Пик внимания уходит
> на Rust-модули (Architecture), а то что продаёт продукт пользователю
> (что делает, как использовать, как начать) — однострочники.
> **Структура/дизайн фиксированы — меняем КОНТЕНT.**

**Граница homepage↔docs (критики единогласно):**
- Homepage = нарратив + мотивация + один конкретный on-ramp. Каждая фича —
  «вкус», не спека. Короткая scannable маркетинг-проза.
- Docs = справка/детали (полный settings-реестр, пути конфигов, troubleshooting,
  theme-авторинг). Homepage **линкует** на них, не дублирует.
- Тянуть из docs только *summary* (форму 3-шагового flow из usage.md), НЕ полный
  7-шаговый техсписок. Не воспроизводить settings-таблицу/пути данных.

**УЖЕ СДЕЛАНО (проверено live — НЕ трогать):**
- Вся SEO/meta механика задеплоена: og:image (200), twitter card, robots.txt
  (200), sitemap.xml (200), JSON-LD SoftwareApplication, canonical, hreflang
  en/ru. Прошлый Task-1 доехал. Security-заголовки — единственный SEO-хвост
  (см. фоновую Задачу F).
- Showcase: 4 реальных Voxis+EN скриншота (live).
- Zero-трекеров (privacy-консистентно) — НЕ добавлять аналитику.

**Артефакты review:** `/tmp/ci-polish-review/content-review-{1,2,3}.md`,
источники: `/tmp/ci-polish-review/content-sources.md`.

---

## Задача 1 (HIGH): «How it works» — 3-шаговый flow (главный фикс)

**Файлы:** новый `src/components/HowItWorks.tsx`, `src/components/LandingPage.tsx`
**Место:** после Hero, ПЕРЕД Architecture (чтобы non-expert сначала понял продукт).

**Проблема (все 3 критика, HIGH):** после Hero первый содержательный экран —
Architecture с Rust-идентификаторами. Non-developer не понимает «нажми клавишу и
говори» до самого низа. Нет plain-language объяснения что продукт делает.

**Контент (из `docs-site/usage.md` recording flow, сжато до 3 шагов):**
1. **Press your hotkey** — Hold to record, or Toggle on/off (Right Ctrl default).
2. **Speak** — VAD trims silence; empty/short clips dropped automatically.
3. **Text appears where your cursor is** — auto-typed into any app, or pasted
   with clipboard restore.

**Steps:** новый компонент HowItWorks (icon+verb на шаг), EN+RU, дизайн-токены
как у Features. Вставить в LandingPage после Hero.

**Acceptance:** секция live после Hero; non-expert понимает core-loop с первого
экрана; EN/RU парити; build+lint зелёные.

---

## Задача 2 (HIGH): переписать Architecture — нарратив, не symbol-table

**Файлы:** `src/data/architecture.ts`, `src/components/Architecture.tsx`
(только copy/labels — НЕ структурная переработка 3D-анимации).

**Проблема (критик #2 детально):** секция фрагментирована — 5 изолированных
Rust-модуль-карточек без throughline. Eyebrows `INPUT/CORE/SENSORS/CLOUD/
ACTUATOR` скрывают flow. И **пропущены 2 реальных стадии** пайплайна
(dictionary + LLM) из `development.md` data-flow.

**Steps:**
1. **Throughline** (highest-leverage): одна строка под заголовком, связывающая
   стадии в поток. EN «From key-press to typed text in N stages» / RU «От нажатия
   клавиши до готового текста». Одна intl-строка.
2. **Eyebrows → pipeline-глаголы:** `INPUT/CORE/SENSORS/CLOUD/ACTUATOR` →
   `CAPTURE / COORDINATE / LISTEN / TRANSCRIBE / TYPE` (сохранить mono-caps стиль).
3. **Добавить 6-ю стадию «Refine»** (dictionary replace + optional LLM cleanup) —
   реальные differentiators, сейчас отсутствуют в пайплайне. filePath →
   реальный `llm/mod.rs` или `learning/`. Stepper/chip уже масштабируются на N.
4. **Fix stage-4 «AI Inference / Groq LPU / CLOUD»** → честно «Transcription»:
   «Streams recording to a Whisper-compatible endpoint (Groq default, or any
   OpenAI-compatible via api_url_override)». LPU это железо Groq, не фича Voxis.
5. **Каждый `desc` — с plain-language benefit-предложения**, потом опц. деталь.
   Убрать `lock_or_recover`, «strictly-typed Result» (тривия). Оставить filePath-
   пиллы (trust-сигнал).
6. **RU парити:** stage-2 title «State Machine» не переведён → перевести;
   stage-4 title убрать «(LPU)», выровнять с EN.
7. Опц: «See the full data flow →» линк на docs development.md.

**Acceptance:** секция читается как единый поток (throughline + verb-eyebrows);
пайплайн полный (incl. Refine/dictionary+LLM); ноль «LPU»-puffery (лендинг+
README синхронны); stage-desc с benefit-первой строкой; RU полностью переведён;
build+lint; 3D-анимация не сломана.

---

## Задача 3 (HIGH): Power-features с реальной глубиной + точность

**Файлы:** `src/components/Features.tsx`, `src/components/Faq.tsx`,
`~/work/voxis/README.md` (синхронно LPU)

**Проблема (критики #1,#3):** homepage под-продаёт — реальные headline-фичи
отсутствуют или один-словом. «Content feels empty» = мало *substance на секцию*,
не мало карточек.

**Steps:**
1. Добавить ряд «Power features» (2-3 предложения каждая, НЕ однострочники):
   - **AI cleanup (optional)** — LLM пост-обработка грамматики/формата; выбор
     модели+промпта (Groq/OpenAI/OpenRouter/свой). Мульти-промпт шаблоны.
   - **A dictionary that learns** — замены + обучение с review-first ИЛИ auto
     режимом (реальный differentiator).
   - **Smart silence detection** — Silero VAD не шлёт пустые клипы в API.
   - **Types anywhere** — auto-type в фокус-приложение, auto-enter/auto-submit,
     clipboard-fallback с восстановлением.
   Копия сверяется с `voxis/src/i18n/locales/en.json` `settings.*Desc` (EN+RU).
2. **Смягчить «Groq LPU inference»** → «Groq's Whisper API returns text in ms»
   (Features card EN+RU). Синхронно README hero-caption.
3. **Убрать `api_url_override` жаргон** из маркетинг-карточек → «point it at any
   OpenAI-compatible endpoint» (точный ключ оставить в docs/FAQ).
4. **FAQ hotkey-ответ:** добавить Toggle-режим + per-prompt shortcuts (сейчас
   только Hold — неполно). +Q «Do I need an API key?» +Q «What languages?».
5. **Supported-languages** одна строка (auto-detect + 13 языков + translate-to-EN)
   — из `settings.md`.

**Acceptance:** каждая фича-заявка подтверждена строкой в приложении (en.json);
power-features с 2-3 предложениями; ноль LPU-puffery; FAQ полный; языки указаны;
EN/RU парити.

---

## Задача 4 (MEDIUM): Get-started on-ramp + пакеты + disclosure

**Файлы:** `src/components/DownloadCta.tsx` (или новый GetStarted), Hero, Faq
**Проблема:** нет конкретного on-ramp; нет прямых пакетных ссылок; не раскрыта
API-key модель; macOS arm64-only не указан.

**Steps:**
1. Quickstart-полоса (absorbs API-key disclosure): «Download → paste Groq key →
   press hotkey». Из `installation.md` API-keys, сжато.
2. Платформенные ссылки: Windows NSIS, macOS (Apple Silicon binary + `brew
   install axelbaumlisto/voxis/voxis`), Linux deb/rpm. Через
   `github.com/axelbaumlisto/voxis/releases/latest/download/<asset>`.
3. API-key позитивно: «Free Groq tier by default, or any OpenAI-compatible /
   self-hosted endpoint. Your audio never touches our servers.»
4. Requirements: «macOS 12+ (Apple Silicon), Windows 10+, modern Linux; mic +
   internet for transcription».

**Acceptance:** on-ramp с 3 шагами + пакетные ссылки резолвятся (latest/download
200/302); API-key раскрыт позитивно; requirements incl. Apple-Silicon-only;
EN/RU парити.

---

## Задача 5 (LOW): Showcase-подписи + мелочи
- Showcase: заменить одно-словные подписи на verb-led one-liner под каждой
  плиткой (что показывает, без клика). EN+RU.
- Опц: use-cases строка (coding/writing/messaging/accessibility).

---

## Задача F (фон, LOW): security-заголовки (единственный SEO-хвост)
**Файл:** `next.config.ts` — добавить `headers()`: nosniff, Referrer-Policy,
X-Frame-Options SAMEORIGIN, Permissions-Policy (mic/cam/geo=()). CSP —
закомментированным TODO (canvas/font ломаются). Фоновая, не блокирует контент.

---

## Задача 6: деплой + верификация + vision-designer финал
1. Commit voxis-landing по задачам, push → Vercel. README-правку (LPU) в
   `~/work/voxis` push forgejo+github.
2. Live-проверка acceptance каждой задачи (EN+RU, desktop+mobile).
3. Финальный vision-designer проход.

**Acceptance:** homepage читается связно от Hero→How-it-works→Architecture(flow)→
Features→Showcase→GetStarted→FAQ; контент содержателен; пакеты работают.

---

## Приоритет (перевёрнут vs v1 — контент во главе)
1. **Задача 1** How-it-works (главный фикс «feels empty»)
2. **Задача 2** Architecture нарратив (названная жалоба «читается по частям»)
3. **Задача 3** Power-features глубина + точность (LPU, FAQ)
4. **Задача 4** Get-started + пакеты + disclosure
5. **Задача 5** Showcase-подписи
6. **Задача F** security-заголовки (фон)
7. **Задача 6** деплой+verify

## Зависимости
- Задачи 1,2,3,4 трогают разные файлы (HowItWorks / architecture.ts / Features+Faq
  / DownloadCta) → можно параллельно, но **Faq.tsx в 3 и 4** → 3 и 4
  последовательно ИЛИ объединить Faq-правки. Задача 6 — финал.
- README-LPU правка синхронно с Задачей 3.

## Сквозные инварианты
- Homepage↔docs граница: только summary, линковать глубину (не дублировать docs).
- Каждая фича-заявка сверяется с en.json/README — не выдумывать.
- EN/RU парити для ВСЕЙ новой прозы (критики: удваивает copy-поверхность).
- Дизайн-токены/структура секций сохранять; 3D-анимация Architecture — только
  copy/labels, не structural rework.
- Zero-трекеров. latest/download-ссылки (не хардкодить версию).
