#!/usr/bin/env bash
# shellcheck shell=bash
#
# sync-stories-to-issues.sh
#
# One-way mirror of .project/stories/SHY-NNNN-*.md files to the GitHub
# Projects v2 board + (bugs only) GitHub Issues, per the SHY-0074
# architecture v2 spec at
# .project/stories/SHY-0074-mirror-fidelity-board-body-labels.md:
#
#   - Non-bug stories  → board DRAFT items (addProjectV2DraftIssue) carrying
#     the full spec body; NO Issues-tab entry. The Issues tab is bugs-only.
#   - type: bug stories → a real GitHub Issue framed as a BUG REPORT
#     (## Bug = the story's ## Why; ## Tracking = source/board links +
#     status) + its issue-backed board item.
#   - Issue lifecycle follows the story: status-transition comments
#     (driven by the body-footer `_Status: X_` marker), hash-gated body
#     refresh, close on Done (reason completed, naming released_in) /
#     Cancelled (reason "not planned").
#   - One paginated items-map query replaces per-story issue searches.
#   - --rebuild (gated on REBUILD_CONFIRM=yes) tears down every board item
#     + every story-labeled issue, then resyncs fresh — the one-shot v1→v2
#     migration chosen by the operator.
#
# Built on the SHY-0002 foundation with SHY-0067 defect fixes layered on:
#
#   - Defect A (auth env): script + workflow now both export GH_TOKEN so
#     the gh CLI actually authenticates as the PAT (pre-SHY-0067 gh ran
#     with the read-only auto GITHUB_TOKEN and failed silently).
#   - Defect B (labels): script auto-creates the SHY-namespace label via
#     `gh label create` on first encounter; caches via `gh label list`.
#     SHY-0074 shrank the namespace to the single `story` marker — the old
#     status:/priority:/effort:/type:/roadmap: families duplicated board
#     columns and are now actively DELETED on every run
#     (remove_duplicated_label_families).
#   - Defect C (silent failure): every `gh` invocation captures stderr to a
#     tmpfile; failures log the captured stderr context (no more `>/dev/null
#     2>&1`); N_FAILED > 0 propagates to non-zero E_API=40 exit at script end.
#   - Defect D (Project v2 board addition): post-issue-create, script calls
#     `addProjectV2ItemById` then `updateProjectV2ItemFieldValue` for each
#     populated SHY-derived field (Pri / Effort / Type / SHY ID / Roadmap IDs /
#     Epic).
#   - Defect E (Type field auto-create): script invokes `createProjectV2Field`
#     mutation if the Type single-select field is absent on the board.
#
# Source of truth is the .md file. Change detection is SHA-256 of the file
# body (mid-PR edits share the same commit, so commit-SHA alone is
# insufficient — body-hash is the canonical signal per architect C2).
#
# USAGE
#   sync-stories-to-issues.sh --all              # sync every SHY-NNNN file
#   sync-stories-to-issues.sh --story SHY-NNNN   # sync just one
#   sync-stories-to-issues.sh --rebuild          # teardown + fresh --all
#                                                # (requires REBUILD_CONFIRM=yes)
#   sync-stories-to-issues.sh --dry-run          # add to any of the above
#   sync-stories-to-issues.sh --verbose          # add to any of the above
#   sync-stories-to-issues.sh --help             # print usage
#
# AUTH
#   Requires GH_PAT_PROJECT environment variable — a fine-grained PAT
#   scoped to issues:write + pull-requests:write + project:write. The
#   automatic GITHUB_TOKEN in GitHub Actions does NOT carry project
#   scopes (architect C1). Operator provisions the PAT and registers
#   it as repository secret GH_PAT_PROJECT.
#
#   Internally, the script re-exports the PAT as GH_TOKEN — that's the
#   env var the gh CLI actually reads (highest priority over
#   GITHUB_TOKEN). The workflow YAML also sets GH_TOKEN at the env block
#   for defense-in-depth.
#
# CONFIG
#   REBUILD_CONFIRM         Must be exactly "yes" for --rebuild to run its
#                           destructive teardown (safety gate).
#   GH                      Path to the `gh` CLI. Default `gh`. Tests
#                           override with a mock-gh fixture.
#   STORIES_DIR             Story corpus directory. Default
#                           <repo>/.project/stories. Tests override with a
#                           fixture directory (SHY-0074).
#   PROJECT_OWNER           Project v2 owner. Default "Shyden-Ltd".
#   PROJECT_NUMBER          Project v2 number. Default 1 (ShyTalk Stories).
#
# EXIT CODES (also in --help)
#   0   success
#   2   usage error
#   30  missing/invalid GH_PAT_PROJECT
#   33  story file failed frontmatter validation
#   34  --story <ID> story file not found
#   40  one or more sync operations failed (N_FAILED > 0)

set -euo pipefail

VERSION="2.0.0"

# ============================================================== constants

E_OK=0
E_USAGE=2
E_AUTH=30
E_NOT_FOUND=34
E_API=40

VERBOSE=0
DRY_RUN=0
MODE=""
SINGLE_ID=""
REBUILD=0

GH="${GH:-gh}"
PROJECT_OWNER="${PROJECT_OWNER:-Shyden-Ltd}"
PROJECT_NUMBER="${PROJECT_NUMBER:-1}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# SHY-0074: env-overridable so tests can run the full pipeline against a
# fixture corpus instead of the live .project/stories tree.
STORIES_DIR="${STORIES_DIR:-${REPO_ROOT}/.project/stories}"

N_CREATED=0
N_DRAFTS_CREATED=0
N_ISSUES_CREATED=0
N_UPDATED=0
N_SKIPPED=0
N_FAILED=0
N_LABELS_CREATED=0
N_LABELS_DELETED=0
N_PROJECT_ITEMS_ADDED=0
N_ITEMS_DELETED=0
N_ISSUES_DELETED=0
N_PROJECT_FIELDS_UPDATED=0
N_STATUS_SET=0
N_BODIES_EMBEDDED=0
N_BODIES_TRUNCATED=0
N_COMMENTS_POSTED=0
N_ISSUES_CLOSED=0
N_DEDUP_GUARD_HITS=0
TYPE_FIELD_AUTO_CREATED="no"

# Caches populated at runtime.
# LABEL_CACHE: newline-delimited list of existing label names.
LABEL_CACHE=""
LABEL_CACHE_LOADED=0
# PROJECT_*: discovered once at startup, used per-issue.
# Note: bash 3.2 (macOS default) lacks associative arrays — we encode the
# cached field IDs + single-select option IDs in two JSON blobs queried via
# jq. Adds ~50ms per lookup but keeps the script portable.
PROJECT_NODE_ID=""
TYPE_FIELD_ID=""
PROJECT_FIELDS_JSON='{}'   # {fieldName: fieldId}
PROJECT_OPTIONS_JSON='{}'  # {fieldName: {optionName: optionId}}

# ============================================================== helpers

usage() {
  cat <<EOF
sync-stories-to-issues.sh ${VERSION}

USAGE
  sync-stories-to-issues.sh --all
  sync-stories-to-issues.sh --story SHY-NNNN
  sync-stories-to-issues.sh --rebuild        (requires REBUILD_CONFIRM=yes)
  sync-stories-to-issues.sh --help

FLAGS
  --all              Iterate every SHY-NNNN-*.md file in .project/stories/
  --story SHY-NNNN   Process only the named story
  --rebuild          DESTRUCTIVE one-shot migration: delete every Project v2
                     board item + every story-labeled issue, then run a
                     fresh --all sync (drafts for non-bugs, bug-report
                     issues for bugs). Refuses without REBUILD_CONFIRM=yes.
  --dry-run          Print actions; make no API mutations
  --verbose          Print API calls + payloads (token redacted) to stderr
  --help             Print this usage and exit 0

EXIT CODES
  0   success
  2   usage error
  30  missing/invalid GH_PAT_PROJECT
  33  story file failed frontmatter validation
  34  --story <ID> not found
  40  one or more sync operations failed (N_FAILED > 0)

ENV VARS
  GH_PAT_PROJECT          PAT with issues:write + pull-requests:write +
                          project:write. Auto GITHUB_TOKEN cannot carry
                          project scopes — a PAT is mandatory. Internally
                          re-exported as GH_TOKEN (which gh CLI reads).
  REBUILD_CONFIRM         Must be "yes" for --rebuild's destructive teardown
  PROJECT_OWNER           Project v2 owner (default Shyden-Ltd)
  PROJECT_NUMBER          Project v2 number (default 1)
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

# ── Single-pass story parser (SHY-0040) ──────────────────────────
# One awk invocation per file extracts EVERY field the sync needs,
# replacing the previous per-field fm_get/extract_title fan-out
# (~15 subprocess forks per story; ~565ms/file → the whole corpus
# took 37s). Values are emitted \x1f-separated (ASCII Unit Separator
# — cannot appear in valid UTF-8 YAML frontmatter and no editor or
# serializer produces it) and consumed into PS_* globals via `read`.
# All values are whitespace-trimmed (fixes the padded-frontmatter
# label-corruption bug: `priority:   P1   ` used to leak its spaces
# into the GitHub label).
# SHY-0074 dropped the lowercased priority/effort/roadmap variants — they
# only fed the deleted label families. PS_STATUS (raw lifecycle form, e.g.
# "In Progress") feeds the footer `_Status: X_` marker, transition comments
# and the bug-report Tracking section; PS_STATUS_LC feeds the board Status
# mapping (status_board_option); PS_RELEASED_IN names the release in the
# close-on-Done comment.
PS_ID="" PS_TITLE="" PS_PRIORITY="" PS_EFFORT="" PS_TYPE="" PS_ROADMAPS=""
PS_STATUS="" PS_STATUS_LC="" PS_RELEASED_IN=""

parse_story_fields() {
  local rec
  rec="$(awk '
    function trim(s){ gsub(/^[[:space:]]+/,"",s); gsub(/[[:space:]]+$/,"",s); gsub(US,"",s); return s }
    BEGIN{ n=0; title=""; US=sprintf("%c",31) }
    /^---[[:space:]]*$/ { n++; next }
    n==1 {
      line=$0
      if (line !~ /^[A-Za-z_]+:/) next
      key=line; sub(/:.*$/,"",key)
      val=line; sub(/^[^:]*:/,"",val); val=trim(val)
      if      (key=="id")          id=val
      else if (key=="status")      status=val
      else if (key=="priority")    priority=val
      else if (key=="effort")      effort=val
      else if (key=="type")        type=val
      else if (key=="roadmap_ids") roadmaps=val
      else if (key=="released_in") released=val
      next
    }
    n>=2 && title=="" && /^# / { t=$0; sub(/^# /,"",t); title=trim(t) }
    END{
      gsub(/^\[/,"",roadmaps); gsub(/\]$/,"",roadmaps); gsub(/[[:space:]]/,"",roadmaps)
      status_lc=tolower(status); gsub(/ /,"-",status_lc)
      printf "%s%s%s%s%s%s%s%s%s%s%s%s%s%s%s%s%s", \
        id, US, title, US, priority, US, effort, US, type, US, roadmaps, US, \
        status, US, status_lc, US, released
    }
  ' "$1")"
  IFS=$'\x1f' read -r PS_ID PS_TITLE PS_PRIORITY PS_EFFORT PS_TYPE PS_ROADMAPS \
    PS_STATUS PS_STATUS_LC PS_RELEASED_IN <<<"$rec"
}

# Pre-flight: required env vars. Skipped in --dry-run mode.
check_auth() {
  if [ -z "${GH_PAT_PROJECT:-}" ]; then
    fail_global "auth" \
      "GH_PAT_PROJECT missing — provision a PAT with issues:write + pull-requests:write + project:write" \
      "$E_AUTH"
  fi
  # SHY-0067: re-export as GH_TOKEN so gh CLI authenticates. The workflow
  # YAML also sets this at the env block level (defense in depth).
  export GH_TOKEN="$GH_PAT_PROJECT"
}

# ============================================================== labels (Defect B)

# Load the existing label set into LABEL_CACHE (newline-delimited names).
# Idempotent — only fetches once per script run.
load_label_cache() {
  if [ "$LABEL_CACHE_LOADED" = "1" ]; then return 0; fi
  verbose "load_label_cache: fetching gh label list"
  local stderr_file
  stderr_file="$(mktemp)"
  set +e
  LABEL_CACHE="$("$GH" label list --limit 200 --json name --jq '.[].name' 2>"$stderr_file")"
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] label list failed (exit %d): %s\n' "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    LABEL_CACHE=""
  fi
  rm -f "$stderr_file"
  LABEL_CACHE_LOADED=1
}

# Default color for the SHY namespace. SHY-0074 shrank this to the single
# `story` marker — status/priority/effort/type/roadmap facts live in their
# board columns only (see remove_duplicated_label_families).
# Returns the suggested color (no leading '#').
label_default_color() {
  case "$1" in
    story) echo "8a2be2" ;; # purple
    *)     echo "ededed" ;;
  esac
}

# SHY-0074: a fact lives in its board column ONLY. Delete the five label
# families that used to duplicate board fields (status/priority/effort/
# type/roadmap). Repo-level deletion strips the label from every open AND
# closed issue in one shot. Idempotent — families already absent ⇒ no-op.
# Prefix match is against this script's own (former) namespaces; foreign
# labels (`dependencies`, …) and the `story` marker are never touched.
# Deletion failures warn + count into N_FAILED (exit-40 gate) but never
# block the per-story sync that follows.
remove_duplicated_label_families() {
  load_label_cache
  local label rc stderr_file
  while IFS= read -r label; do
    [ -z "$label" ] && continue
    case "$label" in
      status:*|priority:*|effort:*|type:*|roadmap:*)
        if [ "$DRY_RUN" = "1" ]; then
          printf 'DRY-RUN: would DELETE label "%s"\n' "$label" >&2
          continue
        fi
        stderr_file="$(mktemp)"
        set +e
        "$GH" label delete "$label" --yes >/dev/null 2>"$stderr_file"
        rc=$?
        set -e
        if [ "$rc" -ne 0 ]; then
          printf '::warning::label delete "%s" failed (exit %d): %s\n' \
            "$label" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
          N_FAILED=$((N_FAILED + 1))
        else
          verbose "remove_duplicated_label_families: deleted '${label}'"
          N_LABELS_DELETED=$((N_LABELS_DELETED + 1))
        fi
        rm -f "$stderr_file"
        ;;
    esac
  done <<<"$LABEL_CACHE"
  # Keep the cache honest for the ensure_label calls that follow.
  LABEL_CACHE="$(printf '%s\n' "$LABEL_CACHE" \
    | grep -vE '^(status|priority|effort|type|roadmap):' || true)"
}

# Ensure a label exists. If missing, create it (idempotent on repeat).
# Increments N_LABELS_CREATED on actual creation. On --dry-run, only logs.
ensure_label() {
  local label="$1"
  load_label_cache
  if printf '%s\n' "$LABEL_CACHE" | grep -Fxq -- "$label"; then
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would CREATE label "%s"\n' "$label" >&2
    LABEL_CACHE="${LABEL_CACHE}"$'\n'"$label"
    return 0
  fi
  local color
  color="$(label_default_color "$label")"
  local stderr_file
  stderr_file="$(mktemp)"
  set +e
  "$GH" label create "$label" --color "$color" --description "Auto-created by sync-stories-to-issues" \
    >/dev/null 2>"$stderr_file"
  local rc=$?
  set -e
  # gh returns non-zero on "label already exists" — treat as success (idempotent).
  if [ "$rc" -ne 0 ]; then
    if grep -qiE "already exists|already a label" "$stderr_file"; then
      verbose "ensure_label: label '${label}' already exists (gh returned non-zero but idempotent OK)"
    else
      printf '[gh-error] label create %s (exit %d): %s\n' \
        "$label" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
      rm -f "$stderr_file"
      return 1
    fi
  else
    verbose "ensure_label: created '${label}'"
    N_LABELS_CREATED=$((N_LABELS_CREATED + 1))
  fi
  LABEL_CACHE="${LABEL_CACHE}"$'\n'"$label"
  rm -f "$stderr_file"
  return 0
}

# Build label set (one per line). SHY-0074: exactly ONE mirror label — the
# `story` marker (identifies mirror-managed issues; has no board-column
# equivalent). Status/priority/effort/type/roadmap facts are mirrored as
# Project v2 fields instead (populate_project_fields).
build_labels() {
  printf 'story\n'
}

# Ensure every label for a SHY exists, creating any missing ones. Result is
# the CSV of *verified* labels (those that exist post-call) via the
# VERIFIED_LABELS_CSV global — NOT echoed, because a $(...) capture would run
# this function (and ensure_label's N_LABELS_CREATED increment) in a subshell
# (SHY-0074; same pattern as BODY_RESULT). Labels whose create failed are
# DROPPED from the result so the caller's `gh issue create --label <csv>`
# doesn't fail with "label not found" — addresses reviewer C1.
VERIFIED_LABELS_CSV=""
ensure_labels_for_story() {
  local file="$1"
  local verified_csv="" label
  while IFS= read -r label; do
    [ -z "$label" ] && continue
    if ensure_label "$label"; then
      if [ -z "$verified_csv" ]; then
        verified_csv="$label"
      else
        verified_csv="${verified_csv},${label}"
      fi
    else
      verbose "ensure_labels_for_story: dropping '${label}' (ensure failed) from --label CSV"
    fi
  done < <(build_labels)
  VERIFIED_LABELS_CSV="$verified_csv"
}

# ============================================================== project v2 (Defects D + E)

# Fetch the Project v2 ID + cache field IDs + option IDs. Idempotent.
load_project_cache() {
  if [ -n "$PROJECT_NODE_ID" ]; then return 0; fi
  verbose "load_project_cache: fetching projectV2(number=${PROJECT_NUMBER}, owner=${PROJECT_OWNER})"
  if [ "$DRY_RUN" = "1" ]; then
    PROJECT_NODE_ID="dry-run-project-id"
    return 0
  fi
  local query response stderr_file
  stderr_file="$(mktemp)"
  # Single-line query keeps the recording shape stable for the mock-gh
  # test harness (which splits its recording log by '\n'). Functionally
  # equivalent to the multi-line shape.
  # shellcheck disable=SC2016
  # ^ $owner / $number are GraphQL variables, NOT bash — single-quote is correct.
  query='query($owner: String!, $number: Int!) { organization(login: $owner) { projectV2(number: $number) { id fields(first: 50) { nodes { __typename ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name dataType options { id name } } } } } } }'
  set +e
  response="$("$GH" api graphql -f query="$query" -f owner="$PROJECT_OWNER" -F number="$PROJECT_NUMBER" 2>"$stderr_file")"
  local rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] project lookup (exit %d): %s\n' "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  PROJECT_NODE_ID="$(printf '%s' "$response" | jq -r '.data.organization.projectV2.id // empty')"
  if [ -z "$PROJECT_NODE_ID" ]; then
    emit "project" "lookup" "projectV2(number=${PROJECT_NUMBER}, owner=${PROJECT_OWNER}) not found"
    return 1
  fi
  # Cache field IDs + option IDs as JSON for bash-3 portability.
  PROJECT_FIELDS_JSON="$(printf '%s' "$response" | jq -c '
    [.data.organization.projectV2.fields.nodes[] | {key: .name, value: .id}]
    | from_entries
  ')"
  PROJECT_OPTIONS_JSON="$(printf '%s' "$response" | jq -c '
    [
      .data.organization.projectV2.fields.nodes[]
      | select(.dataType == "SINGLE_SELECT")
      | {
          key: .name,
          value: ([.options[]? | {key: .name, value: .id}] | from_entries)
        }
    ] | from_entries
  ')"
  TYPE_FIELD_ID="$(printf '%s' "$PROJECT_FIELDS_JSON" | jq -r '.["Type"] // empty')"
  verbose "load_project_cache: projectId=${PROJECT_NODE_ID}; fields cached"
  return 0
}

# JSON-map getters (bash-3 compatible alternative to associative arrays).
get_field_id() {
  printf '%s' "$PROJECT_FIELDS_JSON" | jq -r --arg k "$1" '.[$k] // empty'
}
get_option_id() {
  # $1 = field name, $2 = option name
  printf '%s' "$PROJECT_OPTIONS_JSON" | jq -r --arg f "$1" --arg o "$2" '.[$f][$o] // empty'
}
# Setters — used after auto-creating the Type field.
set_field_id() {
  PROJECT_FIELDS_JSON="$(printf '%s' "$PROJECT_FIELDS_JSON" | jq -c --arg k "$1" --arg v "$2" '.[$k] = $v')"
}
set_option_id() {
  PROJECT_OPTIONS_JSON="$(printf '%s' "$PROJECT_OPTIONS_JSON" | jq -c --arg f "$1" --arg o "$2" --arg v "$3" '.[$f][$o] = $v')"
}

# ============================================================== items map (SHY-0074)

# Run-scoped map of every board item keyed by SHY ID, loaded with ONE
# paginated query (100/page) — replaces the previous ~1-per-story
# `gh issue list` searches. Keyed primarily by the SHY ID text field;
# falls back to the `SHY-NNNN:` title prefix for items whose field write
# failed historically. DraftIssue bodies ride along in the same query —
# drafts have no CLI view command, and the body footer is where the
# change-detection hash + status marker live.
ITEMS_MAP_JSON='{}'
ITEMS_RAW_IDS=""
ITEMS_MAP_LOADED=0

# SHY-0078: backoff (seconds) before the empty-read retry. Tests inject 0.
ITEMS_MAP_RETRY_BACKOFF="${ITEMS_MAP_RETRY_BACKOFF:-3}"

# One full paginated read of the board into ITEMS_MAP_JSON + ITEMS_RAW_IDS
# (both reset at entry). Returns 1 on any query/parse failure. Factored out
# of load_items_map so the SHY-0078 empty-read retry can re-run a clean pass.
_items_map_pass() {
  ITEMS_MAP_JSON='{}'
  ITEMS_RAW_IDS=""
  local cursor="" query response stderr_file rc page_map page_ids has_next
  # Single-line query: see note on the projectV2 lookup query above.
  # shellcheck disable=SC2016
  # ^ $owner / $number / $cursor are GraphQL variables, NOT bash.
  query='query($owner: String!, $number: Int!, $cursor: String) { organization(login: $owner) { projectV2(number: $number) { items(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id content { __typename ... on Issue { id number state title } ... on DraftIssue { id title body } } fieldValueByName(name: "SHY ID") { ... on ProjectV2ItemFieldTextValue { text } } } } } } }'
  while :; do
    stderr_file="$(mktemp)"
    set +e
    if [ -n "$cursor" ]; then
      response="$("$GH" api graphql -f query="$query" -f owner="$PROJECT_OWNER" -F number="$PROJECT_NUMBER" -f cursor="$cursor" 2>"$stderr_file")"
    else
      # First page: the cursor variable is omitted entirely (null) — an
      # empty-string cursor would be rejected as an invalid cursor.
      response="$("$GH" api graphql -f query="$query" -f owner="$PROJECT_OWNER" -F number="$PROJECT_NUMBER" 2>"$stderr_file")"
    fi
    rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      printf '[gh-error] projectV2 items query (exit %d): %s\n' "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
      rm -f "$stderr_file"
      return 1
    fi
    rm -f "$stderr_file"
    # Guarded assignment: an empty or shape-mismatched response (jq error /
    # no output) must hit the clean abort path (return 1 → exit 40), not a
    # raw set -e death mid-assignment.
    if ! page_map="$(printf '%s' "$response" | jq -c '
      [ .data.organization.projectV2.items.nodes[]
        | { key: ((.fieldValueByName.text // "") as $f
            | if $f != "" then $f
              else ((.content.title // "") | (capture("^(?<i>SHY-[0-9]{4}):") | .i)? // "")
              end),
            value: {
              itemId: .id,
              backing: (if (.content.__typename // "") == "Issue" then "ISSUE"
                        elif (.content.__typename // "") == "DraftIssue" then "DRAFT"
                        else "OTHER" end),
              contentId: (.content.id // ""),
              issueNumber: (.content.number // 0),
              issueState: (.content.state // ""),
              draftBody: (.content.body // "")
            } }
        | select(.key != "") ]
      | from_entries
    ')" || [ -z "$page_map" ]; then
      printf '[gh-error] projectV2 items query returned an unparsable/empty response: %s\n' \
        "$(printf '%s' "$response" | head -c 200)" >&2
      return 1
    fi
    ITEMS_MAP_JSON="$(jq -c -n --argjson a "$ITEMS_MAP_JSON" --argjson b "$page_map" '$a + $b')"
    # Raw item ids (keyed or not) — the rebuild teardown deletes EVERY item.
    page_ids="$(printf '%s' "$response" | jq -r '.data.organization.projectV2.items.nodes[].id')"
    ITEMS_RAW_IDS="${ITEMS_RAW_IDS}${page_ids}"$'\n'
    has_next="$(printf '%s' "$response" | jq -r '.data.organization.projectV2.items.pageInfo.hasNextPage')"
    if [ "$has_next" = "true" ]; then
      cursor="$(printf '%s' "$response" | jq -r '.data.organization.projectV2.items.pageInfo.endCursor')"
    else
      break
    fi
  done
  return 0
}

# Count of keyed items currently in the map.
_items_map_keyed_count() {
  printf '%s' "$ITEMS_MAP_JSON" | jq 'length'
}

load_items_map() {
  if [ "$ITEMS_MAP_LOADED" = "1" ]; then return 0; fi
  if [ "$DRY_RUN" = "1" ]; then
    # Dry-run makes no gh calls; an empty map previews every story as a create.
    ITEMS_MAP_JSON='{}'
    ITEMS_MAP_LOADED=1
    return 0
  fi
  verbose "load_items_map: paginating projectV2 items (100/page)"
  _items_map_pass || return 1
  # SHY-0078: a zero-item result may be a STALE replica read (Projects v2
  # items is eventually consistent — pronounced shortly after a large
  # mutation) rather than a genuinely empty board. A stale-empty read would
  # route every story to the create path and duplicate the whole board (the
  # defect this story fixes). Retry once after a bounded backoff; if the
  # board is truly empty the retry is a cheap no-op. The consistent-source
  # issue_exists_for guard (create path) is the hard backstop for the
  # harmful case (duplicate ISSUES) when even the retry reads stale.
  if [ "$(_items_map_keyed_count)" -eq 0 ]; then
    verbose "load_items_map: empty on first read; retrying once after ${ITEMS_MAP_RETRY_BACKOFF}s (Projects v2 lag guard)"
    if [ "${ITEMS_MAP_RETRY_BACKOFF:-0}" -gt 0 ] 2>/dev/null; then
      sleep "$ITEMS_MAP_RETRY_BACKOFF"
    fi
    _items_map_pass || return 1
  fi
  ITEMS_MAP_LOADED=1
  verbose "load_items_map: $(_items_map_keyed_count) keyed items"
  return 0
}

# Look up one SHY ID in the items map. Results via MAP_* globals.
MAP_FOUND=0 MAP_ITEM_ID="" MAP_BACKING="" MAP_CONTENT_ID=""
MAP_ISSUE_NUMBER="" MAP_ISSUE_STATE="" MAP_DRAFT_BODY=""
map_lookup() {
  local id="$1" rec
  MAP_FOUND=0 MAP_ITEM_ID="" MAP_BACKING="" MAP_CONTENT_ID=""
  MAP_ISSUE_NUMBER="" MAP_ISSUE_STATE="" MAP_DRAFT_BODY=""
  rec="$(printf '%s' "$ITEMS_MAP_JSON" | jq -r --arg k "$id" \
    'if has($k) then .[$k] | [.itemId, .backing, .contentId, (.issueNumber|tostring), .issueState] | join("\u001f") else empty end')"
  [ -z "$rec" ] && return 0
  IFS=$'\x1f' read -r MAP_ITEM_ID MAP_BACKING MAP_CONTENT_ID MAP_ISSUE_NUMBER MAP_ISSUE_STATE <<<"$rec"
  if [ "$MAP_BACKING" = "DRAFT" ]; then
    # Separate jq call: the body is multi-line and would truncate the
    # one-line \x1f read above.
    MAP_DRAFT_BODY="$(printf '%s' "$ITEMS_MAP_JSON" | jq -r --arg k "$id" '.[$k].draftBody // ""')"
  fi
  MAP_FOUND=1
}

# Ensure the Type single-select field exists on the board. Auto-creates if missing.
ensure_project_type_field() {
  load_project_cache || return 1
  if [ -n "$TYPE_FIELD_ID" ]; then
    verbose "ensure_project_type_field: already present (${TYPE_FIELD_ID})"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would CREATE Project v2 Type field with 7 single-select options\n' >&2
    TYPE_FIELD_ID="dry-run-type-field-id"
    TYPE_FIELD_AUTO_CREATED="yes"
    return 0
  fi
  verbose "ensure_project_type_field: creating Type field"
  local query response stderr_file rc
  stderr_file="$(mktemp)"
  # Single-line: see note on the projectV2 lookup query above.
  # shellcheck disable=SC2016
  # ^ $projectId is a GraphQL variable, NOT bash.
  query='mutation($projectId: ID!) { createProjectV2Field(input: { projectId: $projectId, dataType: SINGLE_SELECT, name: "Type", singleSelectOptions: [ {name: "feature", color: GREEN, description: "type: feature"}, {name: "bug", color: RED, description: "type: bug"}, {name: "refactor", color: PURPLE, description: "type: refactor"}, {name: "docs", color: BLUE, description: "type: docs"}, {name: "infra", color: YELLOW, description: "type: infra"}, {name: "spike", color: PINK, description: "type: spike"}, {name: "chore", color: GRAY, description: "type: chore"} ] }) { projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } } } }'
  set +e
  response="$("$GH" api graphql -f query="$query" -f projectId="$PROJECT_NODE_ID" 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] createProjectV2Field Type (exit %d): %s\n' "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  TYPE_FIELD_ID="$(printf '%s' "$response" | jq -r '.data.createProjectV2Field.projectV2Field.id // empty')"
  if [ -z "$TYPE_FIELD_ID" ]; then
    emit "project" "type-field" "createProjectV2Field returned empty id; response: $(printf '%s' "$response" | head -c 200)"
    return 1
  fi
  # Cache the new field + its options in the JSON maps.
  set_field_id "Type" "$TYPE_FIELD_ID"
  while IFS= read -r opt; do
    [ -z "$opt" ] && continue
    local oname oid
    oname="$(printf '%s' "$opt" | jq -r '.name')"
    oid="$(printf '%s' "$opt" | jq -r '.id')"
    set_option_id "Type" "$oname" "$oid"
  done < <(printf '%s' "$response" | jq -c '.data.createProjectV2Field.projectV2Field.options[]?')
  TYPE_FIELD_AUTO_CREATED="yes"
  verbose "ensure_project_type_field: created Type field id=${TYPE_FIELD_ID}"
  return 0
}

# Add an issue (by node ID) to the Project v2 board. Echoes the project item ID.
# Callers capture the echo via $(...) — a subshell — so the
# N_PROJECT_ITEMS_ADDED increment MUST live at the call sites, not in here
# (SHY-0074: an in-function increment is lost when the subshell exits).
add_to_project_board() {
  local issue_node_id="$1"
  load_project_cache || return 1
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would addProjectV2ItemById(content=%s)\n' "$issue_node_id" >&2
    printf 'dry-run-item-id\n'
    return 0
  fi
  local query response stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ $projectId / $contentId are GraphQL variables, NOT bash.
  query='mutation($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }'
  set +e
  response="$("$GH" api graphql -f query="$query" -f projectId="$PROJECT_NODE_ID" -f contentId="$issue_node_id" 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] addProjectV2ItemById (exit %d): %s\n' "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  local item_id
  item_id="$(printf '%s' "$response" | jq -r '.data.addProjectV2ItemById.item.id // empty')"
  if [ -z "$item_id" ]; then
    emit "project" "item-add" "addProjectV2ItemById returned empty id; response: $(printf '%s' "$response" | head -c 200)"
    return 1
  fi
  printf '%s\n' "$item_id"
  return 0
}

# Set a project item's single-select field via option ID.
set_project_field_select() {
  local item_id="$1" field_id="$2" option_id="$3"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would updateProjectV2ItemFieldValue(item=%s field=%s option=%s)\n' "$item_id" "$field_id" "$option_id" >&2
    return 0
  fi
  local query stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variables, NOT bash.
  query='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } } }'
  set +e
  "$GH" api graphql -f query="$query" \
    -f projectId="$PROJECT_NODE_ID" -f itemId="$item_id" \
    -f fieldId="$field_id" -f optionId="$option_id" \
    >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] updateProjectV2ItemFieldValue single-select (exit %d): %s\n' "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  N_PROJECT_FIELDS_UPDATED=$((N_PROJECT_FIELDS_UPDATED + 1))
  return 0
}

# Set a project item's text field.
set_project_field_text() {
  local item_id="$1" field_id="$2" text_value="$3"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would updateProjectV2ItemFieldValue(item=%s field=%s text="%s")\n' "$item_id" "$field_id" "$text_value" >&2
    return 0
  fi
  local query stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variables, NOT bash.
  query='mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) { updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { text: $text } }) { projectV2Item { id } } }'
  set +e
  "$GH" api graphql -f query="$query" \
    -f projectId="$PROJECT_NODE_ID" -f itemId="$item_id" \
    -f fieldId="$field_id" -f text="$text_value" \
    >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] updateProjectV2ItemFieldValue text (exit %d): %s\n' "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  N_PROJECT_FIELDS_UPDATED=$((N_PROJECT_FIELDS_UPDATED + 1))
  return 0
}

# SHY-0074: lifecycle status → built-in board Status option name. The five
# option names were verified live against the ShyTalk Stories board on
# 2026-06-10 (Todo / In Progress / In Review / Done / Cancelled — exact,
# case-sensitive). Input is the lowercased-hyphenated PS_STATUS_LC form.
# Unknown values echo empty (frontmatter validator prevents them upstream;
# this is defense in depth).
status_board_option() {
  case "$1" in
    draft)       echo "Todo" ;;
    in-progress) echo "In Progress" ;;
    in-review)   echo "In Review" ;;
    done)        echo "Done" ;;
    cancelled)   echo "Cancelled" ;;
    *)           echo "" ;;
  esac
}

# Populate every applicable Project v2 field for the given item from frontmatter.
populate_project_fields() {
  local item_id="$1" file="$2" id="$3"
  # SHY-0040: fields come from the PS_* globals (parse_story_fields ran
  # in sync_one) — the story file is read exactly once per sync_one.
  local pri effort type roadmaps
  pri="$PS_PRIORITY"
  effort="$PS_EFFORT"
  type="$PS_TYPE"
  roadmaps="${PS_ROADMAPS//,/, }"
  # Epic field is deferred to a follow-up SHY (the board currently has 3-digit
  # option names like "EPIC-001" but SHY frontmatter uses 4-digit "EPIC-0001";
  # the operator-side schema fix + option-name reconciliation is tracked
  # separately so this PR can ship without dragging in board-schema editing).

  local pri_field pri_opt effort_field effort_opt type_field type_opt shyid_field roadmap_field
  pri_field="$(get_field_id "Pri")"
  effort_field="$(get_field_id "Effort")"
  type_field="$(get_field_id "Type")"
  shyid_field="$(get_field_id "SHY ID")"
  roadmap_field="$(get_field_id "Roadmap IDs")"

  # Pri (single-select) — reviewer-I6: failure must bubble up (N_FAILED++ at
  # the call site of populate_project_fields). The setter already emits a
  # `[gh-error]` log + returns 1; we just propagate that here instead of
  # masking it. Empty option-id is a config gap (not a runtime error), so
  # the `[ -n "$pri_opt" ]` no-op path still returns 0.
  if [ -n "$pri" ] && [ -n "$pri_field" ]; then
    pri_opt="$(get_option_id "Pri" "$pri")"
    if [ -n "$pri_opt" ]; then
      set_project_field_select "$item_id" "$pri_field" "$pri_opt" || return 1
    fi
  fi
  # Effort (single-select)
  if [ -n "$effort" ] && [ -n "$effort_field" ]; then
    effort_opt="$(get_option_id "Effort" "$effort")"
    if [ -n "$effort_opt" ]; then
      set_project_field_select "$item_id" "$effort_field" "$effort_opt" || return 1
    fi
  fi
  # Type (single-select; relies on ensure_project_type_field having run)
  if [ -n "$type" ] && [ -n "$type_field" ]; then
    type_opt="$(get_option_id "Type" "$type")"
    if [ -n "$type_opt" ]; then
      set_project_field_select "$item_id" "$type_field" "$type_opt" || return 1
    fi
  fi
  # SHY ID (text)
  if [ -n "$shyid_field" ]; then
    set_project_field_text "$item_id" "$shyid_field" "$id" || return 1
  fi
  # Roadmap IDs (text)
  if [ -n "$roadmaps" ] && [ -n "$roadmap_field" ]; then
    set_project_field_text "$item_id" "$roadmap_field" "$roadmaps" || return 1
  fi

  # Status (built-in single-select; SHY-0074 — the board-column defect).
  # Deliberately LAST: for new items GitHub's built-in "Item added → Todo"
  # automation also writes Status, and last-writer-wins makes the script's
  # value stick. Missing field/option = config gap (warn + continue);
  # mutation failure = runtime failure (bubbles to exit 40).
  local status_field status_opt_name status_opt
  status_field="$(get_field_id "Status")"
  if [ -z "$status_field" ]; then
    printf '::warning::%s: Status field missing from the Project v2 board — board column not set\n' "$id" >&2
  else
    status_opt_name="$(status_board_option "$PS_STATUS_LC")"
    if [ -z "$status_opt_name" ]; then
      printf '::warning::%s: unknown status "%s" — board column not set\n' "$id" "$PS_STATUS_LC" >&2
    else
      status_opt="$(get_option_id "Status" "$status_opt_name")"
      if [ -z "$status_opt" ]; then
        printf '::warning::%s: Status option "%s" missing from the board — board column not set\n' "$id" "$status_opt_name" >&2
      else
        set_project_field_select "$item_id" "$status_field" "$status_opt" || return 1
        N_STATUS_SET=$((N_STATUS_SET + 1))
      fi
    fi
  fi
  return 0
}

# ============================================================== draft items + deletions (SHY-0074)

# Create a board DRAFT item for a non-bug story. Echoes the new project
# item id. The body travels via stdin (-F body=@-): 64K spec bodies in
# argv would flirt with ARG_MAX and break line-oriented logging.
# Callers capture the echo via $(...) — counter increments live at the
# call sites (subshell rule).
create_draft_item() {
  local title="$1" body="$2"
  load_project_cache || return 1
  local query response stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variables, NOT bash.
  query='mutation($projectId: ID!, $title: String!, $body: String!) { addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) { projectItem { id } } }'
  set +e
  response="$(printf '%s' "$body" | "$GH" api graphql -f query="$query" -f projectId="$PROJECT_NODE_ID" -f title="$title" -F body=@- 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] addProjectV2DraftIssue "%s" (exit %d): %s\n' \
      "$title" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  local item_id
  item_id="$(printf '%s' "$response" | jq -r '.data.addProjectV2DraftIssue.projectItem.id // empty')"
  if [ -z "$item_id" ]; then
    emit "project" "draft-add" "addProjectV2DraftIssue returned empty id; response: $(printf '%s' "$response" | head -c 200)"
    return 1
  fi
  printf '%s\n' "$item_id"
  return 0
}

# Refresh an existing draft item's title + body. $1 is the DraftIssue
# CONTENT id (content.id from the items map), not the project item id.
update_draft_item() {
  local draft_id="$1" title="$2" body="$3"
  local query stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variables, NOT bash.
  query='mutation($draftIssueId: ID!, $title: String!, $body: String!) { updateProjectV2DraftIssue(input: { draftIssueId: $draftIssueId, title: $title, body: $body }) { draftIssue { id } } }'
  set +e
  printf '%s' "$body" | "$GH" api graphql -f query="$query" -f draftIssueId="$draft_id" -f title="$title" -F body=@- \
    >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] updateProjectV2DraftIssue %s (exit %d): %s\n' \
      "$draft_id" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  return 0
}

# Delete a board item (draft content dies with it; issue content survives
# off-board). Used by the type-flip recreation path + --rebuild teardown.
delete_project_item() {
  local item_id="$1"
  load_project_cache || return 1
  local query stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variables, NOT bash.
  query='mutation($projectId: ID!, $itemId: ID!) { deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { deletedItemId } }'
  set +e
  "$GH" api graphql -f query="$query" -f projectId="$PROJECT_NODE_ID" -f itemId="$item_id" \
    >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] deleteProjectV2Item %s (exit %d): %s\n' \
      "$item_id" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  return 0
}

# Delete an issue outright (--rebuild teardown only). Fine-grained PATs may
# lack issue-delete: surface that loudly with an actionable message and let
# the teardown continue — operator either grants the scope or cleans up
# manually. Increments its own counters (called directly, never $()-captured).
delete_issue_node() {
  local num="$1" node_id="$2"
  local query stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variable, NOT bash.
  query='mutation($issueId: ID!) { deleteIssue(input: { issueId: $issueId }) { clientMutationId } }'
  set +e
  "$GH" api graphql -f query="$query" -f issueId="$node_id" >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    if grep -qiE 'permission|scope|forbidden|not accessible' "$stderr_file"; then
      printf '::warning::deleteIssue #%s denied — GH_PAT_PROJECT lacks issue-delete permission. Grant the PAT admin-level issue deletion (or delete manually) and re-run --rebuild: %s\n' \
        "$num" "$(tr '\n' ' ' <"$stderr_file")" >&2
    else
      printf '::warning::deleteIssue #%s failed (exit %d): %s\n' \
        "$num" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    fi
    rm -f "$stderr_file"
    N_FAILED=$((N_FAILED + 1))
    return 1
  fi
  rm -f "$stderr_file"
  N_ISSUES_DELETED=$((N_ISSUES_DELETED + 1))
  return 0
}

# ============================================================== issue lifecycle (SHY-0074)

# Post the status-transition comment on a bug issue. Bug issues only —
# drafts have no timeline. Increments its own counter (direct call).
post_status_comment() {
  local num="$1" old="$2" new="$3"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would COMMENT on issue #%s: "Status: %s → %s"\n' "$num" "$old" "$new" >&2
    return 0
  fi
  local stderr_file rc
  stderr_file="$(mktemp)"
  set +e
  "$GH" issue comment "$num" --body "Status: ${old} → ${new}" >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] issue comment %s (exit %d): %s\n' \
      "$num" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  N_COMMENTS_POSTED=$((N_COMMENTS_POSTED + 1))
  return 0
}

# Close an issue with a reason + optional comment.
close_issue() {
  local num="$1" reason="$2" comment="$3"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would CLOSE issue #%s (reason: %s)\n' "$num" "$reason" >&2
    return 0
  fi
  local stderr_file rc
  stderr_file="$(mktemp)"
  set +e
  if [ -n "$comment" ]; then
    "$GH" issue close "$num" --reason "$reason" --comment "$comment" >/dev/null 2>"$stderr_file"
  else
    "$GH" issue close "$num" --reason "$reason" >/dev/null 2>"$stderr_file"
  fi
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] issue close %s (exit %d): %s\n' \
      "$num" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  N_ISSUES_CLOSED=$((N_ISSUES_CLOSED + 1))
  return 0
}

# Close a bug issue when its story sits in a terminal state. Runs on every
# touch of an OPEN bug issue (created, updated, or unchanged-but-open) so a
# previously failed close self-heals. Done ⇒ completed (naming released_in
# when the frontmatter carries it); Cancelled ⇒ "not planned".
close_if_terminal() {
  local id="$1" num="$2" state="$3"
  case "$PS_STATUS_LC" in
    done|cancelled) ;;
    *) return 0 ;;
  esac
  [ "$state" = "OPEN" ] || return 0
  local reason="completed" comment=""
  if [ "$PS_STATUS_LC" = "cancelled" ]; then
    reason="not planned"
  elif [ -n "$PS_RELEASED_IN" ]; then
    comment="Released in ${PS_RELEASED_IN}"
  fi
  if ! close_issue "$num" "$reason" "$comment"; then
    emit "$id" "api" "failed to close issue #${num}"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi
  verbose "${id}: closed issue #${num} (${reason})"
  return 0
}

# ============================================================== body builders (SHY-0074)

# Shared footer: absolute Source URL + `_Status: X_` lifecycle marker +
# Last-synced change-detection line. The Status marker is what makes
# transition detection STATELESS — status lives in frontmatter, OUTSIDE
# the body hash, so a pure status flip would otherwise be invisible.
build_footer() {
  local slug="$1" hash="$2"
  local now sha
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  sha="$(cd "$REPO_ROOT" && git rev-parse HEAD 2>/dev/null || echo "unknown")"
  printf -- '---\n\n_Source: https://github.com/Shyden-Ltd/ShyTalk/blob/main/.project/stories/%s.md_\n_Status: %s_\n_Last synced: %s from commit %s body-hash: %s_' \
    "$slug" "$PS_STATUS" "$now" "$sha" "$hash"
}

# Assemble content + footer into BODY_RESULT, truncating oversize content.
#
# Results land in the BODY_RESULT/BODY-counter globals rather than stdout:
# `body="$(assemble_body …)"` would run the function in a subshell and
# silently discard the N_BODIES_TRUNCATED increment.
#
# Oversize handling: GitHub caps issue bodies at 65,536 characters (drafts
# get the same budget for symmetry). Length is measured with bash ${#…}
# (bytes under C locale, chars under UTF-8 — bytes ≥ chars, so the cap is
# never exceeded either way). Content is cut at the last whole line that
# fits, an explicit truncation notice is appended, and the footer always
# survives intact.
GITHUB_BODY_LIMIT=65536
BODY_RESULT=""
assemble_body() {
  local content="$1" footer="$2"
  local total=$(( ${#content} + 2 + ${#footer} + 1 ))
  if [ "$total" -gt "$GITHUB_BODY_LIMIT" ]; then
    local notice_reserve=120
    local budget=$(( GITHUB_BODY_LIMIT - ${#footer} - notice_reserve ))
    local kept="${content:0:$budget}"
    kept="${kept%$'\n'*}" # cut at a whole-line boundary
    local omitted=$(( ${#content} - ${#kept} ))
    content="${kept}"$'\n\n'"…_[spec truncated — ${omitted} chars omitted; read the full file at the Source link]_"
    N_BODIES_TRUNCATED=$((N_BODIES_TRUNCATED + 1))
  fi
  BODY_RESULT="$(printf '%s\n\n%s' "$content" "$footer")"$'\n'
}

# Draft-item body (non-bug stories): the FULL spec — everything after the
# closing frontmatter delimiter, verbatim — + footer. The board card IS
# the spec.
build_draft_body() {
  local file="$1" hash="$2"
  local slug spec footer
  slug="$(basename "$file" .md)"
  # Same after-frontmatter extraction as body_hash — the embedded spec and
  # the change-detection hash are computed over the identical byte range.
  spec="$(awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n>=2{print}' "$file")"
  footer="$(build_footer "$slug" "$hash")"
  assemble_body "$spec" "$footer"
}

# Bug-report body (type: bug stories): the issue reads as a bug report —
# ## Bug carries the story's ## Why section (the symptom) verbatim;
# ## Tracking links the story file + board and states the lifecycle
# status. The full spec stays on the board card / in the .md.
build_bug_body() {
  local file="$1" id="$2" hash="$3"
  local slug why footer content
  slug="$(basename "$file" .md)"
  # ## Why section: body lines between the `## Why` heading and the next
  # `## ` heading, leading blank lines stripped (trailing ones die in the
  # command substitution).
  why="$(awk 'BEGIN{n=0; f=0} /^---[[:space:]]*$/{n++; next} n<2{next} /^## Why[[:space:]]*$/{f=1; next} /^## /{f=0} f{print}' "$file" \
    | sed -e '/./,$!d')"
  footer="$(build_footer "$slug" "$hash")"
  content="$(printf -- '## Bug\n\n%s\n\n## Tracking\n\n- Source: [.project/stories/%s.md](https://github.com/Shyden-Ltd/ShyTalk/blob/main/.project/stories/%s.md)\n- Tracked as %s on the [ShyTalk Stories board](https://github.com/orgs/Shyden-Ltd/projects/1)\n- Status: %s' \
    "$why" "$slug" "$slug" "$id" "$PS_STATUS")"
  assemble_body "$content" "$footer"
}

# ============================================================== stored-state extraction (SHY-0074)

# Extract the stored body-hash from an existing mirror body. Anchored on
# the footer line (line-start `_Last synced:` prefix) and the LAST match
# wins — embedded specs may legitimately contain the literal string
# `body-hash:` (stories documenting this very footer), and an unanchored
# first-match would extract the wrong hash, wedging the story into a
# permanent re-sync (or permanent skip).
extract_stored_hash() {
  printf '%s\n' "$1" | sed -n 's/^_Last synced: .*body-hash: \([a-f0-9]*\).*/\1/p' | tail -n 1
}

# Extract the stored `_Status: X_` lifecycle marker. Same anchoring +
# last-match rationale as the hash.
extract_stored_status() {
  printf '%s\n' "$1" | sed -n 's/^_Status: \(.*\)_$/\1/p' | tail -n 1
}

# SHY-0067: Create an issue with title + body (via stdin) + labels.
# Echoes the gh-stdout (URL OR JSON when --json is used) so the caller can
# parse the new issue's number and node_id for follow-on project-board
# addition. On failure, captures stderr context (no >/dev/null silencing) +
# returns non-zero.
create_issue() {
  local title="$1" body="$2" labels_csv="$3"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would CREATE issue with title "%s" labels=%s\n' "$title" "$labels_csv" >&2
    # Emit JSON-shaped dry-run output so the caller's jq parse stays consistent.
    printf '{"id":"DRY_RUN_NODE_ID","number":0,"url":"https://github.com/dry-run/dry-run/issues/0"}\n'
    return 0
  fi
  local stderr_file rc
  stderr_file="$(mktemp)"
  # SHY-0067: --body-file - reads from stdin (heredoc). Avoids shell-escape
  # bugs for SHYs with single quotes / backticks / multi-line markdown that
  # would corrupt --body "$body" argv passing.
  set +e
  printf '%s' "$body" \
    | "$GH" issue create --title "$title" --body-file - --label "$labels_csv" \
        2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] issue create "%s" (exit %d): %s\n' \
      "$title" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  return 0
}

# SHY-0067: After a successful create, derive the issue's node ID + number.
# Strategy: gh issue create's default stdout is a URL; parse the number,
# then `gh issue view <num> --json id` for the node ID. Two API calls but
# keeps the flow simple + works on all gh versions. Mock-test fixtures
# can return either a URL string OR the node-id JSON directly.
extract_issue_node_id() {
  # $1 = stdout from create_issue (URL on stdout, possibly trailing newline)
  local create_stdout="$1"
  local issue_num
  # Trim trailing newline + extract trailing path segment (the issue number).
  issue_num="$(printf '%s' "$create_stdout" | tr -d '\n' | awk -F/ '{print $NF}')"
  if [ -z "$issue_num" ] || ! printf '%s' "$issue_num" | grep -qE '^[0-9]+$'; then
    return 1
  fi
  # Now ask gh for the node ID.
  local stderr_file rc node_id
  stderr_file="$(mktemp)"
  set +e
  node_id="$("$GH" issue view "$issue_num" --json id --jq '.id' 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ] || [ -z "$node_id" ]; then
    if [ "$rc" -ne 0 ]; then
      printf '[gh-error] issue view %s for node id (exit %d): %s\n' \
        "$issue_num" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    fi
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  printf '%s\n' "$node_id"
  return 0
}

# SHY-0067: Update an issue's body via stdin (same rationale as create_issue).
update_issue_body() {
  local issue_num="$1" new_body="$2"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would UPDATE issue #%s (body-hash changed)\n' "$issue_num" >&2
    return 0
  fi
  local stderr_file rc
  stderr_file="$(mktemp)"
  set +e
  printf '%s' "$new_body" \
    | "$GH" issue edit "$issue_num" --body-file - \
        2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] issue edit %s (exit %d): %s\n' \
      "$issue_num" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  return 0
}

# ============================================================== sync orchestration

# ---- create paths --------------------------------------------------------

# Create a board DRAFT item for a non-bug story (SHY-0074 v2 routing).
create_draft_path() {
  local file="$1" id="$2" title="$3" hash="$4"
  # Result via global (subshell would lose the truncation counter).
  build_draft_body "$file" "$hash"
  local body="$BODY_RESULT"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: %s: would CREATE DRAFT item "%s" (full-spec body) + populate fields\n' "$id" "$title" >&2
    N_CREATED=$((N_CREATED + 1))
    N_DRAFTS_CREATED=$((N_DRAFTS_CREATED + 1))
    return 0
  fi
  local item_id
  # Counter increments live HERE, not in create_draft_item: the $(...)
  # capture runs the function in a subshell where increments are lost.
  if ! item_id="$(create_draft_item "$title" "$body")"; then
    emit "$id" "api" "failed to create draft item"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi
  N_CREATED=$((N_CREATED + 1))
  N_DRAFTS_CREATED=$((N_DRAFTS_CREATED + 1))
  N_BODIES_EMBEDDED=$((N_BODIES_EMBEDDED + 1))
  N_PROJECT_ITEMS_ADDED=$((N_PROJECT_ITEMS_ADDED + 1))
  emit "$id" "created" "draft item created"
  if ! populate_project_fields "$item_id" "$file" "$id"; then
    emit "$id" "project" "failed to populate fields for item ${item_id}"
    N_FAILED=$((N_FAILED + 1))
  fi
  return 0
}

# SHY-0078: consistent-source existence check. The Issues SEARCH API is
# strongly consistent (unlike the eventually-consistent Projects v2 items
# query), so this is the hard backstop against creating a DUPLICATE issue
# when a stale-empty items-map read routes an already-mirrored bug story to
# the create path. Sets EXISTING_ISSUE_NUM on a prefix-exact hit. Returns:
#   0 = an issue titled "SHY-NNNN: …" already exists
#   1 = no such issue
#   2 = the search itself failed (gh error) — caller must NOT create on this
EXISTING_ISSUE_NUM=""
issue_exists_for() {
  local id="$1"
  EXISTING_ISSUE_NUM=""
  # Dry-run never calls gh: report "none" so the create-path preview fires.
  if [ "$DRY_RUN" = "1" ]; then return 1; fi
  local stderr_file out rc
  stderr_file="$(mktemp)"
  set +e
  # The `startswith("${id}:")` --jq filter is PREFIX-EXACT (the trailing
  # colon means SHY-0007 never matches SHY-0070), so GitHub's fuzzy title
  # search can't cause a false dedup hit.
  out="$("$GH" issue list --state all --search "in:title \"${id}:\"" --json number,title \
    --jq ".[] | select(.title | startswith(\"${id}:\")) | .number" 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] dedup issue search for %s (exit %d): %s\n' \
      "$id" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 2
  fi
  rm -f "$stderr_file"
  EXISTING_ISSUE_NUM="$(printf '%s\n' "$out" | head -n 1)"
  [ -n "$EXISTING_ISSUE_NUM" ] && return 0 || return 1
}

# Create a bug-report ISSUE + its issue-backed board item (type: bug).
create_issue_path() {
  local file="$1" id="$2" title="$3" hash="$4"
  # SHY-0078: idempotency guard. We only reach create_issue_path because the
  # (eventually-consistent) items map had no entry for this SHY. Before
  # creating, confirm against the CONSISTENT Issues API that no issue already
  # exists — otherwise a stale-empty map read would duplicate it. On a hit we
  # skip the create (no duplicate); the next fresh-map sync refreshes its
  # body/fields. On a search error we refuse to create (create-on-uncertainty
  # is what produced the duplication defect).
  # set-e-safe 3-way capture: issue_exists_for re-enables errexit internally
  # (after its own gh call), so a bare call returning non-zero would trip
  # set -e. `|| dedup_rc=$?` is exempt from errexit and captures all of 0/1/2.
  local dedup_rc=0
  issue_exists_for "$id" || dedup_rc=$?
  if [ "$dedup_rc" -eq 2 ]; then
    emit "$id" "api" "dedup existence check failed — not creating (avoids duplicate)"
    N_FAILED=$((N_FAILED + 1))
    return 0
  elif [ "$dedup_rc" -eq 0 ]; then
    emit "$id" "dedup" "existing issue #${EXISTING_ISSUE_NUM} found via consistent-source check; skipping create (stale items-map suspected — will refresh next sync)"
    N_DEDUP_GUARD_HITS=$((N_DEDUP_GUARD_HITS + 1))
    N_SKIPPED=$((N_SKIPPED + 1))
    return 0
  fi
  # SHY-0067: ensure labels exist before issue create (Defect B fix). The
  # function yields the CSV of *verified* labels (reviewer C1) so the gh
  # issue create --label flag won't be rejected on a label that failed to
  # create. Result via global, not $(...): subshell loses N_LABELS_CREATED.
  local verified_labels
  ensure_labels_for_story "$file"
  verified_labels="$VERIFIED_LABELS_CSV"
  # Result via global (subshell would lose the truncation counter).
  build_bug_body "$file" "$id" "$hash"
  local body="$BODY_RESULT"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: %s: would CREATE issue (bug report) "%s" labels=%s + board item + fields\n' \
      "$id" "$title" "$verified_labels" >&2
    N_CREATED=$((N_CREATED + 1))
    N_ISSUES_CREATED=$((N_ISSUES_CREATED + 1))
    return 0
  fi
  # SHY-0067: capture create stdout (URL) so we can derive number + node_id.
  local create_response
  set +e
  create_response="$(create_issue "$title" "$body" "$verified_labels")"
  local create_rc=$?
  set -e
  if [ "$create_rc" -ne 0 ]; then
    emit "$id" "api" "failed to create issue"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi
  N_CREATED=$((N_CREATED + 1))
  N_ISSUES_CREATED=$((N_ISSUES_CREATED + 1))
  N_BODIES_EMBEDDED=$((N_BODIES_EMBEDDED + 1))
  emit "$id" "created" "bug issue created"

  local issue_num node_id item_id view_rc
  issue_num="$(printf '%s' "$create_response" | tr -d '\n' | awk -F/ '{print $NF}')"
  # SHY-0074 reviewer-C1: node-id resolution failure must surface ([gh-error]
  # flows through) + count into the exit-40 gate — a `2>/dev/null || true`
  # swallow here left a created issue with NO board card and exit 0.
  set +e
  node_id="$(extract_issue_node_id "$create_response")"
  view_rc=$?
  set -e
  if [ "$view_rc" -ne 0 ] || [ -z "$node_id" ]; then
    emit "$id" "project" "failed to resolve node_id for new issue — board add skipped"
    N_FAILED=$((N_FAILED + 1))
  else
    # SHY-0067 reviewer-I6: board-add / field-set failures must count into
    # the Defect-C exit-40 gate, never `|| true`-swallowed.
    if item_id="$(add_to_project_board "$node_id")"; then
      N_PROJECT_ITEMS_ADDED=$((N_PROJECT_ITEMS_ADDED + 1))
      if [ -n "$item_id" ]; then
        if ! populate_project_fields "$item_id" "$file" "$id"; then
          emit "$id" "project" "failed to populate fields for item ${item_id}"
          N_FAILED=$((N_FAILED + 1))
        fi
      fi
    else
      emit "$id" "project" "failed to add issue node ${node_id} to project board"
      N_FAILED=$((N_FAILED + 1))
    fi
  fi

  # A bug born terminal (e.g. rebuild recreating a Done story) closes
  # immediately — the Issues tab reads closed = fixed/not-planned.
  if printf '%s' "$issue_num" | grep -qE '^[0-9]+$'; then
    close_if_terminal "$id" "$issue_num" "OPEN"
  fi
  return 0
}

# ---- sync_one (SHY-0074 v2 routing) ---------------------------------------

# Sync one story file. Returns 0 always (failures increment N_FAILED).
sync_one() {
  local file="$1"
  local id
  parse_story_fields "$file"
  id="$PS_ID"
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

  local hash title raw_title
  hash="$(body_hash "$file")"
  raw_title="$PS_TITLE"
  raw_title="${raw_title#"${id}": }"
  title="${id}: ${raw_title}"

  # Routing: bugs are ISSUE-backed (bug report on the Issues tab); every
  # other type is a board DRAFT item. The Issues tab is bugs-only.
  local desired="DRAFT"
  [ "$PS_TYPE" = "bug" ] && desired="ISSUE"

  map_lookup "$id"

  # Type flip: the existing backing no longer matches the story's type —
  # delete the stale item and recreate the correct backing.
  if [ "$MAP_FOUND" = "1" ] && [ "$MAP_BACKING" != "$desired" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      printf 'DRY-RUN: %s: type flip — would DELETE %s-backed item and recreate as %s\n' \
        "$id" "$MAP_BACKING" "$desired" >&2
      MAP_FOUND=0
    else
      emit "$id" "type-flip" "type flip: story type is now ${PS_TYPE}; replacing ${MAP_BACKING}-backed item with ${desired}"
      if ! delete_project_item "$MAP_ITEM_ID"; then
        # Don't create a duplicate backing while the stale one survives.
        emit "$id" "project" "failed to delete item ${MAP_ITEM_ID} during type flip"
        N_FAILED=$((N_FAILED + 1))
        return 0
      fi
      N_ITEMS_DELETED=$((N_ITEMS_DELETED + 1))
      if [ "$MAP_BACKING" = "ISSUE" ] && [ "$MAP_ISSUE_STATE" = "OPEN" ]; then
        # bug→non-bug: the issue is orphaned (story is no longer a bug).
        if ! close_issue "$MAP_ISSUE_NUMBER" "not planned" ""; then
          emit "$id" "api" "failed to close orphaned issue #${MAP_ISSUE_NUMBER} during type flip"
          N_FAILED=$((N_FAILED + 1))
        fi
      fi
      MAP_FOUND=0
    fi
  fi

  # ---- create path
  if [ "$MAP_FOUND" != "1" ]; then
    if [ "$desired" = "DRAFT" ]; then
      create_draft_path "$file" "$id" "$title" "$hash"
    else
      create_issue_path "$file" "$id" "$title" "$hash"
    fi
    return 0
  fi

  # ---- update path: change detection via the stored footer.
  local existing_body=""
  if [ "$MAP_BACKING" = "DRAFT" ]; then
    existing_body="$MAP_DRAFT_BODY"
  else
    local stderr_file
    stderr_file="$(mktemp)"
    set +e
    existing_body="$("$GH" issue view "$MAP_ISSUE_NUMBER" --json body --jq .body 2>"$stderr_file" || echo "")"
    set -e
    rm -f "$stderr_file"
  fi

  local existing_hash existing_status changed=0 transition=0
  existing_hash="$(extract_stored_hash "$existing_body")"
  existing_status="$(extract_stored_status "$existing_body")"
  [ "$existing_hash" != "$hash" ] && changed=1
  if [ -n "$existing_status" ] && [ "$existing_status" != "$PS_STATUS" ]; then
    transition=1
  fi

  if [ "$changed" = "0" ] && [ "$transition" = "0" ]; then
    # Self-heal: an OPEN bug issue whose story is terminal closes even on a
    # no-change run (covers a previously failed close).
    if [ "$MAP_BACKING" = "ISSUE" ]; then
      close_if_terminal "$id" "$MAP_ISSUE_NUMBER" "$MAP_ISSUE_STATE"
    fi
    verbose "${id}: body-hash + status unchanged; skipping"
    N_SKIPPED=$((N_SKIPPED + 1))
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: %s: would UPDATE %s-backed item (changed=%s transition=%s)\n' \
      "$id" "$MAP_BACKING" "$changed" "$transition" >&2
    N_UPDATED=$((N_UPDATED + 1))
    return 0
  fi

  # Transition comment FIRST (bug issues only — drafts have no timeline),
  # then the body refresh writes the new `_Status:` marker.
  if [ "$MAP_BACKING" = "ISSUE" ] && [ "$transition" = "1" ]; then
    if ! post_status_comment "$MAP_ISSUE_NUMBER" "$existing_status" "$PS_STATUS"; then
      emit "$id" "api" "failed to post status comment on issue #${MAP_ISSUE_NUMBER}"
      N_FAILED=$((N_FAILED + 1))
      # Continue: the body refresh must not be blocked by a comment failure.
    fi
  fi

  if [ "$MAP_BACKING" = "DRAFT" ]; then
    # Result via global (subshell would lose the truncation counter).
    build_draft_body "$file" "$hash"
    if ! update_draft_item "$MAP_CONTENT_ID" "$title" "$BODY_RESULT"; then
      emit "$id" "api" "failed to update draft item ${MAP_ITEM_ID}"
      N_FAILED=$((N_FAILED + 1))
      return 0
    fi
    emit "$id" "updated" "draft item body refreshed"
  else
    build_bug_body "$file" "$id" "$hash"
    if ! update_issue_body "$MAP_ISSUE_NUMBER" "$BODY_RESULT"; then
      emit "$id" "api" "failed to update issue #${MAP_ISSUE_NUMBER}"
      N_FAILED=$((N_FAILED + 1))
      return 0
    fi
    emit "$id" "updated" "issue #${MAP_ISSUE_NUMBER} body refreshed"
  fi
  N_UPDATED=$((N_UPDATED + 1))
  N_BODIES_EMBEDDED=$((N_BODIES_EMBEDDED + 1))

  # Re-assert all board fields on the EXISTING item (no re-add needed —
  # the items map already carries the item id).
  if ! populate_project_fields "$MAP_ITEM_ID" "$file" "$id"; then
    emit "$id" "project" "failed to refresh fields for item ${MAP_ITEM_ID}"
    N_FAILED=$((N_FAILED + 1))
  fi

  # Close on terminal states (bug issues only), AFTER the board reflects
  # the final column + the body carries the final marker.
  if [ "$MAP_BACKING" = "ISSUE" ]; then
    close_if_terminal "$id" "$MAP_ISSUE_NUMBER" "$MAP_ISSUE_STATE"
  fi
}

# --rebuild teardown (SHY-0074, REBUILD_CONFIRM-gated in main): delete
# EVERY board item (keyed or not) + every story-labeled issue, then reset
# the items map so the fresh sync that follows CREATEs everything.
teardown_for_rebuild() {
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would tear down the board (delete every project item) + delete every story-labeled issue, then resync fresh\n' >&2
    return 0
  fi
  emit "rebuild" "teardown" "deleting all board items + story-labeled issues (REBUILD_CONFIRM=yes)"

  local item_id
  while IFS= read -r item_id; do
    [ -z "$item_id" ] && continue
    if delete_project_item "$item_id"; then
      N_ITEMS_DELETED=$((N_ITEMS_DELETED + 1))
    else
      emit "rebuild" "project" "failed to delete item ${item_id}"
      N_FAILED=$((N_FAILED + 1))
    fi
  done <<<"$ITEMS_RAW_IDS"

  # Mirror-created issues all carry the `story` marker label.
  local stderr_file rc pairs num node
  stderr_file="$(mktemp)"
  set +e
  # shellcheck disable=SC2016
  # ^  inside the --jq program is jq's escape, NOT bash.
  pairs="$("$GH" issue list --state all --label story --limit 1000 --json number,id \
    --jq '.[] | "\(.number)\u001f\(.id)"' 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] issue list --label story (exit %d): %s\n' \
      "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    N_FAILED=$((N_FAILED + 1))
    pairs=""
  fi
  rm -f "$stderr_file"
  while IFS=$'\x1f' read -r num node; do
    [ -z "$num" ] && continue
    # delete_issue_node warns + counts its own failures and continues.
    delete_issue_node "$num" "$node" || true
  done <<<"$pairs"

  # The board is now empty: reset the map so the sync below creates fresh.
  # SHY-0074 reviewer-I2: also reset the loaded flag so any future
  # load_items_map caller re-queries instead of silently reusing the
  # post-teardown empty state.
  ITEMS_MAP_JSON='{}'
  ITEMS_RAW_IDS=""
  ITEMS_MAP_LOADED=0
  verbose "teardown_for_rebuild: done (items deleted: ${N_ITEMS_DELETED}; issues deleted: ${N_ISSUES_DELETED})"
}

sync_all() {
  if [ ! -d "$STORIES_DIR" ]; then
    fail_global "config" "stories directory not found: $STORIES_DIR" "$E_USAGE"
  fi

  # SHY-0074: ONE paginated items query feeds every create-vs-update
  # decision. Without it those decisions would be wrong — abort before
  # any mutations.
  load_items_map \
    || fail_global "project" "items-map query failed — aborting before any mutations" "$E_API"

  # SHY-0067: setup phase — ensure Type field exists before per-story sync
  # (Defect E). load_project_cache is also called transitively but explicit
  # call here makes the workflow log clearer.
  if [ "$DRY_RUN" != "1" ]; then
    load_project_cache || true
    ensure_project_type_field || true
  fi

  # SHY-0074: one-shot v1→v2 migration (gated on REBUILD_CONFIRM in main).
  if [ "$REBUILD" = "1" ]; then
    teardown_for_rebuild
  fi

  # SHY-0074: enforce the single-source-label invariant on every run
  # (dry-run previews the deletions).
  remove_duplicated_label_families

  local file
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    sync_one "$file"
  done < <(find -P "$STORIES_DIR" -maxdepth 1 -type f ! -type l \
             -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)

  printf 'Sync result: %d created (%d drafts, %d issues), %d updated, %d skipped, %d failed' \
    "$N_CREATED" "$N_DRAFTS_CREATED" "$N_ISSUES_CREATED" "$N_UPDATED" "$N_SKIPPED" "$N_FAILED" >&2
  printf ' (labels created: %d; labels deleted: %d; project items added: %d; project items deleted: %d; issues deleted: %d; project fields updated: %d; status fields set: %d; bodies embedded: %d; bodies truncated: %d; comments posted: %d; issues closed: %d; dedup-guard hits: %d; type-field auto-created: %s)\n' \
    "$N_LABELS_CREATED" "$N_LABELS_DELETED" "$N_PROJECT_ITEMS_ADDED" "$N_ITEMS_DELETED" \
    "$N_ISSUES_DELETED" "$N_PROJECT_FIELDS_UPDATED" "$N_STATUS_SET" "$N_BODIES_EMBEDDED" \
    "$N_BODIES_TRUNCATED" "$N_COMMENTS_POSTED" "$N_ISSUES_CLOSED" "$N_DEDUP_GUARD_HITS" "$TYPE_FIELD_AUTO_CREATED" >&2

  # SHY-0067 reviewer-I2: emit a GITHUB_STEP_SUMMARY audit trail when running
  # under GitHub Actions. Local + test runs skip silently (env var unset).
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      printf '## Roadmap sync — board mirror (drafts) + bugs-only Issues\n\n'
      printf '| Metric | Count |\n'
      printf '|---|---|\n'
      printf '| Created | %d |\n' "$N_CREATED"
      printf '| — drafts | %d |\n' "$N_DRAFTS_CREATED"
      printf '| — bug issues | %d |\n' "$N_ISSUES_CREATED"
      printf '| Updated | %d |\n' "$N_UPDATED"
      printf '| Skipped (unchanged) | %d |\n' "$N_SKIPPED"
      printf '| Failed | %d |\n' "$N_FAILED"
      printf '| Labels auto-created | %d |\n' "$N_LABELS_CREATED"
      printf '| Labels deleted (duplicated families) | %d |\n' "$N_LABELS_DELETED"
      printf '| Project items added | %d |\n' "$N_PROJECT_ITEMS_ADDED"
      printf '| Project items deleted | %d |\n' "$N_ITEMS_DELETED"
      printf '| Issues deleted (rebuild) | %d |\n' "$N_ISSUES_DELETED"
      printf '| Project fields updated | %d |\n' "$N_PROJECT_FIELDS_UPDATED"
      printf '| Status fields set | %d |\n' "$N_STATUS_SET"
      printf '| Bodies embedded | %d |\n' "$N_BODIES_EMBEDDED"
      printf '| Bodies truncated | %d |\n' "$N_BODIES_TRUNCATED"
      printf '| Status comments posted | %d |\n' "$N_COMMENTS_POSTED"
      printf '| Issues closed | %d |\n' "$N_ISSUES_CLOSED"
      printf '| Dedup-guard hits (stale-map duplicate prevented) | %d |\n' "$N_DEDUP_GUARD_HITS"
      printf '| Type-field auto-created | %s |\n' "$TYPE_FIELD_AUTO_CREATED"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
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
  # SHY-0074: create-vs-update decisions need the items map (see sync_all).
  load_items_map \
    || fail_global "project" "items-map query failed — aborting before any mutations" "$E_API"
  # SHY-0067: setup phase for single-story mode too.
  if [ "$DRY_RUN" != "1" ]; then
    load_project_cache || true
    ensure_project_type_field || true
  fi
  # SHY-0074: single-source-label invariant (see sync_all).
  remove_duplicated_label_families
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
      --rebuild) REBUILD=1; shift ;;
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

  # SHY-0074: --rebuild implies --all and is gated on an explicit confirm
  # env BEFORE any auth or API touch — it deletes every board item + every
  # story-labeled issue. --dry-run previews are allowed without the gate
  # (zero mutations possible).
  if [ "$REBUILD" = "1" ]; then
    if [ "$MODE" = "story" ]; then
      fail_global "usage" "--rebuild cannot combine with --story" "$E_USAGE"
    fi
    MODE="all"
    if [ "$DRY_RUN" != "1" ] && [ "${REBUILD_CONFIRM:-}" != "yes" ]; then
      fail_global "rebuild" \
        "destructive teardown refused: set REBUILD_CONFIRM=yes to delete every board item + story-labeled issue and resync fresh" \
        "$E_USAGE"
    fi
  fi

  if [ -z "$MODE" ]; then
    fail_global "usage" "specify --all, --story SHY-NNNN, or --rebuild" "$E_USAGE"
  fi

  if [ "$DRY_RUN" != "1" ]; then
    check_auth
  fi

  case "$MODE" in
    all)   sync_all ;;
    story) sync_story "$SINGLE_ID" ;;
  esac

  # SHY-0067: propagate N_FAILED > 0 to non-zero exit (Defect C).
  if [ "$N_FAILED" -gt 0 ]; then
    printf 'sync-stories-to-issues: %d operation(s) failed — exiting %d\n' "$N_FAILED" "$E_API" >&2
    exit "$E_API"
  fi
  exit "$E_OK"
}

main "$@"
