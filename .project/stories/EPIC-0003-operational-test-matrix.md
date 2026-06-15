---
id: EPIC-0003
status: In Progress
owner: claude
created: 2026-06-13
priority: P1
title: No stubs/fakes/gaps — fully-operational, real-only test apparatus (every framework)
child_shys: [SHY-0092, SHY-0093, SHY-0094, SHY-0095, SHY-0096, SHY-0101]
---

# EPIC-0003: No stubs/fakes/gaps — fully-operational, real-only test apparatus (every framework)

## ⚠️ RE-SCOPE 2026-06-13 (operator: "a single epic… all completed before you move on") — read FIRST

This EPIC was originally "fully-operational QA test-framework matrix (no stubs)" — the 4 matrix-cell items below (SHY-0092..0095). The operator has now **consolidated the entire real-only test mission into this ONE epic** and made it the **sole focus until 100% of its child stories are complete** — no MVP work, no other tickets, until done. Two decisions drive the expansion:

1. **The big-bang migration is now IN this epic, not a separate later one.** The earlier plan (Notes 2026-06-13 ~02:05) parked "migrate EVERYTHING to real" as a follow-on epic. The operator reversed that: it lives here, as child stories.
2. **A linchpin gap was found by live investigation** (2026-06-13 ~14:xx, post-compact): `androidPersonaSignIn` assumes `am force-stop → sign-in screen`, but **Firebase auth survives force-stop** on the real device, and both data-wipe resets (`pm clear`, `run-as rm`) are **blocked** on the OnePlus CPH2653 (SecurityException / SELinux). So multi-journey Android persona-switching is broken → **no clean corpus can be measured** until a real in-app sign-out exists. This is Phase 0 (unblocks the gauntlet that proves everything else).

**Standing constraint:** per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only (operator override 2026-06-13 — see that section), **every** test across **every** framework runs against real services/devices. The "opportunistic, no big-bang" clause is **superseded for this epic** by the operator's explicit "true big-bang, all ~300 now" decision. Inventory: ~300 mock/fake-using test files (express-api Jest 195, Kotlin unit 61, androidTest 22 `Fake*.kt` used by 36 files, Playwright 8, iOS 3).

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

**Planned (filed fully-refined per [[feedback-no-skeleton-stories-fully-refined]] as each is started, in phase order — NOT pre-stubbed):**
- **Phase 1** — driver-test `execSync`-mock removal (real-captured fixtures + gauntlet).
- **Phase 2** — one SHY per androidTest domain group (≈6 stories).
- **Phase 3** — emulator-in-CI infra SHY + one SHY per express-api route/domain group (≈8–12 stories).
- **Phase 4** — Kotlin-unit real-collaborator SHYs (grouped by module).
- **Phase 5** — Playwright real-API SHY.
- **Phase 6** — iOS real-double SHY.
- **Phase X** — anti-regression lint-guard SHY.

> `child_shys` frontmatter lists only filed-and-existing SHYs (validator cross-checks existence in `--scan`); planned ones are promoted into it as their files are created.

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
