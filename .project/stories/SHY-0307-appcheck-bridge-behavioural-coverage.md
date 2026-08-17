---
id: SHY-0307
status: Draft
owner: claude
created: 2026-08-17
priority: P2
effort: S
type: bug
roadmap_ids: []
---

# SHY-0307: The App Check bridge has no behavioural test, and its own diagnostic has no caller

## User Story

As a **developer relying on App Check attestation**, I want the iOS bridge's
behaviour covered by a test that runs it, so that **a regression in the
attestation path is caught by CI** instead of by whatever the server records
weeks later.

## Why

Every assertion currently touching this code is a source-grep pin — "does this
string appear in this file". Nothing calls the code.

`hasAppCheckBridge()`
(`shared/src/iosMain/kotlin/com/shyden/shytalk/core/security/AppCheckBridge.kt`)
carries the comment *"Present so a wiring test can prove Swift registered
something."* That wiring test does not exist. A repo-wide grep finds exactly
two occurrences: its own declaration, and a comment in the sibling file. It is
a diagnostic with no consumer.

Untested behaviour in `AppCheckTokenProvider.ios.kt`:

- no bridge registered → `currentToken()` returns null (the cold-start path,
  reachable on the very first frame);
- a blank token → coerced to null by `ifBlank { null }`;
- the Swift callback throws → logged, returns null, does not take the app down
  over a header;
- `registerAppCheckBridge` actually mutates the slot, and a second call
  replaces rather than corrupts it.

This is the anti-abuse attestation path for a minors-facing app. "It compiles
and the strings are in the right files" is not coverage of it.

### Why SHY-0306 did not do it

The only place this logic can execute is XCTest — there is no Kotlin/Native
test source set in this repo — and the iOS Simulator was deleted from the
development machine on 2026-07-15 by operator decision. Writing a test that
cannot be run before it is committed would breach
[[feedback-run-the-red-before-implementing-plans-lie]]: it would be shipped on
hope, and a test first observed in CI is a test nobody has seen fail.

So this story needs a decision about HOW to run it before it needs code. That
is why it is filed separately rather than bolted onto a P0 hotfix.

## Acceptance Criteria

### Happy path

- [ ] Registering a bridge makes `hasAppCheckBridge()` true, and a registered
      bridge's token reaches `currentToken()`.
- [ ] `hasAppCheckBridge()` has at least one caller — the test that justifies
      its existence.

### Error paths

- [ ] No bridge registered → `currentToken()` returns null rather than
      throwing or hanging.
- [ ] A bridge returning a blank string → null, not `""`.
- [ ] A bridge whose callback throws → null, and the throw does not propagate.

### Edge cases

- [ ] Registering twice replaces the bridge; the second one is used.
- [ ] A callback invoked twice does not crash the caller — today the
      `try/catch` guards only the synchronous call, so a second
      `cont.resume(...)` would throw outside it.
- [ ] The coroutine being cancelled while the Swift fetch is in flight.

### Performance

- [ ] `currentToken()` must not block: the AC that matters is that it returns
      promptly with whatever is cached, since it sits in front of the
      cold-start ban check.

### Security

- [ ] Every failure path fails OPEN (unattested request, server decides) and
      never fails closed, which would lock users out over a missing header.

### UX

- [ ] N/A — no user-visible surface; the whole point is that failures are
      invisible to the user and visible to the server.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The throw path still logs, and the test asserts the log rather than only
      the return value.

## BDD Scenarios

**Scenario: no bridge registered**

- **Given** an app where Swift has not registered the App Check bridge
- **When** the shared code asks for a token
- **Then** it gets nothing back and the request proceeds unattested

**Scenario: a registered bridge supplies a token**

- **Given** Swift has registered a bridge holding a cached token
- **When** the shared code asks for a token
- **Then** that token is returned

**Scenario: the bridge fails**

- **Given** a registered bridge whose callback throws
- **When** the shared code asks for a token
- **Then** it gets nothing back and the app does not crash

## Test Plan

**First, the blocking decision — how to run it.** Options, to be settled
before code:

1. **XCTest on a real iPhone over USB.** Matches the standing rule that iOS is
   tested on real hardware, and `iosApp/iosAppTests/GoogleSignInHelperTests.swift`
   proves the target works. Needs the device present.
2. **XCTest in CI only** (`ios-tests.yml` already runs the target). Rejected as
   the sole answer: it means committing a test never observed failing.
3. **Restore a simulator.** Contradicts the 2026-07-15 decision; would need the
   operator to reverse it.

Preference: (1), with (2) as the regression net once the test has been seen to
fail and then pass on real hardware.

**RED first**, in `iosApp/iosAppTests/AppCheckBridgeTests.swift` (new), driving
the REAL shared framework — no fake for the Kotlin side, since the thing under
test IS the Swift↔Kotlin boundary:

- `no bridge registered yields no token`
- `a registered bridge's token is returned`
- `a blank token becomes no token`
- `a throwing callback yields no token and does not propagate`
- `registering twice uses the second bridge`
- `hasAppCheckBridge reflects registration` — the caller
  `hasAppCheckBridge()` was written for

**Mutation checks:** delete the `?: return null` guard ⇒ the no-bridge case
reddens; drop `ifBlank { null }` ⇒ the blank case reddens; remove the
`try/catch` ⇒ the throwing case reddens.

## Out of Scope

- App Check ENFORCEMENT, still blocked on Firebase console configuration.
- The Android provider, which has its own path and is not part of this gap.
- Adding a Kotlin/Native test source set. That is a larger build change; if it
  turns out to be the better answer, it gets its own story.

## Dependencies

- `shared/src/iosMain/kotlin/com/shyden/shytalk/core/security/AppCheckBridge.kt`
- `shared/src/iosMain/kotlin/com/shyden/shytalk/core/security/AppCheckTokenProvider.ios.kt`
- `iosApp/iosAppTests/` (the existing XCTest target)
- A real iPhone over USB, per the device policy.

## Risks & Mitigations

- **Risk:** the test is written but only ever runs in CI, so it is never
  observed failing. **Mitigation:** the Test Plan makes running it on real
  hardware the gate, with CI as the net afterwards.
- **Risk:** testing a `@Volatile` global leaks state between tests.
  **Mitigation:** each test registers its own bridge and the suite asserts the
  starting state, rather than assuming a clean slot.
- **Risk:** scope creep into App Check enforcement. **Mitigation:** explicitly
  out of scope above.

## Definition of Done

- [ ] The how-to-run decision recorded in Notes before code starts.
- [ ] RED tests observed failing on real hardware, then green.
- [ ] `hasAppCheckBridge()` has a caller, or is deleted if the decision is that
      it should not exist.
- [ ] Mutants proven to redden their tests.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes (running log)

- **2026-08-17 — filed out of SHY-0306's review.** The reviewer rated this
  Critical on that PR. It was not folded in because SHY-0306 was a P0 fix for a
  completely broken iOS build, and because the honest blocker is that the test
  cannot be RUN on this machine — the simulator was removed on 2026-07-15.
  Filing it is not deferral by another name: the fix still happens, in its own
  PR, and the thing that has to be settled first is a decision, not code.
- The gap is inherited from SHY-0300, which added `hasAppCheckBridge()` for a
  wiring test it never wrote.
