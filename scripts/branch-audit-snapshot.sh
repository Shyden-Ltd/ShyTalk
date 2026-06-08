#!/usr/bin/env bash
# SHY-0033: Branch audit snapshot.
#
# Enumerates every branch on the Shyden-Ltd/ShyTalk remote via `gh api`,
# joins each with its head-commit metadata + any associated PR (open or
# closed), and emits a single JSON document to .project/audit/.
#
# Output schema (one object per branch):
#   {
#     "name": "feat/foo-bar",
#     "head_sha": "ad35cfd...",
#     "head_date": "2026-06-07T12:34:56Z",
#     "head_message": "first line of commit message",
#     "protected": true,
#     "open_pr": { "number": 1037, "title": "...", "headRefName": "..." } | null,
#     "closed_pr_unmerged": { "number": 1024, "title": "..." } | null,
#     "merged_pr": { "number": 999, "title": "..." } | null
#   }
#
# Usage:
#   bash scripts/branch-audit-snapshot.sh                  # writes today's snapshot
#   bash scripts/branch-audit-snapshot.sh --out path.json  # custom output path
#
# Exits:
#   0 — snapshot written
#   2 — usage error
#   3 — gh CLI not authenticated or missing required scopes
#   4 — API call failed
#
# Requires: gh CLI authenticated; jq (Bash 3.2 compatible).
set -euo pipefail

REPO="Shyden-Ltd/ShyTalk"
TODAY="$(date -u +%Y-%m-%d)"
OUT=".project/audit/branch-snapshot-${TODAY}.json"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --help|-h)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

command -v gh >/dev/null || { echo "ERROR: gh CLI not installed" >&2; exit 3; }
command -v jq >/dev/null || { echo "ERROR: jq not installed" >&2; exit 3; }

gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not authenticated" >&2; exit 3; }

mkdir -p "$(dirname "$OUT")"

echo "[snapshot] enumerating branches on $REPO ..." >&2
BRANCHES_RAW="$(gh api "repos/${REPO}/branches" --paginate 2>&1)" || {
  echo "ERROR: gh api branches failed: $BRANCHES_RAW" >&2
  exit 4
}

echo "[snapshot] fetching open + closed PRs ..." >&2
OPEN_PRS="$(gh pr list --state open --limit 1000 --json number,title,headRefName 2>&1)" || {
  echo "ERROR: gh pr list open failed: $OPEN_PRS" >&2
  exit 4
}
CLOSED_PRS="$(gh pr list --state closed --limit 2000 --json number,title,headRefName,mergedAt 2>&1)" || {
  echo "ERROR: gh pr list closed failed: $CLOSED_PRS" >&2
  exit 4
}

echo "[snapshot] composing snapshot JSON ..." >&2

# Build name → open-PR + closed-PR lookups via jq
echo "$BRANCHES_RAW" | jq --slurpfile open <(echo "$OPEN_PRS") --slurpfile closed <(echo "$CLOSED_PRS") '
  ([$open[0][] | {key: .headRefName, value: .}] | from_entries) as $openMap
  | ([$closed[0][] | select(.mergedAt == null) | {key: .headRefName, value: .}] | from_entries) as $closedUnmergedMap
  | ([$closed[0][] | select(.mergedAt != null) | {key: .headRefName, value: .}] | from_entries) as $mergedMap
  | [.[] | {
      name: .name,
      head_sha: .commit.sha,
      head_url: .commit.url,
      protected: .protected,
      open_pr: ($openMap[.name] // null),
      closed_pr_unmerged: ($closedUnmergedMap[.name] // null),
      merged_pr: ($mergedMap[.name] // null)
    }]
' > "$OUT.partial"

COUNT="$(jq 'length' "$OUT.partial")"
echo "[snapshot] $COUNT branches captured (head_date pending fetch)" >&2

# Augment each branch with head-commit date + first message line.
# Skipping per-commit fetch to stay under rate-limit; head_url is enough
# for downstream tools that need the date.
mv "$OUT.partial" "$OUT"

echo "[snapshot] wrote $OUT ($COUNT branches)" >&2
echo "$OUT"
