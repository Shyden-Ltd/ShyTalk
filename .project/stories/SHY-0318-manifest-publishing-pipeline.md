---
id: SHY-0318
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0318: Manifests live in git, so every change has a diff, an author, and an undo

## User Story

As the **operator**, I want the manifest to be a file in the repository that CI
validates and deploys, so that every change to the app's appearance has a
reviewable diff, a named author, and a one-command undo.

## Why

The manifest is about to become the most powerful artefact in the product: it can
change what every user sees, in minutes, with no store review. An artefact with
that much reach needs the same discipline as code, and git already provides all
of it — history, diffs, authorship, review, atomic revert — for free.

The alternative, a manifest living only in a database edited through an admin
panel, would require rebuilding every one of those properties from scratch, and
the rebuilt versions would be worse. "Who changed the home screen last Tuesday
and why" is a question git answers without being asked.

So `manifests/base.json` is the **source of truth**, and this story establishes
that: the file, its JSON Schema, the validation script, and the CI wiring. The
admin UI (SHY-0319) is then a *client of this pipeline*, not a bypass of it —
which is what makes "both from the start" affordable rather than doubling the
work.

The validation script is deliberately shared by three callers — CI, the admin UI,
and the endpoint's publish path — because three independent implementations of
"is this manifest valid" would disagree, and the one that disagrees in the
permissive direction is the one that ships the bad document.

## Acceptance Criteria

### Happy path

- [ ] `manifests/base.json` is committed and is the document the endpoint serves.
- [ ] `manifests/schema.json` describes it and is consumed by validation on both server and client.
- [ ] `scripts/validate-manifests.sh` exits `0` on the committed manifests.
- [ ] A merge to develop deploys the updated manifest to dev with no further action.

### Error paths

- [ ] `scripts/validate-manifests.sh` exits non-zero on a schema violation, naming the path within the document.
- [ ] It exits non-zero on a label key missing from any of the 20 locales (SHY-0316 rule).
- [ ] It exits non-zero on an icon name absent from the registry (SHY-0314 rule).
- [ ] It exits non-zero on a route absent from the nav graph.
- [ ] It exits non-zero on any sealed-screen reference (SHY-0311 rule).
- [ ] It exits non-zero on a `rollout.percent` outside 0–100 (SHY-0317 rule).
- [ ] An invalid manifest cannot merge — the check is a required part of `lint.yml`.

### Edge cases

- [ ] The script is dependency-free where it can be, following the precedent of `scripts/check-podfile-lock-sync.sh`, so it cannot fail because an install was skipped.
- [ ] A manifest file with a byte-order mark or CRLF line endings validates identically to a clean one.
- [ ] Multiple manifest files validate independently; one bad file names itself rather than failing anonymously.
- [ ] The script's exit code survives being piped — no `| head` swallowing a failure, per this repo's pipe-exit-code rule.

### Performance

- [ ] Full validation completes in under 10 s so it does not slow `lint.yml` or the pre-push hook noticeably.

### Security

- [ ] Validation runs BEFORE deploy, never after — an invalid document must never be reachable, even briefly.
- [ ] The three callers (CI, admin UI, endpoint) share one implementation, asserted by a test that imports the same module the script does.
- [ ] The script fails closed: an unreadable manifest, a missing schema, or an unexpected internal error exits non-zero rather than passing.

### UX

- [ ] N/A — no end-user surface. The operator-facing experience is the failure message, which the Observability criteria below specify.

### i18n

- [ ] N/A — no user-facing strings. The story's i18n contribution is the locale-completeness check it enforces on behalf of SHY-0316.

### Observability

- [ ] Every validation failure names the file, the JSON path, and the rule violated — enough to fix without reading the script.
- [ ] All failures in a run are reported together, not just the first, so a fix is one pass.
- [ ] The deploy logs the `manifestVersion` it published.

## BDD Scenarios

**Scenario: A valid change publishes and reaches the app**

- **Given** the operator commits a valid change to the manifest
- **When** the change is merged
- **Then** the app receives the updated settings without anyone deploying by hand

**Scenario: An invalid change cannot be merged**

- **Given** the operator commits a manifest that breaks a rule
- **When** the checks run
- **Then** the change is refused
- **And** the message names the rule that was broken

**Scenario: Every problem is reported at once**

- **Given** a manifest with three separate problems
- **When** the checks run
- **Then** all three problems are named in the result

**Scenario: A previous version can be restored**

- **Given** a published manifest that turns out to be wrong
- **When** the operator reverts that change
- **Then** the app returns to the previous settings

## Test Plan

**RED first** — each validation rule gets a committed failing fixture before the
rule exists to catch it.

### Node / Jest (`express-api/tests/scripts/validate-manifests.test.js`)

- `exits 0 on the committed manifests`
- `exits non-zero on a schema violation, naming the json path`
- `exits non-zero on a label key missing from one locale`
- `exits non-zero on an unknown icon name`
- `exits non-zero on a route absent from the nav graph`
- `exits non-zero on a sealed-screen reference`
- `exits non-zero on a rollout percent of 101`
- `reports all failures in one run, not only the first`
- `exits non-zero on an unreadable manifest file`
- `exits non-zero when the schema file is missing`
- `names the offending file when several are validated`
- `validates a file with a BOM identically to a clean one`
- `completes in under 10 seconds`
- `shares one implementation with the endpoint's publish path`

### Fixtures (committed, real files)

One per rule, in `manifests/__fixtures__/`. Real files run through the real
script, because the script's job is to inspect committed files.

### CI structure test (`express-api/tests/scripts/lint-workflow.test.js`)

- `lint.yml invokes validate-manifests.sh`
- `pre-push invokes validate-manifests.sh`

Pins the wiring, so removing the check from CI fails a test rather than silently
disabling the gate.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| validation moved to after deploy | `exits 0 on the committed manifests` is unaffected — instead `lint.yml invokes validate-manifests.sh` and the ordering assertion catch it |
| only the first failure reported | `reports all failures in one run, not only the first` |
| unreadable file treated as valid | `exits non-zero on an unreadable manifest file` |
| endpoint given its own copy of the validator | `shares one implementation with the endpoint's publish path` |
| check removed from `lint.yml` | `lint.yml invokes validate-manifests.sh` |

### CI-config boundary

This story touches `.github/workflows/lint.yml` and scripts, but it also
introduces `manifests/base.json` which the **backend serves** — so it is NOT
CI-config-only and runs the full protocol.

## Out of Scope

- The admin UI — SHY-0319 consumes this pipeline.
- The endpoint — SHY-0312.
- Automatic rollback on a signal — noted as out of scope in SHY-0317 too.

## Dependencies

- **SHY-0310** — the schema being validated.
- **SHY-0311**, **SHY-0314**, **SHY-0316**, **SHY-0317** — each contributes one
  validation rule. Where a rule's owning story has not yet merged, this story
  lands the rule and the owning story asserts it end-to-end.
- **SHY-0312** — shares the validator implementation.
- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Three implementations of "valid" disagree, and the permissive one ships the bad document | One shared module, asserted by a test; giving the endpoint its own copy is in the mutation table. |
| The check is quietly removed from CI later | A structure test pins the wiring in both `lint.yml` and `pre-push`. |
| A piped invocation swallows a non-zero exit | Explicit AC and this repo's known pipe-exit-code trap; the script is invoked without a pipe in CI. |
| Validation passes on a file it could not actually read | Fail-closed AC plus a test for the unreadable case. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] One committed failing fixture exists per validation rule and each is proven to fail.
- [ ] `scripts/validate-manifests.sh` runs in `lint.yml` AND `.husky/pre-push`, pinned by a structure test.
- [ ] Full protocol gauntlet green (the manifest is served by the backend), then DEV green.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`; `actionlint` clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §7. Git as source of truth gives history, diffs, authorship, review and atomic revert for free; a database-only manifest would need all five rebuilt, worse.
- **2026-08-17** — One shared validator across CI, admin UI and endpoint is a security property, not a DRY preference: three implementations would disagree, and the permissive one is the one that ships the bad document.
- **2026-08-17** — Dependency-free script where possible, following `scripts/check-podfile-lock-sync.sh`. A guard that fails because an install was skipped is a guard that was skipped.
