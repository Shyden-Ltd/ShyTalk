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
# Usage: check-no-test-sleeps.sh [ROOT] [--baseline FILE]
#   no --baseline : STRICT — any sleep fails (the end state).
#   --baseline F  : RATCHET — per-file counts in F may only SHRINK, so the
#                   existing debt can be worked down without blocking every PR,
#                   while a NEW sleep still fails immediately. Same model as
#                   scripts/no-stubs-baseline.json (EPIC-0003).
# Exit:  0 = clean / at-or-below baseline, 1 = violation, 2 = usage error
set -uo pipefail

BASELINE=""
WRITE_BASELINE=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    --baseline) BASELINE="${2:-}"; shift 2 || exit 2 ;;
    --write-baseline) WRITE_BASELINE="${2:-}"; shift 2 || exit 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

ROOT="${ARGS[0]:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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
  --exclude='wait-for.js' \
  --exclude-dir=node_modules --exclude-dir=build --exclude-dir=.git \
  --exclude-dir=dist --exclude-dir=test-results --exclude-dir=playwright-report \
  --exclude-dir=allure-results --exclude-dir=.gradle \
  --exclude-dir=Pods --exclude-dir=vendor --exclude-dir=third_party \
  "$ROOT" 2>/dev/null || true)"

COUNT=0
[ -n "$HITS" ] && COUNT="$(printf '%s\n' "$HITS" | grep -c . || true)"

PER_FILE_COUNTS() {
  printf '%s\n' "$HITS" | sed "s|^${ROOT}/||" | cut -d: -f1 | sort | uniq -c | awk '{print $2" "$1}'
}

# ── Baseline authoring — emitted by the SAME scan that checks it ────────────
if [ -n "$WRITE_BASELINE" ]; then
  PER_FILE_COUNTS | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const o = {};
      for (const line of s.split("\n")) {
        const [f, n] = line.trim().split(/\s+/);
        if (f) o[f] = Number(n);
      }
      const sorted = Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
      process.stdout.write(JSON.stringify(sorted, null, 2) + "\n");
    });
  ' > "$WRITE_BASELINE"
  echo "check-no-test-sleeps: wrote baseline ($COUNT across $(PER_FILE_COUNTS | grep -c . || true) files) → $WRITE_BASELINE"
  exit 0
fi

# ── Ratchet mode ────────────────────────────────────────────────────────────
if [ -n "$BASELINE" ]; then
  if [ ! -f "$BASELINE" ]; then
    echo "check-no-test-sleeps: baseline not found: $BASELINE" >&2
    exit 2
  fi
  PER_FILE="$(PER_FILE_COUNTS)"
  VERDICT="$(PER_FILE="$PER_FILE" BASELINE="$BASELINE" node -e '
    const fs = require("node:fs");
    const base = JSON.parse(fs.readFileSync(process.env.BASELINE, "utf8"));
    const cur = {};
    for (const line of (process.env.PER_FILE || "").split("\n")) {
      const [f, n] = line.trim().split(/\s+/);
      if (f) cur[f] = Number(n);
    }
    const grew = [], stale = [];
    for (const [f, n] of Object.entries(cur)) {
      const allowed = base[f] ?? 0;
      if (n > allowed) grew.push(`  ${f}: ${n} > ${allowed} allowed`);
    }
    for (const [f, n] of Object.entries(base)) {
      const now = cur[f] ?? 0;
      if (now < n) stale.push(`  ${f}: ${now} now, baseline says ${n} — lower it`);
    }
    if (grew.length) { console.log("GREW\n" + grew.join("\n")); process.exit(0); }
    if (stale.length) { console.log("STALE\n" + stale.join("\n")); process.exit(0); }
    console.log("OK");
  ')"
  case "$VERDICT" in
    OK*)
      echo "check-no-test-sleeps: OK — ${COUNT} remaining, at or below baseline"
      exit 0
      ;;
    STALE*)
      echo "check-no-test-sleeps: FAIL — debt SHRANK; update the baseline so it cannot regrow" >&2
      printf '%s\n' "$VERDICT" | tail -n +2 >&2
      exit 1
      ;;
    *)
      echo "check-no-test-sleeps: FAIL — NEW fixed-duration wait(s) introduced" >&2
      printf '%s\n' "$VERDICT" | tail -n +2 >&2
      ;;
  esac
elif [ "$COUNT" -eq 0 ]; then
  echo "check-no-test-sleeps: OK — 0 fixed-duration waits found"
  exit 0
else
  echo "check-no-test-sleeps: FAIL — ${COUNT} fixed-duration wait(s) found" >&2
fi
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
