#!/usr/bin/env bash
set -euo pipefail

# Find pre-built APKs (artifact preserves Gradle output directory structure)
echo "Looking for APKs in $GITHUB_WORKSPACE/apks/..."
find "$GITHUB_WORKSPACE/apks/" -name "*.apk" -type f

APP_APK=$(find "$GITHUB_WORKSPACE/apks/" -name "*.apk" -type f ! -name "*androidTest*" | head -1)
TEST_APK=$(find "$GITHUB_WORKSPACE/apks/" -name "*androidTest*.apk" -type f | head -1)

if [ -z "$APP_APK" ] || [ -z "$TEST_APK" ]; then
  echo "::error::APKs not found"
  find "$GITHUB_WORKSPACE/apks/" -type f
  exit 1
fi

echo "Installing app APK: $APP_APK"
adb install -t "$APP_APK"

echo "Installing test APK: $TEST_APK"
adb install -t "$TEST_APK"

# Verify installation
adb shell pm list packages | grep shytalk || echo "::warning::ShyTalk package not found"

# Run Cucumber instrumentation tests
# Note: am instrument does not trigger Allure result generation with Cucumber-Android.
# Allure results require running via Gradle (connectedDevDebugAndroidTest) which
# properly wires up the Allure JUnit4 listener. For now, run via am instrument
# for speed and address Allure in the unified report initiative.
echo "Running E2E tests..."
adb shell am instrument -w \
  com.shyden.shytalk.dev.test/com.shyden.shytalk.ShyTalkTestRunner \
  2>&1 | tee "$GITHUB_WORKSPACE/test-output.log"

echo "Tests complete."
