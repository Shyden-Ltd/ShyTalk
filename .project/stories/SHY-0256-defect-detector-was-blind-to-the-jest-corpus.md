---
id: SHY-0256
status: In Progress
owner: claude
created: 2026-07-30
priority: P1
effort: L
type: bug
roadmap_ids: []
epic: EPIC-0003
---

# SHY-0256: The silently-passing-test detector was blind to the entire Jest corpus

## User Story

**As a** developer relying on the test-defect gate to tell me the suite is honest
**I want** the detector to inspect every test corpus, not just the top level of one
**So that** "0 silently-passing tests" means the suite proves something, rather than meaning the detector was not looking.

## Why

Found 2026-07-30 while filling gaps after the SHY-0245 sweep drove the web
corpus to 0.

`scripts/check-test-defects.js` scanned exactly one thing:

```js
const TESTS_DIR = path.join(REPO, 'tests', 'web');
for (const file of fs.readdirSync(TESTS_DIR).filter((f) => f.endsWith('.ts'))) {
```

`readdirSync` is not recursive and the filter is `.ts`-only, so the gate never
saw:

- **419 Jest suites** (`express-api/tests/**/*.test.js`) — 13,797 tests
- **11 files** in `tests/web` subdirectories

The gauntlet launcher refuses to start while this detector reports anything, so
"the defect gate PASSED" was a statement about 109 files out of 539.

Widened, it reports **94 real defects** in the Jest corpus, concentrated in the
suggestions and identity-graph suites — the same shape as SHY-0249, where a
whole "Reports & Evidence" panel stayed unbuilt for months behind green tests.
Representative findings, each verified by reading the source:

```js
// suggestions-integration-a-flows.test.js — passes when there is NO ETag header
test('GET /api/suggestions returns ETag header', async () => {
  const res = await request(createApp()).get('/api/suggestions');
  if (res.status === 200 && res.headers.etag) {
    expect(typeof res.headers.etag).toBe('string');
  }
});

// identity-graph-write-lifecycle.test.js — an empty body
test('second login from new IP: new IP added to graph', async () => {
  mockDocGet.mockImplementation(/* … */);
  // After second login, graph should have 2 IPs
});
```

A second gap made this worse: **the detector was never wired into CI**. It ran
only from the gauntlet launcher, so the ratchet it defines was not enforced on
any pull request.

## Acceptance Criteria

### Happy path

- [ ] The detector scans every test corpus recursively: `tests/web/**/*.ts` and `express-api/tests/**/*.test.js`.
- [ ] A Jest test with an empty body is reported NO-ASSERT.
- [ ] A Jest test whose every assertion sits behind a conditional is reported GUARD-IF.
- [ ] The ratchet runs in CI on every pull request.
- [ ] All 94 reported defects are driven to 0 — each either asserts for real, or the feature it describes is implemented and then asserted.

### Error paths

- [ ] A test file the detector cannot parse is reported PARSE-FAIL, never silently skipped — a file it cannot read is a file it cannot vouch for.
- [ ] A missing `acorn` fails with an actionable sentence, not a stack trace.

### Edge cases

- [ ] `BARE-EXPECT` is applied only to the Playwright corpus: Jest has no retrying matcher, so `expect(await x)` is the normal shape there and flagging it would bury the real findings.
- [ ] A test with one unconditional assertion plus several conditional ones is clean — conditional assertions are a defect only when they are the only coverage.
- [ ] These real idioms are NOT reported: supertest `.expect(200)`; `try { …; throw } catch { expect… }`; assertions delegated to same-file helpers (transitively); a guarded `expect` whose fall-through path throws.
- [ ] A `test.skip(...)` written inside a string literal (a fixture) is not counted as a parked test.
- [ ] A parked test is reported once, not also as NO-ASSERT.

### Performance

- [ ] A full scan of all 539 files completes in seconds — it runs on every gauntlet launch and every PR.

### Security

- [ ] N/A — a read-only static analysis over files already in the repo; no network, no credentials, no execution of the code it reads.

### UX

- [ ] `--list` groups findings by category so a reader can see whether the debt is empty bodies or guarded assertions without opening files.

### i18n

- [ ] N/A — a developer-facing CI tool with no user-visible strings.

### Observability

- [ ] The baseline records `detectorWidened` with the reason whenever a widening raises the count, so a rise is never confused with a regression.

## BDD Scenarios

**Scenario: the gate stops lying about its coverage**
- **Given** a Jest test with an empty body
- **When** the detector runs
- **Then** it is reported, instead of being invisible because only one directory was scanned

**Scenario: a test named after a header that never checks for it**
- **Given** a test called "returns ETag header" whose only assertion is behind `if (res.headers.etag)`
- **When** the detector runs
- **Then** it is reported as an assertion that may never execute

**Scenario: a genuinely asserting test is left alone**
- **Given** a route test that asserts only via supertest's `.expect(200)`
- **When** the detector runs
- **Then** it is not reported, because that is a real assertion

**Scenario: the detector cannot read a file**
- **Given** a test file that does not parse
- **When** the detector runs
- **Then** it reports the file as unverifiable rather than passing over it in silence

**Scenario: the ratchet is enforced on a pull request**
- **Given** a pull request that adds a test with no assertions
- **When** CI runs
- **Then** the lint job fails on the count rising above the baseline

## Test Plan

**RED first** — `express-api/tests/scripts/check-test-defects.test.js` (new;
drives the real detector against real source strings, no doubles):

- true positives: empty body; setup-only body; assertion behind a status check;
  nested guards; assertion only in a ternary; assertion only behind `&&`
- true negatives: plain `expect`; one unconditional assertion alongside guarded
  ones; supertest `.expect(200)`; `assertSucceeds`/`assertFails`; the
  try/throw/catch must-throw idiom; a guarded expect with a throwing
  fall-through; a same-file helper; a helper calling a helper
- parser correctness: `/^[a-z]/.test(name)` is not a test declaration; prose in
  a block comment is not code; `}` inside a regex literal does not truncate a
  body; a brace inside a string does not either; an unparseable file reports
  PARSE-FAIL
- skip classification: PARKED vs SKIP-COND vs neither; a parked test is not
  double-reported

Plus the existing lint.yml pin tests must stay green with the new CI step.

**GREEN:** recursive multi-corpus walk; acorn AST analysis for the Jest corpus;
per-corpus category sets; CI wiring in `lint.yml`.

**Mutation checks:** removing the lookbehind from `TEST_START_RE` must fail the
regex-predicate test; removing block-comment stripping must fail the prose test;
dropping supertest `.expect` from the assertion vocabulary must fail its test;
treating `for`/`while` as conditional must fail the loop-over-fixtures cases.

## Out of Scope

- Kotlin (`androidTest`, `commonTest`) and iOS (XCTest) corpora — same defect
  class, different parsers; each needs its own pass.
- An assertion inside a loop over a collection that can legitimately be empty —
  a real but narrower defect, deliberately excluded here because treating every
  loop body as a silent skip would drown the findings this pass surfaced.
- Assertions delegated to helpers **imported from another file** — same-file
  resolution only.

## Dependencies

- `acorn` promoted from a transitive dependency of eslint to an explicit
  `devDependency` of `express-api`. Depending on a transitive package is exactly
  the fragility this detector exists to prevent elsewhere.

## Risks & Mitigations

- **Risk:** false positives make the gate untrustworthy and train everyone to
  raise the baseline.
  **Mitigation:** four distinct false-positive classes were found and fixed
  before shipping, and every one is pinned by a test. The count fell 563 → 94
  as the classifier learned this codebase's real idioms.
- **Risk:** the 94 findings block the next gauntlet launch (the launcher refuses
  above zero).
  **Mitigation:** intended. That refusal is the rule the operator set; the debt
  is driven to 0 rather than the gate being weakened.
- **Risk:** a widened detector is used as cover for a genuine regression.
  **Mitigation:** `--update-baseline` refuses a rise without an explicit
  `--detector-widened=<reason>`, which is recorded in the baseline file.

## Definition of Done

- [ ] RED tests written first and observed failing.
- [ ] Detector scans both corpora recursively.
- [ ] CI runs the ratchet on every PR.
- [ ] Mutations killed.
- [ ] All 94 findings resolved and the baseline at 0.
- [ ] `cd express-api && npm test` green.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-30 — The detector had no tests of its own and was not in CI. Both were
  fixed here: a gate whose correctness nothing verifies is the same failure mode
  it exists to catch, and it had shipped four classes of false positive before
  anyone read what it was reporting.
- 2026-07-30 — Baseline set to 94 with `detectorWidened` recorded. The 94 are
  pre-existing debt that was always there and simply invisible; none of it is a
  regression introduced by this change.
