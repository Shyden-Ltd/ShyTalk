# Cross-platform handoff vocabulary

Every step in a journey scenario MUST declare which platform performs the action and where the assertion is checked. The point is to catch propagation bugs: an admin clicks on Web, the target's Android device must react in <5s, AND the iOS Simulator viewing the same shared resource must also react.

## Platform aliases (use these verbatim)

| Alias | Driver | Notes |
| ----- | ------ | ----- |
| `Android` | `adb` + Compose UI semantics + dev APK | Either emulator (Pixel_API_34) or physical OnePlus CPH2653 over wifi-adb |
| `iOS Sim` | `simctl` + XCTest via iosApp UI Tests + LiveKit Swift bridge | iPhone 15 Pro simulator |
| `iOS Device` | physical iPhone via Xcode build → IPA install (rare, manual) | only @manual scenarios that need real APNs |
| `Web` | Playwright MCP — Chromium / Firefox / WebKit | all three are runtime-equivalent; pick per `@browser-*` tag |
| `Web Admin` | same Playwright session but at `/admin.html` | requires admin custom claim |

## Step vocabulary

### Setup
- `Given <persona> [<P-id>] is on <platform>` — establishes the persona's active device for the rest of the scenario
- `Given <persona> [<P-id>] is on <platform> at the "<screen>" screen` — additionally seats them on a starting screen

### Action (explicit platform)
- `When <persona> on <platform> <action>` — the platform driver performs the action against that persona's session
- `When <persona> on <platform> taps the element with tag "<tag>"`
- `When <persona> on <platform> types "<text>" into the field with tag "<tag>"`
- `When <persona> on <platform>'s mic is open and they are seated in room "<roomId>"` — state setup, not action

### Assertion (always specify where to look)
- `Then within Xms the database has document "<path>" with field "<field>" equal to <value>` — backend state
- `Then within Xms <persona>'s <platform> UI shows the element with tag "<tag>"` — cross-platform propagation
- `Then within Xms <persona>'s <platform> UI does not show the element with tag "<tag>"`
- `Then within Xms <persona>'s <platform> UI navigates to the "<screen>" screen`
- `Then <persona>'s LiveKit track for room "<roomId>" has audio enabled=<true|false>` — voice-side state

### Multi-platform spot-check (parity probes)
- `Then the same is true on <persona>'s <other-platform>` — fans an assertion across devices when the same persona has two devices signed in (rare, e.g. concurrency journeys)
- `Then within Xms <other-persona>'s <platform> UI shows the element with tag "<tag>"` — the change must propagate to a *different* user on a *different* device

## Why every step needs the platform

Past production bugs that journeys MUST catch:
1. **Web admin suspends a user, target Android device keeps voice mic open** — propagation gap. Catch: `On Web Admin: suspend` → `On Android: assert mic is muted within 5s`.
2. **iOS shows stale cohort after admin downgrade** — token-refresh bug. Catch: `On Web Admin: reject + DOB down` → `On iOS Sim: relaunch app, assert cohort=minor and PM tab is hidden`.
3. **Web shows gift, Android doesn't update gift wall** — Firestore listener gap. Catch: `On Android: send gift to recipient` → `On Web: assert gift appears on recipient's gift wall within 3s`.

## Browser / device-class tags

Append on the scenario line so the runner picks the right driver matrix:

- `@browser-chromium` / `@browser-firefox` / `@browser-webkit` — Playwright browser pick
- `@android-emulator` / `@android-physical` — Android device pick
- `@ios-sim` / `@ios-device` — iOS device pick
- `@all-platforms` — run scenario as a full matrix (web×3 × android×2 × ios×1) — expensive, reserve for blockers
- `@perf-budget:<ms>` — performance assertion budget
- `@locale-rtl` / `@locale-cjk` — locale spot-checks
- `@manual` — non-automatable step (real OAuth, real APNs, real camera, real audio); requires ledger sign-off
- `@blocker` — must pass to ship
