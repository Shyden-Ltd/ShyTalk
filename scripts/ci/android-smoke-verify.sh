#!/usr/bin/env bash
#
# Android boot smoke verification (SHY-0084).
#
# Installs the prod debug APK on an already-booted emulator, launches
# MainActivity, asserts the app is the foreground activity, and checks logcat
# for fatal crashes. Exits non-zero (failing the prod-deploy smoke) on any
# genuine problem; never masks a real failure.
#
# WHY THIS IS A COMMITTED FILE, NOT AN INLINE `script:`:
# reactivecircus/android-emulator-runner runs its `script` input via
# /usr/bin/sh (dash on Ubuntu runners). The previous inline block opened with
# `set -euo pipefail` plus `shopt -s nullglob` and bash arrays — all bash-only.
# Under dash the very first line aborted with
#   /usr/bin/sh: 1: set: Illegal option -o pipefail
# so the smoke FAILED before installing anything (prod run 27286731472,
# 2026-06-10: "Emulator booted." then immediate exit code 2). Invoking this
# file with `bash` guarantees a bash interpreter, and keeping the logic in a
# file makes it unit-testable (tests/scripts/android-smoke-verify.test.js
# drives it against a stubbed adb).
#
# Env knobs (all defaulted; the workflow uses the defaults, the tests override):
#   APK_DIR               dir holding exactly one *.apk        (default debug-apk)
#   APP_ID                package id                            (default com.shyden.shytalk)
#   MAIN_ACTIVITY         launch activity                      (default $APP_ID.MainActivity)
#   LOGCAT_FILE           where the AndroidRuntime dump lands   (default /tmp/runtime.log)
#   SMOKE_LAUNCH_WAIT     seconds to settle after am start      (default 3)
#   SMOKE_FOREGROUND_WAIT seconds to settle before logcat check (default 5)
set -euo pipefail

# Anchor to the workspace so the lookup does not depend on the action's cwd
# (the download-artifact step writes the APK to $GITHUB_WORKSPACE/debug-apk).
# `ADB` is configurable (not PATH-resolved) so the unit test points it at a
# stub binary by absolute path — mirrors the sync script's `$GH` pattern and
# avoids manipulating PATH with a writable dir (sonarjs/no-os-command-from-path).
ADB="${ADB:-adb}"
APK_DIR="${APK_DIR:-${GITHUB_WORKSPACE:-.}/debug-apk}"
APP_ID="${APP_ID:-com.shyden.shytalk}"
MAIN_ACTIVITY="${MAIN_ACTIVITY:-${APP_ID}.MainActivity}"
LOGCAT_FILE="${LOGCAT_FILE:-/tmp/runtime.log}"
SMOKE_LAUNCH_WAIT="${SMOKE_LAUNCH_WAIT:-3}"
SMOKE_FOREGROUND_WAIT="${SMOKE_FOREGROUND_WAIT:-5}"

echo "=== Installing APK ==="
# Collect *.apk without relying on `shopt -s nullglob`: a non-matching glob
# stays literal, so guard each candidate with an existence test.
apk=""
count=0
for f in "${APK_DIR}"/*.apk; do
  [ -e "$f" ] || continue
  apk="$f"
  count=$((count + 1))
done
if [ "$count" -ne 1 ]; then
  echo "::error::Expected exactly one debug APK in ${APK_DIR}, found ${count}"
  exit 1
fi
"$ADB" install -r "$apk"

echo "=== Launching app ==="
am_output="$("$ADB" shell am start -W -n "${APP_ID}/${MAIN_ACTIVITY}" 2>&1)"
echo "$am_output"
# Match only REAL failures. The benign messages
#   "Activity not started, its current task has been brought to the front"
#   "Activity not started, intent has been delivered to currently running top-most instance"
# are normal `am start` output when re-launching. Match the "unable to"
# variant or explicit Error type / Java exception lines.
# `^[Ee]rror` also catches adb-transport failures ("error: device offline",
# "error: no devices/emulators found") surfaced via 2>&1, not just `am`'s
# "Error type N".
if printf '%s\n' "$am_output" | grep -qE '^[Ee]rror|FATAL|Activity not started, unable to|java\.lang\.|Exception type'; then
  echo "::error::am start reported an error — app failed to launch"
  exit 1
fi
sleep "$SMOKE_LAUNCH_WAIT"

echo "=== Verifying app is foreground activity ==="
focused="$("$ADB" shell dumpsys window windows 2>&1 | grep -E 'mCurrentFocus' || true)"
echo "$focused"
if ! printf '%s\n' "$focused" | grep -q "$APP_ID"; then
  echo "::error::ShyTalk is not the foreground activity. Got: $focused"
  exit 1
fi
sleep "$SMOKE_FOREGROUND_WAIT"

echo "=== Checking for fatal crashes in logcat ==="
"$ADB" logcat -d -s AndroidRuntime >"$LOGCAT_FILE" 2>&1
# grep -c prints the count (0 on no match) and exits 1 when 0 — `|| true`
# keeps that "0" under `set -e`; the `${crashes:-0}` guards the impossible
# empty case. (A `|| echo 0` would double the "0" on no-match and break the
# arithmetic test, so keep the `|| true` form.)
crashes="$(grep -c 'FATAL EXCEPTION' "$LOGCAT_FILE" || true)"
if [ "${crashes:-0}" -gt 0 ]; then
  echo "::error::Found ${crashes} fatal crash(es)"
  tail -30 "$LOGCAT_FILE"
  exit 1
fi
echo "No fatal crashes — Android APK installs and launches successfully"
