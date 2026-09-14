#!/usr/bin/env bash
# Keep release binaries ONLY on the newest release; strip them from older ones.
#
# WHY THIS EXISTS
# ---------------
# Every release used to keep all 8 platform artifacts forever on Forgejo.
# Measured on 2026-09-07: 5 voxis releases x ~8 assets = 756 MB of Forgejo
# attachments, growing ~150 MB per release, with no rotation.
#
# Nothing consumes those copies. The canonical public download is the
# **GitHub** release (`axelbaumlisto/voxis`) — that is what users are told to
# download from, and the Homebrew formula (`homebrew-tap/Formula/voxis.rb`)
# pins its `url` at a GitHub release asset URL, not a Forgejo one. The
# `publish` job in `.forgejo/workflows/release.yml` uploads every artifact to
# GitHub in full, unconditionally, on every release — GitHub keeps full
# history and this script never touches it (it only knows `FORGEJO_API`).
#
# So the Forgejo attachments are a duplicate archive nobody downloads from.
# This script keeps the newest release complete (a deliberate escape hatch
# for a rollback download straight from the private Forgejo instance) and
# removes the binaries from older releases.
#
# WHAT IT NEVER TOUCHES
#   * tags
#   * release entries themselves
#   * release notes / changelog
#   * GitHub releases (`axelbaumlisto/voxis`) — always full history
# Only attachments of NON-newest Forgejo releases are deleted.
#
# Usage:
#   prune-release-assets.sh --keep-tag v0.1.5             # dry run by default
#   prune-release-assets.sh --keep-tag v0.1.5 --apply
#
# Env: FORGEJO_API (repo API base), FORGEJO_TOKEN.
set -uo pipefail

API="${FORGEJO_API:-}"
TOKEN="${FORGEJO_TOKEN:-}"
KEEP_TAG=""
APPLY=0

while [ $# -gt 0 ]; do
    case "$1" in
        --keep-tag) KEEP_TAG="${2:-}"; shift 2 ;;
        --apply)    APPLY=1; shift ;;
        --api)      API="${2:-}"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

[ -n "$API" ]   || { echo "FORGEJO_API is required (repo API base)" >&2; exit 2; }
[ -n "$TOKEN" ] || { echo "FORGEJO_TOKEN is required" >&2; exit 2; }

auth="Authorization: token $TOKEN"

releases="$(curl -fsSL -H "$auth" "$API/releases?limit=100" 2>/dev/null || echo '')"
if [ -z "$releases" ]; then
    echo "could not list releases from $API — nothing pruned" >&2
    exit 1
fi

# Resolve the tag to keep. Explicit --keep-tag wins; otherwise the newest
# release by creation time. Never guess by version-string sorting: a hand-made
# or re-cut tag would silently become "newest".
plan="$(printf '%s' "$releases" | KEEP_TAG="$KEEP_TAG" python3 -c '
import json, os, sys

try:
    data = json.load(sys.stdin)
except Exception as exc:
    print(f"ERROR unparseable release list: {exc}", file=sys.stderr)
    sys.exit(1)

if not isinstance(data, list) or not data:
    sys.exit(0)

keep = os.environ.get("KEEP_TAG") or ""
if not keep:
    # Newest release THAT ACTUALLY HAS BINARIES — not merely the newest.
    # A tag can exist as a release entry with ZERO assets (the release entry
    # was created, artifacts never landed, e.g. a build/publish failure).
    # "Keep the newest" would then keep an empty release and delete every
    # downloadable binary in the forge.
    with_assets = [r for r in data if r.get("assets")]
    if not with_assets:
        print("ERROR no release has any assets; refusing to prune", file=sys.stderr)
        sys.exit(1)
    newest = max(with_assets, key=lambda r: r.get("created_at") or "")
    keep = newest.get("tag_name") or ""

if not keep:
    print("ERROR could not determine which release to keep", file=sys.stderr)
    sys.exit(1)

target = next((r for r in data if r.get("tag_name") == keep), None)
if target is None:
    print(f"ERROR keep-tag {keep} is not an existing release", file=sys.stderr)
    sys.exit(1)

# Refuse to strip every binary from the forge. An explicit --keep-tag pointing at
# an assetless release (easy to do: the newest tag is often cut before artifacts
# upload) would otherwise leave nothing downloadable anywhere.
if not target.get("assets"):
    print(
        f"ERROR keep-tag {keep} has no assets — pruning would remove every binary. "
        "Pass a --keep-tag that actually has artifacts.",
        file=sys.stderr,
    )
    sys.exit(1)

print(f"KEEP\t{keep}")
for rel in data:
    tag = rel.get("tag_name")
    if tag == keep:
        continue
    for asset in rel.get("assets") or []:
        rid = rel.get("id")
        aid = asset.get("id")
        name = asset.get("name", "?")
        size = asset.get("size", 0)
        print("DEL\t%s\t%s\t%s\t%s\t%s" % (rid, aid, tag, name, size))
')" || exit 1

keep_tag="$(printf '%s\n' "$plan" | awk -F'\t' '$1=="KEEP"{print $2}')"
echo "keeping binaries on: ${keep_tag:-<none>}"

total=0
count=0
while IFS=$'\t' read -r kind rid aid rtag aname asize; do
    [ "$kind" = "DEL" ] || continue
    count=$((count + 1))
    total=$((total + ${asize:-0}))
    if [ "$APPLY" -eq 1 ]; then
        if curl -fsSL -X DELETE -H "$auth" "$API/releases/$rid/assets/$aid" >/dev/null 2>&1; then
            echo "  deleted  $rtag/$aname"
        else
            echo "  WARN could not delete $rtag/$aname (left in place)"
        fi
    else
        echo "  would delete  $rtag/$aname"
    fi
done <<< "$plan"

mb=$(( total / 1048576 ))
if [ "$APPLY" -eq 1 ]; then
    echo "pruned $count asset(s), ~${mb} MB"
else
    echo "DRY RUN: $count asset(s), ~${mb} MB would be freed (pass --apply to do it)"
fi
