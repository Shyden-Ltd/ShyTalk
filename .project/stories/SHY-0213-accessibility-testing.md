---
id: SHY-0213
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

# SHY-0213: Accessibility (a11y) testing — web, Android, iOS

## User Story

As a ShyTalk user who relies on assistive technology (screen reader, large text, high contrast, switch access), I want the app and website to be automatically checked against WCAG 2.2 AA on every change, so that sign-in, voice rooms, messaging, payments, and safety controls are actually operable for me — and as the operator I want a **real, automated a11y framework on all three surfaces** so accessibility can't silently regress before an MVP that must be usable by everyone (including minors who may use accessibility features).

## Why

The audit confirmed **zero accessibility testing** exists today — no axe-core, no pa11y, no Lighthouse a11y, no Espresso `AccessibilityChecks`, no iOS accessibility audit. For a social app that must be inclusive (and, for a minors-facing product, defensibly so), shipping with no a11y signal is an MVP-launch risk: contrast failures, unlabeled controls, and tiny touch targets are exactly the defects that make an app unusable for disabled users and invite complaints/legal exposure. This story adds the **real** a11y frameworks — driving real browsers and real devices (per EPIC-0003 real-only policy) — and registers them into SHY-0212's runner so a non-engineer can run `npm run test:all` and see an accessibility verdict, and SHY-0220 can show "Sign-in: accessible ✓" in plain language.

## Acceptance Criteria

### Happy path

- [ ] **Web (`@axe-core/playwright`):** an axe-core scan runs inside Playwright against every significant page/state — public roadmap, sign-in (OAuth + email-OTP entry), room list, in-room, messaging, payments/wallet, admin — asserting **zero `critical` and zero `serious`** WCAG 2.1/2.2 AA violations. Files: `tests/a11y/*.a11y.spec.ts`.
- [ ] **Android (Espresso `AccessibilityChecks` + Compose semantics):** instrumented tests on a real device enable `AccessibilityChecks.enable().setRunChecksFromRootView(true)` and walk the key screens, asserting every actionable node has a non-empty `contentDescription`/semantics, touch targets ≥ 48dp, and text contrast ≥ 4.5:1. Files: `app/src/androidTest/java/com/shyden/shytalk/a11y/*A11yTest.kt`.
- [ ] **iOS (`performAccessibilityAudit`):** XCUITest on a real iPhone calls `XCUIApplication().performAccessibilityAudit(for:)` on each key screen covering contrast, dynamic type, element detection, hit region, sufficient element description, and trait audits — zero unignored findings. Files: `iosApp/iosAppUITests/A11yAuditTests.swift`.
- [ ] All three register into `scripts/test/framework-registry.mjs` (web = `stack`, Android/iOS = `device`, `publicArea: Cross-cutting`) with `docs/testing/accessibility.md` explaining in plain language what "accessible" means here and how to run each.
- [ ] Each emits the normalized `metadata.json` (SHY-0212 contract) so SHY-0220 can surface an a11y status per surface.

### Error paths

- [ ] A newly-introduced axe `critical`/`serious` violation (e.g. a button with no accessible name, a 3:1 contrast text) **fails** the web a11y suite with a message naming the rule id, the WCAG criterion, and the CSS selector of the offending node — not a generic pass/fail.
- [ ] An Android control added without a `contentDescription`/semantics label fails the Espresso check naming the view + the check class.
- [ ] An iOS screen that clips text at the largest Dynamic Type size fails `performAccessibilityAudit` with the specific element + audit type.
- [ ] The suites fail (not skip) if the target surface can't be reached (web page 404, app screen not navigable) — no false green ([[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] Modal/overlay states are audited, not just base screens — sign-in error snackbar, device-locked dialog, ban/suspension screens, push-permission banner (these are exactly the states a screen-reader user gets stuck in if focus isn't trapped/announced).
- [ ] A legitimately-decorative image asserted as `role=presentation`/`importantForAccessibility=no` does NOT trip the "missing label" check (correctly-hidden decoration is allowed).
- [ ] Dynamically-injected content (room list populating, incoming message) is audited after it settles, not mid-animation (deterministic wait on the settled state, no arbitrary sleeps).
- [ ] A documented, reviewed **allowlist** of known-accepted findings (with rationale + owning follow-up SHY) is honored, but the allowlist file is diff-reviewed and cannot grow silently — an unexplained suppression fails review.

### Performance

- [ ] Adding axe to a Playwright page adds < 2s per page (axe runs in-page on the settled DOM); the web a11y suite total is bounded and reported.
- [ ] The Android/iOS audits run within the existing instrumented-test budget (they piggyback on screens the device gauntlet already visits — no separate app launch per assertion where avoidable).
- [ ] N/A for runtime app performance — a11y checks are test-time only; they add no production code path.

### Security

- [ ] A11y scans read rendered UI only; they introduce no new backend access and no new client→backend path (all app data still flows via the Express API — [[feedback-no-direct-backend-all-via-api]]).
- [ ] A11y result artifacts (axe JSON, audit reports) carry no PII — screen text captured in violation nodes is scrubbed of any seeded user PII before upload (belt with SHY-0223).

### UX

- [ ] Failure output tells a human exactly what a disabled user would experience ("the 'Join room' button has no name a screen reader can announce") plus the rule + fix pointer — not just a rule code.
- [ ] `docs/testing/accessibility.md` explains WCAG 2.2 AA in plain terms and how to run each surface's check with one command.

### i18n

- [ ] Content descriptions / accessibility labels are pulled from the localized `strings.xml` (all active locales), not hardcoded English — a test asserts a labeled control's accessible name resolves through the resource system.
- [ ] Dynamic Type (iOS) / font-scaling (Android, up to the largest system setting) does not clip or truncate localized text on the key screens — audited at max scale.
- [ ] RTL layout (Arabic) mirrors correctly on the audited screens — no reversed/overlapping controls (asserted under an RTL locale on device).

### Observability

- [ ] Each surface writes its `metadata.json` with `publicArea: Cross-cutting` and per-screen violation counts, feeding a plain-language "Accessible on web / Android / iOS" signal for SHY-0220.
- [ ] Full axe JSON + iOS audit reports + Espresso check logs are uploaded as CI artifacts for engineers, greppable by `[framework:a11y-web|a11y-android|a11y-ios]`.

## BDD Scenarios

**Scenario: An unlabeled web control fails the a11y gate**
- **Given** the sign-in page has a button with no accessible name
- **When** the web a11y suite runs axe-core against the page
- **Then** the suite fails
- **And** the output names the axe rule (`button-name`), the WCAG criterion, and the element selector

**Scenario: A low-contrast text regression is caught on Android**
- **Given** a screen adds body text at 3:1 contrast against its background
- **When** the Android `AccessibilityChecks` suite runs on a real device
- **Then** the suite fails naming the view and the contrast check

**Scenario: iOS Dynamic Type clipping is caught**
- **Given** a localized label that truncates at the largest Dynamic Type size
- **When** `performAccessibilityAudit` runs on a real iPhone
- **Then** the audit reports a dynamic-type/text-clipping finding for that element

**Scenario: Correctly-hidden decoration does not false-fail**
- **Given** a purely decorative image marked as presentation/hidden from accessibility
- **When** the a11y suites run
- **Then** no "missing label" violation is raised for that image

**Scenario: Accessibility labels are localized**
- **Given** the app is running under a non-English active locale
- **When** the a11y suite inspects a labeled control's accessible name
- **Then** the name matches the localized `strings.xml` value, not English

**Scenario: A11y verdict reaches the public page**
- **Given** a completed a11y run across all three surfaces
- **When** SHY-0220's page reads the a11y `metadata.json`
- **Then** it can show "Accessible ✓" (or a plain-language issue count) per surface

## Test Plan

**Classification:** real-only across all three surfaces. Web axe runs against the REAL local-served web in a REAL browser (Playwright, `stack`); Android/iOS audits run on REAL devices (`device`). No mocked DOM, no simulated a11y tree. The only host-runnable unit portion is the allowlist parser + the metadata normalizer adapter.

### Red — write failing tests first

- Web: `tests/a11y/sign-in.a11y.spec.ts`, `room-list.a11y.spec.ts`, `messaging.a11y.spec.ts`, `payments.a11y.spec.ts`, `admin.a11y.spec.ts`, `public-roadmap.a11y.spec.ts` — each `test('has zero critical/serious axe violations')` + a deliberately-broken fixture page proving the gate fails.
- Android: `SignInA11yTest.kt`, `RoomA11yTest.kt`, `MessagingA11yTest.kt` — `@Test fun everyActionableHasAccessibleName()`, `fun touchTargetsAtLeast48dp()`, `fun textContrastMeetsAA()`, plus a RED test that adds an unlabeled control and asserts the check catches it.
- iOS: `A11yAuditTests.swift` — `func testSignInPassesAccessibilityAudit()`, `testRoomPassesAccessibilityAudit()`, `testMessagingPassesAccessibilityAudit()`, each `performAccessibilityAudit(for: [.contrast, .dynamicType, .elementDetection, .hitRegion, .sufficientElementDescription, .trait])`.
- i18n: an RTL + max-font-scale variant per surface.
- Allowlist gate: `it('a suppression without a rationale + follow-up SHY fails review parsing')`.

### Green — implement

1. Add `@axe-core/playwright` (dev dep, root) + the web a11y specs.
2. Enable `AccessibilityChecks` in the Android instrumented harness + add the a11y instrumented tests.
3. Add the iOS `A11yAuditTests.swift` XCUITest target tests.
4. Register all three in the framework registry + write `docs/testing/accessibility.md` + the reviewed allowlist file.
5. Fix every real a11y defect surfaced (labels, contrast, target sizes, focus order) until the gates are green — real product fixes, not suppressions.

### Gauntlet

Touches app (`app/**`, `iosApp/**`) + web (`public/**` / web app) → FULL Pre-Merge Testing Protocol: local gauntlet on real Android + real iOS + all browsers (web a11y specs run in the browser matrix), TalkBack/VoiceOver manual sanity walk on device, dev gauntlet, judgment-merge.

## Out of Scope

- Fixing a11y issues that require large product redesigns beyond making the gates green — any deep redesign surfaced is filed as its own follow-up SHY with the finding recorded here.
- Full manual audit by a certified accessibility specialist (valuable but separate; this story is the automated regression net).
- WCAG AAA (target is AA — the defensible MVP bar).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** none directly, but contributes an a11y signal SHY-0220 surfaces.
- **Blocked by:** SHY-0212 (registry + runner + docs skeleton + metadata contract). Uses the existing Playwright + Android instrumented + iOS XCUITest harnesses.
- **Tooling:** `@axe-core/playwright`; AndroidX `espresso-accessibility` / Compose test; Xcode `performAccessibilityAudit` (Xcode 15+ — already on the CI image per `ios-tests.yml`).

## Risks & Mitigations

- **Risk:** axe/audit floods with pre-existing findings, tempting blanket suppression. **Mitigation:** Fix real defects; the allowlist is diff-reviewed, each entry needs a rationale + a follow-up SHY, and it cannot grow silently (review gate) — never a wholesale ignore ([[feedback-never-suppress-fix-or-upgrade]]).
- **Risk:** Flaky waits on dynamic content produce intermittent a11y failures. **Mitigation:** Deterministic settled-state waits (no `sleep`), audit after content settles; a flaky finding is treated as a real bug to root-cause, not retried away ([[feedback-no-auto-retry-workflows]]).
- **Risk:** Contrast checks disagree across tools/platforms. **Mitigation:** WCAG AA ratios (4.5:1 text / 3:1 large) are the single spec; each platform's check is configured to that ratio; discrepancies documented in `docs/testing/accessibility.md`.
- **Risk:** iOS `performAccessibilityAudit` is newer and may need issue-type tuning. **Mitigation:** Enumerate the exact audit types, ignore only with documented rationale, prove on a real device before merge.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] Web a11y (zero critical/serious), Android `AccessibilityChecks`, iOS `performAccessibilityAudit` all green on the real browser matrix + real devices.
- [ ] All three registered in the framework registry; `docs/testing/accessibility.md` + reviewed allowlist present.
- [ ] `metadata.json` emitted per surface; SHY-0220 can consume it.
- [ ] Every real a11y defect surfaced during the story is fixed (not suppressed).
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review` before merge; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0213-accessibility-testing`; PR title `SHY-0213: Accessibility (a11y) testing — web, Android, iOS`; FULL gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator listed accessibility explicitly). WCAG 2.2 AA chosen as the defensible MVP bar (AAA out of scope). Real-only: axe drives the real browser DOM, mobile audits run on real devices — no simulated a11y trees. i18n dimension is load-bearing here (Dynamic Type/font-scale + RTL + localized labels are a11y concerns). Deliberately reuses the existing Playwright/Android-instrumented/iOS-XCUITest harnesses rather than adding parallel infra.
