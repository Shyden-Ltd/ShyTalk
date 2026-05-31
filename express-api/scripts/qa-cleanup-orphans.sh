#!/usr/bin/env bash
# qa-cleanup-orphans.sh — sweep orphaned QA-runner sessions after a
# matrix run. Closes gap G2 from the QA framework tracker.
#
# Long matrix runs accumulate orphan processes on the operator's laptop:
#   - Appium server processes (from --driver mode) that didn't shut down
#   - adb daemons in 'unauthorized'/'offline' state needing restart
#   - Playwright browser temp dirs that leaked
#   - Orphan node processes whose parent matrix died
#
# Usage:
#   ./qa-cleanup-orphans.sh                # report + clean (default)
#   ./qa-cleanup-orphans.sh --dry-run      # report only, no kills
#   ./qa-cleanup-orphans.sh --verbose      # explain each step
#
# Companion to QA_FRAMEWORK_TROUBLESHOOTING.md. Run this when:
#   - matrix invocation hangs / errors out without clean teardown
#   - `--check-drivers` reports unexpected 'fail' on cells that worked yesterday
#   - operator switches between Android-only and iOS-only matrix runs

set -euo pipefail

MODE="clean"
VERBOSE=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --verbose) VERBOSE=true ;;
    --help|-h)
      sed -n '1,18p' "$0" | tail -n +2 | sed 's|^# \?||'
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      echo "Usage: $0 [--dry-run] [--verbose]" >&2
      exit 2
      ;;
  esac
done

vlog() { [ "$VERBOSE" = true ] && echo "  $*" >&2 || true; }

say() { echo "[qa-cleanup] $*"; }

# --- 1. Appium orphans -------------------------------------------------

say "checking Appium processes…"
APPIUM_PIDS=$(pgrep -f "node.*appium" 2>/dev/null || true)
if [ -n "$APPIUM_PIDS" ]; then
  say "  found Appium PIDs: $APPIUM_PIDS"
  if [ "$MODE" = "clean" ]; then
    vlog "killing Appium PIDs"
    # SIGTERM first; processes that ignore it (rare) need SIGKILL fallback
    # after a brief grace window.
    echo "$APPIUM_PIDS" | xargs -r kill 2>/dev/null || true
    sleep 1
    REMAINING=$(pgrep -f "node.*appium" 2>/dev/null || true)
    if [ -n "$REMAINING" ]; then
      vlog "SIGTERM didn't take; SIGKILL fallback for: $REMAINING"
      echo "$REMAINING" | xargs -r kill -9 2>/dev/null || true
    fi
    say "  ✓ Appium killed"
  fi
else
  say "  ✓ no Appium orphans"
fi

# --- 2. adb daemon state ----------------------------------------------

say "checking adb daemon state…"
if command -v adb >/dev/null 2>&1; then
  ADB_DEVICES=$(adb devices 2>/dev/null | tail -n +2 | grep -v '^$' || true)
  if echo "$ADB_DEVICES" | grep -qE "(unauthorized|offline)"; then
    say "  found unauthorized/offline devices — restarting adb"
    if [ "$MODE" = "clean" ]; then
      adb kill-server 2>/dev/null || true
      adb start-server 2>/dev/null || true
      say "  ✓ adb restarted (re-tap the RSA-key dialog on the device if needed)"
    fi
  else
    say "  ✓ adb daemon healthy"
  fi
else
  say "  ✓ adb not installed — skipping"
fi

# --- 3. Orphan adb-forward ports --------------------------------------

if command -v adb >/dev/null 2>&1; then
  say "checking adb forward ports…"
  FORWARDS=$(adb forward --list 2>/dev/null || true)
  if [ -n "$FORWARDS" ]; then
    say "  active forwards:"
    echo "$FORWARDS" | awk '{print "    " $0}'
    if [ "$MODE" = "clean" ]; then
      adb forward --remove-all 2>/dev/null || true
      say "  ✓ all forwards cleared"
    fi
  else
    say "  ✓ no orphan forwards"
  fi
else
  # Operator-friendly: emit a status line even when the toolchain is
  # absent (CI on ubuntu has no adb). Without this, the operator
  # would have no signal that the adb-forward check was skipped vs run.
  # Also pinned by qa-cleanup-orphans-pin.test.js (CI ubuntu has no adb).
  say "checking adb forward ports… (adb not installed — skipping)"
fi

# --- 4. Orphan manual-qa-runner subprocesses --------------------------

say "checking manual-qa-runner orphans…"
RUNNER_PIDS=$(pgrep -f "manual-qa-runner" 2>/dev/null || true)
# Exclude THIS script's own PID (if launched via npm/node ancestry that
# happens to grep-match), plus any cleanup we're currently spawning.
SELF_PID=$$
RUNNER_PIDS=$(echo "$RUNNER_PIDS" | grep -v "^$SELF_PID$" || true)
if [ -n "$RUNNER_PIDS" ]; then
  say "  found runner PIDs: $RUNNER_PIDS"
  if [ "$MODE" = "clean" ]; then
    echo "$RUNNER_PIDS" | xargs -r kill 2>/dev/null || true
    say "  ✓ orphan runners killed"
  fi
else
  say "  ✓ no orphan runners"
fi

# --- 5. Playwright temp dirs ------------------------------------------

# Playwright leaves browser profile dirs in /tmp during long runs.
# Conservative cleanup: only delete dirs older than 1 hour to avoid
# racing an in-flight run.
say "checking Playwright temp dirs…"
PW_TMP=$(find /tmp -maxdepth 2 -type d -name "playwright_*" -mmin +60 2>/dev/null || true)
if [ -n "$PW_TMP" ]; then
  say "  found stale Playwright dirs (>1h old):"
  echo "$PW_TMP" | awk '{print "    " $0}'
  if [ "$MODE" = "clean" ]; then
    echo "$PW_TMP" | xargs -r rm -rf 2>/dev/null || true
    say "  ✓ stale Playwright dirs removed"
  fi
else
  say "  ✓ no stale Playwright dirs"
fi

# --- Summary ----------------------------------------------------------

if [ "$MODE" = "dry-run" ]; then
  say "dry-run complete — no processes killed, no dirs removed"
else
  say "cleanup complete"
fi
