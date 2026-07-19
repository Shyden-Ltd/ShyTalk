---
id: SHY-0215
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

# SHY-0215: Visual regression testing — web, shared Compose UI, real-device smoke

## User Story

As a ShyTalk user, I want the interface to keep looking right — no clipped buttons, broken layouts, wrong colors, or overlapping text — after every change, and as the operator I want **automated visual regression** on the website, the shared Compose UI, and the two real devices, so a layout regression fails a test before launch instead of shipping a visually-broken screen, without bloating the repo the way historical screenshot commits did (SHY-0128).

## Why

The audit confirmed **no visual regression testing** — no Playwright `toHaveScreenshot`, no Paparazzi/Roborazzi, no iOS snapshot testing. Functional tests pass while a screen is visually broken (misaligned, clipped, wrong theme). For an MVP that must look trustworthy to users (and their parents), a silent visual regression is a credibility and safety-signal risk. This story adds **real** visual checks — the real browser for web, host-rendered Compose snapshots for the shared UI (a legitimate unit-location per the no-stubs rule), and real-device screenshot smoke for platform chrome — registered into SHY-0212's runner, with an explicit anti-bloat budget so baselines can't regrow the repo problem SHY-0128 fixed.

## Acceptance Criteria

### Happy path

- [ ] **Web (Playwright `toHaveScreenshot`):** `tests/visual/*.visual.spec.ts` capture key pages/states in the REAL browser matrix and compare against committed baselines with a documented pixel/ratio threshold — public roadmap, sign-in (both entries), room list, in-room, messaging, payments, admin. Registered `visual-web` (`stack`, `publicArea: Cross-cutting`).
- [ ] **Shared Compose UI (Roborazzi):** host-rendered snapshot tests in `shared/src/*Test` (or `app` host test set) render the key composables/screens to bitmaps and compare against baselines — deterministic, no device. Registered `visual-compose` (`host`, `publicArea: Cross-cutting`).
- [ ] **Real-device smoke:** during the device gauntlet, key screens are captured on a real Android device and a real iPhone and compared against committed device baselines to catch platform-specific rendering (fonts, insets, safe-area, status bar). Registered `visual-device` (`device`, `publicArea: Cross-cutting`).
- [ ] A regression above threshold FAILS with a side-by-side (expected / actual / diff) artifact; an intentional visual change is accepted by an explicit, reviewed baseline-update command (`--update-snapshots` equivalent), never auto-accepted in CI.
- [ ] All three register into `scripts/test/framework-registry.mjs`, emit normalized `metadata.json` (SHY-0212 contract), and `docs/testing/visual-regression.md` explains in plain language what a visual diff means and how to update a baseline intentionally.
- [ ] An **anti-bloat gate** (`scripts/test/check-baseline-budget.mjs`) enforces: baselines are optimized PNGs, each under a per-image size cap, total baseline footprint under a repo budget, and no baseline exceeds the 5 MiB large-file rule — failing CI if a baseline commit would bloat the repo ([[feedback-cache-and-reuse-principle]], SHY-0128 lesson).

### Error paths

- [ ] A layout regression (clipped button, shifted element) FAILS `visual-web`/`visual-compose` producing the expected/actual/diff triptych and naming the screen + diff ratio.
- [ ] A theme/color regression (wrong dark-mode color, contrast shift) is caught by the pixel diff, not silently passed.
- [ ] CI NEVER auto-updates a baseline on failure — a failing visual test stays failing until a human reviews and intentionally re-baselines (guards against "green by overwriting the truth").
- [ ] A missing baseline (new screen with no committed reference) FAILS with "no baseline — create one intentionally", not an auto-pass.

### Edge cases

- [ ] Non-deterministic UI (timestamps, animations, avatars, randomized content) is masked/frozen (fixed clock, disabled animations, seeded data) so diffs reflect real regressions, not noise — masks are declared per-test and reviewed.
- [ ] Font rendering differences across the browser matrix (Chromium vs WebKit vs Firefox) are handled by per-browser baselines or a tuned threshold — a cross-browser AA-rendering delta does not false-fail.
- [ ] Dark mode + light mode are both baselined for theme-aware screens.
- [ ] A screen that legitimately changes every render (e.g. a live trend chart) is either excluded with rationale or region-masked — documented in the visual README.
- [ ] Device baselines are per-device-class (the specific real Android + real iPhone models the gauntlet uses), not a single universal image.

### Performance

- [ ] `visual-compose` (host) runs fast (JVM render, no device/browser) and is part of the default `--profile host` fast feedback.
- [ ] `visual-web` reuses the existing Playwright browser sessions (screenshots piggyback on pages the e2e/a11y suites already visit where possible) to bound added wall-clock.
- [ ] Baseline image count + total size are reported each run so footprint growth is visible before it becomes bloat.

### Security

- [ ] Baselines and diff artifacts carry NO PII — seeded test data only; any screen showing user content uses fixed non-personal fixtures (belt with SHY-0223).
- [ ] Visual tests introduce no new backend access — they render real UI fed by the real API via the sanctioned chokepoint ([[feedback-no-direct-backend-all-via-api]]).

### UX

- [ ] Failure output links directly to the expected/actual/diff images and states which screen + what changed, so a human can judge "real regression vs intended change" in seconds.
- [ ] `docs/testing/visual-regression.md` explains, plainly, how to read a diff and the exact one command to intentionally re-baseline after a deliberate design change.

### i18n

- [ ] Key screens are baselined in at least one non-Latin locale (e.g. `zh`) and one RTL locale (`ar`) so a translation that overflows/clips or an RTL mirroring break is caught visually, not just functionally.
- [ ] Font-fallback for CJK/Arabic glyphs renders without tofu (□) on the baselined screens — a missing-glyph regression fails the diff.

### Observability

- [ ] Each sub-framework's `metadata.json` records screens-checked, diffs-found, and max diff ratio, feeding a plain-language "looks right ✓" signal per surface for SHY-0220.
- [ ] Diff artifacts are uploaded to CI (bounded retention, not committed to gh-pages history — SHY-0128 discipline), greppable by `[framework:visual-web|visual-compose|visual-device]`.

## BDD Scenarios

**Scenario: A clipped-button layout regression fails the web visual gate**
- **Given** a CSS change that clips the "Join room" button on the room list
- **When** `visual-web` runs `toHaveScreenshot` in the real browser
- **Then** the test fails
- **And** an expected/actual/diff triptych is produced naming the screen and diff ratio

**Scenario: A shared Compose regression is caught on the host, fast**
- **Given** a composable padding change that shifts the sign-in layout
- **When** `visual-compose` renders the screen on the JVM and compares to baseline
- **Then** the host test fails without needing a device
- **And** the diff image identifies the shifted region

**Scenario: CI never auto-accepts a visual change**
- **Given** an intentional redesign that changes a baselined screen
- **When** the visual suite runs in CI
- **Then** it FAILS (baseline mismatch)
- **And** it does NOT overwrite the baseline
- **And** the baseline only updates when a human runs the explicit re-baseline command locally and commits it

**Scenario: A translated string that overflows is caught visually**
- **Given** the room list under a locale whose label is longer than the button
- **When** `visual-web`/`visual-compose` compares the localized screen to its locale baseline
- **Then** the overflow/clip is caught as a visual diff

**Scenario: Baseline bloat is blocked**
- **Given** a new baseline PNG committed at 8 MiB unoptimized
- **When** `check-baseline-budget.mjs` runs in CI
- **Then** it fails naming the oversized baseline and the budget
- **And** the commit cannot merge until the baseline is optimized/removed

**Scenario: Visual verdict reaches the public page**
- **Given** a completed visual run
- **When** SHY-0220's page reads the visual `metadata.json`
- **Then** it can show "Looks right ✓" per surface

## Test Plan

**Classification:** mixed. `visual-web` is real-only (real browser, real local-served site — `stack`). `visual-compose` is host-rendered pure-UI snapshotting in a unit-location source set (`jvmTest`/`src/test`) — permitted by the no-stubs rule (no backend collaborator). `visual-device` is real-only on real Android + real iPhone (`device`). No simulated rendering stands in for a real device journey.

### Red — write failing tests first

- Web: `tests/visual/sign-in.visual.spec.ts`, `room-list.visual.spec.ts`, `messaging.visual.spec.ts`, `payments.visual.spec.ts` — each `test('matches baseline')`; a RED fixture with a deliberate layout break proves the gate fails.
- Compose: `shared/src/.../SignInScreenSnapshotTest.kt`, `RoomListSnapshotTest.kt` (Roborazzi) — `@Test fun signInMatchesBaseline()`; a RED variant with altered padding proves failure; plus locale variants (`zh`, `ar`).
- Device: capture-and-compare steps added to the device gauntlet for the key screens on both real devices.
- Budget: `express-api/tests/scripts/visual/baseline-budget.test.js` — `it('fails an oversized baseline')`, `it('fails when total footprint exceeds budget')`, `it('passes the live baselines')`.

### Green — implement

1. Enable Playwright screenshot comparison + author `tests/visual/*` + commit optimized baselines (per browser where needed).
2. Add Roborazzi to the shared/app host test set + author the Compose snapshot tests + baselines.
3. Add device capture/compare to the gauntlet with committed device baselines.
4. Build `scripts/test/check-baseline-budget.mjs` + wire into `lint.yml`; register all three; write `docs/testing/visual-regression.md`.
5. Fix any real visual regression surfaced; re-baseline only intended changes.

### Gauntlet

Touches app (`shared/**`, `app/**`, `iosApp/**`) + web → FULL Pre-Merge Testing Protocol; `visual-web` across the browser matrix, `visual-device` on real Android + real iPhone before merge.

## Out of Scope

- A paid/SaaS visual platform (Percy/Argos/Chromatic) — $0 constraint; native Playwright + Roborazzi + committed baselines only.
- Pixel-perfect cross-device parity (impossible/undesirable) — the goal is regression detection against a per-surface baseline, not identical rendering everywhere.
- Full design-system snapshot coverage of every component (start with the key user-journey screens; expand via follow-up SHYs if valuable).
- History rewrite of prior screenshot bloat (SHY-0128 already capped it) — this story only prevents NEW bloat.
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes a visual signal to SHY-0220.
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata contract). Uses existing Playwright + adds Roborazzi to the Kotlin build.
- **Tooling:** Playwright screenshots (already present); Roborazzi (JVM Compose snapshot, $0); optipng/pngquant-class optimization in the budget gate. All $0.

## Risks & Mitigations

- **Risk:** Repo bloat from committed baselines (the SHY-0128 problem). **Mitigation:** `check-baseline-budget.mjs` caps per-image + total size, enforces optimization, honors the 5 MiB rule; baselines are component/key-screen scoped, not full-page-everything ([[feedback-cache-and-reuse-principle]]).
- **Risk:** Flaky diffs from anti-aliasing/fonts/animations. **Mitigation:** Fixed clock, disabled animations, seeded data, per-browser baselines or tuned thresholds, declared masks — a flake is root-caused, not retried ([[feedback-no-auto-retry-workflows]]).
- **Risk:** "Green by re-baselining" — a real regression hidden by overwriting the reference. **Mitigation:** CI never auto-updates; re-baselining is a local, explicit, diff-reviewed act; the reviewer inspects baseline diffs like code.
- **Risk:** iOS Compose rendering has no first-class host snapshot tool. **Mitigation:** shared-Compose host snapshots (Roborazzi) cover the cross-platform composition; iOS-specific chrome is covered by real-device smoke — the combination is honest without a simulator stand-in.
- **Risk:** Baseline sprawl across the browser matrix. **Mitigation:** Baseline only where a browser genuinely renders differently; prefer a single tuned threshold; document the policy.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `visual-web` (browser matrix), `visual-compose` (host), `visual-device` (real Android + real iPhone) all green with committed, budgeted baselines.
- [ ] `check-baseline-budget.mjs` wired into `lint.yml`; total baseline footprint within budget; no baseline over 5 MiB.
- [ ] All three registered; `docs/testing/visual-regression.md` present + plain-language; `metadata.json` emitted.
- [ ] Every real visual regression surfaced is fixed; only intended changes re-baselined.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0215-visual-regression-testing`; PR title `SHY-0215: Visual regression testing — web, shared Compose UI, real-device smoke`; FULL gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator listed visual regression explicitly). Design rulings: (1) host-rendered Compose snapshots (Roborazzi) are a legitimate unit-location per the no-stubs rule, giving fast `host` feedback; real-device smoke covers platform chrome. (2) Anti-bloat is first-class — `check-baseline-budget.mjs` enforces the SHY-0128 lesson so baselines can't regrow the repo. (3) $0 only — native Playwright + Roborazzi + committed baselines, no SaaS. (4) CI never auto-re-baselines; re-baselining is an explicit, reviewed human act.
