---
id: SHY-0019
status: Draft
owner: claude
created: 2026-06-07
priority: P1
effort: S
type: infra
roadmap_ids: [G012]
pr:
---

# SHY-0019: qa-runner --smoke `|| true` → targeted exit-code handling

## User Story

As the ShyTalk operator, I want **`.github/workflows/qa-runner-driver-checks.yml:141`'s current `|| true` swallow on the qa-runner `--smoke` invocation replaced with targeted exit-code handling that ignores ONLY known infrastructure-not-running signals (e.g. ECONNREFUSED) and propagates every other failure**, so that real driver-routing or parsing regressions can never silently merge to main.

## Why

The current line in `.github/workflows/qa-runner-driver-checks.yml:141` (or near; verify exact line at PR-start) runs `node manual-qa-runner.js --smoke ... || true`. The `|| true` shell idiom suppresses ALL non-zero exit codes from the runner — meaning a parse error, a dispatch regression, a removed driver method, or even a runtime crash will silently exit 0 and let CI pass green.

The original rationale (from the workflow's commit history): the smoke step is meant to be informational because the runner depends on a local stack that isn't always running in CI. Connection-refused is the EXPECTED failure mode; everything else is a real bug.

Roadmap row G012 (line 80 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟠 Important. Category: CI — `|| true` swallows real smoke failures. Location: `.github/workflows/qa-runner-driver-checks.yml:141`. Gap: Parse/dispatch regressions silently invisible. Fix: Targeted exit-code check OR `--smoke-ignore-connect-errors` flag (exits 0 only on ECONNREFUSED). Scope: S.

P1 Tier-2 CI reliability — the silent failure swallow means we've potentially merged broken runner code repeatedly without knowing. This is foundational to the entire QA matrix infrastructure (SHYs 0020, 0026 build on top of the runner's CI gate working).

## Acceptance Criteria

### Happy path

- [ ] `manual-qa-runner.js` gains a `--smoke-ignore-connect-errors` flag (or equivalent named flag — operator can suggest the name).
- [ ] When the flag is set: the runner detects connection-refused errors (Node.js error code `ECONNREFUSED`) on connections to the local stack ports (Express :3000, LiveKit :7880, MinIO :9000, Firebase emulators :8080 / :4000) and exits 0 with a clear stderr message: `SKIPPED: local stack not running (ECONNREFUSED on port N)`.
- [ ] When the flag is set and the runner encounters ANY OTHER error (parse error, dispatch regression, missing driver method, runtime crash, etc.): exits with the actual non-zero exit code; stderr names the exact error.
- [ ] When the flag is NOT set: behaviour unchanged from current (every error exits non-zero).
- [ ] `.github/workflows/qa-runner-driver-checks.yml:141` is updated from `... || true` to `... --smoke-ignore-connect-errors` (no shell-level swallow).
- [ ] A new line above the workflow step documents WHY: `# Use --smoke-ignore-connect-errors so connection-refused (no local stack) is the only swallowed signal; parse/dispatch regressions fail the job. See SHY-0019.`

### Error paths

- [ ] Connection-refused on an UNEXPECTED port (e.g. `:8888` which isn't in the local-stack list) → does NOT exit 0; the assumption is local-stack-down, not arbitrary network unreachability.
- [ ] Parse error in driver registration → exits non-zero with the actual parse error in stderr.
- [ ] Driver method missing → exits non-zero; error names the missing method.
- [ ] Runtime crash (uncaught exception in runner) → exits non-zero with the stack trace.
- [ ] DNS resolution failure → does NOT swallow (treated as a real error; localhost shouldn't need DNS).
- [ ] Timeout (the runner hangs waiting for a service) → exits non-zero after the timeout; not swallowed.

### Edge cases

- [ ] **Partial stack running**: Express on :3000 but LiveKit not on :7880 → the runner attempts both, gets ECONNREFUSED on :7880, exits 0 with a clear message listing the missing port. Not a hidden failure; the operator can see what was skipped.
- [ ] **Flag misuse**: `--smoke-ignore-connect-errors` set without `--smoke` → emits a warning (`flag has no effect without --smoke`) but does not error.
- [ ] **Stale ECONNREFUSED detection**: the runner uses Node.js's error code, not stderr-grep — verify by running with a real ECONNREFUSED scenario and asserting the code path.
- [ ] **Multiple errors in one run**: if the runner encounters ECONNREFUSED AND a parse error → exits non-zero (parse error wins; the connection error is secondary).
- [ ] **Backwards compatibility**: pre-flag callers of `--smoke` (if any exist in local dev scripts) continue to work; the flag is additive.

### Performance

- [ ] No perceptible runner startup overhead from the flag (it's a CLI parse + a code branch).
- [ ] The added exit-code detection adds <1ms per error.

### Security

- [ ] The flag does NOT swallow auth failures (401, 403 from Express) — those are real failures, not local-stack-down.
- [ ] The flag does NOT swallow CSRF failures — same reasoning.
- [ ] No new logged-sensitive-data paths; the stderr message names ports + connection state, not request payloads.

### UX

- [ ] CI workflow log clearly shows: either `[smoke] SKIPPED: local stack not running (ECONNREFUSED on :3000)` OR the full error trace. No ambiguity.
- [ ] Local dev: running `node manual-qa-runner.js --smoke --smoke-ignore-connect-errors` against a running stack passes normally; against a stopped stack exits 0 with the skip message.

### i18n

- [ ] N/A — internal CLI tool; English-only.

### Observability

- [ ] CI workflow's job summary surfaces the smoke step's outcome: `Smoke: <PASSED | SKIPPED-stack-down | FAILED>`.
- [ ] If SKIPPED, the job summary names the ports + the implied missing services.
- [ ] If FAILED, the job summary includes the error class + first line of the trace.
- [ ] No swallowed-error fingerprint remains: `grep -n "|| true" .github/workflows/qa-runner-driver-checks.yml` returns zero matches after this PR.

## BDD Scenarios

**Scenario: Local stack running → smoke passes**

- **Given** the local stack is running on its expected ports
- **When** CI runs `node manual-qa-runner.js --smoke --smoke-ignore-connect-errors`
- **Then** the runner completes normally
- **And** exit code is 0
- **And** the workflow step shows PASSED

**Scenario: Local stack down → smoke exits 0 with skip message**

- **Given** the local stack is NOT running (no Express, no LiveKit, etc.)
- **When** CI runs with the flag
- **Then** the runner attempts to connect, gets ECONNREFUSED on each port
- **And** stderr contains `SKIPPED: local stack not running (ECONNREFUSED on port 3000)`
- **And** exit code is 0
- **And** the workflow step shows SKIPPED

**Scenario: Parse error in runner → exits non-zero (the regression we're fixing)**

- **Given** the runner code has a syntax error (intentionally introduced for the test)
- **When** the workflow step runs with the flag
- **Then** the parser surfaces the SyntaxError
- **And** the exit code is NOT 0
- **And** the workflow step fails (red CI)
- **And** the job summary shows the error class

**Scenario: Auth failure → not swallowed**

- **Given** the local stack is running but Express returns 401 for the runner's auth
- **When** the runner hits the auth-protected endpoint
- **Then** the runner exits non-zero with the 401 message
- **And** the swallow flag does NOT intervene

**Scenario: No more `|| true` swallow on the workflow line**

- **Given** the PR is merged
- **When** `grep -n "|| true" .github/workflows/qa-runner-driver-checks.yml` runs
- **Then** there are zero matches

## Test Plan (TDD)

### Red

1. Add `express-api/tests/scripts/manual-qa-runner-smoke-flag.test.js`:
   - Test A: runner invoked with `--smoke --smoke-ignore-connect-errors` against a non-responding port → exits 0 with skip message.
   - Test B: runner invoked with same flag + a forced parse error (mock) → exits non-zero.
   - Test C: runner invoked without the flag → behaves as today (no swallow).
   - Test D: workflow YAML grep for `|| true` on the affected line returns 0 matches (workflow-static-check style).
2. Run `cd express-api && npm test -- manual-qa-runner-smoke-flag` → RED on all (flag not yet implemented; workflow still has `|| true`).

### Green

1. Add the `--smoke-ignore-connect-errors` flag parsing to `manual-qa-runner.js`.
2. Add an error-classifier helper (`isConnectionRefusedToLocalStackPort(err)`) that inspects `err.code === 'ECONNREFUSED'` AND `err.port` is in the known local-stack port set.
3. Wrap the smoke logic in a try/catch (or `.catch()` chain) that applies the classifier when the flag is set.
4. Update `.github/workflows/qa-runner-driver-checks.yml:141` to drop `|| true` and append `--smoke-ignore-connect-errors`.
5. Re-run tests → GREEN.
6. Verify CI workflow's dry-run (workflow_dispatch with `dry-run=true`) succeeds.

## Out of Scope

- **Refactoring the runner's smoke logic** beyond the flag addition — minimal touch.
- **Adding new smoke checks** — only the flag handling.
- **Starting the local stack in CI** — separate concern; runner stays a "depends on local stack" optional check in CI.

## Dependencies

- **SHY-0001** + **SHY-0032** — process dependencies.
- `manual-qa-runner.js` source (verify path; likely `express-api/scripts/manual-qa-runner.js` or repo root).
- `.github/workflows/qa-runner-driver-checks.yml` — the consumer.
- Existing runner test harness in `express-api/tests/scripts/`.
- Per [[feedback-workflow-verify-by-running]]: must dispatch the workflow and observe success post-merge.

## Risks & Mitigations

- **Risk:** The flag accidentally swallows a real connection error (e.g. a misconfigured proxy that returns ECONNREFUSED). **Mitigation:** the classifier checks port number too — only the known local-stack ports are eligible; other ports propagate.
- **Risk:** Adding the flag breaks the local dev workflow if someone was relying on the `|| true` shell-level swallow. **Mitigation:** the flag is additive; local invocations without it behave as today.
- **Risk:** The job summary update requires `GITHUB_STEP_SUMMARY` emission — adds complexity. **Mitigation:** simple `echo "Smoke: SKIPPED" >> $GITHUB_STEP_SUMMARY` line; standard pattern.
- **Risk:** Per [[feedback-workflow-verify-by-running]], the workflow must be dispatched + observed before claiming Done. **Mitigation:** explicit in DoD; operator-supervised post-merge dispatch.

## Definition of Done

- [ ] `--smoke-ignore-connect-errors` flag implemented in the runner.
- [ ] Workflow YAML updated; no `|| true` remains.
- [ ] All test cases pass.
- [ ] Workflow dispatched post-merge; observed PASSING with local stack down (SKIPPED) AND failing on intentionally-broken runner state.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`infra` → auto-merge + workflow-verified per [[feedback-workflow-verify-by-running]]).
- [ ] PR merged.
- [ ] `status: Done`; `pr:` populated; workflow-dispatch outcome in Notes.

## Notes (running log)

- 2026-06-07 ~21:03 BST — Refined under SHY-0032. Tier 2 CI reliability — closes the silent-failure-swallow that's been masking driver regressions.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-G2` (roadmap_ids: G012).
