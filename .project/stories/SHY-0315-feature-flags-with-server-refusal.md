---
id: SHY-0315
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0315: A kill-switch that actually kills — client hides the entrance, the API closes the door

## User Story

As the **operator**, I want to switch a feature off from the server and have it
genuinely unavailable, so that turning something off is a real control and not
just a hidden button.

## Why

This is the *fix mistakes fast* driver, and it is the one story in EPIC-0011
that must ship **both halves in a single PR**.

A client-side feature flag alone is theatre. It hides the entrance; it does not
close the door. Anyone who knows the endpoint — or who is running a modified
build, which is precisely the operator's stated concern — walks straight past
it. Worse, a hidden-but-live feature is the most dangerous possible state,
because everyone believes it is off.

So `features.<id>.enabled = false` must mean two things at once:

1. **The client stops offering it** — the entrance disappears, no dead taps.
2. **The API refuses it** — every endpoint belonging to that feature answers
   `403` with a distinct code, whatever the caller believes.

Splitting these across two PRs would leave a window in which the flag exists and
does nothing, and that window is exactly when someone would first reach for it in
anger. Hence one story, both halves, and a test that proves the server half by
calling the API **directly, bypassing the client entirely** — which is the only
honest way to test it.

Note the deliberate asymmetry with SHY-0314: hiding a menu item is a UI change,
and a hidden entrance must still be deep-linkable. Disabling a *feature* is an
access-control change, and a disabled feature must not be reachable by any route.

## Acceptance Criteria

### Happy path

- [ ] Setting a feature `enabled: false` removes its entry points from the app with no reinstall.
- [ ] Every API endpoint belonging to that feature returns `403` with `code: 'feature_disabled'`.
- [ ] Re-enabling restores both halves with no reinstall and no deploy.

### Error paths

- [ ] A direct API call to a disabled feature's endpoint — with a valid session, bypassing the client — is refused `403`.
- [ ] A deep link to a disabled feature's screen does not open it; the user is returned to a valid screen, not left on a blank one.
- [ ] A request already in flight when the flag flips completes or fails cleanly; no partial write is committed.
- [ ] An unknown feature id in a `visibleIf` hides the item (SHY-0310 fail-closed rule), asserted end-to-end here.

### Edge cases

- [ ] Disabling a feature mid-session takes effect on the next API call, not only on the next cold start.
- [ ] A feature disabled for one cohort and enabled for another is correct for both, proven on two real accounts.
- [ ] Disabling a feature does not delete or hide data the user already owns — a disabled shop still shows previously bought items in the backpack.
- [ ] A feature with no declared endpoints (pure UI) disables cleanly with no server change required.

### Performance

- [ ] The server-side flag check adds under 5 ms per request, asserted over 100 real requests.
- [ ] The check requires no Firestore read per request — the resolved flag set is in-process, invalidated on manifest change.

### Security

- [ ] The refusal is enforced server-side for every endpoint of the feature, enumerated in a test that fails when a new endpoint is added without a flag check.
- [ ] The `403` body reveals only that the feature is unavailable — no internal reason, no rollout detail.
- [ ] A disabled feature cannot be reached by a modified client, proven by calling the API directly with the client removed from the picture.
- [ ] Flag state is never taken from a client-supplied header or body — only from the server's own resolved manifest.

### UX

- [ ] No dead entry points: a disabled feature leaves no tappable element that does nothing.
- [ ] A user mid-flow when a feature is disabled sees a clear, translated message rather than an error code or a blank screen.
- [ ] Screenshots on real Android and real iPhone in enabled and disabled states, every viewport, reviewed by eye.

### i18n

- [ ] The feature-unavailable message exists in all 20 locales.
- [ ] The message is asserted on rendered text in every locale, not on the presence of a container.

### Observability

- [ ] Every `403 feature_disabled` logs the feature id and the caller's cohort.
- [ ] A flag flip logs the old and new value with the `manifestVersion` that carried it.
- [ ] The count of refusals per feature is queryable, so a flag left off by accident is visible.

## BDD Scenarios

**Scenario: Turning a feature off removes it from the app**

- **Given** the shop is switched on and visible
- **When** the operator switches the shop off
- **Then** the shop disappears from the app without reinstalling it

**Scenario: A switched-off feature cannot be used another way**

- **Given** the shop is switched off
- **When** someone tries to buy something without going through the app's screens
- **Then** the request is refused

**Scenario: A user already in the feature is told clearly**

- **Given** a user part-way through buying something
- **When** the operator switches the shop off
- **Then** the user sees a message in their own language explaining it is unavailable

**Scenario: Switching a feature off does not take away what was bought**

- **Given** a user who has already bought an item
- **When** the operator switches the shop off
- **Then** the user can still see the item they own

## Test Plan

**RED first**, and the server half is tested by calling the API directly.

### Node / Jest (`express-api/tests/routes/feature-flags.test.js`)

- `refuses every endpoint of a disabled feature with 403 feature_disabled`
- `enumerates every feature endpoint and fails if one lacks a flag check`
- `allows every endpoint when the feature is enabled`
- `refuses a direct call with a valid session and no client involved`
- `resolves the flag from the server manifest, never from a request header`
- `is correct per cohort for two different callers`
- `reveals no internal reason in the 403 body`
- `adds under 5ms over 100 real requests`
- `performs no Firestore read per request`

The enumeration test is the one that matters long-term: it is what stops a new
endpoint shipping without a flag check six months from now.

### Kotlin unit (`shared/src/commonTest/`)

- `hides entry points for a disabled feature`
- `hides an item whose visibleIf names an unknown feature`
- `blocks a deep link to a disabled feature's screen`
- `keeps owned data visible when its feature is disabled`

### Device, REAL Android + REAL iPhone

- Operator disables a feature; both devices lose the entrance with no reinstall.
- Mid-flow disable, asserting the translated message on the real device.
- Two real accounts in different cohorts.
- Screenshots in both states at every viewport.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| server-side check removed, client hiding retained | `refuses every endpoint of a disabled feature with 403 feature_disabled` |
| flag read from a request header | `resolves the flag from the server manifest, never from a request header` |
| deep-link guard removed | `blocks a deep link to a disabled feature's screen` |
| one endpoint dropped from the enumeration | `enumerates every feature endpoint and fails if one lacks a flag check` |
| owned data hidden along with the feature | `keeps owned data visible when its feature is disabled` |
| `403` body includes the rollout reason | `reveals no internal reason in the 403 body` |

### Backend change ⇒ FULL gauntlet

Touches `express-api/src/**`; the full device + all-browser matrix runs.

## Out of Scope

- Removing a feature's code — this is a runtime switch, not a deletion.
- Per-user (rather than per-cohort) targeting — SHY-0317's rollout buckets cover
  percentage targeting; individual targeting is not in Phase 1.
- Sealed screens, which are never flag-controlled by construction (SHY-0311).

## Dependencies

- **SHY-0310**, **SHY-0311**, **SHY-0312**, **SHY-0313** — pipeline below.
- **SHY-0314** — shares the `visibleIf` evaluation path.
- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Only the client half ships, leaving a flag that hides but does not block | Both halves are in one PR by design, and the server half is proven by a direct API call with the client bypassed. Removing the server check is the first mutation in the table. |
| A new endpoint added later has no flag check | The enumeration test fails when an endpoint of a flagged feature lacks a check. |
| Disabling a feature destroys access to data users already own | Explicit AC and test: owned items remain visible. Hiding them is in the mutation table because it is the plausible over-reach. |
| A disabled feature leaves dead taps | Explicit UX AC plus device screenshots in the disabled state. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] The server refusal is **proven by a direct API call with the client bypassed**.
- [ ] Disable and re-enable each proven on a real Android device and a real iPhone with no reinstall.
- [ ] Feature-unavailable message verified on rendered text in all 20 locales.
- [ ] Backend change ⇒ FULL gauntlet green, then DEV green.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §5.3. Both halves in one PR is a deliberate scope decision recorded in the EPIC: a client-only flag is theatre, and the window between two PRs is exactly when someone would first reach for the switch in anger.
- **2026-08-17** — The asymmetry with SHY-0314 is intentional. A hidden menu item must stay deep-linkable, because hiding an entrance is a UI change; a disabled feature must not be reachable by any route, because that is access control.
