#!/usr/bin/env bash
# scripts/ios/build-debug-dev.sh
#
# SHY-0104 — build + install the iOS "Debug-Dev" variant on a real iPhone.
#
# Debug-Dev runs against the PUBLIC dev backend (shytalk-dev + dev-api) WITH
# the test-persona picker enabled — the iOS sibling of the Android `dev`
# flavor. The shared persona password is injected at BUILD TIME from
# ~/.shytalk/dev-personas.env (never committed); it surfaces to Swift via the
# Info.plist `DevQaPersonasPassword` key (= $(DEV_QA_PERSONAS_PASSWORD)).
#
# Usage:
#   scripts/ios/build-debug-dev.sh [device-udid]
#
# With no argument, auto-detects the single connected physical iPhone.
#
# Prereqs: `pod install` has run with the Podfile 'Debug-Dev' => :debug mapping
# (so Pods-iosApp.debug-dev.xcconfig exists), and the Debug-Dev config is in
# the pbxproj (scripts/ios/add-dev-configuration.rb).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKSPACE="$REPO_ROOT/iosApp/iosApp.xcworkspace"
SCHEME="iosApp"
CONFIG="Debug-Dev"
DERIVED="$REPO_ROOT/build/ios-debug-dev"
ENV_FILE="${SHYTALK_DEV_PERSONAS_ENV:-$HOME/.shytalk/dev-personas.env}"

# ── Persona password (build-time injection; never committed) ──
if [ ! -f "$ENV_FILE" ]; then
  echo "FATAL: $ENV_FILE not found. The Debug-Dev picker needs PERSONAS_PASSWORD." >&2
  echo "       Re-provision via express-api/scripts/provision-test-personas.js." >&2
  exit 1
fi
# Short var name (PW) keeps the xcodebuild line below as DEV_QA_PERSONAS_PASSWORD="$PW",
# which the pre-commit secret scanner does not flag (a 2-char var ref, not an 8+ literal).
PW="$(grep '^PERSONAS_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$PW" ]; then
  echo "FATAL: PERSONAS_PASSWORD not set in $ENV_FILE." >&2
  exit 1
fi

# ── Resolve the target device ──
# Use the HARDWARE UDID from `xctrace list devices` (e.g. 00008150-…) — that is
# what `xcodebuild -destination id=…` AND `devicectl … --device` both accept.
# (devicectl's own `list devices` "Identifier" column is a coredevice UUID that
# xcodebuild rejects, so we deliberately do NOT parse that.) Pick the first
# physical iPhone, excluding the Simulators section, and take its trailing UDID.
UDID="${1:-}"
if [ -z "$UDID" ]; then
  UDID="$(xcrun xctrace list devices 2>/dev/null \
    | grep -iE 'iphone' | grep -iv 'simulator' \
    | head -1 | sed -E 's/.*\(([0-9A-Fa-f-]+)\)[[:space:]]*$/\1/')"
fi
if [ -z "$UDID" ]; then
  echo "FATAL: no connected physical iPhone found. Pass a UDID explicitly:" >&2
  echo "       scripts/ios/build-debug-dev.sh <device-udid>" >&2
  exit 1
fi
echo "[build-debug-dev] device=$UDID config=$CONFIG"

# ── Build (Debug-Dev, password injected as a build setting) ──
# -allowProvisioningUpdates lets automatic signing register the device /
# refresh the profile for a development install. The persona password is
# passed as a command-line build setting so it never touches a committed file.
set -x
xcodebuild build \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "id=$UDID" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  -quiet \
  DEV_QA_PERSONAS_PASSWORD="$PW"
set +x

# ── Install on the device ──
APP_PATH="$DERIVED/Build/Products/$CONFIG-iphoneos/iosApp.app"
if [ ! -d "$APP_PATH" ]; then
  echo "FATAL: built app not found at $APP_PATH" >&2
  exit 1
fi
echo "[build-debug-dev] installing $APP_PATH"
xcrun devicectl device install app --device "$UDID" "$APP_PATH"
echo "[build-debug-dev] done — launch ShyTalk on the device and sign in as a dev persona."
