---
id: SHY-0112
status: Draft
owner: claude
created: 2026-06-17
priority: P0
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0112: Keystone — codify the "doubles only in unit tests" policy + make the no-new-stubs ratchet policy-aware + define the unit↔integration boundary (EPIC-0003)

## User Story

**As** the team executing EPIC-0003's "no more faking" migration,
**I want** the hardened policy (test doubles permitted **only in unit tests**, every other layer real-only) codified in `CLAUDE.md`, the `check-no-new-stubs.js` ratchet widened to catch the blind-spot double-patterns it currently misses **and** made aware of the unit↔integration boundary, plus that boundary defined as an explicit, greppable convention,
**So that** no new fake can accrue in an integration/journey/e2e/device test while the migration is in flight, and every later child SHY has one unambiguous rule for "is a double allowed here?" before a single test is migrated.

## Why

This is the **keystone** — it lands FIRST so the debt cannot regrow mid-migration ([[feedback-no-stubs-mocks-fakes-real-only]]). Two gaps make it necessary:

1. **The policy text is stale.** `CLAUDE.md` §No-Stubs (operator 2026-06-13) bans doubles *everywhere*; the operator hardened it 2026-06-17 to "the only thing I will allow fakes or mocks is the **unit tests**". The codified rule must match the governing rule, classified by what a test *exercises* (real collaborator → integration → real; pure isolated logic → unit → double allowed).
2. **The ratchet has blind spots.** `check-no-new-stubs.js` (SHY-0108) only catches `jest.mock(` / `Fake*Repository` / `page.route(`. The 2026-06-17 sweep found the doubles that actually dominate the debt slip straight through: **227** `jest.fn()` collaborator doubles, **319** hand-rolled-fake call-sites (`makeStatefulFakeDb` in 18 files), **202** `mockResolvedValue/Return/Implementation`, **51** Kotlin `mockk`/`Mockito`, and the 3 iOS doubles — all invisible to the guard. A guard that misses the majority pattern cannot hold the line.

Until those two are fixed, "no more faking" is unenforced and the boundary is undefined — so every migration SHY would re-litigate "is this allowed?". The keystone removes that ambiguity once.

## Acceptance Criteria

### Happy path
- [ ] `CLAUDE.md` §"No Stubs / Mocks / Fakes — Real Only" is amended so the rule reads exactly: **test doubles (mock/fake/stub/spy/fetch-mock/hand-rolled fake) are permitted ONLY in unit tests** (pure isolated logic with no real collaborator); **integration, journey-runner, e2e and device layers are real-only**. Classification is **by what the test exercises** (touches Firestore/Auth/Express API/LiveKit/repository/network → integration → real). The existing escape-hatch + big-bang-migration paragraphs are preserved.
- [ ] `scripts/check-no-new-stubs.js` `CATEGORIES` is extended with the blind-spot detectors — at minimum: `jest.fn(` collaborator doubles, hand-rolled fakes (`makeStatefulFakeDb` / `make*Fake*` factories), `mockResolvedValue|mockReturnValue|mockImplementation`, Kotlin `mockk(`/`Mockito.`/`@Mock`, and the iOS double markers — each a labelled `{key,label,regex}` entry, bucketable per file.
- [ ] The ratchet is **policy-aware**: an offending double in a recognised **unit-test location** is NOT counted as an offender; the same pattern anywhere else IS. The baseline (`no-stubs-baseline.json`) is regenerated (`--generate-baseline`) so the widened scan starts green (exit 0) with the new, larger tolerated set, and can only shrink thereafter.
- [ ] The unit↔integration boundary convention is **defined and documented** (in `CLAUDE.md` + the EPIC): unit tests live at `**/tests/unit/**` or are named `*.unit.test.js`/`*.unit.test.ts` (JS) and `src/test/**` non-instrumented (Kotlin); everything else is integration/real-only. The ratchet reads this exact convention.

### Error paths
- [ ] A NEW double introduced in an integration-layer file (e.g. a `jest.fn()` added to a `tests/cron/*.test.js`) makes `node scripts/check-no-new-stubs.js` exit **1** with a NEW-offender line naming the file + category (proven by a guard test).
- [ ] A STALE baseline entry (a path that no longer offends after migration) still makes the guard exit **1**, forcing the baseline to shrink (existing behaviour retained under the widened categories — proven by a guard test).
- [ ] A double placed in a unit-test location (`tests/unit/x.unit.test.js`) does **not** trip the guard (exit 0) — the boundary is honoured, not just the pattern.

### Edge cases
- [ ] A `.kt` comment or string literal merely *mentioning* `mockk`/`page.route` in a non-test file is bucketed/handled the same controlled way SHY-0108 already handles cross-language false positives (the guard's own source + test are self-excluded); no false NEW offender from prose.
- [ ] A file matching MULTIPLE new categories is reported once per category, deduped + sorted (mirrors the existing `EMPTY()`/dedupe contract).
- [ ] Boundary precedence is exact: `tests/unit/foo.test.js` (dir-based unit) and `bar.unit.test.js` (suffix-based unit) are both unit; `tests/unit-helpers/baz.test.js` (substring, not the convention) is NOT unit and is scanned.

### Performance
- [ ] The widened scan still runs over `git ls-files` content in one pass (no per-file shell-out beyond the existing single `git ls-files -z`); completes in a few seconds on the full tree; no regex catastrophic-backtracking on large generated files (anchored, bounded patterns).

### Security
- [ ] No secrets/credentials introduced; the guard reads only tracked source text. No network. Baseline JSON contains only repo-relative paths (no content).

### UX
- [ ] N/A — developer-tooling + policy doc; the "consumer" is the contributor/CI, served by clear NEW/STALE messages naming file + category + the one-line remediation ("migrate to the real local stack, or move to a unit-test location if it is genuinely a unit test").

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The guard's summary prints per-category offender counts (baseline vs current) so CI logs show the debt shrinking; `--generate-baseline` prints what it wrote.

## BDD Scenarios

**Scenario: a new fake in an integration test is blocked**
- **Given** the widened, policy-aware ratchet + a regenerated green baseline
- **When** a contributor adds `jest.fn()` standing in for Firestore to `express-api/tests/cron/foo.test.js` (an integration location) and runs `node scripts/check-no-new-stubs.js`
- **Then** the guard exits 1 and names `tests/cron/foo.test.js` under the `jest.fn(` category as a NEW offender

**Scenario: a double in a real unit test is allowed**
- **Given** the same guard
- **When** a contributor adds the identical `jest.fn()` to `express-api/tests/unit/pure-formatter.unit.test.js`
- **Then** the guard exits 0 — the unit-test location is permitted by policy

**Scenario: migrating a file forces the baseline to shrink**
- **Given** `makeStatefulFakeDb` is in the baseline for `manual-qa-runner.test.js`
- **When** that file is migrated to the real emulator and the fake removed, but the baseline still lists it
- **Then** the guard exits 1 with a STALE entry until `--generate-baseline` is re-run

**Scenario: the policy doc matches the governing rule**
- **Given** `CLAUDE.md` §No-Stubs after this change
- **When** a reader checks "where may I use a mock?"
- **Then** the only permitted answer is "a genuine unit test (pure logic, no real collaborator), in a unit-test location" — everything else is real-only

## Test Plan

**RED (before the change):**
- New guard tests in `scripts/check-no-new-stubs.test.js` (or the express test mirror): (a) a fixture integration file containing each NEW category pattern is reported as a NEW offender → currently fails (categories don't exist); (b) the same pattern in a `*.unit.test.js`/`tests/unit/` fixture is NOT reported → currently fails (no boundary awareness).
- A `CLAUDE.md` assertion test (mirrors the existing pin-style doc guards) asserting the §No-Stubs section contains the "only in unit tests" clause + the boundary convention → fails until the doc is amended.

**GREEN:**
- Extend `CATEGORIES` with the blind-spot detectors; add the unit-location predicate + wire it into `scanRepo`/offender bucketing.
- Amend `CLAUDE.md` §No-Stubs (unit-only rule + boundary convention) + add the convention paragraph to `EPIC-0003`.
- `node scripts/check-no-new-stubs.js --generate-baseline` → commit the regenerated `no-stubs-baseline.json`; confirm a clean run exits 0.
- Full canonical `cd express-api && npm test` green (the guard's own tests + 0 regressions); eslint/prettier/actionlint clean.

**Frameworks:** Node guard tests (Jest), the SHY frontmatter validator, eslint/prettier. **Real backend:** none required (the guard is pure static analysis over tracked source — this *is* a unit-appropriate tool). **Gauntlet exemption:** tooling + policy doc only; no app/web/device surface → authoritative proof = CI-green + a clean local `check-no-new-stubs.js` run.

## Out of Scope
- Actually migrating any faked test to real services (that is every subsequent EPIC-0003 child SHY; this only defines + enforces the rule).
- Per-jest-worker emulator isolation (SHY-0109 scaling item).
- Deleting the existing baseline entries (they shrink as each migration SHY lands; this only *widens + regenerates* it).
- Re-classifying the ~28 genuine unit files into the new locations en masse (each migration SHY moves its own unit files as it touches them; a bulk move is a separate cleanup if wanted).

## Dependencies
- **SHY-0108** (`story/SHY-0108-no-new-stubs-ratchet-guard`, commit `2aeafb48f15`, NOT yet merged) — provides the base `check-no-new-stubs.js` + baseline + CI/pre-push wiring this SHY extends. **SHY-0108 must land first**; if it is still unmerged at pickup, this SHY absorbs landing it (then extends in the same or a stacked PR).
- `CLAUDE.md` §No-Stubs (operator 2026-06-13) — the section amended here.
- `EPIC-0003-operational-test-matrix.md` — the convention paragraph is added there too.

## Risks & Mitigations
- **Risk:** widened patterns produce many false positives in non-test code (e.g. a real `something.mockImplementation`-shaped product API). **Mitigation:** scope the new categories to test-file extensions/paths where possible + self-exclude as SHY-0108 does; the regenerated baseline absorbs any genuine pre-existing matches so the team starts green and triages STALE entries as migrations land.
- **Risk:** the unit↔integration boundary is gamed (a real integration test renamed `*.unit.test.js` to dodge the guard). **Mitigation:** the convention is documented as "by what it exercises, not by its name"; `code-reviewer` + the per-SHY Test Plan ("names the REAL backend each test runs against") catch a mislabelled integration test; the guard is a backstop, not the sole gate.
- **Risk:** regex catastrophic backtracking on large files. **Mitigation:** anchored, bounded, linear patterns; a perf assertion in the guard test against a large synthetic input.

## Definition of Done
- `CLAUDE.md` §No-Stubs reads "doubles only in unit tests" + documents the boundary convention; `EPIC-0003` carries the same convention paragraph.
- `check-no-new-stubs.js` detects all blind-spot categories + honours the unit-test-location boundary; `no-stubs-baseline.json` regenerated; clean run exits 0.
- New guard tests cover every new category + the boundary (NEW/STALE/allowed-in-unit); canonical `npm test` fully green; eslint/prettier/actionlint clean.
- `code-reviewer` zero findings on the local commit before push.
- Pushed; CI required checks green by name (Detect Changes, Analyze JavaScript, PR Gate) + Test Backend.
- Judgment-merge (CI-green gate). Story → In Review → Done on next release cut.

## Notes (running log)
- **2026-06-17 — created Draft (the EPIC-0003 keystone).** First of the prioritised "no more faking" child SHYs; lands before any migration so new fakes cannot accrue. Grounded in the real ratchet structure (`CATEGORIES`/baseline/`--generate-baseline`, exit 0/1/2) on `story/SHY-0108-no-new-stubs-ratchet-guard@2aeafb48f15` and the existing `CLAUDE.md` §No-Stubs. Boundary convention chosen as `tests/unit/**` + `*.unit.test.js` (greppable, ratchet-friendly); finalised at implementation.
