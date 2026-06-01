# Persona-platform step vocabulary

Journey files use phrases of the form `<Persona> on <Platform> <verb> ...`. This file is the canonical resolver for those phrases: given a `(persona, platform, verb)` tuple, it returns the concrete driver call.

The skill's autonomous mode parses each Gherkin step, matches the regex below, looks up the binding here, then invokes the driver.

## Persona context

The skill maintains a `Map<PersonaId, ActiveSession>` for the duration of a Scenario. Each session contains:

```ts
type ActiveSession = {
  persona: PersonaId
  platform: 'Android' | 'iOS Sim' | 'Web' | 'Web Admin'
  firebaseUid: string
  jwt: string                  // refreshed as needed
  uniqueId: number
  driver: AndroidDriver | IOSSimDriver | WebDriver
  // platform-specific handles:
  adb?: { deviceSerial: string, packageName: string }
  simctl?: { deviceUDID: string, bundleId: string }
  page?: PlaywrightPage
}
```

A scenario opens a session per `(persona, platform)` pair seen in its steps. Sessions are torn down on Scenario exit. If the same persona has two platforms in one Scenario (e.g. Vexa on Web + Android), the skill maintains two sessions for that persona.

## Step regex

```
^(?P<keyword>Given|When|Then)\s+(?P<persona>[A-Z][a-z]+)\s+(?:\[(?P<personaId>P-\d{2})\])?\s+(?:on\s+(?P<platform>Android|iOS Sim|Web|Web Admin))?\s+(?P<verb>.+)$
```

The persona name resolves to a PersonaId via `_personas.md`. The platform resolves to a driver class. The verb is matched against the binding table below.

## Verb bindings

### Authentication

| Verb pattern | Android | iOS Sim | Web / Web Admin |
|---|---|---|---|
| `is signed in (?:on \S+ )?(?:with .+)?` | `adb shell am start -n {pkg}/.LoginActivity` → open persona picker → tap persona row (uses PERSONAS_PASSWORD) | XCTest UI: open persona picker, tap persona row | Playwright `page.goto('/login.html')` then form-fill with persona email + PERSONAS_PASSWORD |
| `signs out` | `adb shell input tap` on signout button | XCTest UI tap | Playwright click |
| `kills and relaunches the app` | `adb shell am force-stop {pkg}` → `am start` | `xcrun simctl terminate booted {bundle}` → `launch` | `page.reload()` |
| `force-refreshes the JWT` | Call `securetoken.googleapis.com/v1/token?key=...` with the persona's refresh token | same REST call | same |
| `attempts to navigate to "{path}" via deep link` | `adb shell am start -W -a android.intent.action.VIEW -d "shytalk://{path}"` | `xcrun simctl openurl booted "shytalk://{path}"` | `page.goto('https://dev.shytalk.shyden.co.uk{path}')` |

### Signup (ephemeral personas P-01, P-03)

| Verb pattern | Android | iOS Sim | Web |
|---|---|---|---|
| `taps "signin_signUpLink"` | adb tap by Compose test tag | XCTest tap | Playwright click data-testid |
| `types "..." into "signup_emailField"` | `adb shell input text` after focusing the field | XCTest `typeText` | Playwright fill |
| `picks DOB "YYYY-MM-DD" in "signup_dobPicker"` | DateTimePicker driver — adb shell input swipe to year/month/day | XCTest picker wheel adjust | Playwright `selectOption` |
| `taps "signup_createAccountButton"` | adb tap | XCTest tap | Playwright click |

### Navigation

| Verb pattern | Android | iOS Sim | Web |
|---|---|---|---|
| `opens the "{screen}" screen` | adb tap on the bottom-nav item matching the screen tag | XCTest tab tap | `page.goto('/{screen}')` or `page.click(...)` |
| `taps "{tagOrText}"` | adb tap by tag (if `tag` prefix) or by text | XCTest tap | Playwright click |
| `long-presses "{tag}"` | `adb shell input swipe x y x y 1000` | XCTest `press(forDuration: 1.0)` | Playwright `page.mouse.down()` + delay |
| `types "{text}" into "{fieldTag}"` | adb input text | XCTest typeText | Playwright fill |
| `selects "{value}" from the "{picker}"` | adb tap on the picker entry | XCTest pick | Playwright select |

### Voice room actions

| Verb pattern | Android | iOS Sim | Web |
|---|---|---|---|
| `creates a voice room with title "{t}"` | tap Create → fill → confirm | XCTest equivalent | Playwright form |
| `joins room "{roomId}"` | tap room card | XCTest tap | Playwright click |
| `requests a seat` | tap seat-request button | XCTest tap | Playwright click |
| `mic is open and they are seated` | state precondition; verify Firestore + LiveKit publish | same | same |
| `mic auto-mutes server-side` | assert: Firestore `seats[i].muted=true` AND LiveKit publish permission revoked | same | same |
| `LiveKit track for room "{r}" is disconnected` | query LiveKit server for the participant's session state | same | same |

### API calls (no platform — direct REST)

| Verb pattern | Binding |
|---|---|
| `POST /api/{path} with {payload}` | `fetch(API_BASE + path, { method: POST, headers: { Authorization: 'Bearer ' + session.jwt }, body: JSON.stringify(payload) })` |
| `GET /api/{path}` | `fetch(API_BASE + path, { headers: { Authorization: ...session.jwt } })` |
| `the response status is {code}` | last response status === code |
| `the response body has field "{f}" of type "{t}"` | typeof body[f] === t |

### Firestore assertions (cross-platform, no driver needed)

| Verb pattern | Binding |
|---|---|
| `the database has document "{path}" with field "{f}" equal to {v}` | `getDoc(path)` then assert `data[f] === v` |
| `the database has {n} entries in "{coll}" matching {query}` | `getDocs(collection(coll, ...where filters))` then assert length === n |
| `within {ms}ms the database has ...` | poll with backoff every 200ms until either the assertion passes or `ms` elapses |
| `the database has document "{path}" with field "{f}" containing {v}` | array-contains semantic |
| `the database has 1 entries in "auditLog" matching {action, ...}` | filter auditLog by where(...) |

### Cross-platform UI propagation

| Verb pattern | Binding |
|---|---|
| `within {ms}ms <persona>'s <platform> UI shows the element with tag "{tag}"` | poll the platform driver every 200ms; assert tag is visible |
| `within {ms}ms <persona>'s <platform> UI navigates to the "{screen}" screen` | poll current-route; assert === screen |
| `within {ms}ms <persona>'s <platform> UI shows "{text}"` | poll for text contains |
| `within {ms}ms <persona>'s <platform> UI does not show the element with tag "{tag}"` | poll; assert not visible after stabilization (200ms) |
| `<persona>'s LiveKit track for room "{r}" has audio enabled={bool}` | call LiveKit server-side API to fetch participant's publishMetadata |

### @manual steps

Any step with the `@manual` tag is escalated:
- **Interactive mode**: skill prompts the operator with the step body, waits for ✓/✗ + free-text observation.
- **Autonomous mode**: skill checks the manual-verification-ledger for a fresh (≤30 days) signed entry covering this scenario; if absent, the scenario fails with a `MANUAL_NOT_VERIFIED` finding (severity Blocker).

### Driver dispatch fallback

If a verb doesn't match any pattern above, the skill records a finding:
- `STEP_NOT_IMPLEMENTED: <verb>` with severity Major
- The Scenario is paused; the operator may add a binding and re-run, or mark the step as `@out-of-scope` (Polish severity).

## Persona-credential lookup

The skill maintains a `~/.shytalk/dev-personas-credentials` file (chmod 600) with `PERSONAS_PASSWORD={value}` set by the provisioning script. All persona email/password sign-ins use the persona's `email` field from `_personas.md` and this shared password.

For ephemeral personas (P-01 Adam, P-03 Mia), the skill generates a fresh email like `adam-new-{ts}@shytalk.dev` and stores it in the active session — it is not persisted across Scenarios.

## State seeding

Scenarios can declare `Given <persona> has <state>` to override the provisioned baseline. The skill resolves these via Firebase Admin REST writes BEFORE the Scenario starts (not as a Given step at runtime):

| Given pattern | Resolver |
|---|---|
| `Given <persona> has shyCoins={n}` | PATCH `users/{uniqueId}` with shyCoins |
| `Given <persona> has fcmTokens=[...]` | set fcmTokens array |
| `Given <persona> has user doc with ...` | merge the spec into the user doc |
| `Given <persona> is currently in voice room "{r}"` | write `rooms/{r}.participantIds += persona.uniqueId` + LiveKit token |

After the Scenario ends, all override seeds are reverted via a teardown phase that snapshots the baseline at session start.
