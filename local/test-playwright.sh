#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

SERVE_PID=""

cleanup() {
  if [ -n "$SERVE_PID" ] && kill -0 "$SERVE_PID" 2>/dev/null; then
    kill "$SERVE_PID" 2>/dev/null || true
    wait "$SERVE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "========================================================"
echo "  ShyTalk Playwright Web Tests"
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

# ---- Start serve for admin panel ----
echo "==> Starting admin panel server (port 8080)..."
npx serve public -l 8080 &
SERVE_PID=$!

# Wait briefly for serve to start
sleep 2

# ---- Run Playwright tests ----
echo "==> Running Playwright tests..."
echo ""

TEST_EXIT=0
WEB_BASE_URL=http://localhost:8080 \
API_BASE_URL=http://localhost:3000 \
TEST_API_KEY=local-test-key \
ADMIN_EMAIL=claude-test@shytalk.dev \
ADMIN_PASSWORD=localdev123 \
ALLURE_ENABLED=true \
ALLURE_PROJECT=local \
npx playwright test "$@" || TEST_EXIT=$?

# ---- Kill serve ----
cleanup
SERVE_PID=""

# ---- Results ----
echo ""
echo "========================================================"
echo "  Playwright Test Results"
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
