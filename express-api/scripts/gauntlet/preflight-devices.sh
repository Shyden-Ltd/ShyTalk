#!/usr/bin/env bash
# preflight-devices.sh — prove the APPS can actually reach the local stack
# BEFORE a matrix run dispatches a single cell.
#
# Why this exists (2026-07-27): a full matrix was launched against an Android
# app that could not reach the Mac at all, and an iPhone that was never
# engaged. Every cell would have failed for infrastructure reasons and been
# read as product debt. Three faults, none of which the runner noticed:
#
#   1. `adb reverse --list` was EMPTY. The launcher announces
#      "reverse-tunneling ports" but every adb call is `|| true`, so failures
#      are swallowed and nothing re-reads the list afterwards.
#   2. local/start.sh builds `assembleLocalDebug` with NO `-PlocalHost`, and
#      app/build.gradle.kts defaults to `10.0.2.2` — the EMULATOR alias.
#      Emulators were retired 2026-07-15, so the default build targets a device
#      class that no longer exists.
#   3. iOS AppEnvironment.swift hardcoded `http://localhost:3000`, making
#      Local.xcconfig's documented LOCAL_HOST override dead code. On a real
#      iPhone `localhost` is the PHONE.
#
# Design: where a bad state can be made IMPOSSIBLE, do that instead of
# detecting it — this script BUILDS AND INSTALLS both apps with the
# device-correct host rather than trusting whoever ran the build. Everything
# that cannot be forced is asserted and fails LOUDLY. No `|| true`.
#
# Exit: 0 = both apps proven reachable · 1 = a check failed (message names it)
#       2 = usage/env error
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ANDROID_PORTS=(3000 7880 8080 9000 9002 9099 8888)
API_PORT=3000
FAILED=0

log()  { printf '\033[1;34m[preflight]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  PASS\033[0m %s\n' "$*"; }
bad()  { printf '\033[1;31m  FAIL\033[0m %s\n' "$*"; FAILED=1; }

# ── The Mac's LAN IP — the ONLY address a real iPhone can reach the stack on.
mac_lan_ip() {
  local ip
  for iface in en0 en1; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null)" || true
    [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  done
  return 1
}

# ── 0. The stack itself must be answering before either app is judged. ──
log "stack"
if curl -sf -o /dev/null "http://localhost:${API_PORT}/api/health"; then
  ok "Express API answering on localhost:${API_PORT}"
else
  bad "Express API NOT answering on localhost:${API_PORT} — start the stack first"
  exit 1   # everything downstream is meaningless without this
fi

LAN_IP="$(mac_lan_ip)" || { bad "no LAN IP on en0/en1 — a real iPhone cannot reach this Mac"; exit 1; }
if curl -sf -o /dev/null "http://${LAN_IP}:${API_PORT}/api/health"; then
  ok "Express API reachable on LAN IP ${LAN_IP} (iPhone's route)"
else
  bad "API answers on localhost but NOT on ${LAN_IP} — it is bound to loopback only, so no phone can reach it"
fi

# ── 1. Android ─────────────────────────────────────────────────────────────
log "android"
ANDROID_SERIAL="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "$ANDROID_SERIAL" ]; then
  bad "no Android device in state 'device' (USB only since 2026-07-15 — do NOT fall back to an emulator)"
else
  ok "device $ANDROID_SERIAL attached"

  # Build+install with the PHYSICAL-DEVICE host. Not a check — a guarantee:
  # the gradle default is the retired emulator alias, so trusting the caller
  # is exactly how a whole matrix ran against an unreachable app.
  log "  installing localDebug with -PlocalHost=localhost"
  if (cd "$REPO" && ./gradlew installLocalDebug -PlocalHost=localhost --console=plain -q); then
    ok "APK built for a physical device and installed"
  else
    bad "installLocalDebug -PlocalHost=localhost FAILED"
  fi

  # Tunnels: create, then RE-READ. The re-read is the point — creation is what
  # was already being done (and silently failing).
  for p in "${ANDROID_PORTS[@]}"; do
    adb -s "$ANDROID_SERIAL" reverse "tcp:$p" "tcp:$p" >/dev/null 2>&1
  done
  present="$(adb -s "$ANDROID_SERIAL" reverse --list 2>/dev/null)"
  for p in "${ANDROID_PORTS[@]}"; do
    if printf '%s' "$present" | grep -q "tcp:$p tcp:$p"; then
      ok "reverse tunnel tcp:$p"
    else
      bad "reverse tunnel tcp:$p MISSING — the app cannot reach the Mac on that port"
    fi
  done

  # Smoke: the app must actually come up. A package that installs but crashes
  # on launch fails every cell identically and looks like product debt.
  adb -s "$ANDROID_SERIAL" shell am force-stop com.shyden.shytalk.local >/dev/null 2>&1
  adb -s "$ANDROID_SERIAL" shell monkey -p com.shyden.shytalk.local \
    -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  resumed=""
  for _ in $(seq 1 60); do
    resumed="$(adb -s "$ANDROID_SERIAL" shell dumpsys activity activities 2>/dev/null \
      | grep -c 'ResumedActivity.*com.shyden.shytalk.local')"
    [ "${resumed:-0}" -gt 0 ] && break
  done
  if [ "${resumed:-0}" -gt 0 ]; then
    ok "app launched and resumed"
  else
    bad "app did NOT reach a resumed activity — it is crashing or stuck on launch"
  fi
fi

# ── 2. iOS ─────────────────────────────────────────────────────────────────
log "ios"
# Match the UUID by SHAPE, not by column: devicectl pads columns with runs of
# spaces and the model name itself contains spaces ("iPhone Air (iPhone18,4)"),
# so positional awk picked up "iPhone Air" and fed it to -destination id=…,
# which failed the build in a way that read as a toolchain problem.
IOS_UDID="$(xcrun devicectl list devices 2>/dev/null \
  | grep -iE 'iphone|ipad' | grep -iE 'connected|available' \
  | grep -oiE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)"
if [ -z "$IOS_UDID" ]; then
  bad "no iPhone visible to CoreDevice (USB only since 2026-07-15 — the Simulator is RETIRED, there is no fallback)"
else
  ok "iPhone $IOS_UDID reachable"

  # Same guarantee as Android: build with the LAN IP, because the xcconfig
  # default (`localhost`) only ever worked on the retired Simulator.
  log "  building Debug-Local with LOCAL_HOST=$LAN_IP"
  ios_built=0
  if (cd "$REPO" && xcodebuild -workspace iosApp/iosApp.xcworkspace -scheme iosApp \
        -configuration Debug-Local -destination "id=$IOS_UDID" \
        LOCAL_HOST="$LAN_IP" -allowProvisioningUpdates build >/tmp/preflight-ios-build.log 2>&1); then
    ok "Debug-Local built for the device"
    ios_built=1
  else
    bad "Debug-Local build FAILED — see /tmp/preflight-ios-build.log (a Podfile.lock/sandbox mismatch needs 'pod install')"
  fi

  APP="$(find "$HOME/Library/Developer/Xcode/DerivedData" -name 'iosApp.app' \
    -path '*Debug-Local-iphoneos*' -maxdepth 6 2>/dev/null | head -1)"
  if [ "$ios_built" -eq 0 ]; then
    # DerivedData still holds the PREVIOUS build, so reading it here would
    # report a cheerful PASS for an artefact this run did not produce — a
    # check that can pass on stale output is worse than no check.
    bad "skipping the baked-value + install checks: they would read the PREVIOUS build's artefact"
  elif [ -z "$APP" ]; then
    bad "no Debug-Local-iphoneos build product found"
  else
    # Read the value that ACTUALLY shipped. `BUILD SUCCEEDED` says nothing
    # about it: passing a full URL through Info.plist silently truncates to
    # "http:" because plist expansion treats "//" as a comment.
    baked="$(/usr/libexec/PlistBuddy -c 'Print :LOCAL_HOST' "$APP/Info.plist" 2>/dev/null)"
    if [ "$baked" = "$LAN_IP" ]; then
      ok "app baked LOCAL_HOST=$baked"
    else
      bad "app baked LOCAL_HOST='$baked', expected '$LAN_IP' — on a device 'localhost' is the PHONE, so the app would call itself"
    fi
    if xcrun devicectl device install app --device "$IOS_UDID" "$APP" >/dev/null 2>&1; then
      ok "installed on the iPhone"
    else
      bad "install FAILED"
    fi
  fi
fi

echo
if [ "$FAILED" -eq 0 ]; then
  log "READY — both apps are proven to reach the local stack"
  exit 0
fi
log "BLOCKED — do NOT dispatch the matrix; every cell would fail for the reason above"
exit 1
