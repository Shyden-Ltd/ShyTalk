# Step runner — how Gherkin phrases dispatch

The /manual-qa skill's autonomous mode parses each `.feature` file and routes step phrases through this dispatch table. Each phrase resolves to a concrete tool invocation: Playwright MCP (web), adb shell (Android), simctl (iOS), Firebase Admin REST (Firestore), or a Bash one-shot for environment setup.

This file is the canonical map. When the skill encounters a step phrase, it looks here first to find the binding; if absent, the step is a finding (Major: "Step not implemented").

## Dispatch by platform tag

A Scenario inherits the platform context from its tags. If multiple platform tags (`@web @android @ios`), the skill runs the scenario once per platform that is reachable in the current env.

- `@web` → resolve via the `web:` column below
- `@android` → resolve via the `android:` column
- `@ios` → resolve via the `ios:` column
- (no platform tag) → assumed to be API-only (Firestore / Express), no UI

## Dispatch table

### Environment + state setup

| Phrase | web | android | ios | api |
|---|---|---|---|---|
| `Given the local stack is healthy` | curl `http://localhost:8888` → 200 | curl `http://localhost:3000/api/health` → 200 | curl `http://localhost:3000/api/health` → 200 | env precondition |
| `Given the device locale is "{lang}"` | `browser_evaluate(() => { ShyTalkLanguage.set('lang'); applyLegalTranslations(...) })` then reload | `adb shell setprop persist.sys.locale {lang}` + relaunch app | `xcrun simctl spawn booted defaults write -g AppleLanguages "({lang})"` + relaunch | n/a |
| `Given the viewport is {w}x{h}` | `browser_resize({width: w, height: h})` | n/a | n/a | n/a |
| `Given two seeded accounts exist: <table>` | Firestore Admin: write each row to `users/{uniqueId}` + `identityMap/email:{email}` | same | same | direct call |

### Authentication

| Phrase | web | android | ios | api |
|---|---|---|---|---|
| `Given the user is signed out` | `browser_evaluate(() => { localStorage.clear(); document.cookie = '...'; })` then navigate to sign-in | `adb shell am force-stop ${pkg}` + clear app data | `xcrun simctl uninstall booted ${bundleId}` (heavy) or app's own sign-out | clear `users/{uid}` session-tracking |
| `Given the user is signed in as "{email}"` | Firebase Auth REST `signInWithPassword` → set localStorage with idToken | tap Dev Sign-In button (if available) OR firestore-admin mint-id-token + adb deep-link | same as android | mint via firebase-admin |
| `Given the user is signed in as a fresh dev QA account` | Use claude-qa@shytalk.dev + password from `~/.shytalk/dev-qa-credentials` | same | same | same |
| `When the user signs out` | tap signout button OR clear localStorage | tap signout button via adb input tap | tap via simctl (uiautomator-equivalent) | n/a |

### Navigation

| Phrase | web | android | ios |
|---|---|---|---|
| `When the user opens the "{screen}" screen` | `browser_navigate(BASE + '/' + screen)` for static pages; for SPA route, evaluate `router.push(route)` | `adb shell am start -n {pkg}/com.shyden.shytalk.MainActivity` with screen deep-link extra OR uiautomator dump → find + tap nav element | `xcrun simctl openurl booted shytalk://${screen}` |
| `Given the user is on the "{screen}" screen` | assert URL matches; if not, navigate | uiautomator dump → check current activity / screen tag | uiautomator-equivalent via Accessibility |
| `When the user taps the element with tag "{tag}"` | `browser_evaluate(() => document.querySelector('[data-testid="tag"]').click())` | uiautomator dump → find by `resource-id` containing `tag` → `input tap x y` at element center | xcrun simctl Accessibility tap |
| `When the user types "{text}" into "{fieldTag}"` | `browser_evaluate(() => { const el = …; el.value = text; el.dispatchEvent(new Event('input')) })` | uiautomator dump → tap field, then `adb shell input text "text"` | xcrun simctl + Accessibility |

### UI assertions

| Phrase | web | android | ios |
|---|---|---|---|
| `Then the UI shows "{text}"` | `browser_snapshot` → text content includes `text` | uiautomator dump → any `text=text` attribute exists | same as android (uiautomator XML via simctl Accessibility) |
| `Then the UI shows the element with tag "{tag}"` | `browser_evaluate(() => !!document.querySelector('[data-testid="tag"]'))` | uiautomator dump → `resource-id` containing tag | same |
| `Then the UI does not show "{text}"` | inverse of the show check | inverse | inverse |
| `Then the screen renders within {ms}ms` | `performance.now()` deltas via browser_evaluate | `adb shell am start … -W` reports timing | xcrun simctl spawn launch with `-PerformanceTimingProfile YES` |
| `Then no JavaScript console errors are present` | `browser_console_messages({level: "error"})` → 0 entries | n/a (or logcat error grep, scoped to app) | n/a (or device log filtering) |

### Firestore state assertions

These are platform-agnostic — they call Firebase Admin SDK via a local node helper. The skill writes a tmp script per assertion and runs `node -r dotenv/config /tmp/assertN.js` against the dev `.env` (read-only credentials).

| Phrase | Helper |
|---|---|
| `Then the database has user "{email}" with cohort "{cohort}"` | query identityMap → users → assert cohort field |
| `Then the database has document "{path}" with field "{field}" equal to {value}` | `db.doc(path).get()`, assert field equality |
| `Then the database does not have document "{path}"` | `(await db.doc(path).get()).exists === false` |
| `Then the database has {n} entries in "{collection}" matching {query}` | `db.collection(c).where(query).count().get()` |
| `Then the audit log records action "{action}" on "{target}" by "{actor}"` | query `adminAuditLog` or `segregationEvents` collection for matching row |

### Concurrency + persistence

| Phrase | Implementation |
|---|---|
| `Given a second device signed in as "{email}"` | spawn second Playwright context (web) / boot second AVD (android) / boot second simulator (ios). Tag the secondary context for subsequent steps. |
| `When both devices simultaneously {action}` | invoke the `{action}` binding in parallel on both contexts within 50ms wall clock |
| `Then both devices converge to the same {fieldset}` | poll both UIs + Firestore until `fieldset` equals across all three sources, with 5s timeout |
| `When the user kills and relaunches the app` | `adb shell am force-stop` then `am start` / `xcrun simctl terminate` then `launch` |
| `When the user uninstalls and reinstalls the app` | `adb uninstall` then `installLocalDebug` / `xcrun simctl uninstall` then `install` |

### @manual handling

For any scenario tagged `@manual`:
1. Autonomous mode logs: `SKIPPED @manual: <scenario> — requires interactive run by a human tester`
2. Check ledger entry. If absent or stale → record as Major finding "stale @manual"
3. Interactive mode prompts the tester step-by-step, captures their sign-off (email + notes + device context), and writes a ledger entry

## What if a step phrase has no binding?

The autonomous run records a **Major finding**: `Step not implemented: <phrase>`. The skill does NOT silently skip — every step has to either run or fail loudly. This is the load-bearing rule.

To add a binding: append a row to this file under the right table, then implement the dispatch logic inside the runner.

## Open questions / known gaps

- Voice audio playback verification — no automation surface; @manual.
- Push notification delivery on emulator — emulator doesn't receive FCM in autonomous mode; @manual for delivery, automated for the dispatcher logic (server-side).
- Biometric prompts — `xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit.enrollmentChanged` can simulate enrollment but actual Touch/Face ID requires hardware; @manual.
- Camera capture (age verification photo upload) — Android emulator simulates with a static image; iOS Sim cannot. @manual on iOS.
- App store / TestFlight installation flows — out of scope; @manual.

When unsure: tag @manual and add a ledger entry. Better a human-verified manual entry than a flaky autonomous step.
