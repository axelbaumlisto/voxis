# Build Infrastructure — Disaster Recovery Runbook

Status: operational runbook (documentation only — no automation implied).
Scope: what the Voxis release pipeline depends on, how to recover if the
build server is lost or compromised, and an honest assessment of the gaps
that are **not** yet covered.

Every path, host, image, and command below is cross-checked against
`.pi/skills/voxis-deploy/SKILL.md` and `.forgejo/workflows/*.yml` as they
exist in this repo. Nothing here is invented; where something does not
exist yet, this doc says so explicitly.

## Table of contents

- [1. Infrastructure the release pipeline depends on](#1-infrastructure-the-release-pipeline-depends-on)
- [2. Secrets and credentials inventory](#2-secrets-and-credentials-inventory)
- [3. Integrity of already-released binaries](#3-integrity-of-already-released-binaries)
- [4. Recovery: spex unavailable or compromised](#4-recovery-spex-unavailable-or-compromised)
  - [4.1 Re-provision the CI Docker images on a new host](#41-re-provision-the-ci-docker-images-on-a-new-host)
  - [4.2 Re-create secrets and credentials](#42-re-create-secrets-and-credentials)
  - [4.3 Re-establish the Forgejo repo and runner](#43-re-establish-the-forgejo-repo-and-runner)
  - [4.4 macOS build capability](#44-macos-build-capability)
  - [4.5 Cut a release from the recovered host](#45-cut-a-release-from-the-recovered-host)
- [5. What is NOT yet in place (honest gap assessment)](#5-what-is-not-yet-in-place-honest-gap-assessment)
- [6. Recommended follow-ups](#6-recommended-follow-ups)

---

## 1. Infrastructure the release pipeline depends on

The entire release pipeline runs on a **single self-hosted host, "spex"**.
There is no redundancy. The dependencies are:

| Component | Where it lives | Source of truth in repo |
| --- | --- | --- |
| **Forgejo server** | `https://clipshot.cc/git/`, private repo `zverozabr/voxis` | `.pi/skills/voxis-deploy/SKILL.md` |
| **Forgejo runner** | `systemd --user` service `forgejo-runner` on spex, `runs-on: host` | `SKILL.md` "Server preflight"; every workflow uses `runs-on: host` |
| **`voxis-ci:latest` Docker image** | built on spex from `Dockerfile.ci` | `Dockerfile.ci`, `scripts/ci/build-ci-image.sh` |
| **`voxis-docs:latest` Docker image** | built on spex from `Dockerfile.docs` | `Dockerfile.docs`, `scripts/ci/build-docs-image.sh` |
| **`voxis-linux-gui:latest` / `voxis-winguienv:latest`** | built on demand during a release build from `Dockerfile.gui-linux` / `Dockerfile.windows-gui` | `scripts/build-all-platforms.sh` |
| **macOS KVM VM image** | `~/clipshot-macos-vm/mac_hdd_ng.prepared.img` (~31G prepared) on spex, requires `/dev/kvm` | `SKILL.md` "macOS KVM"; `scripts/macos-vm.sh`; `release.yml` "build macOS" step |
| **CI caches** | `~/.cache/voxis-ci` on spex (`cargo`, `target`, `home`) | `ci.yml`, `release.yml` container mounts |
| **Persistent release worktree** | `/home/spex/work/voxis` on spex | `release.yml` "checkout release tag in persistent worktree" |
| **Forgejo repo secrets/credential store** | host files on spex (see §2 — **not** Forgejo Actions `secrets.*`) | `SKILL.md`; workflow env usage |

Publishing targets (outputs, not build inputs):

- **Forgejo release**: `https://clipshot.cc/git/zverozabr/voxis/releases/tag/vX.Y.Z`
- **GitHub release** (canonical public download channel, binaries only):
  `axelbaumlisto/voxis`
- **Homebrew tap**: `axelbaumlisto/homebrew-voxis` (in-tree formula source is
  `homebrew-tap/Formula/voxis.rb`; CI replaces the tap copy on release)

Note: `voxis.top` is served by **Vercel** (the landing site), **not** spex.
There is no `voxis.top/dist` mirror step; the landing's Download buttons link
directly to the GitHub release. Losing spex does not take down `voxis.top`
or the already-published GitHub/Forgejo release assets.

## 2. Secrets and credentials inventory

**Verified fact:** a `grep` for `secrets.` across `.forgejo/workflows/*.yml`
returns **no matches**. The pipeline does **not** use Forgejo Actions
repository secrets (`${{ secrets.* }}`). Authentication is instead provided by
the runner environment and by host credential files on spex. That means a
recovery cannot be done by re-entering values into a Forgejo "Secrets" UI —
you must reconstitute the host-side credentials below.

| Credential | How the pipeline consumes it | Current storage location | Purpose |
| --- | --- | --- | --- |
| **`GITHUB_TOKEN` (Forgejo runner token)** | Auto-injected into every job by the Forgejo runner; used as `http.extraheader` for `git fetch`/checkout and as `Authorization: token` for the Forgejo release API | Managed by the Forgejo runner registration on spex (runner config), not a file the workflows read directly | Clone the private repo in-CI; create/upload Forgejo release assets |
| **Operator Forgejo token** | Read manually by the release operator: `ssh spex 'cat ~/.config/forgejo/token'` | `~/.config/forgejo/token` on spex | Manual `git push forgejo`, workflow dispatch, and release verification per SKILL.md's release checklist |
| **`gh` CLI GitHub auth** | `gh release create/upload/view` after `unset GITHUB_TOKEN GH_TOKEN GITHUB_SERVER_URL` so gh uses its own keyring; `update-homebrew.sh` and `docs-pr.sh` derive a push URL from `gh auth token` | `gh` keyring under `~/.config/gh` on spex (account **axelbaumlisto**) | Publish the public GitHub release; push the regenerated Homebrew formula to the tap repo; open docs PRs |
| **`HOMEBREW_TAP_REPO`** | Plain env var set in `release.yml` (`https://github.com/axelbaumlisto/homebrew-voxis.git`) | Committed in `release.yml` — **not secret** | Target repo for the tap formula push |

Important auth gotcha (already handled in-repo, must be preserved on any new
host): the Forgejo runner exports `GITHUB_TOKEN`/`GH_TOKEN` set to the
**Forgejo** token. The GitHub-facing steps (`publish to GitHub release`,
`update-homebrew.sh`, `docs-pr.sh`) explicitly `unset GITHUB_TOKEN GH_TOKEN
GITHUB_SERVER_URL` before calling `gh`, so `gh` falls back to its own keyring
(account `axelbaumlisto`). If the new host's `gh` is not authenticated as
`axelbaumlisto`, GitHub publishing and the Homebrew push will silently no-op
(both steps are `continue-on-error: true`).

## 3. Integrity of already-released binaries

**Verified fact:** `release.yml` does **not** publish any checksum or
signature file alongside the binaries. A `grep` for
`sha256|checksum|sha512|hash|\.sig|gpg|sign` in `release.yml` finds only a
comment. There is:

- **No** `*.sha256` / `SHA256SUMS` / checksum manifest uploaded to either the
  Forgejo or GitHub release.
- **No** GPG or code-signing of the Linux/Windows artifacts.
- macOS binaries are explicitly **unsigned** (per SKILL.md — signing/notarizing
  is out of scope until Apple Developer credentials exist).

The **only** sha256 anywhere in the pipeline is inside
`scripts/ci/update-homebrew.sh`: it computes the sha256 of the macOS arm64
tarball, pins it into the Homebrew formula, and gates the tap push on an
integrity check that the *published* tarball's bytes hash to the same value.
That protects Homebrew macOS installs from a mismatched tarball, but it is
**not** a published, user-verifiable checksum for the other artifacts, and it
is not a checksum file a downloader can fetch.

**Consequence for DR:** if spex is compromised, there is currently **no
independent, pre-existing checksum** to verify that the binaries already
published on GitHub/Forgejo were not tampered with. The best available
after-the-fact verification is:

1. **Reproduce from source and compare.** Check out the exact release tag on a
   clean, trusted host and rebuild with `scripts/build-all-platforms.sh
   --no-macos` (see §4.1/§4.5). Compare the rebuilt artifacts' `sha256sum`
   against the published ones. Note: the build is **not** guaranteed to be
   bit-for-bit reproducible (no reproducible-build flags are set), so byte
   divergence is not conclusive proof of tampering — but a matching hash is
   strong assurance, and gross divergence is a red flag worth investigating.
2. **Cross-check the two forges.** The same tag is published to both the
   Forgejo release (`zverozabr/voxis`) and the GitHub release
   (`axelbaumlisto/voxis`). Download the same-named asset from both and
   compare `sha256sum`. If the two independently hosted copies disagree, one
   channel was altered.
3. **Homebrew macOS tarball only:** compare the live tarball's sha256 against
   the `sha256` pinned in `homebrew-tap/Formula/voxis.rb` (and the tap copy in
   `axelbaumlisto/homebrew-voxis`).

Because none of these existed as a published, tamper-evident record before an
incident, **publishing a `SHA256SUMS` file per release is a recommended
follow-up** (see §6).

## 4. Recovery: spex unavailable or compromised

The private source of truth is the Forgejo repo `zverozabr/voxis` on spex.
If spex is lost, the source also lives in the persistent worktree
`/home/spex/work/voxis` (if the disk survives) and in any operator clone. The
GitHub repo `axelbaumlisto/voxis` holds **binary releases only** — do **not**
assume it contains the private source.

Recovery order: stand up a new host → restore the source → rebuild the CI
images → re-create credentials → re-register a runner (or build manually) →
cut/verify a release.

### 4.1 Re-provision the CI Docker images on a new host

All build images are defined in-repo, so a new Linux host with Docker can
reproduce them. From a checkout of the repo on the new host:

```bash
# Base CI image (Rust + GTK/WebKit/AppIndicator + Bun + Docker CLI + node)
bash scripts/ci/build-ci-image.sh          # docker build -f Dockerfile.ci -t voxis-ci:latest .

# Docs image (only needed for the weekly docs workflow, not for releases)
bash scripts/ci/build-docs-image.sh        # docker build -f Dockerfile.docs -t voxis-docs:latest .
```

The Linux-GUI and Windows-GUI images (`voxis-linux-gui:latest`,
`voxis-winguienv:latest`) are built on demand by
`scripts/build-all-platforms.sh` from `Dockerfile.gui-linux` /
`Dockerfile.windows-gui`; no separate provisioning step is required.

The release `build` job also enforces a preflight: **≥100G free** on the build
partition and the `voxis-ci:latest` image present. Provision disk accordingly.

### 4.2 Re-create secrets and credentials

Per §2, there are no Forgejo Actions secrets to restore — recreate the
host-side credentials on the new host:

1. **`~/.config/forgejo/token`** — issue a new Forgejo access token for the
   operator/CI account on the (recovered or new) Forgejo instance and write it
   to this path. Used for manual push/dispatch/verify per SKILL.md.
2. **`gh` keyring (`~/.config/gh`)** — run `gh auth login` and authenticate as
   **axelbaumlisto** (the account that owns `axelbaumlisto/voxis` and
   `axelbaumlisto/homebrew-voxis`). Required for the GitHub release and the
   Homebrew tap push. Confirm with `gh auth status`.
3. **Forgejo runner token** — re-register the runner against the Forgejo
   instance (see §4.3); this reissues the auto-injected `GITHUB_TOKEN`.
4. If the GitHub or Forgejo credentials on the **old** spex may have been
   **compromised**, revoke them first: the operator Forgejo token, the
   `gh`/GitHub personal token, and any deploy keys, before issuing new ones.

### 4.3 Re-establish the Forgejo repo and runner

- **Forgejo server**: if the Forgejo instance itself is gone, stand up a new
  Forgejo, create the private repo `zverozabr/voxis`, and push the recovered
  source to it. (There is currently **no automated backup** of the Forgejo
  server's own database/config — see §5.)
- **Runner**: install `forgejo-runner`, register it against the repo/instance,
  and run it as a `systemd --user` service so jobs land on `runs-on: host`.
  Verify with the SKILL.md preflight:

  ```bash
  ssh <newhost> 'systemctl --user is-active forgejo-runner && docker ps --format "{{.Names}}" | grep forgejo'
  ```

- The workflows use **manual checkout** (Forgejo is served under `/git`, which
  breaks `actions/checkout`), rely on `CI_GIT_BASE`/`GITHUB_SERVER_URL`, and
  set `GIT_PAGER=cat PAGER=cat`. These must hold on the new host too — they are
  already encoded in the workflow YAML, so a faithful checkout preserves them.

### 4.4 macOS build capability

macOS artifacts are **best-effort** and gated on:

- the prepared image `~/clipshot-macos-vm/mac_hdd_ng.prepared.img` existing, and
- `/dev/kvm` being available.

If either is missing, `release.yml`'s macOS step logs a warning and skips
(the step is `continue-on-error: true`), and the release still ships Linux +
Windows. macOS is **arm64-only** (`ort` rc.12 has no prebuilt ONNX Runtime for
`x86_64-apple-darwin`). The prepared VM image is **large (~31G) and is not
version-controlled** — if it is lost, macOS builds are unavailable until a new
VM is prepared (a manual, non-trivial setup; see `scripts/macos-vm.sh` and
`docs/` VM setup notes). Linux/Windows releases are unaffected.

### 4.5 Cut a release from the recovered host

Once the source, images, credentials, and runner are restored, follow the
standard SKILL.md release checklist (bump version in `src-tauri/Cargo.toml`
**and** `src-tauri/tauri.conf.json`, commit, push to Forgejo, dispatch `ci.yml`,
then tag `vX.Y.Z` to trigger `release.yml`). Do **not** re-tag an already-
published version: `release.yml` refuses to republish a tag that already has
assets unless dispatched with `allow_republish=true`, because overwriting
bytes under pinned URLs breaks the Homebrew sha256 and cached downloads.

If you only need to **verify** existing binaries (not cut a new release),
build the exact tag with `scripts/build-all-platforms.sh --no-macos` and
compare `sha256sum` against the published assets (§3).

## 5. What is NOT yet in place (honest gap assessment)

This is the resilience the pipeline does **not** currently have. None of the
following exist today:

- **No automated backup of the Forgejo server's own database/config.** The
  private repo, issues, runner registration, and Forgejo settings on spex are
  not backed up by any process in this repo. If spex's disk is lost, the
  private Forgejo state must be reconstructed from operator clones + memory.
- **No secondary / standby build host.** Everything runs on the single host
  "spex". There is no warm standby, no documented failover, and the release
  workflows hard-code `runs-on: host`.
- **No published checksums or signatures for released binaries.** As shown in
  §3, no `SHA256SUMS`/`*.sig`/GPG output is produced. There is no pre-incident,
  tamper-evident record for independent verification (the Homebrew sha only
  covers the macOS arm64 tarball and is not published as a downloadable file).
- **Builds are not guaranteed reproducible.** No reproducible-build flags are
  set, so rebuild-and-compare (§3, step 1) gives strong-but-not-absolute
  assurance.
- **macOS VM image is not version-controlled or backed up.** The ~31G prepared
  image lives only on spex; losing it removes macOS build capability until a
  new VM is manually prepared.
- **Credentials live as plaintext host files.** The operator Forgejo token
  (`~/.config/forgejo/token`) and the `gh` keyring sit on spex; there is no
  secret-manager, rotation policy, or automated revocation. (Separately, on the
  spex `~/.pi` agent config, real API keys may also be present in plaintext —
  out of scope for this pipeline but worth auditing during any compromise
  response.)
- **No documented RTO/RPO.** There is no target recovery time or recovery
  point objective; recovery is a manual, best-effort effort of the length
  implied by §4.

## 6. Recommended follow-ups

Ordered by risk-reduction value; each is a scoped future task, not implied to
exist:

1. **Publish a `SHA256SUMS` file per release** (Forgejo + GitHub), so
   downloaders and future incident responders have a tamper-evident record.
   Small addition to the publish steps of `release.yml`.
2. **Back up the Forgejo server database/config** on a schedule to off-host
   storage, so the private repo/runner state survives disk loss.
3. **Document (and ideally script) a cold-standby build host** so §4.1–§4.3 is
   a rehearsed procedure, not first-time improvisation during an outage.
4. **Back up (or document rebuilding) the macOS prepared VM image** so macOS
   builds are recoverable.
5. **Move credentials into a secret manager with rotation**, or at least
   document a revoke-and-reissue runbook for the tokens in §2.
