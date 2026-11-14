---
name: voxis-deploy
description: |
  Use when deploying Voxis, building releases, running CI, or publishing packages —
  the SERVER-WAY: trigger Forgejo CI/CD on spex; the server rebuilds GUI-only
  Linux + Windows artifacts in Docker and a Developer-ID-signed + notarized
  macOS DMG (plus bare arm64 binary for Homebrew) on the shared macOS 26 /
  Xcode 26 KVM VM (`~/macos-xcode26-vm` on spex), then publishes
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
  notarized, stapled — see "macOS build (shared Xcode 26 VM)")

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
   job-summary line; look for it. The macOS build log is
   `~/macos-xcode26-vm/out/voxis/<full-sha>/build.log` on spex):
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
  ls ~/macos-xcode26-vm/apps/voxis.conf ~/macos-xcode26-vm/voxis.qcow2   # shared VM app layer; no conf → macOS lane skips (VM README "Adding clipshot / voxis")
  ls ~/macos-xcode26-vm/creds.qcow2 && ls /dev/kvm && echo macos-vm-ok      # signing creds layer + KVM
  docker images voxis-ci --format "{{.Repository}}:{{.Tag}}" | grep -q voxis-ci && echo ci-image-ok || echo "CI IMAGE MISSING"
  docker ps --format "{{.Names}} {{.Status}}" | grep -iE "macos|osx" || echo "no macOS VM running (good)"
  cd ~/work/voxis && git status --short | head -3            # MUST be empty (see below)'
```

Two host states that silently break every release (both hit on 2026-09-07):

- **`voxis-ci:latest` missing** — a `docker system prune` (e.g. during a clipshot image
  rebuild) removes it; `ci.yml`/`release.yml` then fail at `docker run` in ~2 s with
  `Unable to find image 'voxis-ci:latest'`. Rebuild (see "CI image").
- **Dirty `~/work/voxis` checkout on spex** — the `build` job is a host executor working
  in that persistent copy. `release.yml` now handles it both ways: before the build it
  stashes any leftovers (named `ci-host leftovers …`), and its `restore repo to main`
  step discards exactly the files the build itself regenerates (`src-tauri/Cargo.toml`
  — tauri-cli drops `macos-private-api` on non-mac targets —, `homebrew-tap/Formula/voxis.rb`,
  `src-tauri/themes`, guest-js `themes/generated`) and stashes anything else. If you
  still find edits there, they are someone's: `git stash push -m …`, never `checkout -- .`.

Two failures that shipped a broken v0.1.16 (2026-11-13), both now guarded:

- **Linux lane published a STALE binary.** `bun install` died inside `docker build`, the
  backgrounded lane function ignored it, `docker create` reused an older
  `voxis-linux-gui:latest` (the tag is host-wide — a manual `--linux-only` build in
  another clone had just set it), and a 0.1.15 binary/.deb/.rpm went out under 0.1.16.
  `build_linux_gui` now fails on a failed build, clears old outputs, and checks the
  `.deb` carries this version. Verify after any release: asset names must all carry
  the new version.
- **No DMG: `notarytool` HTTP 403 "A required agreement is missing or has expired".**
  Apple pushed a new developer agreement. Only the Account Holder can accept it at
  developer.apple.com/account (banner) or appstoreconnect.apple.com/business. Check
  without a release: the lane itself now prints notarytool's error; or probe by hand in
  the fallback VM — `./scripts/macos-vm.sh start`, then in the VM
  `xcrun notarytool history --key <AuthKey_*.p8> --key-id <id> --issuer $APPLE_API_ISSUER`
  (`~/secrets/apple-dev/notary.env`); `./scripts/macos-vm.sh stop` before tagging.
  Acceptance took ~10 min to propagate.

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
  - macOS runs as ONE `continue-on-error` (advisory) call on the shared Xcode 26 VM:
    `~/macos-xcode26-vm/vm.sh build voxis "$SHA" -- 'bash scripts/ci/mac-shared-vm.sh'`
    produces the signed/notarized + stapled DMG and the bare arm64 binary + tarball
    together (see "macOS build (shared Xcode 26 VM)"). Preflight is
    `~/macos-xcode26-vm/apps/voxis.conf`; a busy host-wide macOS VM is waited on
    for up to 60 min via `VM_LOCK_WAIT=3600` (one `vm.sh` call, no retry loop),
    then the lane is skipped. If the DMG is missing at publish time the
    job prints `::warning::` + a job-summary line but still succeeds — check for it.
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

## macOS build (shared Xcode 26 VM)

The release macOS lane runs on spex's **shared macOS 26 (Tahoe) VM**,
`~/macos-xcode26-vm` (README there: layers, safety, commands). One call produces
everything: the signed `.app` → notarized + stapled → `Voxis_<ver>_aarch64.dmg`,
plus the bare `voxis-macos-arm64` binary and `.tar.gz` the Homebrew formula pins.

```bash
ssh spex
cd ~/macos-xcode26-vm
# the sha must ALREADY be in /home/spex/work/voxis (apps/voxis.conf REPO=):
# vm.sh pushes the commit into the guest and NEVER fetches.
git -C /home/spex/work/voxis fetch origin <tag>
sha=$(git -C /home/spex/work/voxis rev-parse '<tag>^{commit}')
./vm.sh build voxis "$sha" -- 'bash scripts/ci/mac-shared-vm.sh'
```

The build logic is **in the repo** (`scripts/ci/mac-shared-vm.sh`, run in the
guest at `~/src/voxis`); the host side is only
`~/macos-xcode26-vm/apps/voxis.conf` (repo copy:
`scripts/ci/macos-shared-vm/voxis.conf`). The guest has full Xcode 26 and a
`creds` layer holding the team Developer ID + ASC key + notary profile
`team-notary`, so `SIGNING_IDENTITY`/`APPLE_NOTARY_PROFILE` come from
`~/.secrets/apple.env` inside the guest — nothing secret is on the host argv or
in the repo.

- **Artifacts:** `~/macos-xcode26-vm/out/voxis/<full-sha>/artifacts-mac/`
  (`Voxis_<ver>_aarch64.dmg`, `voxis-macos-arm64`, `voxis-macos-arm64.tar.gz`).
  `release.yml` copies them into `artifacts/`, the dir publish reads.
- **Log:** `~/macos-xcode26-vm/out/voxis/<full-sha>/build.log` (vm.sh appends
  every run, including the guest command's output).
- **Failure semantics:** `vm.sh build`'s exit code is the guest command's, and
  every signing/notarization step in `mac-shared-vm.sh` is fatal — there is no
  ad-hoc fallback on this lane. `release.yml` keeps the step advisory
  (`continue-on-error`) and skips with a `::warning::` on failure.
- **One macOS VM per host:** `vm.sh` waits `VM_LOCK_WAIT` seconds (default 15)
  for `/home/spex/.macos-vm.lock` **and** for a running lock-less macOS
  container, then exits non-zero **before booting** if naked/clipshot (or the
  old voxis VM) still hold the host. `release.yml` passes `VM_LOCK_WAIT=3600`
  (one call, no retry loop) and skips the lane with a `::warning::` when the
  wait runs out or the build fails.
- **Measured** (layer prepared, snapshot `prepared`, warm caches): cold run
  **633 s** (cargo 494 s, notarization 79 s), warm run **460 s**.

Layer setup (one-time ops by hand; re-do after a base/creds update — see the
VM README `Base / creds updates`):

```bash
cp scripts/ci/macos-shared-vm/voxis.conf ~/macos-xcode26-vm/apps/voxis.conf
~/macos-xcode26-vm/vm.sh layer voxis --prepare    # then: vm.sh down voxis
~/macos-xcode26-vm/vm.sh snapshot voxis prepared # optional rollback point
```

macOS is arm64-only: `ort` ships no prebuilt ONNX Runtime for
`x86_64-apple-darwin`, so an Intel build fails at `ort-sys`. The guest is
x86_64 Tahoe cross-building aarch64 — same arrangement as naked.

### Fallback lane: the old Docker-OSX VM (`scripts/macos-vm.sh`)

`release.yml` does **not** use it any more. It stays working as a manual
fallback: `scripts/macos-vm.sh clone-image` creates voxis's **own** ~38 GB copy
of the Clipshot-prepared Sonoma image (`~/voxis-macos-vm`; voxis never mounts
Clipshot's disk — two QEMU processes on one qcow2 corrupted a Clipshot release),
then `build` yields the bare arm64 binary and `build-gui` the signed/notarized
DMG.

```bash
ssh spex 'cd ~/work/voxis && ./scripts/macos-vm.sh build-gui'
```

Its credentials come from the host file `~/secrets/apple-dev/notary.env`
(`SIGNING_IDENTITY`, `APPLE_API_ISSUER`; path override `APPLE_NOTARY_ENV`), the
Developer ID cert lives in that VM's `login.keychain`, and the ASC `.p8` at
`~/.appstoreconnect/private_keys/AuthKey_*.p8`. When either is missing it
degrades to an **ad-hoc unsigned** `.app`/DMG (Gatekeeper warns; `xattr -cr` on
install) — it never fails on missing signing. If Apple's queue is slow it ships
the SIGNED-but-unstapled DMG and records the submission in
`artifacts/.notary-pending`; finish with `scripts/macos-vm.sh notary-finish`
(afterwards re-upload the DMG by hand). Invalid/Rejected always hard-fails. Its
container runs with `--restart no`, so the VM never starts by itself — start it
explicitly.

Both lanes take the same host-wide `flock` (`/home/spex/.macos-vm.lock`,
override `MACOS_VM_LOCK`), so they can never run at the same time. See
`docs/MACOS_SIGNING_TODO.md` "VM image ownership + host lock" for the incident
writeup.

The Hardened Runtime build needs `src-tauri/Entitlements.plist`
(`com.apple.security.device.audio-input` + `.automation.apple-events`) or the
notarized app silently can't hear the mic or send the Accessibility-prompt
Apple Event.

### Signing gotcha (v0.1.3 post-mortem)

Notarization validates **every Mach-O in the archive**. The bundle has TWO executables
(`voice` and `typing_bench`, both `[[bin]]`s) — `scripts/ci/mac-shared-vm.sh` (shared
VM) and `build-gui` (fallback) sign everything under `Contents/MacOS/*` and
`Contents/Frameworks/*` in a loop, inside-out, with the same
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
