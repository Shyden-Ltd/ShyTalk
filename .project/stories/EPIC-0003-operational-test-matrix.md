---
id: EPIC-0003
status: In Progress
owner: claude
created: 2026-06-13
priority: P1
title: Fully-operational cross-platform QA test-framework matrix (no stubs)
child_shys: [SHY-0092, SHY-0093, SHY-0094, SHY-0095]
---

# EPIC-0003: Fully-operational cross-platform QA test-framework matrix (no stubs)

## ⚠️ PREMISE CORRECTION — operator read FIRST (authored 2026-06-13 AFK, evidence-based)

EPIC-0003 has been a forward-reference since SHY-0091 on the assumption that **"only 2/14 matrix cells run today"** and the work is to **"build the 12 missing cells."** A first-investigation-before-acting pass ([[feedback-never-guess-always-investigate]]) against the real framework files **overturns that premise**:

- The **12-cell web-browser matrix is 11/12 OPERATIONAL today** — real drivers, real journeys, real timings (e.g. mobile-safari-iOS 8211 ms = real device). The single non-green cell, `mobile-edge-android`, is an **environment skip** (device/Edge availability), not a code stub.
- The **native-app drivers are REAL and extensive**: `android-adb-driver.js` (2560 lines, ~79 real methods), `ios-appium-driver.js` (419 lines, real XCUITest bridge).
- The **only true scaffolds** are `ios-devicectl-driver.js` + `ios-simctl-driver.js`: real device/simulator *selection* is in place, but **UI inspection is stubbed** (`iosUiDump()` returns `''`, all `iosShows*` return `false`) — these block real **native-iOS journey** testing via devicectl/simctl (NOT the 12-cell web matrix).
- Two driver **docstrings are stale-and-misleading** (`web-playwright-driver.js`, `android-adb-driver.js` still say "SCAFFOLD / STUB FOR EVERY METHOD" though both are fully implemented) — the inverse No-Stubs hazard: a comment claiming "stub" over real code.

**Consequence for the plan:** the "gauntlet isn't runnable yet" contradiction that motivated sequencing EPIC-0003 *before* MVP (operator decision #2, 2026-06-13) is **largely resolved already** — the gauntlet is mostly runnable. EPIC-0003's genuine remaining scope is therefore SMALL (four concrete child SHYs below). **RESOLVED 2026-06-13:** the operator chose to **finish EPIC-0003 before MVP** (decision #1) with this corrected small scope (build order D→A→B→C); the re-prioritise-to-MVP option was declined. See `## ✅ Operator decisions` + Notes.

## Vision

The cross-platform QA matrix proves every ShyTalk story on the real surfaces it ships to — real Mac browsers, real Android + real iPhone browsers, and the real native apps — with **zero stubs/fakes** (per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only). The framework + driver-interface contract already exist (`express-api/scripts/QA_FRAMEWORK_*.md` + `manual-qa-runner.js` + `manual-qa-matrix.yml`). EPIC-0003 closes the **last** real gaps so the Pre-Merge Testing Protocol's LOCAL gauntlet is 100% genuine on every cell, and corrects the misleading "stub" docstrings so no one mistakes real drivers for placeholders.

## Current state — evidence-based cell status (2026-06-13)

**Web 12-cell matrix (against the driver-interface contract):**

| Platform | Browser | Driver | Status |
|---|---|---|---|
| Mac | chromium / firefox / webkit / edge | `web-playwright-driver` | ✅ operational (4 cells) |
| Android (real device) | Chrome | `web-mobile-chrome-android-driver` | ✅ operational |
| Android (real device) | Samsung Internet | `web-mobile-samsung-android-driver` | ✅ operational |
| Android (real device) | Firefox | `web-mobile-firefox-android-driver` | ✅ operational (Gecko/Marionette) |
| Android (real device) | Edge | `web-mobile-edge-android-driver` | ⬜ environment-skip (verify on a real Edge-capable device) |
| iPhone (real device) | Safari / Chrome / Firefox / Edge | `web-mobile-{safari,webkit}-ios-driver` | ✅ operational (4 cells; iOS FF/Chrome/Edge are WebKit per Apple policy) |

**Native-app drivers (separate from the 12-cell web matrix):**

| Target | Driver | Status |
|---|---|---|
| Android native app | `android-adb-driver` | ✅ real (2560 lines) |
| iOS native app (Appium) | `ios-appium-driver` | ✅ real (419 lines) |
| iOS native app (devicectl, real device) | `ios-devicectl-driver` | ⬜ SCAFFOLD — UI inspection stubbed |
| iOS native app (simctl, simulator) | `ios-simctl-driver` | ⬜ SCAFFOLD — UI inspection stubbed |

## Scope — the four real remaining items (decisions resolved 2026-06-13 → all filed as child SHYs)

Build order **D → A → B → C** (warm-up → small → plumbing → substantive). Each is its own branch + PR on the full real-device gauntlet (reviewer-before-push, judgment-merge).

1. **(D) `SHY-0092` — driver docstring-honesty fix.** Correct the misleading "STUB / SCAFFOLD for every method" headers on `web-playwright-driver.js` + `android-adb-driver.js` (real code under a stale stub claim) + add a "non-canonical alternative" note to `ios-devicectl`/`ios-simctl` (Appium is canonical). Comment-only, but `.js` → runs the gauntlet. *(XS.)*
2. **(A) `SHY-0093` — make `mobile-edge-android` green-or-provably-env-gated.** Evidence-first on the real Android device (device-availability skip vs CDP-socket wiring bug `com.microsoft.emmx_devtools_remote`); the sole non-green web cell. *(S.)*
3. **(B) `SHY-0094` — runner auto-starts + health-checks Appium.** Parent-owned shared Appium at `:4723` (probe → start-if-absent → health-check → reuse-or-owned-teardown) so the iOS-native cells run hands-free. *(M.)*
4. **(C) `SHY-0095` — extend `ios-appium-driver` to full native-iOS journey coverage.** Implement the 6 stubbed `iosShows*` presence-checks (real XCUITest XML) + every journey-required method; the substantive item, on the real iPhone. *(L.)*

> Decision #2 (devicectl-vs-Appium) resolved to **Appium** → the earlier "complete `ios-devicectl` UI inspection" scope item is **dropped** (devicectl/simctl are documented non-canonical via SHY-0092). The runner-Appium-lifecycle item (SHY-0094) was added to support the Appium path.

## Child SHYs

Filed 2026-06-13, fully-refined (validator PASS) per [[feedback-no-skeleton-stories-fully-refined]] — authored only after the tooling decisions resolved, so none is built in a guessed direction:
- **SHY-0092** — driver docstring-honesty fix (build item **D**). Status: Draft.
- **SHY-0093** — make `mobile-edge-android` green-or-env-gated (build item **A**). Status: Draft.
- **SHY-0094** — runner Appium auto-start + health-check (build item **B**). Status: Draft.
- **SHY-0095** — extend `ios-appium-driver` to full native-iOS journey coverage (build item **C**). Status: Draft.

## ✅ Operator decisions (ALL RESOLVED 2026-06-13 — see Notes for the full resolution)

_The 6 questions below were surfaced for the operator and all resolved on 2026-06-13 (recorded in Notes). Kept verbatim for traceability; they no longer gate the child SHYs (filed above)._


1. **Re-prioritisation:** given the matrix is actually ~11/12 + real native runnable, do we still do EPIC-0003 before MVP, or pivot to MVP (Safety-first) now and fit these three items in opportunistically? *(Biggest call.)*
2. **Canonical native-iOS real-device path:** `ios-appium-driver` (already real, needs an Appium server) **vs** completing `ios-devicectl` (no Appium dependency, but UI inspection unbuilt). Which is the protocol's "real iPhone native journey" cell? (Recommendation: pick one canonical; keep the other as fallback.)
3. **Mac Safari fidelity:** the matrix's Mac "webkit" cell is Playwright-WebKit, not real Safari. Is webkit-as-Safari-proxy acceptable, or does "fully operational" require a real `safaridriver` + real Safari cell?
4. **Appium server lifecycle:** the 4 iOS web-mobile cells need a real Appium server at `:4723`. Keep the current "operator starts `appium server` once per session" model, or have the runner auto-start + health-check it?
5. **Real-device requirement for web-mobile cells:** confirm the No-Stubs/Pre-Merge-Protocol "real device" mandate binds the web-mobile matrix cells to **real** Android + real iPhone (not emulator/simulator), with the Mac-webkit synthetic as the only exception.
6. **Firefox version-pin policy:** `mobile-firefox-android` pairs geckodriver + Marionette with Play-Store Firefox; add a pre-run version-skew check / pin policy, or accept driver-skip-on-mismatch?

## Out of Scope

- Re-architecting the driver-interface contract or the runner (both sound + complete).
- Re-implementing the already-real web/native drivers.
- The foundational *unit-test* fake-harness question (Android BDD `ResetFakesRule`, KMP VM `FakeRepository`, sync `mock-gh`) — that is the separate 🔴 operator decision flagged across the SHY-0091 corpus, NOT this matrix-cell epic.

## Dependencies

- The QA framework docs + `manual-qa-runner.js` + `manual-qa-matrix.yml` (present, sound).
- SHY-0026 (mobile driver helper scripts — `mobile-android-flags-check.sh` + `setup-ios-wda.sh`) for the real-device onboarding the devicectl/Appium cells need; its "device unauthorized needs manual USB trust" + WDA-signing flags are real-hardware/operator-gated.
- Real hardware: a real Edge-capable Android device (item 1); a real iPhone + Apple Developer signing for WDA (item 2).

## DoD at Epic Level

- [x] Operator resolved the 6 decisions (2026-06-13 — see Notes). #1 finish EPIC-0003 before MVP; #2 canonical native-iOS = Appium.
- [x] The four scope items each filed as a fully-refined child SHY (`child_shys` populated: SHY-0092/0093/0094/0095) per [[feedback-no-skeleton-stories-fully-refined]] — authored after the decisions.
- [ ] Each child SHY satisfies the Pre-Merge Testing Protocol (all four are `.js`/runner changes → run the now-available gauntlet); `released_in` on the release cut.
- [ ] Post-completion: a full `manual-qa-runner.js --matrix` run is 12/12 green on real devices (incl. `mobile-edge-android` per SHY-0093) + the native-iOS journeys pass via the Appium path (SHY-0095); the misleading docstrings are corrected (SHY-0092).

## Notes (running log)

- 2026-06-13 ~12:50 BST — **Four child SHYs FILED** (post-compact resume, decisions locked): **SHY-0092** (D, docstring-honesty), **SHY-0093** (A, mobile-edge-android verify/fix), **SHY-0094** (B, runner Appium auto-start + health-check), **SHY-0095** (C, extend ios-appium-driver to full native-iOS coverage). All fully-refined (frontmatter validator PASS ×4); `child_shys` populated; Scope/Child-SHYs/Operator-decisions/DoD reconciled to the locked plan. Evidence captured at filing: `ios-appium-driver.js` has 5 real methods (`iosLaunchApp`/`iosUiDump`/`iosTap`/`iosTapByTag`/`iosPersonaSignIn` + `close`) + **6 stubbed `iosShows*`** (line 394 fail-loud fallback); `web-playwright`/`android-adb` headers claim "STUB/SCAFFOLD" over real code; the runner has **no Appium lifecycle** (each cell is a `spawnSync` child → a parent-owned shared server is needed); `mobile-edge-android` uses the `com.microsoft.emmx_devtools_remote` CDP socket. Filed inside the EPIC-scoping branch (PR #1411, all-`.md`); implementation starts on per-child branches in build order D→A→B→C **after** #1411 merges (one active branch at a time).
- 2026-06-13 ~02:05 BST — **Operator resolved ALL decisions (present, post-SHY-0091 Q&A) → status In Progress.** #1 **finish EPIC-0003 BEFORE MVP**. #2 native-iOS canonical = **Appium + WebDriverAgent** (extend the partial ~11-method `ios-appium-driver` to full journey coverage; `ios-devicectl`/`simctl` become documented NON-canonical alternatives). #3 Mac Safari = **Playwright-WebKit acceptable** (no real safaridriver; cell already green — no work). #4 Appium server = **runner auto-starts + health-checks** (new runner plumbing). #5 real Android + real iPhone **both connected + trusted** (real gauntlet runnable autonomously). #6 Firefox-Android → default: a pre-run geckodriver-vs-Firefox version-skew check that skips LOUDLY on mismatch. Separately, the foundational fake-harness question → operator chose **migrate EVERYTHING to real** (big-bang) = its own epic AFTER EPIC-0003. **Child SHYs to file (fully-refined, then implement TDD on the real gauntlet):** **(A)** verify/fix `mobile-edge-android` (evidence-first on the real device); **(B)** runner Appium auto-start + health-check; **(C)** extend `ios-appium-driver` to full native-iOS journey coverage [the substantive item]; **(D)** docstring-honesty fix (`web-playwright` + `android-adb` stale "stub" comments + a "non-canonical alternative" note on `devicectl`/`simctl`). `child_shys` populated as each is filed.
- 2026-06-13 ~01:55 BST — **Authored (corrected) during the operator-AFK window** after the SHY-0091 merge. An Explore-agent synthesis of the real framework files **overturned the "2/14 cells → build 12" premise**: the web matrix is 11/12 operational + native Android/iOS-Appium are real; only `ios-devicectl`/`simctl` UI inspection + `mobile-edge-android` verification + two stale docstrings remain. Status kept **Draft** (NOT In Progress) and **child_shys empty** deliberately — the cell-SHYs are gated on the 6 operator decisions (esp. devicectl-vs-Appium), so authoring them now would assume a tooling direction, which [[feedback-consumer-first-surface-design]] forbids. Pushed to a branch for operator review; NOT merged (decision-gated, per the AFK commit-push-flag permission). **Recommend the operator weigh re-prioritising to MVP** given the gauntlet is largely runnable.
