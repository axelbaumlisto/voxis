# R5 — build/CI/iOS-project review (naked branch `voxis-plugin`)

VERDICT: SHIP

Scope: infra only — Cargo git-dep tables + Cargo.lock, package.json/bun.lock/vendor tgz,
scripts/ci-check.sh forge redirect, ci.yml, generated Xcode project (project.yml + pbxproj +
Info.plist), tauri.conf.json, deployment-target consistency, secret leakage. All claims
verified with shell (shasum/openssl, git grep, git ls-files); no source edits made.

## Blockers
None.

## Should-fix (non-blocking)
- **Commit-rev pin, not a tag** (`src-tauri/Cargo.toml:111,115,133,143`, `vendor/README.md`).
  Both the Rust git dep and the vendored tgz are pinned to raw commit
  `0a7ac08cdd9f7e2a94c59126c6969083f7fa9f58`. A commit can be GC'd/rewritten on the private
  forge; a signed `plugin-v0.1.0` tag would be immutable. Already documented as the T12
  follow-up in Cargo.toml and vendor/README.md — acceptable to defer, but flagged.
- **CSP `connect-src` has no speech-provider host** (`src-tauri/tauri.conf.json:23`,
  `connect-src ipc: http://ipc.localhost`). This is *correct* as-is because transcription
  HTTP happens in the Rust `reqwest` client behind IPC, not in the WebView — no fix needed
  today. Noting it only so a future reviewer does not "fix" it by widening CSP: the audio
  upload must stay Rust-side, never a WebView `fetch`.
- **PrivacyInfo.xcprivacy** (`src-tauri/gen/apple/PrivacyInfo.xcprivacy`) exists and is
  unchanged by this diff. Microphone is not a Required-Reason API, so the manifest needs no
  new entry for the mic capability; the `NSMicrophoneUsageDescription` string is the correct
  and sufficient disclosure. No action, verified consistent.

## Verified OK
- **No `17.0` / iOS 17 floor anywhere in the Xcode/tauri config.**
  `git grep -n 17.0 -- src-tauri/gen/apple src-tauri/tauri.conf.json` → none. The only `17`
  match in `gen/apple` is a comment (`project.yml:13`) documenting that the plugin's 17+-only
  surface is `#available(iOS 17, *)`-gated and absent on 16. `grep DEPLOYMENT_TARGET = 17`
  across `gen/apple` → no 17 deployment target.
- **All generated deployment targets are 16.1.** `IPHONEOS_DEPLOYMENT_TARGET` in
  `naked.xcodeproj/project.pbxproj` = `16.1` on all 8 build configs (4 targets × debug/release):
  `grep -o "IPHONEOS_DEPLOYMENT_TARGET = [^;]*" | sort | uniq -c` → `8  ... = 16.1`. The
  FFI build-phase script also defaults `IPHONEOS_DEPLOYMENT_TARGET:-16.1`. `project.yml` sets
  `deploymentTarget.iOS: 16.1` globally and adds an explicit `deploymentTarget: "16.1"` to
  `NakedFileProvider`. Consistent with `tauri.conf.json` `bundle.iOS.minimumSystemVersion:16.1`
  (macOS is `12.0`, unrelated).
- **Mic key present and consistent.** `NSMicrophoneUsageDescription` in
  `project.yml:80` == generated `naked_iOS/Info.plist:42` == committed build product
  (`build/arm64-sim/naked.app/Info.plist` binary match), string identical: "naked dictates
  through Voxis; audio is sent to your configured speech provider (Groq or self-hosted)."
  `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` both present in
  `naked_iOS/Info.plist` (lines 50, 36), matching the project.yml additions.
- **Vendor tgz sha512 == bun.lock integrity (computed).**
  `openssl dgst -sha512 -binary vendor/voxis-tauri-plugin-voxis-0.2.0.tgz | openssl base64 -A`
  → `M3pWr+POYH3X2k5aAEVjTtypMjbCcpLHhTrX7L1S0LXDwsBZbPSK3THZM6AiCl6FgtKy/Bb8OcX0cPZ0Yfz34Q==`
  — byte-for-byte equal to `bun.lock:281` `sha512-M3pWr+PO…34Q==`. sha256 of the tgz
  (`61e8138c…f457`) also matches `vendor/README.md`. The tgz is git-tracked and NOT
  gitignored (`git ls-files` shows it; `git check-ignore` → not ignored), so a fresh clone
  ships the file and `bun install` will resolve `file:vendor/…tgz` with a matching integrity
  hash → fresh-clone JS install succeeds.
- **Cargo.lock URL canonical & rev-consistent.** Both `tauri-plugin-voxis` (Cargo.lock:8072)
  and `voxis-core` (9052) resolve to
  `git+https://clipshot.cc/git/zverozabr/voxis.git?rev=0a7ac08…#0a7ac08…` — the canonical
  HTTPS URL, identical rev in every Cargo.toml table (desktop `features=["desktop"]`,
  ios/android featureless). The CI transport redirect does NOT rewrite the lock URL.
- **CI forge redirect is correct and safe** (`scripts/ci-check.sh:406–430`,
  `use_forge_voxis_checkout`, called from `use_local_toolchains:389` which every Rust lane
  invokes — lines 321/442/952).
  - GIT_CONFIG chaining is right: `n=${GIT_CONFIG_COUNT:-0}` → sets
    `GIT_CONFIG_KEY_${n}`/`GIT_CONFIG_VALUE_${n}` then `GIT_CONFIG_COUNT=$((n+1))`. If the env
    already carries entries it appends without clobbering them. Nothing is written to
    `~/.gitconfig` — purely process-scoped env (does not touch `~/.cargo` either).
  - `insteadOf` direction is correct: `url.<local-bare-repo>.insteadOf =
    https://clipshot.cc/git/zverozabr/voxis.git` rewrites the canonical HTTPS URL (exact
    match to Cargo.toml/lock) → the on-disk bare repo. `CARGO_NET_GIT_FETCH_WITH_CLI=true`
    makes cargo shell out to system `git`, which honours `GIT_CONFIG_*`.
  - Runner-host only: `[[ -d "$repo" ]] || return 0` — on a laptop lacking the bare repo the
    function no-ops, so laptop/dev builds are unchanged (they use `~/.git-credentials` over
    HTTPS per the Cargo.toml comment). `NAKED_FORGE_VOXIS_REPO` override present.
  - Forge path `/home/spex/work/git/data/git/repositories/zverozabr/voxis.git` shares the same
    parent dir as ci.yml's `NAKED_FORGE_REPO_DEFAULT` naked-cli.git — same "read the bare repo
    on disk, no HTTP, no token" pattern the workflow already uses for its own checkout.
- **Desktop macOS build unaffected by feature tables.** macOS falls under
  `cfg(not(any(ios, android)))` → gets `tauri-plugin-voxis` with `features=["desktop"]`
  (cpal/rdev) + `voxis-core`; iOS/android table takes the featureless plugin. The desktop
  table is additive and self-consistent with the lock; nothing in the CI change alters the
  desktop dependency graph.
- **No secret/token leaked.** Grep for `ghp_/github_pat/bearer/PRIVATE KEY/token=` across the
  diffed files (ci-check.sh, Cargo.toml, package.json, vendor/README.md, project.yml, ci.yml)
  found only two false positives — comments noting a *sudo* password is needed for macOS
  `install-deps` (`ci-check.sh:734`, `ci.yml:98`), no credential material. No PAT is embedded;
  the design deliberately avoids one.

## Not covered
- Runtime behaviour of the plugin (commands, capture backends, overlay pill, paste path) —
  out of the infra role; deferred to the source/UX reviewers.
- Whether the on-disk forge bare repo actually contains rev `0a7ac08…` (cannot inspect the
  runner host / private forge from here; memory bars scanning outside the tree).
- Actual `bun tauri ios build` / macOS `cargo build` execution — not run (build would fetch
  the private git dep; also outside a 25-call read-only budget).
- The Swift `#available(iOS 17,*)` gating in the plugin's own `ios/Package.swift` — lives in
  the voxis repo, not in this tree.
