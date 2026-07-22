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
TARBALL="artifacts/voxis-macos-universal.tar.gz"
if [ ! -f "$TARBALL" ]; then
  if [ ! -f artifacts/voxis-macos-universal ]; then
    echo "WARNING: artifacts/voxis-macos-universal missing; cannot update Homebrew formula"
    exit 0
  fi
  tar -C artifacts -czf "$TARBALL" voxis-macos-universal
fi
SHA=$(sha256sum "$TARBALL" | awk '{print $1}')
FORMULA="homebrew-tap/Formula/voxis.rb"
python3 - <<'PY' "$FORMULA" "$VERSION" "$SHA"
from pathlib import Path
import re, sys
path=Path(sys.argv[1]); version=sys.argv[2]; sha=sys.argv[3]
text=path.read_text()
text=re.sub(r'url "[^"]+"', f'url "https://voxis.top/dist/voxis-macos-universal.tar.gz"', text)
text=re.sub(r'version "[^"]+"', f'version "{version}"', text)
text=re.sub(r'sha256 "[^"]+"', f'sha256 "{sha}"', text)
path.write_text(text)
PY
echo "Updated $FORMULA to $VERSION $SHA"
if [ -n "${HOMEBREW_TAP_REPO:-}" ]; then
  tmp=$(mktemp -d)
  git clone "$HOMEBREW_TAP_REPO" "$tmp/homebrew-tap"
  mkdir -p "$tmp/homebrew-tap/Formula"
  cp "$FORMULA" "$tmp/homebrew-tap/Formula/voxis.rb"
  (cd "$tmp/homebrew-tap" && git add Formula/voxis.rb && git commit -m "formula: update voxis ${TAG}" && git push)
fi
