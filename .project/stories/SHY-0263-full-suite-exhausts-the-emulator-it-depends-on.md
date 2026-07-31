---
id: SHY-0263
status: Draft
owner: claude
created: 2026-07-31
priority: P1
effort: M
type: infra
roadmap_ids: []
---

# SHY-0263: The full test suite exhausts the emulator it runs against, so a green run cannot be trusted

## User Story

**As a** developer relying on the test suite to tell me whether the product works
**I want** a full run to give the same verdict every time
**So that** "the suite is green" means the code is sound, rather than meaning the
emulator happened to still be healthy when the run finished.

## Why

Observed three times on 2026-07-31 in a single session. A full `npm test` run
starts clean and degrades as it proceeds, until suites begin failing for reasons
that have nothing to do with the code under test:

```
{"error":{"code":500,"status":"UNKNOWN"}}
  at loadFirestoreRules (@firebase/rules-unit-testing/src/impl/rules.ts:63:11)
```

Every failure of this shape is emulator exhaustion, not a rules regression. It is
confirmed each time by restarting the stack and re-running, with no code change:

| Run | Result |
| --- | --- |
| Full suite, degraded emulator | 4 suites failed, 108 tests failed |
| Restart stack, same commit | **428/428 suites, 13,924 passed, 0 failed** |
| Full suite, degraded again | 2 suites failed, 9 tests failed |

The second-order symptom is worse than the failures, because it is quieter:
**runtime inflates without failing**. In the degraded run,
`tests/scripts/sync-stories-to-issues.test.js` took **3,922 seconds** for a
`--dry-run` that normally completes in seconds, and
`journey-moderation-seed-givens` took 386s. A run that would previously finish in
~275s exceeded a 2,400s timeout. So the failure mode is not only "some tests go
red", it is "the suite becomes too slow to finish", which reads as a hung machine
rather than a diagnosable defect.

**Why this is a real bug and not just an annoyance.** The suite is the mechanism
by which every other defect is caught. If its verdict depends on how much history
the emulator has accumulated, then a green run is evidence about the emulator's
age, not about the code — and the natural workaround (restart and re-run until
green) is indistinguishable from retrying until a flake passes, which is exactly
what the project's no-auto-retry rule forbids.

**Root cause (established, not guessed).** `@firebase/rules-unit-testing`
`initializeTestEnvironment` calls `loadFirestoreRules` for a project id, and every
rules suite uses a distinct per-worker project id
(`demo-shytalk-<name>-${JEST_WORKER_ID}`). A long-lived emulator accumulates these
across runs, and past a threshold it starts refusing NEW project ids with an
opaque 500 while continuing to serve the ones it already knows. The discriminator
that proves it: suites whose project id already existed keep passing, while any
suite needing a new one fails — and the emulator's own health endpoints keep
returning 200 throughout. Health is not the same as capacity.

## Acceptance Criteria

### Happy path

- [ ] A full `npm test` run produces the same pass/fail verdict on a freshly
      started stack and on a stack that has already served several full runs.
- [ ] Total wall-clock for a full run stays within a stated budget across
      consecutive runs (no unbounded inflation).

### Error paths

- [ ] When the emulator IS exhausted, the suite says so explicitly —
      `loadFirestoreRules 500 UNKNOWN` is reported as "emulator capacity, restart
      the stack", not as an ordinary assertion failure.
- [ ] The guidance is emitted once per run, not once per failing test.

### Edge cases

- [ ] A suite that creates a brand-new project id still works after many prior
      runs, or fails with the explicit capacity message.
- [ ] Parallel Jest workers do not multiply project-id creation beyond what one
      run needs.

### Performance

- [ ] Consecutive full runs do not inflate: the third run's duration is within a
      stated tolerance of the first's.
- [ ] No suite silently grows its runtime by an order of magnitude between runs.

### Security

- N/A — test infrastructure only; no product surface, no user data, no
  authorisation decision changes.

### UX

- [ ] A developer hitting this sees an actionable message instead of an opaque
      500 and a hung run.

### i18n

- N/A — developer-facing tooling, no user-facing strings.

### Observability

- [ ] A run records how many distinct project ids it created.
- [ ] The capacity failure is distinguishable in CI logs from a genuine rules
      regression, so a red build is triaged correctly first time.

## BDD Scenarios

**Scenario: the same code gives the same answer twice**

- **Given** a full test run has already completed against a running emulator
- **When** the same tests are run again without restarting anything
- **Then** the result is the same as the first run

**Scenario: the emulator runs out of capacity**

- **Given** an emulator that can no longer accept new test projects
- **When** the suite runs
- **Then** it reports that the emulator needs restarting
- **And** it does not present the problem as a failure of the code being tested

**Scenario: a run does not quietly become slower**

- **Given** several consecutive full runs against the same emulator
- **When** the last run finishes
- **Then** it took about as long as the first one

## Test Plan

**Red first:**

- A meta-test that creates N distinct rules-test project ids in one process and
  asserts the Nth still initialises, with N above the count a full suite uses.
  This fails today on a well-used emulator, which is the point.
- A guard asserting the capacity failure is classified: given a simulated
  `loadFirestoreRules` 500, the harness reports "emulator capacity" rather than
  letting the raw error surface as an assertion failure.

**Green — candidate approaches, to be chosen during implementation:**

1. **Reuse project ids.** Derive them from a stable name rather than accumulating
   fresh ones (per-worker suffix only), so the population is bounded by worker
   count instead of growing with history. Smallest change; needs care that suites
   sharing an id do not leak state into each other.
2. **Clear between runs.** Have the harness clear rules-test projects on start.
3. **Recycle the emulator mid-run** when the count crosses a threshold.

(1) is the recommendation: it removes the growth rather than compensating for it,
and it is the only option that also fixes the runtime inflation.

**Verification:** three consecutive full runs on one emulator, comparing verdict
and duration; plus the existing suites staying green.

## Out of Scope

- The `journey-moderation-seed-givens` audit-log-floor assertion and the
  `sync-stories-to-issues` dry-run timing. Both are symptoms observed under a
  degraded emulator; if either still fails on a healthy stack after this lands, it
  gets its own ticket rather than being folded in here.
- Rewriting rules tests to avoid `@firebase/rules-unit-testing`.
- CI runner sizing. CI starts a fresh emulator per job and does not exhibit this;
  the problem is specific to a long-lived local stack.

## Dependencies

- None. Self-contained in the test harness and the emulator lifecycle scripts.

## Risks & Mitigations

- **Risk:** reusing project ids lets one suite see another's data, converting a
  capacity bug into a much subtler isolation bug.
  **Mitigation:** keep the per-worker suffix, clear the project between suites
  that share an id, and rely on the existing per-file/per-run prefix convention
  for document ids.
- **Risk:** the threshold at which exhaustion begins is unknown, so a fix could
  appear to work merely by delaying it.
  **Mitigation:** the red test asserts a specific N and the acceptance criteria
  require three consecutive full runs, so "delayed" is distinguishable from
  "fixed".
- **Risk:** this is invisible in CI, so it is easy to under-prioritise while local
  runs quietly become untrustworthy.
  **Mitigation:** recorded here with the measured evidence so the next person does
  not have to rediscover it — as three separate sessions already have.

## Definition of Done

- [ ] Three consecutive full suite runs on one emulator agree on the verdict and
      stay within the duration budget.
- [ ] The capacity failure is explicitly classified and actionable.
- [ ] The existing suites remain green.
- [ ] `code-reviewer` 100% clean.

## Notes

**2026-07-31** — Filed after hitting this three times in one session while
delivering SHY-0261 and SHY-0258. Each time the failures looked like product
regressions and each time a stack restart cleared them with no code change, which
is precisely why it is worth a ticket: the cost is not the lost minutes, it is
that a red suite stops being informative and a green one stops being reassuring.

Prior art in the operator's own notes:
`reference-emulator-degrades-as-test-projects-accumulate` records the same
diagnosis from 2026-07-30 (three rules suites failing 109/109 while others passed
against the same `firestore.rules`). This ticket exists because a remembered
workaround is not a fix.
