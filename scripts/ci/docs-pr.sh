#!/usr/bin/env bash
# Regenerate docs (screenshots + audit fixes) in an ISOLATED clone of GitHub
# main, then open a PR against GitHub main. Merging the PR triggers the existing
# GitHub Pages deploy (.github/workflows/pages.yml).
#
# Why a PR (not a direct push to main, not a gh-pages branch):
#  - GitHub Pages here uses the "GitHub Actions" source (pages.yml builds Jekyll
#    from docs-site/ on main). A gh-pages branch source would require a manual
#    Pages settings flip + retiring pages.yml + force-overwrite semantics.
#  - A PR keeps a human review gate that absorbs non-deterministic screenshot
#    byte-churn, keeps main's history clean/auditable, and needs zero Pages
#    reconfiguration.
#
# Why an isolated clone (not the shared /home/spex/work/voxis, not a worktree):
#  - The release job mutates the shared checkout; a worktree shares the same
#    .git/index-lock. A separate clone fully removes the race.
#
# Safety invariants:
#  - NEVER force-push. The docs/* branch is fresh each run (fast-forward its own).
#  - Stage ONLY docs-site/ via explicit pathspec (never `git add -A`); artifacts/
#    is gitignored anyway, but pathspec is the real guard.
#  - GitHub auth: the Forgejo runner exports GITHUB_TOKEN=<forgejo token>. Unset
#    it and use `gh auth token` so git/gh talk to github.com with the right creds.
#  - Advisory: emit greppable ::docs:: markers; a failure must be observable, not
#    silent-green. Always exit 0 (never fail the scheduled workflow).
set -uo pipefail

REPO_SLUG="axelbaumlisto/voxis"
GH_URL="https://github.com/${REPO_SLUG}.git"
WORKDIR="${DOCS_PR_WORKDIR:-/home/spex/work/voxis-docs}"
BR="docs/regen-$(date +%Y%m%d-%H%M%S)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

marker() { echo "::docs:: $*"; }

# gh/git must use github.com creds, not the Forgejo GITHUB_TOKEN.
GH_TOK="$(unset GITHUB_TOKEN GH_TOKEN GITHUB_SERVER_URL; gh auth token 2>/dev/null || true)"
if [ -z "$GH_TOK" ]; then
  marker "SKIPPED — no github.com auth (gh auth token empty)"
  exit 0
fi
AUTH_URL="https://x-access-token:${GH_TOK}@github.com/${REPO_SLUG}.git"

export GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never

# Fresh isolated clone of github main (shallow).
rm -rf "$WORKDIR"
if ! timeout 180 git clone --depth 1 "$AUTH_URL" "$WORKDIR" 2>/dev/null; then
  marker "FAILED — could not clone github main"
  exit 0
fi
cd "$WORKDIR"
git config user.email "ci@voxis.top"
git config user.name  "voxis-ci"

# Run the docs agents (screenshotter + auditor) — reuses the hardened runner
# (pi -p invocation + setsid/PGID + port-5173 fuser reaping). Non-fatal.
if [ -f "$SCRIPT_DIR/run-docs-agents.sh" ]; then
  RUNNER="$SCRIPT_DIR/run-docs-agents.sh"
else
  RUNNER="$WORKDIR/scripts/ci/run-docs-agents.sh"
fi
bash "$RUNNER" "${1:-scheduled}" || marker "agents returned non-zero (advisory)"

# Secret-safety: screenshots come from Tauri mocks, but refuse to open a PR if a
# high-entropy real-looking key leaked in. Match provider key prefixes
# (Groq gsk_, OpenAI sk-, GitHub gh[pousr]_) with a long token body; these do
# not appear in mock/placeholder data. Deliberately narrow to avoid flagging
# doc prose like "api_key: your_api_key_here".
if grep -RInoE '(gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})' docs-site/ 2>/dev/null | head -1; then
  marker "FAILED — possible real secret in regenerated docs-site/; aborting PR"
  exit 0
fi

# Only docs-site/ changes go in (explicit pathspec — never -A).
git add -- docs-site/
if git diff --cached --quiet; then
  marker "OK — docs-site unchanged; no PR needed"
  exit 0
fi

git checkout -b "$BR"
git commit -q -m "docs: regenerate screenshots + audit fixes ($(date +%Y-%m-%d))"
if ! timeout 120 git push -u origin "$BR" 2>/dev/null; then
  marker "FAILED — could not push $BR"
  exit 0
fi

# Ensure the `docs` label exists (gh pr create --label fails hard if absent).
( unset GITHUB_TOKEN GH_TOKEN GITHUB_SERVER_URL
  gh label create docs --repo "$REPO_SLUG" --color 0075ca --description "Documentation" 2>/dev/null || true )

pr_url=$(unset GITHUB_TOKEN GH_TOKEN GITHUB_SERVER_URL
  gh pr create --repo "$REPO_SLUG" --base main --head "$BR" \
    --title "docs: scheduled regeneration $(date +%Y-%m-%d)" \
    --body "Automated docs-site regeneration (screenshots + audit). Review the diff; merging deploys to docs.voxis.top via pages.yml." \
    --label docs 2>/dev/null || true)
if [ -n "$pr_url" ]; then
  marker "OK — opened PR: $pr_url"
else
  marker "OK — pushed $BR (PR create failed or label missing; open manually)"
fi
exit 0
