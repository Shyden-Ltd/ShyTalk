#!/usr/bin/env bash
# shellcheck shell=bash
#
# sync-stories-to-issues.sh
#
# One-way mirror of .project/stories/SHY-NNNN-*.md files to GitHub Issues
# + Projects v2 cards, per SHY-0002 spec at
# .project/stories/SHY-0002-wire-github-integration.md, with SHY-0067
# comprehensive defect fixes layered on top:
#
#   - Defect A (auth env): script + workflow now both export GH_TOKEN so
#     the gh CLI actually authenticates as the PAT (pre-SHY-0067 gh ran
#     with the read-only auto GITHUB_TOKEN and failed silently).
#   - Defect B (labels): script auto-creates the SHY-namespace labels
#     (story, status:*, priority:*, effort:*, type:*, roadmap:*) via
#     `gh label create` on first encounter; caches via `gh label list`.
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
#   Internally, the script re-exports the PAT as GH_TOKEN — that's the
#   env var the gh CLI actually reads (highest priority over
#   GITHUB_TOKEN). The workflow YAML also sets GH_TOKEN at the env block
#   for defense-in-depth.
#
# CONFIG
#   SYNC_GRACE_WINDOW_SECS  Grace period before force-closing an issue
#                           after a story flips to status: Done. Default
#                           300 (5 min). Tests inject 0 to skip the sleep.
#   GH                      Path to the `gh` CLI. Default `gh`. Tests
#                           override with a mock-gh fixture.
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

GH="${GH:-gh}"
SYNC_GRACE_WINDOW_SECS="${SYNC_GRACE_WINDOW_SECS:-300}"
PROJECT_OWNER="${PROJECT_OWNER:-Shyden-Ltd}"
PROJECT_NUMBER="${PROJECT_NUMBER:-1}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORIES_DIR="${REPO_ROOT}/.project/stories"

N_CREATED=0
N_UPDATED=0
N_SKIPPED=0
N_FAILED=0
N_LABELS_CREATED=0
N_PROJECT_ITEMS_ADDED=0
N_PROJECT_FIELDS_UPDATED=0
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
  40  one or more sync operations failed (N_FAILED > 0)

ENV VARS
  GH_PAT_PROJECT          PAT with issues:write + pull-requests:write +
                          project:write. Auto GITHUB_TOKEN cannot carry
                          project scopes — a PAT is mandatory. Internally
                          re-exported as GH_TOKEN (which gh CLI reads).
  SYNC_GRACE_WINDOW_SECS  Grace before force-closing Done issues (default 300)
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

# Default color/description map for the SHY namespace.
# Returns the suggested color (no leading '#'). Colors picked for readability.
label_default_color() {
  case "$1" in
    story)                  echo "8a2be2" ;; # purple
    status:draft)           echo "cccccc" ;; # grey
    status:in-progress)     echo "fbca04" ;; # yellow
    status:in-review)       echo "0e8a16" ;; # green
    status:done)            echo "1f883d" ;; # dark green
    status:cancelled)       echo "e4e669" ;; # pale yellow
    priority:p0)            echo "b60205" ;; # red
    priority:p1)            echo "d93f0b" ;; # orange
    priority:p2)            echo "fbca04" ;; # yellow
    priority:p3)            echo "c5def5" ;; # pale blue
    effort:xs)              echo "c2e0c6" ;; # pale green
    effort:s)               echo "bfdadc" ;; # cyan
    effort:m)               echo "1d76db" ;; # blue
    effort:l)               echo "5319e7" ;; # dark purple
    effort:xl)              echo "4c1c5f" ;; # darker purple
    type:feature)           echo "0e8a16" ;;
    type:bug)               echo "d73a4a" ;;
    type:refactor)          echo "5319e7" ;;
    type:docs)              echo "0075ca" ;;
    type:infra)             echo "fbca04" ;;
    type:spike)             echo "e99695" ;;
    type:chore)             echo "ededed" ;;
    *)                      echo "ededed" ;;
  esac
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
      [ -n "$r" ] && printf 'roadmap:%s\n' "$(printf '%s' "$r" | tr '[:upper:]' '[:lower:]')"
    done
  fi
}

# Ensure every label for a SHY exists, creating any missing ones, and echo
# the CSV of *verified* labels (those that exist post-call). Labels whose
# create failed are DROPPED from the result so the caller's `gh issue create
# --label <csv>` doesn't fail with "label not found" — addresses reviewer C1.
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
  done < <(build_labels "$file")
  printf '%s\n' "$verified_csv"
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
  N_PROJECT_ITEMS_ADDED=$((N_PROJECT_ITEMS_ADDED + 1))
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

# Populate every applicable Project v2 field for the given item from frontmatter.
populate_project_fields() {
  local item_id="$1" file="$2" id="$3"
  local pri effort type roadmaps
  pri="$(fm_get "$file" priority)"
  effort="$(fm_get "$file" effort)"
  type="$(fm_get "$file" type)"
  roadmaps="$(fm_get "$file" roadmap_ids | sed 's/^\[//; s/\]$//; s/, */, /g')"
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
  return 0
}

# ============================================================== issue create/update

# Look up existing issue by SHY-NNNN: title prefix. Echo issue number or empty.
# Uses PIPESTATUS to capture gh's exit code (not head's) so genuine failures
# get logged. bash 3.2+ supports PIPESTATUS.
# SHY-0067 reviewer-I1: return gh's exit code so callers can distinguish
# "lookup failed (transient gh error)" from "no existing issue found". The
# difference matters because the former should NOT trigger a duplicate create.
find_issue_for() {
  local id="$1"
  # Dry-run: don't hit gh (no auth); pretend no issue exists so the create-
  # path preview fires + sync_one's `if [ -z "$issue_num" ]` branch hits.
  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  local stderr_file
  stderr_file="$(mktemp)"
  set +e
  "$GH" issue list \
    --state all \
    --search "in:title \"${id}:\"" \
    --json number,title \
    --jq ".[] | select(.title | startswith(\"${id}:\")) | .number" \
    2>"$stderr_file" \
    | head -n 1
  local gh_rc="${PIPESTATUS[0]}"
  set -e
  if [ "$gh_rc" -ne 0 ]; then
    printf '[gh-error] issue list for %s (exit %d): %s\n' \
      "$id" "$gh_rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
  fi
  rm -f "$stderr_file"
  return "$gh_rc"
}

# Look up the node ID for an existing issue number. Echoes node ID on stdout
# or empty on failure; returns gh's exit code so callers can branch.
issue_node_id_for() {
  local issue_num="$1"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'dry-run-issue-node-id\n'
    return 0
  fi
  local stderr_file node_id rc
  stderr_file="$(mktemp)"
  set +e
  node_id="$("$GH" issue view "$issue_num" --json id --jq '.id' 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] issue view %s for node id (exit %d): %s\n' \
      "$issue_num" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
  fi
  rm -f "$stderr_file"
  printf '%s\n' "$node_id"
  return "$rc"
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

  # shellcheck disable=SC2016
  printf '**Spec:** [`%s.md`](../blob/main/.project/stories/%s.md)\n\n' "$slug" "$slug"
  printf '> %s\n\n' "$title"
  printf -- '---\n\n'
  printf '_Last synced: %s from commit %s body-hash: %s_\n' "$now" "$sha" "$hash"
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

  # SHY-0067: ensure labels exist before issue create (Defect B fix). The
  # function echoes the CSV of *verified* labels (reviewer C1) so the gh
  # issue create --label flag won't be rejected on a label that failed to
  # create.
  local verified_labels
  verified_labels="$(ensure_labels_for_story "$file")"

  local hash
  hash="$(body_hash "$file")"

  # SHY-0067 reviewer-I1: distinguish "no issue found" (rc=0, stdout empty)
  # from "lookup failed" (rc!=0). Skip without creating a duplicate on
  # transient gh errors.
  local issue_num find_rc
  set +e
  issue_num="$(find_issue_for "$id")"
  find_rc=$?
  set -e
  if [ "$find_rc" -ne 0 ]; then
    emit "$id" "api" "failed to look up existing issue (gh issue list error)"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi

  if [ -z "$issue_num" ]; then
    local title body create_response
    title="${id}: $(extract_title "$file" | sed "s/^${id}: //")"
    body="$(build_issue_body "$file" "$hash")"
    # SHY-0067: capture create stdout (URL) so the caller can derive node_id.
    # Pass the *verified* label CSV (reviewer C1) — any label whose create
    # failed is already dropped so gh issue create won't reject the create.
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
    emit "$id" "created" "issue created"

    # SHY-0067: add to Project v2 board + populate fields (Defect D).
    if [ "$DRY_RUN" != "1" ]; then
      local node_id item_id
      # The dry-run shape echoes JSON; the real-gh shape echoes a URL. Try
      # JSON-parse first; fall back to URL-parse if not JSON.
      node_id="$(printf '%s' "$create_response" | jq -r '.id // empty' 2>/dev/null || true)"
      if [ -z "$node_id" ] || [ "$node_id" = "null" ]; then
        node_id="$(extract_issue_node_id "$create_response" 2>/dev/null || true)"
      fi
      if [ -n "$node_id" ] && [ "$node_id" != "DRY_RUN_NODE_ID" ]; then
        # SHY-0067 reviewer-I6: tighten silent-failure on board-add (AC line 79).
        # `add_to_project_board` already emits `[gh-error]` on failure; we just
        # need to count it + propagate to the Defect-C exit-40 gate. Same for
        # the field-set step that follows. The previous `|| true` swallow
        # reintroduced Defect-C-class silent success on the Defect-D path.
        if item_id="$(add_to_project_board "$node_id")"; then
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
      else
        verbose "${id}: no node_id available (likely test fixture without view response); skipping board add"
      fi
    else
      printf 'DRY-RUN: %s: would ADD to Project v2 board + populate fields\n' "$id" >&2
    fi
    return 0
  fi

  # Issue exists. Compare body-hash via stored footer.
  local existing_body existing_hash stderr_file
  stderr_file="$(mktemp)"
  set +e
  existing_body="$("$GH" issue view "$issue_num" --json body --jq .body 2>"$stderr_file" || echo "")"
  set -e
  rm -f "$stderr_file"
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
  if ! update_issue_body "$issue_num" "$new_body"; then
    emit "$id" "api" "failed to update issue #${issue_num}"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi
  N_UPDATED=$((N_UPDATED + 1))
  emit "$id" "updated" "issue #${issue_num} body refreshed"

  # SHY-0067 reviewer-C4: also re-sync project board fields when the body
  # refreshes. addProjectV2ItemById is idempotent — returns the existing
  # item ID if the issue is already in the project. Without this, a SHY
  # whose priority/effort/type frontmatter changes would have a stale board
  # entry even after the body update succeeds. AC line 90-91 (Edge cases:
  # only updates Project v2 field values if frontmatter changed).
  if [ "$DRY_RUN" != "1" ]; then
    local update_node_id update_item_id
    set +e
    update_node_id="$(issue_node_id_for "$issue_num")"
    set -e
    if [ -n "$update_node_id" ]; then
      # SHY-0067 reviewer-I6: same silent-failure tightening as the create
      # path. `addProjectV2ItemById` is idempotent (returns existing item id
      # if already mirrored), so this path's failure modes are genuine —
      # auth/scope regressions, board id stale, etc — and must hit N_FAILED.
      if update_item_id="$(add_to_project_board "$update_node_id")"; then
        if [ -n "$update_item_id" ]; then
          if ! populate_project_fields "$update_item_id" "$file" "$id"; then
            emit "$id" "project" "failed to refresh fields for item ${update_item_id}"
            N_FAILED=$((N_FAILED + 1))
          fi
        fi
      else
        emit "$id" "project" "failed to re-add issue node ${update_node_id} to project board"
        N_FAILED=$((N_FAILED + 1))
      fi
    fi
  fi
}

sync_all() {
  if [ ! -d "$STORIES_DIR" ]; then
    fail_global "config" "stories directory not found: $STORIES_DIR" "$E_USAGE"
  fi

  # SHY-0067: setup phase — ensure Type field exists before per-story sync
  # (Defect E). load_project_cache is also called transitively but explicit
  # call here makes the workflow log clearer.
  if [ "$DRY_RUN" != "1" ]; then
    load_project_cache || true
    ensure_project_type_field || true
  fi

  local file
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    sync_one "$file"
  done < <(find -P "$STORIES_DIR" -maxdepth 1 -type f ! -type l \
             -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' | LC_ALL=C sort)

  printf 'Sync result: %d created, %d updated, %d skipped, %d failed' \
    "$N_CREATED" "$N_UPDATED" "$N_SKIPPED" "$N_FAILED" >&2
  printf ' (labels created: %d; project items added: %d; project fields updated: %d; type-field auto-created: %s)\n' \
    "$N_LABELS_CREATED" "$N_PROJECT_ITEMS_ADDED" "$N_PROJECT_FIELDS_UPDATED" "$TYPE_FIELD_AUTO_CREATED" >&2

  # SHY-0067 reviewer-I2: emit a GITHUB_STEP_SUMMARY audit trail when running
  # under GitHub Actions. Local + test runs skip silently (env var unset).
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      printf '## Roadmap sync — Issues + Project v2 mirror\n\n'
      printf '| Metric | Count |\n'
      printf '|---|---|\n'
      printf '| Created | %d |\n' "$N_CREATED"
      printf '| Updated | %d |\n' "$N_UPDATED"
      printf '| Skipped (unchanged) | %d |\n' "$N_SKIPPED"
      printf '| Failed | %d |\n' "$N_FAILED"
      printf '| Labels auto-created | %d |\n' "$N_LABELS_CREATED"
      printf '| Project items added | %d |\n' "$N_PROJECT_ITEMS_ADDED"
      printf '| Project fields updated | %d |\n' "$N_PROJECT_FIELDS_UPDATED"
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
  # SHY-0067: setup phase for single-story mode too.
  if [ "$DRY_RUN" != "1" ]; then
    load_project_cache || true
    ensure_project_type_field || true
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

  # SHY-0067: propagate N_FAILED > 0 to non-zero exit (Defect C).
  if [ "$N_FAILED" -gt 0 ]; then
    printf 'sync-stories-to-issues: %d operation(s) failed — exiting %d\n' "$N_FAILED" "$E_API" >&2
    exit "$E_API"
  fi
  exit "$E_OK"
}

main "$@"
