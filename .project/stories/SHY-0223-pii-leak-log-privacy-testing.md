---
id: SHY-0223
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

# SHY-0223: PII-leak / log-privacy testing — prod redaction + no PII in any published feed

## User Story

As a ShyTalk user (or a minor whose data we hold), I want my personal information to never leak into production logs, error responses, crash reports, or any publicly-published test output, and as the operator I want an automated framework that proves PII stays contained, because a leaked email/phone/DOB/token in a log or a public report is a privacy breach — and doubly serious for a minors-facing app.

## Why

The audit listed **PII-leak / log-privacy** as a candidate gap. ShyTalk holds sensitive data (emails, DOB for age-gating, auth tokens, message content) and now publishes test results publicly (SHY-0220). Two leak surfaces must be gated: (1) **production logs / error responses / telemetry** must redact PII (local/dev are intentionally unredacted for debuggability — [[feedback-comprehensive-default-debug-logging]] — so the test targets **prod** config), and (2) **every published test feed** (`metadata.json`, `run-summary.json`, `health-data.json`, Allure) must carry no PII. This story adds the **real** PII-leak framework — inducing real requests + scanning real feeds (per EPIC-0003) — registers into SHY-0212's runner, and is the independent **belt** that verifies the no-PII claims every other EPIC-0008 story makes. It feeds SHY-0220 a plain-language "Your data stays private ✓" signal.

## Acceptance Criteria

### Happy path

- [ ] **Prod log redaction:** with the **production** logging configuration active, a real request carrying PII (email, phone, DOB, auth token, display name, message body, IP) is issued through the real API, and the emitted logs are asserted to **redact** those values (masked/hashed/omitted per the redaction policy). Registered `pii-logs` (`stack`, `publicArea: Safety`).
- [ ] **No PII in published feeds:** a scanner checks every published test artifact — `test-results/**/metadata.json`, `run-summary.json`, `public/health-data.json`, and any Allure output slated for publication — for PII patterns (email, phone, token shapes, DOB, seeded persona names) and FAILS on any hit. Registered `pii-feeds` (`host`, `publicArea: Safety`).
- [ ] **No PII in error responses:** the real API's error responses are asserted to contain no PII and no internal detail (stack traces, internal ids) — ties to SHY-0218's error-shape contract.
- [ ] Both register into `scripts/test/framework-registry.mjs`, emit normalized `metadata.json` (SHY-0212 contract) with leak-count = 0 required to pass, and `docs/testing/pii-privacy.md` explains in plain language what PII we protect + the prod-vs-dev redaction policy.
- [ ] The PII pattern set + redaction policy live once in `scripts/test/pii-policy.mjs`, consumed by `pii-logs` + `pii-feeds` (and referenced by other stories' no-PII assertions) — one home for "what counts as PII."

### Error paths

- [ ] A prod log line that emits an un-redacted email/token/DOB FAILS `pii-logs` naming the field + log site (with the offending value itself redacted in the failure message — the test must not leak while reporting the leak).
- [ ] A `metadata.json`/`health-data.json` containing a seeded persona email FAILS `pii-feeds` naming the file + field.
- [ ] An error response leaking a stack trace or internal id FAILS naming the endpoint.
- [ ] The scanner FAILS (not skips) if a feed it expects is missing/unreadable — absence isn't a pass ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] Local/dev unredacted logging is NOT flagged — the redaction assertion runs only against the **prod** config (a test asserts dev stays verbose, prod redacts) so we don't break the intentional debuggability policy ([[feedback-comprehensive-default-debug-logging]]).
- [ ] PII embedded in a nested/encoded field (base64, JSON-in-a-string, URL-encoded query) is detected, not just top-level plaintext.
- [ ] A false-positive-prone value (a UUID that isn't PII, a public room id) is not flagged — the policy distinguishes identifiers-that-are-PII from opaque non-PII ids, with a reviewed allowlist for genuine non-PII that pattern-matches.
- [ ] Message *content* redaction in prod logs is asserted (message bodies are user content) — not just structured fields.
- [ ] The GDPR export contents (SHY-0219) are asserted to never be written to logs — an export must not leak via logging.

### Performance

- [ ] `pii-feeds` (static scan) is host-fast and part of `--profile host`.
- [ ] `pii-logs` reuses an existing real-request path (piggybacks a journey) to bound wall-clock.
- [ ] The scan is bounded/streaming over feed files (no whole-corpus buffering).

### Security

- [ ] The framework never itself leaks: failure messages redact the found value; scan reports store locations + types, never the raw PII.
- [ ] The PII policy explicitly includes minors-relevant data (DOB, age, cohort) as high-sensitivity.
- [ ] Reinforces [[feedback-no-direct-backend-all-via-api]]: since all data flows through the API, prod-log redaction at that chokepoint is the primary containment point + is where the test asserts.

### UX

- [ ] Failure output is plain + actionable: "Production logs are printing the user's email in the sign-in handler — redact it." Not a raw regex hit.
- [ ] `docs/testing/pii-privacy.md` explains the protected-data list + prod/dev policy + the one command each, in plain language.

### i18n

- [ ] N/A — PII detection operates on data values/log output, not user-facing UI copy. (Localized PII, e.g. a name in any script, is covered because the patterns are content-shape based, not English-word based.)

### Observability

- [ ] Each framework's `metadata.json` records leak-count (must be 0) by category, feeding a plain-language "Your data stays private ✓" signal for SHY-0220 (counts only, never the leaked value).
- [ ] Findings are logged with `[framework:pii-logs|pii-feeds]` + the location (value redacted), greppable in CI.

## BDD Scenarios

**Scenario: Prod logs redact PII**

- **Given** the production logging config is active
- **When** a real request carrying an email + auth token is processed
- **Then** the emitted logs redact both values
- **And** any un-redacted PII fails `pii-logs` (with the value itself redacted in the failure)

**Scenario: Dev logging stays intentionally verbose**

- **Given** the local/dev logging config
- **When** the redaction test runs against dev
- **Then** it asserts dev remains unredacted (debuggability) and does NOT fail — only prod is gated

**Scenario: A PII leak in a published feed is blocked**

- **Given** a `health-data.json` that accidentally includes a seeded persona email
- **When** `pii-feeds` scans it
- **Then** it fails naming the file and field before publication

**Scenario: An error response leaking internals is caught**

- **Given** an endpoint that returns a stack trace on error
- **When** the error-response check runs
- **Then** it fails naming the endpoint

**Scenario: A non-PII id is not false-flagged**

- **Given** a public room UUID in a feed
- **When** `pii-feeds` scans it
- **Then** it is not flagged (opaque non-PII id, per the reviewed policy)

**Scenario: Privacy verdict reaches the public page**

- **Given** a completed PII-leak run with zero leaks
- **When** SHY-0220's page reads the `metadata.json`
- **Then** it can show "Your data stays private ✓"

## Test Plan

**Classification:** `pii-logs` is real-only (induces a REAL request through the REAL API under the REAL prod logging config, inspects real emitted logs — `stack`). `pii-feeds` is host over the REAL generated feeds (real artifacts, no doubles). No mocked log output.

### Red — write failing tests first

- `express-api/tests/privacy/prod-log-redaction.test.js` — `it('prod config redacts email/token/DOB/message body')`, `it('dev config stays verbose (not flagged)')`, `it('detects PII in nested/encoded fields')`, `it('failure message itself redacts the value')`.
- `express-api/tests/privacy/feed-scan.test.js` — `it('fails a metadata.json with a persona email')`, `it('does not flag an opaque UUID')`, `it('scans health-data.json + run-summary.json')`, `it('reads the pattern set from pii-policy.mjs')`.
- `express-api/tests/privacy/error-response.test.js` — `it('no error response leaks a stack trace or internal id')`.
- `it('metadata records leak-count 0 to pass')`, `it('the export is never written to logs')`.

### Green — implement

1. Build `scripts/test/pii-policy.mjs` (patterns + redaction policy + non-PII allowlist).
2. Build `pii-feeds` scanner (static, over the published feeds) + wire into `--profile host` + `lint.yml`.
3. Build `pii-logs` (prod-config real-request + log inspection) + the error-response check.
4. Register both; write `docs/testing/pii-privacy.md`.
5. Fix every real leak surfaced at root — redact prod logs, scrub feeds, sanitize error responses (real product fixes, not suppression) ([[feedback-root-cause-not-symptom]]).

### Gauntlet

Touches backend logging/error paths (`express-api/**`) + the published feeds → FULL Pre-Merge Testing Protocol (backend ⇒ full gauntlet); prod-config redaction proven against the real stack before merge.

## Out of Scope

- A DLP/data-classification program across all storage (broader governance; this story gates logs/feeds/errors).
- Encrypting data at rest / key management (infra concern, separate).
- Redacting local/dev logs (intentionally verbose — [[feedback-comprehensive-default-debug-logging]]).
- The public rollup page itself — SHY-0220 (this story verifies its feed is PII-free).

## Dependencies

- **Blocks:** the no-PII belt every other EPIC-0008 story relies on (0212 feeds, 0217 security counts, 0219 export, 0220 public page).
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata + the feed shapes to scan). Uses the existing prod logging config + real API + real personas.
- **Tooling:** host pattern scanner ($0); real prod-config request path. All $0.

## Risks & Mitigations

- **Risk:** Testing dev logs for redaction (wrong target) breaks the intentional verbose-dev policy. **Mitigation:** Redaction assertion runs ONLY against prod config; a test asserts dev stays verbose ([[feedback-comprehensive-default-debug-logging]]).
- **Risk:** The test leaks the very PII it reports. **Mitigation:** Failure messages + reports redact the value; only location + type are recorded.
- **Risk:** False positives on opaque ids. **Mitigation:** Policy distinguishes PII-identifiers from opaque ids + a reviewed non-PII allowlist that can't grow silently.
- **Risk:** PII hidden in nested/encoded fields slips through. **Mitigation:** Decode-and-scan for common encodings; message-body content covered.
- **Risk:** Policy drift across stories. **Mitigation:** Single `pii-policy.mjs` source, referenced by every no-PII assertion.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `pii-logs` (prod redaction, real request) + `pii-feeds` (feed scan) green with zero leaks; dev-verbose preserved; error responses clean.
- [ ] Every real leak surfaced is fixed at root.
- [ ] Both registered; `docs/testing/pii-privacy.md` present + plain-language; `pii-policy.mjs` is the single PII source; `metadata.json` (leak-count 0) emitted.
- [ ] `code-reviewer` + security review 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0223-pii-leak-log-privacy-testing`; PR title `SHY-0223: PII-leak / log-privacy testing — prod redaction + no PII in feeds`; relevant gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator: PII-leak candidate). It is the independent **belt** verifying the no-PII claims all other stories make. Key ruling: redaction test targets **prod** config only — dev stays intentionally verbose ([[feedback-comprehensive-default-debug-logging]]). Single `pii-policy.mjs` is the one home for "what is PII." Real-only: real prod-config request + real feed scan. Reports redact the value while reporting the leak.
