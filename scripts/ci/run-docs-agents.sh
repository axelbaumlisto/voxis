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
# Each agent is bounded so a hung pi run can't stall the release pipeline
# (the job itself is continue-on-error + timeout, this is defense in depth).
timeout 900 pi run docs-screenshotter "Refresh Voxis docs screenshots ${TAG}" \
  || echo "WARNING: docs-screenshotter failed/timed out (advisory)"
timeout 900 pi run docs-auditor "Audit Voxis docs ${TAG}" \
  || echo "WARNING: docs-auditor failed/timed out (advisory)"

# Advisory: never fail the release on docs.
exit 0
