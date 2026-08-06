# Testing frameworks audit — 2026-07-19

**Method:** every claim below was verified against **source** (`.github/workflows/*`, `package.json` ×2, `.husky/*`, `build.gradle.kts`, `scripts/*`, the test trees), NOT against `CLAUDE.md` or memory. This is the evidence base for **EPIC-0008** (comprehensive, self-serve, publicly-visible testing).

**Headline:** the project is *stronger* than assumed on functional + supply-chain security, and has a real, specific set of missing test *types*. The audit corrected three of my own priors: security is **not** absent (CodeQL + Dependabot + secret-regex + supply-chain pinning exist), Firestore **rules** are tested (`@firebase/rules-unit-testing`), and age-verification **is** functionally tested (5 Express suites).

---

## 1. What exists today (verified)

### Functional / quality
| Framework | Where | Run command (today) | CI workflow |
|---|---|---|---|
| Kotlin/JVM unit | `shared/src/{commonTest,jvmTest}`, `app/src/test` | `./gradlew testDevDebugUnitTest :shared:jvmTest` | `pr-checks.yml` |
| detekt / ktlint | Kotlin | `./gradlew detekt` / `ktlint --relative` | `lint.yml` |
| Express unit+integration | `express-api/tests` | `cd express-api && npm test` (Jest+supertest) / `npm run test:coverage` | `test-backend.yml` |
| eslint (+sonarjs) / prettier | JS | `cd express-api && npm run lint` / `format:check` | `lint.yml` |
| Playwright web e2e | `tests/` | `npm run test:web` | `playwright-tests.yml`, `e2e-tests.yml` |
| Playwright integration | `tests/` | `npm run test:integration` | `integration-tests.yml` |
| Android instrumented BDD (~235) | `app/src/androidTest` | `./gradlew connectedDevDebugAndroidTest` | (device — operator-gated) |
| iOS XCTest | `iosApp/iosAppTests` | `xcodebuild test …` | `ios-tests.yml` |
| iOS UI (Appium) | `iosApp/iosAppUITests/ManualQARemoteControl.swift` | via `manual-qa-runner.js` | `manual-qa-matrix.yml` |
| Manual-QA journey matrix (real device × browser) | `express-api/scripts/manual-qa-runner.js`, `journey-tests/*` | `node manual-qa-runner.js` | `manual-qa-matrix.yml` |
| **Firestore rules tests** | `@firebase/rules-unit-testing` | (emulator) | — |

### Security (verified present — NOT a wholesale gap)
- **CodeQL SAST** (`codeql.yml`, `.github/codeql/codeql-config.yml`) — scans **JavaScript + Kotlin only** (⚠️ **Swift NOT scanned**).
- **Dependabot** (`dependabot.yml`) + auto-merge (`dependabot-auto-merge.yml`) + `express-api/package.json` `overrides` block (manual CVE pins) — dependency/CVE.
- **Supply-chain:** `scripts/check-action-shas.sh` (SHA-pin all 3rd-party actions).
- **Secret scanning:** `.husky/pre-commit` regex (blocks `AIzaSy…`/`sk-…`/`ghp_…`/`AKIA…`/PRIVATE KEY/`password=…`) — basic, not entropy-based.
- **Architectural:** `check-no-direct-backend.js` (API-only ratchet), `check-no-new-stubs.js` (no-fakes ratchet).
- **Runtime middleware:** `helmet`, `express-rate-limit` (prod).
- **Quality gate:** SonarCloud (`sonarcloud.yml`, pre-push scan).

### Compliance (partial)
- Age-verification **functionally** tested: `express-api/tests/{utils/age-verification-*,routes/age-verification,routes/admin-age-verification}.test.js` (5 suites). No cohesive GDPR (export/delete) or UK-OSA suite.

### Reporting
- **Allure** (`allure-report.yml`, `allure-playwright`): reusable workflow → per-suite HTML on **GitHub Pages** (`<owner>.github.io/<repo>/<suite>/<env>/latest/`), trend history, `metadata.json`(passed/failed/total). **Problems:** developer-jargon (suites/steps/stacktraces — not public-legible); **bloat-prone** (gh-pages hit 12.75 GiB, mitigated by SHY-0128 history-cap); fragmented per-suite.
- **SonarCloud** dashboard (separate).

---

## 2. Confirmed gaps (evidence: tool absent from every `package.json`/gradle/workflow)
| Gap | Scope | Evidence |
|---|---|---|
| **Accessibility (a11y)** | web + Android + iOS | no axe-core/pa11y/lighthouse; no AccessibilityChecks |
| **Performance / load** | API, LiveKit voice, web, mobile | no k6/artillery/autocannon/lighthouse |
| **Visual regression** | web + Android + iOS | no percy/argos/pixelmatch/backstop; no `toHaveScreenshot`; no paparazzi/roborazzi |
| **Mutation testing** | JS + Kotlin | no Stryker; no Pitest |
| **DAST** | running API | no OWASP-ZAP/nuclei |
| **Swift/iOS SAST** | iOS | CodeQL config excludes Swift |
| **Contract tests** | client↔API schema | no pact/openapi/dredd (relevant: ALL client access is via Express) |
| **License compliance** | deps | no license-checker/licensee/fossa |
| **Compliance suite** | GDPR export/delete, UK OSA | only age-verif functionally covered |
| **Synthetic / uptime** | post-deploy prod | none |
| **Public report page** | site | none (Allure is internal-facing + jargon) |
| Secret-scan depth | repo | regex only (no entropy/gitleaks) |
| *Candidates (operator: "anything else")* | — | fuzz/property, i18n-depth (pseudo-loc/RTL/missing-key gate), PII-leak/log-privacy, chaos/resilience |

---

## 3. Runnability + docs (the "without Claude" gap)
Today each framework has *a* command, but there is **no single aggregate runner**, docs are scattered (mostly in `CLAUDE.md`, which is internal), and several suites are effectively Claude/CI-triggered rather than a documented human one-liner. EPIC-0008 requires: **one documented human command per framework + one top-level "run everything" command + CI**, each with a plain-English README a non-engineer could follow.

---

## 4. Reporting recommendation
Allure is the wrong lens for a **public, non-technical** audience (jargon + bloat). Recommendation:
- **Internal:** keep a *slimmed* Allure (or lean on SonarCloud) for engineers.
- **Public:** a **$0 static "health" page** on the public site that rolls the per-suite `metadata.json` into **user-facing areas** — *Safety, Sign-in, Voice rooms, Messaging, Payments* — as green/amber/red + "last checked" + a simple trend. **Simple summary on top, expandable detail below** (operator's choice). Plain language, no test-jargon.
- Rejected: ReportPortal / testspace (hosting cost / external dependency — breaks the $0 rule).

---

## 5. Recommendations → EPIC-0008 child stories
Each confirmed gap becomes one fully-refined child story (SHY-0212…0225), every new framework built **real-only** (per EPIC-0003 policy) with a human command + aggregate-runner hook + CI + README. The whole set is a hard MVP-launch blocker (operator). See `EPIC-0008-comprehensive-visible-testing.md`.
