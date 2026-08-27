---
id: SHY-0345
status: Done
owner: claude
created: 2026-08-19
priority: P0
effort: XS
type: bug
roadmap_ids: []
mvp: true
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1804
released_in: v0.99.0
---

# SHY-0345: The iOS Local build fails before it compiles a single line

## User Story

As a **developer verifying an iOS change against the local stack**, I want the
Local configuration to build, so that I can test on iOS at all without pushing
to dev first.

## Why

**P0, and it blocks the MVP's own verification rule.** Every story requires a
real-device walk on iOS. Right now `Debug-Local` cannot be built — on a device
or a simulator — so that walk is impossible for every story at once.

The build dies in the "Compile Kotlin Framework" phase, before compiling
anything:

```
error: Unable to detect Kotlin framework build type for CONFIGURATION=Debug-Local
       automatically. Specify 'KOTLIN_FRAMEWORK_BUILD_TYPE' to 'debug' or 'release'
```

The KMP/Compose Gradle plugin infers debug-vs-release from the Xcode
CONFIGURATION name and recognises only the literal `Debug` / `Release`. A custom
name like `Debug-Local` defeats the heuristic. `Dev.xcconfig` already declares
`KOTLIN_FRAMEWORK_BUILD_TYPE = debug` for exactly this reason —
**`Local.xcconfig` never did.**

**It was a known gap, closed with the wrong conclusion.** `Dev.xcconfig`'s own
comment says: *"Single-config xcconfig, so this is unambiguous here — unlike the
shared Local.xcconfig, which fronts both Debug-Local and Release-Local and
therefore **can't carry one value**."* The premise is right and the conclusion is
wrong: xcconfig supports `[config=<name>]` conditionals, so one shared file can
carry a default plus a per-configuration override. Believing otherwise left the
Local configuration unbuildable rather than prompting a workaround.

**How it stayed hidden.** Nothing builds `Debug-Local` in CI — the pipelines
build dev and release. It only breaks for a human trying to run the local stack
on iOS, and the error names a Gradle property rather than the missing setting,
so it does not read as "a config file is missing a line".

**Why it matters now.** The follow-list fix (SHY-0338) needs an iOS walk before
it can merge, and this is what stops it. Every future iOS story hits the same
wall.

## Acceptance Criteria

### Happy path

- [ ] `Debug-Local` builds and produces a runnable app.
- [ ] The app installs and launches against the local stack.
- [ ] `Release-Local` builds too, and embeds a release Kotlin framework rather than a debug one.

### Error paths

- [ ] Removing the setting fails a named test, rather than surfacing as an unexplained build error.
- [ ] Adding a new `*-Local` configuration without a build type fails the same test.

### Edge cases

- [ ] Both configurations fronted by the shared file are covered — the default alone must not silently give Release-Local a debug framework.
- [ ] The simulator and device SDKs both build.

### Performance

- [ ] N/A — a build setting. No runtime surface.

### Security

- [ ] The change adds no credential and no network surface; it names a build type only.

### UX

- [ ] N/A — developer tooling.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The next reader can tell why the setting exists: the exact error it prevents is quoted where the value is declared.

## BDD Scenarios

**Scenario: A developer can run the app locally on iOS**

- **Given** a developer with the local stack running
- **When** they build the app for local use on iOS
- **Then** it builds and launches instead of failing

**Scenario: A release-flavoured local build is not secretly a debug one**

- **Given** the shared configuration file serves both local build types
- **When** the release-flavoured local build is produced
- **Then** it contains release code, not debug code

## Test Plan

**RED first, and proven by a real build.** Against `develop`,
`xcodebuild -configuration Debug-Local` fails in the Compile Kotlin Framework
phase. With the fix it reaches `** BUILD SUCCEEDED **`.

### Node / Jest — `express-api/tests/scripts/ios-local-xcconfig.test.js`

- `declares KOTLIN_FRAMEWORK_BUILD_TYPE at all` — **the defect, in one assertion**
- `defaults to debug`
- `overrides to release for Release-Local`
- `every build configuration fronted by this file has a value` — derived from the Xcode project, so a new `*-Local` configuration cannot slip through
- `Debug-Local and Release-Local are both fronted by this file` — guards the assumption the test above rests on

### Real-build proof

- `xcodebuild -workspace iosApp.xcworkspace -scheme iosApp -configuration Debug-Local -destination <simulator>` → `** BUILD SUCCEEDED **`, and the resulting `.app` installs and launches.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the `[config=Release-Local]` override removed | `overrides to release for Release-Local` |
| the whole setting removed | `declares KOTLIN_FRAMEWORK_BUILD_TYPE at all`, `defaults to debug`, `overrides to release...`, `every build configuration fronted by this file has a value` |

### Classification — CORRECTED

An earlier version of this story called this **CI-config-only**. **That was
wrong**, and review caught it. CLAUDE.md's exemption covers
`.github/workflows/**`, CI-only helper scripts and CI-structure meta-tests, and
carries an explicit anti-loophole clause: a PR touching `iosApp/**` is NOT
CI-config-only and runs the FULL protocol. This diff edits
`iosApp/Configurations/*.xcconfig`. The project's own routing agrees —
`pr-checks.yml:97` maps `iosApp/*` to `IOS_APP=true; APP=true`.

"It is only a build setting" is exactly the reasoning that clause exists to
refuse, and it is a bad place to accept it: the entire subject of this change is
whether the configuration builds, and simulator success does not rule out
device-only failures in provisioning, entitlements or codesign.

## Out of Scope

- Renaming the build configurations to `Debug`/`Release` so the heuristic works
  unaided. That churns the Xcode project, the Pods xcconfigs and every CI
  invocation, to avoid two lines.
- The separate problem that the Local build points a real iPhone at itself
  (`localhost`) — that is SHY-0275, PR #1696, still open. **This story makes the
  build possible; SHY-0275 makes it reach the stack from a physical device.**
- Adding a `Debug-Local` build to CI.

## Dependencies

- None. It unblocks the iOS half of **SHY-0338**.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| `Release-Local` silently gets a debug framework | The conditional is asserted separately from the default, and mutation-proven. |
| A future `*-Local` configuration is added uncovered | The coverage test derives configurations from the Xcode project rather than a hardcoded list. |
| The stale "can't carry one value" note misleads again | Corrected in `Dev.xcconfig` in this change, pointing at this story. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] A real `Debug-Local` build succeeds and the app launches.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19** — Found while trying to do SHY-0338's owed iOS walk. The
  simulator build failed; `xcodebuild` swallows script-phase output, so the
  cause only appeared after capturing the full log to a file and grepping it —
  line 3584 of 3600.

- **2026-08-19** — Fix verified by building, not by reasoning:
  `xcodebuild -configuration Debug-Local -destination <iPhone 17 simulator>`
  went from `BUILD FAILED` (exit 65) to `** BUILD SUCCEEDED **` (exit 0), and
  the produced `.app` installed and launched on the simulator.

- **2026-08-19** — The `Release-Local` override is not decoration. With only the
  default, a release-flavoured local build would embed a DEBUG Kotlin framework
  and nothing would say so.

- **2026-08-19** — Corrected the sibling comment in `Dev.xcconfig`, which
  asserted a shared xcconfig "can't carry one value". That belief is what left
  the Local configuration unbuildable; leaving it in place would invite the same
  conclusion again.

- **2026-08-19 — REAL-DEVICE PROOF (supersedes the simulator run).** The earlier
  note logged only a simulator build. The operator's rule is real hardware, and
  they said so directly. Redone on **Sean's iPhone (iPhone Air, iOS 27.0,
  CoreDevice `74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6`)**:

  ```
  xcodebuild -configuration Debug-Local -destination "id=74563FF8-…" \
             LOCAL_HOST=192.168.1.9 -allowProvisioningUpdates build
  → ** BUILD SUCCEEDED **   (exit 0)

  xcrun devicectl device install app    → installed
  xcrun devicectl device process launch → "Launched application…"
  ```

  The app then ran on the phone and was driven through sign-in and navigation
  with Appium/XCUITest. So this configuration now builds, signs, installs,
  launches and is drivable on real hardware — the claim this story makes, proven
  the way the rule requires.

  Carried on a throwaway verification branch alongside SHY-0275's host plumbing,
  because a physical iPhone cannot reach the local stack without it. The
  xcconfig change under test is byte-identical to this PR's.

- **2026-08-19 — Android is NOT walked, deliberately, and here is why.** The diff
  is two lines in an iOS-only xcconfig plus a comment and a test. No Kotlin, no
  Gradle, no Android source; `Local.xcconfig` is not read by any Android build.
  There is no Android behaviour this change could alter. Recording the reasoning
  rather than ticking a box or quietly skipping it — **if the operator wants the
  Android leg run regardless, say so and it will be.**

- **2026-08-19 — review round 1, findings applied.**
  - **A test that could never fail.** `every build configuration fronted by this
    file has a value` filtered on `!hasDefault && !conditioned.has(c)`. Once any
    bare default exists — the whole point of the fix — `!hasDefault` is false for
    every element and the result is unconditionally empty. It claimed to stop a
    future `*-Local` configuration slipping through and stopped nothing.
    Rewritten to check the value each configuration RESOLVES to against what its
    name implies, so a `Release-*` silently inheriting `debug` now fails.
    Mutation-proven: removing the override reddens it.
  - Added the duplicate-declaration trip-wire and the explicit file-exists check
    that the sibling `ios-dev-xcconfig.test.js` already had.
  - Added the missing `pr:` frontmatter field.

- **2026-08-19 — a second, sibling defect fixed here.** `:shared:iosSimulatorArm64Test`
  never compiled either: two `commonTest` function names contained COMMAS, which
  Kotlin/Native rejects ("Name contains illegal characters: ,"). So no shared
  Kotlin test has ever run on an iOS target — only JVM/Android. Renamed both in
  `UrlEncodingTest.kt`; nothing else in `commonTest` has an illegal name
  (grepped). Included here rather than filed separately because it is the same
  problem statement as this story — the iOS build path has never worked — and
  the fix is two renames.

Reviewed-up-to: e515eaf65e0
