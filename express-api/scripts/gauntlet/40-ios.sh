#!/usr/bin/env bash
# 40-ios.sh — iPhone + Appium prep for the gauntlet.
#
# Probes iPhone reachability (usbmuxd + devicectl) and starts the Appium
# server if it isn't already listening on :4723.
#
# ⚠ NEVER re-signs / reinstalls WebDriverAgent here — churning a WORKING
#   signing setup is forbidden. If a run later fails with
#   "Timed out enabling automation mode" (code 65) while automation is
#   already ON, that is the stale-WDA jam; the fix (manual, deliberate):
#     xcrun devicectl device uninstall app --device <UDID> \
#         com.shyden.WebDriverAgentRunner.xctrunner
#     then restart Appium and run with IOS_FORCE_NEW_WDA=true
#   (see memory: reference-ios27-ui-automation-consent-gate)
set -uo pipefail
source "$(dirname "$0")/lib.sh"

APPIUM_LOG="$GAUNTLET_TMP/appium-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$GAUNTLET_TMP"

# --- reachability -----------------------------------------------------------
if command -v idevice_id >/dev/null 2>&1; then
  UDID="$(idevice_id -l 2>/dev/null | head -1)"
  if [ -n "$UDID" ]; then ok "iPhone over usbmuxd: $UDID"; else warn "no iPhone over usbmuxd"; fi
else
  warn "idevice_id unavailable — skipping usbmuxd probe"
fi
if xcrun devicectl list devices 2>/dev/null | grep -qiE 'available|connected'; then
  ok "devicectl sees a device"
else
  warn "devicectl sees no available device (an 'offline' xctrace state is often cosmetic — verify before rebooting anything)"
fi

# --- WDA team id (runner-side env, informational) ----------------------------
if [ -z "${WDA_TEAM_ID:-}" ]; then
  warn "WDA_TEAM_ID not exported (runner needs it for real-iOS cells; canonical value F3XX4PM3MF)"
fi

# --- Appium server ------------------------------------------------------------
if curl -fs -m 2 "http://localhost:${APPIUM_PORT}/status" >/dev/null 2>&1; then
  ok "Appium already listening on :${APPIUM_PORT}"
else
  command -v appium >/dev/null 2>&1 || die "appium CLI not installed (npm i -g appium)"
  log "starting Appium on :${APPIUM_PORT} → $APPIUM_LOG"
  ( nohup appium --port "$APPIUM_PORT" >"$APPIUM_LOG" 2>&1 </dev/null & )
  wait_http "http://localhost:${APPIUM_PORT}/status" 30 "Appium (:${APPIUM_PORT})" \
    || die "Appium did not become ready — see $APPIUM_LOG"
fi

log "iOS prep complete (WDA signing untouched by design)"
