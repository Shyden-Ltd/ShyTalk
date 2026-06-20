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

# name-status (not name-only): each line is "<code>\t<path>" — or for a rename,
# "<code>\t<old>\t<new>". The change code (A/M/R…) lets us apply the SHY-0131
# added-Draft filing exemption (a brand-new Draft story is a legitimate filing).
STATUS_LINES=$(git diff --name-status --diff-filter=ACMR "${BASE_REF}...HEAD")

# Validate each changed story: status In Review + a REAL Reviewed-up-to commit —
# EXCEPT a newly-ADDED Draft (a spec filing), which is exempt to match the CI gate
# (scripts/check-pr-story-status.js, SHY-0131). The exemption is add-only AND
# Draft-only: a story MODIFIED to Draft, a non-Draft add, or a Done/Cancelled
# story all still refuse (the local gate stays stricter than CI on terminals).
MARKERS=""
FOUND_STORY=false
FILINGS=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  code=${line%%$'\t'*} # first tab-field (e.g. A, M, R100)
  code=${code:0:1}     # leading char (A/M/D/R/C)
  story=${line##*$'\t'} # last tab-field = the path (new path on a rename)
  printf '%s\n' "$story" | grep -qE "$STORY_RE" || continue
  FOUND_STORY=true
  status=$(grep -m1 '^status:' "$story" | sed 's/^status:[[:space:]]*//' | tr -d '\r')
  if [ "$code" = "A" ] && [ "$status" = "Draft" ]; then
    printf '  filing exemption: %s newly-added Draft (SHY-0131 parity)\n' "$story" >&2
    FILINGS=$((FILINGS + 1))
    continue
  fi
  [ "$status" = "In Review" ] || fail "$story status is \"$status\" — must be \"In Review\" before merge"
  rs=$(grep -m1 '^Reviewed-up-to:' "$story" | sed 's/^Reviewed-up-to:[[:space:]]*//' | tr -d '\r')
  [ -n "$rs" ] || fail "$story has no 'Reviewed-up-to: <sha>' marker in its Notes — record the reviewed commit then re-run"
  # A bogus/placeholder SHA must NOT silently pass Gate 3 (rev-list would error
  # out + the loop would see zero commits). Require a real, reachable commit.
  git cat-file -e "${rs}^{commit}" 2>/dev/null ||
    fail "$story Reviewed-up-to: '$rs' is not a valid commit in this repo — record the actual reviewed SHA"
  MARKERS="${MARKERS}${rs}"$'\n'
done <<< "$STATUS_LINES"
[ "$FOUND_STORY" = true ] || fail "no SHY story .md changed on this branch (BASE_REF=$BASE_REF) — nothing to gate"

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
# Honest display when there are no implementation stories (a filing-only PR has
# no markers → nothing to re-review).
if [ -n "$REVIEWED_DISPLAY" ]; then
  REVIEW_NOTE="Reviewed-up-to: $REVIEWED_DISPLAY"
else
  REVIEW_NOTE="filing only — no implementation story to re-review"
fi

STATUS_LINE="each changed story In Review"
[ "$FILINGS" -gt 0 ] && STATUS_LINE="$STATUS_LINE (+ $FILINGS newly-added Draft filing(s) exempt — SHY-0131 parity)"

cat <<EOF
── Pre-merge gate (SHY-0127) ──
  [x] $STATUS_LINE
  [x] no unreviewed commits since last review ($REVIEW_NOTE)
  [x] CI checks green: $CI_LINE
  Confirm the human-judgment items before merging:
  [ ] Definition of Done met
  [ ] dev-verified on real devices (or N/A with reason)
  [ ] backend change? the FULL app + web + device gauntlet ran
PRE-MERGE-CHECK: OK
EOF
