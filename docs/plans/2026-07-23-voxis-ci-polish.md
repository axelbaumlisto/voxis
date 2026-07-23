# Voxis CI/CD — доведение до идеала (v3)

> **Goal:** закрыть ОСТАВШИЕСЯ недоработки server-way CI/CD. Большая часть
> исходных задач УЖЕ реализована в репе (проверено построчно) — v3 сведён к
> фактической дельте. Acceptance = наблюдаемый результат прогона.

**Что УЖЕ сделано в репе (проверено, НЕ переделывать):**
- **Симметрия артефактов:** `release.yml` заливает `*.deb`/`*.rpm` через
  per-class globs + `nullglob` + hard-fail на ОБЕИХ площадках
  (Forgejo `:237-247`, GitHub `:282-294`), publish-job сверяет имена
  (`:354-355`) + bare `ls -la artifacts/`. Гибрид (явные имена стабильных
  артефактов + `*.deb`/`*.rpm` для bundler-именованных) — устойчив к
  rpm-release-counter. **Готово.**
- **Homebrew token-hardening в скрипте:** `update-homebrew.sh:40-73` —
  `GIT_TERMINAL_PROMPT=0`, `unset GITHUB_TOKEN GH_TOKEN` + `gh auth token` →
  `x-access-token:` URL, `timeout 120` на clone/push, `git config user.*`,
  идемпотентный `git diff --cached --quiet || commit`. **Готово.**
- **Re-tag guard:** input `allow_republish` (default false) + enforced-проверка
  «отказать, если у тега уже есть опубликованные ассеты»
  (`release.yml:11-14,145-158`). **Готово** (механизм, не только конвенция).
- **docs-agent hygiene:** `run-docs-agents.sh` — `pi -p --no-session
  --append-system-prompt`, setsid + `kill -PGID` + `fuser -k 5173/tcp` +
  EXIT-trap. Хангов/утечек нет. **Готово.**
- **macOS arm64-only, артефакты в `artifacts/`, publish внутри `build` job.**

**Контекст:**
- Job'ы: `test → build → {docs-audit ∥ publish}`. Публикация внутри `build`.
- docs.voxis.top = **GitHub Pages через GitHub Actions source**
  (`.github/workflows/pages.yml`: `configure-pages`/`jekyll-build-pages`/
  `upload-pages-artifact`/`deploy-pages`), авто-ребилд на push в GitHub `main`
  при изменении `docs-site/**`. **НЕ branch-source.**
- `gh` на spex = `axelbaumlisto`. clipshot docs-модель (Jekyll на spex + Caddy)
  — иная, требует DNS/TLS-миграции.

**Ключевое переосмысление Task «docs» (проверено):**
`run-docs-agents.sh` НЕ делает commit/push. Агенты регенерят `docs-site/` в
общий чекаут, а `build`-шаг `restore repo to main` (`git checkout main &&
git pull --ff-only`) их **выбрасывает**. То есть баг НЕ «CI мусорит в main», а
**«регенерация никуда не деплоится»** + гонка общего чекаута (docs-audit пишет,
пока sibling-job трогает тот же tree). Значит любой deploy-путь — net-new.

---

## Задача A: homebrew-voxis tap — создать репо + подключить + gate tarball

**Files:** `.forgejo/workflows/release.yml`, `scripts/ci/update-homebrew.sh`,
`homebrew-tap/Formula/voxis.rb`, CHANGELOG/skill (+ создание GitHub-репо через `gh`)

**Дельта (что реально осталось):**
1. Создать публичный `axelbaumlisto/homebrew-voxis` через `gh` с `Formula/voxis.rb`.
   Имя критично: `brew tap axelbaumlisto/voxis` → `github.com/axelbaumlisto/homebrew-voxis`.
2. Задать `HOMEBREW_TAP_REPO=https://github.com/axelbaumlisto/homebrew-voxis.git`
   в env шага «update Homebrew formula» (сейчас unset → push no-op).
3. Добавить в `update-homebrew.sh` **integrity-gate ПЕРЕД push формулы**:
   `curl -fsSL "$URL" | sha256sum` == вычисленному sha (не только `-fsIL`
   reachability — GitHub upload = continue-on-error, возможен partial/404).
   При провале — НЕ пушить (оставить старую валидную формулу), внятно
   залогировать. Скрипт уже early-exit'ит если macOS-tarball отсутствует.
4. Выровнять доки/CHANGELOG/skill на `brew install axelbaumlisto/voxis`.
5. Наблюдаемость: после push — re-clone тапа и grep версии, эмитить
   job-summary маркер (advisory-провал не должен быть тихо-зелёным).

**Rationale (formula, не cask):** бинарь `voice`→`voxis` CLI-invocable
(`--version`), простой tap; cask избыточен для одиночного arm64-бинаря.

**Acceptance:**
- `axelbaumlisto/homebrew-voxis` публичный, `Formula/voxis.rb` присутствует.
- `brew tap axelbaumlisto/voxis && brew info voxis` резолвит; `ruby -c` ок.
- После релиза: формула version+sha == опубликованного tarball, `curl -fsSL`
  байты совпадают с pinned sha, URL 200.
- Провал push виден (маркер), не тихо-зелёный.

**Verify:** `gh repo view axelbaumlisto/homebrew-voxis`; `ruby -c`;
`curl -fsSL "$URL" | sha256sum` == формула.

---

## Задача B: artifacts/ → .gitignore (гигиена, promote из P2)

**Files:** `.gitignore`

**Проблема:** `artifacts/` НЕ игнорируется (проверено `git check-ignore`).
Release-бинари живут там; один случайный `git add -A` в любом будущем шаге
затянул бы сотни МБ в коммит. Фикс — одна строка, нулевой риск.

**Steps:** добавить `artifacts/` (и `.worktrees/` если ещё нет) в `.gitignore`.

**Acceptance:** `git check-ignore artifacts/` → ignored; `git status` в чистом
дереве после сборки не показывает `artifacts/`.

---

## Задача C: docs — задеплоить регенерацию через PR-to-main (не трогая pages.yml)

**Files:** новый `.forgejo/workflows/docs.yml`, возможно `scripts/ci/docs-pr.sh`;
убрать docs-agent-регенерацию из release-пути (release не деплоит docs).

**Почему PR-to-main (рекомендация 2/3 критиков), НЕ gh-pages, НЕ Caddy:**
- Pages сейчас = **GitHub Actions source** через `pages.yml`. Переход на
  `gh-pages` branch-source требует ручного флипа настроек репо + вывода
  `pages.yml` из игры (иначе два конкурирующих publisher'а на одном
  `concurrency: pages`) + force-with-lease (конфликт с инвариантом «никогда не
  форс»). Вариант B = БОЛЬШЕ реконфигурации, чем кажется.
- **PR-to-main:** ноль реконфигурации Pages; человеческий review-гейт
  поглощает недетерминизм скриншотов (не нужно решать byte-stable PNG);
  единый deploy-путь; аудируемые диффы; переиспользует `run-docs-agents.sh`
  как есть. Merge PR → срабатывает существующий `pages.yml`.
- Caddy (clipshot-модель) = DNS+TLS-миграция → **P2**.

**Steps:**
1. Новый `.forgejo/workflows/docs.yml`: триггеры `schedule` (еженедельно) +
   `workflow_dispatch`. Release БОЛЬШЕ не запускает docs-агентов (убрать
   docs-audit из release-пути или оставить только read-only аудит без деплоя).
2. Гонять агентов в **отдельном КЛОНЕ** (не worktree того же репо — общий
   .git/index-lock всё равно конфликтует; и не общий `/home/spex/work/voxis`),
   по конкретному пути + свой `concurrency`-group. Переиспользовать
   `run-docs-agents.sh` (setsid/PGID/fuser teardown).
3. `docs-pr.sh`: на свежесфетченном GitHub `origin/main` создать ветку
   `docs/regen-<date>`, `git add -- docs-site/` (ТОЛЬКО pathspec, никогда
   `-A`), commit, push ветку, `gh pr create` (label docs) в GitHub main.
   Аутентификация: `unset GITHUB_TOKEN GH_TOKEN` + `gh` (axelbaumlisto).
   Форс — запрещён; ветка docs/* fast-forward своя.
4. Секрет-гейт: скриншоты через Tauri-mocks (нет реальных ключей/истории) —
   явная проверка перед PR.
5. Наблюдаемость: провал → job-summary маркер; PR-URL в логе.

**Acceptance:**
- Release НЕ запускает docs-агентов и НЕ трогает docs.
- `docs.yml` (dispatch) создаёт PR с регенерированным `docs-site/**` в GitHub
  main; merge → `pages.yml` деплоит docs.voxis.top.
- Никаких бинарей/`artifacts/` в PR (только `docs-site/`).
- Отдельный клон — нет гонки общего чекаута.
- Провал виден, не тихо-зелёный.

**Verify:** ручной `workflow_dispatch` docs.yml → PR открыт, диф только
`docs-site/`, нет orphan-процессов, `main` не тронут напрямую.

---

## Задача D: релиз v0.1.1 + сквозная проверка

**Steps:**
1. Bump `src-tauri/Cargo.toml` + `src-tauri/tauri.conf.json` → `0.1.1`
   (test-job гейтит оба == tag). CHANGELOG.
2. Commit, push forgejo+github, tag `v0.1.1`, push → release.yml.
3. Проверить полный прогон:
   - build: 3 платформы, реальные имена;
   - publish: Forgejo == GitHub по ИМЕНАМ ассетов (deb+rpm на обеих);
   - homebrew: формула в `homebrew-voxis` = 0.1.1, URL 200, sha совпадает,
     маркер успеха;
   - docs: НЕ трогается релизом;
   - нет orphan-процессов.
4. НИКОГДА не re-tag v0.1.0 (allow_republish guard это и защищает).

**Acceptance:** все job'ы success (advisory-провалы видимы); площадки
симметричны по именам; homebrew валиден и указывает на живой tarball с верным
sha; v0.1.0 не тронут.

---

## Открытый вопрос GitHub deb/rpm: WARNING vs hard-fail

Сейчас Forgejo missing deb/rpm → `exit 1`; GitHub → только WARNING (Forgejo
объявлен канонический). НО: GitHub — фактический канал скачивания (кнопки
лендинга + homebrew URL → github.com releases). Критик безопасности: повысить
GitHub deb/rpm до hard-fail (после подтверждения `gh`-auth), иначе «симметрия»
не enforced и канонический канал может тихо потерять артефакт.

**Решение:** повысить GitHub deb/rpm до **hard-fail** в publish-verify (GitHub —
реальный канал). Оставить сам GitHub-upload-шаг `continue-on-error` (сетевые
флуктуации), но финальный verify-job делает набор ассетов обязательным на обеих.
Это часть Задачи A/D (правка publish-verify).

---

## Порядок и зависимости

| Задача | Files | Зависит | Параллельно? |
|--------|-------|---------|--------------|
| A homebrew | release.yml, update-homebrew.sh, formula, +gh repo | — | нет (release.yml) |
| B gitignore | .gitignore | — | да (не пересекается) |
| C docs decouple | new docs.yml, release.yml, +docs-pr.sh | — | частично (release.yml) |
| D v0.1.1 e2e | Cargo.toml, tauri.conf.json, CHANGELOG | A,B,C | нет (финал) |

A и C правят `release.yml` → **последовательно**. B независима. D — финал.

**Сквозные инварианты (применить везде):**
- GitHub-операции на Forgejo-раннере: `unset GITHUB_TOKEN GH_TOKEN` + `gh auth
  token`/`x-access-token`; `GIT_TERMINAL_PROMPT=0`, `timeout`, `git config user.*`.
- Форс-пуш ЗАПРЕЩЁН (main и docs/*); ветки docs/* — свои ff.
- Явные pathspec при `git add` (`artifacts/` теперь gitignored — Задача B).
- Advisory-провал ДОЛЖЕН быть наблюдаем (маркер/healthcheck).
- Никогда не re-tag опубликованную версию (guard уже есть).

## Отложено (P2)
- Вариант A (docs на spex Caddy) — если уходим от GitHub Pages.
- Byte-stable скриншоты — не нужны при PR-to-main (review-гейт поглощает churn).
- Integrity-gate remote==sha можно расширить на все площадки.
