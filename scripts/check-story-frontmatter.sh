#!/usr/bin/env bash
# shellcheck shell=bash
#
# check-story-frontmatter.sh
#
# Validates Agile user-story files per the SHY-0001 spec at
# .project/stories/SHY-0001-establish-agile-workflow.md (and the
# "Agile Way of Working" section in CLAUDE.md).
#
# Usage:
#   check-story-frontmatter.sh <file>            # validate one file
#   check-story-frontmatter.sh --scan <dir>      # validate every SHY-NNNN file in dir
#   check-story-frontmatter.sh --help            # print usage + exit codes
#   check-story-frontmatter.sh --verbose <file>  # print [check] lines to stderr
#
# Exit codes (deterministic, machine-parseable):
#   0   success
#   2   usage error (missing arg, unknown flag, --scan target is a file)
#   10  missing required frontmatter field
#   11  invalid frontmatter field value (regex / enum / array form)
#   12  missing required ##  body section
#   13  BDD coverage gap (AC has bullets but BDD has 0 scenarios — presence-based)
#   14  missing required ### AC sub-heading (one of the 8 dimensions)
#   20  --scan mode: at least one file failed (inner category in stderr)
#
# Stderr format on failure (machine-parseable):
#   <absolute-path>: <category-name>: <details>
#
# Bash 3.2-compatible (macOS default) — no `declare -A`, no `${var^^}`.

set -euo pipefail

# ============================================================== constants

VERSION="1.0.0"

# Required frontmatter fields (presence check). pr: is template-present but
# advisory-only and NOT validated by this script.
REQ_FIELDS="id status owner created priority effort type roadmap_ids"

# Enums (space-separated; Bash 3.2 has no associative arrays).
VALID_STATUS="Draft|In Progress|In Review|Done|Cancelled"
VALID_PRIORITY="P0|P1|P2|P3"
VALID_EFFORT="XS|S|M|L|XL"
VALID_TYPE="feature|bug|refactor|docs|infra|spike|chore"

# Optional frontmatter field regexes (validated only when field is present).
# `epic:` added by SHY-0037 — when present, must match `^EPIC-[0-9]{4}$`.
# Cross-check that the referenced EPIC file actually exists runs in --scan mode
# only (forward-reference protection); per-file mode skips it per architect
# Finding 2 resolution.
VALID_EPIC="^epic:[[:space:]]*EPIC-[0-9]{4}[[:space:]]*$"

# Required `##` body sections (10 — h1 `# Title` is NOT a `## ` section).
REQ_SECTIONS="User Story|Why|Acceptance Criteria|BDD Scenarios|Test Plan|Out of Scope|Dependencies|Risks & Mitigations|Definition of Done|Notes"

# Required `###` AC sub-headings (the 8 dimensions).
REQ_AC_DIMS="Happy path|Error paths|Edge cases|Performance|Security|UX|i18n|Observability"

# Exit codes.
E_OK=0
E_USAGE=2
E_MISSING_FIELD=10
E_INVALID_VALUE=11
E_MISSING_SECTION=12
E_BDD_GAP=13
E_MISSING_AC_DIM=14
E_SCAN_FAIL=20

VERBOSE=0

# ============================================================== helpers

usage() {
  cat <<EOF
check-story-frontmatter.sh ${VERSION}

SYNOPSIS
  check-story-frontmatter.sh [--scan <dir>] | <file>

USAGE
  check-story-frontmatter.sh [--verbose] <file>
  check-story-frontmatter.sh [--verbose] --scan <dir>
  check-story-frontmatter.sh --help

  NOTE: --verbose MUST precede --scan; flag order matters.

FLAGS
  --scan <dir>   Validate every SHY-NNNN-*.md file in <dir> (sorted; stop-on-first failure).
                 The 4-digit ID glob automatically excludes SHY-INDEX.md and other non-story
                 markdown. Symlinks are skipped via \`find -P ... ! -type l\` so a crafted
                 symlink to /etc/passwd cannot trigger a read.
  --verbose      Print [check] lines to stderr for each check the validator runs.
  --help         Print this usage and exit 0.

EXIT CODES
  0   success
  2   usage error (missing arg, unknown flag, --scan target is a file)
  10  missing required frontmatter field
  11  invalid frontmatter field value (regex / enum / array form)
  12  missing required ## body section
  13  BDD coverage gap (AC has bullets but BDD has 0 scenarios; presence-based, sectionally counted)
  14  missing required ### AC sub-heading (one of the 8 dimensions)
  20  --scan mode: at least one file failed (inner category in stderr)

EXAMPLES
  check-story-frontmatter.sh .project/stories/SHY-0001-establish-agile-workflow.md
  check-story-frontmatter.sh --scan .project/stories
  check-story-frontmatter.sh --verbose .project/stories/SHY-0042-foo.md

SEE ALSO
  CLAUDE.md § "Agile Way of Working"
  .project/stories/SHY-0001-establish-agile-workflow.md
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

# Strip CR and UTF-8 BOM from a file (but NOT trailing whitespace). Write the
# clean copy to a temp path and echo that path. Caller is responsible for
# cleanup (we register a trap).
#
# Why we DON'T strip trailing whitespace: Markdown uses exactly 2 trailing
# spaces on a line to denote a hard line break (rendered as `<br>`). A
# blanket `s/[[:space:]]*$//` strip would silently mutate a legitimate
# Markdown feature. Instead we tolerate trailing whitespace at every
# checkpoint:
#   - check_frontmatter_present uses a regex `^---[[:space:]]*$` for the
#     delimiter line (not strict `==`)
#   - check_field_values uses `[[:space:]]*$` in the per-field regexes
#   - check_required_sections uses `($| )` so a section header followed
#     by trailing space still matches
#   - check_required_ac_dims same as above
#   - awk patterns for AC/BDD counting match line PREFIXES, ignoring tails
# So a trailing-whitespace-laden story file validates correctly without
# our needing to mutate the content.
normalize_file() {
  local src="$1"
  local tmp
  tmp="$(mktemp -t shy-frontmatter.XXXXXX)"
  TMP_FILES="${TMP_FILES} ${tmp}"
  # Strip leading 3-byte UTF-8 BOM (EF BB BF) from line 1, then strip CRs.
  LC_ALL=C sed -e '1s/^\xef\xbb\xbf//' "$src" | tr -d '\r' >"$tmp"
  echo "$tmp"
}

# Absolute path of a (possibly relative) input path.
abspath() {
  # Bash 3.2 lacks `realpath` on macOS. cd && pwd is portable.
  local p="$1"
  if [ -d "$p" ]; then
    ( cd "$p" && pwd )
  else
    local d
    d="$(dirname "$p")"
    ( cd "$d" && printf '%s/%s\n' "$(pwd)" "$(basename "$p")" )
  fi
}

# Register a cleanup trap so all temp files vanish on exit regardless of code path.
TMP_FILES=""
# cleanup() is invoked indirectly via the EXIT/INT/TERM trap below; shellcheck
# can't see trap-mediated invocations and reports SC2329 ("never invoked").
# shellcheck disable=SC2329
cleanup() {
  # Intentional word-splitting on whitespace-separated paths in TMP_FILES.
  # shellcheck disable=SC2086
  rm -f ${TMP_FILES}
}
trap cleanup EXIT INT TERM

# ============================================================== validation

# Check that frontmatter delimiters exist. Returns 0 if found, 10 (with fail) otherwise.
# Delimiters tolerate trailing whitespace (per Markdown norms) but must be exactly `---`
# (optionally followed by whitespace) at the start of a line.
check_frontmatter_present() {
  local file="$1" abs="$2"
  # Line 1 must match `---` (with optional trailing whitespace).
  if ! head -n 1 "$file" 2>/dev/null | grep -qE '^---[[:space:]]*$'; then
    fail "$abs" "missing" "no frontmatter found" "$E_MISSING_FIELD"
  fi
  # Need at least one more `---` (with optional trailing whitespace) later in the file.
  if [ "$(grep -cE '^---[[:space:]]*$' "$file")" -lt 2 ]; then
    fail "$abs" "missing" "no frontmatter found" "$E_MISSING_FIELD"
  fi
}

# Extract the frontmatter block (between the first two `---` lines) to stdout.
# Delimiter regex `^---[[:space:]]*$` tolerates trailing whitespace per the
# I3 fix — preserves Markdown hard line-breaks across the file.
extract_frontmatter() {
  awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; if(n==2) exit; next} n==1{print}' "$1"
}

# Extract the body (everything after the second `---`) to stdout.
extract_body() {
  awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n>=2{print}' "$1"
}

check_required_fields() {
  local fm="$1" abs="$2"
  local field
  for field in $REQ_FIELDS; do
    verbose "frontmatter:$field"
    # `grep -qE '^<field>:'` — `|| FAILED=1` to keep `set -e` from firing on no-match.
    local found=1
    grep -qE "^${field}:" "$fm" || found=0
    if [ "$found" = "0" ]; then
      fail "$abs" "missing field" "missing required frontmatter field: ${field}" "$E_MISSING_FIELD"
    fi
  done
}

check_field_values() {
  local fm="$1" abs="$2"

  # id: must match ^SHY-NNNN$
  verbose "value:id"
  if ! grep -qE '^id:[[:space:]]*SHY-[0-9]{4}[[:space:]]*$' "$fm"; then
    fail "$abs" "invalid value" "id must match SHY-NNNN pattern (4-digit zero-padded)" "$E_INVALID_VALUE"
  fi

  # status: one of the 5 allowed values
  verbose "value:status"
  if ! grep -qE "^status:[[:space:]]*(${VALID_STATUS})[[:space:]]*\$" "$fm"; then
    fail "$abs" "invalid value" "status must be one of: ${VALID_STATUS//|/, }" "$E_INVALID_VALUE"
  fi

  # priority: one of P0..P3
  verbose "value:priority"
  if ! grep -qE "^priority:[[:space:]]*(${VALID_PRIORITY})[[:space:]]*\$" "$fm"; then
    fail "$abs" "invalid value" "priority must be one of: ${VALID_PRIORITY//|/, }" "$E_INVALID_VALUE"
  fi

  # effort: one of XS..XL
  verbose "value:effort"
  if ! grep -qE "^effort:[[:space:]]*(${VALID_EFFORT})[[:space:]]*\$" "$fm"; then
    fail "$abs" "invalid value" "effort must be one of: ${VALID_EFFORT//|/, }" "$E_INVALID_VALUE"
  fi

  # type: one of 7 values
  verbose "value:type"
  if ! grep -qE "^type:[[:space:]]*(${VALID_TYPE})[[:space:]]*\$" "$fm"; then
    fail "$abs" "invalid value" "type must be one of: ${VALID_TYPE//|/, }" "$E_INVALID_VALUE"
  fi

  # roadmap_ids: must be array form `[` (empty or populated)
  verbose "value:roadmap_ids"
  if ! grep -qE "^roadmap_ids:[[:space:]]*\\[" "$fm"; then
    fail "$abs" "invalid value" "roadmap_ids must be in array form (e.g. [] or [G001, G024])" "$E_INVALID_VALUE"
  fi
}

# Validate optional frontmatter fields (presence not required, but when present
# the value must match the expected format). Added by SHY-0037.
check_optional_fields() {
  local fm="$1" abs="$2"

  # epic: when present, must match ^EPIC-[0-9]{4}$ (e.g. EPIC-0001)
  if grep -qE '^epic:' "$fm"; then
    verbose "optional:epic"
    if ! grep -qE "$VALID_EPIC" "$fm"; then
      fail "$abs" "invalid optional field" "epic must match EPIC-NNNN pattern (4-digit zero-padded), e.g. EPIC-0001" "$E_INVALID_VALUE"
    fi
  fi
}

check_required_sections() {
  local body="$1" abs="$2"
  # Split REQ_SECTIONS on '|'.
  local oldifs="$IFS"
  IFS='|'
  # Intentional word-splitting via IFS for parameterised list iteration.
  # shellcheck disable=SC2086
  set -- $REQ_SECTIONS
  IFS="$oldifs"
  local section
  for section in "$@"; do
    verbose "section:## ${section}"
    # Prefix match: anchor at start of line + `## <section>` + anything (suffix tolerated).
    if ! grep -qE "^## $(escape_re "$section")($| )" "$body"; then
      fail "$abs" "missing section" "missing required body section: ## ${section}" "$E_MISSING_SECTION"
    fi
  done
}

check_required_ac_dims() {
  local body="$1" abs="$2"
  # Extract just the AC section so dimension headers in OTHER sections (e.g. an example) don't false-positive.
  local ac_section
  ac_section="$(awk '/^## Acceptance Criteria($| )/{f=1;next} /^## [^#]/ && f==1 {f=0} f==1' "$body")"
  local oldifs="$IFS"
  IFS='|'
  # shellcheck disable=SC2086
  set -- $REQ_AC_DIMS
  IFS="$oldifs"
  local dim
  for dim in "$@"; do
    verbose "ac-dim:### ${dim}"
    if ! printf '%s\n' "$ac_section" | grep -qE "^### $(escape_re "$dim")($| )"; then
      fail "$abs" "missing ac dim" "missing required AC sub-heading: ### ${dim}" "$E_MISSING_AC_DIM"
    fi
  done
}

# Sectional BDD coverage check: count `- [ ]` lines inside ## Acceptance Criteria,
# count `**Scenario:` blocks inside ## BDD Scenarios.
#
# Rule: presence-based, not strict 1:1. Per the architect round-2 Important
# finding, a single scenario can validly cover multiple closely-related AC
# bullets (the Then-clauses bind them). So we only fail when AC has
# expectations to verify (≥1 checkbox) AND BDD has zero scenarios. Depth /
# per-bullet coverage is the reviewer agent's job, not the validator's.
check_bdd_coverage() {
  local body="$1" abs="$2"
  local ac_count bdd_count

  verbose "bdd:count-ac-bullets"
  ac_count=$(awk '
    /^## Acceptance Criteria($| )/{f=1;next}
    /^## [^#]/ && f==1 {f=0}
    f==1 && /^- \[ \]/ {c++}
    END {print c+0}
  ' "$body")

  verbose "bdd:count-scenarios"
  bdd_count=$(awk '
    /^## BDD Scenarios($| )/{f=1;next}
    /^## [^#]/ && f==1 {f=0}
    f==1 && /^\*\*Scenario:/ {c++}
    END {print c+0}
  ' "$body")

  if [ "$ac_count" -gt 0 ] && [ "$bdd_count" -eq 0 ]; then
    fail "$abs" "bdd gap" \
      "AC has ${ac_count} bullets but BDD has 0 scenarios — add at least one" \
      "$E_BDD_GAP"
  fi
}

# Escape a string for use in a basic-extended regex character class.
# The sed expression intentionally uses single quotes — `\\&` is a literal
# backslash-then-sed-replacement-backref that escapes any regex metachar
# the input contains. Shell expansion inside the pattern would be a bug.
# shellcheck disable=SC2016
escape_re() {
  printf '%s' "$1" | sed 's/[.[\*^$(){}+?|]/\\&/g'
}

# Validate a single file. Exits with the appropriate code on failure;
# returns 0 (silently) on success.
validate_file() {
  local file="$1"
  local abs
  abs="$(abspath "$file")"

  if [ ! -f "$file" ]; then
    fail "$abs" "missing" "file does not exist" "$E_USAGE"
  fi

  # 0-byte file → no frontmatter possible.
  if [ ! -s "$file" ]; then
    fail "$abs" "missing" "no frontmatter found" "$E_MISSING_FIELD"
  fi

  local norm
  norm="$(normalize_file "$file")"

  check_frontmatter_present "$norm" "$abs"

  local fm body
  fm="$(mktemp -t shy-fm.XXXXXX)"; TMP_FILES="${TMP_FILES} ${fm}"
  body="$(mktemp -t shy-body.XXXXXX)"; TMP_FILES="${TMP_FILES} ${body}"
  extract_frontmatter "$norm" >"$fm"
  extract_body "$norm" >"$body"

  check_required_fields "$fm" "$abs"
  check_field_values "$fm" "$abs"
  check_optional_fields "$fm" "$abs"
  check_required_sections "$body" "$abs"
  check_required_ac_dims "$body" "$abs"
  check_bdd_coverage "$body" "$abs"
}

# --scan: iterate SHY-NNNN-*.md files in a directory, stop-on-first failure.
#
# Two-pass design (SHY-0037):
#   Pass 1: per-file structural validation (presence + values + sections + AC dims + BDD).
#   Pass 2: build EPIC ID set from EPIC-NNNN-*.md files in dir (in-memory index).
#   Pass 3: for each SHY with an `epic:` field, cross-check the reference against
#           the EPIC set. Failure here = forward-reference protection.
# Per-file mode skips passes 2-3 (architect Finding 2 — structural checks only).
validate_scan() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    fail "$dir" "usage" "--scan requires a directory argument; got a file path or missing dir" "$E_USAGE"
  fi

  # find -P + ! -type l → exclude symlinks by file type (the -P alone does NOT
  # prevent open() from following a name-glob-matched symlink to its target).
  # LC_ALL=C sort for stable lexicographical order across locales.
  local file
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    verbose "scan:${file}"
    # Run validate_file in a subshell so its exit doesn't kill the parent loop;
    # capture exit code and translate to E_SCAN_FAIL with a clear envelope.
    if ! ( validate_file "$file" ); then
      # validate_file already printed its specific failure to stderr; we just
      # need to set the scan-level exit code.
      exit "$E_SCAN_FAIL"
    fi
  done < <(find -P "$dir" -maxdepth 1 -type f ! -type l \
             -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)

  # ---- Pass 2: build EPIC ID set from EPIC-NNNN-*.md files in dir.
  local epic_set
  epic_set="$(mktemp -t shy-scan-epics.XXXXXX)"; TMP_FILES="${TMP_FILES} ${epic_set}"
  : >"$epic_set"
  local efile ebase eid
  while IFS= read -r efile; do
    [ -z "$efile" ] && continue
    ebase=$(basename "$efile")
    eid=$(printf '%s' "$ebase" | sed -E 's/^(EPIC-[0-9]{4})-.*$/\1/')
    printf '%s\n' "$eid" >>"$epic_set"
  done < <(find -P "$dir" -maxdepth 1 -type f ! -type l \
             -name 'EPIC-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)

  # ---- Pass 3: cross-check each SHY's `epic:` reference against EPIC set.
  # Most SHYs do NOT have an `epic:` field (it's optional). Guard the grep
  # in a boolean context so `set -euo pipefail` doesn't fire when there's
  # no match — `if grep -q` is the safe idiom.
  local sfile epic_ref abs
  while IFS= read -r sfile; do
    [ -z "$sfile" ] && continue
    if ! grep -qE '^epic:' "$sfile"; then
      continue
    fi
    epic_ref=$(grep -E '^epic:' "$sfile" | head -n 1 | sed -E 's/^epic:[[:space:]]*([^[:space:]]+).*$/\1/')
    [ -z "$epic_ref" ] && continue
    if ! grep -qE "^${epic_ref}\$" "$epic_set"; then
      abs="$(abspath "$sfile")"
      fail "$abs" "invalid optional field" "epic field references unknown ${epic_ref}; no such EPIC-*.md in scan dir" "$E_SCAN_FAIL"
    fi
  done < <(find -P "$dir" -maxdepth 1 -type f ! -type l \
             -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)
}

# ============================================================== main

main() {
  if [ "$#" -eq 0 ]; then
    printf 'check-story-frontmatter.sh: usage error: missing argument; see --help\n' >&2
    exit "$E_USAGE"
  fi

  # Parse flags.
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
          printf 'check-story-frontmatter.sh: usage error: --scan requires a directory argument\n' >&2
          exit "$E_USAGE"
        fi
        case "$2" in
          --*)
            printf 'check-story-frontmatter.sh: usage error: flags (e.g. --verbose) must precede --scan; got %s after --scan\n' "$2" >&2
            exit "$E_USAGE"
            ;;
        esac
        validate_scan "$2"
        exit "$E_OK"
        ;;
      --*)
        printf 'check-story-frontmatter.sh: usage error: unknown flag %s\n' "$1" >&2
        exit "$E_USAGE"
        ;;
      *)
        validate_file "$1"
        exit "$E_OK"
        ;;
    esac
  done

  # If we got here, only flags were passed (e.g. just --verbose with no file).
  printf 'check-story-frontmatter.sh: usage error: missing file argument; see --help\n' >&2
  exit "$E_USAGE"
}

main "$@"
