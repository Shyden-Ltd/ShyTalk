#!/usr/bin/env bash
#
# SHY-0275 — build + install the iOS `Debug-Local` app on a real iPhone,
# pointed at THIS machine's LAN address.
#
# Why this exists as a script rather than a documented command:
#
#   An iPhone has no `adb reverse` equivalent, so it can only reach the local
#   stack by the Mac's LAN address — and that address is not stable. It changed
#   three times over the course of SHY-0273 alone (192.168.1.13 → 10.179.17.101
#   → 192.168.1.9). A committed literal is correct for about one evening, and a
#   hand-typed one is correct until you move desks. So it is DETECTED here, the
#   same way `local/start.sh` detects it for LiveKit's NODE_IP — and the two
#   must agree, or the phone reaches the API and not the media.
#
# Usage:
#   bash scripts/dev/ios-local-install.sh                 # detect, build, install
#   LOCAL_HOST=10.0.0.7 bash scripts/dev/ios-local-install.sh   # explicit override
#   SKIP_INSTALL=1 bash scripts/dev/ios-local-install.sh  # build only
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
XCODE="${XCODE_PATH:-/Applications/Xcode-beta.app}"
CONFIG="Debug-Local"

# Same detector as local/start.sh: follow the DEFAULT ROUTE rather than guessing
# en0, which is what makes it correct on a machine with both Wi-Fi and Ethernet up.
detect_lan_ip() {
  local iface
  iface=$(route -n get default 2>/dev/null | awk '/interface: /{print $2; exit}')
  [ -n "$iface" ] && ipconfig getifaddr "$iface" 2>/dev/null && return 0
  for i in en0 en1; do ipconfig getifaddr "$i" 2>/dev/null && return 0; done
}

LOCAL_HOST="${LOCAL_HOST:-$(detect_lan_ip)}"
if [ -z "$LOCAL_HOST" ]; then
  # Fatal, not a warning: unlike Android there is no tunnel to fall back on, so
  # continuing would install an app that silently talks to the phone itself —
  # exactly the failure this story exists to remove.
  echo "ERROR: could not detect a LAN address for this machine." >&2
  echo "       A real iPhone cannot reach 'localhost' — it has no adb reverse." >&2
  echo "       Re-run with LOCAL_HOST=<this machine's LAN IP>." >&2
  exit 1
fi
echo "==> iPhone will reach this machine at $LOCAL_HOST"

# Warn loudly if LiveKit is advertising a DIFFERENT address than the app will
# use for signalling. Both are derived the same way, so a mismatch means the
# stack was started on another network — voice would connect and then die.
if command -v docker >/dev/null 2>&1; then
  NODE_IP=$(docker logs local-livekit-1 2>&1 | sed -n 's/.*"nodeIP": "\([^"]*\)".*/\1/p' | tail -1)
  if [ -n "$NODE_IP" ] && [ "$NODE_IP" != "$LOCAL_HOST" ]; then
    echo "  WARNING: LiveKit is advertising $NODE_IP but the app will use $LOCAL_HOST." >&2
    echo "           Restart the stack (bash local/start.sh) so they agree." >&2
  fi
fi

# Do NOT delete shared/build/xcode-frameworks/**/shared.framework here.
#
# The "Compile Kotlin Framework" phase (:shared:embedAndSignAppleFrameworkForXcode)
# declares its output as the framework copied INSIDE the built .app — not the one
# under shared/build. Deleting the latter therefore removes the module Swift
# imports while leaving Xcode's up-to-date check satisfied, so the phase is
# SKIPPED and the build dies at dependency scanning with
# "Unable to resolve module dependency: 'shared'". Gradle is incremental and
# rebuilds the framework on a Kotlin change by itself.
#
# To genuinely force it, remove the BUILT APP so the phase's declared output is
# missing — that is the lever Xcode actually watches.
# ALWAYS force the "Compile Kotlin Framework" phase to run, by removing the one
# output Xcode checks for it.
#
# That phase does more than build the framework — it also runs
# `syncComposeResourcesForIos`, which copies compose-resources (every locale's
# strings) INTO the app bundle. Xcode skips the phase whenever
# $(TARGET_BUILD_DIR)/$(FRAMEWORKS_FOLDER_PATH)/shared.framework already exists,
# so an incremental build silently ships a bundle with no string resources and
# the app launches, then crashes on the first screen with
# `MissingResourceException: … strings.commonMain.cvr`. Observed exactly that.
#
# Gradle is incremental, so re-running the phase costs little when nothing
# changed — far less than shipping a bundle that crashes on launch.
rm -rf "$REPO_ROOT/iosApp/build/dd/Build/Products/$CONFIG-iphoneos/iosApp.app/Frameworks/shared.framework"

# Make sure the KMP framework EXISTS before xcodebuild plans the Swift compile.
#
# The in-project "Compile Kotlin Framework" phase runs
# `:shared:embedAndSignAppleFrameworkForXcode`, but it cannot BOOTSTRAP: Swift
# resolves `import shared` against shared/build/xcode-frameworks/<config>/<sdk>,
# whereas that phase declares its output as the copy inside the built .app. With
# the staging directory empty, Swift's dependency scan is planned first and the
# build dies with "Unable to resolve module dependency: 'shared'" before the
# phase that would have fixed it ever runs.
#
# `embedAndSign…` cannot be invoked by hand either — it is only REGISTERED when
# the Kotlin build type resolves, it wants that as a Gradle property (`-P`) while
# taking everything else from Xcode's environment, and it then needs a growing
# set of Xcode variables (PLATFORM_NAME, BUILT_PRODUCTS_DIR, CONTENTS_FOLDER_PATH
# …) that are tedious and brittle to fake. `linkDebugFrameworkIosArm64` needs
# NONE of them, so it is used to stage the framework and xcodebuild's own phase
# then does the real embed + sign with the environment it alone has.
SDK_NAME="iphoneos$(xcrun --sdk iphoneos --show-sdk-version 2>/dev/null)"
STAGE="$REPO_ROOT/shared/build/xcode-frameworks/$CONFIG/$SDK_NAME"
if [ ! -d "$STAGE/shared.framework" ]; then
  echo "==> Staging the Kotlin framework ($CONFIG / $SDK_NAME)"
  (cd "$REPO_ROOT" && ./gradlew :shared:linkDebugFrameworkIosArm64 --max-workers=1)
  mkdir -p "$STAGE"
  cp -R "$REPO_ROOT/shared/build/bin/iosArm64/debugFramework/shared.framework" "$STAGE/"
fi

echo "==> Building $CONFIG (LOCAL_HOST=$LOCAL_HOST)"
cd "$REPO_ROOT/iosApp"
# KOTLIN_FRAMEWORK_BUILD_TYPE is required: Local.xcconfig has no such line
# (Dev.xcconfig does), so without it the KMP plugin cannot map the custom
# configuration name to a Kotlin build type and the build fails.
"$XCODE/Contents/Developer/usr/bin/xcodebuild" \
  -workspace iosApp.xcworkspace -scheme iosApp -configuration "$CONFIG" \
  -destination generic/platform=iOS -derivedDataPath build/dd \
  DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-F3XX4PM3MF}" \
  LOCAL_HOST="$LOCAL_HOST" \
  KOTLIN_FRAMEWORK_BUILD_TYPE=debug build

APP="$REPO_ROOT/iosApp/build/dd/Build/Products/$CONFIG-iphoneos/iosApp.app"

# Never trust exit 0 — confirm the address actually reached the bundle. The
# whole point of this story is that it previously did not, while every command
# reported success.
BAKED=$(plutil -extract ShyTalkLocalHost raw "$APP/Info.plist" 2>/dev/null || echo "")
if [ "$BAKED" != "$LOCAL_HOST" ]; then
  echo "ERROR: Info.plist ShyTalkLocalHost is '$BAKED', expected '$LOCAL_HOST'." >&2
  echo "       The build setting did not reach the bundle — do NOT trust this app." >&2
  exit 1
fi
echo "  Verified: bundle carries ShyTalkLocalHost=$BAKED"

if [ -n "${SKIP_INSTALL:-}" ]; then
  echo "==> SKIP_INSTALL set — built at $APP"
  exit 0
fi

# Match the UUID by SHAPE, not by column. Device names contain spaces
# ("Sean's iPhone"), so positional field-splitting silently yields the wrong
# token — it produced the literal string "iPhone" and devicectl then failed on
# a device named after a word.
DEVICE="${IOS_DEVICE_ID:-$(xcrun devicectl list devices 2>/dev/null \
  | grep -E 'physical' | grep -iE '(available|connected)' \
  | grep -oE '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}' \
  | head -1)}"
if [ -z "$DEVICE" ]; then
  echo "ERROR: no physical iPhone visible to devicectl." >&2
  echo "       Connect over USB, or pass IOS_DEVICE_ID=<identifier>." >&2
  exit 1
fi

echo "==> Installing on $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "==> Done. Launch with:"
echo "    xcrun devicectl device process launch --console --device $DEVICE com.shyden.shytalk"
