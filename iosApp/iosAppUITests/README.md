# iosAppUITests — XCUITest harness for manual-qa-runner

The `ManualQARemoteControl.swift` test in this directory is a long-
running XCUITest that the [`manual-qa-runner`](../../express-api/scripts/manual-qa-runner.js)
talks to via the simulator's filesystem at `/tmp/qa-cmd.jsonl` /
`/tmp/qa-result.jsonl`.

## Operator setup (one-time)

This directory was created outside Xcode and needs a UI Testing
target added to the Xcode project before the runner can drive it.

1. Open `iosApp.xcworkspace` in Xcode.
2. File → New → Target… → **UI Testing Bundle**.
3. Name: `iosAppUITests`. Target to be tested: `iosApp`.
4. After creation, Xcode will create a default `iosAppUITestsLaunchTests.swift`
   and `iosAppUITestsExample.swift`. Delete those — `ManualQARemoteControl.swift`
   (already in this folder) is the only test we use.
5. In the target settings → Build Phases → Compile Sources, make sure
   `ManualQARemoteControl.swift` is listed.

## Launching the harness before a runner pass

```sh
xcodebuild test-without-building \
  -workspace iosApp.xcworkspace \
  -scheme iosAppUITests \
  -destination "platform=iOS Simulator,id=$(xcrun simctl list devices booted \
    | grep -oE '\([0-9A-F-]{36}\)' | head -1 | tr -d '()')"
```

The harness runs until it receives a `{"op":"shutdown"}` command or
hits the 10-minute idle timeout. The runner sends the shutdown
automatically at the end of a corpus run.

## Accessibility identifiers

For the runner's `iosTap("persona_picker_open")` to find an element, the
Compose UI must wire `accessibilityIdentifier` on the relevant node.
The Android equivalent is `Modifier.testTag(...)` plus
`testTagsAsResourceId = true` on the root (see W113); the iOS side
needs the same wiring per node.

Until those identifiers are added, `iosTap` will return `not_found`
and the runner reports a clean finding. As nodes are wired one at a
time, scenarios using them progress.

## IPC protocol

Single-shot per command:

```
runner: writes /tmp/qa-cmd.jsonl  (one JSON object)
harness: polls every 100ms, removes the file when read, executes,
         writes /tmp/qa-result.jsonl
runner: polls /tmp/qa-result.jsonl, removes when read
```

Atomicity is the runner's responsibility. The harness assumes one
command at a time — concurrent runner calls will race.

Available ops: `tap`, `tap_text`, `type`, `dump`, `wait`, `shows_text`,
`shutdown`. Schemas in `ManualQARemoteControl.swift`.
