---
name: voxis-deploy
description: |
  Use when deploying Voxis, building releases, running CI, or publishing packages —
  the SERVER-WAY: trigger Forgejo CI/CD on spex; the server rebuilds GUI-only
  Linux + Windows artifacts in Docker and macOS unsigned binaries in a KVM VM,
  then publishes release artifacts. Triggers: voxis deploy, release, build, run ci,
  tag release, voxis.top, publish, homebrew.
---

# Voxis Deploy — Server-Way

**One rule: do not build release artifacts natively on the local machine. Push/dispatch; spex builds.**

CI/CD lives on **spex** behind Forgejo at `https://clipshot.cc/git/`. The private
Forgejo repo is `zverozabr/voxis`. The runner uses the `voxis-ci:latest` image,
Docker, and `/dev/kvm` to produce GUI-only artifacts:

- `dist/voxis-linux-x64-gui`
- `dist/voxis-windows-x64-gui.exe`
- `dist/Voxis_<version>_x64-setup.exe`
- best-effort unsigned macOS: `dist/voxis-macos-arm64`, `dist/voxis-macos-x64`, `dist/voxis-macos-universal`

GitHub is **binary releases only**. Do not push private Voxis source to GitHub.

---

## Release checklist

1. Bump version in both `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Commit the change.
3. Push source to Forgejo (private, drives CI):
   ```bash
   TOKEN=$(ssh spex 'cat ~/.config/forgejo/token')
   git remote add forgejo https://clipshot.cc/git/zverozabr/voxis.git 2>/dev/null || \
     git remote set-url forgejo https://clipshot.cc/git/zverozabr/voxis.git
   git -c http.extraheader="Authorization: token $TOKEN" push forgejo main
   ```
4. Dispatch required CI and wait for green:
   ```bash
   TOKEN=$(ssh spex 'cat ~/.config/forgejo/token')
   API="https://clipshot.cc/git/api/v1/repos/zverozabr/voxis"
   curl -sS -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
     "$API/actions/workflows/ci.yml/dispatches" -d '{"ref":"main"}'
   curl -sS -H "Authorization: token $TOKEN" "$API/actions/tasks?limit=5"
   ```
5. Tag and push to Forgejo; this triggers `.forgejo/workflows/release.yml`:
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git -c http.extraheader="Authorization: token $TOKEN" push forgejo vX.Y.Z
   ```
6. Verify package publication:
   ```bash
   curl -sS -H "Authorization: token $TOKEN" "$API/releases/tags/vX.Y.Z"
   curl -sI https://voxis.top/dist/voxis-linux-x64-gui | head -1
   gh release view vX.Y.Z --repo axelbaumlisto/voxis
   ```

---

## Server preflight

```bash
ssh spex 'echo spex-ok && systemctl --user is-active forgejo-runner && docker ps --format "{{.Names}}" | grep forgejo && ls -lh ~/clipshot-macos-vm/mac_hdd_ng.prepared.img'
ssh spex 'ls ~/.config/forgejo/token && echo token-ok'
```

Expected: runner `active`, Forgejo container present, prepared 31G macOS image, token present.

---

## CI image

`voxis-ci:latest` is built from `Dockerfile.ci` (Rust 1.95 on Debian trixie,
GTK/WebKit/AppIndicator, Bun, Docker CLI). Rebuild on spex after changing CI dependencies:

```bash
ssh spex 'cd ~/work/voxis && bash scripts/ci/build-ci-image.sh'
```

---

## Workflows

- `.forgejo/workflows/ci.yml`: manual checkout; runs frontend build, clippy,
  Rust lib tests, and Vitest inside `voxis-ci:latest`.
- `.forgejo/workflows/release.yml`: tag or manual dispatch; jobs are
  `test -> build -> publish`, plus advisory `docs-audit`.
  - Linux GUI and Windows GUI/NSIS are built by `scripts/build-all-platforms.sh --no-macos`.
  - macOS unsigned binaries are best-effort via `scripts/macos-vm.sh build` and the
    prepared image at `~/clipshot-macos-vm/mac_hdd_ng.prepared.img`.
  - Publish uploads to Forgejo release, mirrors binaries to GitHub release,
    copies artifacts to `voxis.top/dist`, and updates `homebrew-tap/Formula/voxis.rb` when macOS tarball exists.

Host-executor gotchas:

- Always set `GIT_PAGER=cat PAGER=cat` and use `git --no-pager`.
- Use manual checkout because Forgejo is served under `/git`.
- Keep CI caches under `~/.cache/voxis-ci` and set container `HOME` to a temp cache.

---

## macOS KVM

The Voxis macOS script intentionally reuses the prepared Clipshot VM image path:

```bash
ssh spex 'cd ~/work/voxis && ./scripts/macos-vm.sh build'
```

It syncs the Voxis source into the VM, builds `voice` for
`aarch64-apple-darwin` and `x86_64-apple-darwin`, creates a universal binary
with `lipo`, and pulls unsigned binaries into `dist/`.

Signed/notarized DMG is out of scope until Apple Developer credentials are available.

---

## Publishing targets

- Forgejo release: `https://clipshot.cc/git/zverozabr/voxis/releases/tag/vX.Y.Z`
- GitHub release (binaries only): `axelbaumlisto/voxis`
- Static mirror: `https://voxis.top/dist/`
- Homebrew formula in this repo: `homebrew-tap/Formula/voxis.rb`

Deployment is artifacts only. There is no Voxis daemon fleet deployment in this workflow.
