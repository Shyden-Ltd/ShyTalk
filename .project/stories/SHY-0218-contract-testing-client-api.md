---
id: SHY-0218
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

# SHY-0218: Contract testing — client ↔ Express-API schema (OpenAPI, both sides)

## User Story

As a ShyTalk developer, I want an enforced schema contract between the Express API and its three clients (Android, iOS, web), so that a change to an API response shape fails a test immediately instead of silently breaking sign-in, rooms, messaging, or payments on a real device in the field — because every client depends on that single API chokepoint and there is currently nothing guaranteeing they agree.

## Why

The audit confirmed **no contract testing** (no Pact/OpenAPI/dredd). This gap is uniquely dangerous for ShyTalk: the HARD architecture rule is that **all** client backend access flows through the Express API ([[feedback-no-direct-backend-all-via-api]]). That makes the API the single integration point — and the single place a shape change can break three polyglot clients at once, with no test to catch it until a user hits it. This story establishes **one OpenAPI 3.1 spec as the shared contract**, verified from both sides against the **real** API (per EPIC-0003), registers into SHY-0212's runner, and gives SHY-0220 a plain-language "Apps and server agree ✓" signal.

## Acceptance Criteria

### Happy path

- [ ] A maintained **OpenAPI 3.1 spec** (`express-api/openapi.yaml`) describes every client-facing endpoint: auth/OTP, users, rooms, messaging, payments/wallet, moderation/reporting, admin — request + response schemas, status codes, error shapes.
- [ ] **Provider verification (real responses conform):** the real Jest integration suite (against the real local stack) asserts each endpoint's ACTUAL response satisfies the spec via `jest-openapi` `toSatisfyApiSpec()` (or `express-openapi-validator` response validation). Registered `contract-provider` (`stack`, `publicArea: Cross-cutting`).
- [ ] **Consumer verification (clients match the spec):** the client DTOs are checked against the same spec — Kotlin `@Serializable` models (`shared/**`), Swift `Codable` models (`iosApp/**`), and web TS types — so a server field rename/removal breaks a consumer contract test. Registered `contract-consumer` (`host`, `publicArea: Cross-cutting`).
- [ ] Both register into `scripts/test/framework-registry.mjs`, emit normalized `metadata.json` (SHY-0212 contract), and `docs/testing/contract.md` explains in plain language what "the apps and server agree" means and how to run each side.
- [ ] The spec is the single source of truth: a `scripts/test/check-openapi-in-sync.mjs` gate fails if a client-facing route exists with no spec entry (or vice versa), so the contract can't silently drift from the implementation.

### Error paths

- [ ] A server response that adds/removes/renames a field, changes a type, or changes a status code without updating the spec FAILS `contract-provider` naming the endpoint + the mismatch.
- [ ] A client DTO expecting a field the spec doesn't provide (or a wrong type) FAILS `contract-consumer` naming the client + field.
- [ ] A route with no OpenAPI entry FAILS `check-openapi-in-sync` naming the route — a new endpoint can't ship uncovered.
- [ ] The provider suite FAILS (not skips) if the API/stack is unreachable — a contract "pass" over a non-running API is never reported ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] Error responses are contracted too (e.g. the `{ error, code }` shape for 400/401/403/404/409) — not just 200 paths; a changed error shape breaks the contract (clients parse errors).
- [ ] Nullable/optional fields are modeled precisely so an optional field's absence doesn't false-fail and a required field's absence does fail.
- [ ] Enum-valued fields (cohort, room state, user type) are enumerated in the spec so an added/removed enum value is caught.
- [ ] Auth-gated endpoints are exercised authenticated (real personas) so their real, behind-login responses are the ones validated.
- [ ] Backward-compatibility intent is explicit: an additive, optional field is a non-breaking change (spec updated, no client break); a required-field or type change is breaking (both sides must update in lockstep) — documented in `docs/testing/contract.md`.

### Performance

- [ ] `contract-provider` piggybacks on the existing real integration suite (assertions added to existing endpoint tests where possible) so it adds minimal wall-clock.
- [ ] `contract-consumer` is host-fast (schema/model diffing, no device/stack).
- [ ] The spec parse + sync check is sub-second.

### Security

- [ ] The contract documents (and the provider test confirms) that protected endpoints require auth — a route that should be authauthed but returns data unauthenticated fails both the contract and the security expectation, reinforcing [[feedback-no-direct-backend-all-via-api]].
- [ ] The spec + tests carry no secrets/PII (schemas + example shapes use non-personal examples; belt with SHY-0223).
- [ ] Error-shape contracts confirm the API does not leak internal detail (stack traces, internal ids) in error responses.

### UX

- [ ] Failure output states the practical impact: "The server no longer returns `roomName`; the Android room list expects it — this would blank the room title on devices." Not just "schema mismatch".
- [ ] `docs/testing/contract.md` explains the contract in plain terms + the one command per side.

### i18n

- [ ] N/A — the contract governs data *shape*, not user-facing copy. (Localized *content* fields are contracted as strings; their translation is SHY-0222's scope.)

### Observability

- [ ] Each side's `metadata.json` records endpoints-covered + mismatches, feeding a plain-language "Apps and server agree ✓" signal for SHY-0220.
- [ ] The rendered OpenAPI spec is published as a CI artifact (developer reference), greppable by `[framework:contract-provider|contract-consumer]`.
- [ ] Coverage of endpoints-under-contract vs total client-facing endpoints is reported so gaps are visible.

## BDD Scenarios

**Scenario: A server field rename breaks the provider contract**

- **Given** the API changes `roomName` to `title` in the room response without updating the spec
- **When** `contract-provider` validates the real response against the OpenAPI spec
- **Then** the test fails naming the endpoint and the removed field

**Scenario: A client expecting a dropped field breaks the consumer contract**

- **Given** the Android room DTO still expects `roomName` which the spec no longer defines
- **When** `contract-consumer` checks the Kotlin model against the spec
- **Then** it fails naming the client and the field

**Scenario: A new endpoint with no spec entry is blocked**

- **Given** a new client-facing route added without an OpenAPI entry
- **When** `check-openapi-in-sync` runs
- **Then** it fails naming the uncovered route

**Scenario: An error-shape change is caught**

- **Given** the 403 error shape changes from `{ error, code }` to `{ message }`
- **When** the contract suites run
- **Then** the mismatch fails the contract (clients parse the old error shape)

**Scenario: An additive optional field is non-breaking**

- **Given** the API adds a new optional field and updates the spec
- **When** both contract suites run
- **Then** they pass (additive + optional = non-breaking)

**Scenario: Contract verdict reaches the public page**

- **Given** a completed contract run
- **When** SHY-0220's page reads the contract `metadata.json`
- **Then** it can show "Apps and server agree ✓"

## Test Plan

**Classification:** provider side is real-only (validates REAL responses from the REAL running API in the real integration suite — `stack`); consumer side is host model/schema diffing (`host`, unit-location). No mocked API responses are contracted — the whole point is the REAL response conforms.

### Red — write failing tests first

- Provider: extend `express-api/tests/` integration specs with `expect(res).toSatisfyApiSpec()` per endpoint; a RED fixture where a response deviates from the spec proves the gate fails.
- `check-openapi-in-sync`: `express-api/tests/scripts/contract/openapi-sync.test.js` — `it('fails when a client-facing route has no spec entry')`, `it('fails when a spec entry has no route')`, `it('passes on the live spec')`.
- Consumer: `shared/src/.../ContractModelTest.kt` (Kotlin DTOs vs spec), a web TS type-check against generated spec types, and an iOS `Codable` conformance check — each with a RED variant where a model diverges.
- `it('error-shape responses are contracted')`, `it('enum fields reject an unknown value')`, `it('metadata records endpoints-covered + mismatches')`.

### Green — implement

1. Author `express-api/openapi.yaml` covering all client-facing endpoints (request/response/errors/enums).
2. Add `jest-openapi`; wire `toSatisfyApiSpec()` into the real integration suite as `contract-provider`.
3. Add `contract-consumer` model checks (Kotlin/Swift/TS vs spec) + `check-openapi-in-sync.mjs`.
4. Register both; write `docs/testing/contract.md`; wire the sync gate into `lint.yml`.
5. Reconcile every real drift the contract surfaces (align spec + clients + server).

### Gauntlet

Touches backend (`express-api/**`) + client models (`shared/**`, `iosApp/**`, web) → FULL Pre-Merge Testing Protocol; provider verification proven against the real local + dev API, consumer conformance host-verified, before merge.

## Out of Scope

- Full consumer-driven Pact broker infrastructure (heavier; OpenAPI-as-contract is the $0, polyglot-friendly choice) — revisit only if OpenAPI proves insufficient.
- Auto-generating client code from the spec (generation is a bigger refactor; this story *verifies* existing models against the spec) — a follow-up could adopt generation.
- GraphQL/websocket contract (LiveKit media path is contracted by SHY-0214's voice load + its own signaling, not this REST contract).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes a contract signal to SHY-0220; strengthens the guarantees behind EPIC-0006 (API-only access).
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata). Uses the existing real integration suite + client models.
- **Tooling:** `jest-openapi` / `express-openapi-validator` ($0); OpenAPI 3.1; host schema-diff for consumers. All $0.

## Risks & Mitigations

- **Risk:** The spec becomes stale vs the implementation (a second source of truth that drifts). **Mitigation:** `check-openapi-in-sync` gate fails on route/spec divergence; provider verification runs the REAL responses against the spec, so the spec must match reality.
- **Risk:** Over-strict schemas cause churn on every additive change. **Mitigation:** Explicit additive-optional = non-breaking policy; only required-field/type/status changes are breaking and require lockstep updates.
- **Risk:** Consumer verification across three languages is fiddly. **Mitigation:** Keep the consumer check to field-presence/type conformance against the spec (not full codegen); each language has a focused conformance test.
- **Risk:** Behind-login endpoints scanned only at the login wall. **Mitigation:** Provider verification authenticates with real personas so real protected responses are validated.
- **Risk:** Error responses left uncontracted (clients break on error parsing). **Mitigation:** Error shapes are first-class in the spec + explicitly tested.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `express-api/openapi.yaml` covers all client-facing endpoints; `contract-provider` (real responses) + `contract-consumer` (Kotlin/Swift/TS models) green; `check-openapi-in-sync` wired into `lint.yml`.
- [ ] Both registered; `docs/testing/contract.md` present + plain-language; `metadata.json` emitted.
- [ ] Every real drift surfaced is reconciled across spec/clients/server.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0218-contract-testing-client-api`; PR title `SHY-0218: Contract testing — client ↔ Express-API schema`; FULL gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator listed contract testing implicitly via "anything else"; it is high-value given the API-only architecture). Design ruling: **OpenAPI 3.1 as the single shared contract**, verified from both sides against the REAL API — chosen over Pact for polyglot (Kotlin/Swift/TS) friendliness and $0. Directly hardens the [[feedback-no-direct-backend-all-via-api]] chokepoint. Codegen deferred; this story verifies existing models.
