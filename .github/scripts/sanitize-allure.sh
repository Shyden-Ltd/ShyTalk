#!/usr/bin/env bash
set -euo pipefail

# sanitize-allure.sh — Strip sensitive data from Allure results before publishing.
# The Allure report is deployed to GitHub Pages (public). This script ensures
# no tokens, API keys, email addresses, or passwords leak into the report.

RESULTS_DIR="${1:-.}"

echo "Sanitizing Allure results in $RESULTS_DIR..."

# Patterns to strip
JWT_PATTERN='eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
FIREBASE_KEY_PATTERN='AIza[A-Za-z0-9_-]{35}'
EMAIL_PATTERN='[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
LONG_TOKEN_PATTERN='Bearer [A-Za-z0-9._-]{50,}'

# Strip fill() values that may contain credentials (from allure-playwright detail steps)
FILL_PATTERN='\.fill\("[^"]*"\)'

SANITIZED=0

while IFS= read -r file; do
  CHANGED=false

  # Strip JWTs
  if grep -qE "$JWT_PATTERN" "$file" 2>/dev/null; then
    sed -i -E "s/$JWT_PATTERN/[REDACTED_TOKEN]/g" "$file"
    CHANGED=true
  fi

  # Strip Firebase API keys
  if grep -qE "$FIREBASE_KEY_PATTERN" "$file" 2>/dev/null; then
    sed -i -E "s/$FIREBASE_KEY_PATTERN/[REDACTED_API_KEY]/g" "$file"
    CHANGED=true
  fi

  # Strip Bearer tokens
  if grep -qE "$LONG_TOKEN_PATTERN" "$file" 2>/dev/null; then
    sed -i -E "s/$LONG_TOKEN_PATTERN/Bearer [REDACTED_TOKEN]/g" "$file"
    CHANGED=true
  fi

  # Strip emails in all files (including result JSON — step titles can contain fill() emails)
  if grep -qE "$EMAIL_PATTERN" "$file" 2>/dev/null; then
    sed -i -E "s/$EMAIL_PATTERN/[REDACTED_EMAIL]/g" "$file"
    CHANGED=true
  fi

  # Strip Playwright fill() values that may contain passwords
  if grep -qE "$FILL_PATTERN" "$file" 2>/dev/null; then
    sed -i -E 's/\.fill\("[^"]*"\)/.fill("[REDACTED]")/g' "$file"
    CHANGED=true
  fi

  if [ "$CHANGED" = true ]; then
    SANITIZED=$((SANITIZED + 1))
  fi
done < <(find "$RESULTS_DIR" -type f \( -name "*.json" -o -name "*.txt" -o -name "*.log" -o -name "*.xml" -o -name "*.html" \))

echo "Sanitization complete. $SANITIZED files modified."
