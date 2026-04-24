#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "========================================================"
echo "  ShyTalk Android E2E Tests"
echo "========================================================"
echo ""

# ---- Check local env is running ----
echo "==> Checking local environment..."
if ! curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "ERROR: Local environment is not running." >&2
  echo "  Start it first: bash local/start.sh" >&2
  exit 1
fi
echo "  Local environment is running."

# ---- Check adb device ----
echo "==> Checking for connected Android device..."
if ! adb devices 2>/dev/null | grep -q "device$"; then
  echo "ERROR: No Android device connected." >&2
  echo "  Connect a device or start an emulator, then try again." >&2
  exit 1
fi
DEVICE_NAME=$(adb devices -l 2>/dev/null | grep "device " | head -1 | sed 's/.*model:\([^ ]*\).*/\1/' || echo "connected device")
echo "  Device found: $DEVICE_NAME"

# ---- Run E2E tests ----
echo ""
echo "==> Running Android E2E tests..."
echo ""

TEST_EXIT=0
./gradlew connectedLocalDebugAndroidTest || TEST_EXIT=$?

# ---- Results ----
echo ""
echo "========================================================"
echo "  Android E2E Test Results"
echo "========================================================"
if [ "$TEST_EXIT" -eq 0 ]; then
  echo "  Status: PASSED"
else
  echo "  Status: FAILED (exit code $TEST_EXIT)"
fi
echo "========================================================"

# ---- Allure report prompt ----
if [ -d "allure-results" ] && [ "$(ls -A allure-results 2>/dev/null)" ]; then
  echo ""
  read -r -p "View Allure report? (y/n): " yn
  if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
    npx allure serve allure-results
  fi
fi

exit "$TEST_EXIT"
