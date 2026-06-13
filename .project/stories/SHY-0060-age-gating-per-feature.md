---
id: SHY-0060
status: Draft
owner: claude
created: 2026-06-08
priority: P0
effort: XL
type: feature
roadmap_ids: []
phase: Safety & Compliance
public: false
pr:
mvp: true
---

# SHY-0060: Age-gating per feature — replace single 13+ signup gate with tiered per-feature age thresholds

## User Story

As **(a)** a young teen ShyTalk user, **(b)** a ShyTalk operator subject to COPPA / EU age-of-digital-consent / Apple/Google store age-rating policies, and **(c)** a parent/guardian whose child is on the platform, I want **age-sensitivity applied per feature rather than as a single 13+ gate at signup** so that a 13-year-old can use the platform's safe surfaces (read public rooms, gain followers via profile content) without simultaneously being exposed to higher-risk surfaces (real-money gifting, predator-vector DMs-with-strangers, voice-chat moderation gaps) that have stricter platform-policy minimum ages.

## Why

Current implementation: single 13+ verification at signup. Pass-once-access-everything. This is the lowest-bar interpretation of COPPA (13+ = "child" boundary in US law) but fails several stricter regulatory + commercial constraints:

- **COPPA addendum (FTC 2023 amendments)**: features that "collect, use, or disclose personal information from children" — including DM content, voice recordings — require explicit verifiable parental consent at HIGHER thresholds than the platform's general minimum age. Single 13+ gate doesn't model the per-feature consent step.
- **EU GDPR Article 8 (age of digital consent)**: varies by member state from 13 (UK, Spain) to 16 (Germany, Netherlands). A user from Germany passing a single 13+ gate at signup is non-compliant.
- **Apple App Store + Google Play age-rating policies**: voice-chat features (live audio with strangers) require 17+ rating in some jurisdictions; gifting/real-money features require 18+ in EU/UK due to gambling-adjacent rules; DM-with-strangers triggers child-safety review thresholds independent of the app's overall age rating.
- **Brand/safety risk**: predator-vector DMs-with-strangers + voice rooms with under-16s are the #1 platform-safety attack surface for Trust & Safety incidents on competitor platforms (Discord, Roblox, Snap). Single 13+ gate offers no defense.
- **Internal: roadmap surface promise**: the `currentlyWorkingOn` JSON entry has surfaced "Age-gating per feature" to public visitors since file inception. Removing it without a real implementation would be a credibility regression for the public roadmap.

This SHY captures the FULL per-feature age-gating design as the source-of-truth spec for whoever picks up the implementation. It also satisfies the SHY-0038 precondition: the public roadmap's `currentlyWorkingOn` array requires a corresponding `In Progress + public: true` SHY to surface this item under the authoritative-sync model.

## Acceptance Criteria

### Happy path

- [ ] **Per-feature age threshold table** is defined in a single source-of-truth config file (`shared/src/commonMain/kotlin/com/.../safety/AgeThresholds.kt` — exact path TBD by the implementer per current shared-module layout). Required entries (minimum):
  - `signup` → 13 (unchanged from today's single gate)
  - `publicRoomBrowse` → 13 (passive consumption is safe at COPPA baseline)
  - `publicRoomActiveJoin` → 13 (active participation in voice/text public rooms — moderated)
  - `directMessageWithFollowedUser` → 13 (DMs with users the teen has followed — bidirectional consent)
  - `directMessageWithStranger` → 18 (DMs with non-mutual users — predator-vector; raise to 18 globally for safety)
  - `voiceRoomActiveSpeaking` → 16 (active mic in voice rooms — moderation-harder than text)
  - `giftingSend` → 18 (real-money gifting — gambling-adjacent, 18+ in EU)
  - `giftingReceive` → 16 (can receive gifts; under-18 cannot spend real-money equivalent)
  - `profileMatureContent` → 18 (NSFW profile content flag — already exists today, integrate with new framework)
  - `gachaSpend` → 18 (loot-box mechanics — 18+ in jurisdictions with loot-box gambling laws e.g. NL, BE)
- [ ] **Region-aware overrides**: for EU member states where GDPR Article 8 sets digital-consent age to 14/15/16, the `signup` threshold is dynamically raised based on the user's verified country/region (existing region-detection signal already used by the i18n layer). Implemented as a region-override map keyed by ISO country code.
- [ ] **Per-feature gate-check API** at each feature entry-point: a `safetyGate.canAccess(feature: Feature, user: User): GateResult` function called BEFORE rendering the feature UI. `GateResult` is a sealed class: `Allowed | BlockedUnderAge(threshold: Int, requiredVerification: VerificationKind) | BlockedRegion(reason: String)`.
- [ ] **Existing single-gate signup flow REMAINS the entry point** for verified-age provenance — users still verify age once at signup; the new per-feature checks read from the verified-age store, not re-prompt at each feature.
- [ ] **Blocked UX**: when a feature returns `BlockedUnderAge`, the UI shows a localised, non-condescending explanatory state ("This feature is available at <N>+. Voice rooms aren't quite ready for you yet — try public rooms in the meantime."). NOT a hard error.
- [ ] **Audit log**: every blocked attempt logs `{ userId (hashed), feature, threshold, userAge, region, timestamp }` to the existing safety-audit Firestore collection. Used for compliance reporting + abuse detection (repeated failed attempts on age-gated features).
- [ ] **Settings → Privacy & Safety** screen gains a "Feature access by age" section showing the user which features are currently accessible / blocked + why. Transparent UX.
- [ ] **All 10 minimum features above (signup, publicRoomBrowse, ..., gachaSpend) have integration tests** verifying the gate is enforced server-side AND client-side (defense-in-depth — never trust client age claim).

### Error paths

- [ ] **Missing verified age**: if `user.verifiedAge` is null (legacy account predating verification, OR verification API failure), gate returns `BlockedUnderAge(requiredVerification = Reverify)`. UI shows "We need to confirm your age to use this feature" + flow to existing age-verification screen.
- [ ] **Tampered client age claim**: if the client sends a request claiming an age that doesn't match the server's verified-age record, the server REJECTS with 403 + logs `{ severity: ALERT, type: AGE_CLAIM_TAMPER, userId }`. T&S team receives webhook on this signal.
- [ ] **Region detection failure**: if region cannot be detected (VPN, blocked geolocation), use the conservative max of all region thresholds (e.g. signup defaults to 16 instead of 13). UX: small banner explaining "We couldn't detect your region — using EU-strict thresholds; update your profile country for accurate gating."
- [ ] **AgeThresholds config malformed at deploy**: server-side validator on the config file fails CI if any entry's threshold is < 13 (COPPA floor) or > 21 (sanity max). Prevents accidental misconfiguration.
- [ ] **Migration: existing accounts pre-dating verified-age system**: a one-shot backfill job marks them as `verifiedAge: null + signupDateBeforeVerification: true`. Until they re-verify, they're treated as `BlockedUnderAge(requiredVerification = Reverify)` for ANY feature with threshold >13. Aggressive but right — we cannot grandfather unverified accounts into the more permissive paths.

### Edge cases

- [ ] **Age birthday rollover**: a user turning 18 mid-session immediately unlocks 18+ features on next gate-check (no re-login required). Implemented via server-side age computation from stored DOB at each gate-check (no client-side caching of "you are 17" state).
- [ ] **Country migration**: a user changes their profile country (e.g. moves from UK to Germany) → next gate-check uses the new region's thresholds. May result in a feature becoming blocked that was previously available. UX: one-time warning banner "Your access to some features changed because of your new country setting."
- [ ] **DM-with-stranger threshold + follow-after-DM**: if A (18+) DMs B (15+) when B is a stranger → blocked. If A then follows B and B reciprocates → DM becomes available (mutual-follow downgrades stranger→known). State transition tested.
- [ ] **Voice room joining (under-16)**: under-16 user joining a voice room → can listen (active=false), cannot mic (active speaking blocked). Mid-room mic-attempt by under-16 → gate-check fires + UI explains.
- [ ] **Gift received by under-18 (giftingReceive=16 allows it)**: gift card UI shows but "real-money cash-out" option hidden until 18. Internal account credit accumulates normally.
- [ ] **A/B test or feature flag bypass**: NO feature flag may override an age threshold downward. Upward overrides (raising threshold temporarily) ARE allowed for incident-response. Hard-coded test in CI prevents downward bypass.

### Performance

- [ ] Gate-check latency: <10ms at the entry-point (server-side single-doc read from the cached user profile). Verified by load-test on the gate-check Firestore call path.
- [ ] No additional Firestore reads per feature use after the initial gate-check passes (cached for the session up to a 1-hour TTL, refreshed on age-affecting events: country change, birthday, manual re-verification).
- [ ] Client-side gate-check (cached profile read): <1ms. No network call on the hot path after first load.
- [ ] Audit log writes are fire-and-forget (no blocking on the gate result).

### Security

- [ ] **Server-side enforcement is authoritative** — every age-gated server endpoint (DM-send, gift-send, voice-room-mic-on, gacha-spin, etc.) MUST re-verify the gate result independently. Client-side check is UX-only.
- [ ] **Verified-age provenance**: age is verified via the existing provider (ID-doc upload + matching algorithm — assumed already in place per SHY-0007 age_verification.feature). Re-verification window: 1 year (after which user is prompted to re-verify).
- [ ] **PII handling**: DOB is stored encrypted at rest in the user profile (existing pattern). Hash of DOB used in audit logs (never plaintext).
- [ ] **Bypass via direct API**: rate-limit the `safetyGate.canAccess` call at 100 req/min/user to prevent enumeration attacks (someone scripting to find each feature's threshold). Excess triggers temporary account suspension + T&S review.
- [ ] **No leakage of other users' ages**: gate-check API returns only the result for the calling user, never an "is this other user old enough?" query. Prevents stalker-vector age discovery.

### UX

- [ ] Blocked-feature UI uses Material 3 (Android) / SwiftUI (iOS) idiomatic components — not custom alerts. Matches the existing settings/privacy screen language.
- [ ] Localised in all existing supported languages (11 locales — EN + ar/de/es/fr/hi/id/ja/ko/pt/zh).
- [ ] Accessible: screen reader announces threshold + explanation; touch target ≥44px for any "learn more" action.
- [ ] No condescending language. Test copy with a sample of teen users before ship (T&S team owns copy review).
- [ ] Settings → "Feature access by age" screen has clear progress bar showing "available at 16, 18, 21" so user understands the trajectory.

### i18n

- [ ] New i18n keys (one per feature + one per error state) added to all 11 locales. Machine translation OK for first pass; native-speaker review per locale before GA.
- [ ] Region detection is language-independent (uses profile country, not browser language).

### Observability

- [ ] Metrics emitted (existing analytics framework):
  - `safetyGate.check.allowed.count{feature, region}`
  - `safetyGate.check.blocked.count{feature, region, reason}`
  - `safetyGate.check.tamper.count{userId hash, severity: ALERT}`
- [ ] Dashboard panel created on the existing T&S monitoring board showing blocked-attempt rates per feature per region. Spike detection alerts T&S on >2x baseline.
- [ ] Audit log retention: 90 days (matches existing safety log retention policy).

## BDD Scenarios

**Scenario: 14yo passes signup gate but gets blocked at DM-with-stranger**

- Given a user "Alex" has verified age 14 and country UK
- And Alex is browsing public rooms successfully
- When Alex attempts to DM a non-mutual user "Stranger"
- Then the gate returns `BlockedUnderAge(threshold: 18, feature: directMessageWithStranger)`
- And the UI shows a localised explanation "Direct messages with people you don't follow are available at 18+. You can follow them first to start a conversation."
- And an audit log entry records `{ feature: directMessageWithStranger, userAge: 14, blocked: true }`

**Scenario: 17yo unlocks gifting on 18th birthday during active session**

- Given a user "Sam" has verified age 17 and is mid-session
- And the current time is 1 second before Sam's 18th birthday in their local timezone
- When Sam attempts to send a gift at the moment of birthday rollover
- Then the gate-check (server-side, fresh age computation) returns `Allowed`
- And the gift sends successfully
- And the audit log records `{ feature: giftingSend, userAge: 18, allowed: true }`

**Scenario: German 14yo gets stricter signup gate than UK 14yo**

- Given a user from Germany signs up claiming age 14
- And Germany's GDPR Article 8 region-override sets signup threshold to 16
- When the signup gate-check runs
- Then the signup is REJECTED with reason `BlockedRegion("Germany requires age 16 for account creation")`
- And the user is shown a localised explanation pointing to parental-consent flow
- Given a user from UK signs up claiming age 14
- And UK's region-override sets signup threshold to 13 (default)
- When the signup gate-check runs
- Then the signup is ALLOWED

**Scenario: Client tampers age claim — server rejects + alerts**

- Given a user "Mallory" has verified server-side age 15
- When Mallory's client sends a gift-send request with a forged claim `claimedAge: 19`
- Then the server gate-check compares against the verified record (15) not the claim
- And the request is REJECTED with HTTP 403
- And a `SAFETY_AGE_TAMPER_ALERT` is fired to the T&S incident webhook
- And Mallory's account is flagged for T&S review

**Scenario: Migration — legacy unverified account treated as Reverify required**

- Given a user "Legacy" created an account in 2024 (pre-verification system)
- And `Legacy.verifiedAge` is null
- When Legacy attempts to send a DM to any user
- Then the gate returns `BlockedUnderAge(requiredVerification = Reverify)` (regardless of DM target)
- And the UI flows Legacy through the existing age-verification screen
- And on successful verification, the gate is re-checked against the now-verified age

**Scenario: Country change downgrades access**

- Given a user "Hans" has verified age 15 and country Germany (signup threshold 16, but Hans was grandfathered in via verified parental consent)
- And Hans currently has access to voice rooms (threshold 16, region-default for Germany)
- When Hans changes their profile country to Spain (signup threshold 14, voice room threshold 16 — same)
- Then the gate-check still ALLOWS voice rooms (no change)
- Given Hans changes country to Netherlands (gachaSpend threshold 18 due to loot-box gambling laws)
- And Hans was previously in a region where gachaSpend was 16
- When Hans attempts a gacha spin
- Then the gate returns `BlockedUnderAge(threshold: 18, region: NL)`
- And a one-time banner explains "Your access to some features changed because your country is now Netherlands."

## Test Plan

- **Server-side Jest (`express-api/tests/safety/age-gate.test.js` — NEW)**: ≥60 cases covering all 10 features × allow/block paths + region overrides (UK, DE, ES, NL, US) + edge cases (null age, tampered claim, birthday rollover, country change).
- **Shared Kotlin tests (`shared/src/commonTest/kotlin/.../safety/SafetyGateTest.kt` — NEW)**: ≥40 cases covering the gate logic + threshold config integrity + region map correctness + AgeThresholds validator (no <13, no >21).
- **Android instrumentation (`app/src/androidTest/.../safety/AgeGateUiTest.kt` — NEW)**: ≥10 cases covering blocked-UX rendering + accessibility + screen-reader announcements + localisation across 3 sample locales (en, de, ar for RTL).
- **iOS XCUITest (`iosApp/iosAppUITests/AgeGateUITests.swift` — NEW)**: ≥10 cases mirroring Android.
- **BDD feature files**: `age_gate.feature` with the 6 BDD scenarios above + 4 more covering audit-log writes + metrics emission + rate-limit enforcement + bypass-flag rejection.
- **Manual QA**: T&S team runs through the per-feature blocked-UX in 3 locales (en, de, ar). Sign-off required before merge.
- **Compliance audit**: legal team reviews region-override map against current EU/UK/US regulations. Documented sign-off in PR description.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (touches Express, shared Kotlin, Android UI, iOS UI, BDD, web surfaces) → the FULL gauntlet applies, and as a **Safety & Compliance** feature the bar is absolute. The Test Plan above already names the per-framework suites; this is the device/browser gauntlet that gates the merge.

**Frameworks exercised (RED→GREEN before code — every one):**
- ✅ **Express/Node Jest** — `age-gate.test.js` (≥60 cases; server-side authoritative enforcement is the headline — the client age claim is never trusted).
- ✅ **Kotlin/JVM unit** — `SafetyGateTest` (≥40 cases incl. the AgeThresholds CI validator: no <13, no >21).
- ✅ **Android instrumented BDD + iOS XCUITest** — `AgeGateUiTest` + `AgeGateUITests.swift` (≥10 each) on a **real Android device AND a real iPhone**: every one of the 10 gated features blocked/allowed at its threshold, incl. RTL (ar) + screen-reader.
- ✅ **Web E2E (all browsers)** — the gated features that exist on web (public-room browse, DM, gifting, gacha) blocked/allowed at threshold across the `local` browser matrix (Mac chromium/firefox/webkit/edge + the device browsers).
- ✅ **Manual-QA journey matrix** — the `age_gate.feature` scenarios (14yo-blocked-at-DM-stranger, birthday-rollover-unlock, region-strict, tamper-reject, legacy-reverify, country-change-downgrade) walked end-to-end on real Android + real iPhone + web.
- ✅ **detekt + ktlint + iOS shared compile-check** — new shared `safety/` Kotlin passes static analysis + compiles for iOS.
- ✅ **eslint** (`--max-warnings=0`) on the new Express code + **SonarCloud** quality gate.
- ➕ **Human pre-merge gates (NOT skippable):** legal sign-off on the region-override map + T&S sign-off on the blocked-UX copy + Apple/Google age-rating re-submission if warranted — all BEFORE merge, documented in the PR.

**LOCAL gauntlet:** every framework suite green → all 10 gated features + the 6+ BDD scenarios walked on **real Android + real iPhone + ALL browsers on the Mac and devices** (server-side enforcement re-confirmed by attempting a tampered claim and seeing the 403). Any failure → fix TDD across all frameworks → restart the whole local gauntlet.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; re-walk every gated feature + audit-log + tamper-alert on real Android + real iPhone; web = Chrome only. Restart from LOCAL on failure. **Judgment-merge** only when production-ready with zero doubt AND legal + T&S sign-offs are in hand — a Safety/Compliance regression is the highest-stakes incident class on the platform.

## Out of Scope

- **Parental-consent flow** for under-13 users (separate SHY — out of scope; current spec assumes all users are at least 13 globally, except where region requires higher).
- **Age re-verification cadence below 1 year** — keep at 1-year window for this round; tighten if T&S signals abuse.
- **Per-feature WAITLIST flows** (user opts into "notify me when I'm old enough") — defer to follow-up SHY based on user demand.
- **Migration UI for the legacy unverified accounts** — assumed to use the existing age-verification screen as the re-verification flow. If that screen needs UX revision, that's a separate SHY.
- **Backfill of historical audit logs for actions taken under the single-gate system** — assume present-and-future audit; historical is intentionally not retroactively annotated.

## Dependencies

- 🚧 SHY-0007 (age_verification.feature BDD coverage) — provides the verified-age provenance system this SHY builds on. Status: Draft. May ship in parallel.
- ⬜ **Legal team sign-off on the region-override map** — required before merge. Operator coordinates with legal.
- ⬜ **T&S team sign-off on the blocked-UX copy** — required before merge. Operator coordinates with T&S.
- ⬜ **Product decision on the threshold table** — the values in AC happy-path are my proposal; final values are an operator/product decision. Spec captures the rationale (COPPA / GDPR / store policy / safety vectors) for each.
- ⬜ **Apple App Store + Google Play age-rating compliance check** — submit re-rating request if any threshold change triggers a new app rating. Operator coordinates with release management.

## Risks & Mitigations

- **Risk: legal interpretation of COPPA / GDPR Article 8 / EU loot-box laws shifts before ship.** Mitigation: threshold table is a single-file config — changing a number is a one-line patch + rebuild + deploy. Document this in the implementer's README.
- **Risk: existing users see features they previously had access to disappear.** Mitigation: one-time in-app communication to all affected users before the migration commit lands; opt-in window for the rollout (operator-controlled feature flag = "enable per-feature age gates" that gates the gate-check itself for staged rollout).
- **Risk: T&S blocked-UX copy reads as condescending to teens.** Mitigation: test with sample teen-user panel via T&S existing user-research channel before ship. Iterate copy based on signal.
- **Risk: client-side age claim tampering becomes a vector for evasion.** Mitigation: server-side enforcement is authoritative (AC line in Security). T&S alert on tamper attempts. Repeated tamper triggers temporary suspension.
- **Risk: region-override map gets stale as laws change.** Mitigation: legal-team annual review cadence (calendar event); document review date in the config file's header.
- **Risk: rate-limit on gate-check API causes false-positives for legitimate power users.** Mitigation: 100 req/min/user is generous (one gate-check per UI screen transition; rare power user hits ~30/min); monitor false-positive rate post-launch.
- **Risk: birthday-rollover edge case (timezone-sensitive computation).** Mitigation: server-side computation uses user's profile timezone, not server-UTC; unit test covers DST transitions + leap years.

## Definition of Done

- [ ] `AgeThresholds` config file authored in shared module with 10+ features + region-override map + CI validator.
- [ ] `SafetyGate.canAccess(feature, user)` API implemented + integrated at all 10 feature entry points (server-side + client-side defense-in-depth).
- [ ] All test suites authored + passing (Jest server + Kotlin shared + Android instrumentation + iOS XCUITest + BDD).
- [ ] Audit log integration verified end-to-end with sample blocked attempts in dev.
- [ ] Settings → "Feature access by age" screen authored in Android + iOS (11 locales).
- [ ] One-time in-app comms designed + scheduled for rollout day.
- [ ] Legal sign-off documented in PR description.
- [ ] T&S sign-off documented in PR description.
- [ ] Apple/Google age-rating re-submission filed if any threshold change warrants it.
- [ ] Operator-controlled feature flag for staged rollout (default OFF; flip to ON in production after T&S monitoring confirms baseline).
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): every framework suite green + all 10 gated features + the BDD scenarios green on **real Android + real iPhone + ALL browsers** (LOCAL) → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → legal + T&S sign-offs in hand → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.

## Notes (running log)

- 2026-06-08 ~19:05 BST — Spec authored as the migration target for the legacy `currentlyWorkingOn: "Age-gating per feature"` JSON entry preserved per SHY-0038's authoritative-sync design (operator decision 2026-06-08 ~19:00 BST: file fully-refined SHY-0060 in the SHY-0038 PR). Status is **In Progress** to preserve the legacy public-roadmap visibility; this is a continuity-of-visibility decision pending operator review of whether implementation work is actually in flight (if not, status should flip to Draft and the public roadmap's `currentlyWorkingOn` becomes empty until a real In Progress + public SHY exists). All AC values are my proposal grounded in COPPA/GDPR/store-policy research; final threshold values are an operator/product/legal decision. The 10 features + region-override map are starting points for that conversation, not finalised contracts.
- 2026-06-12 ~23:50 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): Safety & Compliance XL feature → every framework + all 10 gated features on real Android + real iPhone + ALL browsers + legal/T&S human sign-offs as pre-merge gates; bar is absolute. DoD → judgment-merge. **Pickup-fitness flag (for operator):** frontmatter `status: Draft` conflicts with the 2026-06-08 Note describing it as "In Progress to preserve public-roadmap visibility." As Draft + `public: true` it does NOT surface in `currentlyWorkingOn` (which requires `In Progress`). Operator to confirm the intended status + whether age-gating should appear on the public roadmap now; status NOT changed here (no transition without operator).
- 2026-06-13 ~01:45 BST — **Operator RESOLVED the status/visibility conflict** (AFK decision #3, 2026-06-13): keep `status: Draft` AND take it **OFF the public roadmap**. The 2026-06-08 Note's "Status is **In Progress** to preserve public-roadmap visibility" is **superseded** — it stays Draft; the In-Progress rationale no longer applies. Acted here: frontmatter `public: true → false` (the source-of-truth lever that removes this SHY from the public roadmap). **🚩 Downstream (out of this md-only PR's scope):** the legacy hand-authored `currentlyWorkingOn: "Age-gating per feature"` entry in the synced `roadmap-data.json` should retire (becomes empty until a real `In Progress + public: true` age-gating SHY exists) — that is a `roadmap-data.json`/sync change, a separate follow-up, NOT in the SHY-0091 protocol PR. The XL safety design + the embedded protocol stand for whoever implements.
