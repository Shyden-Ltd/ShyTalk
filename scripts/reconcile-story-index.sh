#!/usr/bin/env bash
# Reconcile .project/stories/SHY-INDEX.md against the story files themselves.
#
# The index is the human-readable backlog, and it drifts: a session that files
# a dozen stories in one sitting updates twelve files and forgets the
# thirteenth. It had fallen SEVENTEEN stories behind by 2026-08-23, which is
# not a thing anybody notices by reading — an index is only ever wrong by
# omission, and omission is invisible.
#
# So it is derived rather than remembered. Every story file's own frontmatter
# is the source of truth for its row; this script reports what is missing and,
# with --apply, inserts it before the "## Done" header where
# convert-roadmap-to-stories.sh puts new rows.
#
# It never edits a row that already exists. Row ORDER inside the Active table
# is operator-curated (see the index's own header), and reordering it would
# throw away signal this script cannot reconstruct.
#
# Usage:
#   scripts/reconcile-story-index.sh              # report only (exit 1 if drifted)
#   scripts/reconcile-story-index.sh --apply      # insert the missing rows
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORY_DIR="$REPO_ROOT/.project/stories"
INDEX_FILE="$STORY_DIR/SHY-INDEX.md"
APPLY=0

case "${1:-}" in
  --apply) APPLY=1 ;;
  --help|-h) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
  "") ;;
  *) printf 'unknown argument: %s (try --help)\n' "$1" >&2; exit 2 ;;
esac

[ -f "$INDEX_FILE" ] || { printf 'index not found: %s\n' "$INDEX_FILE" >&2; exit 2; }

# Frontmatter field for one story file. Empty when absent, so a malformed
# story is reported rather than silently given a blank row.
field() {
  awk -v key="$2" '
    /^---$/ { fm++; next }
    fm == 1 && $0 ~ "^" key ":" { sub("^" key ":[ \t]*", ""); print; exit }
  ' "$1"
}

status_icon() {
  case "$1" in
    Draft) printf '📝 Draft' ;;
    "In Progress") printf '🚧 In Progress' ;;
    "In Review") printf '👀 In Review' ;;
    Done) printf '✅ Done' ;;
    Cancelled) printf '❌ Cancelled' ;;
    *) printf '%s' "$1" ;;
  esac
}

missing=0
rows=""
for file in "$STORY_DIR"/SHY-[0-9][0-9][0-9][0-9]-*.md; do
  [ -e "$file" ] || continue
  base="$(basename "$file")"
  # SHY-0430, not SHY: the id is the first TWO hyphen-separated fields, and
  # ${base%%-*} stops at the first hyphen — which made every story look
  # unindexed and reported 91 phantom rows on the first run.
  id="$(printf '%s' "$base" | cut -d- -f1,2)"
  grep -q "(${base})" "$INDEX_FILE" && continue
  grep -q "\[${id}\]" "$INDEX_FILE" && continue

  pri="$(field "$file" priority)"
  eff="$(field "$file" effort)"
  type="$(field "$file" type)"
  st="$(field "$file" status)"
  # The H1 minus the "SHY-NNNN: " prefix — the same title a person reads.
  title="$(awk '/^# /{ sub(/^# /,""); sub(/^SHY-[0-9]{4}: /,""); print; exit }' "$file")"

  if [ -z "$pri" ] || [ -z "$st" ] || [ -z "$title" ]; then
    printf 'MALFORMED %s — priority/status/title missing; fix the story, not the index\n' "$base" >&2
    missing=$((missing + 1))
    continue
  fi

  rows="${rows}| [${id}](${base}) | ${pri} | ${eff} | ${type} | ${title} | $(status_icon "$st") | — |  |
"
  missing=$((missing + 1))
  printf 'MISSING %s  %s  %s\n' "$id" "$pri" "$title"
done

if [ "$missing" -eq 0 ]; then
  printf '✓ SHY-INDEX.md lists every story file.\n'
  exit 0
fi

if [ "$APPLY" -ne 1 ]; then
  printf '\n%d story file(s) are not in SHY-INDEX.md. Re-run with --apply to insert them.\n' "$missing" >&2
  exit 1
fi

tmp="$(mktemp)"
awk -v rows="$rows" 'BEGIN{done=0} /^## Done$/ && !done { printf "%s", rows; print ""; done=1 } {print}' \
  "$INDEX_FILE" >"$tmp"
mv "$tmp" "$INDEX_FILE"
printf '\nInserted %d row(s) into %s.\n' "$missing" "$INDEX_FILE"
