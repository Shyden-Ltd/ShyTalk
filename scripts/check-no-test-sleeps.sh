#!/usr/bin/env bash
# check-no-test-sleeps.sh — SHY-0245 ratchet: no fixed-duration waits, anywhere.
#
# A sleep is a hard-coded guess about how fast someone else's machine is, so it
# is always wrong somewhere: too short and the condition has not happened yet
# (flaky on slow/contended hardware, telling you about the runner rather than
# the product); too long and every run pays the full delay forever. Both are
# silent. Operator ruling 2026-07-25: "there should never be sleeps, that's a
# hard rule... find any other sleeps and eradicate them NEVER use them again."
#
# Wait on the CONDITION instead:
#   Playwright  await expect(locator).toHaveCount(0) / .toBeVisible()
#               expect.poll(...), page.waitForFunction/waitForResponse
#   Jest/node   poll-until-true with a deadline, or await the real promise
#   Kotlin      Turbine awaitItem(), withTimeout { }, Compose waitUntil { }
#   Swift       XCTestExpectation + wait(for:timeout:)
#
# NOT flagged — a timeout OPTION (`{ timeout: 3_000 }`, `waitFor({ timeout })`)
# bounds a failure; it is not the wait. Shell poll intervals
# (`until <cond>; do sleep 0.05; done`) exit the instant the condition holds and
# are correct at any machine speed, so shell is not scanned here.
#
# Usage: check-no-test-sleeps.sh [ROOT]      (default: repo root)
# Exit:  0 = clean (prints the count), 1 = sleeps found, 2 = usage error
set -uo pipefail

case "${1:-}" in
  -h|--help)
    sed -n '2,25p' "${BASH_SOURCE[0]}"
    exit 0
    ;;
esac

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [ ! -d "$ROOT" ]; then
  echo "check-no-test-sleeps: not a directory: $ROOT" >&2
  exit 2
fi

# -I skips binaries: a woff2/png whose bytes happen to contain a banned token
# must never fail the build (see feedback-text-guards-must-skip-binaries).
# This file and its own meta-test quote the banned tokens by necessity.
HITS="$(grep -rnI -E \
  'waitForTimeout\(|Thread\.sleep\(|usleep\(|asyncAfter\(|new Promise\(.*=>[[:space:]]*setTimeout' \
  --include='*.ts' --include='*.js' --include='*.kt' --include='*.swift' \
  --exclude='check-no-test-sleeps*' \
  --exclude-dir=node_modules --exclude-dir=build --exclude-dir=.git \
  --exclude-dir=dist --exclude-dir=test-results --exclude-dir=playwright-report \
  --exclude-dir=allure-results --exclude-dir=.gradle \
  --exclude-dir=Pods --exclude-dir=vendor --exclude-dir=third_party \
  "$ROOT" 2>/dev/null || true)"

COUNT=0
[ -n "$HITS" ] && COUNT="$(printf '%s\n' "$HITS" | grep -c . || true)"

if [ "$COUNT" -eq 0 ]; then
  echo "check-no-test-sleeps: OK — 0 fixed-duration waits found"
  exit 0
fi

echo "check-no-test-sleeps: FAIL — ${COUNT} fixed-duration wait(s) found" >&2
printf '%s\n' "$HITS" | sed "s|^${ROOT}/||" >&2
cat >&2 <<'EOF'

A sleep waits on the clock, not on the thing you care about. Replace each with
a wait on the CONDITION:
  Playwright  await expect(locator).toHaveCount(n) | .toBeVisible()
              expect.poll(...) | page.waitForFunction(...) | waitForResponse(...)
  Jest/node   poll-until-true with a deadline, or await the real promise
  Kotlin      Turbine awaitItem() | withTimeout { } | Compose waitUntil { }
  Swift       XCTestExpectation + wait(for:timeout:)

Asserting ABSENCE? Anchor on a positive settled state first, or the assertion
passes trivially before the thing would ever have appeared.
EOF
exit 1
