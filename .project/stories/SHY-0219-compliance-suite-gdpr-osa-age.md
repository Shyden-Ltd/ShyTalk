---
id: SHY-0219
status: Draft
owner: claude
created: 2026-07-19
priority: P0
effort: L
type: infra
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0219: Compliance suite — GDPR (export/erasure) + UK Online Safety Act + age-gating, as one labelled framework

## User Story

As the ShyTalk operator launching a minors-facing product in the UK/EU, I want a single, clearly-labelled compliance test suite that proves our **implemented** behaviour matches our **stated** data-protection and online-safety policy — GDPR data export, GDPR erasure, UK Online Safety Act duties, and age-gating/cohort separation — so that a regression in a legally-material behaviour fails a test before launch, and so we can show (in plain language) that these protections are exercised, not just claimed.

## Why

The audit found age-verification is **functionally** tested (5 Express suites) but there is **no cohesive compliance framework** — GDPR export/erasure and UK OSA duties are not tested as a labelled, complete suite, and the age-gating tests are scattered rather than presented as a compliance signal. For a minors-facing app, these are launch-critical: an incomplete data export, a deletion that leaves residual PII, a broken content-report flow, or a cohort leak (a minor and an adult in the same room) are legal and safety failures. This story consolidates + completes the compliance testing as **one real-services suite** (per EPIC-0003), registers it into SHY-0212's runner, and feeds SHY-0220 a plain-language "Your data + safety rights work ✓" signal.

**Scope boundary (critical, no overclaim):** this suite proves implemented behaviour conforms to the *stated policy*; it is **not** legal certification and does not opine on legal sufficiency. The unresolved **GDPR-erasure vs OSA safety-retention** tension is a separate launch-blocking legal review ([[project-gdpr-export-osa17-legal-review]]); this suite encodes whatever policy that review decides and, until it lands, tests the current implementation while **explicitly flagging** the retention carve-out rather than asserting either side.

## Acceptance Criteria

### Happy path

- [ ] **GDPR data export (Art 15/20):** a real end-to-end test requests a user's data export through the real Express API and asserts it is complete (all the user's data across the collections that hold it — profile, rooms, messages, wallet, reports) and machine-readable. Part of `compliance-suite` (`stack`, `publicArea: Safety`).
- [ ] **GDPR erasure (Art 17):** a real test deletes an account through the real deletion path and asserts no residual PII remains in Firestore/RTDB/Storage **except** data under a documented, policy-approved safety-retention carve-out (which the test asserts is retained per policy, not accidentally). Ties to the existing `accountDeletion` workflow.
- [ ] **UK Online Safety Act duties:** real tests cover the OSA-material flows — age assurance gate, user reporting of content/users, moderation action on a report, and the required record being kept — each asserted end-to-end against the real API.
- [ ] **Age-gating / cohort separation:** the existing age-verification behaviour is consolidated under the compliance label AND the cohort-separation invariant is tested — a minor and an adult are never placed in the same room/interaction surface (a real seeded test proves the segregation holds at the API chokepoint).
- [ ] The suite registers into `scripts/test/framework-registry.mjs` as `compliance-suite`, emits normalized `metadata.json` (SHY-0212 contract) with a per-area pass/fail (Export / Erasure / OSA / Age-gating), and `docs/testing/compliance.md` explains each protection in **plain, non-legal language** ("You can download your data; you can delete your account; you can report someone; under-18s and adults are kept apart") + the scope boundary above.
- [ ] Each compliance area maps to the specific policy clause it exercises (a traceability table in `docs/testing/compliance.md`) so a reviewer can see clause → test.

### Error paths

- [ ] An export that omits a collection holding the user's data FAILS with the missing collection named — an incomplete export is a compliance failure, not a pass.
- [ ] A deletion that leaves residual PII outside the approved carve-out FAILS naming the residual location.
- [ ] A broken report flow (report not recorded, or moderation action not applied/recorded) FAILS naming the step.
- [ ] A cohort-separation breach (a seeded minor able to enter an adult surface, or vice versa) FAILS loudly — this is the highest-severity assertion in the suite.
- [ ] The suite FAILS (not skips) if the real stack is unavailable — a compliance "pass" over a non-running backend is never reported ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] Erasure of a user who has data in shared structures (messages in a room others are in, reports they filed) is handled per policy (their PII removed/anonymized; others' data intact) and asserted — not an all-or-nothing wipe.
- [ ] Export for a brand-new user with minimal data returns a valid (small) export, not an error.
- [ ] Age-gating boundary: a user exactly at the age threshold (per the stated policy's inclusive/exclusive rule) is placed in the correct cohort — the exact boundary is tested, not just clearly-under/clearly-over.
- [ ] The OSA safety-retention carve-out is asserted explicitly (retained data IS present after erasure per policy) so the tension is visible + intentional, pending the legal review's final ruling.
- [ ] A re-deletion / double-export request is idempotent (no error, no partial state).

### Performance

- [ ] The suite runs within a documented CI wall-clock budget against the real stack; export/erasure over a seeded dataset is bounded.
- [ ] N/A for production runtime performance — this is a test suite; export/erasure production performance is covered by SHY-0214 if a budget is set there.

### Security

- [ ] Export is delivered only to the authenticated owner (a test asserts user A cannot export user B's data) — a cross-user export is a critical failure ([[feedback-no-direct-backend-all-via-api]] guards this at the chokepoint).
- [ ] The export artifact + test data carry the seeded user's data only; the suite scrubs/《uses non-real PII and never logs export contents (belt with SHY-0223).
- [ ] Erasure genuinely removes credentials/tokens so a deleted account cannot re-authenticate (asserted).

### UX

- [ ] Failure output states the user-and-legal impact plainly: "A deleted account still has their profile photo in storage — this is a data-erasure failure." Not a raw doc path alone.
- [ ] `docs/testing/compliance.md` uses plain language a non-lawyer + non-engineer can follow, with the clause→test traceability table and the explicit scope boundary.

### i18n

- [ ] The user-facing compliance touchpoints (export-ready notification, deletion confirmation, report UI, age-gate copy) are localized across the active locales — a test asserts these strings resolve through the resource system, since compliance UX must be understandable in the user's language.

### Observability

- [ ] `metadata.json` records per-area pass/fail (Export / Erasure / OSA / Age-gating), feeding a plain-language "Your data + safety rights work ✓" signal for SHY-0220 (status only, no user data).
- [ ] The suite logs each compliance area with `[framework:compliance-suite]` + the clause it exercised, greppable in CI.
- [ ] A compliance-area trend is retained so a regression in any area is visible historically.

## BDD Scenarios

**Scenario: An incomplete data export fails**
- **Given** a user with profile, messages, and wallet data
- **When** the export test requests their data through the real API and a collection is omitted
- **Then** the suite fails naming the missing data category

**Scenario: Residual PII after deletion fails erasure**
- **Given** an account deleted through the real deletion path
- **When** the erasure test scans for residual PII outside the approved carve-out
- **Then** any residual PII fails the test naming its location

**Scenario: A cohort-separation breach is the highest-severity failure**
- **Given** a seeded minor account
- **When** the test attempts to place them in an adult-only surface via the real API
- **Then** the API refuses AND the suite asserts the refusal
- **And** any breach fails loudly as a safety-critical compliance failure

**Scenario: A user cannot export another user's data**
- **Given** authenticated user A
- **When** A requests an export scoped to user B
- **Then** the API denies it AND the test asserts the denial

**Scenario: The OSA retention carve-out is explicit, not accidental**
- **Given** the stated policy retains certain safety records after account deletion
- **When** the erasure test runs
- **Then** it asserts those records ARE retained per policy (intentional carve-out)
- **And** `docs/testing/compliance.md` flags the pending GDPR-vs-OSA legal review

**Scenario: Compliance verdict reaches the public page**
- **Given** a completed compliance run
- **When** SHY-0220's page reads the compliance `metadata.json`
- **Then** it can show "Your data + safety rights work ✓" per area (status only)

## Test Plan

**Classification:** real-only, end-to-end against the real stack. Export/erasure/report/age-gating are exercised through the REAL Express API against REAL emulated Firestore/RTDB/Storage with REAL seeded personas — inducing the real conditions (a real deletion, a real cross-user export attempt), never mocking a compliance outcome. Host-runnable unit portion: the clause→test traceability parser + the metadata normalizer.

### Red — write failing tests first

- `express-api/tests/compliance/gdpr-export.test.js` — `it('export includes every collection holding the user data')`, `it('a user cannot export another user data')`, `it('new-user export is valid and minimal')`.
- `express-api/tests/compliance/gdpr-erasure.test.js` — `it('deletion leaves no residual PII outside the carve-out')`, `it('retains the OSA safety carve-out per policy')`, `it('a deleted account cannot re-authenticate')`, `it('erasure preserves others data in shared structures')`.
- `express-api/tests/compliance/osa.test.js` — `it('age assurance gate blocks under-threshold')`, `it('a user can report content/user')`, `it('a moderation action is applied and recorded')`.
- `express-api/tests/compliance/age-cohort.test.js` — `it('minor and adult are never in the same room')`, `it('the exact age boundary places the correct cohort')`.
- `it('metadata records per-area pass/fail')`, `it('clause→test traceability table covers every asserted area')`.

### Green — implement

1. Build/point the compliance tests at the real export/erasure/report/age paths (some exist — consolidate; some are new — add).
2. Fix any real compliance gap surfaced (an incomplete export, a residual-PII deletion, a cohort leak) at root.
3. Register `compliance-suite`; write `docs/testing/compliance.md` (plain language + clause→test table + scope boundary + the pending legal-review flag).
4. Emit per-area `metadata.json` for SHY-0220.

### Gauntlet

Touches backend (`express-api/**`, deletion workflow, rules) → FULL Pre-Merge Testing Protocol (backend ⇒ full gauntlet); export/erasure/report/cohort proven against the real local + dev stack before merge. Any user-facing compliance copy change also runs the app/web surfaces.

## Out of Scope

- Legal certification / a lawyer's sign-off (this is a behaviour regression net, NOT legal advice) — the GDPR-vs-OSA ruling is [[project-gdpr-export-osa17-legal-review]].
- Building NEW compliance *features* (e.g. a new export format) — this story tests the implemented policy; a missing feature surfaced is filed as its own SHY.
- Cookie-consent / web-analytics compliance if not applicable to the $0 no-tracking setup (noted, revisit if analytics are added).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes the highest-stakes signal to SHY-0220.
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata); the pending [[project-gdpr-export-osa17-legal-review]] decision determines the erasure carve-out policy the suite encodes (the suite tests current implementation + flags the carve-out until then). Uses the existing age-verification suites + deletion workflow.
- **Tooling:** existing Jest + real stack; no new runtime dependency. $0.

## Risks & Mitigations

- **Risk:** Overclaiming legal compliance from a passing suite. **Mitigation:** Explicit scope boundary in the story + `docs/testing/compliance.md` — proves implemented-behaviour-matches-stated-policy, not legal sufficiency; SHY-0220 language mirrors this.
- **Risk:** The GDPR-vs-OSA retention tension is unresolved, so the erasure test could encode the wrong policy. **Mitigation:** The suite asserts the current implementation + explicitly flags the carve-out as pending [[project-gdpr-export-osa17-legal-review]]; when the ruling lands, the carve-out assertion updates in one place.
- **Risk:** A cohort-separation test that passes tautologically (never really attempts the breach). **Mitigation:** The test induces the REAL breach attempt via the real API and asserts the refusal (verify-the-mutant discipline); a revert of the guard must fail exactly this test.
- **Risk:** Export/erasure tests leak real PII into logs/artifacts. **Mitigation:** Seeded non-real PII only; export contents never logged; belt with SHY-0223.
- **Risk:** Compliance areas drift from policy over time. **Mitigation:** Clause→test traceability table is reviewed; a policy change updates the table + tests together.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `compliance-suite` green: complete export, erasure that leaves no residual PII **outside the documented, policy-approved safety-retention carve-out** (asserted per stated policy — NOT a legal-sufficiency claim), working report/moderation flow, enforced cohort separation — all against the real stack.
- [ ] Registered; `docs/testing/compliance.md` present, plain-language, with clause→test table + scope boundary + pending-legal-review flag; `metadata.json` per-area emitted.
- [ ] Every real compliance gap surfaced is fixed at root.
- [ ] `code-reviewer` + security review 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0219-compliance-suite-gdpr-osa-age`; PR title `SHY-0219: Compliance suite — GDPR + UK Online Safety Act + age-gating`; FULL gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator listed compliance explicitly). Framed strictly as a **behaviour regression net, not legal certification** — a deliberate guard against the operator's "no misconceptions that put the project at risk" bar. Consolidates the existing age-verification tests under a compliance label + adds GDPR export/erasure + OSA report/moderation + cohort-separation. The GDPR-erasure vs OSA-retention tension is tracked separately ([[project-gdpr-export-osa17-legal-review]], a launch-blocker); this suite encodes the decided policy + flags the carve-out until the ruling lands. Cohort-separation is the highest-severity assertion and is induced for real, not asserted tautologically.
