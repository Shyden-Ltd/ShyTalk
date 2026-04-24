#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

KTLINT_PASS=0
ESLINT_PASS=0
KTLINT_FAIL=0
ESLINT_FAIL=0

echo "========================================================"
echo "  ShyTalk Linters"
echo "========================================================"
echo ""

# ---- ktlint ----
echo "==> Running ktlintCheck..."
if ./gradlew ktlintCheck; then
  KTLINT_PASS=1
  echo "  ktlint: PASSED"
else
  KTLINT_FAIL=1
  echo "  ktlint: FAILED"
fi

echo ""

# ---- ESLint ----
echo "==> Running ESLint on Express API..."
cd "$PROJECT_ROOT/express-api"
if npx eslint src/; then
  ESLINT_PASS=1
  echo "  ESLint: PASSED"
else
  ESLINT_FAIL=1
  echo "  ESLint: FAILED"
fi

cd "$PROJECT_ROOT"

# ---- Summary ----
echo ""
echo "========================================================"
echo "  Lint Summary"
echo "========================================================"
if [ "$KTLINT_PASS" -eq 1 ]; then
  echo "  ktlint: PASSED"
else
  echo "  ktlint: FAILED"
fi
if [ "$ESLINT_PASS" -eq 1 ]; then
  echo "  ESLint: PASSED"
else
  echo "  ESLint: FAILED"
fi
echo "========================================================"

if [ "$KTLINT_FAIL" -eq 1 ] || [ "$ESLINT_FAIL" -eq 1 ]; then
  echo ""
  echo "Some linters FAILED."
  exit 1
fi

echo ""
echo "All linters PASSED."
exit 0
