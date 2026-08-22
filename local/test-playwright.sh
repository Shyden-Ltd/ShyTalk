#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "========================================================"
echo "  ShyTalk Playwright Web Tests"
echo "========================================================"
echo ""

# ---- Check local env is running ----
echo "==> Checking local environment..."
if ! curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "ERROR: The local API is not running." >&2
  echo "  Start the stack first: bash local/start.sh" >&2
  exit 1
fi
echo "  API is up."

# ---- Use the stack's OWN web server ----
#
# This script used to start a SECOND static server of its own:
#
#     npx serve public -l 8080
#
# Both halves of that line were wrong.
#
#   * `npx serve` was RETIRED by SHY-0180. It dies ~15 minutes into a heavy
#     Chromium suite -- the npm-exec wrapper takes a SIGINT/SIGTERM and its
#     shutdown path crashes on an EBADF from an in-flight read, turning the
#     tail of the run into mass ERR_CONNECTION_REFUSED phantom failures. It
#     blocked a push three times and killed ~5 runs. `local/serve-web.js`
#     replaced it everywhere -- except here, because the sweep missed one file.
#
#   * Port 8080 is the FIRESTORE EMULATOR. Every other reference to
#     localhost:8080 in this repo is Firestore. So `serve` could not bind and
#     every admin spec ran against the emulator's 404 page, failing in
#     adminLogin looking for a Sign In button on a page that was never the
#     admin panel -- a harness failure that reads exactly like a broken login.
#
# The stack already serves `public/` on 8888 via serve-web.js. Using it means
# one web server, one port, and no question about which one Playwright reached.
echo "==> Checking the web server (port 8888)..."
if ! curl -s -o /dev/null http://localhost:8888/admin/ 2>/dev/null; then
  echo "ERROR: The web server is not running on port 8888." >&2
  echo "  Start the stack first: bash local/start.sh" >&2
  exit 1
fi
echo "  Web server is up."

# ---- Run Playwright tests ----
echo "==> Running Playwright tests..."
echo ""

TEST_EXIT=0
WEB_BASE_URL=http://localhost:8888 \
API_BASE_URL=http://localhost:3000 \
TEST_API_KEY=local-test-key \
ADMIN_EMAIL=claude-test@shytalk.dev \
ADMIN_PASSWORD=localdev123 \
ALLURE_ENABLED=true \
ALLURE_PROJECT=local \
npx playwright test "$@" || TEST_EXIT=$?

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
#
# Only when a human is actually there. With stdin not a TTY -- any wrapper, any
# CI step, any `bash local/test-playwright.sh > log` -- `read` fails, and under
# `set -e` that aborts the script BEFORE `exit "$TEST_EXIT"`. So the run printed
# "Status: PASSED" and then exited 1, which every caller reads as a failed
# suite. A green run reported as red is worse than a red one: it trains people
# to ignore the exit code.
if [ -t 0 ] && [ -d "allure-results" ] && [ "$(ls -A allure-results 2>/dev/null)" ]; then
  echo ""
  read -r -p "View Allure report? (y/n): " yn
  if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
    npx allure serve allure-results
  fi
fi

exit "$TEST_EXIT"
