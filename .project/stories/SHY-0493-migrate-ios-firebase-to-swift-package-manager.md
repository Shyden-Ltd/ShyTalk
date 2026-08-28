---
id: SHY-0493
status: Draft
owner: claude
created: 2026-08-28
priority: P1
effort: L
type: refactor
roadmap_ids: []
---

# SHY-0493: Move the iOS Firebase SDK from CocoaPods to Swift Package Manager

## User Story

As **a ShyTalk user on iPhone who needs sign-in, chat and notifications to keep working**,
I want **the iOS Firebase SDK to come from a distribution channel that is still being published to**,
So that **a future Firebase security fix can actually be installed rather than being unavailable to us**.

## Why

`pod install` now prints, on every run:

> FirebaseCore has been deprecated in favor of the Firebase Apple SDK via Swift
> Package Manager. Existing CocoaPods versions will remain available and
> installations will remain functional, but **new versions will no longer be
> published to CocoaPods after October 2026**.

Three things make this urgent rather than tidy-up:

1. **It has a date.** After October 2026 the CocoaPods channel stops receiving
   new versions. Existing ones keep working, so nothing breaks that day — the
   damage is that we become **unable to take a Firebase security patch at all**.
   That is the same shape of exposure SHY-0244 was filed for, which took a full
   migration to clear; doing this one under incident pressure would be worse.
2. **Half the project is already on SwiftPM.** `Package.resolved` pins LiveKit,
   swift-protobuf and the WebRTC xcframework. Firebase is the reason CocoaPods
   is still in the build at all — seven pods, 28 installed, plus a `Pods`
   directory, a workspace and lockfile-stamp CI checks (SHY-0294) that exist
   only to serve it. Removing it removes a whole toolchain.
3. **It was noted and then orphaned.** SHY-0294 recorded the warning and
   deferred it as *"real, dated, and much larger than this story"* — then closed
   as Done. The observation has been sitting inside a completed story with
   nobody owning it. Surfaced again 2026-08-28 while bumping the Firebase pods
   12.14.0 → 12.18.0 for SHY-0244.

## Acceptance Criteria

### Happy path

- [ ] The iOS app builds and runs on a real iPhone with Firebase resolved through Swift Package Manager and **no CocoaPods dependency on Firebase**.
- [ ] Sign-in, chat, push and App Check all work on a real iPhone against dev — the four Firebase surfaces the app actually uses.
- [ ] The Firebase version resolved by SwiftPM is **the same or newer** than the pod version it replaces, and is recorded in `Package.resolved`.

### Error paths

- [ ] A resolution failure fails the BUILD with a message naming the package, rather than silently falling back to a stale checkout.
- [ ] The build fails if both a CocoaPods Firebase and a SwiftPM Firebase are present, since two copies of the SDK link ambiguously.

### Edge cases

- [ ] A clean checkout with no caches builds without any manual step beyond the documented one.
- [ ] CI and a local machine resolve the **same** version — pinned, not floating.
- [ ] If Firebase is the last pod, `Podfile`, `Podfile.lock`, `Pods/` and the CocoaPods-specific CI checks are removed together, not left as dead scaffolding.

### Performance

- [ ] iOS CI wall-clock does not regress; the `pod install` step and its cache disappear, so it should improve.

### Security

- [ ] Every package is pinned by version or revision, so a build cannot silently take new upstream code.
- [ ] No credential or token moves from CocoaPods to SwiftPM configuration.

### UX

- [ ] No user-visible change whatsoever — this is a distribution-channel move.

### i18n

- N/A — no user-facing strings change.

### Observability

- [ ] The resolved Firebase version is visible in the build log, so a mismatch between CI and a developer machine is diagnosable without a checkout.

## BDD Scenarios

**Scenario: the iPhone app still works on the new channel**
- **Given** the app is built with Firebase from Swift Package Manager
- **When** a person signs in on a real iPhone
- **Then** their chats load
- **And** a notification sent to them arrives

**Scenario: a broken dependency stops the build**
- **Given** the Firebase package cannot be resolved
- **When** the build runs
- **Then** it fails and names the package it could not resolve

**Scenario: no second copy of the SDK survives the move**
- **Given** the migration is complete
- **When** the build runs
- **Then** it fails if a CocoaPods Firebase is also present

## Test Plan

**Classification: FULL protocol.** Changes how the iOS app is assembled, so
every iOS surface is in scope. The complete real-device matrix runs.

### Red (must fail first)

- A guard test asserting no CocoaPods Firebase remains — RED while the Podfile still lists it.
- A guard test asserting `Package.resolved` pins Firebase — RED before the package is added.

### Green

- iOS unit + UI tests, `:shared:compileKotlinIosArm64`, full device journeys on a **real iPhone**, local then dev.
- Sign-in, chat, push and App Check each exercised on the device — not asserted from unit tests.

### Mutation proof

- Remove the Firebase package → the resolution guard fails.
- Re-add a Firebase pod → the "no second copy" guard fails.

## Out of Scope

- LiveKit, swift-protobuf and the WebRTC xcframework — already on SwiftPM.
- Any change to Firebase USAGE. This moves where the SDK comes from, nothing else.
- The Android Firebase BOM, which is a separate channel and unaffected.

## Dependencies

- **SHY-0244** should land first — it moves the pods to 12.18.0, so this starts from a current version rather than migrating and upgrading in one step.
- A real iPhone over USB and dev Firebase, for device proof.

## Risks & Mitigations

- **Risk: App Check / push break subtly on the new channel**, and the symptom is silent (no notifications). **Mitigation:** delivery proven on a real iPhone in dev before merge, exactly as SHY-0244 requires.
- **Risk: the migration is done under time pressure in October 2026.** **Mitigation:** that is the reason this story exists now rather than then.
- **Risk: two copies of the SDK link ambiguously** and the failure is a confusing duplicate-symbol error. **Mitigation:** a guard that fails the build when both are present, with a message that says which two.

## Definition of Done

- [ ] Firebase resolved via SwiftPM, no CocoaPods Firebase anywhere in the build.
- [ ] Sign-in, chat, push and App Check proven on a **real iPhone** in dev.
- [ ] CocoaPods scaffolding removed if Firebase was the last pod.
- [ ] Full pre-merge gauntlet green: all frameworks, real devices, all browsers, local then dev.
- [ ] Status flipped to `In Review` before merge; `released_in:` set when the release is cut.

## Notes (running log)

- **2026-08-28** — Filed while bumping the Firebase pods 12.14.0 → 12.18.0 for
  SHY-0244. The deprecation notice had already been recorded inside SHY-0294,
  which then closed as Done, leaving the item owned by nobody. It has a date, so
  it gets a ticket.
