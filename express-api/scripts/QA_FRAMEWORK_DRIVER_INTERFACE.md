# QA Framework — Driver Canonical Interface

This document closes gap **B2** from the QA-runner framework tracker:
"Driver method surface inconsistency". It documents the **intentional**
divergence in driver method counts across categories, defines the
canonical core method set every driver MUST implement, and pins the
current per-driver surface for regression detection.

## Why method counts vary 19× (2 to 77)

The current surface (run `node express-api/scripts/driver-surface-report.js`
for the live numbers):

| Driver                              | Methods | Category                                                                         |
| ----------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `web-playwright-driver`             | 77      | **Web full-surface** — every journey-step method (auth, room, gift, admin, etc.) |
| `android-adb-driver`                | 72      | **Native Android full-surface** — adb-driven UI dump + tap + journey steps       |
| `ios-devicectl-driver`              | 66      | **Native iOS (devicectl)** — XCUITest harness for iOS 17+ devices                |
| `ios-simctl-driver`                 | 66      | **Native iOS (simctl)** — XCUITest harness for iOS Simulator                     |
| `ios-appium-driver`                 | 11      | **iOS bridge** — minimal Appium WebDriver wrapper                                |
| `web-mobile-chrome-android-driver`  | 2       | **Web-mobile wrapper** — Playwright CDP → Android Chrome                         |
| `web-mobile-samsung-android-driver` | 2       | Web-mobile wrapper                                                               |
| `web-mobile-edge-android-driver`    | 2       | Web-mobile wrapper                                                               |
| `web-mobile-firefox-android-driver` | 2       | Web-mobile wrapper                                                               |
| `web-mobile-safari-ios-driver`      | 2       | Web-mobile wrapper                                                               |
| `web-mobile-webkit-ios-driver`      | 2       | Web-mobile wrapper                                                               |

**The divergence is intentional**, not a bug:

- **Full-surface drivers** (web-playwright, android-adb, ios-devicectl,
  ios-simctl) own the entire journey-step surface for their platform.
  Every Gherkin step matcher in the journey runner needs a backing
  method here.
- **Bridge drivers** (ios-appium) wrap a third-party WebDriver-style
  API and expose just enough surface to bootstrap + handle session
  lifecycle. Journey steps fall through to platform-specific bridges
  in the runner.
- **Web-mobile wrappers** (web-mobile-\*-driver) are thin façades over
  web-playwright-driver. They contribute `webRefreshRoomsList` and
  `webUiDump` and inherit everything else from playwright via the
  base driver. The 2 methods are the wrapper-specific deltas.

The wide range is the **correct surface** for each category. A
"unify them all" refactor would force web-mobile wrappers to
reimplement 75 methods that just delegate.

## Canonical core method set

Every driver MUST implement these 2 methods (enforced by
`tests/scripts/drivers/driver-contract.test.js`):

| Method          | Purpose                                                                                               | Pinned by                 |
| --------------- | ----------------------------------------------------------------------------------------------------- | ------------------------- |
| `close()`       | Tear down driver resources (browser, adb forwards, Appium session, etc.)                              | `driver-contract.test.js` |
| `listMethods()` | Enumerate the driver's method names; backs the `--check-drivers` + `driver-surface-report.js` tooling | `driver-contract.test.js` |

Beyond the core, each **category** has a recommended method set:

### Web drivers (web-playwright, web-mobile-\*)

| Method                                                  | Purpose                                                | Surface                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `webUiDump(name)`                                       | Return per-tab DOM dump for inspection / smoke testing | Required by `--smoke`                                   |
| `webRefreshRoomsList(name)`                             | Navigate to `/rooms` and reload                        | Required by web journeys                                |
| `webTap(tag)` / `webFillIn(...)` / `webOpenScreen(...)` | Domain interactions                                    | web-playwright only; web-mobile inherits via delegation |

### Native Android drivers (android-adb)

| Method                                     | Purpose                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `androidUiDump()`                          | Capture window hierarchy via `adb shell uiautomator dump` |
| `androidTap(tag)` / `androidTapByTag(tag)` | Tap by stable test-tag                                    |
| `androidOpenScreen(name)`                  | Navigate via deep-link intent                             |
| Plus ~65 journey-step methods              | Domain interactions                                       |

### Native iOS drivers (ios-devicectl, ios-simctl, ios-appium)

| Method                             | Purpose                                         |
| ---------------------------------- | ----------------------------------------------- |
| `iosUiDump()` / `iosWindowDump()`  | Capture window hierarchy via XCUITest or Appium |
| `iosTap(...)` / `iosTapByTag(...)` | Tap by stable test-tag                          |
| Plus journey-step methods          | Domain interactions                             |

## Aspirational uniformity (future work)

Where it makes sense, methods could be RENAMED for cross-platform
parity (e.g. `tap(tag)` instead of `androidTap` / `iosTap`). That
would require:

1. A migration phase where both names are accepted
2. Updating every Gherkin step matcher in the journey runner
3. A `LEGACY_METHOD_NAMES` deprecation map per driver

This is explicitly **out of scope** for B2 — the gap was about
documenting the current state and pinning regression detection.
Operator can decide if/when to invest in unification based on real
maintenance pain.

## Regression detection

Three layers pin the current surface:

1. **`driver-contract.test.js`** (PR #917) — every driver in
   `drivers/` exports `listMethods()` and a `*_METHOD_NAMES`
   constant; `close()` is reachable on each constructed driver.

2. **`driver-surface-report.js`** (PR #926) — diagnostic tool that
   prints per-driver method counts. Operator runs periodically to
   notice unexpected drift.

3. **`driver-interface-pin.test.js`** (this PR) — pins the **CURRENT
   method counts per driver** in a snapshot. A driver gaining/losing
   methods updates the snapshot deliberately; an accidental drop
   surfaces as a red test.

## Related docs

- [QA_FRAMEWORK_ARCHITECTURE.md](./QA_FRAMEWORK_ARCHITECTURE.md) —
  how runner/dispatcher/drivers fit together
- [QA_FRAMEWORK_DRIVER_AUTHOR_GUIDE.md](./QA_FRAMEWORK_DRIVER_AUTHOR_GUIDE.md) —
  how to add a new browser/driver
- [QA_FRAMEWORK_TROUBLESHOOTING.md](./QA_FRAMEWORK_TROUBLESHOOTING.md) —
  diagnosis for common failures
