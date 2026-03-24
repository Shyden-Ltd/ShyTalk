#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

check_local_env() {
  if ! curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo ""
    echo "ERROR: Local environment is not running." >&2
    echo ""
    read -r -p "Start it now? (y/n): " yn
    if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
      echo "Starting local environment in the background..."
      echo "Run 'bash local/start.sh' in a separate terminal, then re-run this script."
    fi
    exit 1
  fi
}

echo ""
echo "========================================================"
echo "  ShyTalk Test Runner"
echo "========================================================"
echo ""
echo "Which tests would you like to run?"
echo ""
echo "  [1] Unit tests (Kotlin + Express API)"
echo "  [2] Playwright web tests"
echo "  [3] Android E2E tests"
echo "  [4] Linters (ktlint + ESLint)"
echo "  [5] All tests + linters"
echo "  [0] Cancel"
echo ""
read -r -p "Choice: " choice

OVERALL_EXIT=0

case "$choice" in
  1)
    bash "$SCRIPT_DIR/test-unit.sh" || OVERALL_EXIT=$?
    ;;
  2)
    check_local_env
    bash "$SCRIPT_DIR/test-playwright.sh" || OVERALL_EXIT=$?
    ;;
  3)
    check_local_env
    bash "$SCRIPT_DIR/test-e2e.sh" || OVERALL_EXIT=$?
    ;;
  4)
    bash "$SCRIPT_DIR/test-lint.sh" || OVERALL_EXIT=$?
    ;;
  5)
    check_local_env
    echo ""
    echo "==> Running all tests + linters..."
    echo ""

    # 1. Lint
    echo "--- [1/4] Linters ---"
    if ! bash "$SCRIPT_DIR/test-lint.sh"; then
      OVERALL_EXIT=1
      echo ""
      echo "Linters failed. Stopping."
      echo ""
      echo "========================================================"
      echo "  Overall: FAILED (linters)"
      echo "========================================================"
      exit "$OVERALL_EXIT"
    fi

    echo ""

    # 2. Unit tests
    echo "--- [2/4] Unit Tests ---"
    if ! bash "$SCRIPT_DIR/test-unit.sh"; then
      OVERALL_EXIT=1
      echo ""
      echo "Unit tests failed. Stopping."
      echo ""
      echo "========================================================"
      echo "  Overall: FAILED (unit tests)"
      echo "========================================================"
      exit "$OVERALL_EXIT"
    fi

    echo ""

    # 3. Playwright
    echo "--- [3/4] Playwright Web Tests ---"
    if ! bash "$SCRIPT_DIR/test-playwright.sh"; then
      OVERALL_EXIT=1
      echo ""
      echo "Playwright tests failed. Stopping."
      echo ""
      echo "========================================================"
      echo "  Overall: FAILED (Playwright)"
      echo "========================================================"
      exit "$OVERALL_EXIT"
    fi

    echo ""

    # 4. E2E
    echo "--- [4/4] Android E2E Tests ---"
    if ! bash "$SCRIPT_DIR/test-e2e.sh"; then
      OVERALL_EXIT=1
      echo ""
      echo "E2E tests failed. Stopping."
      echo ""
      echo "========================================================"
      echo "  Overall: FAILED (E2E)"
      echo "========================================================"
      exit "$OVERALL_EXIT"
    fi

    echo ""
    echo "========================================================"
    echo "  Overall: ALL PASSED"
    echo "========================================================"
    ;;
  0)
    echo "Cancelled."
    exit 0
    ;;
  *)
    echo "Invalid choice: $choice" >&2
    exit 1
    ;;
esac

exit "$OVERALL_EXIT"
