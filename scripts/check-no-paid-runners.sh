#!/usr/bin/env bash
# Reject any workflow that references a paid GitHub-hosted runner spec.
#
# Background: PR #370 attempted to upgrade all runners to `*-xlarge` /
# `*-cores` thinking those tiers were free for public repos. They are
# free for ORGANIZATION-owned public repos, not personal-account public
# repos like this one. Result: dozens of CI runs sat in `queued` for
# hours requesting nonexistent runner tiers, blocking the entire pipeline.
# See feedback-larger-runners-paid.md for the lesson.
#
# This guard rejects any commit that re-introduces those specs, so the
# same incident can't recur. Run from project root.

set -euo pipefail

# Patterns that are paid for personal-account public repos. Match in
# `runs-on:` lines (line-anchored to avoid false positives in comments
# that mention these specs as warnings).
#   *-xlarge       → macos-*-xlarge, ubuntu-*-xlarge etc.
#   *-cores        → ubuntu-latest-N-cores etc.
#   large-*        → some Windows large-runner variants
#   *-large        → catches both ubuntu-large-runner and macos-*-large
PAID_RE='runs-on:\s*[\["{]?\s*(\b[a-z0-9.-]+-(xlarge|large|[0-9]+-cores)\b|\blarge-[a-z0-9.-]+\b)'

# Search workflow YAML and composite action YAML.
hits=$(
  grep -rEn --include='*.yml' --include='*.yaml' "$PAID_RE" \
    .github/workflows .github/actions 2>/dev/null \
    | grep -v '^[^:]*:\s*[0-9]\+:\s*#' || true
)

if [ -n "$hits" ]; then
  echo "::error::Paid runner specs detected. Personal-account public repos must use only free-tier runners."
  echo "$hits"
  echo ""
  echo "Allowed: ubuntu-latest, macos-latest, macos-14, macos-15, windows-latest, self-hosted"
  echo "Blocked: *-xlarge, *-cores, *-large, large-*"
  echo ""
  echo "Background: GitHub larger runners are free for ORGANIZATION-owned"
  echo "public repos, not personal-account ones. PR #370 (reverted) tried"
  echo "this and blocked CI for hours with queued runs. See"
  echo "feedback-larger-runners-paid.md for the full incident."
  exit 1
fi

echo "✓ No paid runner specs detected."
