---
name: voxis-deploy
description: |
  Use when deploying Voxis, building releases, running CI, or publishing packages —
  the SERVER-WAY: trigger Forgejo CI/CD on spex; the server rebuilds GUI-only
  Linux + Windows artifacts in Docker and a Developer-ID-signed + notarized
  macOS DMG (plus bare arm64 binary for Homebrew) in a KVM VM, then publishes
  release artifacts to Forgejo, GitHub and the Homebrew tap. Triggers: voxis deploy, release, build, run ci,
  tag release, voxis.top, publish, homebrew.
---

# Voxis Deploy — Server-Way

**One rule: do not build release artifacts natively on the local machine. Push/dispatch; spex builds.**

CI/CD lives on **spex** behind Forgejo at `https://clipshot.cc/git/`. The private
Forgejo repo is `zverozabr/voxis`. The runner uses the `voxis-ci:latest` image,
Docker, and `/dev/kvm` to produce GUI-only artifacts:

Release binaries land in `artifacts/` (NOT `dist/`, which is vite's frontend
build outDir and gets emptied on every `bun run build`):

- `artifacts/voxis-linux-x64-gui` (+ `.deb` / `.rpm`)
- `artifacts/voxis-windows-x64-gui.exe`
- `artifacts/Voxis_<version>_x64-setup.exe` (NSIS)
- macOS (arm64-only, best-effort lane): `artifacts/voxis-macos-arm64` (+ `.tar.gz`,
  Homebrew) and `artifacts/Voxis_<version>_aarch64.dmg` (Developer ID signed,
  notarized, stapled — see "Signed/notarized DMG lane")

GitHub carries **both**: release binaries (the canonical public download) and,
by the owner's decision on 2026-11-12, the `main` branch kept in sync with
Forgejo (`git push origin main` after every push to Forgejo). The repo is
public and MIT, so syncing source adds no exposure — and a half-synced history
is worse than either extreme: on that date GitHub's `main` had been frozen
since 2026-10-20 by one accidental source push, 29 commits behind, which only
surfaced when someone asked where the branch came from.

Rules that still hold: releases are published from Forgejo CI (never built
locally), tags live in Forgejo (`plugin-v*` tags are Forgejo-only), and GitHub
release assets are never deleted (see "Never delete release assets").

---

## Release checklist

0. **Sync with Forgejo first** — CI regen and other sessions commit to `forgejo/main`;
   a local clone can silently fall behind (2026-09-07: a signed-DMG lane had been on
   Forgejo for 3 weeks while a local clone re-implemented it).
   ```bash
   TOKEN=$(ssh spex 'cat ~/.config/forgejo/token')
   git remote add forgejo https://clipshot.cc/git/zverozabr/voxis.git 2>/dev/null || true
   git -c http.extraheader="Authorization: token $TOKEN" fetch forgejo main
   git log --oneline HEAD..forgejo/main     # must be empty, else rebase onto forgejo/main
   ```
1. Bump version in **four** places: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`,
   `package.json`, and the `voice` entry in the **root** `Cargo.lock` (edit the one line;
   no `cargo update`) — `[ADO-1a lessons (2)]`: since Task 1a moved the Cargo workspace
   root out of `src-tauri/` into the repo root, `Cargo.lock` lives at **`/Cargo.lock`**,
   not `src-tauri/Cargo.lock` (that file no longer exists). Verify with
   `cargo metadata --no-deps -q >/dev/null` after editing (fails loudly on a malformed
   lockfile edit) and `grep -rn "<old-version>" src-tauri/Cargo.toml package.json
   src-tauri/tauri.conf.json` (must be empty). Add a `CHANGELOG.md` section. Check the
   tag is free: `git ls-remote --tags forgejo | grep vX.Y.Z` — a published tag can NOT be
   re-published (guard in release.yml); if a release shipped incomplete, bump again
   instead.

   **`tauri-plugin-voxis`/guest-js versions are separate** (`crates/tauri-plugin-voxis/
   Cargo.toml`'s own `version`, `crates/tauri-plugin-voxis/guest-js/package.json`'s own
   `version`) — bumping the `voice` app version above does **not** bump either of
   these, and vice versa; they follow their own schedule.

   **A `plugin-v*` tag does NOT trigger `release.yml`** — `release.yml`'s `on.push.tags`
   filter is `v*`, so `plugin-v0.1.0` (or any other `plugin-*`-prefixed tag used to pin
   a host's git dependency on this plugin) never starts the DMG/artifact-publish
   pipeline above. This is intentional (the plugin crate is not part of the Voxis
   desktop app release), not a bug to "fix" by broadening the trigger filter — a host
   pinning `tauri-plugin-voxis = { git = "...", tag = "plugin-v0.1.0" }` just needs the
   tag to exist and point at the right commit; pushing it is a plain `git tag` + `git
   push forgejo plugin-v0.1.0`, no workflow dispatch involved.

   **Tag a `plugin-v*` ONLY through `scripts/tag-plugin.sh <X.Y.Z> "<msg>"`** (B2): it runs
   desktop test+clippy, guest-js build+test, `scripts/check-ios-build.sh` (macOS) and the
   Android `cargo check --target aarch64-linux-android` (NDK clang for `ring`), then tags.
   `src/mobile.rs` is `cfg(ios|android)` — the desktop test/clippy run never compiles it, and
   a syntax slip there only surfaces when a host builds for a phone (2026-09-17:
   `plugin-v0.3.0` shipped with a stray `}` in `mobile.rs`; tags are immutable, so it cost a
   `plugin-v0.3.1`). `ci.yml` runs the Android check on every push too (runner host NDK).

2. Commit. Run locally before tagging (fast, catches 95%):
   `cd src-tauri && cargo test --lib && cargo clippy --all-targets -- -D warnings`
   and `bun run test:run` (2 pre-existing golden-hash failures in
   `theme-engine/renderers/__tests__/cell-render-golden.test.ts` are known).
   Optional: Playwright E2E (`bun run test:e2e`, ~108 pass / 27 skip).
3. Push source to Forgejo (private, drives CI):
   ```bash
   git -c http.extraheader="Authorization: token $TOKEN" push forgejo main
   ```
4. Dispatch `ci.yml` (`fast` job, ~3 min warm) and wait for `success`:
   ```bash
   API="https://clipshot.cc/git/api/v1/repos/zverozabr/voxis"
   curl -sS -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
     "$API/actions/workflows/ci.yml/dispatches" -d '{"ref":"main"}'
   curl -sS -H "Authorization: token $TOKEN" "$API/actions/tasks?limit=5"   # name/status/head_sha
   ```
   A job that fails within ~2 s of creation is an infra failure, not code — read the
   log (see "Reading job logs") before touching anything.
5. Tag and push; this triggers `release.yml` (`test -> build -> publish`, 40–60 min warm,
   up to ~2 h cold):
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z — <one line>"
   git -c http.extraheader="Authorization: token $TOKEN" push forgejo vX.Y.Z
   ```
   `workflow_dispatch` on a tag ref returns HTTP 400 — to re-run a release, delete and
   re-push the tag (`git push forgejo :refs/tags/vX.Y.Z && git push forgejo vX.Y.Z`),
   but ONLY if nothing was published yet (`$API/releases/tags/vX.Y.Z` → 404).
6. Verify publication AND the macOS artifact **on a real Mac** (CI's `publish` succeeds
   even when the macOS lane degraded — it prints `::warning::no signed macOS DMG` and a
   job-summary line; look for it):
   ```bash
   gh release view vX.Y.Z --repo axelbaumlisto/voxis --json assets --jq '.assets[].name'
   gh release download vX.Y.Z --repo axelbaumlisto/voxis --pattern "Voxis_*_aarch64.dmg" -D /tmp/rel
   spctl -a -vvv -t open --context context:primary-signature /tmp/rel/Voxis_*.dmg   # accepted, Notarized Developer ID
   hdiutil attach /tmp/rel/Voxis_*.dmg -nobrowse -quiet -mountpoint /tmp/rel/mnt
   spctl -a -vvv -t exec /tmp/rel/mnt/Voxis.app && xcrun stapler validate /tmp/rel/mnt/Voxis.app
   for b in /tmp/rel/mnt/Voxis.app/Contents/MacOS/*; do   # EVERY binary: runtime flag + audio-input
     codesign -dv "$b" 2>&1 | grep -o 'flags=0x10000(runtime)'; codesign -d --entitlements :- "$b" 2>/dev/null | grep -o audio-input; done
   ```
7. Install on the dev Mac (permissions carry over when the Developer ID signer/TeamID is
   unchanged; a signer CHANGE — e.g. Apple Development → Developer ID — resets TCC and
   needs `tccutil reset {Accessibility,ListenEvent,Microphone} top.voxis.app` + re-grant):
   ```bash
   pkill -f /Applications/Voxis.app/Contents/MacOS/voice; mv /Applications/Voxis.app /tmp/Voxis-old.app
   ditto /tmp/rel/mnt/Voxis.app /Applications/Voxis.app && hdiutil detach /tmp/rel/mnt -quiet
   open -a /Applications/Voxis.app
   ```
   Expect one `previous instance died without shutdown` WARN in the log if the old
   process was `pkill`ed (SIGTERM writes no clean-shutdown marker) — not a crash.

---

## Server preflight

```bash
ssh spex 'systemctl --user is-active forgejo-runner && docker ps --format "{{.Names}}" | grep -q forgejo && echo forgejo-ok
  ls -lh ~/voxis-macos-vm/mac_hdd_ng.prepared.img          # voxis OWN image (~38G); missing → macos-vm.sh clone-image
  ls ~/secrets/apple-dev/notary.env && ls /dev/kvm && echo creds-kvm-ok
  docker images voxis-ci --format "{{.Repository}}:{{.Tag}}" | grep -q voxis-ci && echo ci-image-ok || echo "CI IMAGE MISSING"
  docker ps --format "{{.Names}} {{.Status}}" | grep -iE "macos|osx" || echo "no macOS VM running (good)"
  cd ~/work/voxis && git status --short | head -3            # MUST be empty (see below)'
```

Two host states that silently break every release (both hit on 2026-09-07):

- **`voxis-ci:latest` missing** — a `docker system prune` (e.g. during a clipshot image
  rebuild) removes it; `ci.yml`/`release.yml` then fail at `docker run` in ~2 s with
  `Unable to find image 'voxis-ci:latest'`. Rebuild (see "CI image").
- **Dirty `~/work/voxis` checkout on spex** — the `build` job is a host executor that
  `git checkout <tag>`s in that persistent working copy; any local modification
  (staged or not) aborts with `Your local changes … would be overwritten`. Fix:
  `ssh spex 'cd ~/work/voxis && git stash push -m "ci-host leftovers $(date +%F)"'`
  (never `checkout -- .`; someone may have WIP there).

---

## CI image

`voxis-ci:latest` is built from `Dockerfile.ci` (Rust 1.95 on Debian trixie,
GTK/WebKit/AppIndicator, Bun, Docker CLI). Rebuild on spex after changing CI dependencies:

```bash
# from a throwaway clean clone so the persistent checkout is never touched:
ssh spex "rm -rf /tmp/voxis-ci-build && git -c http.extraheader='Authorization: token $(ssh spex cat ~/.config/forgejo/token)' \
  clone -q --depth 1 https://clipshot.cc/git/zverozabr/voxis.git /tmp/voxis-ci-build && \
  cd /tmp/voxis-ci-build && nohup bash scripts/ci/build-ci-image.sh > /tmp/voxis-ci-build.log 2>&1 &"
# ~10–20 min (pulls the Rust base image from a slow registry); done when the log ends with "voxis-ci:latest ready"
```

---

## Workflows

- `.forgejo/workflows/ci.yml`: manual checkout; runs frontend build, clippy,
  Rust lib tests, and Vitest inside `voxis-ci:latest`.
- `.forgejo/workflows/release.yml`: tag or manual dispatch; jobs are
  `test -> build -> publish`. Docs regeneration (`docs-audit`/`docs-screenshotter`)
  is intentionally DECOUPLED from release — it lives in the separate
  `.forgejo/workflows/docs.yml` (scheduled weekly + manual dispatch), not a
  job in `release.yml`. `publish` gates on `build` only and never waits on
  docs.
  - Linux GUI and Windows GUI/NSIS are built by `scripts/build-all-platforms.sh --no-macos`.
  - macOS runs TWO lanes in the KVM VM (both `continue-on-error`, advisory):
    `scripts/macos-vm.sh build` (bare arm64 binary + tarball for Homebrew) then
    `build-gui` (signed/notarized DMG). The target dir is preserved between lanes.
    If the DMG is missing at publish time the job prints `::warning::` + a job-summary
    line but still succeeds — check for it.
  - Publish uploads to the Forgejo release and the GitHub release
    (`axelbaumlisto/voxis`), and pushes the regenerated formula to the tap repo
    `axelbaumlisto/homebrew-voxis` (via `HOMEBREW_TAP_REPO`) when the macOS arm64
    tarball exists AND its published bytes match the pinned sha256 (integrity
    gate). There is NO `voxis.top/dist` mirror step:
    voxis.top is served by Vercel (the landing), not spex, so files copied
    under spex would be unreachable at voxis.top.

Host-executor gotchas:

- Always set `GIT_PAGER=cat PAGER=cat` and use `git --no-pager`.
- Use manual checkout because Forgejo is served under `/git`.
- Keep CI caches under `~/.cache/voxis-ci` and set container `HOME` to a temp cache.

---

## macOS KVM

The Voxis macOS script clones its **own** copy of the Clipshot-prepared VM image
(`scripts/macos-vm.sh clone-image`, one-time, ~38 GB) rather than mounting
Clipshot's disk directly — two QEMU processes on one qcow2 corrupted a
Clipshot release. `build`/`build-gui` refuse to run until the clone exists.

```bash
ssh spex 'cd ~/work/voxis && ./scripts/macos-vm.sh build'
```

It syncs the Voxis source into the VM, builds `voice` for
`aarch64-apple-darwin`, and pulls the unsigned binary into `artifacts/`.
macOS is arm64-only: `ort` rc.12 ships no prebuilt ONNX Runtime for
`x86_64-apple-darwin`, so an Intel build fails at `ort-sys`. Apple Silicon
covers all current Macs.

### Signed/notarized DMG lane (`build-gui`)

The release workflow uses `scripts/macos-vm.sh build-gui` (NOT the bare
`build`). It builds the Tauri `Voxis.app`, Developer ID-signs it, submits it to
Apple's notary service, staples the ticket, and packs `Voxis_<ver>_aarch64.dmg`
(also emitting the bare `voxis-macos-arm64` + tarball so the Homebrew formula
keeps working). Credentials are read the clipshot way, kept OUTSIDE the repo:

- Host env file `~/secrets/apple-dev/notary.env` (path override via
  `APPLE_NOTARY_ENV`) supplies `SIGNING_IDENTITY` + `APPLE_API_ISSUER`. On the
  CI host (spex) it lives at `/home/spex/secrets/apple-dev/notary.env`.
- The Developer ID cert + private key live in the macOS VM login keychain; the
  App Store Connect API key `.p8` lives in the VM at
  `~/.appstoreconnect/private_keys/AuthKey_*.p8`. Nothing secret is ever in the
  repo or on the host argv.

When either the env file or the VM credentials are absent, `build-gui` degrades
to an **ad-hoc unsigned** `.app`/DMG (Gatekeeper warns; `xattr -cr` needed on
install) — the build never fails on missing signing.

Two-branch notarization (ported from clipshot): if Apple's queue is slow the
SIGNED-but-unstapled DMG ships now and the submission id is recorded in
`artifacts/.notary-pending`; finish later with
`scripts/macos-vm.sh notary-finish` (waits for Accepted, staples, re-emits the
DMG). Invalid/Rejected always hard-fails — that is a real signing problem, not
a queue delay.

The Hardened Runtime build needs `src-tauri/Entitlements.plist`
(`com.apple.security.device.audio-input` + `.automation.apple-events`) or the
notarized app silently can't hear the mic or send the Accessibility-prompt
Apple Event. Only ONE macOS Docker-OSX container (voxis's or clipshot's) may
run at a time on this host — a host-wide `flock` (`/home/spex/.macos-vm.lock`,
override `MACOS_VM_LOCK`) enforces it; `--restart no` means the VM does NOT
auto-start after a host reboot (start it manually before dispatching a
release). See `docs/MACOS_SIGNING_TODO.md` "VM image ownership + host lock"
for the full incident writeup.

### Signing gotcha (v0.1.3 post-mortem)

Notarization validates **every Mach-O in the archive**. The bundle has TWO executables
(`voice` and `typing_bench`, both `[[bin]]`s) — `build-gui` signs everything under
`Contents/MacOS/*` and `Contents/Frameworks/*` in a loop, inside-out, with the same
`--options runtime --timestamp --entitlements` flags, then the bundle. Never sign a
single named binary. v0.1.3 shipped without a DMG because only `voice` was re-signed
(`Invalid: The binary is not signed with a valid Developer ID certificate` on
`typing_bench`).

---

## Reading job logs

The Forgejo API exposes tasks but not job logs; the web log URL under `/git` 404s.
Read them from the container instead (logs are zstd-compressed JSONL):

```bash
ssh spex 'f=$(docker exec forgejo sh -c "find /data/gitea/actions_log/zverozabr/voxis -name <TASK_ID>.log.zst"); \
  docker cp forgejo:$f /tmp/t.log.zst && python3 -c "
import zstandard,json
d=zstandard.ZstdDecompressor().stream_reader(open(\"/tmp/t.log.zst\",\"rb\")).read().decode(\"utf-8\",\"replace\")
for l in d.splitlines():
    try: print(json.loads(l).get(\"content\",\"\")[:200])
    except Exception: print(l[:200])" | grep -vE "^\s*(remote:|Receiving|Resolving)" | tail -60'
```

`<TASK_ID>` is the `id` from `$API/actions/tasks`. Useful greps: `notarization`,
`ERROR`, `::warning::`, `Unable to find image`, `would be overwritten`.

---

## Never delete release assets

`gh release delete`, deleting a release asset, or any `DELETE` against
`api.github.com/.../releases/assets/...` is **owner-only** and needs an
explicit instruction. `release.yml` has exactly two `DELETE` calls and both
target Forgejo (the prune step); GitHub receives uploads only.

Why the rule exists: on 2026-11-11 three GitHub releases (v0.1.9 with 0 assets,
v0.1.10 and v0.1.13 with only their three macOS files) had lost their Linux and
Windows assets. Nothing in this pipeline can do that, so it was an outside
action; the effect was invisible until someone compared the two forges.
`publish` now fails when this release ends with fewer assets than it uploaded,
warns when any of the previous three releases is empty, and archives every
artifact set under `~/voxis-release-archive/<tag>/` on the host so a stripped
asset can be restored by copying instead of rebuilding.

GitHub keeps the FULL history on purpose: the landing site links
`releases/latest/download/<name>`, but the Homebrew formula pins a specific
asset URL for a specific tag, so old assets must stay downloadable. Forgejo is
the one that rotates (newest release only) — see `prune-release-assets.sh`.

## Publishing targets

- Forgejo release: `https://clipshot.cc/git/zverozabr/voxis/releases/tag/vX.Y.Z` —
  retains binaries **only on the newest release** (`scripts/prune-release-assets.sh`,
  runs as the last step of `publish` in `release.yml`, `--apply`); older tags keep
  their release entry + notes but lose attachments. Dry-run manually:
  `FORGEJO_API=https://clipshot.cc/git/api/v1/repos/zverozabr/voxis FORGEJO_TOKEN=$(ssh spex 'cat ~/.config/forgejo/token') bash scripts/prune-release-assets.sh`
- GitHub release (binaries only, canonical public download): `axelbaumlisto/voxis` —
  keeps **full history** (Homebrew's formula URL pins a specific past release, so
  old GitHub assets must stay downloadable; this script never touches GitHub)
- Homebrew tap: `axelbaumlisto/homebrew-voxis` (repo name `homebrew-voxis` so
  `brew tap axelbaumlisto/voxis` resolves). Canonical formula source is in-tree
  `homebrew-tap/Formula/voxis.rb`; CI replaces the tap copy on release. User install:
  ```sh
  brew install axelbaumlisto/voxis/voxis   # macOS arm64
  ```

Deployment is artifacts only. There is no Voxis daemon fleet deployment in this workflow.
