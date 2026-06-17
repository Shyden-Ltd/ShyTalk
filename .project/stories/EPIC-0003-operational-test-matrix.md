---
id: EPIC-0003
status: In Progress
owner: claude
created: 2026-06-13
priority: P1
title: No stubs/fakes/gaps — fully-operational, real-only test apparatus (every framework)
child_shys: [SHY-0092, SHY-0093, SHY-0094, SHY-0095, SHY-0096, SHY-0101, SHY-0112, SHY-0113, SHY-0114, SHY-0115, SHY-0116, SHY-0117, SHY-0118, SHY-0119, SHY-0120, SHY-0121, SHY-0122, SHY-0123, SHY-0124]
---

# EPIC-0003: No stubs/fakes/gaps — fully-operational, real-only test apparatus (every framework)

## ⚠️ RE-SCOPE 2026-06-13 (operator: "a single epic… all completed before you move on") — read FIRST

This EPIC was originally "fully-operational QA test-framework matrix (no stubs)" — the 4 matrix-cell items below (SHY-0092..0095). The operator has now **consolidated the entire real-only test mission into this ONE epic** and made it the **sole focus until 100% of its child stories are complete** — no MVP work, no other tickets, until done. Two decisions drive the expansion:

1. **The big-bang migration is now IN this epic, not a separate later one.** The earlier plan (Notes 2026-06-13 ~02:05) parked "migrate EVERYTHING to real" as a follow-on epic. The operator reversed that: it lives here, as child stories.
2. **A linchpin gap was found by live investigation** (2026-06-13 ~14:xx, post-compact): `androidPersonaSignIn` assumes `am force-stop → sign-in screen`, but **Firebase auth survives force-stop** on the real device, and both data-wipe resets (`pm clear`, `run-as rm`) are **blocked** on the OnePlus CPH2653 (SecurityException / SELinux). So multi-journey Android persona-switching is broken → **no clean corpus can be measured** until a real in-app sign-out exists. This is Phase 0 (unblocks the gauntlet that proves everything else).

**Standing constraint:** per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only (operator override 2026-06-13 — see that section), **every** test across **every** framework runs against real services/devices. The "opportunistic, no big-bang" clause is **superseded for this epic** by the operator's explicit "true big-bang, all ~300 now" decision. Inventory: ~300 mock/fake-using test files (express-api Jest 195, Kotlin unit 61, androidTest 22 `Fake*.kt` used by 36 files, Playwright 8, iOS 3).

## ⚠️ RE-SCOPE 2026-06-17 (operator: "the only thing I will allow fakes or mocks is the unit tests") — read FIRST

Triggered when the operator caught `makeStatefulFakeDb` (a hand-rolled Firestore fake, **319 call-sites**) being used in NEW SHY-0101 tests, and connected it to a real symptom: **"I tried the dev app yesterday and still can't create rooms / do basic tasks, yet you said it was fixed — so the 'fix' was you faking it."** A fix validated only against a fake proves nothing; the real bug survives. This re-scope hardens the rule, corrects a badly-undercounted inventory, and re-prioritises by real-bug-exposure.

**Hardened policy (GOVERNS every child SHY):** fakes / mocks / stubs / spies are permitted **ONLY in UNIT tests** (pure isolated logic with genuinely no real collaborator). **Every other layer — integration, journey-runner, e2e, device — is REAL-ONLY** (real Firebase emulator / real Express API / real LiveKit / real device). Classification is by what a test EXERCISES: if it touches a real collaborator (Firestore / Auth / API / LiveKit / repository / network) it is integration → real. Codified into `CLAUDE.md` §No-Stubs by the keystone child SHY below. **Testing mindset (operator):** when a real-services test fails, the default assumption is a **real product bug**, not a broken test — prove which with evidence; never "fix" by adjusting the test or faking the pass.

**Accurate inventory (2026-06-17 codebase sweep — supersedes the "~300" estimate below):** ~307 fake-using test files — **~276 INTEGRATION (must migrate to real)**, ~28 genuine UNIT (keep doubles). express-api Jest ~230 (jest.mock 196, jest.fn 227, hand-rolled fakes 18 incl. `makeStatefulFakeDb`=319 call-sites, mockResolved* 202 — heavily overlapping); Kotlin 22 `Fake*.kt` + ~36 androidTest journeys (all integration; Koin-bound) + 51 mockk/Mockito; Playwright 8 `page.route` (6 integration, 2 genuine-unit XSS/i18n payloads); iOS 3 (all genuine unit). **Ratchet blind spots** — SHY-0108 only catches `jest.mock` / `Fake*Repository` / `page.route`; it MISSES jest.fn-collaborators, hand-rolled fakes, mockResolved*, and ALL Kotlin (mockk/Mockito/`Fake*`) + Swift.

**Prioritised child-SHY plan (core-functionality + real-bug-exposure → safety → volume):**

| Pri | Child SHY (to file) | Area / scope | ~Files |
|---|---|---|---|
| **P0** | Keystone | Codify unit-only policy in CLAUDE.md + extend ratchet to catch the blind-spot patterns + define the unit-vs-integration boundary convention | — |
| **P0** | Rooms / Voice / LiveKit → real | express room-mutations/rooms/livekit + Android RoomCreation/RoomBrowsing/GroupChat — **surfaces the real room-creation bug (ties to SHY-0102/0103)** | ~15 |
| **P0** | Auth / Sign-In → real | express auth/portal/otp/pin/biometric + Android auth journey | ~23 |
| **P1** | Kotlin androidTest real-emulator harness | replace the 22 `Fake*.kt` Koin bindings with real-emulator + real LiveKit (Android keystone, parallel to SHY-0109 for express) | 22+36 |
| **P1** | Moderation / Suspension / Warning → real | express admin-users/bans/warn/appeal + segregation; **SHY-0101 j11 leads here** | ~65 |
| **P1** | Messaging / Conversations → real | conversations / notifications | ~10 |
| **P1** | Economy / Wallet / Gifting → real | economy / purchase / gacha / gifts | ~35 |
| **P1** | Starting-screens / cohort → real | cohort-gated reads/writes | ~5 |
| **P1** | Cron → real | continues SHY-0109/0110 (closedRooms / archiveReports / subscriptions / …) | ~12 |
| **P2** | Suggestions / Roadmap → real | suggestions lifecycle / contracts / voting | ~45 |
| **P2** | Admin portal → real | admin alerts / logs / devices / economy / audit | ~25 |
| **P2** | Utils-integration → real | firebase / email / fcm / r2 / alertManager / data-export | ~25 |
| **P2** | Playwright integration → real backend | the 6 integration e2e (keep the 2 XSS/i18n unit) | ~6 |

iOS (3 files) are genuine unit → no migration. Big areas (Moderation / Economy / Suggestions) sub-split into multiple PRs at pickup. The **keystone lands FIRST** so no new fakes accrue mid-migration; then Rooms (proves the room bug), then Auth, then the rest in the order above. The original by-framework phase table (below) is retained as the framework view; this feature-area table is the prioritised execution order.

### Bug-handling workflow during migration (operator 2026-06-17) — defer-don't-distract, TDD, regression-proof

Migrating a faked test to real services will SURFACE real bugs the fakes were hiding. Handle every one this way:

1. **Migrate TDD-style** against the real emulator/services. **A real-services failure is assumed a real PRODUCT bug, not a broken test** ([[feedback-think-like-qa-real-fixes]]) — prove which with evidence (logs / real state) before acting. Hold a high bar before blaming the "apparatus".
2. **Product bug found → FILE A BUG TICKET (a SHY, `type: bug`) and DO NOT fix it now.** It is fixed **after EPIC-0003 completes**. Do this for EVERY bug found (keeps the migration moving, avoids rabbit-holes).
   - **Non-blocking** → tag the migrated real test `@known-failure-SHY-NNNN` with the **correct assertion kept intact (NEVER weakened)**, referencing the new ticket (mirrors the existing `@known-failure-SHY-0097/0105/0106/0107` pattern). The test is now regression-proof: it passes only when the bug is genuinely fixed, and fails again if it ever regresses. Migration proceeds.
   - **Blocking** (the bug stops the area's tests from running at all — e.g. "can't create a room" ⇒ the close-room / all room tests can't execute) → **PIVOT: fix the blocking bug FIRST (TDD — a real failing test locks the fix), then resume the migration.**
3. **Apparatus bug** (the runner / test-harness itself is genuinely wrong, not the product) → fix it; that is part of building the real apparatus. Default to "product bug" unless the evidence clearly shows the harness.
4. **Regression-proof everything:** every bug (deferred OR fixed) leaves behind a real test whose correct assertion fails iff the bug is present, so it can never silently resurface.

> Net: EPIC-0003 = make every test real + catalogue (as `@known-failure`-tagged tickets) every real bug the fakes were hiding; the post-epic bug-fix backlog then drains those tickets, each already guarded by a real regression test. The operator's room-creation report is the canonical first case — likely a **blocking** bug in the Rooms area (→ pivot-and-fix), tied to SHY-0102/0103.

## Vision

ShyTalk's entire automated-test apparatus proves behaviour on the **real** surfaces it ships to — real Mac browsers, real Android + real iPhone (browsers AND native apps), the real local Firebase-emulator/LiveKit/MinIO/Mailpit stack — with **zero in-process mocks/fakes/stubs** anywhere, and **zero coverage gaps** (behaviour-level assertions, not presence-grep). When this epic is done: no `jest.mock`, no `Fake*Repository`, no `page.route` fulfilment, no iOS test doubles remain; the Pre-Merge gauntlet is 100% genuine on every cell; CI provisions the real stack; and a lint guard prevents any new in-process double from regrowing the debt.

## Test-strategy line (operating definition of "real")

- **Pure logic** (UI-dump → state classification, tap-coordinate math, string formatting) keeps unit tests fed **real device-/backend-captured fixtures** — that is test *data*, not a mock *collaborator*, so it is permitted and keeps CI coverage.
- **Device / backend behaviour** is proven against the **real** thing: the real-device gauntlet (Android/iOS apps), the real local emulator stack (express-api Jest, androidTest, Playwright), real collaborators (Kotlin unit).
- **CI consequence (designed-for, not silent):** GitHub-hosted runners have no attached device → driver *behaviour* is gauntlet-only (operator-gated, real device); express-api Jest moves to an **emulator-in-CI** model (`firebase emulators:exec` + docker-compose for LiveKit/MinIO/Mailpit).

## Scope

Delivered as phases — each phase is one or more 1-SHY-1-PR vertical slices; the suite stays green at every commit.

| Phase | Scope | ~Files | Rationale / ordering |
|---|---|---|---|
| **0 — Linchpin** | `androidPersonaSignIn` clean signed-out start via real `androidSignOut` (warning-screen interception → real acknowledge → Profile→Settings→Sign Out → picker) + **behaviour-level** warning-ack test (`hasActiveWarning→false`) | ~3 | Unblocks the real-device gauntlet — the proof surface for every later phase |
| **1 — QA drivers real** | Original matrix items (SHY-0092 docstring · 0093 mobile-edge-android · 0094 runner Appium auto-start · 0095 ios-appium full coverage) + drop the **5 `child_process` `execSync` mocks** → real-captured-XML fixtures + gauntlet behaviour | ~20 | Makes the matrix itself real |
| **2 — androidTest real-emulator** | 22 `Fake*Repository` + `ResetFakesRule` → real local-emulator-backed instrumented tests, grouped by domain (auth/user/identity/device/token · room/seat/presence/voice · message/PM/typing · economy/gift · moderation/report/banner/notification · translation/appconfig/funfact/storage) | 36 | Largest fake cluster; real backend = local emulator |
| **3 — express-api Jest real-stack** | 195 mocked Jest files → real local stack; **emulator-in-CI** infra SHY first, then grouped by route/domain; 10 fetch mocks → real endpoints | 195 | Biggest layer |
| **4 — Kotlin unit real** | 61 mockk/Mockito files → real collaborators or promote to instrumented/real-backed | 61 | |
| **5 — Playwright real-API** | 8 `page.route` fulfilment → real backend | 8 | |
| **6 — iOS real** | 3 test doubles → real | 3 | |
| **X — Cross-cutting** | anti-regression lint guard (fail any NEW `jest.mock`/`Fake*Repository`/`page.route`) · CLAUDE.md No-Stubs reconciliation (this charter) · per-persona clean-state reset for corpus isolation | — | Stops the debt regrowing while we drain it |

## Child SHYs

**Filed (Phase 0/1):**
- **SHY-0092** — driver docstring-honesty fix (Phase 1). Status: In Progress (draft PR #1416, **HELD** — its journeys need the Phase-0 linchpin to go green).
- **SHY-0093** — make `mobile-edge-android` green-or-env-gated (Phase 1). Status: Draft.
- **SHY-0094** — runner Appium auto-start + health-check (Phase 1). Status: Draft.
- **SHY-0095** — extend `ios-appium-driver` to full native-iOS journey coverage (Phase 1). Status: Draft.

- **SHY-0096** — `androidPersonaSignIn` real signed-out reset via `androidSignOut` + warning-ack behaviour (Phase 0, **THE LINCHPIN**). Status: In Review (merged #1418, released_in v0.97.15).
- **SHY-0101** — j11 real-Android journey-apparatus completion (launch-gates · dev persona-password bake · acknowledge-scenario robustness · message/conversation/appeal driver actions) + retire `@known-failure-SHY-0097` (Phase-0 completion). Status: Draft.

**Filed 2026-06-17 — "no more faking" feature-area children (the prioritised execution order above, each fully-refined per [[feedback-no-skeleton-stories-fully-refined]]):**
- **SHY-0112** (P0) — Keystone: codify "doubles only in unit tests" in `CLAUDE.md` + make `check-no-new-stubs.js` policy-aware + catch the blind-spot patterns + define the unit↔integration boundary. **Lands FIRST.** Status: Draft.
- **SHY-0113** (P0) — Rooms / Voice / LiveKit → real (surfaces + pivot-fixes the room-creation blocker; ties SHY-0102/0103). Status: Draft.
- **SHY-0114** (P0) — Auth / Sign-In → real. Status: Draft.
- **SHY-0115** (P1) — Android instrumented real-emulator harness (replaces the 22 `Fake*.kt` Koin bindings; the Android keystone). Status: Draft.
- **SHY-0116** (P1) — Moderation / Suspension / Warning → real (SHY-0101 j11 leads; re-authors the reverted fake test REAL). Status: Draft.
- **SHY-0117** (P1) — Messaging / Conversations → real. Status: Draft.
- **SHY-0118** (P1) — Economy / Wallet / Gifting → real. Status: Draft.
- **SHY-0119** (P1) — Starting-screens / cohort-gated → real. Status: Draft.
- **SHY-0120** (P1) — Remaining crons → real (continues SHY-0109/0110). Status: Draft.
- **SHY-0121** (P2) — Suggestions / Roadmap → real. Status: Draft.
- **SHY-0122** (P2) — Admin portal → real. Status: Draft.
- **SHY-0123** (P2) — Utils-integration → real (firebase/email/fcm/r2/alertManager/data-export). Status: Draft.
- **SHY-0124** (P2) — Playwright integration e2e → real backend (6 migrate, 2 unit kept). Status: Draft.

> These 13 are the **feature-area tracking children**; each XL/L area sub-splits into 1-SHY-1-PR work-slices filed as-started at pickup ([[feedback-agile-user-stories]]). The earlier by-phase plan (Phase 1–6+X) is retained as the *framework* view in `## Scope`; this feature-area set is the *prioritised execution order*. `child_shys` frontmatter lists only filed-and-existing SHYs (validator cross-checks existence in `--scan`); per-PR sub-slices are promoted into it as their files are created.

## Operator decisions (running)

- **2026-06-13 (this session):** "a single epic… all completed before you move on" → this epic is the sole focus until every child story is Done. "True big-bang, all ~300 now" → overrides the codified opportunistic/no-big-bang clause (reconciled in CLAUDE.md). Test rigor = "real-only everywhere now". Recommendation accepted: fix sign-out first (Phase 0), then re-measure, then drain the debt phase by phase.
- **2026-06-13 ~02:05 (earlier):** #1 do this before MVP; #2 native-iOS canonical = Appium + WebDriverAgent; #3 Mac Safari = Playwright-WebKit acceptable; #4 runner auto-starts Appium; #5 real Android + real iPhone connected; #6 Firefox-Android version-skew skip-loud.

## Out of Scope

- Re-architecting the driver-interface contract or `manual-qa-runner.js` (sound + complete).
- Re-implementing already-real web/native drivers (only the docstrings + the `execSync`-mock *tests* change in Phase 1).
- Shipping NEW product features — this epic is test-apparatus + the linchpin sign-out only.

## Dependencies

- The QA framework docs + `manual-qa-runner.js` + `manual-qa-matrix.yml` (present, sound).
- The real local stack ([[reference-local-stack-runner-setup]] — provisioning corrected 2026-06-13) as the real backend for Jest/androidTest/Playwright/journeys.
- Real hardware: real Android + real iPhone + Apple Developer WDA signing (operator-gated gauntlet, [[project-qa-gauntlet-operator-gated]]).
- SHY-0026 mobile driver helper scripts for real-device onboarding.

## DoD at Epic Level

- [ ] **Phase 0:** `androidPersonaSignIn` reaches a clean signed-out picker on the real device every call (real `androidSignOut` + warning handling); the warning-ack DB-flip is tested behaviourally; a clean full-corpus re-measure produces a true gap taxonomy.
- [ ] **Phases 1–6:** every one of the ~300 mock/fake-using test files is migrated to real services/devices (zero `jest.mock`, zero `Fake*Repository`, zero `page.route` fulfilment, zero iOS doubles remain); each migration slice keeps the whole suite green.
- [ ] **Phase X:** lint guard fails any NEW in-process double; CLAUDE.md No-Stubs section reconciled; CI provisions the real stack for the migrated Jest layer.
- [ ] A full `manual-qa-runner.js --matrix` run is green on real devices across all cells (incl. `mobile-edge-android`) + native-iOS journeys via Appium.
- [ ] Every child SHY satisfies the Pre-Merge Testing Protocol and is Done (`released_in:` set on its release cut).
- [ ] No coverage gaps remain on any touched surface (behaviour-level assertions, AC-traceable, both create + update paths, every enum/mapping value-matrixed).

## Notes (running log)

- 2026-06-13 (post-compact, ~14:50 BST) — **RE-SCOPED to the single governing epic** per operator "a single epic… all completed before you move on" + "true big-bang, all ~300 now". Live investigation (real OnePlus CPH2653) established the **linchpin** (Phase 0): auth survives `am force-stop`; `pm clear` → `SecurityException CLEAR_APP_USER_DATA`; `run-as rm` → Permission denied; the only reliable signed-out reset is the real in-app sign-out. Also caught + corrected a self-inflicted false measurement: a `curl` REST read reported "0 user docs / empty P-10", but the **authoritative admin-SDK read shows 20 docs, P-10 present with `hasActiveWarning:true`** (leftover j10 state the merge-upsert seed doesn't clear) — environment data is fine; the curl was mangling `(default)`. Mock/fake inventory taken (~300 files across 5 frameworks). Charter authored on branch `chore/EPIC-0003-rescope-single-real-only` (md-only): this re-scope + CLAUDE.md No-Stubs reconciliation. Next: file SHY-0096 (Phase 0) fully-refined and TDD it on the real gauntlet.
- 2026-06-13 ~12:50 BST — **Four child SHYs FILED** (SHY-0092 D docstring · 0093 A mobile-edge-android · 0094 B runner Appium auto-start · 0095 C ios-appium coverage); all fully-refined (validator PASS ×4). Filed inside EPIC-scoping PR #1411 (all-`.md`).
- 2026-06-13 ~02:05 BST — **Operator resolved the 6 matrix decisions** (#1 before MVP; #2 Appium canonical; #3 WebKit-as-Safari OK; #4 runner auto-starts Appium; #5 real devices connected; #6 Firefox skip-loud) AND chose **migrate EVERYTHING to real (big-bang)** — at the time parked as a separate later epic; now folded into THIS epic by the 2026-06-13 re-scope above.
- 2026-06-13 ~01:55 BST — Authored during operator-AFK; an Explore-agent synthesis overturned the "2/14 cells → build 12" premise (web matrix 11/12 operational; native Android/iOS-Appium real). Original premise-correction preserved for traceability.
