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

- **2026-08-21 — reproduced LOCALLY on chromium, and the layer is now pinned.**
  Hit during the pre-push hook on `bug/SHY-0416-ios-dev-cannot-sign-in` (a
  one-line story edit — again unrelated to the diff). Suite result:
  1416 passed, 1 failed, 1 flaky, 20.1m. It failed on the initial attempt AND
  on retry #1, both `Expected: 403, Received: 401`.

  **New evidence, from the saved trace rather than inference.**
  `test-results/…-returns-403-chromium/trace.zip` carries the actual response
  body for the POST:

  ```
  POST http://localhost:3000/api/suggestions -> 401 Unauthorized
  {"error":"Authentication failed"}
  ```

  That string appears in exactly one place: the `catch` at the bottom of
  `authMiddleware` (`express-api/src/middleware/auth.js`). It is **not**
  `'Missing or invalid Authorization header'` (the header guard) and **not**
  `'Authentication required'` (`suggestions.js`'s local `requireAuth`). So the
  Authorization header WAS well-formed and the request DID enter the `try` —
  something inside it threw.

  Inside that `try`, in order: `auth.verifyIdToken(idToken)`,
  `resolveUniqueId(uid)`, `checkSuspension(uniqueId)`, `checkUserBans(uniqueId,
  req.ip)`. `checkUserBans` has no `catch` — it is fail-closed BY PROPAGATION,
  and `auth.js` documents that exact consequence in situ: *"a lookup FAILURE
  (fail-closed, rejects into the catch → 401)"*. `syncBannedClaim` is excluded:
  it swallows its own errors by design.

  **Hypothesis 3 (shared-persona contention) is eliminated.** The persona is
  unique per test — the failure snapshot shows `banned-1787319326808-824901`,
  a timestamped id minted by `signInWithStanding`. No other spec can be writing
  to it.

  **Load, not logic.** Reproduction attempts, all against the same live local
  stack (API :3000 and web :8888 both verified serving THIS worktree):

  | Scope | Runs | Result |
  | --- | --- | --- |
  | The single test alone | 1 | passed (1.7s) |
  | The whole spec file (33 tests) | 3 | passed, passed, passed (~60s each) |
  | The full chromium suite (~1450) | 1 | **FAILED, twice (initial + retry)** |

  So it needs full-suite load to appear, which fits a transient error from the
  Firestore/Auth emulators under contention far better than it fits anything in
  the ban logic. That also explains the CI pattern: webkit, under a loaded
  runner, then green on a plain re-run.

### The product defect this exposes, which outranks the flaky test

The `catch` collapses *every* failure in that block into
`401 {"error":"Authentication failed"}`. Two very different conditions are
being given the same answer:

- **the credential is bad** — 401 is right, and the client should re-authenticate;
- **a ban/suspension LOOKUP failed** — the credential was fine and was never
  judged. This is a server-side fault, and answering 401 tells the client the
  session is invalid.

Clients treat 401 as "signed out". So a transient Firestore blip in production
does not merely refuse one request — it tells every affected client their
session died. Fail-CLOSED is correct (never wave a possibly-banned caller
through); fail-closed *labelled as a credential failure* is not.

This is the same silent-failure shape as
[[feedback-silent-guards-and-stringly-typed-contracts]]: one catch, one string,
several causes.

**Direction (not yet implemented):** separate the two in both `authMiddleware`
and `authMiddlewareStrict` — token-verification errors stay 401; a
standing-lookup failure answers a distinct retryable status with its own code
and log line. That makes the next occurrence self-diagnosing (the Observability
AC above) instead of needing a trace dig like this one, and it stops a
Firestore blip from reading as a mass sign-out. Whether the lookup should also
get a bounded retry is a separate decision to take with the operator, because
it trades a slower refusal against a spurious one.

**Scope note.** Left unfixed in this session's merge queue on purpose: the fix
changes authenticated-request behaviour for every route, so it belongs in its
own PR with its own tests, not folded into an iOS-signing bug branch.

### What shipped in this PR, and what deliberately did not

**Shipped — the refusal now names itself.** `authMiddleware` and
`authMiddlewareStrict` each had ONE `try` wrapping the credential check *and*
every standing lookup, and ONE `catch` answering
`401 {"error":"Authentication failed"}` for all of it. The credential check is
now separated from what follows it, and the body carries a `code`:

| Condition | Status | `code` |
| --- | --- | --- |
| `verifyIdToken` rejected the token (expired, malformed, revoked under strict) | 401 | `token_rejected` |
| Token accepted; identity/suspension/ban lookup could not complete | 401 | `standing_unavailable` |

The log lines diverge too — `token rejected` vs `standing lookup failed`, the
latter carrying `req.path`.

**The status code is UNCHANGED, on purpose.** 401 for a failed lookup is not an
accident: `tests/unit/auth-ban-gate-posture.unit.test.js` pins it, simulating
`firestore unavailable` and asserting `401 Authentication failed`. It is a
decision someone took. This PR does not overturn it, because doing so silently
would change what every client concludes when a request is refused.

**The decision left for the operator.** A 401 tells a client *"your credential
is bad"*, and clients respond by signing the user out or forcing a refresh. But
in the `standing_unavailable` case the credential was fine and was never
judged — the server simply could not reach Firestore. So a transient Firestore
blip does not merely refuse requests; it can read to every affected client as a
mass sign-out. A retryable status (503) would say what actually happened and
let clients back off instead of dropping the session. Against that: it changes a
pinned security posture, every client's handling, and the shape of a control
that is currently, correctly, fail-closed. Fail-closed must survive either way —
only the label is in question. Raised rather than taken.

**Still open: WHICH call throws.** Four candidates sit inside that block —
`verifyIdToken`, `resolveUniqueId`, `checkSuspension`, `checkUserBans`. Today's
evidence narrows the failure to the block, not to a line. `token_rejected` vs
`standing_unavailable` is exactly the instrument that separates the first from
the other three on the next occurrence; the story's own Risk section already
named instrumentation as the honest fallback to guessing. This PR builds the
instrument. It does not claim the diagnosis.

**So this PR does not close the story.** The AC "20 consecutive runs green"
is untouched: if a lookup genuinely fails under load, the test still fails —
it now just says why. Closing it needs the next occurrence's `code`, and then
either a bounded retry on a transient read or the status decision above.

### Test coverage added

| Test | Proves | Doubles? |
| --- | --- | --- |
| `auth-ban-gate-posture.unit.test.js` — `a rejected TOKEN is named token_rejected` (both middlewares) | A bad credential is named, and NO standing lookup is attempted after it | unit-exception doubles |
| same file — `a failed standing LOOKUP is named standing_unavailable` (both middlewares) | An accepted credential whose lookup failed is named differently | unit-exception doubles |
| `auth-ban-gate.test.js` — bindings beyond the scannable window | The same `standing_unavailable` from a **real** Firestore read that cannot complete | none — real emulator |
| `suggestions-security.spec.ts:218` | On 401 the failure states that the ban check never ran, and which class of refusal occurred | none — real stack |

Both middlewares are covered for both codes: the two `catch` blocks were byte
identical, which is precisely how one of them would have been left behind.
