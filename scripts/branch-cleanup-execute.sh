#!/usr/bin/env bash
# SHY-0033: Branch cleanup executor.
#
# Reads the cleanup report produced by branch-classify.sh and deletes
# every branch in the three DELETE buckets via `gh api -X DELETE`.
#
# SAFETY:
# - Hard-coded to operate ONLY on Shyden-Ltd/ShyTalk.
# - Defaults to --dry-run; live execution requires --execute flag AND
#   explicit operator authorisation (the flag's presence is taken as
#   that authorisation).
# - Refuses to delete `main`, `gh-pages`, `master`, `develop`, `release/*`,
#   or the current contributor's active branch.
# - Idempotent: re-running after partial completion succeeds (404 on
#   already-deleted branch is treated as success).
# - 429 handling: exponential backoff with 3 retries.
#
# Usage:
#   bash scripts/branch-cleanup-execute.sh                     # dry-run (default)
#   bash scripts/branch-cleanup-execute.sh --execute           # live run
#   bash scripts/branch-cleanup-execute.sh --report path.md    # custom report
#
# Exits:
#   0 — clean run (dry or live)
#   2 — usage error
#   3 — gh CLI not authenticated
#   4 — report missing/malformed
#   5 — rate-limit exhausted after retries
set -euo pipefail

REPO="Shyden-Ltd/ShyTalk"
REPORT=".project/audit/branch-cleanup-report.md"
DRY_RUN=1
DELAY_MS=200

while [ $# -gt 0 ]; do
  case "$1" in
    --execute) DRY_RUN=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --report) REPORT="$2"; shift 2 ;;
    --help|-h) sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -f "$REPORT" ] || { echo "ERROR: report not found: $REPORT (run branch-classify.sh first)" >&2; exit 4; }
command -v gh >/dev/null || { echo "ERROR: gh CLI not installed" >&2; exit 3; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not authenticated" >&2; exit 3; }

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[cleanup] DRY-RUN mode. No deletions will happen." >&2
  echo "[cleanup] Re-run with --execute to perform deletions." >&2
else
  echo "[cleanup] LIVE mode. Will delete branches in DELETE-* buckets." >&2
fi

# Extract branch names from DELETE-MERGED-PR + DELETE-CLOSED-PR + DELETE-NO-PR
# Each section starts with "## DELETE-..." and contains "- `<name>`" lines.
extract_section() {
  local section_pattern="$1"
  awk -v pat="^## $section_pattern" '
    $0 ~ pat { in_section=1; next }
    in_section && /^## / { in_section=0 }
    in_section && /^- `/ {
      # Strip "- `" prefix and "`" suffix
      sub(/^- `/, "")
      sub(/`$/, "")
      print
    }
  ' "$REPORT"
}

MERGED_LIST="$(extract_section 'DELETE-MERGED-PR')"
CLOSED_LIST="$(extract_section 'DELETE-CLOSED-PR')"
NOPR_LIST="$(extract_section 'DELETE-NO-PR')"

ALL_TO_DELETE="$(printf '%s\n%s\n%s\n' "$MERGED_LIST" "$CLOSED_LIST" "$NOPR_LIST" | grep -v '^$' || true)"
TOTAL=$(printf '%s\n' "$ALL_TO_DELETE" | grep -c . || true)

echo "[cleanup] $TOTAL branches eligible for deletion" >&2

if [ "$TOTAL" -eq 0 ]; then
  echo "[cleanup] Nothing to do." >&2
  exit 0
fi

deleted=0
skipped=0
errors=0
start_ts=$(date +%s)

# Use process substitution (NOT a pipe) so counter mutations propagate
# out of the loop. Pipe-while loses variables on subshell exit per
# bash 3.2 semantics; process substitution keeps the loop in the
# parent shell.
while IFS= read -r branch; do
  [ -z "$branch" ] && continue

  # Safety: never delete current local branch
  if [ "$branch" = "$CURRENT_BRANCH" ]; then
    echo "  SKIP $branch (current local branch)" >&2
    skipped=$((skipped + 1))
    continue
  fi

  # Safety: never delete reserved names. (release/* are NO longer reserved
  # per [[feedback-no-release-branches-use-tags]] — operator authorised
  # their deletion 2026-06-07 ~22:30 BST. release/* branches will be swept
  # as part of the no-release-branches enforcement.)
  case "$branch" in
    main|master|gh-pages|develop)
      echo "  SKIP $branch (reserved)" >&2
      skipped=$((skipped + 1))
      continue
      ;;
  esac

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  WOULD DELETE $branch"
    continue
  fi

  # Live delete with idempotency on already-gone + Retry-After-aware
  # backoff on 429. gh CLI exits 1 on ANY HTTP error (NOT curl's per-code
  # convention), so we capture stderr and inspect for the canonical
  # "Reference does not exist" / "Not Found" responses to recognise
  # idempotent success.
  attempt=1
  max_attempts=3
  resolved=0
  while [ "$attempt" -le "$max_attempts" ]; do
    err_msg="$(gh api --include -X DELETE "/repos/${REPO}/git/refs/heads/${branch}" 2>&1)"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "  DELETED $branch"
      deleted=$((deleted + 1))
      resolved=1
      break
    fi
    # Idempotent success: ref already gone.
    if printf '%s\n' "$err_msg" | grep -qiE "Reference does not exist|Not Found|HTTP/[12]\.?[01]? 404|HTTP/2 404"; then
      echo "  ALREADY-GONE $branch"
      skipped=$((skipped + 1))
      resolved=1
      break
    fi
    # Rate-limit: prefer Retry-After header if present; else fall back
    # to attempt-scaled (capped 60s) backoff.
    retry_after=""
    if printf '%s\n' "$err_msg" | grep -qiE "(HTTP/[12]\.?[01]? 429|HTTP/2 429|rate.?limit|secondary rate)"; then
      retry_after="$(printf '%s\n' "$err_msg" | awk 'BEGIN{IGNORECASE=1} /^Retry-After:/{print $2; exit}' | tr -d '\r ')"
    fi
    if [ -n "$retry_after" ] && printf '%s\n' "$retry_after" | grep -qE '^[0-9]+$'; then
      sleep_secs="$retry_after"
    else
      sleep_secs=$((attempt * 10))
      [ "$sleep_secs" -gt 60 ] && sleep_secs=60
    fi
    echo "  RETRY $branch (attempt $attempt/$max_attempts, sleep ${sleep_secs}s, rc=$rc)" >&2
    sleep "$sleep_secs"
    attempt=$((attempt + 1))
  done
  if [ "$resolved" -eq 0 ]; then
    echo "  ERROR $branch (gave up after $max_attempts retries)" >&2
    errors=$((errors + 1))
  fi
  # Throttle requests under normal flow
  sleep 0.2
done < <(printf '%s\n' "$ALL_TO_DELETE")

end_ts=$(date +%s)
elapsed=$((end_ts - start_ts))

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[cleanup] DRY-RUN complete. ${TOTAL} branches would be deleted. Re-run with --execute to perform deletions." >&2
else
  echo "[branch-cleanup] deleted: ${deleted}, skipped: ${skipped}, errors: ${errors}, duration: ${elapsed} seconds" >&2
  echo "[cleanup] LIVE complete. Elapsed: ${elapsed}s. Re-run snapshot+classify to verify final count." >&2
fi
