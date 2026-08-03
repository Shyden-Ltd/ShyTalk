#!/usr/bin/env bash
# check-gherkin.sh — Validates Gherkin feature files for quality standards.
# Used by: lint-staged (pre-commit), CI (lint.yml)
#
# Rules:
#   1. Max 6 steps per scenario (operator rule 2026-08-03; was 15)
#   2. Steps run Given -> When -> Then and NEVER backwards (operator rule
#      2026-08-03: "you cannot go WHEN, THEN, WHEN. this is illegal")
#   3. No empty scenarios (zero steps)
#   4. No duplicate scenario names within a file
#
# Rules 1 and 2 push the same way: one action per scenario. A second `When`
# means a second scenario, opened by a `Given` naming the state the first one
# left behind. Never delete assertions to get under the cap — move them to the
# scenario that owns them.
#
# BOTH Gherkin surfaces in this repo are checked, because a rule applied to one
# surface only teaches two contradictory patterns:
#   1. *.feature               — Given/When/Then/And/But lines
#   2. .project/stories/*.md   — the Markdown-native `**Scenario:**` blocks
#                                documented in CLAUDE.md, whose steps are
#                                `- **Given**` / `- **When**` / ... bullets
#
# Usage:
#   bash .claude/hooks/check-gherkin.sh [file1.feature file2.md ...]
#   With no args, scans every *.feature file plus every story .md holding a
#   `**Scenario:` block.

set -euo pipefail

ERRORS=0
MAX_STEPS="${MAX_STEPS:-6}"

if [ $# -gt 0 ]; then
  FILES=("$@")
else
  FILES=()
  while IFS= read -r f; do FILES+=("$f"); done < <(
    find . -name '*.feature' -not -path './node_modules/*' -not -path '*/build/*' | sort
  )
  while IFS= read -r f; do FILES+=("$f"); done < <(
    grep -rl '^\*\*Scenario:' .project/stories 2>/dev/null | sort || true
  )
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "Gherkin quality check: no Gherkin files to check."
  exit 0
fi

# Rules 1-3 in one awk pass over both syntaxes. `And`/`But` inherit the phase
# of the step above them, so only Given/When/Then move the phase marker.
STRUCTURAL="$(
  awk -v max="$MAX_STEPS" '
    function phase(kw) {
      if (kw == "Given") return 1
      if (kw == "When")  return 2
      if (kw == "Then")  return 3
      return 0
    }
    function record(kw,   p) {
      if (!open) return
      steps++
      p = phase(kw)
      if (p == 0) return
      if (p < seen) {
        if (!reported)
          printf "ERROR: %s:%d: Scenario \"%s\" goes backwards (%s after %s) — Given -> When -> Then only\n",
                 file, FNR, title, kw, lastKw
        reported = 1
      } else { seen = p; lastKw = kw }
    }
    function flush() {
      if (open && steps == 0)
        printf "ERROR: %s: Empty scenario \"%s\" has zero steps\n", file, title
      if (open && steps > max)
        printf "ERROR: %s:%d: Scenario \"%s\" has %d steps (max %d)\n", file, line, title, steps, max
      open = 0; steps = 0; seen = 0; reported = 0; lastKw = ""
    }
    FNR == 1 { flush() }
    /^[[:space:]]*(Scenario|Scenario Outline):/ || /^[[:space:]]*\*\*Scenario:/ {
      flush()
      open = 1; file = FILENAME; line = FNR
      title = $0
      sub(/^[[:space:]]*/, "", title)
      sub(/^\*\*/, "", title)
      sub(/^(Scenario|Scenario Outline): /, "", title)
      sub(/\*\*$/, "", title)
      next
    }
    /^[[:space:]]*(Feature|Background|Examples|Rule):/ { flush(); next }
    /^#{1,6} / { flush(); next }
    /^[[:space:]]*(Given|When|Then|And|But) / { kw = $1; record(kw); next }
    /^[[:space:]]*[-*][[:space:]]+\*\*(Given|When|Then|And|But)\*\*/ {
      kw = $0; sub(/^[^*]*\*\*/, "", kw); sub(/\*\*.*$/, "", kw); record(kw)
    }
    END { flush() }
  ' "${FILES[@]}"
)"

if [ -n "$STRUCTURAL" ]; then
  printf '%s\n' "$STRUCTURAL" >&2
  ERRORS=$((ERRORS + $(printf '%s\n' "$STRUCTURAL" | wc -l | tr -d ' ')))
fi

# Rule 4: duplicate scenario names within a single file.
for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue
  duplicates="$(
    grep -E '^[[:space:]]*(Scenario|Scenario Outline):|^\*\*Scenario:' "$file" 2> /dev/null |
      sed 's/^[[:space:]]*//; s/^\*\*//; s/\*\*$//; s/^Scenario\( Outline\)\?: //' |
      sort | uniq -d || true
  )"
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
  echo "Fix by SPLITTING the scenario by behaviour (one action per scenario)," >&2
  echo "or by folding replayed setup into a single declarative Given." >&2
  exit 1
fi

echo "Gherkin quality check: all files passed (${#FILES[@]} scanned, max $MAX_STEPS steps)."
exit 0
