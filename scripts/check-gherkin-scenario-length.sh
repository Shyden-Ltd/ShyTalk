#!/usr/bin/env bash
# scripts/check-gherkin-scenario-length.sh — cap every BDD scenario at 6 steps.
#
# Background: operator rule 2026-08-03 — "your gherkin syntax is not to proper
# industry standards, too many WHEN, THEN etc. maximum should be 6 lines of
# gherkin per scenario. this is a hard rule". A scenario that scripts UI taps
# step-by-step is imperative automation, not living documentation: it breaks
# when a button moves, and a failure no longer names one behaviour.
#
# The fix for an over-length scenario is never to delete assertions — it is to
# SPLIT by behaviour, or to fold replayed setup into one declarative `Given`.
#
# Two Gherkin surfaces exist in this repo and BOTH are checked (consistency —
# a rule applied to one surface only teaches two contradictory patterns):
#   1. *.feature files              — Given/When/Then/And/But lines
#   2. .project/stories/*.md        — the Markdown-native `**Scenario:**` blocks
#                                     documented in CLAUDE.md, whose steps are
#                                     `- **Given**` / `- **When**` / ... bullets
#
# Counting rules: the `Scenario:`/`Scenario Outline:` title, tags, comments,
# blank lines, `Examples:` tables and `Background:` steps are NOT steps. Only
# the scenario's own Given/When/Then/And/But lines count.
#
# Exit codes:
#   0  every scenario is within the cap
#   1  at least one scenario exceeds the cap
#   2  usage error
#
# Usage:
#   scripts/check-gherkin-scenario-length.sh            # whole repo
#   scripts/check-gherkin-scenario-length.sh path...    # specific files
#   MAX_STEPS=8 scripts/check-gherkin-scenario-length.sh

set -euo pipefail

MAX_STEPS="${MAX_STEPS:-6}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--help] [path ...]

Fails if any BDD scenario has more than \$MAX_STEPS (default 6) steps.
With no paths, scans every *.feature file and every .project/stories/*.md
BDD block in the repo, skipping node_modules and build output.
EOF
}

case "${1:-}" in
  --help | -h)
    usage
    exit 0
    ;;
esac

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

ROOT="$(repo_root)"
cd "$ROOT"

FILES=()
if [ "$#" -gt 0 ]; then
  for f in "$@"; do
    [ -f "$f" ] || {
      echo "error: not a file: $f" >&2
      exit 2
    }
    FILES+=("$f")
  done
else
  while IFS= read -r f; do FILES+=("$f"); done < <(
    find . -name '*.feature' -not -path './node_modules/*' -not -path '*/build/*' | sort
  )
  while IFS= read -r f; do FILES+=("$f"); done < <(
    grep -rl '^\*\*Scenario:' .project/stories 2>/dev/null | sort || true
  )
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "check-gherkin-scenario-length: no Gherkin files found — nothing to check" >&2
  exit 0
fi

# One awk pass handles both syntaxes: a scenario opens on `Scenario:` (feature)
# or `**Scenario:` (markdown) and closes on the next scenario, the next
# structural keyword, or a markdown heading.
VIOLATIONS="$(
  awk -v max="$MAX_STEPS" '
    function flush() {
      if (open && steps > max)
        printf "%s:%d: %d steps (max %d) — %s\n", file, line, steps, max, title
      open = 0; steps = 0
    }
    FNR == 1 { flush() }
    /^[[:space:]]*(Scenario|Scenario Outline):/ ||
    /^[[:space:]]*\*\*Scenario:/ {
      flush()
      open = 1; steps = 0; file = FILENAME; line = FNR
      title = $0
      sub(/^[[:space:]]*/, "", title)
      sub(/^\*\*/, "", title)
      next
    }
    /^[[:space:]]*(Feature|Background|Examples|Rule):/ { flush(); next }
    /^#{1,6} / { flush(); next }
    /^[[:space:]]*(Given|When|Then|And|But) / { if (open) steps++ ; next }
    /^[[:space:]]*[-*][[:space:]]+\*\*(Given|When|Then|And|But)\*\*/ { if (open) steps++ }
    END { flush() }
  ' "${FILES[@]}"
)"

if [ -n "$VIOLATIONS" ]; then
  count="$(printf '%s\n' "$VIOLATIONS" | wc -l | tr -d ' ')"
  echo "❌ $count scenario(s) exceed the $MAX_STEPS-step cap:" >&2
  printf '%s\n' "$VIOLATIONS" >&2
  cat >&2 <<EOF

Fix by SPLITTING the scenario by behaviour (one action per scenario) or by
folding replayed setup into a single declarative Given. Do not delete
assertions to get under the cap — move them to the scenario that owns them.
EOF
  exit 1
fi

echo "✅ all scenarios within the $MAX_STEPS-step cap (${#FILES[@]} files scanned)"
