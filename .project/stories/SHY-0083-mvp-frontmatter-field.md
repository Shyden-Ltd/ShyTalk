---
id: SHY-0083
status: Done
owner: claude
created: 2026-06-11
priority: P1
effort: S
type: infra
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1307
released_in: v0.97.11
epic: EPIC-0001
public: false
---

# SHY-0083: Add optional `mvp:` frontmatter field (MVP classification flag)

## User Story

As the ShyTalk operator,
I want an optional `mvp:` boolean field in story frontmatter, validated by the framework,
So that I can mark the stories that must ship for the first public release (the "minimum lovable" launch set) and later surface/filter exactly that set.

## Why

- The MVP go-live plan (`project-mvp-golive-parameters` memory) chose a **`mvp: true` frontmatter flag** as the launch-set marker (NOT an MVP EPIC). That marker can't be applied until the framework recognises the field — otherwise the validator (`lint.yml`) would reject every flagged story as carrying an unknown key once anything starts enforcing it, and there'd be no documented contract for what `mvp:` means.
- This is the **prerequisite** step: add + validate the field first, THEN bulk-classify the corpus (`mvp: true` on the launch set), THEN consume it (roadmap redesign, board filtering) in later SHYs.
- It mirrors the existing optional `epic:` field exactly — a shape-only check in `check_optional_fields()` — so it's a small, low-risk framework change.

## Acceptance Criteria

### Happy path

- [ ] A story with `mvp: true` in frontmatter passes validation (`check-story-frontmatter.sh <file>` exits `0`).
- [ ] A story with `mvp: false` passes validation (exit `0`).
- [ ] A story with **no** `mvp:` line passes validation (the field is optional; absence is valid and semantically equals `false`) — exit `0`.
- [ ] `--scan` over the whole corpus still exits `0` with the field present on some files and absent on others.

### Error paths

- [ ] A story with `mvp:` set to a non-boolean value (`yes`, `no`, `1`, `0`, `True`, `FALSE`, `maybe`, or empty) FAILS with exit `11` (`E_INVALID_VALUE`) and a stderr message naming the field + the allowed values (`mvp must be true or false`). Value matrix — one assertion each:
  - `mvp: true` → exit 0
  - `mvp: false` → exit 0
  - `mvp: yes` → exit 11
  - `mvp: 1` → exit 11
  - `mvp: True` → exit 11 (strict lowercase)
  - `mvp: FALSE` → exit 11
  - `mvp:` (empty) → exit 11
- [ ] The failure uses the existing `fail … "invalid optional field" … "$E_INVALID_VALUE"` path (same category string as `epic`), so CI surfacing is consistent.

### Edge cases

- [ ] Surrounding whitespace is tolerated: `mvp:   true   ` (leading/trailing spaces around the value) → exit `0` (regex anchors with `[[:space:]]*`, matching the `epic`/`status` conventions).
- [ ] The check is SHY-only: the EPIC validator (`check-epic-frontmatter.sh`) is unchanged and does NOT learn `mvp:` (EPICs are not part of the launch set).
- [ ] An `mvp:` key does NOT collide with or affect any required-field check, the BDD/section checks, or the `epic:`/`public:` checks.

### Performance

- [ ] One additional `grep`/regex per file in `check_optional_fields()`; corpus `--scan` runtime is unchanged within noise (N/A for a meaningful budget — it's a single-line lint addition).

### Security

- N/A — internal lint of a static frontmatter key; no user input, no secrets, no network.

### UX

- [ ] `CLAUDE.md`'s frontmatter section documents `mvp:` as optional (default `false`), boolean, with a one-line "marks a story as part of the first public release (MVP) launch set" description, and the optional-field count is updated to match.
- [ ] The validator's `--verbose` mode prints an `optional:mvp` `[check]` line (mirroring `optional:epic`) so authors can see the check ran.
- [ ] The error message is actionable (names the field + the two allowed values), not a generic "invalid value".

### i18n

- N/A — `mvp:` is an internal frontmatter key, never user-facing; no translatable strings.

### Observability

- [ ] The invalid-value path increments the validator's failure surface (non-zero exit + a structured `[fail]`/stderr line categorised `invalid optional field`), consistent with the other optional-field failures.

## BDD Scenarios

**Scenario: mvp:true is accepted**
- **Given** a story file whose frontmatter contains `mvp: true`
- **When** `check-story-frontmatter.sh <file>` runs
- **Then** it exits `0` with no error for the `mvp` field

**Scenario: absent mvp field is valid (optional)**
- **Given** a story file with no `mvp:` line
- **When** the validator runs
- **Then** it exits `0` (absence is valid, meaning not-in-MVP)

**Scenario: non-boolean mvp value is rejected**
- **Given** a story file with `mvp: yes`
- **When** the validator runs
- **Then** it exits `11`
- **And** stderr names the `mvp` field and states the allowed values are `true` or `false`

**Scenario: capitalised boolean is rejected (strict)**
- **Given** a story file with `mvp: True`
- **When** the validator runs
- **Then** it exits `11` (only lowercase `true`/`false` are valid)

**Scenario: corpus scan with mixed presence stays green**
- **Given** some stories carry `mvp: true`, others `mvp: false`, others none
- **When** `check-story-frontmatter.sh --scan .project/stories` runs
- **Then** it exits `0`

## Test Plan

**RED (failing first) — `express-api/tests/scripts/check-story-frontmatter.test.js`:**
- New describe `SHY-0083: optional mvp: field` with one test per value-matrix row above (`true`/`false`/absent → 0; `yes`/`1`/`True`/`FALSE`/empty → 11), each asserting the exact exit code AND, for failures, the stderr substring (`mvp must be true or false`).
- Whitespace-tolerance test (`mvp:   true   ` → 0).
- `--scan` mixed-presence test → 0 (build a temp dir with three fixtures).
- `--verbose` emits `optional:mvp` test (assert the `[check]` line on stderr).
- Negative-isolation test: a file that is otherwise invalid for a DIFFERENT reason still fails for that reason (mvp check doesn't mask other failures).

**RED — `express-api/tests/scripts/check-epic-frontmatter.test.js`:**
- Assert the EPIC validator does NOT reject or require `mvp:` (an EPIC file with a stray `mvp:` is unaffected by EPIC rules — guards the SHY-only scope).

**GREEN:** in `scripts/check-story-frontmatter.sh`, add to `check_optional_fields()` a block mirroring `epic:` — `VALID_MVP="^mvp:[[:space:]]*(true|false)[[:space:]]*$"`; if `grep -qE '^mvp:' "$fm"` and not `grep -qE "$VALID_MVP" "$fm"` → `fail … "invalid optional field" "mvp must be true or false" "$E_INVALID_VALUE"`; add the `verbose "optional:mvp"` line.

**Docs:** update `CLAUDE.md` frontmatter section (optional-field list + count) to include `mvp`.

**Green gates:** full `cd express-api && npm test`; `shellcheck scripts/check-story-frontmatter.sh` clean (no suppressions); `check-story-frontmatter.sh --scan .project/stories` exits 0.

## Out of Scope

- **Consuming** the flag: the public roadmap redesign that displays the MVP set, any board/`roadmap-data.json` surfacing of `mvp`, and the go-live ETA work are SEPARATE SHYs.
- **Bulk-classifying** the corpus (setting `mvp: true` on the launch set) — that's the immediate follow-up step once this field exists, not part of this story.
- Adding `mvp:` to EPIC frontmatter.
- Any sync-script behaviour change (the mirror ignores unknown/extra frontmatter keys; `mvp:` needs no sync logic).

## Dependencies

- None (pure validator + docs change). Builds on the EPIC-0001 framework. UNBLOCKS the MVP classification + roadmap-redesign work in `project-mvp-golive-parameters`.

## Risks & Mitigations

- **Boolean regex too loose/strict.** *Mitigation:* exhaustive value matrix in tests (incl. `True`/`1`/`yes`/empty) locks the contract at RED.
- **The mirror sync or roadmap generator chokes on the new key.** *Mitigation:* verify the sync script + `sync-shy-to-roadmap-data.mjs` ignore unknown frontmatter keys (they parse a known allow-list); add a note if any change is needed (expected: none).
- **Count drift in CLAUDE.md.** *Mitigation:* update the "N required + M optional" tallies and the bullet list together; re-read the section after editing.

## Definition of Done

- RED tests authored first (clause→test map in PR body), then GREEN; full `express-api` suite passes; `shellcheck` clean (no suppressions); `--scan` green over the live corpus.
- `code-reviewer` agent on the local branch BEFORE push → ZERO findings.
- `CLAUDE.md` updated (optional `mvp:` documented + counts) and `SHY-INDEX.md` row added.
- Merged + released (`released_in: vX.Y.Z`).

## Notes (running log)

- 2026-06-12 ~01:10 BST — **DONE — released in v0.97.11** (PR #1307; tag v0.97.11 cut 2026-06-11). Closeout was overdue — the `.md` + index lagged at In Progress while the field itself shipped; flipped to Done + `released_in: v0.97.11` in the v0.97.12 corpus-closeout PR alongside SHY-0082. The `mvp:` frontmatter field is live and validator-accepted; `released_in:` rides the same tolerant-unknown-field path (validator exit 0).
- 2026-06-11 ~19:38 BST — Filed as the framework prerequisite for the MVP programme (operator chose "mvp: field first" over building SHY-0082 Mirror-v4 immediately; v4 is approved-as-spec and deferred to right after this). Marker decision = `mvp: true` frontmatter flag, no MVP EPIC (`project-mvp-golive-parameters` memory). Validator-only, shape-checked like `epic:`; consumption (roadmap redesign, board filtering) and bulk-classification are separate follow-ups.
