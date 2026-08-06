---
id: SHY-0173
status: Draft
owner: claude
created: 2026-07-10
priority: P3
effort: S
type: chore
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0173: The test-isolation analyzer has five places it can still be wrong, none reachable today

## User Story

**As** an engineer relying on the test-isolation guard to tell me the truth,
**I want** its remaining blind spots closed or explicitly pinned by a test,
**So that** the next person to write an unusual line of test code gets a loud failure, not a silent wrong answer.

## Why

SHY-0149 built `express-api/tests/helpers/test-isolation-analyzer.js` to stop test files from wiping emulator state a sibling worker depends on (the defect [[SHY-0171]] described). It is fail-closed by construction: anything it cannot resolve statically is reported, and `tests/unit/test-isolation-guard.unit.test.js` fails on a non-empty report.

Review rounds 15 and 16 traced it exhaustively and found five residual gaps. **Every one was checked against the real corpus and has zero reachable instances today** — which is exactly why they are filed rather than fixed under a story whose subject is ban enforcement. They are recorded here so a future edit cannot quietly make one reachable.

1. **A `db`-alias or non-`db` root evades the check entirely.** `isFirestoreChain` only recognises the identifier `db`. `const store = db; store.collection(X)` would be skipped silently — a false negative, the one direction the guard cannot tolerate. Grepped: no test file aliases the handle or uses `admin.firestore()`.
2. **A chained `.doc()` argument is trusted unconditionally.** `.collection(x).doc('sub/doc2')` is a legal multi-segment relative path that could hide a collection name. Grepped: every chained `.doc()` in the corpus passes a single-segment id.
3. **A double leading slash miscounts segment parity.** `pathIsReadable` strips one leading `/`; `` `//rooms/${id}` `` would shift every slot by one. Such a path throws at runtime, so no working test can contain it.
4. **An identifier-to-identifier alias is not followed.** `const B = A; db.doc(B)` reports unresolved even when `A` is a plain string constant. Over-reporting — the safe direction — but noisy if it ever occurs.
5. **`everyCallSitePassesAReadablePath` matches call sites by name, ignoring scope.** A same-named local shadowing a path-building helper in one file would produce a spurious "not all call sites readable". Grepped: the only such helper (`seed` in `tests/cron/testDataCleanup.test.js`) has no shadow.

Separately, three behaviours are correct but **untested**, so a regression in them would go unnoticed: a mutual two-constant cycle (`A` → `B` → `A`); an object-method / class-method / anonymous-callback parameter reporting rather than being trusted (`functionName` returns `null`, the caller reports — verified by hand, pinned by nothing); and a non-`db` root being skipped.

Not a production defect. This is test-infrastructure correctness, and the cost of leaving it is that a future contributor's unusual line silently disables a guard everyone trusts.

## Acceptance Criteria

### Happy path
- [ ] The guard still reports zero unresolved wipes, zero unresolved segments among emulator suites, and zero collisions across the whole corpus.
- [ ] The full Express suite passes with no wall-clock regression beyond ~5% (the analyzer runs once per test file, at module load).

### Error paths
- [ ] Each of the five gaps above either resolves correctly or is REPORTED. None returns silently.
- [ ] Gap 1 specifically: a Firestore handle bound to any local identifier is followed, or its use is reported.

### Edge cases
- [ ] `` `//rooms/${id}` `` and other malformed paths report rather than miscount.
- [ ] A mutual constant cycle terminates and reports.
- [ ] A parameter of an object method, a class method, and an anonymous inline callback each report rather than being trusted.

### Performance
- [ ] No measurable slowdown of `tests/unit/test-isolation-guard.unit.test.js` (it parses ~375 files).

### Security
- N/A — test-infrastructure change; no production surface.

### UX
- N/A — no user-facing surface.

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] Every new report names the file, the offending expression, and why it could not be read — matching the existing message style.

## BDD Scenarios

**Scenario: someone gives the database handle a different name**
- **Given** a test file that refers to the database by a new name of its own
- **And** it clears out or reads a shared area of data through that name
- **When** the test suite runs
- **Then** the guard either understands the new name, or stops and says it cannot

**Scenario: a test writes a path the guard has never seen before**
- **Given** a test file that builds a data location in an unusual way
- **When** the test suite runs
- **Then** the guard refuses to guess, and names the file and the line

## Test Plan

Touches `express-api/tests/**` only → no product runtime surface; the device/browser gauntlet does not apply.

**Red → Green:** for each of the five gaps and three untested behaviours, add a failing unit test to `tests/unit/test-isolation-guard.unit.test.js` FIRST (the fixture shapes are already written out in the Why section above), watch it fail, then fix `test-isolation-analyzer.js`. Mutation-verify each: revert the fix, watch that test go red. Re-run the corpus assertions — they must stay at zero, and any new report must be resolved for real (make the code readable), never by narrowing the check.

**Static/quality:** `npm run lint` 0 warnings; prettier clean. Verify with `grep -E "error|warning|problem"`, never a `tail` window — see [[feedback-playwright-honest-verification]].

## Out of Scope
- The shared MinIO/Mailpit isolation — [[SHY-0172]].
- Any production code change.

## Dependencies
- `express-api/tests/helpers/test-isolation-analyzer.js`, `tests/unit/test-isolation-guard.unit.test.js` (both delivered by SHY-0149).

## Risks & Mitigations
- **Risk:** widening the check surfaces real unreadable paths and the temptation is to narrow it back. **Mitigation:** the AC forbids that explicitly; SHY-0149 hit this twice and both times the widening was right.
- **Risk:** following aliases turns the analyzer into a general dataflow engine. **Mitigation:** follow only direct `const x = db` bindings; report anything else.

## Definition of Done
- [ ] All five gaps closed or reported; all three untested behaviours pinned; each mutation-verified.
- [ ] Corpus assertions still zero. `code-reviewer` 100% clean → In Review → CI green by name → merge → `released_in:` on the next cut.

## Notes (running log)

- 2026-07-10 — **CREATED fully-refined** from SHY-0149's round-15 and round-16 reviews. Both reviewers traced the analyzer by hand and by corpus grep, confirmed each gap has **zero reachable instances today**, and classified them as follow-up material rather than merge blockers — a judgement this story records rather than relitigates. The analyzer's governing rule, and the reason these are worth closing at all, is [[feedback-detector-must-report-not-guess]]: a detector that quietly sees nothing is worse than none, because it launders absence of evidence into evidence of absence. Twice during SHY-0149 a widening of this same check turned a reviewer's hypothetical into a live finding (`clearCollection(db, SEG_EVENTS)` invisible to the wipe side; `SAFETY_AUDIT_COLLECTION` imported and invisible to the victim side), so "no reachable instance today" is a reason to defer, never to dismiss.
