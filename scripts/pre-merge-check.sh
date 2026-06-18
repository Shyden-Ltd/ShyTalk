#!/usr/bin/env bash
#
# pre-merge-check.sh — SHY-0127 Gates 2 + 3 (local, refuse-by-default merge gate).
#
# Run this on the PR branch BEFORE every judgment-merge. It mechanically verifies
# everything verifiable and refuses (non-zero, no OK token) otherwise:
# Steps run in this order (the "Gate N" labels are the story's AC numbering):
#   1. (Gate 1) the SHY story changed on this branch is In Review, with a valid
#      `Reviewed-up-to: <sha>` marker in its Notes.
#   2. (Gate 3) no UNREVIEWED commits since that marker — a commit touching ONLY a
#      `.project/stories/SHY-*.md` file is review-neutral (status flips + marker
#      bumps don't need code re-review). Every story's marker is checked.
#   3. (Gate 2) every check on <PR#> is green (via `gh pr checks`).
# Only `In Review` passes locally — you don't merge a Done/Cancelled story via a
# normal PR (the CI Gate-1 check separately tolerates Done/Cancelled for incidental
# edits to an already-closed story).
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
# STORY_RE: a SHY story file (has a `status:` to gate on).
STORY_RE='^\.project/stories/SHY-[0-9]{4}-.*\.md$'
# NEUTRAL_RE: a commit touching ONLY story-tracking docs (a SHY story, SHY-INDEX,
# or an EPIC file — all under .project/stories/*.md) is review-neutral for Gate 3:
# status flips, marker bumps + the index row that accompany them aren't code.
NEUTRAL_RE='^\.project/stories/.*\.md$'

fail() {
  echo "REFUSE: $*" >&2
  exit 1
}

[ -n "$PR" ] || fail "usage: pre-merge-check.sh <PR#> [--skip-ci-check]"

STORIES=$(git diff --name-only --diff-filter=ACMR "${BASE_REF}...HEAD" | grep -E "$STORY_RE" || true)
[ -n "$STORIES" ] || fail "no SHY story .md changed on this branch (BASE_REF=$BASE_REF) — nothing to gate"

# Validate each changed story: status In Review + a REAL Reviewed-up-to commit.
MARKERS=""
while IFS= read -r story; do
  [ -z "$story" ] && continue
  status=$(grep -m1 '^status:' "$story" | sed 's/^status:[[:space:]]*//' | tr -d '\r')
  [ "$status" = "In Review" ] || fail "$story status is \"$status\" — must be \"In Review\" before merge"
  rs=$(grep -m1 '^Reviewed-up-to:' "$story" | sed 's/^Reviewed-up-to:[[:space:]]*//' | tr -d '\r')
  [ -n "$rs" ] || fail "$story has no 'Reviewed-up-to: <sha>' marker in its Notes — record the reviewed commit then re-run"
  # A bogus/placeholder SHA must NOT silently pass Gate 3 (rev-list would error
  # out + the loop would see zero commits). Require a real, reachable commit.
  git cat-file -e "${rs}^{commit}" 2>/dev/null ||
    fail "$story Reviewed-up-to: '$rs' is not a valid commit in this repo — record the actual reviewed SHA"
  MARKERS="${MARKERS}${rs}"$'\n'
done <<< "$STORIES"

# Gate 3: for EVERY story's marker, a commit after it that touches anything other
# than a story .md is unreviewed code. Checking every marker keeps multi-story PRs
# honest. (grep -qvE returns 0 iff a non-story-md path is present in the commit.)
UNREVIEWED=0
while IFS= read -r rs; do
  [ -z "$rs" ] && continue
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    if git diff-tree --no-commit-id --name-only -r "$c" | grep -qvE "$NEUTRAL_RE"; then
      UNREVIEWED=$((UNREVIEWED + 1))
      echo "  unreviewed commit since ${rs}: $(git log -1 --oneline "$c")" >&2
    fi
  done < <(git rev-list "${rs}..HEAD")
done <<< "$MARKERS"
[ "$UNREVIEWED" -eq 0 ] || fail "$UNREVIEWED unreviewed commit(s) since a Reviewed-up-to marker — re-review them + bump the marker"

# Gate 2 (CI): all checks on the PR must be green.
if [ "$SKIP_CI" = "false" ]; then
  gh pr checks "$PR" >/dev/null 2>&1 || fail "PR #$PR has failing or pending checks (gh pr checks) — wait for green by name"
fi

CI_LINE="verified"
[ "$SKIP_CI" = "true" ] && CI_LINE="SKIPPED (--skip-ci-check)"
REVIEWED_DISPLAY=$(echo "$MARKERS" | tr '\n' ' ' | sed 's/[[:space:]]*$//')

cat <<EOF
── Pre-merge gate (SHY-0127) ──
  [x] story status = In Review
  [x] no unreviewed commits since last review (Reviewed-up-to: $REVIEWED_DISPLAY)
  [x] CI checks green: $CI_LINE
  Confirm the human-judgment items before merging:
  [ ] Definition of Done met
  [ ] dev-verified on real devices (or N/A with reason)
  [ ] backend change? the FULL app + web + device gauntlet ran
PRE-MERGE-CHECK: OK
EOF
