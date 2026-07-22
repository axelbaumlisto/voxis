#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
IMAGE="${CI_IMAGE:-voxis-ci}"
TAG="${CI_IMAGE_TAG:-latest}"
REF="${IMAGE}:${TAG}"
echo "=== building ${REF} from Dockerfile.ci ==="
docker build -f Dockerfile.ci -t "${REF}" .
echo "=== ${REF} ready ==="
docker run --rm "${REF}" bash -c 'cargo --version; bun --version; docker --version; docker compose version'
