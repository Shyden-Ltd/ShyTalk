# Session handoff — 2026-08-19

Durable state for the next session. Do not rely on chat scrollback.

---

## Merged to develop today (6)

| PR | Story | What |
| --- | --- | --- |
| #1803 | SHY-0346 | Two tracked `node_modules` **symlinks** removed; `.gitignore` made slash-less so nested `node_modules` is ignored at any depth |
| #1810 | SHY-0349 | Lucky Spin odds-disclosure story filed |
| #1809 | SHY-0342 | Age-rating answer sheet for both stores |
| #1815 | SHY-0352 | CI never compiles the iOS target (filing) |
| #1816 | SHY-0353 | Pre-merge gate's filing exemption waves code through (filing) + **story index backfilled, it was 8 stories stale** |
| #1819 | SHY-0354 | No journey opens a follow list and reads the names (filing) |

## Open, device-proven, awaiting CI

All four are `In Review`, carry a `Reviewed-up-to:` marker, and are proven on
**both** a real OnePlus and a real iPhone.

| PR | Story | State |
| --- | --- | --- |
| #1800 | SHY-0338 | follow/stalker lists. **Decision (b) taken**: ships on device-walk evidence, journey coverage filed as SHY-0354 |
| #1807 | SHY-0350 | user search. 6 Kotlin tests + 8 endpoint tests, mutation-proven |
| #1808 | SHY-0348 | blocked profile. iOS compile break fixed (see below) |
| #1812 | SHY-0351 | room block-warning. New `POST /api/users/blocked-by`; 8 mutations, 8 kills |
| #1696 | SHY-0275 | iOS-local. **Needs an operator decision** — see below |

## Things that will bite the next session

- **`gh workflow run seed-dev-personas.yml` FAILS on the default branch.** main
  still references `secrets.PERSONAS_PASSWORD_DEV`; the secret was renamed to
  `DEV_QA_PERSONAS_PASSWORD` and only develop was updated. main also predates the
  SHY-0269 guard, so it dies deep in the provision script with an opaque
  `MISSING_ENV`. **Always pass `--ref develop`.** This is behind the
  `deploy-dev.yml` comment about "five of the last eight dev deploys" failing to
  seed. Fixes itself at the next develop→main promotion.
- **CI never compiles the iOS target** (`grep -rl compileKotlinIosArm64
  .github/workflows/` → nothing). SHY-0348 shipped a branch that could not build
  for iOS with every check green. Filed as SHY-0352. Note it needs a **macOS**
  runner — Kotlin/Native cannot build Apple targets from Linux.
- **The pre-merge gate's filing exemption skips the status gate for PRs that ship
  code**, in BOTH `pr-merge-check.sh:65` and `check-pr-story-status.js:87`. Filed
  as SHY-0353. Until fixed, check by hand that a "filing" PR really is one.
- **A `git worktree` cannot run the gauntlet.** `express-api/scripts/gauntlet/lib.sh:61`
  tests `[ -d "$REPO/.git" ]`, and in a worktree `.git` is a FILE. Ten
  `50-matrix` tests fail from any worktree and pass from the main clone.
- **iOS device testing works WITHOUT SHY-0275.** Use
  `scripts/ios/build-debug-dev.sh` — Debug-Dev over USB against the **dev**
  backend. #1696 fixes iOS *local* (faster, $0), not iOS testing as such.

## iOS automation, if you need the iPhone

The WDA jam recurred and was cleared with the documented reset (uninstall
`com.shyden.WebDriverAgentRunner.xctrunner`, restart Appium) **plus the operator
entering the device passcode on-device** — XCUITest cannot type it. Sound-notify
before starting a walk. Three traps that cost real time today are recorded in
`reference-ios-appium-walk-recipe`: the soft keyboard overlays the Continue
button; WDA's `value` endpoint on a Compose text field is cosmetic (type on the
keyboard and watch the character counter); picker cells scroll horizontally so a
naive name match taps off-screen coordinates.

## Needs the operator

1. **#1696 (SHY-0275)** — bundles four stories and relaxes the LiveKit
   cleartext-signalling allow-list for private-LAN addresses in DEBUG builds.
   Merge as-is, or split into four? The security relaxation deserves their eyes.
2. **Age rating** — the answer sheet is written and merged; entering both
   questionnaires is theirs. Verdict: 13+ achievable but not automatic.
3. **develop→main promotion is still owed** — and would fix the seed-workflow
   break above.
