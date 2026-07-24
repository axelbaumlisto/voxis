# macOS Code Signing + Notarization — TODO / Scope

> **Status: BLOCKED on a human/funding decision.**
> This is a *research + scoping* document, not an implementation. Voxis ships
> **unsigned** macOS binaries today. Signing and notarization cannot be added
> without an **Apple Developer Program membership (99 USD/year)**, which
> requires a real person/organization to enroll and pay — no code change in
> this repo can produce it. See [§5 Blocked-on-human-decision](#5-blocked-on-a-human-decision-the-99year-gate).
>
> Once the account + a *Developer ID Application* certificate exist, the actual
> implementation is a **known, bounded piece of work** (est. **~1–2 focused
> days**, see [§4](#4-efforttime-estimate)) — the sections below tell a future
> implementer exactly what to add and where.

This document was written after verifying the *current* requirements against
Apple's live enrollment page, the Tauri v2 macOS signing documentation, and
current `notarytool` usage references (see [§6 Sources](#6-sources-verified-2026)),
because Apple's tooling and terminology change periodically and stale training
knowledge (e.g. the long-deprecated `altool`) must not be relied on.

---

## 1. Apple Developer Program enrollment — cost & requirements (verified 2026)

Confirmed against <https://developer.apple.com/programs/enroll/>:

- **Cost: 99 USD per membership year** (renews annually; "Prices may vary by
  region and are listed in local currency during the enrollment process").
  Fee waivers exist for nonprofits / accredited educational institutions /
  government entities that meet Apple's requirements — **not** applicable to a
  normal indie/commercial project.
- **Apple Account with two-factor authentication turned on** (Apple renamed
  "Apple ID" → "Apple Account", but the credential is the same; the CLI flag is
  still `--apple-id`).
- **Enroll as an individual/sole proprietor** *or* **as an organization**:
  - **Individual / sole proprietor:** an Apple Account (2FA), and you must be
    the legal age of majority in your region. Your Apple Account **first/last
    name must be your legal name** (aliases/nicknames/company names delay
    approval).
  - **Organization:** additionally requires
    - **Legal binding authority** — the enrolling person must be able to bind
      the organization to legal agreements (owner/founder/exec/senior lead, or
      an employee with delegated legal authority).
    - **Legal entity name and status** — a real legal entity that can contract
      with Apple. DBAs / fictitious business names / trade names / branches are
      **not** accepted. This name becomes the App Store "seller" name.
    - **D-U-N-S Number** — a free nine-digit Dun & Bradstreet business
      identifier (excluding government entities); can take time to obtain if
      the org doesn't already have one.
- After identity verification, you agree to the Apple Developer Program License
  Agreement and complete the 99 USD purchase.

**Recommendation for Voxis:** enroll as an **individual** (no D-U-N-S / legal
entity needed) unless the project is incorporated. Individual enrollment is the
fastest path to a **Developer ID Application** certificate, which is what's
needed to sign+notarize software distributed *outside* the Mac App Store (our
case — direct download + Homebrew tarball).

---

## 2. Secrets/credentials to add to the Forgejo CI secret store (once enrolled)

Voxis builds macOS artifacts on spex inside a **Docker-OSX KVM VM**, not on a
hosted macOS runner, so these secrets are consumed inside that VM build path
(`scripts/macos-vm.sh`) — not by a `tauri-action` GitHub matrix job. The
**required** set (current Apple / Tauri terminology, verified 2026):

### 2a. Signing certificate (needed for `codesign`)

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | The **Developer ID Application** signing cert exported as a password-protected `.p12`, then **base64-encoded** to a single-line string. Imported into a throwaway keychain inside the VM before `codesign`. |
| `APPLE_CERTIFICATE_PASSWORD` | The password set when exporting the `.p12`. |
| `KEYCHAIN_PASSWORD` | An arbitrary password for the temporary build keychain created inside the VM (`security create-keychain`). |
| `APPLE_SIGNING_IDENTITY` | The identity string, e.g. `Developer ID Application: Your Name (TEAMID)`. Can also be derived at runtime from `security find-identity -v -p codesigning`. |

> Only the **Account Holder** can create *Developer ID Application*
> certificates (Apple restriction). The cert is created once in the Apple
> Developer portal / Xcode, exported as `.p12`, base64'd, and stored as the
> `APPLE_CERTIFICATE` secret.

### 2b. Notarization credentials — pick **ONE** of two flows

`notarytool` (the current tool — the old `altool` notarization path is
deprecated) accepts either:

**Flow A — App Store Connect API key (recommended for CI; no personal password):**

| Secret | What it is |
| --- | --- |
| `APPLE_API_KEY` | The **Key ID** of an App Store Connect API key (created at App Store Connect → Users and Access → Integrations/Keys). |
| `APPLE_API_ISSUER` | The **Issuer ID** (UUID) shown on the same Keys page. |
| `APPLE_API_KEY_PATH` | Path to the downloaded `AuthKey_<KeyID>.p8` private key file (store the file contents as a secret and write it to disk inside the VM at build time). |

**Flow B — Apple ID + app-specific password (simpler to set up, ties to a person):**

| Secret | What it is |
| --- | --- |
| `APPLE_ID` | The Apple Account email. |
| `APPLE_PASSWORD` | An **app-specific password** (generated at <https://account.apple.com> → Sign-In & Security → App-Specific Passwords — **not** the real account password). |
| `APPLE_TEAM_ID` | The 10-char Team ID from the Apple Developer membership page. |

> **Recommendation:** use **Flow A (API key)** for CI — it's revocable, not tied
> to a human's primary credential, and is Apple's recommended automation path.
> Keep the naming identical to Tauri's env-var convention above so the
> credentials could also drive `tauri-action` later if the build ever moves to
> a real macOS runner.

### Storage mechanism

Add these as **Forgejo Actions secrets** on the private CI repo
(`zverozabr/voxis` on spex), referenced in `release.yml` as
`${{ secrets.APPLE_* }}` and passed into the KVM VM as environment variables by
`scripts/macos-vm.sh`. **Never** commit any cert/key/password to the repo;
never echo them in logs (mask with `add-mask` / avoid `set -x` around them).
The `.p12` and `.p8` are written to disk **only inside the ephemeral VM** and
removed after the build.

---

## 3. Exact insertion points (quoted from the real current files)

> ⚠️ **Important precondition the implementer must handle first:** the current
> macOS build produces a **bare Mach-O CLI binary** (`voice`), not a `.app`
> bundle or `.dmg`. `codesign` works on a bare binary, but **`notarytool` only
> accepts a `.zip`, `.pkg`, or `.dmg` container** — it will *not* accept the
> current `voxis-macos-arm64.tar.gz` (tar/gzip is not a supported notarization
> container). And `stapler staple` **cannot staple a bare Mach-O binary or a
> `.zip`** — a stapled ticket requires a `.app`, `.dmg`, or `.pkg`. So the
> realistic options are:
> 1. Sign the bare binary, `ditto -c -k --keepParent` it into a **`.zip`**,
>    submit the zip to `notarytool` (the notarization ticket is then served
>    online by Apple's Gatekeeper check — a bare-binary download still passes
>    even without a stapled ticket), **or**
> 2. Package the binary into a proper **`.app` bundle → `.dmg`**, sign+notarize
>    +`stapler staple` the `.dmg` (the clean, fully-offline-verifiable option).
> Option 2 is the "done right" target and is what the `stapler staple` step
> below assumes. Decide this at implementation time.

### 3a. `scripts/macos-vm.sh` — inside `cmd_build()`

The signing/notarization steps go **after** the artifact is pulled out of the
VM (or, better, run the `codesign` step *inside* the VM where the keychain +
Xcode command-line tools live). The current tail of `cmd_build()` is:

```bash
  echo "Building aarch64-apple-darwin ..."
  ssh_vm "$vmenv; cd ~/voxis/src-tauri && rustup target add aarch64-apple-darwin >/dev/null 2>&1 || true; cargo build --release --target aarch64-apple-darwin --bin voice"
  echo "Pulling artifacts ..."
  local scp="sshpass -p $VM_PASS scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -P $SSH_HOST_PORT"
  $scp "$VM_USER@localhost:/Users/$VM_USER/voxis/src-tauri/target/aarch64-apple-darwin/release/voice" "$proj_dir/artifacts/voxis-macos-arm64"
  chmod +x "$proj_dir"/artifacts/voxis-macos-* 2>/dev/null || true
  echo "macOS artifacts in artifacts/:"
  ls -lh "$proj_dir"/artifacts/voxis-macos-* 2>/dev/null
}
```

**INSERTION POINT #1 — sign, still inside the VM, immediately after the
`cargo build ...` line and BEFORE `echo "Pulling artifacts ..."`:**

```bash
  # >>> INSERT: import cert into a temp keychain and codesign (runs in VM) <<<
  ssh_vm "$vmenv; \
    echo \"\$APPLE_CERTIFICATE\" | base64 --decode > /tmp/cert.p12 && \
    security create-keychain -p \"\$KEYCHAIN_PASSWORD\" build.keychain && \
    security default-keychain -s build.keychain && \
    security unlock-keychain -p \"\$KEYCHAIN_PASSWORD\" build.keychain && \
    security import /tmp/cert.p12 -k build.keychain -P \"\$APPLE_CERTIFICATE_PASSWORD\" -T /usr/bin/codesign && \
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k \"\$KEYCHAIN_PASSWORD\" build.keychain && \
    rm -f /tmp/cert.p12 && \
    codesign --force --options runtime --timestamp \
      --sign \"\$APPLE_SIGNING_IDENTITY\" \
      ~/voxis/src-tauri/target/aarch64-apple-darwin/release/voice"
  # (env vars APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD / KEYCHAIN_PASSWORD /
  #  APPLE_SIGNING_IDENTITY must be exported into ssh_vm's environment — extend
  #  ssh_vm() to forward them, or write them to a sourced env file in the VM.)
  # <<< END INSERT #1 >>>
```

**INSERTION POINT #2 — notarize + staple, AFTER the `chmod +x ...` line and
before the final `echo "macOS artifacts in artifacts/:"`** (this example uses
the zip-submit path from the precondition note; swap the container for `.dmg`
if going the full-bundle route):

```bash
  # >>> INSERT: notarize the signed binary (Flow A: App Store Connect API key) <<<
  # notarytool needs a .zip/.pkg/.dmg container — a bare binary or .tar.gz is rejected.
  ( cd "$proj_dir/artifacts" && ditto -c -k --keepParent voxis-macos-arm64 voxis-macos-arm64-notary.zip )
  printf '%s' "$APPLE_API_KEY_P8" > /tmp/AuthKey.p8   # p8 contents from a secret
  xcrun notarytool submit "$proj_dir/artifacts/voxis-macos-arm64-notary.zip" \
    --key /tmp/AuthKey.p8 \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
  rm -f /tmp/AuthKey.p8
  # If distributing a .app/.dmg instead, staple the ticket into the container
  # (stapler cannot staple a bare binary or a .zip):
  #   xcrun stapler staple "$proj_dir/artifacts/Voxis.dmg"
  #   xcrun stapler validate "$proj_dir/artifacts/Voxis.dmg"
  # <<< END INSERT #2 >>>
```

> Flow B equivalent for the `notarytool submit` line (Apple ID + app-specific
> password): store credentials once, then submit by profile —
> `xcrun notarytool store-credentials voxis-notary --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD"`
> then `xcrun notarytool submit <container> --keychain-profile "voxis-notary" --wait`.

> **Note on `xcrun` availability in the VM:** `notarytool`, `stapler`, and
> `codesign` require the **Xcode command-line tools** to be installed in the
> Docker-OSX VM image (`xcode-select --install`, or a full Xcode). Verify /
> add this to the prepared image before implementing — the current unsigned
> path only needs `cargo`/`bun` and does not exercise `xcrun`.

### 3b. `.forgejo/workflows/release.yml` — the "build macOS (best-effort — KVM VM)" step

The current step is:

```yaml
      - name: build macOS (best-effort — KVM VM)
        continue-on-error: true
        timeout-minutes: 60
        run: |
          set -uo pipefail
          cd /home/spex/work/voxis
          PREPARED="$HOME/clipshot-macos-vm/mac_hdd_ng.prepared.img"
          if [ ! -f "$PREPARED" ]; then
            echo "⚠️ no prepared macOS VM image at $PREPARED — skipping macOS"
            exit 0
          fi
          if [ ! -e /dev/kvm ]; then
            echo "⚠️ /dev/kvm not available — skipping macOS"
            exit 0
          fi
          if bash scripts/macos-vm.sh build; then
            echo "=== macOS artifacts (arm64-only; ort has no x86_64-darwin prebuilt) ==="
            ls -lh artifacts/voxis-macos-* 2>/dev/null
            tar -C artifacts -czf artifacts/voxis-macos-arm64.tar.gz voxis-macos-arm64 2>/dev/null || true
            echo "✅ macOS build succeeded"
          else
            echo "⚠️ macOS build failed (advisory — not blocking release)"
          fi
          bash scripts/macos-vm.sh stop 2>/dev/null || true
```

**INSERTION POINT #3 — add an `env:` block to this step** so the Apple secrets
reach `scripts/macos-vm.sh` (which then forwards them into `ssh_vm`). Insert it
between `continue-on-error: true` / `timeout-minutes: 60` and `run: |`:

```yaml
      - name: build macOS (best-effort — KVM VM)
        continue-on-error: true
        timeout-minutes: 60
        env:
          # >>> INSERT: Apple signing/notarization secrets (Flow A shown) <<<
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY_P8 }}
          # (Flow B instead: APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID)
          # <<< END INSERT #3 >>>
        run: |
          set -uo pipefail
          ...
```

> Keep `continue-on-error: true` on this step at least initially: a signing
> misconfiguration should degrade to "unsigned build shipped" (today's
> behavior), not block the whole release. Once signing is proven stable,
> consider tightening it. The publish steps already upload
> `artifacts/voxis-macos-arm64` and `artifacts/voxis-macos-arm64.tar.gz` via
> explicit globs — if the container format changes to `.dmg`, update those
> globs in both the "publish to Forgejo release" and "publish to GitHub
> release" steps accordingly, plus the homebrew tarball URL/sha in
> `scripts/ci/update-homebrew.sh`.

### 3c. `.pi/skills/voxis-deploy/SKILL.md` (documentation follow-up, not code)

The skill currently states, under **macOS KVM**:

> `Signed/notarized DMG is out of scope until Apple Developer credentials are available.`

When signing lands, that line should be updated to describe the new secret
requirements and the signed/notarized artifact. (No change now — this doc is
the source of truth until the account exists.)

---

## 4. Effort/time estimate

Assuming the Apple Developer account + Developer ID Application certificate +
App Store Connect API key already exist, and `xcrun` tools are present in the
VM image:

| Sub-task | Estimate |
| --- | --- |
| Create cert / API key in Apple portals, export `.p12`/`.p8`, add Forgejo secrets | 1–2 h |
| Ensure Xcode command-line tools in the Docker-OSX VM image (may need re-prepare + `save`) | 2–4 h (VM iteration is slow) |
| Implement `codesign` step + keychain import in `macos-vm.sh` (INSERT #1) | 2–3 h |
| Implement notarize + (optional) `.app`/`.dmg` packaging + staple (INSERT #2) | 3–5 h (container-format decision + iteration) |
| Wire `env:` secrets in `release.yml` (INSERT #3) + adjust publish globs / homebrew sha if container changes | 1–2 h |
| End-to-end test through a real tagged release + Gatekeeper verification on a real Mac (`spctl -a -vvv`, download-and-open) | 2–4 h |
| **Total** | **~1–2 focused days**, dominated by slow KVM VM iteration and the notarization round-trip. |

The single biggest unknown is the **container-format decision** (zip-only
notarization vs. full `.app`/`.dmg` bundling+stapling) — resolve that first.

---

## 5. BLOCKED on a human decision — the $99/year gate

**This work cannot be completed by this plan or by any code change alone.** It
requires:

1. A person or organization to **enroll in the Apple Developer Program and pay
   99 USD/year** (recurring). Individual enrollment avoids the D-U-N-S / legal
   entity requirements; organization enrollment does not.
2. That Account Holder to **create the Developer ID Application certificate**
   (only the Account Holder can) and an App Store Connect API key.
3. The resulting **secrets to be added to the Forgejo CI secret store** by
   someone with access to it.

Until then, Voxis correctly ships **unsigned** macOS binaries, and macOS users
will see the Gatekeeper "cannot verify the developer" warning and must
right-click → Open (or clear the quarantine attribute). This is a known,
accepted limitation, not a bug.

### Optional: funding the $99/year via GitHub Sponsors

The project's own **GTM/growth review recommended** funding this specific,
narrow cost via a GitHub Sponsors button — a small, honest, single-purpose ask
("help pay for the Apple Developer membership so macOS builds can be signed &
notarized"). A `.github/FUNDING.yml` (or a Sponsors link in `README.md`) could
carry that ask.

> **Out of scope for this task:** this document only *records the suggestion*.
> No `.github/FUNDING.yml` is added here, and doing so would require a real
> Sponsors/Ko-fi/etc. account decision by the maintainer. Add it as a separate,
> deliberate step if the maintainer wants to pursue it now rather than wait.

---

## 6. Sources (verified 2026)

- Apple Developer Program enrollment (cost, requirements, D-U-N-S, individual
  vs org): <https://developer.apple.com/programs/enroll/> — confirmed
  "The Apple Developer Program is 99 USD per membership year."
- Tauri v2 macOS code signing & notarization (current env-var names, `.p12`
  keychain import, App-Store-Connect-API vs Apple-ID+app-specific-password
  flows, "Notarization is required when using a Developer ID Application
  certificate"): <https://v2.tauri.app/distribute/sign/macos/>
- Current `notarytool` usage (`store-credentials`, `submit --wait`,
  `stapler staple`; confirmation that `altool` is superseded): current
  `notarytool` how-to references, e.g.
  <https://scriptingosx.com/2021/07/notarize-a-command-line-tool-with-notarytool/>
  cross-checked against Apple's `notarytool`/Notary Service docs.

> If revisiting this later, re-verify against Apple's live docs — enrollment
> terms and tooling change periodically; do not trust cached knowledge.
