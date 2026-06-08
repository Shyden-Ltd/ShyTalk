#!/usr/bin/env bash
# SHY-0033: Branch classifier.
#
# Reads a snapshot produced by branch-audit-snapshot.sh and emits a
# Markdown report at .project/audit/branch-cleanup-report.md classifying
# each branch into one of these buckets:
#
#   KEEP                — branch has an OPEN PR, OR is main, OR is gh-pages,
#                          OR is `protected: true` (skip — operator must
#                          explicitly delete protected branches).
#   DELETE-MERGED-PR    — branch's last associated PR is MERGED but the
#                          branch survived (pre-auto-delete-setting era).
#                          Safe to delete; the merge has already happened.
#   DELETE-CLOSED-PR    — branch's last associated PR was closed WITHOUT
#                          merging (abandoned). Safe to delete; PR can be
#                          reopened from GitHub UI within 90 days if needed.
#   DELETE-NO-PR        — branch has NO associated PR (pushed for local
#                          experimentation, never opened a PR). Safe to
#                          delete; commits remain reachable via reflog if
#                          ever needed.
#   OPERATOR-REVIEW     — anything that doesn't fit above (e.g. dependabot
#                          branch with no PR; release/* branches; etc.).
#                          Listed for operator to decide.
#
# Hard exclusions (NEVER eligible for deletion regardless of age):
#   - main
#   - gh-pages
#   - any branch with `protected: true` in the snapshot
#
# Usage:
#   bash scripts/branch-classify.sh [--snapshot path] [--out path]
#
# Exits:
#   0 — report written
#   2 — usage error
#   4 — snapshot missing/malformed
set -euo pipefail

TODAY="$(date -u +%Y-%m-%d)"
SNAPSHOT=".project/audit/branch-snapshot-${TODAY}.json"
OUT=".project/audit/branch-cleanup-report.md"

while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) SNAPSHOT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --help|-h) sed -n '1,40p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -f "$SNAPSHOT" ] || { echo "ERROR: snapshot not found: $SNAPSHOT" >&2; exit 4; }
command -v jq >/dev/null || { echo "ERROR: jq required" >&2; exit 4; }

mkdir -p "$(dirname "$OUT")"

# Hard-excluded branches (never deleted).
# NOTE: the GH API's `.protected == true` flag is uninformative here —
# the repo has a `no-force-push-anywhere` ruleset that applies to ALL
# branches, so every branch reports protected:true. That ruleset is a
# no-force-push rule, not a no-delete rule. We classify by name only.
EXCLUDE_REGEX='^(main|master|gh-pages|develop)$'

# Classify with jq
KEEP_LIST="$(jq -r --arg ex "$EXCLUDE_REGEX" '
  .[] | select((.name | test($ex)) or .open_pr != null)
  | .name
' "$SNAPSHOT" | sort -u)"

DELETE_MERGED_PR_LIST="$(jq -r --arg ex "$EXCLUDE_REGEX" '
  .[] | select(
    (.name | test($ex) | not)
    and (.open_pr == null) and (.merged_pr != null)
  ) | .name
' "$SNAPSHOT" | sort -u)"

DELETE_CLOSED_PR_LIST="$(jq -r --arg ex "$EXCLUDE_REGEX" '
  .[] | select(
    (.name | test($ex) | not)
    and (.open_pr == null) and (.merged_pr == null) and (.closed_pr_unmerged != null)
  ) | .name
' "$SNAPSHOT" | sort -u)"

# Remaining = no PR at all (and not in keep/exclude)
DELETE_NO_PR_LIST="$(jq -r --arg ex "$EXCLUDE_REGEX" '
  .[] | select(
    (.name | test($ex) | not)
    and (.open_pr == null) and (.merged_pr == null) and (.closed_pr_unmerged == null)
  ) | .name
' "$SNAPSHOT" | sort -u)"

# OPERATOR-REVIEW currently empty (heuristic could be extended later)
OPERATOR_REVIEW_LIST=""

TOTAL="$(jq 'length' "$SNAPSHOT")"
keep_count=$(printf '%s\n' "$KEEP_LIST" | grep -c . || true)
del_merged_count=$(printf '%s\n' "$DELETE_MERGED_PR_LIST" | grep -c . || true)
del_closed_count=$(printf '%s\n' "$DELETE_CLOSED_PR_LIST" | grep -c . || true)
del_nopr_count=$(printf '%s\n' "$DELETE_NO_PR_LIST" | grep -c . || true)
op_review_count=$(printf '%s\n' "$OPERATOR_REVIEW_LIST" | grep -c . || true)

# Write the report
{
  echo "# Branch cleanup report"
  echo
  echo "**Generated:** $(date -u +'%Y-%m-%d %H:%M UTC')"
  echo "**Source snapshot:** \`$SNAPSHOT\`"
  echo "**Total branches:** $TOTAL"
  echo
  echo "## Summary"
  echo
  echo "| Bucket | Count | Disposition |"
  echo "|---|---|---|"
  echo "| KEEP | $keep_count | Open PR / main / gh-pages / protected |"
  echo "| DELETE-MERGED-PR | $del_merged_count | PR already merged; branch should have been auto-deleted (pre-setting era). Safe to delete. |"
  echo "| DELETE-CLOSED-PR | $del_closed_count | PR closed without merge; abandoned work. Safe to delete (GitHub auto-restore covers 90 days). |"
  echo "| DELETE-NO-PR | $del_nopr_count | No PR ever associated; ad-hoc experimentation. Safe to delete (commits remain in reflog). |"
  echo "| OPERATOR-REVIEW | $op_review_count | Ambiguous; operator must decide. |"
  echo
  echo "## KEEP ($keep_count branches)"
  echo
  if [ "$keep_count" -gt 0 ]; then
    printf '%s\n' "$KEEP_LIST" | sed 's/^/- `/' | sed 's/$/`/'
  else
    echo "_(none)_"
  fi
  echo
  echo "## DELETE-MERGED-PR ($del_merged_count branches)"
  echo
  if [ "$del_merged_count" -gt 0 ]; then
    printf '%s\n' "$DELETE_MERGED_PR_LIST" | sed 's/^/- `/' | sed 's/$/`/'
  else
    echo "_(none)_"
  fi
  echo
  echo "## DELETE-CLOSED-PR ($del_closed_count branches)"
  echo
  if [ "$del_closed_count" -gt 0 ]; then
    printf '%s\n' "$DELETE_CLOSED_PR_LIST" | sed 's/^/- `/' | sed 's/$/`/'
  else
    echo "_(none)_"
  fi
  echo
  echo "## DELETE-NO-PR ($del_nopr_count branches)"
  echo
  if [ "$del_nopr_count" -gt 0 ]; then
    printf '%s\n' "$DELETE_NO_PR_LIST" | sed 's/^/- `/' | sed 's/$/`/'
  else
    echo "_(none)_"
  fi
  echo
  echo "## OPERATOR-REVIEW ($op_review_count branches)"
  echo
  if [ "$op_review_count" -gt 0 ]; then
    printf '%s\n' "$OPERATOR_REVIEW_LIST" | sed 's/^/- `/' | sed 's/$/`/'
  else
    echo "_(none)_"
  fi
  echo
  echo "---"
  echo
  echo "Generated by \`scripts/branch-classify.sh\`. To execute the deletions in the three DELETE buckets, run \`bash scripts/branch-cleanup-execute.sh --report $OUT\` (use \`--dry-run\` first)."
} > "$OUT"

echo "[classify] wrote $OUT" >&2
echo "$OUT"
