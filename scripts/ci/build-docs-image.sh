#!/usr/bin/env bash
# Build voxis-docs (docs-agent runtime): voxis-ci + pi CLI + Playwright chromium.
# The docs agents (screenshotter/auditor) run INSIDE this image via docker run,
# so nothing they spawn (pi/vite/chromium) can leak onto the shared host.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

BASE="${CI_IMAGE:-voxis-ci}:${CI_IMAGE_TAG:-latest}"
IMAGE="${DOCS_IMAGE:-voxis-docs}"
TAG="${DOCS_IMAGE_TAG:-latest}"
REF="${IMAGE}:${TAG}"

# voxis-docs FROM voxis-ci:latest — ensure the base exists first.
if ! docker image inspect "$BASE" >/dev/null 2>&1; then
  echo "=== base $BASE missing; building it first ==="
  bash scripts/ci/build-ci-image.sh
fi

echo "=== building ${REF} from Dockerfile.docs (base ${BASE}) ==="
docker build -f Dockerfile.docs -t "${REF}" .
echo "=== ${REF} ready ==="
docker run --rm "${REF}" bash -lc 'pi --version; node --version; bun --version; ls /opt/ms-playwright'
