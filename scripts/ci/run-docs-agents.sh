#!/usr/bin/env bash
set -euo pipefail
TAG="${1:-}"
echo "=== Voxis docs agents advisory run ${TAG:+for $TAG} ==="
if ! command -v pi >/dev/null 2>&1; then
  echo "WARNING: pi CLI not found on PATH; skipping docs agents"
  exit 0
fi
if [ ! -f .pi/agents/docs-auditor.md ] || [ ! -f .pi/agents/docs-screenshotter.md ]; then
  echo "WARNING: docs agent definitions missing; skipping"
  exit 0
fi
pi run docs-screenshotter "Refresh Voxis docs screenshots ${TAG}" || echo "WARNING: docs-screenshotter failed (advisory)"
pi run docs-auditor "Audit Voxis docs ${TAG}" || echo "WARNING: docs-auditor failed (advisory)"
