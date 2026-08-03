---
id: SHY-0217
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

# SHY-0217: Security deepening — DAST, Swift/iOS SAST, entropy secret-scan, dependency-license compliance

## User Story

As the ShyTalk operator shipping a minors-facing MVP, I want our already-decent security testing deepened to close the four verified holes — no dynamic scan of the running API, no Swift/iOS static analysis, only regex-level secret scanning, and no dependency-license gate — so that a runtime vulnerability, an iOS code flaw, a high-entropy leaked secret, or a legally-incompatible dependency fails a test before launch rather than becoming an incident.

## Why

The audit corrected an assumption: security is **not** absent — CodeQL SAST (JS+Kotlin), Dependabot + auto-merge + CVE overrides, SHA-pinned actions, a pre-commit secret regex, `helmet` + `express-rate-limit`, and the API-only/no-stubs ratchets all exist. But four specific gaps are real and verified:

1. **No DAST** — nothing tests the *running* API for missing security headers, injection surfaces, auth bypasses, or misconfigurations that static analysis can't see.
2. **Swift/iOS SAST gap** — `codeql-config.yml` scans JS + Kotlin only; iOS Swift code is unanalyzed.
3. **Secret-scan depth** — `.husky/pre-commit` uses a basic prefix regex (`AIzaSy…`/`sk-…`/`ghp_…`/`AKIA…`), missing high-entropy secrets that don't match a known shape.
4. **No dependency-license compliance** — nothing flags a copyleft/unknown-licensed dependency that could be legally incompatible with distributing the app.

This story closes all four with **real, $0** defensive tooling (scanning our own running app + our own repo/deps), registers them into SHY-0212's runner, and feeds SHY-0220 a plain-language "Safety checks ✓" signal. It is scoped as **defensive hardening of our own infrastructure** — no third-party targeting.

## Acceptance Criteria

### Happy path

- [ ] **DAST (OWASP ZAP):** a ZAP baseline/API scan runs against the REAL running local Express API (authenticated where needed via test personas), asserting expected security headers (`helmet` set), no high-risk alerts, and no unauthenticated access to protected routes. Registered `sec-dast` (`stack`, `publicArea: Safety`).
- [ ] **Swift/iOS SAST:** iOS Swift code is statically analyzed for security issues — preferably by extending `codeql-config.yml` + `codeql.yml` to add the `swift` language (with the iOS build providing compilation, on a `mac` runner). If CodeQL-Swift is over the CI budget, the concrete $0 fallback is **`semgrep`** (OSS, free) with its Swift ruleset (+ any repo-specific security rules) — no compilation required, runs on `host`. Registered `sec-sast-swift` (`mac` for CodeQL-Swift, else `host` for semgrep; `publicArea: Safety`).
- [ ] **Entropy secret-scan (gitleaks):** gitleaks runs in `.husky/pre-commit` (staged files, fast) AND in CI (full diff vs base, entropy + rule based), replacing/augmenting the basic regex; a high-entropy secret with no known prefix is caught. Registered `sec-secrets` (`host`, `publicArea: Safety`).
- [ ] **License compliance:** `license-checker` (npm, both `package.json`) + a Gradle license report for Kotlin deps run with a reviewed allowlist of permitted licenses; a dependency under a disallowed/unknown license FAILS. Registered `sec-license` (`host`, `publicArea: Cross-cutting`).
- [ ] All four register into `scripts/test/framework-registry.mjs`, emit normalized `metadata.json` (SHY-0212 contract), and `docs/testing/security.md` explains in plain language what each checks and what a finding means. It also documents what already exists (CodeQL/Dependabot/etc.) so the picture is complete.

### Error paths

- [ ] A route missing a `helmet` header (or a new unauthenticated-but-should-be-protected endpoint) FAILS `sec-dast` naming the URL + the specific alert.
- [ ] An introduced iOS Swift vulnerability (e.g. insecure data storage, hardcoded key) FAILS `sec-sast-swift` naming the file + rule.
- [ ] A committed high-entropy secret (a random 40-char token, no known prefix) FAILS `sec-secrets` — the exact class the old regex missed.
- [ ] A newly-added dependency under a disallowed license FAILS `sec-license` naming the package + license.
- [ ] Each framework FAILS fast (not skips) if its target isn't reachable (API down for DAST, iOS build unavailable for SAST) — no false green ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] `sec-dast` authenticates through the real auth path so it scans behind-login surfaces, not just the public prefix (a scan that only hits the login wall is not a pass).
- [ ] gitleaks does NOT flag the intentional secret-shaped *test fixtures* used by the existing secret-regex tests — a reviewed `.gitleaks.toml` allowlist scopes those paths, and the allowlist is diff-reviewed (can't grow silently) ([[feedback-never-suppress-fix-or-upgrade]]).
- [ ] Dual-licensed dependencies (e.g. `MIT OR Apache-2.0`) resolve to the permitted license, not a false reject.
- [ ] A transitive dependency's license is evaluated, not just direct deps.
- [ ] The DAST scan is bounded (baseline/API scan, not a full active attack that could take hours) so it fits CI; a deeper active scan is on-demand only.

### Performance

- [ ] `sec-secrets` (pre-commit, staged files) adds negligible commit latency; the CI full-history/diff scan is bounded.
- [ ] `sec-dast` baseline scan completes within a documented CI wall-clock budget (registry `timeoutMs`).
- [ ] `sec-license` and `sec-sast-swift` reuse cached tool/dep installs ([[feedback-ci-cache-downloads-version-aware]]).

### Security

- [ ] These are **defensive, first-party** scans — DAST targets our own local/dev API only; no third-party host is ever targeted; no exploit is weaponized. Documented as authorized self-testing in `docs/testing/security.md`.
- [ ] Scan reports never print the secret value they found (only the location + type) — no leak-by-report; reports carry no PII (belt with SHY-0223).
- [ ] Findings feed the existing security-review discipline; a real DAST/SAST finding is fixed at root, not suppressed ([[feedback-root-cause-not-symptom]]).
- [ ] The DAST scan honors the API-only architecture — it confirms protected data is unreachable except via authenticated Express routes ([[feedback-no-direct-backend-all-via-api]]).

### UX

- [ ] Findings read plainly: "The `/rooms/:id` endpoint is missing the `X-Content-Type-Options` header" / "This dependency uses AGPL, which we don't allow — replace or get an exception." Not just a raw alert id.
- [ ] `docs/testing/security.md` explains each scan + the existing controls, and the one command to run each locally.

### i18n

- [ ] N/A — security scans operate on code/config/dependencies/HTTP, not user-facing strings.

### Observability

- [ ] Each framework's `metadata.json` records finding counts by severity, feeding a plain-language "Safety checks ✓/⚠" signal for SHY-0220 (with no sensitive detail exposed publicly — counts only).
- [ ] Full ZAP/CodeQL-Swift/gitleaks/license reports are uploaded as CI artifacts (access-appropriate), greppable by `[framework:sec-dast|sec-sast-swift|sec-secrets|sec-license]`.
- [ ] A findings trend is retained so a slow accrual of low-severity issues is visible.

## BDD Scenarios

**Scenario: A missing security header is caught by DAST**

- **Given** a route change that drops a `helmet` header
- **When** `sec-dast` runs OWASP ZAP against the real running local API
- **Then** the scan fails naming the URL and the missing-header alert

**Scenario: An iOS Swift vulnerability is caught by SAST**

- **Given** a Swift change that hardcodes a key or stores sensitive data insecurely
- **When** `sec-sast-swift` analyzes the iOS code
- **Then** it fails naming the file and the security rule

**Scenario: A high-entropy secret with no known prefix is caught**

- **Given** a commit containing a random 40-character token (matching no known-prefix regex)
- **When** gitleaks runs in pre-commit / CI
- **Then** it fails naming the file and line — the class the old regex missed
- **And** the reported output does NOT print the secret value

**Scenario: A disallowed-license dependency is blocked**

- **Given** a new npm dependency under AGPL-3.0
- **When** `sec-license` runs against the reviewed allowlist
- **Then** it fails naming the package and its license

**Scenario: Test-fixture secrets are not false-flagged**

- **Given** the existing intentional secret-shaped fixtures used by the secret-regex tests
- **When** gitleaks runs
- **Then** those reviewed, allowlisted paths do not fail the scan
- **And** the allowlist cannot grow without review

**Scenario: Security verdict reaches the public page**

- **Given** a completed security run
- **When** SHY-0220's page reads the security `metadata.json`
- **Then** it can show "Safety checks ✓" (counts only, no sensitive detail)

## Test Plan

**Classification:** real-only, defensive. `sec-dast` scans the REAL running local API; `sec-secrets`/`sec-license`/`sec-sast-swift` operate on the real repo/deps/iOS code. No mocked scanner results. Host-runnable unit portion: allowlist parsers (`.gitleaks.toml` scope, license allowlist) + the metadata normalizer adapters.

### Red — write failing tests first

- `sec-dast`: a fixture route with a deliberately-missing header proves ZAP fails; the real API passes.
- `sec-sast-swift`: a fixture Swift file with an obvious insecure pattern proves the analyzer fails; the real code passes (after fixes).
- `sec-secrets`: `express-api/tests/scripts/security/gitleaks.test.js` — `it('catches a high-entropy no-prefix secret')`, `it('does not flag allowlisted test fixtures')`, `it('never prints the secret value')`.
- `sec-license`: `it('fails an AGPL dependency')`, `it('resolves MIT OR Apache-2.0 to permitted')`, `it('evaluates transitive deps')`.
- Config meta-tests: `it('codeql config includes swift or documents the fallback')`, `it('metadata records severity counts only, no sensitive detail')`.

### Green — implement

1. Add OWASP ZAP baseline/API scan against the local API (authenticated) + wire as `sec-dast`.
2. Extend `codeql-config.yml`/`codeql.yml` to add `swift` (or add the documented $0 fallback) as `sec-sast-swift`.
3. Add gitleaks to `.husky/pre-commit` + CI with `.gitleaks.toml`; register `sec-secrets`.
4. Add `license-checker` + Gradle license report with the reviewed allowlist; register `sec-license`.
5. Register all four; write `docs/testing/security.md`; **fix every real finding at root** (headers, iOS flaws, rotate any real leaked secret, replace disallowed-license deps).

### Gauntlet

Touches backend (DAST hits `express-api`) + iOS (`iosApp/**` SAST) + CI plumbing → FULL Pre-Merge Testing Protocol for the backend/iOS-touching parts; DAST proven against the real local + dev API, Swift SAST proven on the real iOS build, before merge.

## Out of Scope

- Penetration testing by an external firm / bug bounty (valuable, separate, not $0-automatable) — this story is the automated regression net.
- Full active-attack DAST (long-running) as a PR gate — baseline/API scan gates PR; deep active scan is on-demand.
- Runtime WAF / production intrusion detection (ops concern; overlaps SHY-0224 synthetic).
- Replacing CodeQL/Dependabot (they stay — this deepens around them).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes a security signal to SHY-0220.
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata). Uses the existing local stack + test personas (DAST auth) + the iOS build.
- **Tooling:** OWASP ZAP ($0); CodeQL Swift (included) or a $0 fallback; gitleaks ($0); `license-checker` + a Gradle license plugin ($0). All $0.

## Risks & Mitigations

- **Risk:** DAST false positives create noise. **Mitigation:** Baseline scan with a reviewed alert-threshold config; real findings fixed, false positives documented in a reviewed allowlist that can't grow silently.
- **Risk:** CodeQL-Swift is heavy on the CI image / needs a full iOS build. **Mitigation:** Evaluate cost; if over budget, use the documented $0 fallback Swift security linter — the AC accepts either, provided iOS is genuinely analyzed.
- **Risk:** gitleaks flags historical/test-fixture secrets and blocks everything. **Mitigation:** Scoped `.gitleaks.toml` allowlist for reviewed fixture paths; any REAL historical secret is rotated + purged, not just ignored ([[feedback-root-cause-not-symptom]]).
- **Risk:** License allowlist too strict/loose. **Mitigation:** Reviewed permitted-license list; dual-license resolution; transitive evaluation; a genuinely-needed exception is an explicit reviewed entry.
- **Risk:** Publishing security counts leaks attack surface. **Mitigation:** SHY-0220 shows counts/status only (never finding detail); full reports stay in access-appropriate CI artifacts.
- **Risk:** Being read as offensive tooling. **Mitigation:** Strictly first-party/defensive — own local/dev API only, no third-party targeting, documented authorization.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `sec-dast` (ZAP vs real API), `sec-sast-swift` (iOS analyzed), `sec-secrets` (gitleaks entropy), `sec-license` (allowlist) all green with real findings fixed at root.
- [ ] All four registered; `docs/testing/security.md` present + plain-language + documents existing controls; `metadata.json` emits severity counts only.
- [ ] Any real leaked secret rotated + purged; disallowed-license deps replaced or explicitly excepted.
- [ ] `code-reviewer` + security review 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0217-security-deepening-dast-sast-secrets-license`; PR title `SHY-0217: Security deepening — DAST, Swift SAST, entropy secret-scan, license compliance`; relevant gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator listed security explicitly). Grounded in the audit's correction that security is NOT absent — this is a **deepening** targeting the four verified holes (DAST / Swift SAST / entropy secrets / license), not a rebuild. Strictly defensive, first-party, $0. `docs/testing/security.md` documents the full picture (existing CodeQL/Dependabot/etc. + the new four) so the public/operator view is honest. SHY-0220 surfaces counts only, never finding detail.
