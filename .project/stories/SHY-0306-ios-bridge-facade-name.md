---
id: SHY-0306
status: Done
owner: claude
created: 2026-08-17
priority: P0
effort: S
type: bug
roadmap_ids: []
released_in: v0.99.0
---

# SHY-0306: Swift calls a Kotlin facade whose name the file it lives in cannot produce

## User Story

As a **developer shipping iOS**, I want a Swift call into the shared framework
to fail on its own PR when the Kotlin side cannot export that name, so that
**iOS keeps building** instead of the mismatch surviving review and dying an
hour into a deploy.

## Why

`develop` still cannot build iOS. SHY-0305 fixed the stale `Podfile.lock` and
the module now resolves — the build got from 9 minutes to 57 — and revealed a
second, independent defect that the first was hiding:

```
AppDelegate.swift:48:33: error: type 'AppCheckTokenProviderKt'
has no member 'registerAppCheckBridge'
```

Both were shipped by SHY-0300.

### The mechanism, measured

Kotlin/Native exports a file's top-level functions on a facade class named
after **the file**. The generated header proves what each one is:

```objc
@interface SharedAppCheckTokenProvider_iosKt : SharedBase   // from AppCheckTokenProvider.ios.kt
@interface SharedIosPushBridgeKt            : SharedBase   // from IosPushBridge.kt
```

So the rule is: base name, every `.` replaced by `_`, then `Kt`. The `.ios`
infix that marks an `actual` implementation is part of the name. Swift
therefore has to say `AppCheckTokenProvider_iosKt`, and `AppDelegate.swift`
says `AppCheckTokenProviderKt`.

Every other bridge in this codebase avoids the problem by construction —
`IosPushBridgeKt`, `IosLiveKitBridgeKt`, `IosStoreKitBridgeKt`,
`IosGoogleSignInHelperKt`, `KoinHelperKt` all come from files with no `.ios`
infix. `AppCheckTokenProvider.ios.kt` is the first file to hold BOTH an
`actual class` and a Swift-facing top-level function, and that combination is
what produced a name Swift was never going to guess.

### Why nothing caught it

- `./gradlew :shared:compileKotlinIosArm64` compiles the Kotlin. It cannot see
  a Swift call site.
- The Swift side is only compiled by `xcodebuild`, which runs in the iOS
  deploy and test jobs — the slowest, latest feedback in the repo.
- So a Swift↔Kotlin name mismatch is invisible to every fast gate, and is
  reported ~an hour later as a type error in a job most PRs never run.

The fix is therefore in two parts: correct the wiring, and make the class of
mistake detectable from source in seconds.

## Acceptance Criteria

### Happy path

- [ ] `AppDelegate.swift` registers the App Check bridge through a facade the
      Kotlin side actually exports.
- [ ] The generated header contains that facade with that method.
- [ ] A dev deploy archives iOS and reaches TestFlight.

### Error paths

- [ ] A Swift reference to a `*Kt` facade that no Kotlin file can produce
      FAILS a fast, source-only check — no Xcode, no simulator, no network.
- [ ] The failure names the Swift file, the facade, the member, and the facade
      name the Kotlin file WOULD produce.

### Edge cases

- [ ] A file with the `.ios` infix maps to `Foo_iosKt`, and a file without maps
      to `FooKt`; both forms are accepted when they match.
- [ ] A facade referenced from Swift but declared in `commonMain` rather than
      `iosMain` is still resolved — the export is per-file, not per-source-set.
- [ ] A Swift reference inside a comment or a string is not treated as a call.
- [ ] A Kotlin top-level function that exists but is `private` or `internal`
      is NOT exported, and must not satisfy the check.

### Performance

- [ ] Source-only scan of `iosApp/**/*.swift` plus the shared Kotlin tree —
      milliseconds, and it runs with the other CI-structure tests.

### Security

- [ ] N/A — reads two source trees, executes nothing from them.

### UX

- [ ] The failure message is actionable enough to fix without opening Xcode.

### i18n

- [ ] N/A — developer tooling, English-only.

### Observability

- [ ] N/A — a pass is silent; a failure prints every unresolved reference at
      once rather than stopping at the first.

## BDD Scenarios

**Scenario: the App Check bridge registers**

- **Given** the iOS app starting up
- **When** it registers the App Check bridge with the shared framework
- **Then** the call resolves and the app builds

**Scenario: a Swift call to a name Kotlin cannot export is rejected**

- **Given** a Swift file calling a facade no Kotlin file produces
- **When** the source check runs on its pull request
- **Then** it fails and names the file, the facade and the expected name

**Scenario: a correct reference passes**

- **Given** a Swift file calling a facade whose Kotlin file exports it
- **When** the source check runs
- **Then** it passes

**Scenario: iOS reaches TestFlight**

- **Given** the corrected wiring on develop
- **When** iOS is deployed to dev
- **Then** the archive succeeds and uploads

## Test Plan

**Classification:** touches `shared/src/iosMain/**` and `iosApp/**` — product
runtime. Under the Pre-Merge Testing Protocol that is NOT exempt; the operator
has, however, batched the device gauntlet for the whole MVP set rather than
running it per story (recorded 2026-08-16). The end-to-end proof required here
is the iOS deploy archiving successfully, which is what this story exists to
restore, and it is in the DoD.

**RED first** — `express-api/tests/scripts/ios-swift-kotlin-facade.test.js`
(new). Pure source analysis over the REAL trees:

- `every *Kt facade Swift references is exported by some Kotlin file` —
  derives the facade name for every `shared/src/{iosMain,commonMain}/**/*.kt`
  by replacing `.` with `_` in the base name and appending `Kt`, collects the
  top-level `fun` declarations of each, and resolves every
  `Facade.member` reference found in `iosApp/**/*.swift`. **RED today** on
  `AppCheckTokenProviderKt.registerAppCheckBridge`.
- `the scan finds references at all` — the anti-vacuity control; a broken
  reference regex would otherwise make the check pass over an empty set.
- `a private or internal top-level fun does not satisfy a reference` — those
  are not exported, so accepting one would recreate the defect.
- `a reference inside a Swift comment is ignored`.

**Mutation checks:**

- point the Swift call back at `AppCheckTokenProviderKt` ⇒ the first test
  reddens;
- drop the `.`→`_` derivation ⇒ a `.ios.kt`-declared facade stops resolving
  and the check reddens, proving the rule is doing work;
- make the resolver accept any facade ⇒ the first test reddens.

**Green** — `cd express-api && npm test -- tests/scripts/`;
`./gradlew :shared:linkDebugFrameworkIosSimulatorArm64` and assert the
generated `shared.h` contains the new facade with the method; then the deploy.

## Out of Scope

- Renaming the other `.ios.kt` files. They export no Swift-facing top-level
  functions, so they are not affected; the sweep result is recorded rather
  than assumed.
- App Check enforcement, still blocked on console configuration.
- Making `xcodebuild` run on every PR. That is the expensive fix this story
  deliberately avoids by checking the same property from source.

## Dependencies

- `shared/src/iosMain/kotlin/com/shyden/shytalk/core/security/AppCheckTokenProvider.ios.kt`
- `iosApp/iosApp/AppDelegate.swift`
- The Kotlin/Native ObjC export naming rule, verified against the generated
  header rather than assumed.

## Risks & Mitigations

- **Risk:** moving the bridge functions to a new file changes the facade name
  again and breaks a different call site. **Mitigation:** the new check
  resolves EVERY Swift reference, so any other site would redden it; and the
  generated header is re-read after the change.
- **Risk:** the source-only check drifts from what Kotlin/Native really does.
  **Mitigation:** the derivation was measured against the real header, and the
  DoD requires re-reading the header after the fix — the check is a fast proxy
  for a fact that is still verified for real at least once here.
- **Risk:** treating a `.ios.kt` facade as legitimate entrenches an awkward
  Swift name. **Mitigation:** the fix moves the bridge OUT of the `.ios.kt`
  file, matching every other bridge; the check merely tolerates both forms so
  it does not force unrelated renames.

## Definition of Done

- [ ] RED test written and observed failing before the fix.
- [ ] The bridge lives in a file whose facade name Swift can name naturally.
- [ ] The generated `shared.h` re-read and confirmed to export it.
- [ ] Every mutation in the Test Plan proven to redden its test.
- [ ] Whole-repo sweep for other Swift→Kotlin facade references, recorded.
- [ ] **A dev deploy archives iOS and reaches TestFlight** — the only evidence
      that settles this, as with SHY-0305.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes (running log)

- **2026-08-17 — found by deploying after SHY-0305 merged.** The stale-lock
  fix worked (the module error is gone, 0 occurrences) and the build ran 57
  minutes instead of 9 before failing on this instead. Two independent iOS
  breakages shipped in SHY-0300; fixing the first was the only way to see the
  second, which is an argument for deploying after every merge rather than
  batching.
- The export rule was read out of the generated header
  (`shared/build/bin/iosSimulatorArm64/debugFramework/shared.framework/Headers/shared.h`),
  not inferred: `SharedAppCheckTokenProvider_iosKt` beside
  `SharedIosPushBridgeKt` settles both the rule and the fix.

- **2026-08-17 — implemented.** The bridge interface and its `register` /
  `has` entry points moved to `shared/src/iosMain/.../AppCheckBridge.kt`;
  `AppCheckTokenProvider.ios.kt` keeps only the `actual class` and a comment
  saying why nothing Swift-facing may live there. `AppDelegate.swift` now calls
  `AppCheckBridgeKt.registerAppCheckBridge(bridge: self)`.

  Re-read the generated header after the change rather than trusting the rule:

  ```objc
  @interface SharedAppCheckBridgeKt : SharedBase
  + (void)registerAppCheckBridgeBridge:(id<SharedAppCheckBridge>)bridge
        __attribute__((swift_name("registerAppCheckBridge(bridge:)")));
  ```

  `appCheckBridge` became `internal` rather than `private` so the `actual`
  class can still read it across files, which also keeps it off the Swift
  facade — Swift registers through the function and has no business touching
  the slot.

- **Sweep result, recorded rather than assumed.** The new check resolves EVERY
  `*Kt.member` reference in `iosApp/**`; exactly one was unresolved, the App
  Check one. `IosPushBridgeKt`, `IosLiveKitBridgeKt`, `IosStoreKitBridgeKt`,
  `IosGoogleSignInHelperKt`, `KoinHelperKt`, `MainViewControllerKt` and
  `PushDeepLinkBusKt` all resolve, because none of them lives in a `.ios.kt`
  file.

- **A third pin encoded the broken location as the contract.**
  `AppCheckWiringPinTest` asserted `fun registerAppCheckBridge(` was inside
  `AppCheckTokenProvider.ios.kt` — the one file it must not be in. Rewritten to
  assert it is in `AppCheckBridge.kt` AND absent from the `.ios.kt` file, so
  the pin now describes the property instead of the defect. 10/10 green,
  verified from the JUnit XML with a fresh mtime, not from console output.

- `sonarjs/slow-regex` rejected two patterns in the new check (`/\/\/.*$/` and
  an escape-aware string matcher). Both replaced with linear string operations
  rather than suppressed; the surviving string pattern's limitation and its
  safe failure direction are documented at the call site.

- **Mutation testing found the check's own resolver was unfalsifiable** —
  weakening it to accept everything left every real-tree assertion green,
  because an empty "unresolved" list reads exactly like a correct one. The
  resolver was extracted and given a synthetic-input control; the mutant now
  dies. 5/5 mutants killed.

- Verification: `:shared:compileKotlinIosArm64` + `detekt` BUILD SUCCESSFUL;
  `ktlint` clean; `:shared:jvmTest AppCheckWiringPinTest` 10/10; express
  **153 suites / 7584 tests**; eslint `--max-warnings=0` and prettier clean.
  **Still outstanding: the dev deploy that archives iOS and reaches
  TestFlight.** That is the DoD item this story exists for and it cannot be
  claimed until a real run does it.

- **2026-08-17 — `code-reviewer` round 1: 2 Critical, 7 Important, 3 Minor.**
  Both Criticals were verified before being acted on.

  **C1 — the new pin could silently stop running, and the "10/10 green" was
  luckier than it looked.** `AppCheckWiringPinTest` now reads
  `AppCheckBridge.kt`, but `shared/build.gradle.kts`'s explicit
  `appLockWiringPinnedSources` input list did not include it, so Gradle could
  call `jvmTest` up-to-date after a change the pin was written to catch. The
  green result only happened because `AppCheckTokenProvider.ios.kt` — a
  declared input — was edited in the same commit. Exactly the trap the block's
  own comment warns about ([[feedback-structural-pins-are-invisible-to-gradle-uptodate]]).

  Proven in BOTH directions rather than asserted, and note the first attempt
  was itself wrong: `touch` only moves mtime, and Gradle snapshots by content
  hash, so the initial "proof" was inconclusive. With a real content change:

  | declaration | result |
  | --- | --- |
  | absent | `> Task :shared:jvmTest UP-TO-DATE` |
  | present | `> Task :shared:jvmTest` (runs) |

  **C2 — no behavioural coverage of the bridge, and `hasAppCheckBridge()` has
  zero callers.** Confirmed: its only occurrences are its own declaration and a
  comment. Its stated purpose is "so a wiring test can prove Swift registered
  something", and that test does not exist. This is inherited from SHY-0300
  rather than introduced here, but it is real.

  **Not fixed here, deliberately, and this is the honest reason:** the only
  place that logic can be exercised is XCTest, and the iOS Simulator was
  deleted from this machine on 2026-07-15 by operator decision. Writing a test
  I cannot run would breach the rule that a test is observed failing before it
  is trusted ([[feedback-run-the-red-before-implementing-plans-lie]]) — it
  would be a test shipped on hope. Filed as a follow-up instead of faked, and
  `hasAppCheckBridge()` is kept rather than deleted because the follow-up needs
  it.

  Important findings applied — all of them made the tool BLIND rather than
  noisy, which is the dangerous direction for a checker:

  - `exportedTopLevelDecls` did not understand `actual`/`expect`/`suspend`/
    `inline` before `fun`, so ~20 real top-level `actual fun` declarations were
    invisible; a future Swift call to one would have been rejected WITH a
    misleading "no Kotlin file exports that" hint;
  - top-level `val`/`var` were ignored although they land on the same facade
    and the reference scanner does pick them up;
  - string INTERPOLATION was discarded with the literal, hiding a genuine
    reference in `"wired=\(SomeKt.thing())"`;
  - `//` was stripped BEFORE strings, so the `//` inside a URL literal
    truncated the line and dropped any call after it;
  - `/* */` block comments were never stripped, so prose in one read as a call
    — contradicting the story's own AC, which says "comment or string" without
    qualification;
  - `DerivedData` was not excluded alongside `Pods`/`build`.

  The three string/comment defects interact, so the regex chain was replaced
  with a single left-to-right scanner tracking code / string / line comment /
  block comment, treating the inside of `\( … )` as the code it is. 4 further
  mutants applied and killed against the new behaviours.

- Verification after review: express **153 suites / 7588 tests**; eslint
  `--max-warnings=0` (two findings fixed rather than suppressed:
  `sonarjs/slow-regex`, then `no-useless-assignment`); prettier clean;
  `AppCheckWiringPinTest` re-run and confirmed to re-run on a content change to
  the file it reads. **9/9 mutants killed across the story.**

Reviewed-up-to: d234d03d3ab0acb223cda83a26ae3a23ee81dd89

- **2026-08-17 — the outstanding DoD item is now MET, with evidence.**
  Deploy-To-Dev run `32000510087` against develop `5bcc9989291`:

  ```
  success  Install CocoaPods
  success  Build, archive, and export iOS app
  success  Upload to TestFlight
  success  Ensure TestFlight internal-group auto-distribution
  ```

  iOS builds and ships again. Note `Install CocoaPods` **ran** rather than
  being skipped — that is SHY-0305's cache-key fix behaving as designed, since
  adding the Podfile to the key busted the stale Pods cache.

  Timeline across the three attempts, which is the clearest statement of what
  each fix bought:

  | run | iOS outcome |
  | --- | --- |
  | `31964207898` | failed at 9 min — `Unable to resolve module dependency: 'FirebaseAppCheck'` |
  | `31976285312` | failed at 57 min — `type 'AppCheckTokenProviderKt' has no member 'registerAppCheckBridge'` |
  | `32000510087` | **success — archived and uploaded to TestFlight** |

  Status stays `In Review`, not `Done`: Done means the release cut
  ([[feedback-done-equals-release-cut]]).
