#!/usr/bin/env bash
# Clear the local test environment's accumulated debris, so the on-device
# journeys are testing the product rather than yesterday's testing.
#
# WHY THIS EXISTS
#
# The local emulator is long-lived and shared. Exploratory device sessions
# leave state behind that no journey created and no journey may delete, and it
# breaks LATER runs in ways whose error messages point at the wrong thing:
#
#   * Support tickets. A persona that accumulates open ones passes the
#     display cap (MAX_OPEN_TICKETS_LISTED = 5), and a journey's freshly
#     seeded ticket is then squeezed out of the list the app shows -- so every
#     step after it is asserting against somebody else's request. Measured on
#     2026-08-23: 344 tickets, 320 open, 117 belonging to one dead test
#     account, five raised by hand against Alice during the SHY-0387 work.
#   * Suspensions. J11 suspends and unsuspends within its own walk, but a
#     suspension left by a hand-driven session persists, and J07 then fails
#     with "Account suspended" on a persona nothing in the run touched.
#
# The journeys are deliberately NOT allowed to clear either: "cleanup touches
# only tickets this journey created". That is right -- a test harness that
# deletes data it did not create is one that can hide a real defect. So the
# housekeeping lives here, out of the journeys, run by a person who means it.
#
# Everything goes through the ADMIN API, never a direct write, so the same
# authorization applies that applies to a real admin.
#
# Usage:
#   bash scripts/dev/reset-local-journey-debris.sh            # report only
#   bash scripts/dev/reset-local-journey-debris.sh --apply    # actually clear
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPLY=0
case "${1:-}" in
  --apply) APPLY=1 ;;
  --help|-h) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
  "") ;;
  *) printf 'unknown argument: %s (try --help)\n' "$1" >&2; exit 2 ;;
esac

# Refuse anywhere but local. The admin endpoints this calls are real ones.
API="${SHYTALK_API_BASE:-http://localhost:3000}"
health="$(curl -fsS -m 5 "$API/api/health" 2>/dev/null || true)"
if [ -z "$health" ]; then
  printf 'no local API at %s — start the stack first\n' "$API" >&2
  exit 2
fi
case "$API" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *) printf 'refusing to run against %s — this script is for the LOCAL stack only\n' "$API" >&2; exit 2 ;;
esac

APPLY="$APPLY" API="$API" node "$REPO_ROOT/scripts/dev/reset-local-journey-debris.js"
