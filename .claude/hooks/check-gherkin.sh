#!/usr/bin/env bash
# check-gherkin.sh — Validates Gherkin feature files for quality standards.
# Used by: lint-staged (pre-commit), CI (lint.yml)
#
# Rules:
#   1. Max 15 steps per scenario
#   2. No empty scenarios (zero steps)
#   3. No duplicate scenario names within a feature file
#
# Usage:
#   bash .claude/hooks/check-gherkin.sh [file1.feature file2.feature ...]
#   If no args, scans app/src/androidTest/assets/features/*.feature

set -euo pipefail

ERRORS=0
MAX_STEPS=15

# Collect files to check
if [ $# -gt 0 ]; then
  FILES=("$@")
else
  FILES=(app/src/androidTest/assets/features/*.feature)
fi

for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue

  # --- Rule 1 & 2: Scenario step count ---
  scenario_name=""
  step_count=0
  line_num=0

  while IFS= read -r line || [ -n "$line" ]; do
    line_num=$((line_num + 1))
    trimmed=$(echo "$line" | sed 's/^[[:space:]]*//')

    # New scenario starts
    if echo "$trimmed" | grep -qE '^(Scenario|Scenario Outline):'; then
      # Check previous scenario
      if [ -n "$scenario_name" ] && [ "$step_count" -eq 0 ]; then
        echo "ERROR: $file: Empty scenario '$scenario_name' has zero steps" >&2
        ERRORS=$((ERRORS + 1))
      fi
      if [ -n "$scenario_name" ] && [ "$step_count" -gt "$MAX_STEPS" ]; then
        echo "ERROR: $file: Scenario '$scenario_name' has $step_count steps (max $MAX_STEPS)" >&2
        ERRORS=$((ERRORS + 1))
      fi
      scenario_name=$(echo "$trimmed" | sed 's/^Scenario\( Outline\)\?: //')
      step_count=0
    fi

    # Count steps
    if echo "$trimmed" | grep -qE '^(Given|When|Then|And|But) '; then
      step_count=$((step_count + 1))
    fi
  done < "$file"

  # Check last scenario in file
  if [ -n "$scenario_name" ] && [ "$step_count" -eq 0 ]; then
    echo "ERROR: $file: Empty scenario '$scenario_name' has zero steps" >&2
    ERRORS=$((ERRORS + 1))
  fi
  if [ -n "$scenario_name" ] && [ "$step_count" -gt "$MAX_STEPS" ]; then
    echo "ERROR: $file: Scenario '$scenario_name' has $step_count steps (max $MAX_STEPS)" >&2
    ERRORS=$((ERRORS + 1))
  fi

  # --- Rule 3: Duplicate scenario names ---
  scenario_names=$(grep -E '^\s*(Scenario|Scenario Outline):' "$file" | sed 's/^[[:space:]]*//' | sed 's/^Scenario\( Outline\)\?: //' | sort)
  duplicates=$(echo "$scenario_names" | uniq -d)
  if [ -n "$duplicates" ]; then
    while IFS= read -r dup; do
      [ -z "$dup" ] && continue
      echo "ERROR: $file: Duplicate scenario name '$dup'" >&2
      ERRORS=$((ERRORS + 1))
    done <<< "$duplicates"
  fi

done

if [ "$ERRORS" -gt 0 ]; then
  echo "" >&2
  echo "Gherkin quality check: $ERRORS error(s) found." >&2
  exit 1
fi

echo "Gherkin quality check: all files passed."
exit 0
