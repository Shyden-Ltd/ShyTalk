#!/usr/bin/env bash
# shellcheck shell=bash
#
# sync-stories-to-issues.sh
#
# One-way mirror of .project/stories/SHY-NNNN-*.md files to GitHub Issues
# + Projects v2 cards, per SHY-0002 spec at
# .project/stories/SHY-0002-wire-github-integration.md.
#
# Source of truth is the .md file. Change detection is SHA-256 of the
# file body (mid-PR edits share the same commit, so commit-SHA alone is
# insufficient — body-hash is the canonical signal per architect C2).
#
# USAGE
#   sync-stories-to-issues.sh --all              # sync every SHY-NNNN file
#   sync-stories-to-issues.sh --story SHY-NNNN   # sync just one
#   sync-stories-to-issues.sh --dry-run          # add to either above
#   sync-stories-to-issues.sh --verbose          # add to either above
#   sync-stories-to-issues.sh --help             # print usage
#
# AUTH
#   Requires GH_PAT_PROJECT environment variable — a fine-grained PAT
#   scoped to issues:write + pull-requests:write + project:write. The
#   automatic GITHUB_TOKEN in GitHub Actions does NOT carry project
#   scopes (architect C1). Operator provisions the PAT and registers
#   it as repository secret GH_PAT_PROJECT.
#
# CONFIG
#   SYNC_GRACE_WINDOW_SECS  Grace period before force-closing an issue
#                           after a story flips to status: Done. Default
#                           300 (5 min). Tests inject 0 to skip the sleep.
#   GH                      Path to the `gh` CLI. Default `gh`. Tests
#                           override with a mock-gh fixture.
#
# EXIT CODES (also in --help)
#   0   success
#   2   usage error
#   30  missing/invalid GH_PAT_PROJECT
#   33  story file failed frontmatter validation
#   34  --story <ID> story file not found

set -euo pipefail

VERSION="1.0.0"

# ============================================================== constants

E_OK=0
E_USAGE=2
E_AUTH=30
E_NOT_FOUND=34

VERBOSE=0
DRY_RUN=0
MODE=""
SINGLE_ID=""

GH="${GH:-gh}"
SYNC_GRACE_WINDOW_SECS="${SYNC_GRACE_WINDOW_SECS:-300}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORIES_DIR="${REPO_ROOT}/.project/stories"

N_CREATED=0
N_UPDATED=0
N_SKIPPED=0
N_FAILED=0

# ============================================================== helpers

usage() {
  cat <<EOF
sync-stories-to-issues.sh ${VERSION}

USAGE
  sync-stories-to-issues.sh --all
  sync-stories-to-issues.sh --story SHY-NNNN
  sync-stories-to-issues.sh --help

FLAGS
  --all              Iterate every SHY-NNNN-*.md file in .project/stories/
  --story SHY-NNNN   Process only the named story
  --dry-run          Print actions; make no API mutations
  --verbose          Print API calls + payloads (token redacted) to stderr
  --help             Print this usage and exit 0

EXIT CODES
  0   success
  2   usage error
  30  missing/invalid GH_PAT_PROJECT
  33  story file failed frontmatter validation
  34  --story <ID> not found

ENV VARS
  GH_PAT_PROJECT          PAT with issues:write + pull-requests:write +
                          project:write. Auto GITHUB_TOKEN cannot carry
                          project scopes — a PAT is mandatory.
  SYNC_GRACE_WINDOW_SECS  Grace before force-closing Done issues (default 300)
  GH                      Path to gh CLI (default "gh"); tests override

EXAMPLES
  sync-stories-to-issues.sh --all
  sync-stories-to-issues.sh --story SHY-0001
  sync-stories-to-issues.sh --all --dry-run --verbose
EOF
}

verbose() {
  if [ "$VERBOSE" = "1" ]; then
    printf '[verbose] %s\n' "$1" >&2
  fi
}

# Emit a structured line: "<scope>: <category>: <details>" to stderr.
emit() {
  printf '%s: %s: %s\n' "$1" "$2" "$3" >&2
}

# Fail with a global (non-story-scoped) message + exit.
fail_global() {
  printf '%s: %s\n' "$1" "$2" >&2
  exit "$3"
}

# SHA-256 of the body of a story file (everything after the closing `---`).
body_hash() {
  awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n>=2{print}' "$1" \
    | shasum -a 256 \
    | awk '{print $1}'
}

# Extract a frontmatter field value (echoes empty if absent).
fm_get() {
  awk -v F="$2" '
    BEGIN{n=0}
    /^---[[:space:]]*$/{n++; if(n==2) exit; next}
    n==1 && $0 ~ "^"F":" {
      sub("^"F":[[:space:]]*","")
      print
      exit
    }
  ' "$1"
}

# Extract the `# <Title>` h1 line text (without the leading `# `).
extract_title() {
  awk 'NR>1 && /^# /{sub(/^# /,""); print; exit}' "$1"
}

# Pre-flight: required env vars. Skipped in --dry-run mode.
check_auth() {
  if [ -z "${GH_PAT_PROJECT:-}" ]; then
    fail_global "auth" \
      "GH_PAT_PROJECT missing — provision a PAT with issues:write + pull-requests:write + project:write" \
      "$E_AUTH"
  fi
  export GH_TOKEN="$GH_PAT_PROJECT"
}

# Look up existing issue by SHY-NNNN: title prefix. Echo issue number or empty.
find_issue_for() {
  local id="$1"
  "$GH" issue list \
    --state all \
    --search "in:title \"${id}:\"" \
    --json number,title \
    --jq ".[] | select(.title | startswith(\"${id}:\")) | .number" \
    2>/dev/null \
    | head -n 1 || true
}

# Build the issue body for a story file.
build_issue_body() {
  local file="$1" hash="$2"
  local slug
  slug="$(basename "$file" .md)"
  local title
  title="$(extract_title "$file")"
  local now
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local sha
  sha="$(cd "$REPO_ROOT" && git rev-parse HEAD 2>/dev/null || echo "unknown")"

  # Single-quoted printf format string with literal backticks; $-expansion
  # is intentionally disabled here (the format and slug are the only
  # substituted values, via %s).
  # shellcheck disable=SC2016
  printf '**Spec:** [`%s.md`](../blob/main/.project/stories/%s.md)\n\n' "$slug" "$slug"
  printf '> %s\n\n' "$title"
  printf -- '---\n\n'
  printf '_Last synced: %s from commit %s body-hash: %s_\n' "$now" "$sha" "$hash"
}

# Build label set from frontmatter (one per line).
build_labels() {
  local file="$1"
  local status priority effort type
  status="$(fm_get "$file" status | tr ' ' '-' | tr '[:upper:]' '[:lower:]')"
  priority="$(fm_get "$file" priority | tr '[:upper:]' '[:lower:]')"
  effort="$(fm_get "$file" effort | tr '[:upper:]' '[:lower:]')"
  type="$(fm_get "$file" type)"
  printf 'story\n'
  printf 'status:%s\n' "$status"
  printf 'priority:%s\n' "$priority"
  printf 'effort:%s\n' "$effort"
  printf 'type:%s\n' "$type"
  local roadmaps
  roadmaps="$(fm_get "$file" roadmap_ids | sed 's/^\[//; s/\]$//' | tr -d ' ')"
  if [ -n "$roadmaps" ]; then
    printf '%s\n' "$roadmaps" | tr ',' '\n' | while IFS= read -r r; do
      [ -n "$r" ] && printf 'roadmap:%s\n' "$r"
    done
  fi
}

# Sync one story file. Returns 0 always (failures increment N_FAILED).
sync_one() {
  local file="$1"
  local id
  id="$(fm_get "$file" id)"
  if [ -z "$id" ]; then
    emit "$file" "validate" "no id frontmatter; skipping"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi

  verbose "sync_one: ${id} (${file})"

  if ! bash "$REPO_ROOT/scripts/check-story-frontmatter.sh" "$file" >/dev/null 2>&1; then
    emit "$id" "validate" "story failed frontmatter validation; skipping"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi

  local hash
  hash="$(body_hash "$file")"

  local issue_num
  issue_num="$(find_issue_for "$id")"

  if [ -z "$issue_num" ]; then
    local title
    title="${id}: $(extract_title "$file" | sed "s/^${id}: //")"
    if [ "$DRY_RUN" = "1" ]; then
      printf 'DRY-RUN: %s: would CREATE issue with title "%s"\n' "$id" "$title" >&2
      N_CREATED=$((N_CREATED + 1))
      return 0
    fi
    local body labels
    body="$(build_issue_body "$file" "$hash")"
    labels="$(build_labels "$file" | paste -sd, -)"
    if ! "$GH" issue create --title "$title" --body "$body" --label "$labels" >/dev/null 2>&1; then
      emit "$id" "api" "failed to create issue"
      N_FAILED=$((N_FAILED + 1))
      return 0
    fi
    N_CREATED=$((N_CREATED + 1))
    emit "$id" "created" "issue created"
    return 0
  fi

  # Issue exists. Compare body-hash via stored footer.
  local existing_body existing_hash
  existing_body="$("$GH" issue view "$issue_num" --json body --jq .body 2>/dev/null || echo "")"
  existing_hash="$(printf '%s\n' "$existing_body" | sed -n 's/.*body-hash: \([a-f0-9]*\).*/\1/p' | head -n 1)"

  if [ "$existing_hash" = "$hash" ]; then
    verbose "${id}: body-hash unchanged; skipping"
    N_SKIPPED=$((N_SKIPPED + 1))
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: %s: would UPDATE issue #%s (body-hash changed)\n' "$id" "$issue_num" >&2
    N_UPDATED=$((N_UPDATED + 1))
    return 0
  fi

  local new_body
  new_body="$(build_issue_body "$file" "$hash")"
  if ! "$GH" issue edit "$issue_num" --body "$new_body" >/dev/null 2>&1; then
    emit "$id" "api" "failed to update issue #${issue_num}"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi
  N_UPDATED=$((N_UPDATED + 1))
  emit "$id" "updated" "issue #${issue_num} body refreshed"
}

sync_all() {
  if [ ! -d "$STORIES_DIR" ]; then
    fail_global "config" "stories directory not found: $STORIES_DIR" "$E_USAGE"
  fi
  local file
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    sync_one "$file"
  done < <(find -P "$STORIES_DIR" -maxdepth 1 -type f ! -type l \
             -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)
  printf 'Sync result: %d created, %d updated, %d skipped, %d failed\n' \
    "$N_CREATED" "$N_UPDATED" "$N_SKIPPED" "$N_FAILED" >&2
}

sync_story() {
  local id="$1"
  local match
  match="$(find -P "$STORIES_DIR" -maxdepth 1 -type f ! -type l \
             -name "${id}-*.md" | head -n 1)"
  if [ -z "$match" ]; then
    emit "$id" "not-found" "story file not found at ${STORIES_DIR}/${id}-*.md"
    exit "$E_NOT_FOUND"
  fi
  sync_one "$match"
}

# ============================================================== main

main() {
  if [ "$#" -eq 0 ]; then
    fail_global "usage" "missing argument; see --help" "$E_USAGE"
  fi

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --verbose) VERBOSE=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --all) MODE="all"; shift ;;
      --story)
        if [ "$#" -lt 2 ]; then
          fail_global "usage" "--story requires SHY-NNNN argument" "$E_USAGE"
        fi
        MODE="story"
        SINGLE_ID="$2"
        shift 2
        ;;
      *) fail_global "usage" "unknown flag: $1; see --help" "$E_USAGE" ;;
    esac
  done

  if [ -z "$MODE" ]; then
    fail_global "usage" "specify --all or --story SHY-NNNN" "$E_USAGE"
  fi

  if [ "$DRY_RUN" != "1" ]; then
    check_auth
  fi

  case "$MODE" in
    all)   sync_all ;;
    story) sync_story "$SINGLE_ID" ;;
  esac
  exit "$E_OK"
}

main "$@"
