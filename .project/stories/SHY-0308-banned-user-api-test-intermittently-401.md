---
id: SHY-0308
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: S
type: bug
roadmap_ids: []
---

# SHY-0308: The banned-user API test intermittently gets 401 where it demands 403

## User Story

As a **developer trusting the anti-abuse suite**, I want the banned-user API
test to fail only when a ban is not enforced, so that **a red there means
something** instead of being re-run until it goes green.

## Why

`tests/web/suggestions-security.spec.ts:218` — *"banned user: direct API call
returns 403"* — failed on PR #1765 (run `31982912120`, webkit):

```
Expected: 403
Received: 401
  at tests/web/suggestions-security.spec.ts:234
```

It failed on the first attempt AND on Playwright's automatic retry, then the
**identical commit passed on a plain job re-run**. So it is intermittent, not
deterministic, and re-running is currently the de-facto workaround — which is
exactly how a real intermittent security regression would be trained into
invisibility.

### It is not the PR it failed on

PR #1765 changes `shared/src/iosMain/**`, `iosApp/iosApp/AppDelegate.swift`,
`shared/build.gradle.kts`, one Jest CI-structure test, and story `.md` files.
None of that is reachable from an Express route or a browser. Same product
code passed webkit on #1760 and #1761 hours earlier, and the same SHA passed on
re-run. Three independent lines of evidence; the failure belongs to the test or
its fixture, not to that diff.

### What 401-instead-of-403 actually means

The request was still REFUSED, so the ban was not bypassed — this is a
**contract** failure, not an open door. But the distinction matters:

- **403 `banned`** — the server authenticated the caller and refused them for
  being banned. That is the property the test exists to prove.
- **401** — the server never got as far as the ban check, because it did not
  accept the credential.

A suite that accepts either has stopped testing bans; it is testing "something
refused me". If the ban check silently regressed, this test would go on passing
as long as auth also failed.

### The likely mechanism, stated as a hypothesis and NOT as a finding

The test signs in as the `banned` persona, waits for the standing banner, then
calls `getIdToken()` and POSTs with it. A 401 means the API rejected that
token. Candidate causes, in the order worth checking:

1. the banned persona's session is revoked/disabled server-side between
   sign-in and the fetch, so the ID token is no longer accepted;
2. `getIdToken()` returns a cached token that has expired, since the test never
   forces a refresh;
3. shared-persona contention — another spec (or a parallel shard) mutates the
   same `banned` persona, and a failed spec's `teardownStanding` did not run.
   The same run also had `admin-logs.spec.ts:76` go flaky, so at least one
   other test was misbehaving at the time.

None of these is confirmed. Confirming one is the first job of this story;
"it's flaky" is not a diagnosis ([[feedback-environmental-is-not-a-diagnosis]]).

## Acceptance Criteria

### Happy path

- [ ] A banned user's direct API call is refused with 403 and `code: banned`,
      every run.
- [ ] The test passes 20 consecutive runs on webkit without a retry.

### Error paths

- [ ] If the call is refused with 401, the test FAILS with a message saying the
      credential was not accepted and the ban check never ran — the current
      bare `Expected 403, Received 401` sends the reader to the wrong layer.
- [ ] The root cause is identified and fixed, not retried away. If the cause is
      token freshness, the fix is in the test; if it is session revocation, the
      fix is in the product or the test's expectation, and that is a decision
      to record.

### Edge cases

- [ ] The test does not depend on any other spec's `teardownStanding` having
      run.
- [ ] It is safe under Playwright's parallel workers and shards — either the
      persona is exclusive to it, or the test tolerates concurrent readers
      without tolerating concurrent writers.
- [ ] A token that legitimately expires mid-test is refreshed, not asserted on.

### Performance

- [ ] No added sleeps. Any waiting is condition-based
      ([[feedback-never-use-sleeps-condition-based-waits]]).

### Security

- [ ] The test must still fail if the ban is genuinely not enforced — proven by
      mutation, not by inspection.
- [ ] The fix must not weaken the assertion to "status >= 400", which would
      make the flake disappear by deleting the test's purpose.

### UX

- [ ] N/A — test-suite change, no user-facing surface.

### i18n

- [ ] N/A.

### Observability

- [ ] On failure the test reports the status, the response body and whether the
      token was fresh, so the next occurrence is diagnosable from CI output
      alone rather than needing a re-run to reproduce.

## BDD Scenarios

**Scenario: a banned user is refused for being banned**

- **Given** a signed-in banned user
- **When** they call the suggestions API directly
- **Then** they are refused with 403 and told the reason is a ban

**Scenario: an unauthenticated refusal is not mistaken for a ban**

- **Given** a request the server will not authenticate
- **When** the anti-abuse suite runs
- **Then** it fails and says the ban check never ran

**Scenario: the ban is genuinely not enforced**

- **Given** a build where the ban check is removed
- **When** the anti-abuse suite runs
- **Then** it fails

## Test Plan

**Reproduce before fixing.** The failure is intermittent, so the first
deliverable is a reliable reproduction, not a patch:

- run `tests/web/suggestions-security.spec.ts` on webkit in a loop (≥20
  iterations) against the local stack, recording status + body each time;
- run it concurrently with `admin-logs.spec.ts` and the rest of the suite, since
  the failing run also had a second spec misbehaving — contention is
  hypothesis 3;
- capture whether `getIdToken()` returned a fresh or cached token in the failing
  iteration, which separates hypothesis 2 from 1.

Do NOT proceed on a hypothesis that has not reproduced. If it cannot be
reproduced locally, say so and instrument CI instead of guessing.

**RED first**, once reproduced: a test that fails for the CURRENT cause, then
the fix, then the loop again.

**Mutation checks:**

- remove the ban check from the suggestions route ⇒ the test must redden. This
  is the assertion that matters and it must be proven, because the obvious
  wrong fix — relaxing the assertion to any 4xx — would pass everything above
  while testing nothing ([[feedback-mutation-passed-means-investigate]]);
- make the route return 401 unconditionally ⇒ the test must redden with the
  new "credential not accepted" message rather than a bare status mismatch.

**Green** — 20 consecutive webkit runs, plus the full `tests/web` suite.

## Out of Scope

- The `admin-logs.spec.ts:76` flake seen in the same run. It is recorded here
  as context because it may share a cause, but it is a separate symptom and
  gets its own story if the causes turn out to be unrelated.
- Any change to how bans are enforced in the product, unless the reproduction
  shows the product is what is wrong.

## Dependencies

- `tests/web/suggestions-security.spec.ts`
- the suggestions route and its ban gate in `express-api/src/`
- the `banned` test persona and `signInWithStanding` / `teardownStanding`

## Risks & Mitigations

- **Risk:** the "fix" is a retry or a widened assertion, and the suite quietly
  stops testing bans. **Mitigation:** the Security AC forbids `status >= 400`,
  and the ban-removal mutant must redden.
- **Risk:** it cannot be reproduced locally and the story stalls.
  **Mitigation:** the Test Plan's fallback is to instrument CI rather than
  guess; a story that ends in "instrumented, awaiting a recurrence" is honest,
  a story that ends in "added a retry" is not.
- **Risk:** treated as environmental and closed. **Mitigation:** it is filed as
  P1 precisely because an intermittent failure in a security test is the shape
  that trains people to ignore red.

## Definition of Done

- [ ] The cause identified, with evidence, not inferred.
- [ ] Reproduced before being fixed.
- [ ] 20 consecutive webkit runs green with no retries.
- [ ] The ban-removal mutant proven to redden the test.
- [ ] The failure message distinguishes "not authenticated" from "not banned".
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes (running log)

- **2026-08-17 — filed from PR #1765's CI.** Failed twice in run
  `31982912120` (initial + Playwright retry), then the identical commit passed
  on a job re-run. Recorded rather than re-run-and-forgotten: the whole hazard
  of an intermittent security test is that re-running is cheap and looks like a
  fix.
- PR #1765 was merged with this outstanding, deliberately: it is a P0 fix for a
  completely broken iOS build, the failure is unrelated to its diff by three
  independent lines of evidence, and blocking it would have kept iOS broken for
  the sake of a defect in another suite.
