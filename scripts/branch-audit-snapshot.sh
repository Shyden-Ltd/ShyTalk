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
      head_date: null,
      head_message: null,
      protected: .protected,
      open_pr: ($openMap[.name] // null),
      closed_pr_unmerged: ($closedUnmergedMap[.name] // null),
      merged_pr: ($mergedMap[.name] // null)
    }]
' > "$OUT.partial"

COUNT="$(jq 'length' "$OUT.partial")"
echo "[snapshot] $COUNT branches captured" >&2

# NOTE: head_date + head_message are emitted as null in the schema for
# coherence with the documented record shape. Per-commit fetch (one
# `gh api repos/.../commits/<sha>` call per branch) is intentionally
# omitted from this version to stay under the API rate-limit budget.
# Downstream classifiers MUST NOT rely on head_date for staleness
# decisions — use PR association (open_pr / closed_pr_unmerged /
# merged_pr) as the canonical staleness signal. If date-based
# staleness is needed in future, add an opt-in --with-commit-meta flag
# that fetches per-commit data with backoff.
mv "$OUT.partial" "$OUT"

echo "[snapshot] wrote $OUT ($COUNT branches)" >&2
echo "$OUT"
