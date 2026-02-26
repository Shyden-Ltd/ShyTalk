#!/usr/bin/env bash
# E2E Test Matrix RETRY — re-runs AVDs that failed/skipped in the initial run
# Usage: bash scripts/run_e2e_retry.sh

set -uo pipefail

EMULATOR="/c/Users/saste/AppData/Local/Android/Sdk/emulator/emulator.exe"
ADB="/c/Users/saste/AppData/Local/Android/Sdk/platform-tools/adb.exe"
PROJECT_DIR="/c/Users/saste/AndroidStudioProjects/ShyTalk"
RESULTS_DIR="$PROJECT_DIR/e2e_results"
SUMMARY_FILE="$RESULTS_DIR/retry_summary.txt"

mkdir -p "$RESULTS_DIR"

# AVDs that need retrying (1-21 failed due to AS interference + 41 skipped boot)
AVDS=(
  Small_Phone_API_28 Medium_Phone_API_28 Large_Phone_API_28 Small_Tablet_API_28 Medium_Tablet_API_28 Large_Tablet_API_28
  Small_Phone_API_29 Medium_Phone_API_29 Large_Phone_API_29 Small_Tablet_API_29 Medium_Tablet_API_29 Large_Tablet_API_29
  Small_Phone_API_30 Medium_Phone_API_30 Large_Phone_API_30 Small_Tablet_API_30 Medium_Tablet_API_30 Large_Tablet_API_30
  Small_Phone_API_31 Medium_Phone_API_31 Large_Phone_API_31
  Medium_Tablet_API_35
)

TOTAL=${#AVDS[@]}
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

kill_all_emulators() {
  for port in 5554 5556 5558 5560; do
    "$ADB" -s "emulator-$port" emu kill 2>/dev/null || true
  done
  sleep 2
  taskkill //F //IM qemu-system-x86_64.exe 2>/dev/null || true
  taskkill //F //IM "qemu-system-x86_64-headless.exe" 2>/dev/null || true
  sleep 3
  "$ADB" kill-server 2>/dev/null || true
  sleep 2
  "$ADB" start-server 2>/dev/null || true
  sleep 2
}

wait_for_boot() {
  local timeout=$1
  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    local status
    status=$("$ADB" -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo "")
    if [ "$status" = "1" ]; then
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
  return 1
}

echo "============================================" | tee "$SUMMARY_FILE"
echo "  E2E Test Matrix RETRY — $(date)" | tee -a "$SUMMARY_FILE"
echo "  Total AVDs: $TOTAL" | tee -a "$SUMMARY_FILE"
echo "============================================" | tee -a "$SUMMARY_FILE"
echo "" | tee -a "$SUMMARY_FILE"

for i in "${!AVDS[@]}"; do
  AVD="${AVDS[$i]}"
  IDX=$((i + 1))
  LOG_FILE="$RESULTS_DIR/${AVD}.log"

  echo "[$IDX/$TOTAL] === $AVD ===" | tee -a "$SUMMARY_FILE"

  # Step 1: Kill all emulators and restart adb
  kill_all_emulators
  "$ADB" kill-server 2>/dev/null || true
  sleep 2
  "$ADB" start-server 2>/dev/null || true
  sleep 2

  # Step 2: Clean test results
  rm -rf "$PROJECT_DIR/app/build/outputs/androidTest-results" \
         "$PROJECT_DIR/app/build/reports/androidTests" \
         "$PROJECT_DIR/app/build/outputs/connected_android_test_additional_output"
  rm -rf "$PROJECT_DIR/.gradle/configuration-cache" 2>/dev/null || true
  find "$PROJECT_DIR/app/build" -name "*.lck" -delete 2>/dev/null || true

  cd "$PROJECT_DIR"

  # Step 3: Boot emulator
  echo "  Booting..." | tee -a "$SUMMARY_FILE"
  "$EMULATOR" -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect > /dev/null 2>&1 &
  EMU_PID=$!

  # Wait for boot (max 120 seconds)
  if wait_for_boot 120; then
    sleep 10
    "$ADB" -s emulator-5554 shell input keyevent 82 2>/dev/null || true
    sleep 2

    echo "  Running tests..." | tee -a "$SUMMARY_FILE"

    rm -rf "$PROJECT_DIR/app/build/outputs/connected_android_test_additional_output" 2>/dev/null || true
    if ./gradlew connectedDebugAndroidTest > "$LOG_FILE" 2>&1; then
      LAST_RESULT="PASS"
      echo "  PASS" | tee -a "$SUMMARY_FILE"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      if grep -q "Test run failed to complete" "$LOG_FILE" 2>/dev/null; then
        RAN=$(grep -oP 'Expected \d+ tests, received \K\d+' "$LOG_FILE" 2>/dev/null | tail -1 || echo "0")
        echo "  CRASH (emulator died, $RAN tests ran)" | tee -a "$SUMMARY_FILE"
        LAST_RESULT="CRASH"
        FAIL_COUNT=$((FAIL_COUNT + 1))
      else
        XML_FILE=$(ls "$PROJECT_DIR/app/build/outputs/androidTest-results/connected/debug/TEST-"*.xml 2>/dev/null | head -1)
        if [ -n "$XML_FILE" ]; then
          TESTS=$(grep -oP 'tests="\K\d+' "$XML_FILE" 2>/dev/null | head -1 || echo "?")
          FAILURES=$(grep -oP 'failures="\K\d+' "$XML_FILE" 2>/dev/null | head -1 || echo "?")
          echo "  FAIL ($FAILURES/$TESTS failures)" | tee -a "$SUMMARY_FILE"
          grep -oP 'name="\K[^"]+(?=".*<failure)' "$XML_FILE" 2>/dev/null | while read -r name; do
            echo "    - $name" | tee -a "$SUMMARY_FILE"
          done
        else
          echo "  FAIL (no results XML found)" | tee -a "$SUMMARY_FILE"
        fi
        LAST_RESULT="FAIL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
      fi
    fi

    REPORT_SRC="$PROJECT_DIR/app/build/reports/androidTests/connected"
    REPORT_DST="$RESULTS_DIR/reports_${AVD}"
    if [ -d "$REPORT_SRC" ]; then
      rm -rf "$REPORT_DST" 2>/dev/null || true
      cp -r "$REPORT_SRC" "$REPORT_DST" 2>/dev/null || true
    fi
  else
    echo "  SKIP — emulator failed to boot within 120s" | tee -a "$SUMMARY_FILE"
    SKIP_COUNT=$((SKIP_COUNT + 1))
  fi

  kill_all_emulators
  sleep 3

  echo "" | tee -a "$SUMMARY_FILE"
done

echo "============================================" | tee -a "$SUMMARY_FILE"
echo "  RETRY RESULTS SUMMARY" | tee -a "$SUMMARY_FILE"
echo "  Total: $TOTAL | Pass: $PASS_COUNT | Fail: $FAIL_COUNT | Skip: $SKIP_COUNT" | tee -a "$SUMMARY_FILE"
echo "============================================" | tee -a "$SUMMARY_FILE"

echo ""
echo "Full results in: $RESULTS_DIR"
echo "Summary: $SUMMARY_FILE"
