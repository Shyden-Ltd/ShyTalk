#!/usr/bin/env bash
# shellcheck shell=bash
#
# check-epic-frontmatter.sh
#
# Validates EPIC files per SHY-0037 spec at
# .project/stories/SHY-0037-introduce-epics.md (and the "Agile Way of Working
# → EPICs" section in CLAUDE.md).
#
# Usage:
#   check-epic-frontmatter.sh <file>            # validate one file (structural only)
#   check-epic-frontmatter.sh --scan <dir>      # structural + cross-corpus
#   check-epic-frontmatter.sh --help            # print usage + exit codes
#   check-epic-frontmatter.sh --verbose <file>  # print [check] lines to stderr
#
# Per-file vs --scan asymmetry (architect-locked, SHY-0037 AC line 39):
#   - per-file:  frontmatter regex + body sections + id↔filename match (structural only)
#   - --scan:    structural + EPIC ID collision + unknown SHY ref + duplicate child claim
#
# Exit codes (deterministic, machine-parseable):
#   0   success
#   2   usage error (missing arg, unknown flag, --scan target is a file)
#   30  missing required frontmatter field
#   31  invalid frontmatter field value (regex / enum / array form / id↔filename)
#   32  missing required ## body section
#   40  --scan mode: structural failure OR cross-corpus violation (category in stderr:
#         "duplicate epic id", "unknown SHY reference", "duplicate epic claim")
#
# Stderr format on failure (machine-parseable):
#   <absolute-path>: <category-name>: <details>
#
# Bash 3.2-compatible (macOS default) — no `declare -A`, no `${var^^}`.

set -euo pipefail

# ============================================================== constants

VERSION="1.0.0"

# Required frontmatter fields (presence check).
REQ_FIELDS="id status owner created priority title"

# Enums (space-separated; Bash 3.2 has no associative arrays).
# status mirrors SHY lifecycle exactly per SHY-0037 spec Risk #5.
VALID_STATUS="Draft|In Progress|In Review|Done|Cancelled"
VALID_PRIORITY="P0|P1|P2|P3"

# Required `##` body sections per SHY-0037 AC line 38.
REQ_SECTIONS="Vision|Scope|Child SHYs|DoD at Epic Level|Notes"

# Exit codes.
# Cross-corpus violations (unknown SHY ref, duplicate child claim, EPIC ID
# collision) are detectable ONLY in --scan mode. Per SHY-pattern consistency
# they are surfaced as the --scan wrapper code (E_SCAN_FAIL=40) with the
# specific inner cause communicated via the stderr category string ("unknown
# SHY reference", "duplicate epic claim", "duplicate epic id"). This deviates
# from the spec's literal "exits 33" text but honors the consistent --scan
# wrapper contract — callers check `if [ $? -ne 0 ]` and grep stderr for
# specifics, rather than branching on multiple inner exit codes.
E_OK=0
E_USAGE=2
E_MISSING_FIELD=30
E_INVALID_VALUE=31
E_MISSING_SECTION=32
E_SCAN_FAIL=40

VERBOSE=0

# ============================================================== helpers

usage() {
  cat <<EOF
check-epic-frontmatter.sh ${VERSION}

SYNOPSIS
  check-epic-frontmatter.sh [--scan <dir>] | <file>

USAGE
  check-epic-frontmatter.sh [--verbose] <file>
  check-epic-frontmatter.sh [--verbose] --scan <dir>
  check-epic-frontmatter.sh --help

  NOTE: --verbose MUST precede --scan; flag order matters.

FLAGS
  --scan <dir>   Validate every EPIC-NNNN-*.md file in <dir> (sorted; stop-on-first failure).
                 Symlinks are skipped via \`find -P ... ! -type l\`. After per-file structural
                 validation passes, --scan runs cross-corpus checks:
                   - EPIC ID collision (two files with same EPIC-NNNN prefix)
                   - Unknown child SHY reference (child_shys names a SHY not present in dir)
                   - Duplicate child SHY claim (two EPICs both claim the same SHY)
  --verbose      Print [check] lines to stderr for each check the validator runs.
  --help         Print this usage and exit 0.

EXIT CODES
  0   success
  2   usage error (missing arg, unknown flag, --scan target is a file or missing dir)
  30  missing required frontmatter field (id|status|owner|created|priority|title)
  31  invalid frontmatter field value (regex / enum / array form / id↔filename mismatch)
  32  missing required ## body section (Vision|Scope|Child SHYs|DoD at Epic Level|Notes)
  40  --scan mode found a problem — either a structural failure in one of the EPIC files
      OR a cross-corpus violation (EPIC ID collision, unknown child SHY reference, or
      duplicate child claim). Inner category in stderr ("duplicate epic id", "unknown
      SHY reference", "duplicate epic claim").

PER-FILE vs --scan ASYMMETRY
  Per-file mode runs ONLY structural checks (frontmatter regex + body sections + id↔filename).
  --scan mode adds cross-corpus checks against the in-memory index built from all EPIC-* and
  SHY-* files in the directory.

EXAMPLES
  check-epic-frontmatter.sh .project/stories/EPIC-0001-shy-framework.md
  check-epic-frontmatter.sh --scan .project/stories
  check-epic-frontmatter.sh --verbose .project/stories/EPIC-0001-shy-framework.md

SEE ALSO
  CLAUDE.md § "Agile Way of Working" → "### EPICs"
  .project/stories/SHY-0037-introduce-epics.md
EOF
}

verbose() {
  if [ "$VERBOSE" = "1" ]; then
    printf '[check] %s\n' "$1" >&2
  fi
}

# fail <path> <category> <details> <exit-code>
fail() {
  printf '%s: %s: %s\n' "$1" "$2" "$3" >&2
  exit "$4"
}

# Strip CR and UTF-8 BOM from a file. See SHY validator for the rationale on
# why we don't strip trailing whitespace (preserves Markdown hard-line-breaks).
normalize_file() {
  local src="$1"
  local tmp
  tmp="$(mktemp -t epic-frontmatter.XXXXXX)"
  TMP_FILES="${TMP_FILES} ${tmp}"
  LC_ALL=C sed -e '1s/^\xef\xbb\xbf//' "$src" | tr -d '\r' >"$tmp"
  echo "$tmp"
}

# Absolute path of a (possibly relative) input path. Bash 3.2 lacks `realpath`.
abspath() {
  local p="$1"
  if [ -d "$p" ]; then
    ( cd "$p" && pwd )
  else
    local d
    d="$(dirname "$p")"
    ( cd "$d" && printf '%s/%s\n' "$(pwd)" "$(basename "$p")" )
  fi
}

TMP_FILES=""
# shellcheck disable=SC2329
cleanup() {
  # shellcheck disable=SC2086
  rm -f ${TMP_FILES}
}
trap cleanup EXIT INT TERM

# Escape a string for use in a basic-extended regex character class.
# shellcheck disable=SC2016
escape_re() {
  printf '%s' "$1" | sed 's/[.[\*^$(){}+?|]/\\&/g'
}

# ============================================================== validation

check_frontmatter_present() {
  local file="$1" abs="$2"
  if ! head -n 1 "$file" 2>/dev/null | grep -qE '^---[[:space:]]*$'; then
    fail "$abs" "missing" "no frontmatter found" "$E_MISSING_FIELD"
  fi
  if [ "$(grep -cE '^---[[:space:]]*$' "$file")" -lt 2 ]; then
    fail "$abs" "missing" "no frontmatter found" "$E_MISSING_FIELD"
  fi
}

extract_frontmatter() {
  awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; if(n==2) exit; next} n==1{print}' "$1"
}

extract_body() {
  awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n>=2{print}' "$1"
}

check_required_fields() {
  local fm="$1" abs="$2"
  local field
  for field in $REQ_FIELDS; do
    verbose "frontmatter:$field"
    local found=1
    grep -qE "^${field}:" "$fm" || found=0
    if [ "$found" = "0" ]; then
      fail "$abs" "missing field" "missing required frontmatter field: ${field}" "$E_MISSING_FIELD"
    fi
  done
}

check_field_values() {
  local fm="$1" abs="$2"

  verbose "value:id"
  if ! grep -qE '^id:[[:space:]]*EPIC-[0-9]{4}[[:space:]]*$' "$fm"; then
    fail "$abs" "invalid value" "id must match EPIC-NNNN pattern (4-digit zero-padded)" "$E_INVALID_VALUE"
  fi

  verbose "value:status"
  if ! grep -qE "^status:[[:space:]]*(${VALID_STATUS})[[:space:]]*\$" "$fm"; then
    fail "$abs" "invalid value" "status must be one of: ${VALID_STATUS//|/, }" "$E_INVALID_VALUE"
  fi

  verbose "value:priority"
  if ! grep -qE "^priority:[[:space:]]*(${VALID_PRIORITY})[[:space:]]*\$" "$fm"; then
    fail "$abs" "invalid value" "priority must be one of: ${VALID_PRIORITY//|/, }" "$E_INVALID_VALUE"
  fi

  verbose "value:title"
  # title: must have non-empty, non-whitespace-only value.
  if ! grep -qE '^title:[[:space:]]+[^[:space:]].*$' "$fm"; then
    fail "$abs" "invalid value" "title must be a non-empty string" "$E_INVALID_VALUE"
  fi

  # child_shys: optional, but when present must be array form `[...]`
  # and each entry must match SHY-NNNN.
  verbose "value:child_shys"
  if grep -qE '^child_shys:' "$fm"; then
    if ! grep -qE '^child_shys:[[:space:]]*\[' "$fm"; then
      fail "$abs" "invalid value" "child_shys must be in array form (e.g. [] or [SHY-0001, SHY-0002])" "$E_INVALID_VALUE"
    fi
    local raw entry
    raw=$(grep -E '^child_shys:' "$fm" | head -n 1 | sed -E 's/^child_shys:[[:space:]]*\[(.*)\][[:space:]]*$/\1/')
    if [ -n "$raw" ]; then
      for entry in $(printf '%s' "$raw" | tr ',' '\n'); do
        entry=$(printf '%s' "$entry" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//')
        [ -z "$entry" ] && continue
        if ! printf '%s' "$entry" | grep -qE '^SHY-[0-9]{4}$'; then
          fail "$abs" "invalid value" "child_shys entry must match SHY-NNNN: got '${entry}'" "$E_INVALID_VALUE"
        fi
      done
    fi
  fi
}

# id frontmatter must match filename: id: EPIC-NNNN ↔ EPIC-NNNN-slug.md
check_id_matches_filename() {
  local fm="$1" file="$2" abs="$3"
  verbose "value:id-matches-filename"
  local id_val basename_val expected_prefix
  id_val=$(grep -E '^id:' "$fm" | head -n 1 | sed -E 's/^id:[[:space:]]*([^[:space:]]+).*$/\1/')
  basename_val=$(basename "$file")
  expected_prefix="${id_val}-"
  case "$basename_val" in
    "${expected_prefix}"*\.md) ;;
    *)
      fail "$abs" "invalid value" "id (${id_val}) does not match filename (${basename_val}); expected ${expected_prefix}*.md" "$E_INVALID_VALUE"
      ;;
  esac
}

check_required_sections() {
  local body="$1" abs="$2"
  local oldifs="$IFS"
  IFS='|'
  # shellcheck disable=SC2086
  set -- $REQ_SECTIONS
  IFS="$oldifs"
  local section
  for section in "$@"; do
    verbose "section:## ${section}"
    if ! grep -qE "^## $(escape_re "$section")($| )" "$body"; then
      fail "$abs" "missing section" "missing required body section: ## ${section}" "$E_MISSING_SECTION"
    fi
  done
}

validate_file() {
  local file="$1"
  local abs
  abs="$(abspath "$file")"

  if [ ! -f "$file" ]; then
    fail "$abs" "missing" "file does not exist" "$E_USAGE"
  fi

  if [ ! -s "$file" ]; then
    fail "$abs" "missing" "no frontmatter found" "$E_MISSING_FIELD"
  fi

  local norm
  norm="$(normalize_file "$file")"

  check_frontmatter_present "$norm" "$abs"

  local fm body
  fm="$(mktemp -t epic-fm.XXXXXX)"; TMP_FILES="${TMP_FILES} ${fm}"
  body="$(mktemp -t epic-body.XXXXXX)"; TMP_FILES="${TMP_FILES} ${body}"
  extract_frontmatter "$norm" >"$fm"
  extract_body "$norm" >"$body"

  check_required_fields "$fm" "$abs"
  check_field_values "$fm" "$abs"
  check_id_matches_filename "$fm" "$file" "$abs"
  check_required_sections "$body" "$abs"
}

# Extract EPIC id from filename (EPIC-NNNN-slug.md → EPIC-NNNN).
epic_id_from_filename() {
  basename "$1" | sed -E 's/^(EPIC-[0-9]{4})-.*$/\1/'
}

# Extract SHY id from filename (SHY-NNNN-slug.md → SHY-NNNN).
shy_id_from_filename() {
  basename "$1" | sed -E 's/^(SHY-[0-9]{4})-.*$/\1/'
}

# --scan: structural per-file then cross-corpus.
# Pass 1: validate each EPIC file structurally (stop on first fail).
# Pass 2: detect EPIC ID collisions (two files with same EPIC-NNNN prefix).
# Pass 3: build SHY ID set for unknown-ref detection.
# Pass 4: cross-check each EPIC's child_shys against SHY set + collect claims.
# Pass 5: detect duplicate child claim (same SHY in two EPICs).
validate_scan() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    fail "$dir" "usage" "--scan requires a directory argument; got a file path or missing dir" "$E_USAGE"
  fi

  # ---- Pass 1: structural per-file.
  local file
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    verbose "scan:${file}"
    if ! ( validate_file "$file" ); then
      exit "$E_SCAN_FAIL"
    fi
  done < <(find -P "$dir" -maxdepth 1 -type f ! -type l \
             -name 'EPIC-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)

  # ---- Pass 2: EPIC ID collision (two files claiming same EPIC-NNNN id).
  local id_index
  id_index="$(mktemp -t epic-idx.XXXXXX)"; TMP_FILES="${TMP_FILES} ${id_index}"
  : >"$id_index"
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    local id_val
    id_val=$(epic_id_from_filename "$file")
    printf '%s\t%s\n' "$id_val" "$file" >>"$id_index"
  done < <(find -P "$dir" -maxdepth 1 -type f ! -type l \
             -name 'EPIC-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)

  local dup_id
  dup_id=$(cut -f 1 "$id_index" | LC_ALL=C sort | uniq -d | head -n 1)
  if [ -n "$dup_id" ]; then
    local dup_files first_file abs
    dup_files=$(awk -F '\t' -v id="$dup_id" '$1==id{print $2}' "$id_index" | tr '\n' ' ')
    first_file=$(printf '%s' "$dup_files" | awk '{print $1}')
    abs="$(abspath "$first_file")"
    fail "$abs" "duplicate epic id" "EPIC ID collision: ${dup_id} appears in multiple files: ${dup_files}" "$E_SCAN_FAIL"
  fi

  # ---- Pass 3: build SHY ID set.
  local shy_set
  shy_set="$(mktemp -t shy-set.XXXXXX)"; TMP_FILES="${TMP_FILES} ${shy_set}"
  : >"$shy_set"
  local sfile
  while IFS= read -r sfile; do
    [ -z "$sfile" ] && continue
    shy_id_from_filename "$sfile" >>"$shy_set"
  done < <(find -P "$dir" -maxdepth 1 -type f ! -type l \
             -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)

  # ---- Pass 4: collect claims + unknown-ref check.
  local claims
  claims="$(mktemp -t epic-claims.XXXXXX)"; TMP_FILES="${TMP_FILES} ${claims}"
  : >"$claims"
  local efile id_val raw entry abs
  while IFS= read -r efile; do
    [ -z "$efile" ] && continue
    id_val=$(epic_id_from_filename "$efile")
    # child_shys is optional; guard with `if grep -q` to keep set -e happy.
    if ! grep -qE '^child_shys:' "$efile"; then
      continue
    fi
    raw=$(grep -E '^child_shys:' "$efile" | head -n 1 | sed -E 's/^child_shys:[[:space:]]*\[(.*)\][[:space:]]*$/\1/')
    [ -z "$raw" ] && continue
    for entry in $(printf '%s' "$raw" | tr ',' '\n'); do
      entry=$(printf '%s' "$entry" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//')
      [ -z "$entry" ] && continue
      if ! grep -qE "^${entry}\$" "$shy_set"; then
        abs="$(abspath "$efile")"
        fail "$abs" "unknown SHY reference" "EPIC ${id_val} claims child ${entry} but no such SHY exists in scan dir" "$E_SCAN_FAIL"
      fi
      printf '%s\t%s\t%s\n' "$entry" "$id_val" "$efile" >>"$claims"
    done
  done < <(find -P "$dir" -maxdepth 1 -type f ! -type l \
             -name 'EPIC-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)

  # ---- Pass 5: duplicate child claim across EPICs.
  local dup_claim
  dup_claim=$(cut -f 1 "$claims" | LC_ALL=C sort | uniq -d | head -n 1)
  if [ -n "$dup_claim" ]; then
    local claimants first_file
    claimants=$(awk -F '\t' -v sid="$dup_claim" '$1==sid{print $2}' "$claims" | LC_ALL=C sort -u | tr '\n' ' ')
    first_file=$(awk -F '\t' -v sid="$dup_claim" '$1==sid{print $3}' "$claims" | head -n 1)
    abs="$(abspath "$first_file")"
    fail "$abs" "duplicate epic claim" "child ${dup_claim} claimed by multiple EPICs: ${claimants}" "$E_SCAN_FAIL"
  fi
}

# ============================================================== main

main() {
  if [ "$#" -eq 0 ]; then
    printf 'check-epic-frontmatter.sh: usage error: missing argument; see --help\n' >&2
    exit "$E_USAGE"
  fi

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h)
        usage
        exit 0
        ;;
      --verbose)
        VERBOSE=1
        shift
        ;;
      --scan)
        if [ "$#" -lt 2 ]; then
          printf 'check-epic-frontmatter.sh: usage error: --scan requires a directory argument\n' >&2
          exit "$E_USAGE"
        fi
        case "$2" in
          --*)
            printf 'check-epic-frontmatter.sh: usage error: flags (e.g. --verbose) must precede --scan; got %s after --scan\n' "$2" >&2
            exit "$E_USAGE"
            ;;
        esac
        validate_scan "$2"
        exit "$E_OK"
        ;;
      --*)
        printf 'check-epic-frontmatter.sh: usage error: unknown flag %s\n' "$1" >&2
        exit "$E_USAGE"
        ;;
      *)
        validate_file "$1"
        exit "$E_OK"
        ;;
    esac
  done

  printf 'check-epic-frontmatter.sh: usage error: missing file argument; see --help\n' >&2
  exit "$E_USAGE"
}

main "$@"
