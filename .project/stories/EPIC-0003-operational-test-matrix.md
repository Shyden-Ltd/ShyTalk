---
id: EPIC-0003
status: In Progress
owner: claude
created: 2026-06-13
priority: P1
title: Fully-operational cross-platform QA test-framework matrix (no stubs)
child_shys: []
---

# EPIC-0003: Fully-operational cross-platform QA test-framework matrix (no stubs)

## ⚠️ PREMISE CORRECTION — operator read FIRST (authored 2026-06-13 AFK, evidence-based)

EPIC-0003 has been a forward-reference since SHY-0091 on the assumption that **"only 2/14 matrix cells run today"** and the work is to **"build the 12 missing cells."** A first-investigation-before-acting pass ([[feedback-never-guess-always-investigate]]) against the real framework files **overturns that premise**:

- The **12-cell web-browser matrix is 11/12 OPERATIONAL today** — real drivers, real journeys, real timings (e.g. mobile-safari-iOS 8211 ms = real device). The single non-green cell, `mobile-edge-android`, is an **environment skip** (device/Edge availability), not a code stub.
- The **native-app drivers are REAL and extensive**: `android-adb-driver.js` (2560 lines, ~79 real methods), `ios-appium-driver.js` (419 lines, real XCUITest bridge).
- The **only true scaffolds** are `ios-devicectl-driver.js` + `ios-simctl-driver.js`: real device/simulator *selection* is in place, but **UI inspection is stubbed** (`iosUiDump()` returns `''`, all `iosShows*` return `false`) — these block real **native-iOS journey** testing via devicectl/simctl (NOT the 12-cell web matrix).
- Two driver **docstrings are stale-and-misleading** (`web-playwright-driver.js`, `android-adb-driver.js` still say "SCAFFOLD / STUB FOR EVERY METHOD" though both are fully implemented) — the inverse No-Stubs hazard: a comment claiming "stub" over real code.

**Consequence for the plan:** the "gauntlet isn't runnable yet" contradiction that motivated sequencing EPIC-0003 *before* MVP (operator decision #2, 2026-06-13) is **largely resolved already** — the gauntlet is mostly runnable. EPIC-0003's genuine remaining scope is therefore SMALL (three concrete items below) and partly **gated on operator tooling decisions**. **This may warrant re-prioritising toward MVP work now** rather than a large framework build. → operator call (see `## 🔴 Operator decisions`).

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

## Scope — the THREE real remaining items (each → one child SHY, filed post-decision)

1. **Verify / fix `mobile-edge-android`** — confirm whether the cell's skip is a device-availability skip (document as such) OR a CDP-socket wiring bug (`com.microsoft.emmx_devtools_remote` per the Android runbook). Run `--check-drivers --target local --filter mobile-edge-android` on a **real** Edge-capable Android device; let the evidence name the cause before any code change. *(Small.)*
2. **Complete `ios-devicectl` (+ `ios-simctl`) real UI inspection** — the substantive gap. Implement the real element-tree read (WebDriverAgent / XCUITest harness) so `iosUiDump()` + the `iosShows*` checks reflect the **real** on-device UI, unblocking native-iOS journeys via devicectl on a **real iPhone**. *(Gated on decision #2 below: devicectl vs Appium as the canonical native-iOS path.)*
3. **Docstring-honesty fix** — update the stale `web-playwright-driver.js` + `android-adb-driver.js` docstrings that falsely claim "SCAFFOLD / STUB" though both are fully implemented. A comment asserting "stub" over real code is the inverse of the No-Stubs hazard (false *under*-confidence; misleads pickup sessions into "rebuilding" working drivers). *(Trivial, comment-only — but it is a `.js` change, so NOT `*.md`-only → runs the protocol gauntlet, which is now mostly available.)*

## Child SHYs

_None filed yet — deliberately deferred (`child_shys: []`)._ The three `## Scope` items become fully-refined child SHYs **after** the operator resolves the tooling decisions below (esp. #2 devicectl-vs-Appium), so they are not authored in a guessed direction (per [[feedback-consumer-first-surface-design]] + [[feedback-no-skeleton-stories-fully-refined]] — a SHY born in the wrong direction is worse than one filed a day later):
- _(planned)_ Verify / fix `mobile-edge-android` — small; evidence-first (device-skip vs CDP-socket bug).
- _(planned)_ Complete `ios-devicectl` (+ `ios-simctl`) real UI inspection — substantive; **gated on decision #2**.
- _(planned)_ Docstring-honesty fix (`web-playwright-driver.js` + `android-adb-driver.js` stale "stub/scaffold" comments over real code).

## 🔴 Operator decisions (these GATE the child SHYs — surfaced, not assumed)

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

- [ ] Operator resolves the 6 decisions above (esp. #1 re-prioritisation + #2 native-iOS path).
- [ ] The three scope items each filed as a fully-refined child SHY (`child_shys` populated) per [[feedback-no-skeleton-stories-fully-refined]] — authored AFTER the tooling decisions so they're not built in a guessed direction.
- [ ] Each child SHY satisfies the Pre-Merge Testing Protocol (the non-`.md` ones run the now-available gauntlet); `released_in` on the release cut.
- [ ] Post-completion: a full `manual-qa-runner.js --matrix` run is 12/12 green on real devices + the native-iOS journeys pass via the chosen path; the misleading docstrings are corrected.

## Notes (running log)

- 2026-06-13 ~02:05 BST — **Operator resolved ALL decisions (present, post-SHY-0091 Q&A) → status In Progress.** #1 **finish EPIC-0003 BEFORE MVP**. #2 native-iOS canonical = **Appium + WebDriverAgent** (extend the partial ~11-method `ios-appium-driver` to full journey coverage; `ios-devicectl`/`simctl` become documented NON-canonical alternatives). #3 Mac Safari = **Playwright-WebKit acceptable** (no real safaridriver; cell already green — no work). #4 Appium server = **runner auto-starts + health-checks** (new runner plumbing). #5 real Android + real iPhone **both connected + trusted** (real gauntlet runnable autonomously). #6 Firefox-Android → default: a pre-run geckodriver-vs-Firefox version-skew check that skips LOUDLY on mismatch. Separately, the foundational fake-harness question → operator chose **migrate EVERYTHING to real** (big-bang) = its own epic AFTER EPIC-0003. **Child SHYs to file (fully-refined, then implement TDD on the real gauntlet):** **(A)** verify/fix `mobile-edge-android` (evidence-first on the real device); **(B)** runner Appium auto-start + health-check; **(C)** extend `ios-appium-driver` to full native-iOS journey coverage [the substantive item]; **(D)** docstring-honesty fix (`web-playwright` + `android-adb` stale "stub" comments + a "non-canonical alternative" note on `devicectl`/`simctl`). `child_shys` populated as each is filed.
- 2026-06-13 ~01:55 BST — **Authored (corrected) during the operator-AFK window** after the SHY-0091 merge. An Explore-agent synthesis of the real framework files **overturned the "2/14 cells → build 12" premise**: the web matrix is 11/12 operational + native Android/iOS-Appium are real; only `ios-devicectl`/`simctl` UI inspection + `mobile-edge-android` verification + two stale docstrings remain. Status kept **Draft** (NOT In Progress) and **child_shys empty** deliberately — the cell-SHYs are gated on the 6 operator decisions (esp. devicectl-vs-Appium), so authoring them now would assume a tooling direction, which [[feedback-consumer-first-surface-design]] forbids. Pushed to a branch for operator review; NOT merged (decision-gated, per the AFK commit-push-flag permission). **Recommend the operator weigh re-prioritising to MVP** given the gauntlet is largely runnable.
