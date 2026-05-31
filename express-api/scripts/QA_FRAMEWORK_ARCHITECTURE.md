# QA Framework — Architecture Overview

How the pieces fit. Read this when adding a new browser to the matrix,
debugging an unfamiliar dispatch path, or onboarding to the runner
codebase. Companion to [`QA_FRAMEWORK_SETUP.md`](./QA_FRAMEWORK_SETUP.md)
(operator setup) and
[`QA_FRAMEWORK_TROUBLESHOOTING.md`](./QA_FRAMEWORK_TROUBLESHOOTING.md)
(symptom-first failure reference).

---

## Goals

The manual QA runner is a **Gherkin-step executor with pluggable
drivers**, designed so a single corpus of `.feature` files can be
exercised across every (browser × platform) combination in the
12-cell matrix without scenario rewrites. The driver layer absorbs
the differences between Playwright-on-desktop, CDP-over-adb on
Android Chrome, Appium safari-context on iOS, and native control
via simctl / devicectl / adb.

---

## High-level shape

```
                          .feature files (Gherkin corpus)
                                       │
                                       ▼
            ┌──────────────────────────────────────────────┐
            │              manual-qa-runner.js              │
            │   parse → scenario loop → step matchers       │
            └──────────────────────────────────────────────┘
                                       │
                       (dispatches matched step to driver)
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            │                                                       │
            ▼                                                       ▼
   ctx.webDriver (browser ops)              ctx.uiDriver (native control)
            │                                                       │
            ▼                                                       ▼
    drivers/web-* (factories)              drivers/android-adb, ios-{simctl,
            │                              devicectl,appium}
   ┌────────┴────────┐
   │                  │
   ▼                  ▼
Playwright       CDP-over-adb,
                  Appium WebDriver
```

---

## Components

### `manual-qa-runner.js` (the orchestrator)

Single file. Combines:

- **CLI** (`main()`) — flag parsing + early-exit short-circuits
  (`--help`, `--version`, `--list`).
- **Gherkin parser** (`parseGherkin`) — extracts Feature / Scenario /
  Step tuples from `.feature` files.
- **Step matcher registry** (`matchers`) — maps step text patterns to
  driver-method dispatches. Implementations live with the runner;
  drivers expose method names matching the matcher dispatches.
- **Scenario runner** (`runScenario`) — executes a scenario's steps
  in order against the constructed `ctx` (drivers + state).
- **Matrix dispatcher** (in-file at the `--matrix` branch) — spawns
  per-cell subprocesses; collates outcomes; produces JSON/JUnit
  reports.
- **Pure helpers** — `classifySeverity`, `decodeJwtPayload`,
  `pickField`, `parseLiteral`, `parseKvPairs`, `parseJsonishPredicate`,
  `formatReport`, `formatUsage`, `formatVersion`, `formatListJson`.

Exports both the helpers (for unit tests) AND `main()` (gated on
`require.main === module` so requiring the module doesn't trigger
CLI flow).

### `browser-allowlist.js` (matrix policy)

Single source of truth for which cells run per target environment:

- `DESKTOP_BROWSERS` — `[chromium, firefox, webkit, edge]`
- `MOBILE_BROWSERS` — 4 Android slugs + 4 iOS slugs
- `SUPPORTED_BROWSERS` — the union (12)
- `TARGET_BROWSER_ALLOWLIST` — per-target subset (`local` = full
  matrix; `dev` = `chromium + mobile-chrome-android`; `prod` =
  `chromium` only)
- `allowedBrowsersFor(target)` — pure lookup helper
- `isMobileBrowser(slug)` — predicate

Extracted from the runner so the matrix policy can be unit-tested
without spawning subprocesses, and so the `--list` flag can serialise
the policy as JSON for `--list | jq` scripting.

### `drivers/` (the factory + impl per cell)

Every file matching `*-driver.js` is a driver and conforms to the
contract pinned by `tests/scripts/drivers/driver-contract.test.js`:

1. Loads via `require()` with no env vars set (lazy-load env-bound work).
2. Exports a factory function `createXxxDriver({...opts})` that
   returns a driver instance (or throws an init-error if the local
   toolchain isn't present).
3. Exports a `listMethods()` function returning the canonical method
   names this driver implements.
4. Exports a `*_METHOD_NAMES` constant array matching `listMethods()`.

Categories:

- **Desktop web** — `web-playwright-driver.js` (chromium / firefox /
  webkit / edge via Playwright direct-launch).
- **Mobile web** — `web-mobile-{chrome,edge,firefox,samsung}-android-driver.js`
  (CDP-over-adb to the connected Android device's browser);
  `web-mobile-{safari,webkit}-ios-driver.js` (Appium safari-context).
  All 6 expose the same `WEB_MOBILE_METHOD_NAMES = ['webRefreshRoomsList',
'webUiDump']` minimal surface — they're shim drivers delegating
  to the underlying browser engine.
- **Native iOS** — `ios-simctl-driver.js` (simulator), `ios-devicectl-driver.js`
  (Xcode 18+ real-device control), `ios-appium-driver.js` (XCUI via Appium).
- **Native Android** — `android-adb-driver.js` (adb shell + activity
  manager).
- **Helpers** (not drivers): `android-cdp-helpers.js`,
  `ios-driver-loader.js` — explicitly excluded from the contract test.

### `matrix-dispatch.js`

The per-cell subprocess management. Used by the runner's `--matrix`
branch. Responsible for:

- Iterating the allowed-browsers list for the target.
- Spawning one Node subprocess per cell with `--browser <slug>`
  and the per-cell flags stripped (so the subprocess doesn't
  recursively run a matrix).
- Honoring `--cell-timeout` (SIGTERM after N seconds → outcome
  `timeout`).
- Capturing per-cell stdio when `--report-dir` is set
  (via `matrix-cell-logs.js`).
- Reporting outcomes in JSON or JUnit format
  (`formatMatrixResultJson` / `formatMatrixResultJunit`).

### `driver-health-check.js`

Pure helper backing the `--check-drivers` flag. Iterates the
browser allowlist, instantiates each driver's factory, and
classifies the outcome:

- `ok` — factory returned a driver; `close()` called cleanly.
- `skip` — factory threw a recognized init-error (no device,
  toolchain missing). Acceptable in CI on ubuntu where mobile
  cells naturally lack devices.
- `fail` — factory threw an unexpected error. Exits the runner
  with status 1.

---

## Data flow — a typical `--matrix --target dev` run

```
1. CLI parse → opts = { matrix: true, target: 'dev', driver: 'playwright' }
2. --help / --version / --list check → not set, continue
3. PERSONAS_PASSWORD + FIREBASE_DEV_API_KEY validated
4. Matrix branch entered:
   a. allowed = allowedBrowsersFor('dev')
              = ['chromium', 'mobile-chrome-android']
   b. baseArgv = process.argv minus matrix-only flags
   c. For each cell in allowed:
      - Spawn `node manual-qa-runner.js ${baseArgv} --browser ${cell}`
      - Capture stdio if --report-dir
      - Enforce --cell-timeout if set
      - Collect { browser, outcome, durationMs, ... }
5. Aggregate → matrixResult.ok = none-failed
6. Optionally write report (--report-output)
7. Exit 0 (all passed) or 1 (any cell failed/timeout)
```

The per-cell subprocess re-enters `main()` with `--browser X` (and
no `--matrix`), takes the non-matrix branch, instantiates the
driver factory for `X`, runs every scenario in the corpus against
that driver, and exits with its own success/failure code.

---

## Extension points

### Adding a new browser cell

Four places to touch (the contract test surfaces three of them
automatically if you miss one):

1. **`browser-allowlist.js`** — add the slug to `MOBILE_BROWSERS` (or
   `DESKTOP_BROWSERS`) and to `TARGET_BROWSER_ALLOWLIST.local`
   (and `dev`/`prod` if applicable).
2. **`drivers/<slug>-driver.js`** — implement the factory + the
   contract exports (`createXxxDriver`, `listMethods`,
   `*_METHOD_NAMES`).
3. **`manual-qa-runner.js`** — register the driver factory in the
   `--driver` routing block (look for existing entries near the
   `createWebDriver`/`createMobileChromeAndroidDriver` registrations).
4. **`tests/scripts/drivers/`** — add a dedicated driver test file
   for unit coverage. The contract test will auto-pick up the new
   driver via discovery — no test-infra edit needed for the
   contract layer.

### Adding a new step

1. **`.feature` files** — add the step text in your scenario(s).
2. **`manual-qa-runner.js`** — add a matcher entry in `matchers`
   that dispatches to a driver method. If the step needs a new
   method on every driver, add it to each driver AND to the
   driver's `*_METHOD_NAMES` constant + `listMethods()` (contract
   test will fail otherwise).
3. **`tests/scripts/manual-qa-runner.test.js`** — add unit
   coverage for the matcher (input string → expected dispatch).

### Adding a new flag

1. **`manual-qa-runner.js`** — extend the parser loop (around the
   `flat[i] === '--xxx'` chain), the validation block, and the
   business-logic branch that consumes the flag.
2. **`formatUsage()`** — document it. The drift-catch test
   (`tests/scripts/manual-qa-runner-help-version.test.js`) will
   fail otherwise.
3. **`tests/scripts/manual-qa-runner-*.test.js`** — add a focused
   test file for the new flag's behavior + CLI integration.

---

## Where to look when something breaks

| Symptom                              | Where to look                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Cell hangs                           | `--cell-timeout`; matrix-dispatch.js SIGTERM path                             |
| Driver crashes at bootstrap          | `drivers/<slug>-driver.js` factory; `driver-health-check.js` classification   |
| Wrong cells dispatched               | `browser-allowlist.js` policy + `allowedBrowsersFor`                          |
| Step text doesn't dispatch           | `matchers` table in `manual-qa-runner.js`                                     |
| Matrix subprocess can't find PR flag | matrix-dispatch.js' `stripFlags` set + the parser's recognition list          |
| CI fails on driver change            | `.github/workflows/qa-runner-driver-checks.yml` + the contract test           |
| `--check-drivers` silent in CI       | Driver factory likely reads `process.env` at module-top; lazy-load it instead |

---

## Test-coverage map

| Area                           | Test file                                             |
| ------------------------------ | ----------------------------------------------------- |
| Gherkin parsing + matchers     | `tests/scripts/manual-qa-runner.test.js`              |
| CLI: `--help` / `--version`    | `tests/scripts/manual-qa-runner-help-version.test.js` |
| CLI: `--list`                  | `tests/scripts/manual-qa-runner-list-flag.test.js`    |
| Browser allowlist policy       | `tests/scripts/browser-allowlist.test.js`             |
| Driver-bootstrap diagnostic    | `tests/scripts/driver-health-check.test.js`           |
| Driver contract (every driver) | `tests/scripts/drivers/driver-contract.test.js`       |
| Per-driver unit coverage       | `tests/scripts/drivers/<driver-name>.test.js`         |
| CI integration pin             | `tests/scripts/qa-runner-driver-checks-pin.test.js`   |

When adding a new feature, mirror the layer: pure-helper tests next
to `manual-qa-runner.test.js`; flag-specific behavior in a focused
file; driver-specific tests under `drivers/`.
