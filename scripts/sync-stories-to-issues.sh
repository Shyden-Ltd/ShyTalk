#!/usr/bin/env bash
# shellcheck shell=bash
#
# sync-stories-to-issues.sh
#
# One-way mirror of .project/stories/SHY-NNNN-*.md files to the GitHub
# Projects v2 board, per the SHY-0082 architecture v4 spec at
# .project/stories/SHY-0082-mirror-v4-typed-issues.md:
#
#   - EVERY story (any type) → a REAL GitHub ISSUE (createIssue) carrying a
#     native issue TYPE (Bug / Feature / Task — org-level issue types) + the
#     full spec body + footer + the `story` marker label, added to the board
#     (addProjectV2ItemById). v4 reverses v3 (which made every card a DRAFT):
#     drafts cannot carry a native type, so typed "tickets" must be real issues.
#     Type map (7 story types → 3 native): bug→Bug; feature→Feature;
#     refactor/docs/infra/spike/chore→Task.
#   - A real issue inherently ALSO appears on the repo's Issues *tab*. That tab
#     stays usable for user bug reports (+ deploy alerts): story-issues carry
#     the `story` label (filter them out) and terminal (Done/Cancelled) issues
#     are CLOSED, so finished work leaves the default open view.
#   - Lifecycle drives the board Status column AND the issue open/closed state:
#     hash-gated body refresh + the body-footer `_Status: X_` marker detect a
#     pure status flip (status lives in frontmatter, outside the body hash);
#     terminal status → issue closed, otherwise open (reconciled on transition).
#   - One paginated items-map query (now selecting the issue body too) feeds
#     every create-vs-update decision.
#   - A legacy DRAFT-backed item (a v3 leftover) is converted: the draft board
#     item is deleted and the story is recreated as a typed issue (the
#     incremental safety net; --rebuild does the bulk migration).
#   - --rebuild (gated on REBUILD_CONFIRM=yes) tears down every board item
#     + every story-labeled issue (delete_issue_node), then resyncs fresh as
#     typed issues — the one-shot migration that converts a v3 draft board to v4.
#
# Defect fixes carried forward from SHY-0067:
#
#   - Defect A (auth env): script + workflow both export GH_TOKEN so the gh
#     CLI authenticates as the PAT (the read-only auto GITHUB_TOKEN can't
#     carry project:write).
#   - Defect B (labels): the five duplicated families (status:/priority:/
#     effort:/type:/roadmap:) are DELETED repo-wide on every run
#     (remove_duplicated_label_families). v4 applies exactly ONE marker label —
#     `story` — to every story-issue (created on first run via
#     ensure_story_label); it identifies corpus issues + lets --rebuild find
#     them via `issue list --label story`. The native issue TYPE replaces the
#     old `type:` label.
#   - Defect C (silent failure): every `gh` invocation captures stderr to a
#     tmpfile; failures log the captured context (no `>/dev/null 2>&1`);
#     N_FAILED > 0 propagates to a non-zero E_API=40 exit at script end.
#   - Defect E (Type field auto-create): script invokes `createProjectV2Field`
#     if the Type single-select field is absent on the board.
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

VERSION="4.0.0"

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
# SHY-0082 v4: every story → a REAL typed GitHub issue (not a draft). The
# repo node id + native issue-type ids + `story` label id are resolved once
# at run start via ONE repo-level GraphQL query (the PAT can read repo-level
# issueTypes; the org-level query is 403 for fine-grained PATs).
PROJECT_REPO="${PROJECT_REPO:-ShyTalk}"
# v4 marker label — the single label every story-issue carries (lets the
# rebuild teardown find them via `--label story` + distinguishes them from
# future user-submitted bug reports). v3 retired the 5 label families; v4
# keeps ONLY this marker.
STORY_LABEL="story"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# SHY-0074: env-overridable so tests can run the full pipeline against a
# fixture corpus instead of the live .project/stories tree.
STORIES_DIR="${STORIES_DIR:-${REPO_ROOT}/.project/stories}"

# SHY-0082 v4: every story → a REAL typed GitHub issue added to the board.
# N_CREATED/N_UPDATED are the headline create/update counts (now of issues,
# not drafts). The v4-specific signals (native issue type set, issue
# open/closed transitions, draft→issue migration) get their own counters so
# the summary stays auditable. N_ISSUES_DELETED is used by `--rebuild`.
N_CREATED=0
N_UPDATED=0
N_SKIPPED=0
N_FAILED=0
N_LABELS_DELETED=0
N_PROJECT_ITEMS_ADDED=0
N_ITEMS_DELETED=0
N_ISSUES_DELETED=0
N_PROJECT_FIELDS_UPDATED=0
N_STATUS_SET=0
N_BODIES_EMBEDDED=0
N_BODIES_TRUNCATED=0
N_ISSUE_TYPES_SET=0
N_ISSUES_CLOSED=0
N_ISSUES_REOPENED=0
N_DRAFTS_MIGRATED=0
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
# SHY-0082 v4: repo-level facts resolved once by bootstrap_repo().
REPO_NODE_ID=""
STORY_LABEL_ID=""
# Native issue-type node ids, keyed by the 3 org types (Bug/Feature/Task).
ISSUE_TYPE_BUG_ID=""
ISSUE_TYPE_FEATURE_ID=""
ISSUE_TYPE_TASK_ID=""
REPO_BOOTSTRAPPED=0

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
                     fresh --all sync (every story type as a real typed
                     GitHub issue). Refuses without REBUILD_CONFIRM=yes.
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
# "In Progress") feeds the footer `_Status: X_` marker; PS_STATUS_LC feeds
# the board Status mapping (status_board_option). SHY-0081 v3 dropped the
# `released_in` parse too — it only fed the now-retired issue close-on-Done
# comment.
PS_ID="" PS_TITLE="" PS_PRIORITY="" PS_EFFORT="" PS_TYPE="" PS_ROADMAPS=""
PS_STATUS="" PS_STATUS_LC=""

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
      next
    }
    n>=2 && title=="" && /^# / { t=$0; sub(/^# /,"",t); title=trim(t) }
    END{
      gsub(/^\[/,"",roadmaps); gsub(/\]$/,"",roadmaps); gsub(/[[:space:]]/,"",roadmaps)
      status_lc=tolower(status); gsub(/ /,"-",status_lc)
      printf "%s%s%s%s%s%s%s%s%s%s%s%s%s%s%s", \
        id, US, title, US, priority, US, effort, US, type, US, roadmaps, US, \
        status, US, status_lc
    }
  ' "$1")"
  IFS=$'\x1f' read -r PS_ID PS_TITLE PS_PRIORITY PS_EFFORT PS_TYPE PS_ROADMAPS \
    PS_STATUS PS_STATUS_LC <<<"$rec"
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
}

# SHY-0081 v3: the `story` label is no longer applied to anything (no issues
# are created from the corpus). It is left inert in the repo for a future
# bug-report intake to reuse, and is NOT auto-deleted. The label-creation
# helpers (ensure_label / build_labels / ensure_labels_for_story) were retired
# with the issue path.

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

# ============================================================== sidecar (SHY-0079)
# `.project/board-items.json` is a git-committed, strongly-consistent mirror
# of the board keyed by SHY ID. It OVERLAYS the eventually-consistent
# Projects v2 items query: any SHY present in the sidecar but missing from a
# (possibly stale) API read is filled back in — healing the read-after-write
# lag that otherwise re-creates draft cards (the SHY-0078 residual). The
# script always rewrites the file locally from the post-run board state; the
# WORKFLOW commits it via createCommitOnBranch (signed, SHY-0063 mechanism).
SIDECAR_FILE="${BOARD_ITEMS_FILE:-${REPO_ROOT}/.project/board-items.json}"
# BOARD_ITEMS_JSON is the run-scoped, mutation-tracked board state written
# back to the sidecar at the end of the run. Seeded from the merged map,
# then kept current by board_items_put / board_items_del on every
# create/delete so the write-back reflects POST-run reality (re-querying the
# laggy API would defeat the purpose).
BOARD_ITEMS_JSON='{}'
N_SIDECAR_FILLS=0

# Upsert one SHY's board entry into the run-scoped sidecar state.
board_items_put() {
  local id="$1" backing="$2" item_id="$3" content_id="$4" issue_number="${5:-0}"
  BOARD_ITEMS_JSON="$(printf '%s' "$BOARD_ITEMS_JSON" | jq -c \
    --arg k "$id" --arg b "$backing" --arg i "$item_id" --arg c "$content_id" --argjson n "${issue_number:-0}" \
    '.[$k] = {backing:$b, itemId:$i, contentId:$c, issueNumber:$n}')"
}

# Remove one SHY's board entry (item deleted / type-flipped away).
board_items_del() {
  local id="$1"
  BOARD_ITEMS_JSON="$(printf '%s' "$BOARD_ITEMS_JSON" | jq -c --arg k "$id" 'del(.[$k])')"
}

# Overlay the committed sidecar onto ITEMS_MAP_JSON (API result). API entries
# WIN (freshest live state); sidecar fills the API's gaps. Also seeds
# BOARD_ITEMS_JSON from the merged result. Malformed sidecar → warn + API-only.
overlay_board_items_sidecar() {
  if [ ! -f "$SIDECAR_FILE" ]; then
    # Bootstrap: no sidecar yet. Seed write-back state from the API map.
    BOARD_ITEMS_JSON="$(printf '%s' "$ITEMS_MAP_JSON" | jq -c \
      'with_entries(.value |= {backing, itemId, contentId, issueNumber})')"
    return 0
  fi
  local sidecar
  if ! sidecar="$(jq -c . "$SIDECAR_FILE" 2>/dev/null)"; then
    printf '::warning::board-items.json is malformed — falling back to the API-only board map\n' >&2
    BOARD_ITEMS_JSON="$(printf '%s' "$ITEMS_MAP_JSON" | jq -c \
      'with_entries(.value |= {backing, itemId, contentId, issueNumber})')"
    return 0
  fi
  # SHY-0080: pass both maps via STDIN (printf is a bash builtin → no
  # ARG_MAX), NOT --argjson — ITEMS_MAP_JSON carries every draft's full spec
  # body, so 47+ drafts blow past the argv limit and jq fails ("Argument
  # list too long"), silently emptying the map and re-creating everything.
  # `jq -s` slurps the two objects: .[0]=sidecar, .[1]=api.
  # Count fills: sidecar keys absent from the API map (jq array subtraction).
  N_SIDECAR_FILLS="$(printf '%s\n%s\n' "$sidecar" "$ITEMS_MAP_JSON" \
    | jq -s '((.[0] | keys) - (.[1] | keys)) | length')"
  if [ "${N_SIDECAR_FILLS:-0}" -gt 0 ]; then
    printf '[sidecar] API read missed %s item(s); filled from board-items.json\n' "$N_SIDECAR_FILLS" >&2
  fi
  # Merge: normalize sidecar entries to the full value shape, then API (.[1])
  # overlays/wins.
  ITEMS_MAP_JSON="$(printf '%s\n%s\n' "$sidecar" "$ITEMS_MAP_JSON" | jq -c -s '
    (.[0] | with_entries(.value |= {
        itemId: .itemId,
        backing: .backing,
        contentId: .contentId,
        issueNumber: (.issueNumber // 0),
        draftBody: ""
      })) + .[1]')"
  # Seed write-back state from the merged map (post-overlay, pre-mutation).
  BOARD_ITEMS_JSON="$(printf '%s' "$ITEMS_MAP_JSON" | jq -c \
    'with_entries(.value |= {backing, itemId, contentId, issueNumber})')"
}

# Write the run-scoped board state to the sidecar file (sorted keys for a
# stable diff). The workflow commits it. Always called at run end so the
# file tracks the board even when nothing changed (idempotent no-op diff).
write_board_items_sidecar() {
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: would rewrite %s (%s entries)\n' \
      "$SIDECAR_FILE" "$(printf '%s' "$BOARD_ITEMS_JSON" | jq 'length')" >&2
    return 0
  fi
  printf '%s\n' "$BOARD_ITEMS_JSON" | jq -S --indent 2 . > "$SIDECAR_FILE"
  verbose "write_board_items_sidecar: $(printf '%s' "$BOARD_ITEMS_JSON" | jq 'length') entries → ${SIDECAR_FILE}"
}

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
  query='query($owner: String!, $number: Int!, $cursor: String) { organization(login: $owner) { projectV2(number: $number) { items(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { id content { __typename ... on Issue { id number state title body } ... on DraftIssue { id title body } } fieldValueByName(name: "SHY ID") { ... on ProjectV2ItemFieldTextValue { text } } } } } } }'
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
              draftBody: (.content.body // "")
            } }
        | select(.key != "") ]
      | from_entries
    ')" || [ -z "$page_map" ]; then
      printf '[gh-error] projectV2 items query returned an unparsable/empty response: %s\n' \
        "$(printf '%s' "$response" | head -c 200)" >&2
      return 1
    fi
    # SHY-0080: merge via STDIN (printf builtin → no ARG_MAX), NOT --argjson.
    # ITEMS_MAP_JSON + page_map carry full draft spec bodies; --argjson argv
    # overflows past ~47 drafts ("Argument list too long"), which silently
    # emptied the map and re-created the whole board. `jq -s`: .[0]+.[1].
    ITEMS_MAP_JSON="$(printf '%s\n%s\n' "$ITEMS_MAP_JSON" "$page_map" | jq -c -s '.[0] + .[1]')"
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
    # Dry-run makes no gh calls; the API map starts empty but the SHY-0079
    # sidecar overlay still applies so the preview reflects existing items.
    ITEMS_MAP_JSON='{}'
    overlay_board_items_sidecar
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
  # board is truly empty the retry is a cheap no-op. The SHY-0079 board-items
  # sidecar (overlay) is the hard backstop for duplicate DRAFTS when even the
  # retry reads stale.
  if [ "$(_items_map_keyed_count)" -eq 0 ]; then
    verbose "load_items_map: empty on first read; retrying once after ${ITEMS_MAP_RETRY_BACKOFF}s (Projects v2 lag guard)"
    if [ "${ITEMS_MAP_RETRY_BACKOFF:-0}" -gt 0 ] 2>/dev/null; then
      sleep "$ITEMS_MAP_RETRY_BACKOFF"
    fi
    _items_map_pass || return 1
  fi
  # SHY-0079: overlay the committed sidecar to heal any stale-API gaps.
  overlay_board_items_sidecar
  ITEMS_MAP_LOADED=1
  verbose "load_items_map: $(_items_map_keyed_count) keyed items (sidecar fills: ${N_SIDECAR_FILLS})"
  return 0
}

# Look up one SHY ID in the items map. Results via MAP_* globals.
MAP_FOUND=0 MAP_ITEM_ID="" MAP_BACKING="" MAP_CONTENT_ID=""
MAP_ISSUE_NUMBER="" MAP_DRAFT_BODY=""
map_lookup() {
  local id="$1" rec
  MAP_FOUND=0 MAP_ITEM_ID="" MAP_BACKING="" MAP_CONTENT_ID=""
  MAP_ISSUE_NUMBER="" MAP_DRAFT_BODY=""
  rec="$(printf '%s' "$ITEMS_MAP_JSON" | jq -r --arg k "$id" \
    'if has($k) then .[$k] | [.itemId, .backing, .contentId, (.issueNumber|tostring)] | join("\u001f") else empty end')"
  [ -z "$rec" ] && return 0
  IFS=$'\x1f' read -r MAP_ITEM_ID MAP_BACKING MAP_CONTENT_ID MAP_ISSUE_NUMBER <<<"$rec"
  if [ "$MAP_BACKING" = "DRAFT" ] || [ "$MAP_BACKING" = "ISSUE" ]; then
    # Separate jq call: the body is multi-line and would truncate the
    # one-line \x1f read above. SHY-0082 v4: the items query now selects
    # `body` on Issue too, so issue-backed items expose their stored body for
    # change-detection (the footer body-hash) exactly like drafts did.
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

# ============================================================== v4 typed-issue path (SHY-0082)

# Resolve repo node id + native issue-type ids (Bug/Feature/Task) + the
# `story` label id in ONE repo-level GraphQL query. The org-level issueTypes
# query is 403 for fine-grained PATs; the repository-scoped one is permitted.
# Idempotent (guarded by REPO_BOOTSTRAPPED). Aborts if a native type is
# missing — typing every issue is non-negotiable in v4.
bootstrap_repo() {
  [ "$REPO_BOOTSTRAPPED" = "1" ] && return 0
  local query response stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variables, NOT bash; STORY_LABEL is interpolated (controlled).
  query='query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id issueTypes(first: 20) { nodes { id name } } label(name: "'"$STORY_LABEL"'") { id } } }'
  set +e
  response="$("$GH" api graphql -f query="$query" -f owner="$PROJECT_OWNER" -f name="$PROJECT_REPO" 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] repo bootstrap query (exit %d): %s\n' "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  REPO_NODE_ID="$(printf '%s' "$response" | jq -r '.data.repository.id // empty')"
  STORY_LABEL_ID="$(printf '%s' "$response" | jq -r '.data.repository.label.id // empty')"
  ISSUE_TYPE_BUG_ID="$(printf '%s' "$response" | jq -r '.data.repository.issueTypes.nodes[] | select(.name=="Bug") | .id')"
  ISSUE_TYPE_FEATURE_ID="$(printf '%s' "$response" | jq -r '.data.repository.issueTypes.nodes[] | select(.name=="Feature") | .id')"
  ISSUE_TYPE_TASK_ID="$(printf '%s' "$response" | jq -r '.data.repository.issueTypes.nodes[] | select(.name=="Task") | .id')"
  if [ -z "$REPO_NODE_ID" ]; then
    emit "repo" "bootstrap" "repository query returned empty id; response: $(printf '%s' "$response" | head -c 200)"
    return 1
  fi
  if [ -z "$ISSUE_TYPE_BUG_ID" ] || [ -z "$ISSUE_TYPE_FEATURE_ID" ] || [ -z "$ISSUE_TYPE_TASK_ID" ]; then
    fail_global "repo" "org is missing a native issue type (need Bug/Feature/Task; got Bug='${ISSUE_TYPE_BUG_ID}' Feature='${ISSUE_TYPE_FEATURE_ID}' Task='${ISSUE_TYPE_TASK_ID}')" "$E_API"
  fi
  REPO_BOOTSTRAPPED=1
  return 0
}

# Ensure the `story` marker label exists + STORY_LABEL_ID is populated.
# bootstrap_repo already tried to resolve it; create on first run if absent.
ensure_story_label() {
  [ -n "$STORY_LABEL_ID" ] && return 0
  local stderr_file rc q
  stderr_file="$(mktemp)"
  set +e
  "$GH" label create "$STORY_LABEL" --repo "${PROJECT_OWNER}/${PROJECT_REPO}" \
    --color ededed --description "Tracked SHY story (mirrored from .project/stories)" \
    --force >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] label create %s (exit %d): %s\n' "$STORY_LABEL" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  # shellcheck disable=SC2016
  q='query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { label(name: "'"$STORY_LABEL"'") { id } } }'
  STORY_LABEL_ID="$("$GH" api graphql -f query="$q" -f owner="$PROJECT_OWNER" -f name="$PROJECT_REPO" 2>/dev/null | jq -r '.data.repository.label.id // empty')"
  [ -n "$STORY_LABEL_ID" ] && return 0
  emit "repo" "label" "could not resolve ${STORY_LABEL} label id after create"
  return 1
}

# Map a story `type` (7 values) → native issue-type node id (3 values):
# bug→Bug; feature→Feature; refactor/docs/infra/spike/chore→Task.
story_type_to_issue_type_id() {
  case "$1" in
    bug) printf '%s' "$ISSUE_TYPE_BUG_ID" ;;
    feature) printf '%s' "$ISSUE_TYPE_FEATURE_ID" ;;
    *) printf '%s' "$ISSUE_TYPE_TASK_ID" ;;
  esac
}

# Add an existing issue (by content/node id) to the project board. Echoes the
# new board item id; increments N_PROJECT_ITEMS_ADDED on success.
add_to_board() {
  local content_id="$1"
  load_project_cache || return 1
  local query response stderr_file rc item_id
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  query='mutation($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }'
  set +e
  response="$("$GH" api graphql -f query="$query" -f projectId="$PROJECT_NODE_ID" -f contentId="$content_id" 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] addProjectV2ItemById %s (exit %d): %s\n' "$content_id" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  item_id="$(printf '%s' "$response" | jq -r '.data.addProjectV2ItemById.item.id // empty')"
  if [ -z "$item_id" ]; then
    emit "project" "board-add" "addProjectV2ItemById returned empty id; response: $(printf '%s' "$response" | head -c 200)"
    return 1
  fi
  N_PROJECT_ITEMS_ADDED=$((N_PROJECT_ITEMS_ADDED + 1))
  ADD_BOARD_ITEM_ID="$item_id"
  return 0
}

# Create a real typed issue + add it to the board. Results land in globals
# CREATE_ITEM_ID / CREATE_ISSUE_NODE / CREATE_ISSUE_NUM (NOT echoed) so the
# caller can invoke create_issue directly — a `$(...)` capture would run it in
# a subshell and silently discard the N_ISSUE_TYPES_SET / N_PROJECT_ITEMS_ADDED
# increments. $1 title, $2 body, $3 issue-type node id. Body via stdin
# (ARG_MAX-safe, SHY-0080). The `story` label id is inlined into the mutation
# (gh api graphql can't pass a list variable via -f; the id is a controlled
# value, not user input).
CREATE_ITEM_ID=""
CREATE_ISSUE_NODE=""
CREATE_ISSUE_NUM=""
ADD_BOARD_ITEM_ID=""
create_issue() {
  local title="$1" body="$2" type_id="$3"
  bootstrap_repo || return 1
  ensure_story_label || return 1
  local query response stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variables, NOT bash; STORY_LABEL_ID inlined into labelIds.
  query='mutation($repositoryId: ID!, $title: String!, $body: String!, $issueTypeId: ID!) { createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body, issueTypeId: $issueTypeId, labelIds: ["'"$STORY_LABEL_ID"'"] }) { issue { id number } } }'
  set +e
  response="$(printf '%s' "$body" | "$GH" api graphql -f query="$query" -f repositoryId="$REPO_NODE_ID" -f title="$title" -F body=@- -f issueTypeId="$type_id" 2>"$stderr_file")"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] createIssue "%s" (exit %d): %s\n' "$title" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  local issue_node issue_num
  issue_node="$(printf '%s' "$response" | jq -r '.data.createIssue.issue.id // empty')"
  issue_num="$(printf '%s' "$response" | jq -r '.data.createIssue.issue.number // empty')"
  if [ -z "$issue_node" ]; then
    emit "issue" "create" "createIssue returned empty id; response: $(printf '%s' "$response" | head -c 200)"
    return 1
  fi
  N_ISSUE_TYPES_SET=$((N_ISSUE_TYPES_SET + 1))
  add_to_board "$issue_node" || return 1
  CREATE_ITEM_ID="$ADD_BOARD_ITEM_ID"
  CREATE_ISSUE_NODE="$issue_node"
  CREATE_ISSUE_NUM="$issue_num"
  return 0
}

# Refresh an existing issue's title/body/native type. $1 = issue node id.
update_issue() {
  local issue_node="$1" title="$2" body="$3" type_id="$4"
  local query stderr_file rc
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2016
  # ^ GraphQL variables, NOT bash. STORY_LABEL_ID is inlined into labelIds (a
  # controlled API node id) so a manually-removed `story` label is re-applied
  # on every update — keeping `--rebuild`'s `--label story` scoping reliable.
  query='mutation($id: ID!, $title: String!, $body: String!, $issueTypeId: ID!) { updateIssue(input: { id: $id, title: $title, body: $body, issueTypeId: $issueTypeId, labelIds: ["'"$STORY_LABEL_ID"'"] }) { issue { id } } }'
  set +e
  printf '%s' "$body" | "$GH" api graphql -f query="$query" -f id="$issue_node" -f title="$title" -F body=@- -f issueTypeId="$type_id" \
    >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] updateIssue %s (exit %d): %s\n' "$issue_node" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  N_ISSUE_TYPES_SET=$((N_ISSUE_TYPES_SET + 1))
  return 0
}

# Reconcile an issue's open/closed state with its story lifecycle: terminal
# (Done/Cancelled) → closed; else → open. $1 issue node, $2 = "1" to close
# else reopen. Idempotent on GitHub's side (closing a closed issue is a no-op).
set_issue_state() {
  local issue_node="$1" want_closed="$2"
  local query stderr_file rc verb
  if [ "$want_closed" = "1" ]; then
    verb="close"
    # shellcheck disable=SC2016
    query='mutation($id: ID!) { closeIssue(input: { issueId: $id }) { issue { id } } }'
  else
    verb="reopen"
    # shellcheck disable=SC2016
    query='mutation($id: ID!) { reopenIssue(input: { issueId: $id }) { issue { id } } }'
  fi
  stderr_file="$(mktemp)"
  set +e
  "$GH" api graphql -f query="$query" -f id="$issue_node" >/dev/null 2>"$stderr_file"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '[gh-error] %sIssue %s (exit %d): %s\n' "$verb" "$issue_node" "$rc" "$(tr '\n' ' ' <"$stderr_file")" >&2
    rm -f "$stderr_file"
    return 1
  fi
  rm -f "$stderr_file"
  if [ "$want_closed" = "1" ]; then
    N_ISSUES_CLOSED=$((N_ISSUES_CLOSED + 1))
  else
    N_ISSUES_REOPENED=$((N_ISSUES_REOPENED + 1))
  fi
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

# ============================================================== sync orchestration

# ---- create paths --------------------------------------------------------

# Create a real typed GitHub issue for a story + add it to the board
# (SHY-0082 v4: every type routes here). Terminal status (Done/Cancelled) is
# born closed so finished work leaves the Issues-tab default open view.
create_issue_path() {
  local file="$1" id="$2" title="$3" hash="$4"
  # Result via global (subshell would lose the truncation counter).
  build_draft_body "$file" "$hash"
  local body="$BODY_RESULT"
  local type_id terminal=0
  type_id="$(story_type_to_issue_type_id "$PS_TYPE")"
  { [ "$PS_STATUS" = "Done" ] || [ "$PS_STATUS" = "Cancelled" ]; } && terminal=1
  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: %s: would CREATE typed ISSUE "%s" (type=%s) + add to board + populate fields%s\n' \
      "$id" "$title" "$PS_TYPE" "$([ "$terminal" = "1" ] && printf ' + close (terminal)')" >&2
    N_CREATED=$((N_CREATED + 1))
    return 0
  fi
  # create_issue sets CREATE_ITEM_ID / CREATE_ISSUE_NODE / CREATE_ISSUE_NUM and
  # increments its own counters — called DIRECTLY (a $() capture would subshell
  # away those increments).
  if ! create_issue "$title" "$body" "$type_id"; then
    emit "$id" "api" "failed to create issue"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi
  local item_id="$CREATE_ITEM_ID" issue_node="$CREATE_ISSUE_NODE" issue_num="$CREATE_ISSUE_NUM"
  N_CREATED=$((N_CREATED + 1))
  N_BODIES_EMBEDDED=$((N_BODIES_EMBEDDED + 1))
  if [ "$terminal" = "1" ]; then
    if ! set_issue_state "$issue_node" 1; then
      emit "$id" "issue" "failed to close terminal issue #${issue_num}"
      N_FAILED=$((N_FAILED + 1))
    fi
  fi
  # SHY-0079: record the new issue-backed item in the sidecar (backing=ISSUE)
  # so future syncs see it even if the Projects v2 API read is stale.
  board_items_put "$id" "ISSUE" "$item_id" "$issue_node" "$issue_num"
  emit "$id" "created" "typed issue #${issue_num} created (type=${PS_TYPE})"
  if ! populate_project_fields "$item_id" "$file" "$id"; then
    emit "$id" "project" "failed to populate fields for item ${item_id}"
    N_FAILED=$((N_FAILED + 1))
  fi
  return 0
}

# ---- sync_one (SHY-0081 v3: uniform draft routing) ------------------------

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

  # SHY-0082 v4: EVERY story is a REAL typed GitHub issue added to the board.
  # The Issues *tab* is a separate surface (user bug reports + deploy alerts).
  map_lookup "$id"

  # Legacy migration safety net: the one-shot --rebuild converts the whole
  # board, but if a normal sync still finds a story backed by a v3 DRAFT,
  # delete that draft board item (its content dies with it — there is no
  # separate issue to delete) and recreate the story as a typed issue below.
  # Steady state never hits this (post-migration there are no draft items).
  if [ "$MAP_FOUND" = "1" ] && [ "$MAP_BACKING" = "DRAFT" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      printf 'DRY-RUN: %s: legacy draft-backed item — would DELETE the draft item and recreate as a typed issue\n' "$id" >&2
      MAP_FOUND=0
    else
      emit "$id" "migrate" "legacy draft-backed item: replacing with a typed issue (deleting draft item ${MAP_ITEM_ID})"
      if ! delete_project_item "$MAP_ITEM_ID"; then
        # Don't create a duplicate issue while the stale draft survives.
        emit "$id" "project" "failed to delete draft item ${MAP_ITEM_ID} during draft→issue migration"
        N_FAILED=$((N_FAILED + 1))
        return 0
      fi
      N_ITEMS_DELETED=$((N_ITEMS_DELETED + 1))
      N_DRAFTS_MIGRATED=$((N_DRAFTS_MIGRATED + 1))
      # SHY-0079: drop the stale backing from the sidecar; the recreate below
      # re-adds the ISSUE backing via board_items_put.
      board_items_del "$id"
      MAP_FOUND=0
    fi
  fi

  # ---- create path
  if [ "$MAP_FOUND" != "1" ]; then
    create_issue_path "$file" "$id" "$title" "$hash"
    return 0
  fi

  # ---- update path (ISSUE-backed — every card is a typed issue in v4). Change
  # detection via the stored footer: body-hash for content edits, the
  # `_Status:` marker for pure status flips (status lives in frontmatter,
  # outside the body hash, so a lifecycle move would otherwise be invisible).
  local existing_body existing_hash existing_status changed=0 transition=0
  existing_body="$MAP_DRAFT_BODY"
  existing_hash="$(extract_stored_hash "$existing_body")"
  existing_status="$(extract_stored_status "$existing_body")"
  [ "$existing_hash" != "$hash" ] && changed=1
  if [ -n "$existing_status" ] && [ "$existing_status" != "$PS_STATUS" ]; then
    transition=1
  fi

  if [ "$changed" = "0" ] && [ "$transition" = "0" ]; then
    verbose "${id}: body-hash + status unchanged; skipping"
    N_SKIPPED=$((N_SKIPPED + 1))
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    printf 'DRY-RUN: %s: would UPDATE issue #%s (changed=%s transition=%s)\n' \
      "$id" "$MAP_ISSUE_NUMBER" "$changed" "$transition" >&2
    N_UPDATED=$((N_UPDATED + 1))
    return 0
  fi

  # Result via global (subshell would lose the truncation counter).
  build_draft_body "$file" "$hash"
  local type_id
  type_id="$(story_type_to_issue_type_id "$PS_TYPE")"
  # MAP_CONTENT_ID is the issue node id for an ISSUE-backed item.
  if ! update_issue "$MAP_CONTENT_ID" "$title" "$BODY_RESULT" "$type_id"; then
    emit "$id" "api" "failed to update issue #${MAP_ISSUE_NUMBER} (item ${MAP_ITEM_ID})"
    N_FAILED=$((N_FAILED + 1))
    return 0
  fi
  emit "$id" "updated" "issue #${MAP_ISSUE_NUMBER} body/type refreshed"
  N_UPDATED=$((N_UPDATED + 1))
  N_BODIES_EMBEDDED=$((N_BODIES_EMBEDDED + 1))

  # Reconcile open/closed ONLY when the terminal-ness actually changes, so a
  # non-terminal→non-terminal transition (e.g. In Progress→In Review) fires no
  # spurious close/reopen, and an unchanged story stays all-skip. existing_status
  # is the OLD lifecycle from the stored footer; PS_STATUS is the new one.
  if [ "$transition" = "1" ]; then
    local was_terminal=0 now_terminal=0
    { [ "$existing_status" = "Done" ] || [ "$existing_status" = "Cancelled" ]; } && was_terminal=1
    { [ "$PS_STATUS" = "Done" ] || [ "$PS_STATUS" = "Cancelled" ]; } && now_terminal=1
    if [ "$was_terminal" != "$now_terminal" ]; then
      if ! set_issue_state "$MAP_CONTENT_ID" "$now_terminal"; then
        emit "$id" "issue" "failed to reconcile state for issue #${MAP_ISSUE_NUMBER}"
        N_FAILED=$((N_FAILED + 1))
      fi
    fi
  fi

  # Re-assert all board fields on the EXISTING item (no re-add needed —
  # the items map already carries the item id). Status is mutated last.
  if ! populate_project_fields "$MAP_ITEM_ID" "$file" "$id"; then
    emit "$id" "project" "failed to refresh fields for item ${MAP_ITEM_ID}"
    N_FAILED=$((N_FAILED + 1))
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

  # SHY-0079: delete the UNIQUE union of API-listed raw ids AND the sidecar's
  # itemIds. If the API read was stale during this rebuild's load, the
  # sidecar still names the items so the teardown stays complete (and the
  # dedup avoids deleting the same id twice → no spurious N_FAILED).
  local all_ids item_id
  all_ids="$(
    {
      printf '%s\n' "$ITEMS_RAW_IDS"
      printf '%s' "$BOARD_ITEMS_JSON" | jq -r '.[].itemId // empty'
    } | grep -v '^$' | LC_ALL=C sort -u
  )"
  while IFS= read -r item_id; do
    [ -z "$item_id" ] && continue
    if delete_project_item "$item_id"; then
      N_ITEMS_DELETED=$((N_ITEMS_DELETED + 1))
    else
      emit "rebuild" "project" "failed to delete item ${item_id}"
      N_FAILED=$((N_FAILED + 1))
    fi
  done <<<"$all_ids"

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
  # post-teardown empty state. SHY-0079: clear the sidecar write-back state
  # too — the recreate loop repopulates it, and the write-back then commits
  # a board-items.json that matches the freshly-rebuilt board.
  ITEMS_MAP_JSON='{}'
  ITEMS_RAW_IDS=""
  ITEMS_MAP_LOADED=0
  BOARD_ITEMS_JSON='{}'
  verbose "teardown_for_rebuild: done (items deleted: ${N_ITEMS_DELETED}; issues deleted: ${N_ISSUES_DELETED})"
}

# Shared pre-sync setup (sync_all + sync_story): cache the project fields,
# ensure the Type field, then bootstrap the repo (node id + native issue-type
# ids + `story` label id) BEFORE the per-story loop — story_type_to_issue_type_id
# reads the type-id globals, so the FIRST story would otherwise be created with
# an empty issueTypeId. Skipped entirely in dry-run (read-only preview).
setup_pre_sync() {
  [ "$DRY_RUN" = "1" ] && return 0
  load_project_cache || true
  ensure_project_type_field || true
  bootstrap_repo \
    || fail_global "repo" "repo bootstrap (issue types / story label) failed — aborting before any mutations" "$E_API"
  # ensure_story_label is a no-op once bootstrap resolved the id. If the label
  # is absent AND creation fails, warn LOUDLY — the per-issue create has its own
  # guard, but a silent `|| true` would hide a setup failure that lets every
  # story-issue escape `--rebuild`'s `--label story` scoping.
  ensure_story_label \
    || printf '::warning::ensure_story_label failed — the story marker label may be missing; story-issues could escape --rebuild scoping until it is created\n' >&2
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

  # SHY-0067 + SHY-0082: pre-sync setup (Type field + repo bootstrap) before the
  # per-story loop — see setup_pre_sync.
  setup_pre_sync

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

  # SHY-0079 (AC edge-3): --all is the only mode that sees the WHOLE corpus,
  # so prune sidecar entries for SHY IDs whose .md no longer exists — a
  # deleted/renamed story must not leave an orphan entry that the overlay
  # would keep filling (which would drive spurious update attempts on a gone
  # item). Only safe in --all (sync_story sees one story, can't prune).
  if [ "$DRY_RUN" != "1" ]; then
    local live_ids
    live_ids="$(find -P "$STORIES_DIR" -maxdepth 1 -type f ! -type l \
                 -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' \
                 | sed -E 's|.*/(SHY-[0-9]{4})-.*|\1|' | jq -R . | jq -s .)"
    BOARD_ITEMS_JSON="$(printf '%s' "$BOARD_ITEMS_JSON" | jq -c --argjson live "$live_ids" \
      'with_entries(select(.key as $k | $live | index($k) != null))')"
  fi

  # SHY-0079: rewrite the sidecar from the post-run board state. Always
  # written (idempotent no-op diff when unchanged); the workflow commits it.
  write_board_items_sidecar

  printf 'Sync result: %d created, %d updated, %d skipped, %d failed' \
    "$N_CREATED" "$N_UPDATED" "$N_SKIPPED" "$N_FAILED" >&2
  printf ' (labels deleted: %d; project items added: %d; project items deleted: %d; issues deleted: %d; issue types set: %d; issues closed: %d; issues reopened: %d; drafts migrated: %d; project fields updated: %d; status fields set: %d; bodies embedded: %d; bodies truncated: %d; sidecar overlay fills: %d; type-field auto-created: %s)\n' \
    "$N_LABELS_DELETED" "$N_PROJECT_ITEMS_ADDED" "$N_ITEMS_DELETED" \
    "$N_ISSUES_DELETED" "$N_ISSUE_TYPES_SET" "$N_ISSUES_CLOSED" "$N_ISSUES_REOPENED" "$N_DRAFTS_MIGRATED" \
    "$N_PROJECT_FIELDS_UPDATED" "$N_STATUS_SET" "$N_BODIES_EMBEDDED" \
    "$N_BODIES_TRUNCATED" "$N_SIDECAR_FILLS" "$TYPE_FIELD_AUTO_CREATED" >&2

  # SHY-0067 reviewer-I2: emit a GITHUB_STEP_SUMMARY audit trail when running
  # under GitHub Actions. Local + test runs skip silently (env var unset).
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      printf '## Roadmap sync — board mirror (every story is a typed issue)\n\n'
      printf '| Metric | Count |\n'
      printf '|---|---|\n'
      printf '| Created (typed issues) | %d |\n' "$N_CREATED"
      printf '| Updated | %d |\n' "$N_UPDATED"
      printf '| Skipped (unchanged) | %d |\n' "$N_SKIPPED"
      printf '| Failed | %d |\n' "$N_FAILED"
      printf '| Labels deleted (duplicated families) | %d |\n' "$N_LABELS_DELETED"
      printf '| Project items added | %d |\n' "$N_PROJECT_ITEMS_ADDED"
      printf '| Project items deleted | %d |\n' "$N_ITEMS_DELETED"
      printf '| Issues deleted (rebuild migration) | %d |\n' "$N_ISSUES_DELETED"
      printf '| Issue types set (Bug/Feature/Task) | %d |\n' "$N_ISSUE_TYPES_SET"
      printf '| Issues closed (terminal) | %d |\n' "$N_ISSUES_CLOSED"
      printf '| Issues reopened | %d |\n' "$N_ISSUES_REOPENED"
      printf '| Drafts migrated → issues | %d |\n' "$N_DRAFTS_MIGRATED"
      printf '| Project fields updated | %d |\n' "$N_PROJECT_FIELDS_UPDATED"
      printf '| Status fields set | %d |\n' "$N_STATUS_SET"
      printf '| Bodies embedded | %d |\n' "$N_BODIES_EMBEDDED"
      printf '| Bodies truncated | %d |\n' "$N_BODIES_TRUNCATED"
      printf '| Sidecar overlay fills (stale-API gaps healed) | %d |\n' "$N_SIDECAR_FILLS"
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
  # SHY-0067 + SHY-0082: pre-sync setup for single-story mode too — see setup_pre_sync.
  setup_pre_sync
  # SHY-0074: single-source-label invariant (see sync_all).
  remove_duplicated_label_families
  sync_one "$match"
  # SHY-0079: rewrite the sidecar (load_items_map loaded the FULL board, so
  # BOARD_ITEMS_JSON is complete + reflects this story's mutation).
  write_board_items_sidecar
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
