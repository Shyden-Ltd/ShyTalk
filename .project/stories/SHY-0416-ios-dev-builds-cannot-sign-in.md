---
id: SHY-0416
status: In Review
owner: unassigned
created: 2026-08-21
priority: P0
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0416: No iOS dev build can sign in, which is why iOS is never walked

## User Story

As **whoever has to prove a change works on iPhone**, I want the dev build to be
signed-in-able, so that "iOS proof owed" stops being the permanent state of every
story.

## Why

**The iOS distribution job never passes `DEV_QA_PERSONAS_PASSWORD`.**

`deploy-dev.yml:517` sets it for **`distribute-android`**. The
`Distribute iOS to TestFlight` job does not set it at all. `BuildVariant` is
explicit about the consequence:

```kotlin
val isPersonaPickerAvailable: Boolean
    get() = !holder.localDevPersonasPassword.isNullOrEmpty()
```

So every iOS dev build ships with an empty password. The button still renders,
because visibility is gated on `isDevAffordancesVisible` (dev flavour) rather
than on the credential — deliberately, so a misconfigured build is visible rather
than silently absent.

But the promised recovery does not exist. The comment says the dialog "uses the
inner credential check to render an **actionable empty state**". The row handler
does this instead:

```kotlin
val sharedPw = BuildVariant.localDevPersonasPassword
if (sharedPw.isNullOrEmpty()) {
    logW("SignInScreen", "Persona picker invoked but localDevPersonasPassword is empty")
    return@PersonaPickerRow
}
```

A log line and a silent return. Verified on a real iPhone, 2026-08-21, build 239:
tapping the button opens **nothing** — the accessibility tree afterwards contains
only the preview banner.

### What it has cost

This is why iOS journey proof has been perpetually owed. It was attributed to
TestFlight not being installed (wrong — it was), and to device discipline
(wrong). **No iOS dev build has ever been sign-in-able via personas**, so no
persona-based iOS journey could ever have run. Every story requiring iOS proof
has been blocked by one missing line in one job.

It is also the session's recurring shape once more: a control that renders and
does nothing, with a comment describing behaviour that was never written.

## Acceptance Criteria

### Happy path

- [ ] An iOS dev build from CI can sign in as a test persona.
- [ ] The same personas that work on Android work on iOS.

### Error paths

- [ ] A build genuinely lacking the credential shows the **actionable empty
      state** the comment already promises — not a log line and a silent return.
- [ ] That state says what is wrong and what to do about it.

### Edge cases

- [ ] A prod build still shows no picker at all, credential or not.
- [ ] A local-flavour build keeps working with its hardcoded password.

### Performance

- [ ] No change.

### Security

- [ ] The password reaches the iOS build the same way it reaches Android — from
      the secret, never committed.
- [ ] Nothing logs the password, including the new empty state.

### UX

- [ ] Somebody looking at the picker can tell whether it is unusable and why.

### i18n

- [ ] Not applicable — a developer affordance, English by policy.

### Observability

- [ ] The existing warning stays; it just stops being the ONLY thing that
      happens.

## BDD Scenarios

**Scenario: An iPhone build can sign in**

- **Given** a dev build of the iPhone app from CI
- **When** somebody signs in as a test persona
- **Then** they reach the app

**Scenario: A build that cannot sign in says so**

- **Given** a dev build with no persona credential
- **When** somebody opens the picker
- **Then** they are told it is unavailable and why

**Scenario: Production shows nothing**

- **Given** a production build
- **When** somebody looks at the sign-in screen
- **Then** there is no persona picker

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, real iPhone** | The decisive one: a CI dev build signs in as a persona on a real device. Nothing short of that closes this. |
| Workflow guard | A test asserting the iOS job passes the same credential env the Android job does — the seam between two jobs, which neither job's own success can reveal. |
| Empty state | With the credential absent, the picker renders the actionable state rather than returning silently. |
| Prod | Still no picker, credential or not. |

## Out of Scope

- Changing which personas exist or their passwords.

## Dependencies

- None. The secret already exists; one job does not read it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The fix is made and nobody checks iOS again for months | The DoD is a real sign-in on a real iPhone, not a green workflow. |
| The same asymmetry returns for another credential | The workflow guard compares the two jobs' env rather than asserting one job's contents. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A CI dev build signs in as a persona on the real iPhone.

## Notes

- Found 2026-08-21 while trying to walk SHY-0387 on the iPhone, after the
  operator cleared the two blockers that were previously believed to be the
  cause. Those were real and are now fixed; this was underneath them.
