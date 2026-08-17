#!/usr/bin/env bash
# 00-prereqs.sh — read-only cold-boot audit. Verifies every tool/secret the
# gauntlet needs and reports device connectivity. Changes NOTHING.
#
# Exit 0 = all hard prerequisites present (device warnings allowed).
# Exit 1 = a hard prerequisite is missing; each failure line says which.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

FAILURES=0
need() { # <cmd> <hint>
  if command -v "$1" >/dev/null 2>&1; then ok "$1 ($(command -v "$1"))"; else
    warn "MISSING: $1 — $2"; FAILURES=$((FAILURES + 1)); fi
}

log "ShyTalk gauntlet prerequisites audit"
require_repo
ok "repo $REPO"

# --- hard-required CLI tools -------------------------------------------
need node       "brew install node@24 (machine is pinned to the CI node version)"
need java       "Java 21+ required by the emulators + gradle"
need docker     "Docker Desktop — https://docker.com"
need firebase   "npm i -g firebase-tools"
need adb        "Android platform-tools"
need curl       "should be preinstalled on macOS"
need caffeinate "should be preinstalled on macOS"
need npx        "ships with node"

# node major must match the repo's CI pin (scripts/check-node-version.sh
# is the canonical checker when present).
if [ -x "$REPO/scripts/check-node-version.sh" ]; then
  if (cd "$REPO" && bash scripts/check-node-version.sh >/dev/null 2>&1); then
    ok "node version matches the CI pin"
  else
    warn "node version does NOT match the CI pin (scripts/check-node-version.sh failed)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# --- iOS tooling (warn-only: web/Android cells run without it) ----------
if command -v appium >/dev/null 2>&1; then ok "appium"; else warn "appium missing — iOS device cells unavailable (npm i -g appium)"; fi
if command -v idevice_id >/dev/null 2>&1; then ok "idevice_id"; else warn "libimobiledevice missing — iOS reachability probe degraded"; fi
if xcrun devicectl --version >/dev/null 2>&1; then ok "devicectl"; else warn "xcrun devicectl unavailable — iOS device control degraded"; fi

# --- daemon / service state (report-only; 10-services.sh fixes these) ----
if docker_ready; then ok "Docker daemon running"; else warn "Docker daemon NOT running (10-services.sh will start it)"; fi

# --- secrets -------------------------------------------------------------
for f in "$HOME/.shytalk/dev-personas.env" "$HOME/.shytalk/firebase-admin-dev.json"; do
  if [ -f "$f" ]; then ok "secret present: $f"; else
    warn "MISSING secret: $f (dev-target runs will fail; local-only runs OK for admin json)"
    [ "$f" = "$HOME/.shytalk/dev-personas.env" ] && FAILURES=$((FAILURES + 1))
  fi
done

# --- Playwright browsers -------------------------------------------------
if ls "$HOME/Library/Caches/ms-playwright" >/dev/null 2>&1 \
  && [ -n "$(ls -A "$HOME/Library/Caches/ms-playwright" 2>/dev/null)" ]; then
  ok "Playwright browser cache present"
else
  warn "Playwright browsers not installed — run: (cd $REPO && npx playwright install)"
fi

# --- devices (report-only) -----------------------------------------------
WIRELESS="$(android_serial)"
if [ -n "$WIRELESS" ]; then
  ok "Android wireless device: $WIRELESS"
else
  ANY="$(android_serial_any)"
  if [ -n "$ANY" ]; then
    ok "Android USB device: $ANY (wireless preferred: adb pair + adb connect)"
  else
    UNAUTH="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="unauthorized" {print $1}' | head -1)"
    if [ -n "$UNAUTH" ]; then
      warn "Android device '$UNAUTH' is UNAUTHORIZED — accept the RSA prompt on the phone"
    else
      warn "no Android device visible to adb"
    fi
  fi
fi

if command -v idevice_id >/dev/null 2>&1; then
  IOS_UDID="$(idevice_id -l 2>/dev/null | head -1)"
  if [ -n "$IOS_UDID" ]; then ok "iPhone visible over usbmuxd: $IOS_UDID"; else warn "no iPhone visible over usbmuxd"; fi
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  die "$FAILURES hard prerequisite(s) missing — fix the WARN/MISSING lines above"
fi
log "prerequisites OK (device warnings, if any, are non-fatal)"
