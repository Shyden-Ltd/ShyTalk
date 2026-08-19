---
id: SHY-0363
status: In Progress
owner: unassigned
created: 2026-08-20
priority: P2
effort: XS
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0363: Every Gradle build warns that the project is incompatible with Gradle 10

## User Story

As **a developer running any Gradle task**, I want the build to finish without
deprecation warnings, so that a warning in my output means something I actually
need to act on.

## Why

Every Gradle invocation ends with:

```
Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.
```

The standing rule treats warnings as build failures, so a banner on *every*
build trains people to ignore the one place warnings appear. It also states a
real future breakage: the build will not work on Gradle 10.

Run with `--warning-mode all`, the project emits **exactly one** deprecation:

```
The 'val name by getting { }' property delegate syntax has been deprecated.
This is scheduled to be removed in Gradle 10.
Use 'val element = getByName(name) { }' instead.
```

There is **one** occurrence, at `shared/build.gradle.kts:69`:

```kotlin
val androidHostTest by getting {
    dependencies { implementation(libs.mockk) }
}
```

The `val` is never referenced anywhere else in the file — it exists only to
configure that source set — so it becomes a plain `getByName(...)` call with no
binding at all.

## Acceptance Criteria

### Happy path

- [ ] `./gradlew help --warning-mode all` emits **zero** deprecation warnings.
- [ ] No build output ends with the "incompatible with Gradle 10" banner.
- [ ] `shared/build.gradle.kts` no longer uses `by getting`.

### Error paths

- [ ] The `androidHostTest` source set still receives its `mockk` dependency — a
      silently-dropped test dependency would be worse than the warning.

### Edge cases

- [ ] No other `by getting` (or sibling deprecated delegate) survives anywhere in
      the build scripts — the whole tree is checked, not just this file.
- [ ] The Android host unit tests, which are the consumers of that dependency,
      still compile and run.

### Performance

- [ ] N/A — a syntax change in a build script.

### Security

- [ ] N/A — no dependency version, source or permission change.

### UX

- [ ] N/A — developer-facing build output only.

### i18n

- [ ] N/A.

### Observability

- [ ] Build output is quieter, so a future warning is visible instead of buried
      under a permanent one.

## BDD Scenarios

**Scenario: A clean build reports nothing to worry about**

- **Given** a developer runs a build
- **When** the build finishes successfully
- **Then** it reports no deprecation warnings

## Test Plan

**RED first.** `./gradlew help --warning-mode all` currently prints the
deprecation and the Gradle 10 banner. That is the failing state.

1. Capture the warning before the change.
2. Convert the one occurrence.
3. Re-run — zero deprecations, no banner.
4. Compile + run the Android host unit tests to prove `mockk` is still wired.
5. Grep the tree for any other deprecated delegate syntax.

## Out of Scope

- Upgrading to Gradle 10. This removes the blocker; it does not do the upgrade.
- The pre-existing `@Suppress("DEPRECATION")` on `commonMain.dependencies` at
  `shared/build.gradle.kts:74`. It is a different deprecation and suppression is
  the wrong answer to it, but unpicking that is its own piece of work.

## Dependencies

- None. Touches one build script.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The source set silently loses `mockk` | The Android host unit tests are compiled and run after the change; they are the consumers. |
| A different accessor would be more idiomatic than `getByName` | `getByName(name) { }` is what Gradle's own deprecation message prescribes, so it is the guidance-following choice rather than a guess. |

## Definition of Done

- [ ] Zero deprecations under `--warning-mode all`; banner gone.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Raised with the operator while fixing SHY-0362, who asked for
  it to be investigated and fixed if small. `--warning-mode all` showed a single
  deprecation at a single call site, so it is small.
