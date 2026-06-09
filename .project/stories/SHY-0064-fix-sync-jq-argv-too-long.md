---
id: SHY-0064
status: Done
owner: claude
created: 2026-06-09
priority: P0
effort: XS
type: bug
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1046
released_in: v0.97.8
---

# SHY-0064: Fix SHY-0063 sync workflow — `jq: Argument list too long` when payload exceeds Linux ARG_MAX

## User Story

As **(a)** a ShyTalk maintainer relying on the SHY → `public/roadmap-data.json` automated sync, and **(b)** an outside visitor of `shytalk.com/roadmap` seeing stale public content, I want **the `sync-roadmap-data` workflow to handle the actual full-corpus file size** (177KB at time of writing, growing as the SHY corpus expands) so that the live-verify gate that SHY-0063 introduced actually passes — not regresses to the same broken state PR #1044 left us in.

## Why

SHY-0063 (PR #1045, merged 2026-06-09 09:08:16Z) replaced SHY-0038's broken `git push` with a `createCommitOnBranch` GraphQL mutation. The local Jest + workflow-checker + actionlint suite all passed; pre-merge reviewer applied 2 findings; PR CI was 3/3 required-checks green. **Live-verify gate (post-merge dispatch) caught a new failure** on the merge commit itself:

```
/home/runner/work/_temp/<id>.sh: line 59: /usr/bin/jq: Argument list too long
##[error]Process completed with exit code 126.
```

(Workflow run id `27195846958`, head SHA `1ed6fc8e04f9aae2fbdd2faba0533ebc19a83fee` — the SHY-0063 squash-merge commit.)

Root cause: SHY-0063 mirrored `release.yml`'s two-step pattern verbatim:

```bash
ADDITIONS=$(jq -n --rawfile c1 public/roadmap-data.json '[{path:"...", contents:($c1|@base64)}]')
PAYLOAD=$(jq -n --argjson additions "$ADDITIONS" ... '...')
```

That works for `release.yml` because its three files (`app/build.gradle.kts` + 2 release-notes files) together are ~10KB unencoded → ~14KB base64. The second `jq` call receives `$ADDITIONS` as an argv string via `--argjson additions "$ADDITIONS"`. argv strings are subject to the kernel's `ARG_MAX` ceiling (typically 128KB effective on Linux, despite `getconf ARG_MAX` reporting 2MB+ — the effective limit is `ARG_MAX` minus environment size minus stack/argv-padding overhead).

For sync, `public/roadmap-data.json` is currently 177,516 bytes → base64 ≈ 236,720 bytes. The second `jq -n` invocation receives that as an arg + exceeds `ARG_MAX` on the Ubuntu runner. `execve()` returns `E2BIG` → bash reports "Argument list too long" → workflow exits 126.

**This is the third documented incident of [[feedback-workflow-verify-by-running]] catching a workflow defect that ALL static gates passed** (PR #813 gh-api-404 quirk; PR #1044 signed-commit gap; PR #1045 jq ARG_MAX). The rule is doing exactly what it's supposed to do. SHY-0063's own DoD anticipated this class of failure by mandating live-verify and explicitly noting follow-up SHY filing per [[feedback-fix-pre-existing-and-new-same]].

**Approach alternatives explored:**

- **Option A — Single-jq combined invocation (CHOSEN).** Combine the two `jq -n` calls into ONE. `--rawfile` reads the file content; `--arg` parameters are short (repo name, branch, OID, message). The `additions` array is constructed INSIDE the jq filter using `$c1|@base64`, never materialising as a separate bash variable. `PAYLOAD` is then ~237KB (the full GraphQL request) but stays a bash variable that's piped to `gh api graphql --input -` via stdin — NOT passed as argv. Pros: minimal diff (single step refactor); preserves the proven mutation shape; no new dependencies. Cons: PAYLOAD as a bash variable is large (~237KB) but bash variables are limited only by `ulimit -s` (stack, typically 8MB), so this is safe.
- **Option B — `--slurpfile` from a tempfile.** Write the additions array to a tempfile, jq reads via `--slurpfile`. Pros: avoids any large shell variable. Cons: extra file I/O; cleanup discipline; doesn't materially improve over A.
- **Option C — Use `gh api graphql -f` field-by-field with `@/path/to/file` references.** GitHub CLI supports `@-` for stdin and `@/path` for file content on `-f` fields. Pros: avoids manual jq construction entirely. Cons: requires the additions array as a JSON literal anyway, and field interpolation with arrays gets awkward; benefits don't outweigh the rewrite.
- **Option D — Switch from `createCommitOnBranch` to the REST Contents API (`PUT /repos/.../contents/<path>`).** Pros: single API call; smaller request body (just the file content, not GraphQL boilerplate). Cons: REST `PUT /contents` does NOT produce signed commits (only GraphQL `createCommitOnBranch` does); fails the `required_signatures` rule. Eliminated by the same constraint that drove SHY-0063 to GraphQL.
- **Option E — Compress the additions content before encoding.** Gzip the JSON before base64. Pros: ~5x smaller payload. Cons: GitHub GraphQL doesn't decompress — the file ON main would be gzipped binary garbage. Eliminated.
- **Option F — Split into multiple smaller commits (chunked uploads).** Pros: each batch fits ARG_MAX. Cons: `createCommitOnBranch` is one-shot; the file IS a single JSON document; can't split without breaking the schema. Eliminated.

**Operator-anchored constraints (still in force):**

- `[[feedback-done-equals-release-cut]]` — SHY-0064 enters "Merged, awaiting release" at squash-merge; Done flip waits for next `release.yml vX.Y.Z`.
- `[[feedback-workflow-verify-by-running]]` STRENGTHENED 3x — SHY-0064's own DoD requires post-merge dispatch verification.
- `[[feedback-one-active-branch-close-on-finish]]` — SHY-0063 merged, branch deleted; SHY-0064 is the sole active branch.
- `[[feedback-rate-limit-slowdown-strategies]]` — ONE reviewer cycle, apply-all-in-one-batch.

## Acceptance Criteria

### Happy path

- [ ] `.github/workflows/sync-roadmap-data.yml` contains exactly ONE `jq -n` invocation that builds the full GraphQL `PAYLOAD` (not two with `--argjson` chaining). The `additions` array is constructed inline within the jq filter from `--rawfile c1 public/roadmap-data.json` + `($c1|@base64)`.
- [ ] The intermediate `$ADDITIONS` shell variable is GONE. No `--argjson additions "$ADDITIONS"` reference remains.
- [ ] `$PAYLOAD` is still piped to `gh api graphql --input -` via stdin (NOT passed as argv) — the only safe path for >128KB content.
- [ ] All other behaviours from SHY-0063 preserved: dual loop guard, `expectedHeadOid` race protection, file-absent guard, COMMIT_OID null guard, GITHUB_STEP_SUMMARY audit, no-op fast-path.
- [ ] Workflow runs successfully on the next `push: main` event triggered by THIS SHY's merge — verified via the live-dispatch gate in DoD.

### Error paths

- [ ] If `public/roadmap-data.json` is absent: file-absent guard from SHY-0063 still fires first; the jq invocation is never reached.
- [ ] If the combined `jq -n` call itself fails (e.g. malformed JSON in the regen output that breaks jq's own JSON output stage), `set -euo pipefail` propagates the failure; no partial mutation is sent.
- [ ] If `gh api graphql --input -` returns a GraphQL error response (null `commit.oid`), the `COMMIT_OID` empty-check from SHY-0063 still catches it; workflow exits 1 with the response printed via jq.
- [ ] The `expectedHeadOid` conflict path is unchanged — concurrent main commits still fail the mutation cleanly.

### Edge cases

- [ ] **File at ~exact ARG_MAX boundary**: not relevant under the new design (no argv-via-jq path remains). Fix is structural, not threshold-based.
- [ ] **File at much larger size (e.g. when SHY corpus grows past 500KB)**: `gh api graphql --input -` reads stdin, no ARG_MAX limit. Stays valid up to GraphQL's own request-body limit (~10MB per GitHub's docs).
- [ ] **Empty file**: `jq --rawfile c1 <empty>` produces an empty string; base64 of empty is empty; the mutation sends `contents: ""` which writes a zero-byte file. The diff-quiet fast-path catches this earlier (file would not have diff-changed from current state unless previously empty), so this edge is benign + matches SHY-0063's existing behaviour.

### Performance

- [ ] No regression: one `jq -n` invocation instead of two is marginally faster (saves ~50ms of fork+exec overhead). Workflow wall-clock budget unchanged at ≤30 seconds.

### Security

- [ ] Secret hygiene preserved: `GH_TOKEN` only set via `env:` block; no `echo`/`set -x` near the jq or `gh api` calls.
- [ ] No new path-restricted bypass-actor entries; the Release App bypass on ruleset `12613584` continues to be the sole authorisation path for the App-signed commit.
- [ ] No new env-variable interpolation paths introduced — the shell `$REPO`/`$BRANCH`/`$PARENT_SHA`/`$MSG` substitutions feeding `jq --arg` remain unchanged.

### UX

N/A — internal CI infrastructure with no user-facing surface.

### i18n

N/A — no user-facing strings introduced.

### Observability

- [ ] `$GITHUB_STEP_SUMMARY` audit block preserved (parent SHA, commit OID, file path, bytes, signed-by). On success this block confirms the fix is live.
- [ ] Log line `[sync] signed commit <oid> on main` preserved as the grep anchor for future incident triage.

## BDD Scenarios

**Scenario: 177KB JSON file commits successfully via the combined jq pipeline**

- **Given** `public/roadmap-data.json` is ~177KB (current corpus size) and has been regenerated with semantic changes
- **And** the actor-guard passes (`github.actor` is neither `github-actions[bot]` nor `shytalk-release-bot[bot]`)
- **When** the workflow runs the combined-jq commit-back step
- **Then** the single `jq -n` invocation produces a ~237KB PAYLOAD bash variable
- **And** `echo "$PAYLOAD" | gh api graphql --input -` succeeds without an ARG_MAX error
- **And** the mutation returns a non-empty `commit.oid`
- **And** the workflow logs `[sync] signed commit <oid> on main`

**Scenario: Fast-path still skips the mutation on no-op runs**

- **Given** the regen produces a JSON byte-identical to current main
- **When** the workflow's `git diff --quiet` check runs
- **Then** the fast-path branch fires; `jq` is never invoked; the workflow exits 0 in ~1 second

**Scenario: File-absent guard from SHY-0063 still precedes the diff**

- **Given** the regen step silently produced no output
- **When** the commit-back step runs
- **Then** the file-absent guard fires first; the workflow exits 1 with `::error::public/roadmap-data.json was not produced by the sync script — aborting.`
- **And** the jq pipeline is never reached

**Scenario: Future corpus growth past 500KB still works**

- **Given** the SHY corpus expands to produce a `public/roadmap-data.json` over 500KB
- **When** the workflow runs
- **Then** the combined-jq pipeline produces a PAYLOAD bash variable around 670KB
- **And** `echo "$PAYLOAD" | gh api graphql --input -` still succeeds (stdin not argv)
- **And** the mutation completes successfully

## Test Plan

### Red (new test fails against the current shipped sync-roadmap-data.yml)

- `express-api/tests/scripts/sync-roadmap-data-workflow.test.js`:
  - **new case** `SHY-0064: payload built in single jq -n (no --argjson chaining)`: assert that the workflow contains exactly ONE `jq -n` invocation in the commit-back step and that `--argjson additions` is ABSENT. FAILS today (two `jq -n` calls + `--argjson additions "$ADDITIONS"`).
  - **new case** `SHY-0064: no intermediate ADDITIONS shell variable`: assert no `ADDITIONS=$(jq` substring exists. FAILS today.

### Green (refactor sync-roadmap-data.yml until red passes)

- Replace the two-step jq pipeline with one combined invocation:
  ```bash
  PAYLOAD=$(jq -n \
    --arg repo "${{ github.repository }}" \
    --arg branch "${BRANCH}" \
    --arg oid "${PARENT_SHA}" \
    --arg msg "chore(roadmap): sync roadmap-data.json from SHY corpus" \
    --rawfile c1 public/roadmap-data.json \
    '{ query: "...", variables: { repo: $repo, ..., additions: [{path: "public/roadmap-data.json", contents: ($c1|@base64)}] } }')
  ```
- Drop the `ADDITIONS=...` line entirely.
- Full Jest suite remains 11733+/11733+ green.

### Live verification (BLOCKS Done per [[feedback-workflow-verify-by-running]] STRENGTHENED 3x)

1. Merge PR.
2. Confirm the `push: main` event fires `sync-roadmap-data.yml`.
3. Open the workflow run; observe `[sync] signed commit <oid> on main` log line.
4. `git pull origin main`; `git log --show-signature -1 origin/main` shows the App-signed commit.
5. Open `public/roadmap-data.json`; verify SHY-0038 + SHY-0060 + SHY-0063 + SHY-0064 entries now appear in `phases[].items[]` / `currentlyWorkingOn`.
6. Trigger `gh workflow run sync-roadmap-data.yml` manually; verify the no-op fast-path runs in <30s.
7. If ANY step fails: file SHY-0065 hotfix same-session; do NOT defer.

## Out of Scope

- **Framework formalisation** (validator `Merged` state, `released_in` field, CLAUDE.md lifecycle update, backfill of 9 pre-rule Done SHYs) — deferred to a separate SHY (was originally targeted as SHY-0064, now bumped to SHY-0065 or later since this 0064 slot is the hotfix).
- **SHY-0061 (renderer reads items[])** — still waiting for sync infra to actually function end-to-end.
- **SHY-0062 (features migration)** — depends on SHY-0061.
- **Status flip for SHY-0038 / SHY-0063** — release-gated per `[[feedback-done-equals-release-cut]]`; waits for next `release.yml vX.Y.Z`.

## Dependencies

**Existing (unchanged from SHY-0063):**

- Release GitHub App registered on Shyden-Ltd org (App ID `29110`) with `contents: write` permission.
- Ruleset `12613584` on `main` includes the Release App in `bypass_actors`.
- `RELEASE_APP_ID` + `RELEASE_APP_PRIVATE_KEY` repository secrets.

**No new dependencies introduced.** The fix is a structural refactor of an existing step.

## Risks & Mitigations

- **Risk:** The combined jq invocation has a subtle JSON-construction bug that doesn't show up in Jest's text-based assertions but breaks at runtime.
  - **Mitigation:** Local dry-run of the jq pipeline against the current `public/roadmap-data.json` BEFORE pushing — pipe its output through `jq .` to confirm valid JSON. Capture in PR description as evidence of pre-push verification beyond static assertions (atones for the SHY-0063 verification gap directly).
- **Risk:** The PAYLOAD bash variable at ~237KB causes some other process limit (e.g. `xtrace` log truncation, pipe buffer size).
  - **Mitigation:** `set -euo pipefail` propagates any failure. Pipe buffers on Linux are typically 64KB but `echo` writes are stream-fed, not atomic — pipes handle multi-MB streams routinely. `xtrace` is disabled (no `set -x`) so no log-truncation concern.
- **Risk:** A future SHY corpus expansion pushes the PAYLOAD past GitHub's GraphQL request-body limit (~10MB per their docs).
  - **Mitigation:** at 237KB current, with linear growth from SHY-per-file additions of ~2KB each, the 10MB ceiling is ~4500 SHYs away — orders of magnitude beyond reasonable corpus size. If approached, the fix would be chunked multi-file mutations (one path per file in `additions`), which `createCommitOnBranch` supports natively.
- **Risk:** The live-verify gate fails a THIRD time on this same workflow, revealing yet another class of bug.
  - **Mitigation:** SHY-0064's DoD requires live verification (same as SHY-0063). If failure, file SHY-0065 same-session per [[feedback-fix-pre-existing-and-new-same]]. The principle holds: dispatch is the only honest verification — when it surfaces a defect, fix it; don't defer.

## Definition of Done

- [ ] All AC bullets checked.
- [ ] Both new red-then-green Jest cases passing.
- [ ] Full express-api Jest suite still passes (11733+/11733+ green).
- [ ] `actionlint` + all 4 workflow checkers (action SHAs, concurrency scoping, no paid runners, lint) green.
- [ ] ONE code-reviewer agent dispatch on the local commit per [[feedback-reviewer-before-push-not-parallel]]; ALL findings applied in one batch.
- [ ] **Local dry-run of the new jq pipeline** against `public/roadmap-data.json` confirms valid JSON output (the verification step missing from SHY-0063 that would have caught this bug).
- [ ] PR pushed; CI 3/3 required checks green.
- [ ] Auto-merge armed AFTER reviewer ZERO; PR title canonical (`SHY-0064: <title>`); squash-merge to main.
- [ ] **LIVE DISPATCH VERIFICATION (BLOCKS the live-function gate):**
  - [ ] `push: main` fires `sync-roadmap-data.yml` on the SHY-0064 merge commit.
  - [ ] Run completes with conclusion=success + `[sync] signed commit <oid> on main` in the log.
  - [ ] `git log --show-signature -1 origin/main` shows App-signed commit.
  - [ ] `public/roadmap-data.json` post-pull contains SHY-0038 + SHY-0060 + SHY-0063 + SHY-0064 entries per public-surfacing rules.
  - [ ] Manual `gh workflow run sync-roadmap-data.yml` succeeds with no-op fast-path.
  - [ ] On ANY failure: file SHY-0065, work it same-session.
- [ ] **`status:` for SHY-0064 NOT set to Done in this PR** per [[feedback-done-equals-release-cut]]. Enters "Merged, awaiting release."
- [ ] `## Notes` log captures: original sync run-id 27195846958 (the failed jq run); reviewer cycle verbatim; live-verify outcome.

## Notes (running log)

**2026-06-09 ~10:25 BST — SHY-0063 live-verify gate caught a third workflow defect.** PR #1045 merge at 09:08:16Z fired sync-roadmap-data.yml run id `27195846958` on head SHA `1ed6fc8e04f9aae2fbdd2faba0533ebc19a83fee`. Workflow exited 126 with `/usr/bin/jq: Argument list too long` on the second `jq -n --argjson additions "$ADDITIONS"` call. Root cause: `public/roadmap-data.json` is 177,516 bytes → base64 ≈ 237KB → exceeded Linux Ubuntu runner's effective `ARG_MAX` when passed as a jq argv string. release.yml's two-step pattern works for its small files (~14KB base64 combined) but doesn't generalise to the sync's much larger payload. Verification-discipline credit: SHY-0063's own DoD anticipated this class of escalation by mandating post-merge dispatch + filing a follow-up SHY on any failure.

**Approach decision:** Option A (single-jq combined invocation) recommended; eliminates the `--argjson` argv path entirely. PAYLOAD becomes a single bash variable (~237KB) that pipes to `gh api graphql --input -` via stdin — no kernel argv limit applies. Local dry-run of the new pipeline BEFORE push is required by SHY-0064's DoD (the verification step that would have caught this bug pre-merge in SHY-0063).

**2026-06-09 ~10:50 BST — Code-reviewer agent `a8f1f5ade4bfb4996` returned 1 Critical + 1 Important on local commit `ffacc20475e`.**

- **C1 (Critical, confidence 90)** — _`release.yml` carries the original two-step pattern and will hit the same ARG_MAX failure at corpus growth_. The reviewer correctly notes the bug is NOT live in `release.yml` today (its 3 commit files — `app/build.gradle.kts` + 2 release-notes TXTs — total ~14KB base64, comfortably under ARG_MAX). But the SAME structural defect remains. **Resolution:** acknowledged + committed to a same-session **SHY-0065** follow-up per `[[feedback-fix-pre-existing-and-new-same]]` HARD RULE. SHY-0065 will refactor `release.yml`'s commit-back step to the single-jq inline-additions pattern (same shape as SHY-0064 applies to sync). Filed AFTER SHY-0064 merges per `[[feedback-one-active-branch-close-on-finish]]` (one active branch at a time); 1-PR-1-SHY discipline forbids bundling into this PR. SHY-0065's PR will also add the Jest regression test for `release.yml`'s commit-back step (I1 below).
- **I1 (Important, confidence 85)** — _`release.yml`'s two-step pattern has no automated regression test guarding against future ARG_MAX failures_. Covered by SHY-0065 in the same scope as the refactor: the new test file (`release-workflow.test.js` or similar) asserts the same `--argjson additions` absent + single `jq -n` pattern that this SHY's test asserts for sync.

Reviewer agent declared all of the following Verified Clean: jq filter syntax (`($c1|@base64)`), `--rawfile` bytes-verbatim behaviour (BOM/trailing whitespace safe), shell variable substitution (`${BRANCH}`/`${PARENT_SHA}` short strings — no ARG_MAX surface from those), `@base64` flat output (no line-wrapping), the doubled-jq-counting regex with the "ONE jq null-input invocation" rephrased comment, bounded-character-class `--rawfile[\s\S]{0,900}@base64` (finite + linear, no slow-regex risk), and the four workflow checkers.

**2026-06-09 ~10:00 BST — Post-SHY-0064-merge sync workflow run `27198217568` FAILED with a different error**: `gh: Repository rule violations found / 3 of 3 required status checks are expected`. SHY-0064's jq ARG_MAX fix WORKED (no more "Argument list too long") but a deeper layered-protection issue surfaced: classic branch protection on `main` enforced `required_status_checks` with no bypass mechanism, blocking the Release App's mutation. Filed **SHY-0066** to migrate that rule into ruleset 12613584 (where the App's `bypass_actors` entry already applies).

**2026-06-09 ~10:15 BST — SHY-0066 migration completed + verified.** SHY-0064's fix is now live end-to-end. Sync workflow ran `27199389798` (post-migration) → `conclusion: success` → committed `ce53436a6b0` to main, App-signed, as `shytalk-release-bot[bot]`. Subsequent no-op fast-path run `27199521183` succeeded with `[sync] no changes — public/roadmap-data.json is up to date`. The SHY-0038 → SHY-0063 → SHY-0064 → SHY-0066 chain delivers the original SHY-0038 promise: every SHY status flip auto-propagates to the public roadmap webpage.

— EOF for now; SHY-0065 (release.yml preventive jq refactor) entries land elsewhere; release-cut Done flip lands on next operator-triggered release.yml run.

**2026-06-09 ~22:57 BST — Released in v0.97.8.** PR #1046 squash-merged 2026-06-09. v0.97.8 cut by release.yml run 27238174189; flipped Done.
