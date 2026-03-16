#!/usr/bin/env bash
set -euo pipefail

# sanitize-allure.sh — Strip sensitive data from Allure results before publishing.
# The Allure report is deployed to GitHub Pages (public). This script ensures
# no tokens, API keys, or email addresses leak into the report.

RESULTS_DIR="${1:-.}"

echo "Sanitizing Allure results in $RESULTS_DIR..."

# Patterns to strip
JWT_PATTERN='eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
FIREBASE_KEY_PATTERN='AIza[A-Za-z0-9_-]{35}'
EMAIL_PATTERN='[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'

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

  # Strip emails in attachment content (not in result JSON — those contain test names)
  BASENAME=$(basename "$file")
  if [[ "$BASENAME" != *"-result.json" ]] && grep -qE "$EMAIL_PATTERN" "$file" 2>/dev/null; then
    sed -i -E "s/$EMAIL_PATTERN/[REDACTED_EMAIL]/g" "$file"
    CHANGED=true
  fi

  if [ "$CHANGED" = true ]; then
    SANITIZED=$((SANITIZED + 1))
  fi
done < <(find "$RESULTS_DIR" -type f \( -name "*.json" -o -name "*.txt" -o -name "*.log" \))

echo "Sanitization complete. $SANITIZED files modified."
