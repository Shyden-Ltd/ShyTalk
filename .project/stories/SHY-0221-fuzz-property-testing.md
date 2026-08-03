---
id: SHY-0221
status: Draft
owner: claude
created: 2026-07-19
priority: P0
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0221: Fuzz & property-based testing — API inputs + critical parsers/predicates

## User Story

As the ShyTalk operator, I want fuzz testing of the API's inputs and property-based testing of the critical parsers and security predicates (ban-active, age boundary, expiry comparison), so that no crafted or malformed input can crash the server or silently flip a safety decision — because example-based tests only check the cases we thought of, and the dangerous inputs are the ones we didn't.

## Why

The audit listed **fuzz/property testing** as a candidate gap (operator: "anything else you can think of"). It targets a real, known failure class in this codebase: the ban-expiry predicate compares ISO timestamps **by codepoint**, so a corrupt `expiresAt` could silently retire a ban unless the predicate fails closed (the SHY-0149 lesson; [[feedback-firestore-tx-query-widens-conflict-set]]). Example tests can't cover the input space; property-based testing asserts **invariants over thousands of generated inputs**, and fuzzing asserts the API **never crashes on malformed input** (a clean 400, never a 500). Both run against the REAL logic/API (per EPIC-0003), register into SHY-0212's runner, and harden the safety- and availability-critical paths.

## Acceptance Criteria

### Happy path

- [ ] **Property-based (critical predicates/parsers):** `fast-check` (JS) property tests over the safety-critical pure functions — `isBanActive()`/ban-expiry comparison, age-boundary/cohort computation, any date/ISO parsing, input normalizers — asserting invariants (e.g. "an unparseable expiry NEVER evaluates to not-banned" — fail-closed; "cohort is monotonic in age at the boundary"). Registered `fuzz-property-js` (`host`, `publicArea: Safety`).
- [ ] **Property-based (Kotlin):** kotest-property (or jqwik) property tests over the shared critical logic (auth-guard precedence, cohort/age domain, any shared parser) asserting the same class of invariants. Registered `fuzz-property-kotlin` (`host`, `publicArea: Safety`).
- [ ] **Fuzz (API inputs):** generated adversarial payloads (oversized, wrong-type, injection-shaped, boundary, unicode/emoji, deeply-nested) are sent to the REAL Express endpoints (auth/OTP, rooms, messaging, payments), asserting the server responds with a proper 4xx (never a 5xx/crash/unhandled rejection) and never persists a malformed state. Registered `fuzz-api` (`stack`, `publicArea: Cross-cutting`).
- [ ] All register into `scripts/test/framework-registry.mjs`, emit normalized `metadata.json` (SHY-0212 contract) including the seed used (for reproducibility), and `docs/testing/fuzz-property.md` explains in plain language what "we throw weird inputs at it" proves.
- [ ] Property tests use a **fixed seed in CI** (reproducible) + a documented mechanism to reproduce any counterexample locally.

### Error paths

- [ ] A property violation (e.g. a malformed expiry that makes `isBanActive()` return false) FAILS with the **minimal shrunk counterexample** printed — the exact input that breaks the invariant.
- [ ] A fuzzed payload that yields a 500/crash/unhandled rejection FAILS `fuzz-api` naming the endpoint + the payload (or its seed) — availability + robustness failure.
- [ ] A malformed input that gets *persisted* (bad state written) FAILS — inputs must be rejected at the boundary, not stored.
- [ ] The suites FAIL (not skip) if the target logic/API is unavailable — no false green over a non-running target ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] The fail-closed property is explicit: for every safety predicate, an *unparseable/ambiguous* input must resolve to the SAFE side (banned, gated, denied) — never the permissive side ([[feedback-no-string-ordering-for-security-decisions]], [[feedback-root-cause-not-symptom]]).
- [ ] Unicode/emoji/RTL/zero-width/homoglyph inputs are in the generators (display-name, message, room-name fields) — a normalization or moderation bypass via unicode is caught.
- [ ] Extremely large / deeply-nested JSON is bounded and rejected (no DoS via parse blowup) — the server enforces size/depth limits.
- [ ] A discovered counterexample is added as a permanent regression example test (property finds it once; a named example pins it forever).

### Performance

- [ ] Property runs use a bounded number of cases per CI run (documented) so the gate is fast; a larger exploratory run is on-demand.
- [ ] Fuzz-api runs are time-bounded (registry `timeoutMs`) and rate-aware against the real API ([[feedback-api-rate-limit-awareness]]).
- [ ] Shrinking is enabled so failures report the smallest input, not a giant blob.

### Security

- [ ] Injection-shaped payloads (SQL/NoSQL/script/path) are in the fuzz generators — a payload that reaches an unsafe sink is caught (complements SHY-0217 DAST); all still routed through the real API chokepoint ([[feedback-no-direct-backend-all-via-api]]).
- [ ] Fuzz/counterexample artifacts carry no real PII (generated inputs + seeds only; belt with SHY-0223).
- [ ] The fail-closed invariants directly protect the ban/age/authz decisions — a permissive-on-bad-input regression is a critical finding.

### UX

- [ ] Failure output shows the minimal counterexample + the invariant it broke in plain terms ("this expiry string made a banned user look un-banned"), plus the reproduce seed.
- [ ] `docs/testing/fuzz-property.md` explains property vs fuzz in plain language + the one command each.

### i18n

- [ ] Unicode/locale-diverse input generators exercise the localization/normalization paths (a name/message in any script must not crash or bypass moderation) — i18n is an input dimension here, not N/A.

### Observability

- [ ] Each framework's `metadata.json` records cases-run + seed + any counterexample, feeding a plain-language "handles weird input safely ✓" signal for SHY-0220.
- [ ] Counterexamples + seeds are logged with `[framework:fuzz-property-js|fuzz-property-kotlin|fuzz-api]` for reproduction.

## BDD Scenarios

**Scenario: A malformed expiry cannot un-ban a user (fail-closed)**

- **Given** the ban-active predicate under property testing
- **When** `fast-check` generates thousands of expiry strings including malformed ones
- **Then** no generated input makes a banned user evaluate to not-banned
- **And** any violation fails with the minimal shrunk counterexample

**Scenario: The API never 500s on a fuzzed payload**

- **Given** the real messaging endpoint
- **When** `fuzz-api` sends oversized/wrong-type/injection-shaped payloads
- **Then** each is rejected with a proper 4xx
- **And** no payload causes a 5xx/crash/unhandled rejection or a persisted bad state

**Scenario: A unicode moderation-bypass attempt is caught**

- **Given** a display-name field
- **When** the generator produces homoglyph/zero-width variants of a banned word
- **Then** normalization/moderation still catches it (no bypass)

**Scenario: A found counterexample becomes a permanent regression test**

- **Given** a property run discovers a breaking input
- **When** the fix lands
- **Then** that exact input is pinned as a named example test forever

**Scenario: Ambiguous input resolves to the safe side**

- **Given** an age value at/around the boundary that is ambiguous or unparseable
- **When** the cohort predicate runs under property testing
- **Then** the result is always the safe (gated) side, never permissive

**Scenario: Fuzz verdict reaches the public page**

- **Given** a completed fuzz/property run
- **When** SHY-0220's page reads the `metadata.json`
- **Then** it can show "handles weird input safely ✓"

## Test Plan

**Classification:** property tests are host over REAL pure logic (unit-location, no doubles — they test real functions with generated data). `fuzz-api` is real-only against the REAL running API (`stack`). No mocked endpoints — fuzzing a mock proves nothing.

### Red — write failing tests first

- `express-api/tests/property/ban-active.property.test.js` — `it('an unparseable expiry never yields not-banned')`; prove it FAILS against a naive codepoint-compare predicate, PASSES against the fail-closed one.
- `express-api/tests/property/age-cohort.property.test.js` — boundary/monotonicity invariants.
- `express-api/tests/fuzz/api-inputs.fuzz.test.js` — `it('every endpoint rejects malformed input with 4xx, never 5xx')`, `it('no fuzzed payload is persisted')`, `it('injection-shaped payloads reach no unsafe sink')`.
- Kotlin: `shared/src/.../BanActivePropertyTest.kt`, `CohortPropertyTest.kt`, `AuthGuardPropertyTest.kt` (kotest-property) with fail-closed invariants.
- `it('metadata records seed + cases + counterexample')`, `it('a discovered counterexample is pinned as an example test')`.

### Green — implement

1. Add `fast-check` (JS) + kotest-property/jqwik (Kotlin) + author the property tests over the critical predicates/parsers.
2. Add the API fuzz harness against the real endpoints (bounded, rate-aware, seeded).
3. Register all three; write `docs/testing/fuzz-property.md`.
4. Fix any real fail-open/crash/persist-bad-state defect surfaced at root (fail-closed predicates, boundary validation, size/depth limits) — real product hardening.

### Gauntlet

Touches backend (`express-api/**`) + shared logic (`shared/**`) → FULL Pre-Merge Testing Protocol (backend ⇒ full gauntlet); `fuzz-api` proven against the real local + dev API before merge.

## Out of Scope

- Continuous/long-running coverage-guided fuzzing infrastructure (e.g. a persistent fuzzing service) — bounded seeded runs on PR + on-demand deeper runs; a persistent fuzzer is a possible follow-up.
- Fuzzing the LiveKit media path (SHY-0214 load + SHY-0225 chaos cover voice robustness).
- Property testing every pure function (scope = safety/availability-critical predicates + parsers first).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes a robustness signal to SHY-0220; hardens the same predicates SHY-0216 mutation-tests + SHY-0219 relies on.
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata). Uses existing Jest + Kotlin unit + the real API.
- **Tooling:** `fast-check` ($0); kotest-property or jqwik ($0). All $0.

## Risks & Mitigations

- **Risk:** Non-deterministic property runs → flaky gates. **Mitigation:** Fixed CI seed + reproducible counterexamples; a real counterexample is a real bug, pinned as an example, never retried away ([[feedback-no-auto-retry-workflows]]).
- **Risk:** Fuzzing the real API trips rate limits / burns quota. **Mitigation:** Bounded, rate-aware, local-stack-default; dev target opt-in ([[feedback-api-rate-limit-awareness]]).
- **Risk:** Property tests assert weak/tautological invariants. **Mitigation:** Invariants are the fail-closed safety properties (verify-the-mutant discipline — revert the guard, the property must fail); reviewer checks the invariant bites.
- **Risk:** Huge counterexamples are unreadable. **Mitigation:** Shrinking enabled → minimal reproducer.
- **Risk:** Scope explosion. **Mitigation:** Critical predicates/parsers + core API inputs first; breadth via follow-ups.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `fuzz-property-js`, `fuzz-property-kotlin`, `fuzz-api` green with fail-closed invariants + "no 5xx on malformed input" proven; seeds reproducible.
- [ ] Every real fail-open/crash/persist-bad-state defect surfaced is fixed at root; each counterexample pinned as an example test.
- [ ] All three registered; `docs/testing/fuzz-property.md` present + plain-language; `metadata.json` emitted.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0221-fuzz-property-testing`; PR title `SHY-0221: Fuzz & property-based testing — API inputs + critical predicates`; relevant gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (proposed extra). Targets a known real failure class: codepoint ISO-string comparison in the ban predicate ([[feedback-no-string-ordering-for-security-decisions]], SHY-0149 fail-closed). Core discipline: safety predicates must resolve ambiguous/unparseable input to the SAFE side; the property must fail if the guard is reverted (verify-the-mutant). $0 (`fast-check` + kotest-property). Bounded+seeded on PR, deeper on-demand.
