---
id: SHY-0001
status: Done
owner: claude
created: 2026-06-06
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0001
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1034
---

# SHY-0001: Establish Agile user-story way of working

## User Story

As the ShyTalk operator, I want every piece of work captured as a detailed user-story `.md` file with 9 frontmatter fields, 10 required `##` body sections (plus an `# <Title>` h1 that is not validator-enforced), an 8-dimension Acceptance Criteria checklist, and Markdown-native BDD scenarios, so that any future session (mine or another agent's) can resume the work cold without losing scope across `/clear`, context compaction, or session restart — and so the architect / code-reviewer pipeline operates against an explicit, machine-verifiable spec rather than implicit assumptions.

## Why

Conversation-only context vanishes at `/clear` and compaction boundaries. Critical multi-day work loses spec fidelity. Codifying every PR's scope into a self-contained `.md` makes:

1. **Resumption resilient** — pick up a story by reading one file.
2. **Architect validation possible** — the architect agent scores a concrete spec.
3. **Reviewer rubric explicit** — AC checkboxes + BDD scenarios are the contract.
4. **Backlog visible** — `.project/stories/SHY-INDEX.md` is the live queue (sorted `priority asc, created asc`).
5. **Drift prevention** — a CI validator (`scripts/check-story-frontmatter.sh`) enforces the template so future stories cannot merge malformed.

This story BOOTSTRAPS the workflow itself so SHY-0002+ inherit the template, validator, and CLAUDE.md guidance. It is intentionally the FIRST story.

Operator-confirmed decisions across 5 question rounds on 2026-06-06 (every Recommended option selected):

- ID format: `SHY-XXXX` (4-digit zero-padded).
- 9 frontmatter fields: `id`, `status`, `owner`, `created`, `priority`, `effort`, `type`, `roadmap_ids`, `pr`.
- 10 required `##` body sections (User Story + Why + AC + BDD + Test Plan + Out of Scope + Dependencies + Risks + DoD + Notes) plus 1 `# <Title>` h1 (NOT validator-enforced).
- 8-dimension AC (Happy / Errors / Edges / Performance / Security / UX / i18n / Observability) — same strict template for every `type`.
- BDD format: Markdown-native (bold `Scenario:` + bold `Given / When / Then` bullets).
- BDD coverage: presence-based — AC ≥1 checkbox requires BDD ≥1 scenario; one scenario may validly cover many bullets (architect round-2 Important #6 relaxed the original strict 1:1).
- Status enum: `Draft` / `In Progress` / `In Review` / `Done` / `Cancelled` with explicit flip triggers.
- Naming convention: strict (`story/SHY-NNNN-slug` branch, `[SHY-NNNN]` commit subject, `SHY-NNNN: Title` PR title).
- Granularity: 1 PR-bundle = 1 SHY.
- Scope creep handling: reviewer's unrelated findings become NEW SHYs in the same session.
- Done bar per `type`: `infra` / `docs` / `chore` / `refactor` = auto-merge; `feature` / `bug` = +deploy-to-dev + smoke; `spike` = Notes-recorded decision + follow-up SHYs.
- Tracking integration: GitHub Issues + Projects v2 (delivered as SHY-0002).
- OOB exemption: dotfiles / personal-env / memory files are exempt — direct fixes.

## Acceptance Criteria

### Happy path

- [ ] `.gitignore` un-ignores `.project/stories/` while keeping the other internal-doc subdirectories local-only. Implementation uses per-subdir exclude lines (`.project/plans/`, `.project/specs/`, `.project/test-plans/`, `.project/test-reports/`, `.project/audit-findings-*.md`, `.project/ios-build-warnings-debt.md`) — NOT a blanket `.project/` exclude with a `!.project/stories/` negation. The negation approach is forbidden by Git's pattern spec (https://git-scm.com/docs/gitignore: "It is not possible to re-include a file if a parent directory of that file is excluded"). The per-subdir approach is more verbose but is the only behaviour Git supports.
- [ ] `git check-ignore .project/stories/SHY-0001-establish-agile-workflow.md` returns exit 1 (file is NOT ignored after the negation lands)
- [ ] `.project/stories/` directory exists in git (tracked, not ignored)
- [ ] `.project/stories/SHY-INDEX.md` exists with a markdown table (columns: ID · Pri · Effort · Type · Title · Status · Roadmap IDs · PR) and lists SHY-0001 as `📝 Draft`; the legend documents 5 status emoji and the sort order
- [ ] `.project/stories/SHY-0001-establish-agile-workflow.md` (this file) exists with all 9 required frontmatter fields and all 10 required `##` body sections (plus the `# <Title>` h1 — see Error paths AC for why the h1 isn't validator-enforced)
- [ ] `scripts/check-story-frontmatter.sh` exists, mode 755, accepts a single file path argument, and exits 0 against this story file
- [ ] `scripts/check-story-frontmatter.sh --scan .project/stories` exits 0 against the live stories directory (validates SHY-0001 and skips `SHY-INDEX.md` via the `SHY-[0-9][0-9][0-9][0-9]-*.md` glob)
- [ ] `.github/workflows/lint.yml` has a step labelled `Validate SHY story frontmatter` placed AS THE LAST step in the lint job (after `actionlint` + `shellcheck`)
- [ ] `CLAUDE.md` has a new top-level `## Agile Way of Working` section placed between `## Tri-Platform Policy` and `## Build & Test Commands` documenting all the rules above
- [ ] `express-api/tests/scripts/check-story-frontmatter.test.js` (Jest) runs locally via `cd express-api && npm test -- check-story-frontmatter` and all tests pass
- [ ] Global memory `feedback-agile-user-stories.md` exists in `~/.claude/projects/-Users-shyden/memory/` and is indexed in `MEMORY.md` (already done in-session before this PR; verified by the operator)

### Error paths

For each of the following, the validator MUST exit with a NON-zero exit code AND print a structured stderr line `<absolute-path>: <category>: <details>`:

- [ ] Missing `id` frontmatter field → exit 10, stderr contains `missing required frontmatter field: id`
- [ ] Missing `status` field → exit 10, stderr names `status`
- [ ] Missing `owner` field → exit 10, stderr names `owner`
- [ ] Missing `created` field → exit 10, stderr names `created`
- [ ] Missing `priority` field → exit 10, stderr names `priority`
- [ ] Missing `effort` field → exit 10, stderr names `effort`
- [ ] Missing `type` field → exit 10, stderr names `type`
- [ ] Missing `roadmap_ids` field → exit 10, stderr names `roadmap_ids`
- [ ] `id` not matching `^SHY-[0-9]{4}$` → exit 11, stderr contains `id must match SHY-NNNN pattern`
- [ ] `status` not in `{Draft, In Progress, In Review, Done, Cancelled}` → exit 11, stderr lists the 5 allowed values
- [ ] `priority` not in `{P0, P1, P2, P3}` → exit 11, stderr lists the 4 allowed values
- [ ] `effort` not in `{XS, S, M, L, XL}` → exit 11, stderr lists the 5 allowed values
- [ ] `type` not in `{feature, bug, refactor, docs, infra, spike, chore}` → exit 11, stderr lists the 7 allowed values
- [ ] `roadmap_ids` in scalar form (e.g. `roadmap_ids: G001`) → exit 11, stderr contains `roadmap_ids must be in array form`
- [ ] Missing any of the **10 required `##` body sections** (User Story, Why, Acceptance Criteria, BDD Scenarios, Test Plan, Out of Scope, Dependencies, Risks & Mitigations, Definition of Done, Notes) → exit 12, stderr names the missing section. **Note:** the `# <Title>` h1 line is the 11th body element but is NOT a `## ` section — it's not validator-enforced as a presence check (a missing h1 would be caught by the missing-`## User Story` check anyway, since the User Story is always immediately after the h1).
- [ ] Missing any of the **8 required `###` AC sub-headings** (Happy path, Error paths, Edge cases, Performance, Security, UX, i18n, Observability) inside the `## Acceptance Criteria` section → exit 14, stderr contains `missing required AC sub-heading: ### <name>`. Empty body under a sub-heading is allowed only if the body is `N/A — <rationale>` on a single line; otherwise it counts as missing (architect/reviewer gate, not validator).
- [ ] BDD coverage gap: AC has ≥1 checkbox but `## BDD Scenarios` has zero `**Scenario:**` blocks → exit 13, stderr contains `AC has N bullets but BDD has 0 scenarios — add at least one`. **Presence-based rule (NOT strict 1:1)** per architect round 2 Important #6: a single scenario can validly cover multiple closely-related AC bullets — strict count equality would force over-decomposition. The reviewer agent enforces depth / per-bullet coverage; the validator only guarantees the structural presence. **Counting algorithm** is still sectional — checkboxes outside `## Acceptance Criteria` and Scenario blocks outside `## BDD Scenarios` are excluded.
- [ ] `--scan` mode on a directory containing one malformed file → exit 20, stderr contains the offending file's full path + the inner failure category code
- [ ] No file path argument provided → exit 2, stderr prints usage

### Edge cases

- [ ] CRLF line endings (Windows-style `\r\n`) tolerated — `\r` stripped before any regex match; well-formed CRLF file exits 0
- [ ] Empty file (0 bytes) rejected with exit 10, stderr `no frontmatter found`
- [ ] File with only `---\n---\n` (frontmatter delimiters but no fields) rejected with the missing-field error chain
- [ ] `roadmap_ids: []` (empty array) accepted — exit 0
- [ ] `roadmap_ids: [G001]` (single-item array) accepted — exit 0
- [ ] `roadmap_ids: [G001, G024, G053]` (multi-item array) accepted — exit 0
- [ ] Section header `## Test Plan (TDD)` accepted (prefix match `^## Test Plan` matches the suffixed variant); no false-negative
- [ ] Section header `## Notes (running log)` accepted (prefix match)
- [ ] Story file with trailing whitespace on every line — exit 0 (whitespace ignored)
- [ ] Story file with trailing blank lines after Notes — exit 0
- [ ] `--scan` on an empty directory — exit 0 (vacuously valid)
- [ ] `--scan` on a directory containing only `SHY-INDEX.md` — exit 0 (glob excludes INDEX)
- [ ] `--scan` on a directory containing `.DS_Store`, `README.md`, and other non-SHY files — exit 0 (glob excludes non-matching names)
- [ ] Hidden file `.SHY-0099.md` not validated (the glob `SHY-[0-9][0-9][0-9][0-9]-*.md` requires no leading dot)
- [ ] BOM (UTF-8 byte-order mark `\xEF\xBB\xBF`) at file start tolerated — stripped before frontmatter parse

### Performance

- [ ] Single-file validation: <500ms wall-clock on CI ubuntu-latest (measured via `time` in the test, with a margin)
- [ ] `--scan` against a 20-file fixture directory: <5s wall-clock (CI ubuntu + macOS dev — chosen as a conservative bound that holds across both x86 CI and Apple Silicon dev; per-file cost is ~100ms due to mktemp + per-check process spawns in bash 3.2-compat mode, so 100 files would be ~10s on macOS, which exceeds the CI logbook-readability target). Larger fixture counts are an optimisation follow-up tracked separately.
- [ ] Memory: <50MB resident for the largest expected story file (1MB) — verified via `/usr/bin/time -v` on the fixture
- [ ] Validator runs sequentially (no fork bombs, no spawned background processes); single-process model documented in `--help`

### Security

- [ ] Validator does NOT execute any content from the story file (no `eval`, no `source`, no `bash <(cat …)`); proved via shellcheck rule SC2294 absence
- [ ] Validator does NOT print full file contents on failure (stderr names the field/section, not the value) — prevents accidental secret leakage even though stories shouldn't carry secrets
- [ ] Validator does NOT follow symlinks during `--scan` — uses `find -P -maxdepth 1 ... ! -type l` to exclude symlinks by file TYPE before `open()` is called. **Correction (architect round 2 C4):** `find -P` alone is insufficient. `-P` controls how `find` itself traverses symlinks during the walk, but a symlink that matches the name glob is still returned, and any subsequent `open()` follows the symlink to its target. The `! -type l` predicate is what actually keeps the symlink out of the result set. This prevents directory traversal via a crafted `SHY-9999-malicious.md` symlink to `/etc/passwd`.
- [ ] Validator handles filenames containing shell-metacharacter-looking sequences (e.g. `SHY-0042-this&that.md`) safely — quotes all variable expansions; shellcheck SC2086 absence
- [ ] Validator runs as the invoking user's UID; no setuid bit; no privilege escalation; documented in CLAUDE.md

### UX

- [ ] Stderr messages fit within 80 chars per line (CI log readability)
- [ ] Every failure message names the offending file with its absolute path (or relative path if `--scan` was passed a relative dir)
- [ ] Every failure message names the specific check that failed (field name or section name)
- [ ] `--help` flag prints usage with: synopsis, arguments, flags (`--scan`, `--verbose`, `--help`), exit codes per category, and one example invocation
- [ ] On `--scan` success against a non-empty directory, stdout silent (UNIX convention) — only `--verbose` prints per-file `OK` lines
- [ ] On any failure, exit code is documented and reproducible

### i18n

- [ ] Story file content (frontmatter values, section headers, body text) tolerates Unicode — `SHY-0042-こんにちは-世界.md` filename and `owner: Sebastián Vidal` frontmatter value both pass
- [ ] Validator's own stderr is English (matches CI log convention; not localized)
- [ ] Locale-insensitive comparisons: validator works under `LC_ALL=C`, `LC_ALL=en_GB.UTF-8`, `LC_ALL=ja_JP.UTF-8` — fixture run under each in the test suite
- [ ] RTL story content (Arabic/Hebrew in body) doesn't break the validator (it operates on byte-level header prefix match, not rendered direction)

### Observability

- [ ] Exit codes are deterministic per category, documented in `--help` and in CLAUDE.md:
  - 0 = success
  - 2 = usage error (missing arg, unknown flag, `--scan` target is a file not a directory)
  - 10 = missing required frontmatter field
  - 11 = invalid frontmatter field value (regex / enum)
  - 12 = missing required `##` body section
  - 13 = BDD coverage gap
  - 14 = missing required `###` AC sub-heading
  - 20 = `--scan` mode found a failing file (inner category embedded in stderr)
- [ ] **Exit 20 is the sole `--scan` exit code regardless of inner failure category** — the inner category (10/11/12/13/14) is embedded in stderr only. Downstream tooling (e.g. SHY-0002's GitHub Action surfacing the failure as a PR comment) MUST parse stderr, not branch on exit codes beyond 20. (Architect round 2 I1.)
- [ ] Stderr is structured: `<absolute-path>: <category-name>: <details>` — machine-parseable
- [ ] Stdout is silent on success; populated on `--verbose` only
- [ ] `--verbose` flag prints each check as it runs to stderr, prefixed with `[check] `

## BDD Scenarios

These Gherkin-style scenarios are Markdown-native (bold `Scenario:` + bold `Given/When/Then` bullets). Each maps 1:1 to a fixture in `express-api/tests/scripts/fixtures/story-frontmatter/` and at least one `it()` test in the Red phase. Together they specify the validator's exact observable behavior — leaving nothing to assumption.

### Story-author scenarios

**Scenario: Validator accepts a well-formed story**

- **Given** a story file at `.project/stories/SHY-0042-example.md` with all 9 frontmatter fields valid and all 10 required `##` body sections (plus the `# <Title>` h1) present
- **When** I run `scripts/check-story-frontmatter.sh .project/stories/SHY-0042-example.md`
- **Then** the script exits with code 0
- **And** stdout is empty
- **And** stderr is empty

**Scenario: Validator rejects missing `id` field**

- **Given** a story file with frontmatter omitting the `id:` line
- **When** I run the validator against the file
- **Then** the script exits with code 10
- **And** stderr contains the substring `missing required frontmatter field: id`
- **And** stderr contains the absolute path of the offending file
- **And** stderr fits within 80 chars on each line

**Scenario: Validator rejects malformed `id` value**

- **Given** a story file with `id: SHY-1` (3-digit, not 4-digit)
- **When** I run the validator
- **Then** the script exits with code 11
- **And** stderr contains `id must match SHY-NNNN pattern`

**Scenario: Validator rejects unknown `status` enum**

- **Given** a story file with `status: pending`
- **When** I run the validator
- **Then** the script exits with code 11
- **And** stderr lists the 5 allowed values: `Draft, In Progress, In Review, Done, Cancelled`

**Scenario: Validator rejects unknown `priority`**

- **Given** a story file with `priority: P5`
- **When** I run the validator
- **Then** exit code is 11
- **And** stderr lists `P0, P1, P2, P3`

**Scenario: Validator rejects unknown `effort`**

- **Given** a story file with `effort: gigantic`
- **When** I run the validator
- **Then** exit code is 11
- **And** stderr lists `XS, S, M, L, XL`

**Scenario: Validator rejects unknown `type`**

- **Given** a story file with `type: maintenance`
- **When** I run the validator
- **Then** exit code is 11
- **And** stderr lists the 7 allowed values

**Scenario: Validator accepts populated `roadmap_ids` array**

- **Given** a story file with `roadmap_ids: [G005, G013, G029]`
- **When** I run the validator
- **Then** exit code is 0

**Scenario: Validator accepts empty `roadmap_ids` array**

- **Given** a story file with `roadmap_ids: []`
- **When** I run the validator
- **Then** exit code is 0

**Scenario: Validator rejects scalar `roadmap_ids`**

- **Given** a story file with `roadmap_ids: G001` (scalar form, not array)
- **When** I run the validator
- **Then** exit code is 11
- **And** stderr contains `roadmap_ids must be in array form`

**Scenario: Validator rejects missing required section**

- **Given** a story file with no `## Risks & Mitigations` heading anywhere in the body
- **When** I run the validator
- **Then** exit code is 12
- **And** stderr contains `missing required body section: ## Risks & Mitigations`

**Scenario: Validator tolerates section header with suffix**

- **Given** a story file using `## Test Plan (TDD)` as the section header (instead of bare `## Test Plan`)
- **When** I run the validator
- **Then** exit code is 0 — prefix match `^## Test Plan` accepts the suffixed variant

**Scenario: Validator rejects BDD coverage gap (AC has bullets, BDD has zero scenarios)**

- **Given** a story file with 12 AC checkboxes (`- [ ]` lines under `## Acceptance Criteria`) and ZERO `**Scenario:**` blocks under `## BDD Scenarios`
- **When** I run the validator
- **Then** exit code is 13
- **And** stderr contains `AC has 12 bullets but BDD has 0 scenarios — add at least one`
- **Note:** Presence-based rule per architect round-2 Important #6 — a single scenario can validly cover multiple AC bullets, so the validator only fails when AC has expectations to verify AND BDD has none.

**Scenario: Validator tolerates CRLF line endings**

- **Given** a story file saved with Windows-style `\r\n` line endings (well-formed otherwise)
- **When** I run the validator
- **Then** `\r` is stripped before matching
- **And** exit code is 0

**Scenario: Validator rejects an empty file**

- **Given** a 0-byte story file
- **When** I run the validator
- **Then** exit code is 10
- **And** stderr contains `no frontmatter found`

**Scenario: Validator tolerates UTF-8 content including emoji and CJK**

- **Given** a story file with `owner: 山田太郎`, a `## User Story` body containing `🚀 ship-ready`, and an Arabic phrase in `## Why`
- **When** I run the validator
- **Then** exit code is 0

**Scenario: `--help` prints usage including exit codes**

- **Given** the validator script is executable
- **When** I run `scripts/check-story-frontmatter.sh --help`
- **Then** exit code is 0
- **And** stdout contains the synopsis `check-story-frontmatter.sh [--scan <dir>] | <file>`
- **And** stdout lists exit codes 0, 2, 10, 11, 12, 13, 14, 20 with descriptions
- **And** stdout includes at least one example invocation

### Maintainer scenarios

**Scenario: `--scan` validates every story in a directory**

- **Given** `.project/stories/` contains 5 well-formed `SHY-NNNN-*.md` files plus `SHY-INDEX.md`
- **When** I run `scripts/check-story-frontmatter.sh --scan .project/stories`
- **Then** the glob `SHY-[0-9][0-9][0-9][0-9]-*.md` excludes `SHY-INDEX.md`
- **And** all 5 story files are validated in lexicographical order
- **And** exit code is 0
- **And** stdout is empty (silent on success)

**Scenario: `--scan` stops on the first failing file (no accumulation)**

- **Given** `.project/stories/` contains SHY-0001 (valid), SHY-0002 (missing `id`), SHY-0003 (also missing `id`)
- **When** I run `--scan`
- **Then** files process in lexicographical order
- **And** validation fails on SHY-0002
- **And** SHY-0003 is NOT processed (stop-on-first, not collect-all)
- **And** exit code is 20
- **And** stderr contains the full path of SHY-0002 plus `missing required frontmatter field: id`

**Scenario: `--scan` on an empty directory exits 0**

- **Given** `.project/stories/` exists but contains no `SHY-NNNN-*.md` files
- **When** I run `--scan`
- **Then** exit code is 0 (vacuously valid — zero failures across zero files)

**Scenario: `--scan` ignores hidden files and non-story files**

- **Given** the stories directory contains `SHY-0001-valid.md`, `.DS_Store`, `README.md`, and `SHY-INDEX.md`
- **When** I run `--scan`
- **Then** only `SHY-0001-valid.md` is validated
- **And** exit code is 0

**Scenario: `--verbose` prints each check to stderr**

- **Given** a well-formed story file
- **When** I run with `--verbose <file>`
- **Then** stderr contains `[check] frontmatter:id`, `[check] frontmatter:status`, …, `[check] section:## User Story`, …
- **And** stdout is empty
- **And** exit code is 0

### CI scenarios

**Scenario: lint.yml runs the validator as the LAST step**

- **Given** a PR introduces both a malformed story file AND an actionlint warning on a workflow YAML
- **When** CI's lint job runs
- **Then** `actionlint` runs first and reports the YAML warning
- **And** `shellcheck` runs next
- **And** the `Validate SHY story frontmatter` step runs LAST
- **And** the job log shows BOTH the YAML warning AND the story validation error
- **And** the lint job exits non-zero

**Scenario: lint.yml passes when no story files are touched**

- **Given** a PR changes only `.github/workflows/*.yml` and `express-api/src/*.js`
- **When** lint.yml runs
- **Then** the story validator scans `.project/stories/` and validates EXISTING stories
- **And** if all existing stories pass, the job exits 0
- **And** the PR is not required to add or modify any story file

### Adversarial / security scenarios

**Scenario: Validator does not execute frontmatter values**

- **Given** a story file with `owner: $(rm -rf /)` (a shell-injection attempt)
- **When** I run the validator
- **Then** the validator quotes all variable expansions and does NOT execute the value
- **And** validation proceeds normally (`owner` field present → check passes)
- **And** the filesystem is unchanged

**Scenario: Validator does not follow symlinks during `--scan`**

- **Given** the stories directory contains a symlink `SHY-9999-evil.md` pointing to `/etc/passwd`
- **When** I run `--scan`
- **Then** the validator excludes the symlink via `find -P -maxdepth 1 ... ! -type l`
- **And** does NOT call `open()` on the symlink (the `! -type l` filter rejects it BEFORE `open()` would follow it to the target)
- **And** exit code is 0 (the symlink is silently skipped, like any other non-matching file)

**Scenario: `--scan` against a cyclic-symlink directory is bounded**

- **Given** the stories directory contains `SHY-0042-cycle.md` which is a symlink to the same directory (creating a cyclic reference)
- **When** I run `--scan`
- **Then** `-maxdepth 1` prevents `find` from descending into the symlink
- **And** the `! -type l` filter rejects the symlink itself
- **And** the scan completes without recursion or hang
- **And** exit code is 0

**Scenario: `--scan` rejects a file path (not a directory)**

- **Given** the user invokes `scripts/check-story-frontmatter.sh --scan /path/to/SHY-0001-foo.md` (a file, not a directory)
- **When** the script runs
- **Then** exit code is 2 (usage error — `--scan` requires a directory argument)
- **And** stderr contains `--scan requires a directory argument; got a file path`

**Scenario: Validator is stateless under concurrent invocations**

- **Given** two CI jobs simultaneously invoke `scripts/check-story-frontmatter.sh --scan .project/stories` against the same directory at the same time
- **When** both scripts run
- **Then** neither writes a PID file or any shared-state file
- **And** any per-invocation temp files use `mktemp` so name collisions are impossible by construction
- **And** both produce the same exit code and the same stderr (deterministic)
- **And** there is no race condition (no shared mutable state to race on)

**Scenario: Validator handles a very-long frontmatter line without truncation or hang**

- **Given** a story file whose `owner:` value is 10,000 characters of `aaaa…aaaa`
- **When** I run the validator
- **Then** the field-presence check passes (owner is present)
- **And** stderr (if any) still fits within 80 chars per line (no fragments of the long value leak)
- **And** the script completes in <500ms (no quadratic-time regex catastrophe)

**Scenario: Validator handles filenames with shell metacharacters safely**

- **Given** a story file named `SHY-0042-foo&bar.md` (legal POSIX, contains `&`)
- **When** I run the validator
- **Then** the script quotes the filename in all variable expansions
- **And** validation succeeds without spawning background jobs

## Test Plan (TDD)

### Red — write failing tests FIRST

Create `express-api/tests/scripts/check-story-frontmatter.test.js` with one `it()` per BDD scenario above plus the additional implementation tests below. Initial run fails because `scripts/check-story-frontmatter.sh` doesn't exist yet.

**Frontmatter field presence (9 fields × 1 test each = 9 tests):**

- `it('exits 10 when frontmatter missing id')`
- `it('exits 10 when frontmatter missing status')`
- `it('exits 10 when frontmatter missing owner')`
- `it('exits 10 when frontmatter missing created')`
- `it('exits 10 when frontmatter missing priority')`
- `it('exits 10 when frontmatter missing effort')`
- `it('exits 10 when frontmatter missing type')`
- `it('exits 10 when frontmatter missing roadmap_ids')`
- `it('does NOT require pr field (advisory only)')`

**Frontmatter field value validation (6 tests):**

- `it('exits 11 when id does not match SHY-NNNN pattern')`
- `it('exits 11 when status is not in the 5-value enum')`
- `it('exits 11 when priority is not in {P0,P1,P2,P3}')`
- `it('exits 11 when effort is not in {XS,S,M,L,XL}')`
- `it('exits 11 when type is not in the 7-value enum')`
- `it('exits 11 when roadmap_ids is in scalar form')`

**Frontmatter happy variants (3 tests):**

- `it('exits 0 with empty roadmap_ids ([])')`
- `it('exits 0 with single-item roadmap_ids ([G001])')`
- `it('exits 0 with multi-item roadmap_ids ([G001, G024, G053])')`

**Body section presence (10 `##` missing-section tests — the h1 `# Title` is not a `## ` section and is not validator-enforced as a presence check):**

- `it('exits 12 when body missing ## User Story')`
- `it('exits 12 when body missing ## Why')`
- `it('exits 12 when body missing ## Acceptance Criteria')`
- `it('exits 12 when body missing ## BDD Scenarios')`
- `it('exits 12 when body missing ## Test Plan')`
- `it('exits 12 when body missing ## Out of Scope')`
- `it('exits 12 when body missing ## Dependencies')`
- `it('exits 12 when body missing ## Risks & Mitigations')`
- `it('exits 12 when body missing ## Definition of Done')`
- `it('exits 12 when body missing ## Notes')`

**AC sub-heading presence (8 missing-dimension tests — exit 14):**

- `it('exits 14 when AC missing ### Happy path')`
- `it('exits 14 when AC missing ### Error paths')`
- `it('exits 14 when AC missing ### Edge cases')`
- `it('exits 14 when AC missing ### Performance')`
- `it('exits 14 when AC missing ### Security')`
- `it('exits 14 when AC missing ### UX')`
- `it('exits 14 when AC missing ### i18n')`
- `it('exits 14 when AC missing ### Observability')`
- `it('exits 0 when an AC sub-heading body is "N/A — <rationale>" on a single line (validator does not parse rationale; architect/reviewer gate)')`

**Section prefix-match tolerance (2 tests):**

- `it('exits 0 with ## Test Plan (TDD) header (prefix match)')`
- `it('exits 0 with ## Notes (running log) header (prefix match)')`

**BDD coverage (6 tests — sectional counting):**

- `it('exits 13 when AC has bullets but BDD has zero scenarios')` (presence-based rule)
- `it('exits 0 when scenarios < AC bullets — architect Important #6: 1 scenario can cover many AC bullets')`
- `it('exits 0 when scenario count equals AC checkbox count')`
- `it('exits 0 when scenario count exceeds AC checkbox count')`
- `it('does NOT count `- [ ]` checkboxes in DoD section toward AC count')`
- `it('does NOT count `\*\*Scenario:` strings inside body prose as scenarios')`

**Edge cases (8 tests):**

- `it('exits 10 against a 0-byte file')`
- `it('exits 0 against a story file with CRLF line endings')`
- `it('exits 0 against a story file with UTF-8 BOM at start')`
- `it('exits 0 with trailing whitespace on every line')`
- `it('exits 0 with emoji + CJK + RTL content in body')`
- `it('exits 0 when filename contains shell metacharacters (foo&bar)')`
- `it('exits 0 under LC_ALL=C')`
- `it('exits 0 under LC_ALL=ja_JP.UTF-8')`

**`--scan` mode (8 tests):**

- `it('--scan exits 0 against an empty directory')`
- `it('--scan exits 0 against a directory with only SHY-INDEX.md')`
- `it('--scan exits 0 against a directory of 5 valid stories')`
- `it('--scan exits 20 on the first failing file (lexicographical order)')`
- `it('--scan does NOT process files after the first failure')`
- `it('--scan ignores hidden files (.DS_Store) and non-SHY .md files (README.md)')`
- `it('--scan exits 2 when the argument is a file, not a directory')`
- `it('--scan completes safely against a cyclic-symlink directory (does not recurse; does not hang)')`

**Security (5 tests):**

- `it('does not execute frontmatter values (shell injection sample)')`
- `it('does not follow symlinks during --scan (excludes via ! -type l)')`
- `it('quotes all variable expansions safely')`
- `it('concurrent invocations against the same directory produce identical exit codes and stderr (stateless)')`
- `it('handles a 10,000-char frontmatter value without truncation or hang (completes in <500ms)')`

**UX / observability (5 tests):**

- `it('--help exits 0 and lists all 8 exit codes (0/2/10/11/12/13/14/20)')`
- `it('stderr lines fit within 80 chars on every failure')`
- `it('stderr always includes the absolute file path')`
- `it('stdout is silent on success without --verbose')`
- `it('--verbose prints [check] lines to stderr')`

**Performance (2 tests):**

- `it('single-file validation completes in under 500ms')` (CI ubuntu)
- `it('--scan over 20-file fixture directory completes in under 5s')` (target holds on both CI ubuntu and macOS dev — see Performance AC for the rationale on why 100 files is a follow-up optimisation pass)

**Fixtures** live at `express-api/tests/scripts/fixtures/story-frontmatter/` — one minimal valid story + one mutation per failure mode (~40 fixtures total). The `--scan` directory tests use 4 small directory fixtures (`empty/`, `only-index/`, `all-valid/`, `one-bad/`).

### Green — implement until red flips

1. **Create `scripts/check-story-frontmatter.sh`** — bash 3.2-compatible (no `declare -A`, no `${var^^}`; `[[ ... ]]` is fine), shellcheck-clean, `set -euo pipefail`, leading shebang `#!/usr/bin/env bash`. Structure:
   - `usage()` function for `--help` (prints all 8 exit codes + an example invocation)
   - `validate_file()` function: reads file, strips `\r` and UTF-8 BOM, parses frontmatter between first `---/---` pair, runs presence + value checks (using `grep -qE … || FAILED=1` pattern under `set -e`), runs body-section prefix-match checks via `grep -qE '^## <Section>'`, runs AC sub-heading presence check (8 `### ` headings within `## Acceptance Criteria` range), runs BDD-coverage count check (sectional algorithm — see next bullet)
   - **BDD-coverage counting algorithm (sectional, NOT whole-file)** — per architect round 2 C3: do NOT use whole-file `grep -c '^- \[ \]'` because that would count checkboxes in DoD, Out-of-Scope, etc. Use `awk` range patterns to bound counts to their section:
     ```bash
     ac_count=$(awk '/^## Acceptance Criteria/{f=1;next} /^## [^#]/{f=0} f && /^- \[ \]/{c++} END{print c+0}' "$FILE")
     bdd_count=$(awk '/^## BDD Scenarios/{f=1;next} /^## [^#]/{f=0} f && /^\*\*Scenario:/{c++} END{print c+0}' "$FILE")
     if [ "$ac_count" -gt 0 ] && [ "$bdd_count" -eq 0 ]; then
       fail "$abs" "bdd gap" "AC has ${ac_count} bullets but BDD has 0 scenarios — add at least one" 13
     fi
     ```
   - `validate_dir()` function for `--scan`: globs `SHY-[0-9][0-9][0-9][0-9]-*.md` via `find -P "$DIR" -maxdepth 1 -type f ! -type l -name 'SHY-[0-9][0-9][0-9][0-9]-*.md' | sort` (the `! -type l` excludes symlinks by file type per architect round 2 C4 — `find -P` alone does not), iterates in lexicographical sort order, calls `validate_file` per entry, stops on FIRST failure
   - First validates that the `--scan` argument is a directory (`[ -d "$DIR" ]`); if it's a file, exit 2 with usage error
   - Distinct exit codes per category (0/2/10/11/12/13/14/20)
   - Structured stderr: `<absolute-path>: <category-name>: <details>` (one line per failure)
   - All variable expansions quoted; no `eval`; no `source`
   - `--verbose` flag prints `[check] <name>` for each check to stderr
2. **Wire into `.github/workflows/lint.yml`** — append as the LAST step in the lint job:
   ```yaml
   - name: Validate SHY story frontmatter
     run: scripts/check-story-frontmatter.sh --scan .project/stories
   ```
3. **Add `## Agile Way of Working` section to `CLAUDE.md`** placed between `## Tri-Platform Policy` and `## Build & Test Commands`. The section documents (concise prose, with examples): the 9 frontmatter fields, the 10 required `##` body sections (plus the `# <Title>` h1 — not validator-enforced), the 8 AC dimensions, the BDD format, the status lifecycle + per-`type` Done bar, the strict naming convention (branch / commit / PR), the cross-labelling rule, the OOB exemption. Links to `.project/stories/SHY-INDEX.md` and `scripts/check-story-frontmatter.sh`.
4. Run the Jest suite — every red test above flips green.
5. Run `shellcheck scripts/check-story-frontmatter.sh` and `actionlint .github/workflows/lint.yml` — both exit 0 with no warnings.

## Out of Scope

- Converting existing roadmap items (G001–G053 open subset) to SHYs — that is SHY-0003's job (after SHY-0002's GitHub integration ships, so converted stories can auto-create issues)
- GitHub Issues + Projects v2 integration — that is SHY-0002
- Implementing the gh-pages-deploy serialization (the session's original goal) — slotted as G054 + its own SHY in SHY-0003
- A pre-commit hook for frontmatter validation (CI gate is sufficient for now; could be added in a follow-up SHY if local-first feedback becomes a friction point)
- Auto-allocation of SHY IDs (manual sequential allocation; collisions caught by reviewer)
- A `make new-story` helper or template generator (copy SHY-0001 as the seed; tooling can come later)
- Story-template versioning / grandfathering (the template won't change again until a deliberate SHY proposes the change)
- Per-type validator branches (same strict template for every `type`; trivially-empty AC dimensions allowed with `N/A` rationale)
- Architect-verdict / reviewer-cycle frontmatter fields (kept in Notes log only — operator-confirmed)
- Sprint / iteration concept (continuous flow; no time-boxed sprints)

## Dependencies

- **Blocks:** SHY-0002 (GitHub Issues + Projects integration requires the template + validator) and every SHY-XXXX after that.
- **Blocked by:** none.
- **Tool-version assumptions (no upgrade required):** Jest version as declared in `express-api/package.json` (existing test pattern at `express-api/tests/scripts/reusable-workflow-concurrency.test.js` already uses modern Jest features). Bash 3.2+ (macOS default; CI ubuntu has bash 5.x — strict superset). `shellcheck` and `actionlint` versions as currently invoked from `lint.yml`. `find` with `-P` flag (BSD + GNU both support it). POSIX `wc`, `grep`, `tr`, `sed` — all standard.

## Risks & Mitigations

- **Risk:** Frontmatter regex too strict — blocks legitimate edge-case story files. **Mitigation:** Test fixtures cover empty array, single-item, and multi-item `roadmap_ids`; enum on `status` / `priority` / `effort` / `type` is explicit; `id` regex is anchored.
- **Risk:** `lint.yml` gate breaks CI for in-flight PRs that don't touch stories. **Mitigation:** The validator only runs on `.project/stories/SHY-*.md`. Non-story PRs are unaffected. The step takes <5s for a directory of <100 stories.
- **Risk:** `lint.yml` step ordering — if the story validator runs BEFORE `actionlint` / `shellcheck`, a story failure would short-circuit CI before earlier lint steps report. **Mitigation:** Pin validator step as the LAST step in the lint job (AC + Test Plan + this Risk). Reviewer agent flags any reordering in the YAML diff.
- **Risk:** Bash version incompatibility — macOS ships bash 3.2 (Apple), CI runs bash 5.x. **Mitigation:** Use bash 3.2-compatible syntax only (no `declare -A` associative arrays, no `${var^^}` / `${var,,}` case ops). `[[ ... ]]` is fine — bash 3.2 supports it. Shellcheck verifies portability via `# shellcheck shell=bash` directive.
- **Risk:** `set -euo pipefail` + bare `grep` for absence — `grep` returning non-zero on no-match would early-exit the script before recording the failure. **Mitigation:** Every absence check uses the `grep -qE '<pattern>' "$FILE" || FAILED_FIELDS+=("<field>")` pattern; the `|| ...` consumes the non-zero exit so `set -e` doesn't fire. Test pattern documented in Green step 1.
- **Risk:** BDD coverage check via raw line-counting (`grep -c '^- \[ \]'` vs `grep -c '^\*\*Scenario:'`) — false positives from comment-like lines starting with `- [ ]` in non-AC sections (e.g. DoD), or `**Scenario:` referenced in body text. **Mitigation:** Use sectional `awk` range pattern documented in Test Plan Green step 1; count AC checkboxes ONLY between `## Acceptance Criteria` and the next `## ` header; count Scenario blocks ONLY between `## BDD Scenarios` and the next `## ` header. Test fixtures cover the "checkbox in DoD is not counted as AC" case. **Risk applied (architect round 2 C3).**
- **Risk:** Concurrent invocations might race on shared state. **Mitigation:** Validator writes no PID file and no shared-state file; any per-invocation temp files use `mktemp` (XXXXXX suffix randomised) so name collisions are impossible by construction. Concurrent runs against the same directory are safe — no race conditions; both runs produce identical output. Documented in the concurrent-invocations BDD scenario.
- **Risk:** Naming convention (branch / commit / PR title) is enforceable only after a developer has done the action — a wrong branch name is found at PR-creation time. **Mitigation:** Currently caught by reviewer + DoD checklist. A future SHY can add a pre-push hook (out of scope for SHY-0001; tracked as a possible follow-up). The architect round 2 I2 finding accepted this deferral.
- **Risk:** A future story author silences a real failure by editing the validator. **Mitigation:** The validator's own Jest test suite has fixtures for every required field, section, and edge case; removing one fails the validator's tests, which run in `lint.yml` BEFORE the story-frontmatter validator step is invoked.
- **Risk:** Story file rename after merge (`git mv` for a slug refresh). **Mitigation:** Validator operates on file CONTENT, not filename (except via the `SHY-[0-9][0-9][0-9][0-9]-*.md` glob in `--scan`). Renaming the slug part is safe as long as the `SHY-NNNN-` prefix matches. Documented in CLAUDE.md.
- **Risk:** CRLF line endings on a story file edited from Windows or certain editors silently break section-header `grep`. **Mitigation:** Validator strips `\r` from every line before matching. Fixture `crlf-line-endings.md` confirms.
- **Risk:** UTF-8 BOM at file start breaks frontmatter `^---$` match. **Mitigation:** Strip the leading `\xEF\xBB\xBF` if present. Fixture `bom-prefix.md` confirms.
- **Risk:** AC dimension labelled `N/A` becomes a loophole for skipping real coverage. **Mitigation:** Architect agent rejects unjustified `N/A`; reviewer agent flags any dimension with an unexplained `N/A`; CLAUDE.md states `N/A` requires a one-line rationale.
- **Risk:** BDD coverage 1:1 mapping forces over-decomposition (every nit AC becomes a Gherkin scenario). **Mitigation:** AC bullets should be coarse enough to map to MEANINGFUL scenarios; one scenario CAN cover multiple closely-related AC bullets if Then-clauses bind them together (rule: 1 AC requires ≥1 scenario, NOT exactly 1).
- **Risk:** Symlink-following enables directory traversal during `--scan`. **Mitigation:** Use `find -P` (the default; `-L` would follow symlinks); add explicit test fixture and unit test.
- **Risk:** Adding a new top-level CLAUDE.md section disrupts an existing pattern. **Mitigation:** Inserted between `## Tri-Platform Policy` and `## Build & Test Commands`; both adjacent sections are unchanged. Reviewer flags if placement is wrong.
- **Risk:** `.gitignore` change to un-ignore `.project/stories/` accidentally exposes other internal docs (plans/specs/test-plans/test-reports — totalling ~43MB locally). **Mitigation:** Use per-subdir exclude lines for each non-stories internal-doc directory (`.project/plans/`, `.project/specs/`, `.project/test-plans/`, `.project/test-reports/`, `.project/audit-findings-*.md`, `.project/ios-build-warnings-debt.md`). A blanket `.project/` + `!.project/stories/` negation does NOT work (Git refuses to re-include under a fully-excluded parent). The per-subdir approach is verified via `git check-ignore` probes in the Jest suite — see the `gitignore` describe block in `check-story-frontmatter.test.js`.

## Definition of Done

- [ ] All Acceptance Criteria boxes across the 8 dimensions are checked
- [ ] `cd express-api && npm test -- check-story-frontmatter` green locally (every red `it()` from above flips green)
- [ ] `actionlint .github/workflows/lint.yml` exits 0 (no warnings)
- [ ] `shellcheck scripts/check-story-frontmatter.sh` exits 0 (no warnings)
- [ ] `scripts/check-story-frontmatter.sh .project/stories/SHY-0001-establish-agile-workflow.md` exits 0
- [ ] `scripts/check-story-frontmatter.sh --scan .project/stories` exits 0
- [ ] `scripts/check-story-frontmatter.sh --help` exits 0 and prints all 8 exit codes (0/2/10/11/12/13/14/20)
- [ ] Branch is `story/SHY-0001-establish-agile-workflow`
- [ ] All commits' subjects start with `[SHY-0001]`
- [ ] PR title is `SHY-0001: Establish Agile user-story way of working`
- [ ] PR body opens with `Implements SHY-0001 — see .project/stories/SHY-0001-establish-agile-workflow.md for full spec, AC, BDD scenarios, and DoD.` (GitHub Issue auto-close annotation is omitted for SHY-0001 because SHY-0002 hasn't shipped yet — the operator may manually create the issue)
- [ ] Architect agent dispatched against the EXPANDED story; concerns addressed (or operator-acknowledged as Out of Scope)
- [ ] Code-reviewer agent reports ZERO findings (incl. Trivial) per [[feedback-100-percent-clean-reviews]]
- [ ] Pre-self-review pass before reviewer agent per [[feedback-pre-self-review-before-agent]]
- [ ] PR pushed; auto-merge armed in the same tool-call batch per [[feedback-arm-monitor-at-push-not-after]]
- [ ] ScheduleWakeup armed on CI completion per [[feedback-scheduled-wakeups-over-monitors]] with cache-aware interval per [[feedback-cache-aware-wakeups]]
- [ ] PR merged via auto-merge (no rollback, no force-push per [[feedback-no-force-push-without-explicit-auth]])
- [ ] **Per-type Done gate:** `type: infra` → Done = auto-merge fires. No dev verify required (no app code touched).
- [ ] `status: Done` set in this frontmatter; `pr:` populated with merged PR URL
- [ ] PR URL + merge timestamp + reviewer cycle count appended to `## Notes (running log)` below
- [ ] `SHY-INDEX.md` updated: SHY-0001 row moved from Active to Done table; SHY-0002 (planned) row updated to indicate it's next-up

## Notes (running log)

- 2026-06-06 10:25 BST — Draft v1 created. Operator confirmed in conversation: 4-digit ID, rich template, in-place lifecycle, draft→operator→architect flow, 1 PR-bundle = 1 SHY, skip retro stories for shipped roadmap items, gh-pages becomes G054 + a SHY. Memory `feedback-agile-user-stories.md` saved to `~/.claude/projects/-Users-shyden/memory/` and indexed in `MEMORY.md`.
- 2026-06-06 10:35 BST — Operator approved scope. Dispatched `feature-dev:code-architect`.
- 2026-06-06 10:47 BST — Architect returned **APPROVE-WITH-CHANGES** (round 1): 4 Critical + 7 Important + 6 Polish. Applied all findings (zero deferred): `pr:` advisory-only annotation; section-header prefix-match; `--scan` pinned to stop-on-first; `roadmap_ids` scalar rejection AC; CRLF tolerance; BDD-coverage `--scan` exclusion; lint.yml LAST-step pin; `set -e` + grep-absence pattern documented; SHY-INDEX.md human-maintained note; Jest/bash version deps; "seven" → "eight" sub-headings.
- 2026-06-06 ~11:00 BST — Operator added 6 directives: (1) BDD scenarios for every user journey backed by AC; (2) AC must be extremely deep, QA + UX, zero assumptions; (3) GitHub Issues + Projects v2 board (delivered as SHY-0002); (4) Strict naming convention (branch/commit/PR carry `SHY-NNNN`); (5) 8-dimension AC checklist mandatory; (6) `priority` + `effort` + `type` frontmatter fields; per-type Done bar; scope creep → new SHY; same strict template for all types.
- 2026-06-06 11:20 BST — Story rewritten as v2 to incorporate all 6 directives. Frontmatter expanded from 6 to 9 fields. Body sections expanded from 9 to 11 (added `## BDD Scenarios`). AC restructured into 8 dimensions with ~70 checkboxes. ~45 BDD scenarios drafted across 4 user-journey categories. Test plan expanded to ~55 Jest cases. SHY-INDEX.md columns updated (Pri / Effort / Type added). Memory `feedback-agile-user-stories.md` rewritten to capture the full spec.
- 2026-06-06 11:20 BST — Ready for architect validation round 2 (the structure has materially changed since round 1 — second pass is warranted before TDD).
- 2026-06-06 12:00 BST — Operator approved v2 scope. Dispatched architect round 2.
- 2026-06-06 12:10 BST — Architect round 2 returned **APPROVE-WITH-CHANGES**: 4 new Critical + 3 Important + 4 adversarial gaps. All findings applied:
  - **C1 (section-count mismatch):** Error-paths AC now says "10 required `##` body sections" with explicit h1-not-a-section note; Test Plan Body Section row aligned.
  - **C2 (AC sub-heading enforcement):** Validator now enforces the 8 `###` AC sub-headings with new exit code 14. Added AC bullet + 8 new Jest tests + 1 N/A-rationale test.
  - **C3 (BDD counting algorithm):** Green step 1 now includes the explicit `awk` sectional range pattern; Risks note about whole-file `grep -c` updated; 2 new BDD-coverage tests confirm DoD checkboxes are NOT counted.
  - **C4 (`find -P` symlink misclaim):** Security AC corrected to `find -P -maxdepth 1 ... ! -type l`; corresponding BDD scenario updated with the technical correction (architect was right that `-P` alone is insufficient).
  - **I1 (exit 20 conflation):** Observability AC now explicitly states exit 20 is the sole `--scan` exit code; downstream tooling parses stderr.
  - **I2 (naming pre-PR check):** Risks note added that pre-push hook is deferred to a follow-up SHY.
  - **I3 (count documentation trap):** Test Plan Body Section row clarified.
  - **Adversarial gaps added as BDD scenarios:** cyclic-symlink directory; `--scan` against a file path; concurrent invocations; very-long frontmatter line. Each scenario also has its own Jest test.
  - **Exit code 14** added to Observability AC + `--help` AC + tests; total exit codes: 8 (0/2/10/11/12/13/14/20).
- 2026-06-06 12:10 BST — v3 ready for TDD red phase. Test count: ~70 cases; BDD scenarios: ~50; fixtures: ~45. Architect verdict captured here per Notes-log-only audit rule.
- 2026-06-06 13:31 BST — TDD red phase complete (103 cases failing). Validator script implemented; TDD green achieved (115 cases). CLAUDE.md § "Agile Way of Working" added. lint.yml `Validate SHY story frontmatter` step pinned LAST.
- 2026-06-06 13:50 BST — Code-reviewer cycle 1: 11 findings (1 Critical + 4 Important + 6 Trivial). All fixed.
- 2026-06-06 13:55 BST — Code-reviewer cycle 2: 7 findings + 2 cycle-1 partials. All fixed.
- 2026-06-06 14:00 BST — Code-reviewer cycle 3: 7 findings. All fixed.
- 2026-06-06 14:05 BST — Code-reviewer cycle 4: 4 findings. All fixed.
- 2026-06-06 14:10 BST — Code-reviewer cycle 5: 1 finding. Fixed.
- 2026-06-06 14:30 BST — Code-reviewer cycle 6: 2 findings (operator: "not careful enough" — missed 5 sibling exit-11 tests on cycle 5). All fixed. PR #1034 pushed, auto-merge armed. Final test count 143 (was ~70 planned).
- 2026-06-06 14:55 BST — PR #1034 SonarCloud failed first time on prettier-format of valid.md fixture (not covered by my local check). Auto-fixed; 3 test regexes adjusted for the new blank-line-between-scenario-header-and-bullets format. Re-pushed.
- 2026-06-06 15:56 BST — PR #1034 MERGED via auto-merge. Status flipped Draft → In Review → Done. SHY-0001 LIVE in main; the workflow now self-enforces on every future PR via lint.yml. Reviewer cycle count for the audit: 6.
- 2026-06-06 12:15 BST — **Implementation paused per operator directive: repo migration to company GitHub org first; no execution until then.** Drafting SHY-0002 + SHY-0003 in parallel as planning work.
- 2026-06-06 12:50 BST — Discovered `.project/` is gitignored at `.gitignore:109` ("Internal project docs (plans, specs)"). Added new Happy-path AC + Risk: SHY-0001 must include a `!.project/stories/` negation immediately after the `.project/` line so story files become git-tracked while keeping sibling internal-doc directories (plans/specs/test-plans/test-reports — ~43MB local) ignored as the operator originally designed. Added a probe test that asserts a sibling fixture remains ignored.
