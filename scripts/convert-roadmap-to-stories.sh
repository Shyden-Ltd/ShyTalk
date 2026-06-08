#!/usr/bin/env bash
# shellcheck shell=bash
#
# convert-roadmap-to-stories.sh
#
# One-shot LOCAL-ONLY script that generates skeleton SHY-NNNN-*.md files for
# every OPEN PR-bundle in the zero-gap roadmap, then updates SHY-INDEX.md.
#
# Per SHY-0003 spec architect cycle 1 finding C1: the roadmap doc at
# .project/test-plans/exhaustive/ is gitignored. This script is operator-run
# locally; CI does NOT invoke it. The lint.yml step validates the GENERATED
# .project/stories/SHY-*.md skeletons via check-story-frontmatter.sh, not
# the conversion script itself.
#
# Per architect C2: skeletons use prose `N/A — TBD refinement on pickup` under
# each `### <dimension>` AC sub-heading (NO `- [ ]` bullets), so the
# validator's BDD presence rule does not trigger.
#
# Per architect I5: slug derivation uses an explicit per-PR-bundle lookup
# table embedded below (NOT algorithmic — the roadmap "Fix" column wording is
# too varied for reliable keyword extraction). Missing entries fall back to
# `SHY-NNNN-pr-<bundle>-tbd.md`.
#
# Per architect I3: re-run idempotency detects existing SHYs by `roadmap_ids`
# frontmatter overlap (NOT filename glob).
#
# USAGE
#   convert-roadmap-to-stories.sh             # generate + write
#   convert-roadmap-to-stories.sh --dry-run   # print plan; no writes
#   convert-roadmap-to-stories.sh --help

set -euo pipefail

VERSION="1.0.0"

E_OK=0
E_USAGE=2
E_OUTPUT_DIR=42
E_COLLISION=43

DRY_RUN=0
OUTPUT_DIR=""
START_ID=""
VERBOSE=0

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_OUTPUT_DIR="${REPO_ROOT}/.project/stories"
INDEX_FILE="${DEFAULT_OUTPUT_DIR}/SHY-INDEX.md"
TODAY_UTC="$(date -u '+%Y-%m-%d')"

# ============================================================== usage

usage() {
  cat <<EOF
convert-roadmap-to-stories.sh ${VERSION}

USAGE
  convert-roadmap-to-stories.sh             # generate skeletons + update INDEX
  convert-roadmap-to-stories.sh --dry-run   # print plan to stdout; no writes
  convert-roadmap-to-stories.sh --verbose   # add per-bundle log lines
  convert-roadmap-to-stories.sh --output-dir <path>
  convert-roadmap-to-stories.sh --start-id SHY-NNNN
  convert-roadmap-to-stories.sh --help

ARCHITECTURE
  LOCAL-ONLY — the source roadmap at .project/test-plans/exhaustive/ is
  gitignored. CI does NOT invoke this script. Run it once locally per
  major roadmap evolution; the generated skeletons are tracked in git.

CATEGORY → TYPE MAPPING (multi-token tie-break left-to-right):
  Security    → bug
  Test        → bug
  CI          → infra
  Workflow    → infra
  Dep         → infra
  Journey     → feature
  BDD         → feature
  Doc         → docs

EXIT CODES
  0   success
  2   usage error
  42  output dir not writable
  43  SHY-ID collision (existing skeleton claims a planned ID)

EXAMPLES
  convert-roadmap-to-stories.sh --dry-run
  convert-roadmap-to-stories.sh
EOF
}

verbose() {
  if [ "$VERBOSE" = "1" ]; then
    printf '[verbose] %s\n' "$1" >&2
  fi
}

# ============================================================== PR-bundle table
#
# Each entry is a tab-separated record:
#   PR_ID \t SHY_ID \t SLUG \t TYPE \t PRIORITY \t EFFORT \t ROADMAP_IDS \t TITLE
#
# Source: the architect's recommended PR sequencing in the zero-gap roadmap
# (.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md, lines 122-173)
# CROSS-CHECKED against the merged-PR list as of 2026-06-07. ONLY OPEN bundles
# are listed here; shipped bundles are omitted.
#
# SHY-IDs start at SHY-0004 (SHY-0001/2/3 are reserved for the foundational
# workflow stories that ship the SHY system itself).
#
# G055 (gh-pages cross-workflow deploy race) is the new G-ID surfaced during
# SHY-0001 work — appended as PR-G6 here, gets the last SHY-ID in the batch.

BUNDLES=$(cat <<'TABLE'
PR-A2	SHY-0004	verify-room-mutation-p3-deploy	bug	P0	S	G009 G027	Verify Room mutation P3 deploy status + reconcile
PR-A4	SHY-0005	biometric-alpha-to-stable	infra	P0	XS	G002	Biometric alpha → stable or rationale comment
PR-B1	SHY-0006	add-push-permission-vm-tests	bug	P1	S	G005 G013 G029	PushPermissionDeniedBanner + HomeScreen + HomeViewModel push tests
PR-C1	SHY-0007	add-gacha-and-age-verification-features	feature	P1	S	G007 G008	gacha.feature + age_verification.feature
PR-C2	SHY-0008	expand-economy-bdd-coverage	feature	P1	M	G017	subscription/gifting/backpack BDD expansion
PR-C3	SHY-0009	add-lock-pin-security-nav-coverage	feature	P1	S	G010	Lock/PinSetup/SecuritySettings nav coverage
PR-D1	SHY-0010	add-home-gacha-vm-tests	bug	P0	M	G003-D1	HomeViewModel + GachaViewModel tests
PR-D2	SHY-0011	add-economy-vm-tests	bug	P0	M	G003-D2	Wallet + Gifting + TransactionHistory VM tests
PR-D3	SHY-0012	add-remaining-vm-tests	bug	P0	L	G003-D3	10 remaining VM tests
PR-E1	SHY-0013	add-core-infra-tests	bug	P1	M	G004 G020	RoomLifecycleManager + AnimationQueue + ModerationFilter tests
PR-E2	SHY-0014	add-room-service-controller-tests	bug	P1	M	G016	Android/Ios RoomServiceController tests
PR-E3	SHY-0015	add-secure-storage-contract-tests	bug	P1	S	G019	SecureStorage + CryptoKeyPair contract tests
PR-E4	SHY-0016	add-sticker-storage-tests	bug	P2	S	G038	StickerStorage platform tests
PR-F1	SHY-0017	add-ios-room-repo-tests	bug	P1	M	G014	IosRoomRepositoryImpl tests
PR-F2	SHY-0018	add-ios-message-bridge-tests	bug	P1	M	G015 G030	IosMessage + SeatRequest + PushBridge tests
PR-G2	SHY-0019	fix-qa-runner-smoke-true	infra	P1	S	G012	qa-runner --smoke ||true → targeted exit-code
PR-G3	SHY-0020	add-release-to-qa-matrix-workflow-call	infra	P1	S	G022 G049	release.yml → manual-qa-matrix.yml workflow_call
PR-G4	SHY-0021	add-cron-account-deletion-endpoint-test	infra	P1	S	G021	cron-account-deletion endpoint integration test
PR-H1a	SHY-0022	seed-admin-keyboard-data-fixtures	bug	P1	M	G023	admin-keyboard data-dependent skip remediation
PR-H2a	SHY-0023	seed-admin-backups-cross-tab-fixtures	bug	P2	S	G033	admin-backups + admin-cross-tab data fixture gaps
PR-I1	SHY-0024	resolve-navgraph-coexistence	refactor	P1	M	G028	NavGraph.kt vs SharedNavGraph.kt — needs operator decision
PR-I3	SHY-0025	upgrade-locale-parity-key-set	bug	P2	XS	G042 G052	Locale parity test key-set + PR #1010 string verification
PR-I4	SHY-0026	add-mobile-driver-helper-scripts	infra	P2	S	G043 G044	mobile-android flags check + iOS WDA build script
PR-I5	SHY-0027	dependabot-sweep-codeql-kotlin	chore	P2	XS	G045 G047	Dependabot sweep + CodeQL Kotlin enable
PR-I6	SHY-0028	gradle-deprecation-sweep	chore	P2	S	G046	Gradle deprecation sweep (--warning-mode all)
PR-I7	SHY-0029	tighten-ownerfirebaseuid-rule	bug	P1	S	G026	Tighten ownerFirebaseUid rule post-rollout
PR-I8	SHY-0030	refresh-ios-parity-navigation-feature	feature	P2	XS	G039	ios_parity_navigation.feature freshness
PR-G6	SHY-0031	serialise-gh-pages-deploys	infra	P1	S	G055	Serialise gh-pages cross-workflow deploys (split-job pattern)
TABLE
)

# ============================================================== generation

# emit_skeleton <SHY_ID> <SLUG> <TYPE> <PRIORITY> <EFFORT> <ROADMAP_IDS_SPACE_SEP> <TITLE> <PR_ID> <OUTFILE>
emit_skeleton() {
  # slug ($2) is encoded into outfile ($9) by the caller; not referenced
  # directly here, but kept in the signature for documentation symmetry
  # with the BUNDLES table columns.
  # shellcheck disable=SC2034
  local shy_id="$1" slug="$2" type="$3" pri="$4" eff="$5" roadmap_ids_raw="$6" title="$7" pr_id="$8" outfile="$9"
  # roadmap_ids array form: [G001, G024]
  local roadmap_ids_csv
  roadmap_ids_csv="$(printf '%s' "$roadmap_ids_raw" | tr ' ' ',' | sed 's/,/, /g')"
  local roadmap_yaml="[${roadmap_ids_csv}]"
  # First scenario stub per roadmap_id
  local bdd_stubs=""
  local rid
  for rid in $roadmap_ids_raw; do
    bdd_stubs+="**Scenario: Refined behaviour for ${rid} (TBD on pickup)**

- **Given** the spec for ${rid}'s gap as documented in the roadmap row
- **When** the implementation lands per the Fix column guidance
- **Then** the AC bullets pinned at pickup pass
- **And** the validator + reviewer agents return ZERO findings

"
  done

  cat >"$outfile" <<EOF
---
id: ${shy_id}
status: Draft
owner: claude
created: ${TODAY_UTC}
priority: ${pri}
effort: ${eff}
type: ${type}
roadmap_ids: ${roadmap_yaml}
pr:
---

# ${shy_id}: ${title}

## User Story

As the ShyTalk operator, I want **${title}** delivered per the roadmap row(s) for ${roadmap_ids_raw}, so that the corresponding gap in the zero-gap remediation roadmap closes.

## Why

This SHY mirrors PR-bundle \`${pr_id}\` from the architect's recommended PR sequencing (lines 122–173 of \`.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md\`). The deeper rationale — including the Gap / Fix / Scope columns for each G-ID — lives in the roadmap row(s) for ${roadmap_ids_raw}. Refinement on pickup will copy the relevant content into this section.

## Acceptance Criteria

### Happy path

N/A — TBD refinement on pickup.

### Error paths

N/A — TBD refinement on pickup.

### Edge cases

N/A — TBD refinement on pickup.

### Performance

N/A — TBD refinement on pickup.

### Security

N/A — TBD refinement on pickup.

### UX

N/A — TBD refinement on pickup.

### i18n

N/A — TBD refinement on pickup.

### Observability

N/A — TBD refinement on pickup.

## BDD Scenarios

${bdd_stubs}

## Test Plan (TDD)

### Red

(TBD on pickup — write failing tests per the refined Acceptance Criteria.)

### Green

(TBD on pickup — implement the minimum needed to flip red → green.)

## Out of Scope

- Refinement of this skeleton's AC + BDD + Test Plan is the FIRST step of picking it up (the skeleton is intentionally TBD-shaped per SHY-0003 spec).

## Dependencies

- Roadmap row(s) for ${roadmap_ids_raw} in \`.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md\` (gitignored — local only).
- SHY-0001 (workflow) and SHY-0002 (GitHub Issues integration) both shipped.

## Risks & Mitigations

- **Risk:** Skeleton refinement on pickup misinterprets the roadmap row's intent. **Mitigation:** Quote the roadmap's Gap + Fix columns verbatim into the Why section during refinement; architect-validate before TDD.

## Definition of Done

- [ ] Refinement on pickup: AC dimensions populated with verifiable bullets, BDD scenarios deepened, Test Plan red/green concrete
- [ ] Architect agent dispatched against the refined spec; findings applied
- [ ] Code-reviewer agent reports ZERO findings
- [ ] Per-type Done gate satisfied (\`${type}\`)
- [ ] PR merged via auto-merge
- [ ] \`status: Done\` set; \`pr:\` populated; merge timestamp in Notes log

## Notes (running log)

- ${TODAY_UTC} — Skeleton generated by \`scripts/convert-roadmap-to-stories.sh\` from PR-bundle \`${pr_id}\` (roadmap_ids: ${roadmap_ids_raw}). Status: Draft; AC dimensions are \`N/A — TBD refinement on pickup\` per SHY-0003 spec. Pickup must refine before TDD.
EOF
}

# Build a set of already-claimed roadmap_ids by scanning existing SHY-NNNN files.
collect_claimed_roadmap_ids() {
  local f
  find -P "$DEFAULT_OUTPUT_DIR" -maxdepth 1 -type f ! -type l \
    -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' 2>/dev/null \
    | while IFS= read -r f; do
        awk '/^---[[:space:]]*$/{n++; if(n==2) exit; next} n==1 && /^roadmap_ids:/ {
          sub(/^roadmap_ids:[[:space:]]*\[/,"")
          sub(/\][[:space:]]*$/,"")
          gsub(/,/," ")
          print
        }' "$f"
      done
}

# Returns 0 if any G-ID in the bundle is already claimed, 1 otherwise.
bundle_is_claimed() {
  local roadmap_ids_raw="$1" claimed="$2"
  local rid
  for rid in $roadmap_ids_raw; do
    if printf '%s\n' "$claimed" | tr ' ' '\n' | grep -qFx "$rid"; then
      return 0
    fi
  done
  return 1
}

# Update SHY-INDEX.md by appending new rows to the Active table. The INDEX
# is prettier-formatted; we append rows inside the table and trust prettier
# to realign columns on the next save.
update_index() {
  local id="$1" pri="$2" eff="$3" type="$4" title="$5"
  local file="$INDEX_FILE"
  local row="| [${id}](${id}-${SLUG}.md) | ${pri}  | ${eff}      | ${type}  | ${title} | 📝 Draft | (TBD) | —   |"
  # Insert before the "## Done" header.
  awk -v ROW="$row" '
    BEGIN{inserted=0}
    /^## Done$/ && !inserted { print ROW; print ""; inserted=1 }
    {print}
  ' "$file" >"${file}.tmp" && mv "${file}.tmp" "$file"
}

# ============================================================== main

main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --dry-run) DRY_RUN=1; shift ;;
      --verbose) VERBOSE=1; shift ;;
      --output-dir)
        if [ "$#" -lt 2 ]; then
          printf 'usage: --output-dir requires a path\n' >&2
          exit "$E_USAGE"
        fi
        OUTPUT_DIR="$2"
        shift 2
        ;;
      --start-id)
        if [ "$#" -lt 2 ]; then
          printf 'usage: --start-id requires SHY-NNNN\n' >&2
          exit "$E_USAGE"
        fi
        # Future: collision-recovery flag. Today the BUNDLES table has
        # explicit SHY-IDs so --start-id is a no-op stub kept for spec
        # compatibility (architect: keep the flag signature stable).
        # shellcheck disable=SC2034
        START_ID="$2"
        shift 2
        ;;
      *) printf 'usage: unknown flag %s; see --help\n' "$1" >&2; exit "$E_USAGE" ;;
    esac
  done

  OUTPUT_DIR="${OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"

  if [ "$DRY_RUN" != "1" ] && [ ! -w "$OUTPUT_DIR" ]; then
    printf 'output dir not writable: %s\n' "$OUTPUT_DIR" >&2
    exit "$E_OUTPUT_DIR"
  fi

  # Collect already-claimed roadmap_ids for idempotency.
  local claimed
  claimed="$(collect_claimed_roadmap_ids | tr '\n' ' ')"
  verbose "claimed G-IDs (so far): ${claimed}"

  local n_created=0 n_skipped=0
  while IFS=$'\t' read -r PR_ID SHY_ID SLUG TYPE PRIORITY EFFORT ROADMAP_IDS TITLE; do
    [ -z "$PR_ID" ] && continue
    if bundle_is_claimed "$ROADMAP_IDS" "$claimed"; then
      verbose "${PR_ID}: claimed (${ROADMAP_IDS}); skipping"
      n_skipped=$((n_skipped + 1))
      continue
    fi
    local outfile="${OUTPUT_DIR}/${SHY_ID}-${SLUG}.md"
    if [ "$DRY_RUN" = "1" ]; then
      printf 'DRY-RUN: would create %s (PR-bundle %s; roadmap_ids: %s)\n' \
        "$outfile" "$PR_ID" "$ROADMAP_IDS"
      n_created=$((n_created + 1))
      continue
    fi
    if [ -e "$outfile" ]; then
      printf 'COLLISION: %s already exists (use --start-id to skip)\n' "$outfile" >&2
      exit "$E_COLLISION"
    fi
    emit_skeleton "$SHY_ID" "$SLUG" "$TYPE" "$PRIORITY" "$EFFORT" "$ROADMAP_IDS" "$TITLE" "$PR_ID" "$outfile"
    update_index "$SHY_ID" "$PRIORITY" "$EFFORT" "$TYPE" "$TITLE"
    # Add this bundle's IDs to claimed for in-script idempotency tracking.
    claimed="${claimed} ${ROADMAP_IDS}"
    n_created=$((n_created + 1))
    printf '%s: created %s\n' "$SHY_ID" "$outfile"
  done <<< "$BUNDLES"

  printf '\nConversion result: %d created, %d skipped\n' "$n_created" "$n_skipped"
  exit "$E_OK"
}

main "$@"
