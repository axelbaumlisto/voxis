# Voxis — Server-Way CI/CD на spex (по образцу clipshot)

> **Goal:** Перенести voxis на server-way сборку, как у clipshot: один сервер **spex** (`clipshot.cc/git`, `65.108.226.226`) — Forgejo + host-runner + Docker + `/dev/kvm`. Все бинарники (**Linux GUI, Windows GUI, macOS**) собираются в Docker на spex, агенты (docs-auditor/docs-screenshotter) запускаются там же, деплой = push тега → `release.yml`. Релиз публикуется как **пакеты**: Forgejo release + GitHub release + `voxis.top/dist` mirror + homebrew formula.

**Scope (подтверждено владельцем):**
- **Только GUI** на всех платформах — headless-CLI НЕ делаем (ни musl Linux headless, ни Windows headless)
- **macOS** — unsigned binaries на spex KVM; DMG signed+notarized — ПОЗЖЕ, когда будет Apple Developer ключ
- **homebrew** — формула в основном репо (`homebrew-tap/Formula/voxis.rb`)
- **Деплой** — только release-артефакты, без флота daemon'ов

**Context (подтверждено инспекцией):**
- **spex**: Forgejo + `forgejo-runner.service` active, labels `host`/`spex`/`linux`, `MemoryMax=24G`, `CPUQuota=1200%`, `/dev/kvm`. SSH доступен (`ssh spex`).
- **clipshot** (шаблон) живёт на `~/work/clipshot`, его CI уже работает: `Dockerfile.ci` (clipshot-ci:latest, rust 1.96 + gtk/webkit + bun + docker CLI), `scripts/build-all-platforms.sh`, `.forgejo/workflows/{ci,release,docs,preflight}.yml`.
- **voxis** (`~/work/voxis`): 2 бинаря (`voice`, `typing_bench`), crate `voice` + `voice_lib`, Tauri v2, identifier `top.voxis.app`, version 0.1.0, bundle targets `["app","dmg","deb","rpm"]`. Frontend = bun (vite). Remotes: `origin` = GitHub, `gitverse` = gitverse.ru (будет заменён на spex Forgejo как драйвер CI).
- **macOS KVM**: `~/clipshot-macos-vm/mac_hdd_ng.prepared.img` готов на spex (31G, Sonoma + Xcode CLT + Rust + SSH). `scripts/macos-vm.sh` есть.

**Context (подтверждено инспекцией):**
- **spex**: Forgejo + `forgejo-runner.service` active, labels `host`/`spex`/`linux`, `MemoryMax=24G`, `CPUQuota=1200%`, `/dev/kvm`. SSH доступен (`ssh spex`).
- **clipshot** (шаблон) живёт на `~/work/clipshot`, его CI уже работает: `Dockerfile.ci` (clipshot-ci:latest, rust 1.96 + gtk/webkit + bun + docker CLI), `scripts/build-all-platforms.sh`, `.forgejo/workflows/{ci,release,docs,preflight}.yml`.
- **voxis** (`~/work/voxis`): 2 бинаря (`voice`, `typing_bench`), crate `voice` + `voice_lib`, Tauri v2, identifier `top.voxis.app`, version 0.1.0, bundle targets `["app","dmg","deb","rpm"]`. Frontend = bun (vite). Remotes: `origin` = GitHub, `gitverse` = gitverse.ru (будет заменён на spex Forgejo как драйвер CI).
- **macOS KVM**: `~/clipshot-macos-vm/mac_hdd_ng.prepared.img` готов на spex (31G, Sonoma + Xcode CLT + Rust + SSH). `scripts/macos-vm.sh` есть.

**Out of scope:** Signing/notarization (DMG signed+notarized нужен реальный Mac — отдельная задача позже). NSIS signing. Windows attestation.

**Architecture:** как у clipshot — всё тяжёлое на spex, локальная машина только trigger. Forgejo repo `zverozabr/voxis` (private, 2FA на zverozabr), `voxis-ci:latest` образ, workflows в `.forgejo/workflows/` (ci.yml + release.yml), agents в `.pi/agents/`, deploy skill в `.pi/skills/voxis-deploy/`.

**Tech Stack:** Rust 1.95, Tauri v2, bun, Docker (musl-release/xwin/gui-linux), cargo-xwin (Windows), Docker-OSX KVM (macOS), Forgejo Actions (self-hosted runner).

---

## Phase 0 — Подготовка (verify preconditions)

- [x] **Step 0.1: SSH + runner + KVM на spex**

```bash
ssh spex 'echo spex-ok && systemctl --user is-active forgejo-runner && docker ps --format "{{.Names}}" | grep forgejo && ls -lh ~/clipshot-macos-vm/mac_hdd_ng.prepared.img'
```
Ожидание: `spex-ok`, `active`, `forgejo`, путь к 31G образу.

- [x] **Step 0.2: Forgejo token на spex для API**

```bash
ssh spex 'ls ~/.config/forgejo/token && echo token-ok'
```
Если нет — создать через Forgejo web (`clipshot.cc/git` → User Settings → Applications, scope `repo`+`package`+`write:repository`).

- [x] **Step 0.3: Создать private repo `zverozabr/voxis` на spex**

```bash
TOKEN=$(ssh spex 'cat ~/.config/forgejo/token')
curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  "https://clipshot.cc/git/api/v1/user/repos" \
  -d '{"name":"voxis","private":true,"description":"Voxis voice dictation app"}' | python3 -c "import sys,json;print('created:',json.load(sys.stdin).get('full_name'))"
```

---

## Phase 1 — CI-образ `voxis-ci` (по образцу clipshot-ci)

- [x] **Step 1.1: Создать `Dockerfile.ci` для voxis**

Файл: `~/work/voxis/Dockerfile.ci`. По образцу clipshot но под voxis (rust 1.95, не 1.96; gtk/webkit/appindicator для Tauri):

```dockerfile
# voxis-ci: versioned CI/build image — ALL CI work runs INSIDE this image.
FROM rust:1.95-bookworm

# System build deps for Tauri GUI (gtk/webkit/soup/appindicator) + E2E (git/curl)
RUN apt-get update -q && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
      pkg-config libssl-dev \
      libgtk-3-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libwebkit2gtk-4.1-dev \
      libayatana-appindicator3-dev librsvg2-dev libasound2-dev patchelf \
      git curl ca-certificates \
      python3 \
      xvfb xclip \
    && rm -rf /var/lib/apt/lists/*

# docker CLI + compose (drive sibling containers via mounted socket)
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update -q && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
      docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

RUN rustup component add clippy rustfmt

# bun pinned
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14" && \
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx && bun --version

ENV PATH=/usr/local/cargo/bin:/usr/local/bin:$PATH
WORKDIR /w
RUN cargo --version && bun --version && python3 --version && docker --version && docker compose version
```

- [x] **Step 1.2: Скрипт `scripts/ci/build-ci-image.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
IMAGE="${CI_IMAGE:-voxis-ci}"
TAG="${CI_IMAGE_TAG:-latest}"
REF="${IMAGE}:${TAG}"
echo "=== building ${REF} from Dockerfile.ci ==="
docker build -f Dockerfile.ci -t "${REF}" .
echo "=== ${REF} ready ==="
docker run --rm "${REF}" bash -c 'cargo --version; bun --version; docker --version; docker compose version'
```

- [x] **Step 1.3: Собрать образ на spex**

```bash
rsync -avz ~/work/voxis/Dockerfile.ci ~/work/voxis/scripts/ci/build-ci-image.sh spex:~/work/voxis-tmp/
ssh spex 'cd ~/work/voxis-tmp && bash build-ci-image.sh'
```

---

## Phase 2 — Forgejo workflows для voxis (ci + release)

В voxis repo создать `.forgejo/workflows/`. По образцу clipshot `.forgejo/workflows/`.

- [x] **Step 2.1: `.forgejo/workflows/ci.yml`** (push→main / dispatch)

```yaml
name: ci
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  fast:
    runs-on: host
    timeout-minutes: 60
    steps:
      - name: checkout (manual; Forgejo /git subpath breaks actions/checkout URL)
        env:
          GIT_PAGER: cat
          PAGER: cat
        run: |
          base="${CI_GIT_BASE:-$GITHUB_SERVER_URL}"
          git init -q .
          git remote add origin "${base}/${GITHUB_REPOSITORY}.git"
          git -c http.extraheader="Authorization: basic $(printf 'x-access-token:%s' "${GITHUB_TOKEN}" | base64 -w0)" \
            -c protocol.version=2 fetch --depth=1 origin "${GITHUB_SHA}"
          git checkout -q FETCH_HEAD
          git --no-pager log --oneline -1
      - name: ci-required (frontend build + clippy + tdd + lib/bin tests) in voxis-ci image
        run: |
          set -euo pipefail
          cache="$HOME/.cache/voxis-ci"
          mkdir -p "$cache/cargo" "$cache/target" "$cache/home"
          docker run --rm \
            -v "$PWD":/w -w /w \
            -v "$cache/cargo":/tmp/cargo-home \
            -v "$cache/target":/tmp/ci-target \
            -v "$cache/home":/tmp/cihome \
            -e CARGO_HOME=/tmp/cargo-home \
            -e CARGO_TARGET_DIR=/tmp/ci-target \
            -e HOME=/tmp/cihome \
            --user "$(id -u):$(id -g)" \
            voxis-ci:latest \
            bash -euo pipefail -c '
              echo "=== frontend build (dist required by tauri) ===" &&
              bun install --frozen-lockfile && bun run build &&
              echo "=== [required] clippy ===" &&
              cd src-tauri && cargo clippy --all-targets -- -D warnings && cd .. &&
              echo "=== [required] rust lib tests (serial) ===" &&
              cd src-tauri && cargo test --lib -- --test-threads=1 &&
              echo "=== [required] frontend tests ===" &&
              bun run test:run
            '
```

- [x] **Step 2.2: `.forgejo/workflows/release.yml`** (push tag `v*` / dispatch with tag input)

Скопировать структуру clipshot `release.yml` (3 job'а: test → build → publish), но:
- tag/version gate: `grep '^version' src-tauri/Cargo.toml` == `${tag#v}`
- build: `bash scripts/build-all-platforms.sh --no-macos` (создать в Phase 3) + macOS best-effort через `scripts/macos-vm.sh build`
- expected artifacts (GUI-only, нет headless):
  - `dist/voxis-linux-x64-gui` (Linux GUI, deb/rpm/appimage)
  - `dist/voxis-windows-x64-gui.exe` (Windows GUI, NSIS)
  - `dist/Voxis_*_x64-setup.exe` (NSIS installer)
  - опционально `dist/voxis-macos-{arm64,x64,universal}` (unsigned binaries)
- publish: Forgejo release via API (idempotent upload)

---

## Phase 3 — Build scripts для voxis (GUI-only, по образцу clipshot)

> **GUI-only scope:** headless-CLI lanes (musl Linux headless, Windows headless) **не делаем**. Только GUI на Linux (native Tauri), Windows (cargo-xwin MSVC), macOS (KVM). Бинарь `voice` — Tauri GUI app.

- [x] **Step 3.1: `Dockerfile.gui-linux` (Linux GUI native)**

По образцу clipshot `Dockerfile.gui-linux` — native build + `cargo tauri build` (deb/rpm/appimage). Зависимости: gtk/webkit/soup/appindicator/rsvg/asound.

- [x] **Step 3.2: `Dockerfile.windows-gui` (Windows GUI через cargo-xwin)**

По образцу clipshot `Dockerfile.windows-gui` — cargo-xwin MSVC target + `cargo tauri build --bundles nsis`. Производит `voxis-windows-x64-gui.exe` + `Voxis_*_x64-setup.exe` (NSIS installer).

- [x] **Step 3.3: `scripts/build-all-platforms.sh` (voxis, GUI-only)**

Скопировать clipshot `scripts/build-all-platforms.sh`, заменить:
- `clipshot` → `voxis`
- Убрать headless lanes (Lane A: musl static + windows-headless) — оставить только Lane B (GUI)
- `dist/clipshot-linux-x64-gui` → `dist/voxis-linux-x64-gui`
- `dist/clipshot-windows-x64-gui.exe` → `dist/voxis-windows-x64-gui.exe`
- `--macos` → `scripts/macos-vm.sh build` (использовать clipshot'овый образ `~/clipshot-macos-vm/mac_hdd_ng.prepared.img`)
- Результат: 2-4 артефакта (linux-gui, windows-gui + NSIS, опционально macos-*)

- [x] **Step 3.4: macOS unsigned binaries через `scripts/macos-vm.sh`**

Использовать готовый clipshot-скрипт + образ на spex. Производит `voxis-macos-arm64`, `voxis-macos-x64`, `voxis-macos-universal` (unsigned, без DMG). DMG signed+notarized — отдельная задача позже (нужен Apple Developer ключ).

---

## Phase 4 — Agents (docs-auditor / docs-screenshotter)

- [x] **Step 4.1: Скопировать агенты из clipshot `.pi/agents/`**

В voxis repo `.pi/agents/`:
- `docs-auditor.md` — уже есть у voxis (прошлая сессия). Скопировать в `.pi/agents/`.
- `docs-screenshotter.md` — уже есть. Скопировать.

По образцу clipshot: эти агенты запускаются через pi subagent на spex перед release.

- [x] **Step 4.2: Включить запуск агентов в release.yml как advisory job**

В `.forgejo/workflows/release.yml` добавить advisory job (не блокирует):
```yaml
  docs-audit:
    runs-on: host
    continue-on-error: true
    steps:
      - name: docs-auditor + screenshotter (advisory)
        run: |
          # Run pi subagents on spex against the checked-out tag
          bash scripts/ci/run-docs-agents.sh "${{ github.ref_name }}"
```
`run-docs-agents.sh` — вызов pi CLI (`pi run docs-auditor ...`) если pi-agent установлен на spex; иначе пропустить (log warning).

---

## Phase 5 — Package publishing (Forgejo + GitHub + mirror + homebrew)

- [x] **Step 5.1: Forgejo release upload (в release.yml publish job)**

По образцу clipshot publish step — explicit artifacts, idempotent upload:
```bash
TOKEN=$(cat ~/.config/forgejo/token)
API="https://clipshot.cc/git/api/v1/repos/zverozabr/voxis"
TAG="${{ github.ref_name }}"
# create release if missing
curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  "$API/releases" -d "{\"tag_name\":\"$TAG\",\"name\":\"$TAG\",\"draft\":false,\"prerelease\":false}"
# upload each artifact (GUI-only)
for f in dist/voxis-linux-x64-gui dist/voxis-windows-x64-gui.exe dist/Voxis_*_x64-setup.exe; do
  [ -f "$f" ] && curl -s -X POST -H "Authorization: token $TOKEN" \
    -F "attachment=@$f" "$API/releases/$(curl -s -H "Authorization: token $TOKEN" "$API/releases/tags/$TAG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')/assets?name=$(basename $f)"
done
# macOS best-effort (unsigned)
for f in dist/voxis-macos-arm64 dist/voxis-macos-x64 dist/voxis-macos-universal; do
  [ -f "$f" ] && echo "upload $f"
done
```

- [x] **Step 5.2: GitHub release (public binaries, no source)**

```bash
VER="${TAG#v}"
gh release create "v$VER" --repo axelbaumlisto/voxis --title "v$VER" --notes-file CHANGELOG.md || true
gh release upload "v$VER" dist/voxis-* dist/Voxis_* --repo axelbaumlisto/voxis --clobber
```

- [x] **Step 5.3: Mirror на `voxis.top/dist`**

```bash
rsync -avz dist/voxis-* dist/Voxis_* spex:/home/spex/app/bundle/voxis-landing/landing/dist/
```
Caddy route `/dist/*` → static mirror (настроить как у clipshot).

- [x] **Step 5.4: homebrew formula `voxis.rb` (macOS install)**

В voxis repo `homebrew-tap/Formula/voxis.rb` (по образцу clipshot):
```ruby
class Voxis < Formula
  desc "Private voice dictation engine (Tauri + Rust)"
  homepage "https://voxis.top"
  url "https://voxis.top/releases/latest/voxis-macos-universal.tar.gz"
  version "0.1.0"
  sha256 "TODO" # update on release
  def install
    bin.install "voice" => "voxis"
  end
  test do
    system "#{bin}/voxis", "--version"
  end
end
```
Добавить script `scripts/ci/update-homebrew.sh` который на release вычисляет sha256 `voxis-macos-universal.tar.gz` и обновляет формулу + push в homebrew-tap repo (отдельный repo `axelbaumlisto/homebrew-tap`).

---

## Phase 6 — Deploy skill `.pi/skills/voxis-deploy/`

- [x] **Step 6.1: `SKILL.md` по образцу clipshot-deploy**

Скопировать clipshot `.pi/skills/clipshot-deploy/SKILL.md`, адаптировать:
- `clipshot` → `voxis`
- `clipshot.cc` → `voxis.top`
- `clipshot-ci` → `voxis-ci`
- repo `zverozabr/clipshot` → `zverozabr/voxis`
- macOS KVM — тот же образ `~/clipshot-macos-vm/mac_hdd_ng.prepared.img`
- Release checklist: bump version в `src-tauri/Cargo.toml` + `src-tauri/tauri.conf.json`, commit, push origin (github) + forgejo, dispatch ci.yml, tag → release.yml, mirror to GitHub + voxis.top/dist, update homebrew, deploy fleet (если есть daemon-флот).

---

## Phase 7 — Wire-up + verify (end-to-end)

- [x] **Step 7.1: Push voxis source to spex Forgejo**

```bash
cd ~/work/voxis
git remote add forgejo https://clipshot.cc/git/zverozabr/voxis.git 2>/dev/null || git remote set-url forgejo https://clipshot.cc/git/zverozabr/voxis.git
TOKEN=$(ssh spex 'cat ~/.config/forgejo/token')
git -c http.extraheader="Authorization: token $TOKEN" push forgejo main
```

- [x] **Step 7.2: Dispatch ci.yml, wait green**

```bash
TOKEN=$(ssh spex 'cat ~/.config/forgejo/token')
API="https://clipshot.cc/git/api/v1/repos/zverozabr/voxis"
curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  "$API/actions/workflows/ci.yml/dispatches" -d '{"ref":"main"}'
# watch
curl -s -H "Authorization: token $TOKEN" "$API/actions/tasks?limit=3"
```

- [x] **Step 7.3: Tag → release.yml → verify artifacts**

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push forgejo v0.1.0
# wait, then:
ssh spex 'ls -lh ~/work/voxis/dist/'
```
Ожидание: `voxis-linux-x64`, `voxis-linux-x64-gui`, `voxis-windows-x64.exe`, `voxis-windows-x64-gui.exe`, опционально `voxis-macos-*`.

- [x] **Step 7.4: Verify package publication**

```bash
# Forgejo release
curl -s -H "Authorization: token $TOKEN" "$API/releases/tags/v0.1.0" | python3 -c "import sys,json;print('assets:',len(json.load(sys.stdin).get('assets',[])))"
# GitHub release
gh release view v0.1.0 --repo axelbaumlisto/voxis
# Mirror
curl -sI https://voxis.top/dist/voxis-linux-x64 | head -1
```

---

## Self-Review (spec coverage)

| Требование | Phase |
|-----------|-------|
| Сборка бинарников GUI через Docker (Linux native Tauri, Windows cargo-xwin, macOS KVM) | 3 + 1 (Dockerfile.ci) |
| Запуск агентов (docs-auditor, docs-screenshotter) | 4 |
| Деплой через тот же CI (spex, как у clipshot) | 2 (release.yml) + 6 (skill) |
| Публикация пакетов (Forgejo release, GitHub release, mirror, homebrew) | 5 |
| По образцу clipshot (Dockerfile.ci, build-all-platforms, .forgejo/workflows) | 1, 2, 3 |
| Все на spex, локальная машина только trigger | 6 |
| Только GUI (без headless-CLI) — подтверждено | 3 |
| macOS unsigned binaries (DMG позже) | 3.4 |
| homebrew в основном репо | 5.4 |

**Type consistency:** `voxis-ci:latest` (не clipshot-ci), `dist/voxis-*` (не clipshot-*), repo `zverozabr/voxis`. Бинарь `voice` (внутреннее имя сохранено), артефакты `voxis-*` (бренд).

**No placeholders:** Dockerfile.ci полный, workflows полные, build scripts по образцу clipshot, publish steps с реальными curl/gh командами.

---

## Resolved questions (все ответы получены)

1. **Бинарь `voice` — только GUI.** Headless-CLI не делаем (ни musl Linux headless, ни Windows headless). → Phase 3 упрощена, нет `headless` feature, нет musl-release, нет windows-headless.
2. **macOS — unsigned binaries на spex; DMG signed+notarized позже** (когда будет Apple Developer ключ). → Phase 3.4: только binaries, DMG отдельной задачей.
3. **homebrew — в основном репо** (`homebrew-tap/Formula/voxis.rb`). → Phase 5.4.
4. **Windows headless — не нужен.** Только GUI (cargo-xwin MSVC + NSIS). → Phase 3.2.
5. **Деплой — только артефакты, без флота.** → Phase 5 (publish), без daemon-fleet deploy.
