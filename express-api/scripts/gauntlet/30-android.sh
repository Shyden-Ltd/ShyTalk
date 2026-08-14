#!/usr/bin/env bash
# 30-android.sh — real-Android device prep for the gauntlet.
#
# Usage: 30-android.sh [--install] [--reset]
#   --install  build + install the LOCAL-flavour APK targeting the laptop
#              (./gradlew installLocalDebug -PlocalHost=localhost)
#   --reset    pm clear the app (Firebase Auth persists across force-stop;
#              only pm clear returns the app to a signed-out state)
#
# Always: picks the wireless (_adb-tls-connect) device first with USB
# fallback, reverse-tunnels every stack port into the device, and wakes /
# keeps-awake the screen (a locked phone makes uiautomator dump return the
# keyguard and sinks the whole matrix).
set -uo pipefail
source "$(dirname "$0")/lib.sh"
require_repo

DO_INSTALL=0 DO_RESET=0
for a in "$@"; do
  case "$a" in
    --install) DO_INSTALL=1 ;;
    --reset)   DO_RESET=1 ;;
    *) die "unknown flag: $a (usage: 30-android.sh [--install] [--reset])" ;;
  esac
done

SERIAL="$(android_serial)"
if [ -n "$SERIAL" ]; then
  ok "wireless Android device: $SERIAL"
else
  SERIAL="$(android_serial_any)"
  if [ -n "$SERIAL" ]; then
    warn "no wireless device — using USB device $SERIAL (wireless preferred)"
  else
    UNAUTH="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="unauthorized" {print $1}' | head -1)"
    [ -n "$UNAUTH" ] && die "device '$UNAUTH' is UNAUTHORIZED — accept the RSA prompt on the phone, then re-run"
    die "no Android device visible to adb (pair wireless: adb pair <ip:port> then adb connect)"
  fi
fi

if [ "$DO_INSTALL" = "1" ]; then
  log "building + installing local-flavour APK on ${SERIAL}…"
  (cd "$REPO" && ANDROID_SERIAL="$SERIAL" ./gradlew installLocalDebug -PlocalHost=localhost) \
    || die "installLocalDebug failed"
  ok "APK installed"
fi

if [ "$DO_RESET" = "1" ]; then
  log "pm clear com.shyden.shytalk.local (reset to signed-out)…"
  OUT="$(adb -s "$SERIAL" shell pm clear com.shyden.shytalk.local 2>&1 | tr -d '\r')"
  echo "$OUT" | grep -q "Success" || die "pm clear did not print Success (got: '$OUT') — retry"
  ok "app data cleared"
fi

# --- reverse tunnels --------------------------------------------------------
# 3000 Express · 7880 LiveKit · 8080 Firestore · 9000 RTDB · 9002 MinIO
# · 9099 Auth · 8888 web. The local app hits the emulators directly, so all
# must be tunnelled (else "Technical Difficulties" in-app).
log "reverse-tunnelling stack ports into ${SERIAL}…"
for p in 3000 7880 8080 9000 9002 9099 8888; do
  adb -s "$SERIAL" reverse "tcp:$p" "tcp:$p" >/dev/null 2>&1 \
    || warn "adb reverse tcp:$p failed"
done
ok "tunnels: $(adb -s "$SERIAL" reverse --list 2>/dev/null | wc -l | tr -d ' ') active"

# --- wake + keep awake ------------------------------------------------------
adb -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb -s "$SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb -s "$SERIAL" shell svc power stayon true >/dev/null 2>&1 || true
ok "device awake + stay-on (a SECURE lock/PIN cannot be dismissed here — disable it for runs)"

log "Android prep complete: $SERIAL"
