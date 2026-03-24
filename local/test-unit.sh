#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

KOTLIN_PASS=0
EXPRESS_PASS=0
KOTLIN_FAIL=0
EXPRESS_FAIL=0

echo "========================================================"
echo "  ShyTalk Unit Tests"
echo "========================================================"
echo ""

# ---- Kotlin unit tests ----
echo "==> Running Kotlin unit tests..."
if ./gradlew test; then
  KOTLIN_PASS=1
  echo "  Kotlin tests: PASSED"
else
  KOTLIN_FAIL=1
  echo "  Kotlin tests: FAILED"
fi

echo ""

# ---- Express API tests ----
echo "==> Running Express API tests..."
cd "$PROJECT_ROOT/express-api"
if npm test; then
  EXPRESS_PASS=1
  echo "  Express API tests: PASSED"
else
  EXPRESS_FAIL=1
  echo "  Express API tests: FAILED"
fi

cd "$PROJECT_ROOT"

# ---- Summary ----
echo ""
echo "========================================================"
echo "  Unit Test Summary"
echo "========================================================"
if [ "$KOTLIN_PASS" -eq 1 ]; then
  echo "  Kotlin:      PASSED"
else
  echo "  Kotlin:      FAILED"
fi
if [ "$EXPRESS_PASS" -eq 1 ]; then
  echo "  Express API: PASSED"
else
  echo "  Express API: FAILED"
fi
echo "========================================================"

if [ "$KOTLIN_FAIL" -eq 1 ] || [ "$EXPRESS_FAIL" -eq 1 ]; then
  echo ""
  echo "Some tests FAILED."
  exit 1
fi

echo ""
echo "All unit tests PASSED."
exit 0
