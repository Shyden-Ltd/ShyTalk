---
id: SHY-0065
status: In Review
owner: claude
created: 2026-06-09
priority: P1
effort: XS
type: refactor
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1048
---

# SHY-0065: Apply single-jq inline-additions pattern to `release.yml` (preventive — mirror SHY-0064's sync fix)

## User Story

As **the operator triggering the next `release.yml vX.Y.Z` run**, I want **`release.yml`'s `Create signed commit on main via GraphQL` step to use the same single-`jq` inline-additions pattern that SHY-0064 introduced for `sync-roadmap-data.yml`** so that **future growth of the release payload (additional play-store assets, longer release notes, build.gradle.kts expansion) cannot silently trip the same Linux `execve()` ARG_MAX limit that SHY-0064 just hit at ~237KB on the sync workflow — pre-emptively, before the next release cut goes red.**

## Why

SHY-0064 just demonstrated that the two-`jq` pattern (`ADDITIONS=$(jq -n …) ; PAYLOAD=$(jq -n … --argjson additions "$ADDITIONS" …)`) fails the moment `$ADDITIONS` exceeds the kernel's ARG_MAX (typically ~1.5MB effective on GitHub-hosted Ubuntu runners with the standard env-var load). The sync workflow's `public/roadmap-data.json` grew to 177KB → ~237KB base64 and the second `jq` call died with `Argument list too long`.

`release.yml`'s `Create signed commit on main via GraphQL` step (lines 365-415) uses the **identical** two-`jq` pattern, just with 3 files instead of 1:

```yaml
ADDITIONS=$(jq -n --rawfile c1 app/build.gradle.kts --rawfile c2 internal.txt --rawfile c3 default.txt '[…]')
PAYLOAD=$(jq -n --arg repo … --argjson additions "$ADDITIONS" '{…}')
```

Today's combined payload is ~17.7KB → ~24KB base64 (build.gradle.kts dominates; the two release-notes txt files are typically a few hundred bytes each, max 500 chars per Play Store rules). That's nowhere near ARG_MAX. **No live bug.**

But the trajectory is wrong:

1. **release.yml hasn't fired since SHY-0034 merged** (manual operator-trigger flow; releases are intentionally rare). So there has been no live-verification opportunity, ever, of the post-SHY-0034 GraphQL path on this workflow. The first real triggering is the one the operator just queued mentally for the "Done = release cut" rule — we should NOT discover the next layer of failure during that window.
2. **Play Store release-notes can grow** — current files are empty locally, but the workflow writes them dynamically (`bump-version.sh` populates them during the run); the operator could legitimately ship a release with full ~500-char notes per locale and per build variant.
3. **build.gradle.kts grows linearly with platform additions** — currently 17.7KB; another major plugin or Kotlin multiplatform target addition pushes it well above 50KB. Combined with longer release notes the pattern becomes vulnerable inside two releases.
4. **Structural symmetry beats reactive fixing** — SHY-0064 is in the codebase as the canonical solved-pattern; leaving release.yml on the prior shape costs nothing now but accumulates technical-debt drag: any future engineer touching either workflow has to keep two payload-construction shapes in their head, and the linter has to special-case which workflow gets the assertion.

Apply the SHY-0064 fix preventively: ONE `jq -n` invocation, additions array constructed inline via `($c1|@base64)`, no `--argjson` chaining, no `ADDITIONS=` intermediate.

## Acceptance Criteria

### Happy path
- [ ] `release.yml`'s `Create signed commit on main via GraphQL` step (currently lines 365-415) contains exactly ONE `jq -n` invocation in the block.
- [ ] The single `jq -n` consumes `--rawfile c1 app/build.gradle.kts`, `--rawfile c2 .../internal.txt`, `--rawfile c3 .../default.txt` and constructs the additions array inline via `($c1|@base64)`, `($c2|@base64)`, `($c3|@base64)` within the `variables.additions: […]` clause.
- [ ] No `ADDITIONS=$(jq …)` intermediate bash variable.
- [ ] No `--argjson additions "$ADDITIONS"` flag.
- [ ] Resulting `$PAYLOAD` is still piped to `gh api graphql --input -` via stdin (existing line ~388 unchanged).
- [ ] Post-mutation `RESPONSE` parser (`jq -r '.data.createCommitOnBranch.commit.oid // empty'`) unchanged.
- [ ] All 3 file paths (`app/build.gradle.kts`, `app/src/main/play/release-notes/en-US/internal.txt`, `app/src/main/play/release-notes/en-US/default.txt`) still present in the `additions` array, in the same order, with the same `path:` keys.
- [ ] The GraphQL mutation query string (lines 382, `mutation($repo: String!, …)`) is byte-identical.

### Error paths
- [ ] If any of the 3 `--rawfile` arguments points at a missing file, `jq` exits non-zero and the `set -euo pipefail` at the step head propagates the failure (`exit 70`-ish from jq → step fails; workflow exits red). Audit-trailed via `$GITHUB_STEP_SUMMARY` not being written.
- [ ] If the resulting payload is malformed JSON (impossible with `jq -n` but covered defensively), `gh api graphql --input -` returns a 422 and `$RESPONSE`'s `.data.createCommitOnBranch.commit.oid` is empty → existing `if [ -z "$COMMIT_OID" ]` block fires `::error::createCommitOnBranch mutation failed` and exits 1.
- [ ] Behavior on `expectedHeadOid` mismatch unchanged: GitHub returns a clear "Expected branch to point to <oid>" error; `$COMMIT_OID` is empty; step fails; operator re-triggers.

### Edge cases
- [ ] `build.gradle.kts` containing single-quotes / backslashes / multi-line `kts` strings is encoded correctly because `--rawfile` reads bytes verbatim and `@base64` is RFC-4648.
- [ ] `internal.txt` / `default.txt` containing emoji or non-ASCII characters (regional release notes) base64-encode correctly via `@base64` (jq uses the raw byte sequence).
- [ ] Files with trailing newlines / CRLF line endings are preserved in the base64 (jq's `--rawfile` does not strip trailing newlines).
- [ ] Empty file (e.g. operator-controlled empty `default.txt` for some locale) base64-encodes to empty string `""`; mutation accepts; commit lands with the empty file content preserved.

### Performance
- [ ] One fewer process invocation per release (no `ADDITIONS=$(jq ...)` sub-invocation). Negligible wall-clock; marginally lower memory.
- [ ] No new file-system reads — same 3 `--rawfile` reads, just relocated to the consolidated `jq -n` call.
- [ ] Local dry-run of the new jq pipeline against representative content completes in <50ms (matches SHY-0064's measured 26ms on a 237KB sync payload — release's 24KB payload is faster).

### Security
- [ ] No new shell interpolation of untrusted input. `--rawfile` reads from the (trusted) checked-out repo tree; the file paths are workflow-fixed string literals; `--arg repo "${{ github.repository }}"` is GitHub-controlled metadata (not user input).
- [ ] Release App secrets (`steps.app-token.outputs.token`) unchanged — still consumed via `env: GH_TOKEN:` block, never echoed.
- [ ] `bypass_actors` ruleset entry (ruleset 12613584, App ID 29110) untouched — this PR does not change branch protection.
- [ ] No new logs that could leak file content (the existing `echo` lines after the mutation are commit OID / URL only).

### UX
- N/A — `release.yml` is operator-triggered via `workflow_dispatch`; this PR changes only the internal jq pipeline shape, not any operator-facing input or output.

### i18n
- N/A — no user-facing strings; the only translated content (`internal.txt` / `default.txt`) is the Play Store release notes which are read verbatim from disk via `--rawfile`. The fix preserves their bytes exactly.

### Observability
- [ ] `$GITHUB_STEP_SUMMARY` "Release Commit Created" block unchanged — same rows (Version / Bump / Target branch / Commit OID / Signed by).
- [ ] CI's actionlint + shellcheck on the workflow file still passes (`set -euo pipefail` head still applies; no new unquoted globs; no new unset vars).
- [ ] New Jest assertion `release-workflow-jq-pattern.test.js` provides the structural-regression guard at `lint.yml`'s `test-backend` step — same gate that catches the SHY-0064 pattern regression on sync.

## BDD Scenarios

**Scenario: release.yml uses single-jq pattern after refactor**
- **Given** the operator views the `Create signed commit on main via GraphQL` step in `release.yml`
- **When** searching its run block for `jq -n`
- **Then** exactly ONE match is returned
- **And** no `ADDITIONS=$(jq` substring is present
- **And** no `--argjson additions` substring is present

**Scenario: All 3 release files still committed**
- **Given** the refactored step is reached during a workflow_dispatch run
- **When** the GraphQL mutation succeeds
- **Then** the resulting commit on `main` contains updates for `app/build.gradle.kts`, `app/src/main/play/release-notes/en-US/internal.txt`, and `app/src/main/play/release-notes/en-US/default.txt`
- **And** the bytes in each file match the post-`bump-version.sh` working-tree state

**Scenario: Jest assertion guards the pattern**
- **Given** the `express-api/tests/scripts/release-workflow-jq-pattern.test.js` Jest file
- **When** a future commit re-introduces `ADDITIONS=$(jq …)` or `--argjson additions` in `release.yml`
- **Then** the Jest run fails at the assertion `expect(content).not.toMatch(/--argjson\s+additions/)`
- **And** CI's `test-backend` job exits non-zero, blocking the regressing PR

**Scenario: Local dry-run validates the new jq pipeline**
- **Given** the new jq pipeline is invoked locally with representative content (current `app/build.gradle.kts` + sample 500-char release-notes files)
- **When** running the exact `jq -n --rawfile c1 … --rawfile c2 … --rawfile c3 … '{ … }'` block
- **Then** the resulting JSON parses successfully via `jq .`
- **And** the `variables.additions` array contains exactly 3 entries with the expected `path:` values
- **And** each entry's `contents:` field is a valid base64 string that decodes back to the source file bytes

**Scenario: jq exits non-zero on missing rawfile**
- **Given** one of the 3 source files is renamed or deleted prior to the jq call
- **When** the `jq -n --rawfile c1 <missing-path> …` invocation runs
- **Then** jq exits non-zero with "Could not open file" stderr
- **And** the step's `set -euo pipefail` propagates the failure
- **And** the workflow run ends red with no partial state on main

## Test Plan

**Red state:**
- Add `express-api/tests/scripts/release-workflow-jq-pattern.test.js` with assertions mirroring SHY-0064's sync-workflow assertions:
  - `expect(content).not.toMatch(/--argjson\s+additions/)`
  - `expect(content).not.toMatch(/ADDITIONS=\$\(jq/)`
  - exactly one `jq -n` count: `expect((content.match(/jq -n\b/g) || []).length).toBe(1)`
  - `--rawfile` + `@base64` distance gap: `expect(content).toMatch(/jq -n[\s\S]{0,900}--rawfile[\s\S]{0,900}@base64/)`
  - All 3 file paths present in additions: positive matches for `build.gradle.kts`, `internal.txt`, `default.txt` within a single `additions` block
  - Cross-workflow parity assertion against `sync-roadmap-data.yml` (both must use the same single-jq idiom)
- Run `cd express-api && npm test -- release-workflow-jq-pattern.test.js` — expect red.

**Green state:**
- Refactor `release.yml` lines 365-415: replace the two `jq -n` calls with ONE consolidated call, inline additions array via `($cN|@base64)`.
- Re-run the same Jest file — expect green.
- Full `cd express-api && npm test` — expect 11400+/11400+ tests passing (no regressions from the refactor).
- actionlint locally: `actionlint .github/workflows/release.yml` — clean.

**Local dry-run (mandatory per `[[feedback-workflow-verify-by-running]]`):**
- Stage representative content: current `app/build.gradle.kts` (~17.7KB) + sample populated `internal.txt` (500 chars) + sample populated `default.txt` (500 chars).
- Run the **exact refactored jq invocation** in a local terminal: capture stdout into `PAYLOAD`, verify `echo "$PAYLOAD" | jq .` succeeds, verify byte length is reasonable (~30-50KB), verify `echo "$PAYLOAD" | jq '.variables.additions | length'` returns `3`, verify each addition's `contents` field base64-decodes back to the source bytes via `echo "$PAYLOAD" | jq -r '.variables.additions[0].contents' | base64 -D | diff - app/build.gradle.kts`.
- Skip the real `gh api graphql --input -` step — no live mutation needed; that path is identical to what sync's SHY-0064 run already proved end-to-end yesterday (runs `27199389798`, `27199521183`, `27200545889` all green).

## Out of Scope

- **No changes to `release.yml`'s overall flow** — version bump, app-token mint, release-tag.yml trigger all untouched.
- **No changes to branch-protection** — SHY-0066 already migrated `required_status_checks` to ruleset 12613584; that's the layer release.yml's App-signed commits already satisfy.
- **No changes to `sync-roadmap-data.yml`** — it's already on the single-jq pattern (SHY-0064 shipped it).
- **No backfill of `released_in: vX.Y.Z` to existing Done SHYs** — that's the separate formalisation SHY (not filed yet); referenced in SHY-0066 Notes.
- **No new release trigger** — release.yml's `workflow_dispatch` trigger unchanged; operator still manually fires when ready.
- **No reorganisation of the 3 files** — preserving exact path strings + order keeps the diff minimal and limits the reviewer's surface area.

## Dependencies

- **SHY-0064** (merged 2026-06-09 09:52:56Z, PR #1046) — established the single-jq inline-additions pattern; this SHY mirrors it onto `release.yml`.
- **SHY-0066** (merged 2026-06-09 10:38:48Z, PR #1047) — migrated `required_status_checks` to ruleset 12613584; this is the layer that allowed sync's signed commits to land + is the layer release.yml needs when it's next triggered. No new infra dependencies.
- **`gh` CLI** (CI-provided) + **`jq`** (CI-provided, both Ubuntu and macOS runners ship it).
- **Release GitHub App** (App ID 29110) — already in `bypass_actors` of ruleset 12613584. No changes here.

## Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | The refactor breaks the GraphQL mutation in a subtle way (e.g. additions array shape) and the next release fails | Low | High (release blocked) | Local dry-run of the refactored jq pipeline against representative content + decode-roundtrip verification before push. Sync's SHY-0064 fix is the exact same shape and has been live-verified across 3 GraphQL mutations. |
| R2 | Reviewer falsely claims the new `[\s\S]{0,900}` regex distance allows a bypass | Low | Low | Pre-empt by widening cautiously + adding the explicit `--argjson additions` and `ADDITIONS=$(jq` negative assertions — both must be absent regardless of the positive regex distance. Two-rail negative + positive. |
| R3 | Future engineer adds a 4th file to the additions array and uses the old two-jq pattern by habit | Medium | Low (caught by tests) | The new Jest assertion file is a test-time tripwire — any re-introduction of `--argjson additions` or `ADDITIONS=$(jq` fails the `test-backend` job. PR can't merge. |
| R4 | Release-notes files exceed 500 chars per locale somehow + grow past ARG_MAX | Low | High (release blocked) | This SHY removes the ARG_MAX failure mode entirely. Even at theoretical max (Play Store imposes 500 char/release-note/locale; even with 20 locales bundled that's 10KB), the inline-additions pattern has no argv-passed encoded payload — `$PAYLOAD` goes through stdin via `gh api graphql --input -`, which has no kernel-level argv limit. |
| R5 | actionlint introduces a new rule against multi-line `jq` invocations | Low | Low | Verify actionlint pass locally pre-push. If a future actionlint version flags this, file a follow-up SHY. |

## Definition of Done

1. **Spec authored fully refined** — this file. ✅ on creation.
2. **TDD red** — new Jest file `express-api/tests/scripts/release-workflow-jq-pattern.test.js` written + run with `npm test` showing red against current `release.yml`. ✅ when red is observed.
3. **TDD green** — `release.yml` refactored to single-jq pattern; re-run Jest shows green; full express-api test suite passes. ✅ when green observed.
4. **Local dry-run completed** — refactored jq pipeline executed locally against representative content; `$PAYLOAD` is valid JSON; `additions` array has 3 entries; each `contents` field decodes back to the source bytes. ✅ when dry-run logged.
5. **Pre-self-review pass** — manual lint against known recurring finding categories (rawfile escaping, jq counter false-alarms, regex anchoring, distance-gap tightness).
6. **ONE reviewer cycle** — `code-reviewer` agent dispatched against the LOCAL commit; ALL findings applied as ONE amend; push once.
7. **PR opened + auto-merge armed** — PR title `SHY-0065: Apply single-jq inline-additions pattern to release.yml (preventive)`; body opens with `Implements SHY-0065 — see .project/stories/SHY-0065-release-yml-single-jq-pattern.md for full spec, AC, BDD scenarios, and DoD.`; `gh pr merge --auto --squash`.
8. **CI passes** — all 3 required checks green (Detect Changes, Analyze JavaScript, PR Gate); SonarCloud quality gate passes.
9. **Auto-merge fires** — PR merges into main on first all-checks-green.
10. **Post-merge: no live `release.yml` dispatch required** — the change is structural and the sync workflow's identical SHY-0064 pattern is already live-verified across 3 mutations on origin/main. The next operator-triggered release will exercise this code path under the new shape; the AC + Jest assertion + local dry-run already guarantee the byte-shape is correct.
11. **Lifecycle:** flips `In Review` on push, NOT `Done`. Flips `Done` + adds `released_in: vX.Y.Z` only when the next operator-triggered `release.yml` succeeds AND lands the resulting tag on prod, per `[[feedback-done-equals-release-cut]]`.

## Notes (running log)

**2026-06-09 ~11:55 BST — Spec authored fully refined.** Same-session follow-up to SHY-0066 (merged 10:38:48Z); SHY-0066's post-merge sync run (`27200545889`) confirmed the SHY-0038 → SHY-0063 → SHY-0064 → SHY-0066 sync chain is end-to-end live. This SHY closes the latent symmetry gap on `release.yml`: the two-jq pattern that just blew up on sync is preventively replaced with the SHY-0064 single-jq shape.

**Authoring decision:** preventive-not-reactive framing is honest — current release.yml payload is ~17.7KB → ~24KB base64, nowhere near ARG_MAX. But (a) release.yml hasn't fired since SHY-0034 merged so there's no live-verify history, (b) play-store release-notes can legitimately grow within Google's 500-char/locale rules, (c) leaving release.yml on the prior shape forces dual-pattern cognitive overhead on any future engineer touching either workflow.

**Pattern reference:** `sync-roadmap-data.yml` lines 133-142 (the SHY-0064 fix shape — `jq -n --arg … --rawfile c1 … '{ query: …, variables: { …, additions: [{path: …, contents: ($c1|@base64)}] } }'`). The refactor is structural mirror with 3 `--rawfile`s instead of 1 + 3 entries in the inline additions array instead of 1.

**Test file naming:** `express-api/tests/scripts/release-workflow-jq-pattern.test.js` — parallel to `sync-roadmap-data-workflow.test.js`. Assertion bodies cite SHY-0065 + (where copied verbatim) SHY-0064 for traceability.

**Dry-run strategy:** local-only; no live `release.yml` dispatch. Sync's SHY-0064 fix already proved the single-jq shape works against the GraphQL API end-to-end (runs `27199389798`, `27199521183`, `27200545889`). release.yml's only differences from sync are file count (3 vs 1) and total payload size (smaller), which a local dry-run with decode-roundtrip fully covers.
