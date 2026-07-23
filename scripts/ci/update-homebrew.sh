#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TAG="${1:-${GITHUB_REF_NAME:-}}"
if [ -z "$TAG" ]; then
  echo "Usage: $0 vX.Y.Z" >&2
  exit 2
fi
VERSION="${TAG#v}"
# Local build artifacts live in artifacts/ (dist/ is vite's frontend outDir).
# macOS is arm64-only (Apple Silicon); ort has no x86_64-darwin prebuilt.
TARBALL="artifacts/voxis-macos-arm64.tar.gz"
if [ ! -f "$TARBALL" ]; then
  if [ ! -f artifacts/voxis-macos-arm64 ]; then
    echo "WARNING: artifacts/voxis-macos-arm64 missing; cannot update Homebrew formula"
    exit 0
  fi
  tar -C artifacts -czf "$TARBALL" voxis-macos-arm64
fi
SHA=$(sha256sum "$TARBALL" | awk '{print $1}')
FORMULA="homebrew-tap/Formula/voxis.rb"
# URL points at the GitHub release asset (canonical download channel).
# voxis.top is a Vercel-hosted landing with no /dist mirror, so it can't serve
# the tarball.
URL="https://github.com/axelbaumlisto/voxis/releases/download/${TAG}/voxis-macos-arm64.tar.gz"
python3 - <<'PY' "$FORMULA" "$VERSION" "$SHA" "$URL"
from pathlib import Path
import re, sys
path=Path(sys.argv[1]); version=sys.argv[2]; sha=sys.argv[3]; url=sys.argv[4]
text=path.read_text()
text=re.sub(r'url "[^"]+"', f'url "{url}"', text)
text=re.sub(r'version "[^"]+"', f'version "{version}"', text)
text=re.sub(r'sha256 "[^"]+"', f'sha256 "{sha}"', text)
path.write_text(text)
PY
echo "Updated $FORMULA to $VERSION $SHA"

# Optional: push the updated formula into a separate tap repo. Guarded so a
# misconfigured push can never HANG the (up-to-180-min) release build job:
#  - GIT_TERMINAL_PROMPT=0: never block on an interactive credential prompt.
#  - timeout on every network git op.
#  - explicit git identity (commits fail in CI without user.name/email).
#  - token trap: the Forgejo runner exports GITHUB_TOKEN=<forgejo token>; git
#    doesn't read it, but gh does. Build an authenticated github.com URL from
#    `gh auth token` (with the Forgejo env vars unset) so the push uses the
#    correct github.com credentials, not a Forgejo token context.
#  - idempotent commit: `git diff --cached --quiet || commit` avoids a spurious
#    non-zero "nothing to commit" on a no-change re-run.
if [ -n "${HOMEBREW_TAP_REPO:-}" ]; then
  export GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never
  push_url="$HOMEBREW_TAP_REPO"
  if command -v gh >/dev/null 2>&1; then
    tok=$(unset GITHUB_TOKEN GH_TOKEN GITHUB_SERVER_URL; gh auth token 2>/dev/null || true)
    if [ -n "$tok" ]; then
      # rewrite https://github.com/... -> https://x-access-token:TOK@github.com/...
      push_url=$(printf '%s' "$HOMEBREW_TAP_REPO" | sed -E "s#https://(github.com/)#https://x-access-token:${tok}@\1#")
    fi
  fi
  tmp=$(mktemp -d)
  if ! timeout 120 git clone --depth 1 "$push_url" "$tmp/tap" 2>/dev/null; then
    echo "WARNING: could not clone tap repo ($HOMEBREW_TAP_REPO); skipping formula push (advisory)"
  else
    mkdir -p "$tmp/tap/Formula"
    cp "$FORMULA" "$tmp/tap/Formula/voxis.rb"
    ( cd "$tmp/tap"
      git config user.email "ci@voxis.top"
      git config user.name  "voxis-ci"
      git add Formula/voxis.rb
      if git diff --cached --quiet; then
        echo "formula unchanged; nothing to push"
      else
        git commit -m "formula: update voxis ${TAG}"
        timeout 120 git push || echo "WARNING: formula push failed (advisory)"
      fi )
  fi
  rm -rf "$tmp"
fi
