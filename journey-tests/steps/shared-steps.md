# Shared step vocabulary (cross-platform)

These step phrases are the high-level Given/When/Then that feature authors should compose with. Each phrase dispatches to the platform-specific binding listed below based on the active mode (web / android / ios) and the scenario's tags.

The phrases are deliberately abstract — `"the user signs in as X"` resolves to a Firebase Auth REST call (web), an adb-driven tap sequence (android), or a simctl-driven sequence (ios), based on the platform context for the scenario.

## Vocabulary

### Authentication

| Phrase | Binding | Notes |
|---|---|---|
| `Given the user is signed out` | platform.signOut() | Idempotent. |
| `Given the user is signed in as "{email}"` | platform.signIn(email, pwFromLedger) | Uses the persona-picker path (see `BuildVariant.isPersonaPickerAvailable`). Password is the shared persona password from `~/.shytalk/dev-personas.env` (`PERSONAS_PASSWORD`). The single-account dev-sign-in shortcut was removed 2026-06-01 — all dev sign-in now flows through the picker. |
| `When the user signs out` | platform.signOut() | Verifies the local session is cleared in addition to the action. |
| `When the user signs in with email "{email}" and password "{pw}"` | platform.signInWithEmail() | Direct path, NOT through OAuth. @manual scenarios use the OAuth variant. |

### Navigation

| Phrase | Binding | Notes |
|---|---|---|
| `When the user opens the "{screen}" screen` | platform.navigate(screen) | Screen names match the navigation route, NOT the visible title. |
| `Given the user is on the "{screen}" screen` | platform.assertOnScreen() | Sets up state without performing navigation if already there. |
| `When the user taps the "{label}"` | platform.tapByText(label) | Label as rendered. |
| `When the user taps the element with tag "{testTag}"` | platform.tapByTag(tag) | Test tag from Compose modifier or HTML data-testid. |
| `When the user types "{text}" into "{fieldTag}"` | platform.type(fieldTag, text) | Verifies the field accepts the input. |

### State assertions — UI

| Phrase | Binding | Notes |
|---|---|---|
| `Then the UI shows "{text}"` | platform.assertVisibleText(text) | Substring match. |
| `Then the UI shows the element with tag "{testTag}"` | platform.assertVisibleTag(tag) | Visibility AND enabled-ness. |
| `Then the UI does not show "{text}"` | platform.assertNotVisibleText(text) | Important for cohort gate (cross-cohort items must NOT show). |
| `Then the screen renders within {ms}ms` | platform.assertRenderTime(ms) | Performance budget assertion. |
| `Then no JavaScript console errors are present` | platform.assertNoConsoleErrors() | Web only. Other platforms use logcat / device logs. |

### State assertions — Firestore (mutations only)

| Phrase | Binding | Notes |
|---|---|---|
| `Then the database has user "{email}" with cohort "{cohort}"` | firestore.assertUser({email, cohort}) | Reads via Firebase Admin SDK. |
| `Then the database has document "{path}" with field "{field}" equal to {value}` | firestore.assertField(path, field, value) | Generic field assertion. |
| `Then the database does not have document "{path}"` | firestore.assertDocAbsent(path) | Negative existence check (post-deletion). |
| `Then the database has {n} entries in "{collection}" matching {query}` | firestore.assertCount() | Aggregation assertion. |
| `Then the audit log records action "{action}" on "{target}" by "{actor}"` | firestore.assertAuditLog() | Specialized for the adminAuditLog + segregationEvents collections. |

### Locale + viewport setup

| Phrase | Binding | Notes |
|---|---|---|
| `Given the device locale is "{lang}"` | platform.setLocale(lang) | Web: `ShyTalkLanguage.set` + reload. Android: `adb shell settings put system system_locales`. iOS: simctl device locale config. |
| `Given the viewport is {width}x{height}` | platform.setViewport() | Web only; mobile platforms ignore. |
| `Given the viewport is mobile` | shorthand for 375x812 | iPhone-class. |
| `Given the viewport is desktop` | shorthand for 1920x1080 | |

### Concurrency

| Phrase | Binding | Notes |
|---|---|---|
| `Given a second device signed in as "{email}"` | platform.openSecondaryDevice(email) | Spawns a second Playwright context / boots a second simulator / paired AVD. |
| `When both devices simultaneously {action}` | platform.parallelAction() | Coordinates timing within ~50ms. |
| `Then both devices converge to the same {fieldset}` | platform.assertConvergence() | Polls both UIs + Firestore until they agree, with a 5s timeout. |

### Adversarial input

| Phrase | Binding | Notes |
|---|---|---|
| `When the user types {EDGE_CASE} into "{fieldTag}"` | platform.typeEdge(field, EDGE_CASE) | EDGE_CASE values: EMPTY, MAX_LEN, MAX_LEN_PLUS_ONE, ZERO_WIDTH, RLO, EMOJI, SQL_INJECTION_SHAPED, CONTROL_CHARS. |
| `Then the field rejects the input with message "{text}"` | platform.assertFieldRejected() | Server-side rejection is the contract; client-side is convenience. |

### Persistence

| Phrase | Binding | Notes |
|---|---|---|
| `When the user kills and relaunches the app` | platform.killAndRelaunch() | App data persists; in-memory state lost. |
| `When the user uninstalls and reinstalls the app` | platform.reinstall() | App data cleared. Used for "credential survival" scenarios (OAuth tokens shouldn't survive). |
| `Then the session is still active` | platform.assertSessionActive() | Used after kill+relaunch. |
| `Then the session is cleared` | platform.assertSessionCleared() | Used after reinstall. |

### Network simulation (@manual on most platforms)

| Phrase | Binding | Notes |
|---|---|---|
| `Given the network is offline` | platform.offline() | iOS Sim: programmatic. Android: adb shell svc data disable. Web: chrome.debugger Network.emulateNetworkConditions. |
| `Given the network is degraded to 4G` | platform.network4G() | 4Mbps down / 1Mbps up / 50ms latency. |
| `Given the API is unreachable` | platform.apiOffline() | Routes the device to a dead IP for the API host only. |

### Locale fixtures (used by @locale-rtl etc.)

| Locale code | Used by | Notes |
|---|---|---|
| `en` | Baseline | Inline HTML defaults on web; default Locale on app. |
| `ar` | @locale-rtl | RTL layout flip + Arabic script. |
| `ja` | @locale-cjk | CJK rendering, vertical text fallback. |
| `zh` | @locale-cjk alt | CJK rendering, simplified Chinese. |
| `de` | Long-word | German tends to produce the longest UI strings; tests truncation logic. |
| `ru` | Long-word alt | Cyrillic script + long words. |

## Step matching rules

1. Phrases match case-insensitively + whitespace-normalized.
2. `{var}` matches any unicode characters except newline; `{int}` matches digits; `{ms}` matches integer ms; `{EDGE_CASE}` matches one of the documented edge-case constants.
3. The first matching phrase wins. Order in this file = priority (top-to-bottom).
4. Platform-specific bindings live in `steps/{platform}-steps.md`. The skill resolves which platform applies based on the active mode + tags on the scenario.

## Adding new steps

1. Decide if the phrase is platform-agnostic (here) or platform-specific (one of the platform files).
2. Add the row to the appropriate table.
3. Implement the binding in the same file's "Bindings" section (or in the platform-specific file).
4. Run `/manual-qa autonomous` once and confirm the new step resolves.
