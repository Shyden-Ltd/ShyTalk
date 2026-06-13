---
id: SHY-0058
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: bug
roadmap_ids: [G050]
pr:
mvp: true
---

# SHY-0058: Convert dev-sanity.spec.ts:66-72 API-not-running skip to assertion error

## User Story

As a CI-reliability-conscious ShyTalk maintainer, I want **`tests/web/dev-sanity.spec.ts:66-72`'s "API not running" skip path** (which silently passes if the Express API isn't reachable, masking real CI outages) **converted to an assertion error** (or the CI workflow verified to ALWAYS start the API before this test), so that dev-environment outages surface as test failures, not as silently-passing skipped tests.

## Why

Roadmap row (line 97, 2026-06-05): `G050 | 🟡 Polish | dev-sanity API-not-running skip | tests/web/dev-sanity.spec.ts:66-72 | In CI the API should always run; skip masks unexpected outages | Verify playwright-tests.yml starts API; convert to assertion error | XS`.

The skip was probably useful when the test was developed locally without the API running. In CI it's a footgun — silently-passing tests are the worst kind of false confidence.

## Acceptance Criteria

### Happy path

- [ ] Read `tests/web/dev-sanity.spec.ts:66-72` to understand the current skip condition (probably `fetch(API_URL).catch(() => test.skip(...))`).
- [ ] Read `.github/workflows/playwright-tests.yml` to verify the API IS started before this test runs.
- [ ] If CI starts the API: convert the skip to an assertion error — `expect(apiResponse.ok()).toBe(true)` or similar — with a clear failure message naming "API health check failed; verify CI startup."
- [ ] If CI does NOT start the API: file a follow-up SHY to fix the workflow + convert the skip to a `test.fixme()` with rationale + cross-link to the follow-up SHY.

### Error paths

- [ ] **Local dev still legitimately runs without API**: use `process.env.CI === 'true'` to gate — fail loudly in CI, skip in local dev.
- [ ] **The API health endpoint format changed**: update the check; document expected response shape.
- [ ] **Test depends on something beyond API health** (e.g. specific data seeded): out of scope; this SHY only converts the skip path.

### Edge cases

- [ ] **API is reachable but returns error** (5xx): treat as failure, not skip; the test should distinguish "API down" from "API broken."
- [ ] **Test runs from a context without network access** (e.g. detached environment): document expected error message.

### Performance

- [ ] N/A.

### Security

- [ ] N/A.

### UX

- [ ] N/A — CI test.

### i18n

- [ ] N/A.

### Observability

- [ ] On failure post-fix: CI failure message clearly identifies the cause ("API health endpoint unreachable: <url> failed with <error>").

## BDD Scenarios

**Scenario: API reachable → test runs normally**

- **Given** the local stack OR CI environment has the API healthy
- **When** dev-sanity.spec.ts runs
- **Then** the test executes its assertions
- **And** does NOT hit the skip path

**Scenario: API unreachable in CI → test fails loudly**

- **Given** `process.env.CI === 'true'` AND the API is not reachable
- **When** the test runs
- **Then** the test FAILS (not skipped)
- **And** the failure message names the cause

**Scenario: API unreachable in local dev → test still skips**

- **Given** `process.env.CI !== 'true'` AND the API is not reachable
- **When** the test runs
- **Then** the test skips with a clear local-dev rationale message

## Test Plan

**Red:**
- Current state of the file at lines 66-72.
- Verify in CI: search `.github/workflows/playwright-tests.yml` for API-start step.

**Green:**
- Apply the CI-vs-local conditional skip.
- Test locally with API down (should skip) + API up (should pass).

**Coverage gate:** behaviour differs correctly across CI / local.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (edits a Playwright spec + possibly `playwright-tests.yml`) → the FULL protocol applies. The bug is itself a silent-failure-masks-real-outage pattern — the fix makes the test hit the **real** API and fail loudly when CI's real API is down (companion to [[SHY-0053]]/[[SHY-0054]]).

**Frameworks exercised (RED→GREEN):**
- ✅ **Web E2E Playwright** — `dev-sanity.spec.ts` hitting the **real Express API health endpoint** (per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only); in CI an unreachable/5xx API now FAILS the run instead of skipping.
- ✅ **eslint** (`--max-warnings=0`) — the spec TS.
- ⬜ **actionlint** — only if `playwright-tests.yml` is edited to add/confirm the API-start step (the AC may just verify it already starts the API).
- ⬜ **Express Jest · Android/iOS app · Kotlin/detekt/ktlint** — N/A.

**No-Stubs / verified-by-running:** prove BOTH branches against real conditions, not from code ([[feedback-workflow-verify-by-running]]): induce a **real unreachable API** (stop it / wrong port) in a CI/scratch run with `CI=true` → the test really fails with the named cause; run locally with `CI` unset + API down → the test really skips with the local-dev message; API healthy → it really runs. The CI-vs-local gate must be a **real `process.env.CI` check**, and a real 5xx must be treated as failure (distinct from unreachable). **🚩** if CI does NOT already start the API, that's a follow-up workflow SHY + a `test.fixme()` cross-linked — never leave the silent skip.

**LOCAL gauntlet:** the three branches proven locally (API up → run; API down + local → skip; the CI-down failure proven on a scratch CI run); eslint clean. Any failure → fix → restart.
**DEV gauntlet:** push to the branch and confirm on the **real** CI pipeline that the test runs (real API healthy) and would fail loudly if the API were down. Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt; NO auto-merge.

## Out of Scope

- Other dev-sanity tests beyond the skip path.
- Adding new dev-sanity assertions.
- Re-architecting the local stack startup.

## Dependencies

- `tests/web/dev-sanity.spec.ts` exists.
- `.github/workflows/playwright-tests.yml` (or equivalent) starts the API.
- Local dev stack per [[reference-local-stack-runner-setup]].

## Risks & Mitigations

- **Risk: legitimate API outages cause CI noise.** Mitigation: that's the POINT — outages should be noisy.
- **Risk: local dev contributors hit the failure mode without expecting it.** Mitigation: the local-dev branch of the conditional still skips with a clear message.

## Definition of Done

- [ ] Skip converted per the AC.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): both branches proven against real conditions (real unreachable-API failure in CI, real local skip, real healthy run) + eslint clean (+ actionlint if the workflow was edited) → `code-reviewer` 100% clean → push → CI green by name (real API healthy) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:22 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 97 (G050). Reserved ID SHY-0058.
- 2026-06-13 ~01:33 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): companion to [[SHY-0053]]/[[SHY-0054]] — the "API-down → skip" path is a silent-failure-masks-outage pattern; the fix hits the REAL API + fails loudly in CI. No-Stubs/verified-by-running ([[feedback-workflow-verify-by-running]]): both branches proven against REAL induced conditions (real unreachable/5xx API → CI fails with named cause; real local skip; real healthy run) — never from code; real `process.env.CI` gate. **🚩** if CI doesn't already start the API → follow-up workflow SHY + cross-linked `test.fixme()`, never a silent skip. DoD swaps the stale Reviewer-ZERO line for protocol-satisfied + judgment-merge + released_in + `pr:`. Pickup-fitness: AC current; the `:66-72` line numbers + whether `playwright-tests.yml` starts the API to re-confirm at pickup.
