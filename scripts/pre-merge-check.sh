#!/usr/bin/env bash
#
# pre-merge-check.sh — SHY-0127 Gates 2 + 3 (local, refuse-by-default merge gate).
#
# Run this on the PR branch BEFORE every judgment-merge. It mechanically verifies
# everything verifiable and refuses (non-zero, no OK token) otherwise:
#   Gate 1 (local re-check): the SHY story changed on this branch is In Review.
#   Gate 3 (re-review):      no UNREVIEWED commits since the `Reviewed-up-to: <sha>`
#                           recorded in the story Notes. A commit that touches ONLY
#                           a `.project/stories/SHY-*.md` file is review-neutral
#                           (status flips + marker bumps don't need code re-review).
#   Gate 2 (CI):            every check on <PR#> is green (via `gh pr checks`).
# It then prints the pre-merge checklist (incl. the human-judgment items CI cannot
# verify) and emits `PRE-MERGE-CHECK: OK` only when the mechanical gates all pass.
#
# Usage: scripts/pre-merge-check.sh <PR#> [--skip-ci-check]
# Env:   BASE_REF (default origin/main) — the PR base used to find the story diff.
#
# Read-only. bash 3.2-compatible (macOS) — no mapfile/readarray.
set -uo pipefail

PR="${1:-}"
SKIP_CI=false
[ "${2:-}" = "--skip-ci-check" ] && SKIP_CI=true
BASE_REF="${BASE_REF:-origin/main}"
STORY_RE='^\.project/stories/SHY-[0-9]{4}-.*\.md$'

fail() {
  echo "REFUSE: $*" >&2
  exit 1
}

[ -n "$PR" ] || fail "usage: pre-merge-check.sh <PR#> [--skip-ci-check]"

STORIES=$(git diff --name-only --diff-filter=ACMR "${BASE_REF}...HEAD" | grep -E "$STORY_RE" || true)
[ -n "$STORIES" ] || fail "no SHY story .md changed on this branch (BASE_REF=$BASE_REF) — nothing to gate"

REVIEWED_SHA=""
while IFS= read -r story; do
  [ -z "$story" ] && continue
  status=$(grep -m1 '^status:' "$story" | sed 's/^status:[[:space:]]*//' | tr -d '\r')
  [ "$status" = "In Review" ] || fail "$story status is \"$status\" — must be \"In Review\" before merge"
  rs=$(grep -m1 '^Reviewed-up-to:' "$story" | sed 's/^Reviewed-up-to:[[:space:]]*//' | tr -d '\r')
  [ -n "$rs" ] || fail "$story has no 'Reviewed-up-to: <sha>' marker in its Notes — record the reviewed commit then re-run"
  REVIEWED_SHA="$rs"
done <<< "$STORIES"

# Gate 3: a commit after REVIEWED_SHA that touches anything other than a story
# .md is unreviewed. (grep -qvE returns 0 iff a non-story-md path is present.)
UNREVIEWED=0
while IFS= read -r c; do
  [ -z "$c" ] && continue
  if git diff-tree --no-commit-id --name-only -r "$c" | grep -qvE "$STORY_RE"; then
    UNREVIEWED=$((UNREVIEWED + 1))
    echo "  unreviewed commit since last review: $(git log -1 --oneline "$c")" >&2
  fi
done < <(git rev-list "${REVIEWED_SHA}..HEAD" 2>/dev/null)
[ "$UNREVIEWED" -eq 0 ] || fail "$UNREVIEWED unreviewed commit(s) since Reviewed-up-to ($REVIEWED_SHA) — re-review them + bump the marker"

# Gate 2 (CI): all checks on the PR must be green.
if [ "$SKIP_CI" = "false" ]; then
  gh pr checks "$PR" >/dev/null 2>&1 || fail "PR #$PR has failing or pending checks (gh pr checks) — wait for green by name"
fi

CI_LINE="verified"
[ "$SKIP_CI" = "true" ] && CI_LINE="SKIPPED (--skip-ci-check)"

cat <<EOF
── Pre-merge gate (SHY-0127) ──
  [x] story status = In Review
  [x] no unreviewed commits since last review (Reviewed-up-to: $REVIEWED_SHA)
  [x] CI checks green: $CI_LINE
  Confirm the human-judgment items before merging:
  [ ] Definition of Done met
  [ ] dev-verified on real devices (or N/A with reason)
  [ ] backend change? the FULL app + web + device gauntlet ran
PRE-MERGE-CHECK: OK
EOF
