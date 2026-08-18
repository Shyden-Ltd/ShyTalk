---
id: SHY-0345
status: In Review
owner: claude
created: 2026-08-19
priority: P0
effort: XS
type: bug
roadmap_ids: []
mvp: true
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

### Classification

Two xcconfig lines, a comment correction and one new test. No app source, no
backend, no website → **CI-config-only** for this change itself.

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
