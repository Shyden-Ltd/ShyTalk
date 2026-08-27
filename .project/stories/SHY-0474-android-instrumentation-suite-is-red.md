---
id: SHY-0474
status: In Review
owner: unassigned
created: 2026-08-27
priority: P0
effort: M
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0474: The Android instrumentation suite is red — eight failures, three causes

## User Story

As **whoever promotes develop to main**, I want the Android instrumentation
suite to be green, so that the release gate is a gate rather than a formality
somebody waves through.

## Why

The develop→main promotion ran the Android E2E job and it failed: **8 of 98
tests**, across four classes. Every constituent story PR was green, so nothing
before this pointed at it. Three unrelated causes:

### 1. Every instrumentation test runs as a MINOR (5 failures)

`UserFlags.cohort` defaults to `COHORT_MINOR` — deliberately, because unknown
must be the restrictive answer. `FakeUserRepository` builds a bare `UserFlags()`,
so its flow emits `minor`, and `SharedNavGraph` feeds that straight into
`MainScreen`.

SHY-0459 then does exactly what it was written to do: hides the messages tab and
the wallet from a minor. Five tests written before it still expect those doors:

```
NavigationSmokeTest    allBottomTabs_navigable                 TestTag 'main_messagesTab' not found
NavigationSmokeTest    newMessageFab_visible_onMessagesTab     TestTag 'main_messagesTab' not found
PrivateMessagingTest   messagesTab_showsConversationList       TestTag 'main_messagesTab' not found
PrivateMessagingTest   clickConversation_opensPrivateChat      TestTag 'main_messagesTab' not found
PrivateMessagingTest   privateChat_backButton_returnsToMessages TestTag 'main_messagesTab' not found
ProfileTest            profileTab_walletButton_navigatesToWallet TestTag 'profile_walletButton' not found
```

The gate is correct. The **sweep** stopped at the shared code and never reached
the Android suite. Worse, the cohort these tests run under was never *stated* —
it was inherited from a default, so nobody choosing to test the adult surface
knew they were testing the minor one.

### 2. A test DI module less complete than production (2 failures)

`AgeVerificationSubmitViewModel` **is** registered in the real
`ViewModelModule`. It is absent from the androidTest `TestKoinModule`, so
navigating to the screen throws `NoDefinitionFoundException` — a failure that
exists only in tests and says nothing about the app.

### 3. A deliberate count pin, left behind (1 failure)

`StringResourceContentTest` pins the resolved resource count so a truncated
corpus cannot pass vacuously. The corpus grew to 884; the pin still reads 838.
The pin is doing its job — it must be moved deliberately, not weakened.

## Acceptance Criteria

### Happy path

- [ ] The Android instrumentation suite passes, 98/98.
- [ ] Tests that exercise adult surfaces state the adult cohort explicitly
      rather than inheriting one.

### Error paths

- [ ] A test that navigates to age verification resolves its view model, so a
      DI gap fails as a missing registration rather than as a screen defect.
- [ ] The resource-count pin still fails when the corpus changes.

### Edge cases

- [ ] A minor is asserted NOT to be offered messages or the wallet, so
      SHY-0459 being reverted fails a test on Android and not only in shared
      code.
- [ ] A test that does not state a cohort still gets the restrictive one — the
      fail-closed default is not weakened to make tests convenient.

### Performance

- [ ] No change: same test count plus the new cohort cases.

### Security

- [ ] The cohort default stays `minor` everywhere. The fix makes tests state
      what they mean; it does not make unknown mean adult.

### UX

- [ ] None: test-suite only. No production behaviour changes.

### i18n

- [ ] The resource-count pin is updated to the real corpus size, so a future
      truncation is still caught.

### Observability

- [ ] A cohort-related failure names the cohort the test ran under, so the next
      person does not have to trace a default through three files.

## BDD Scenarios

**Scenario: An adult sees the parts of the app meant for adults**

- **Given** somebody signed in as an adult
- **When** they look at the bottom of the screen
- **Then** messages and the wallet are there

**Scenario: A young person is not offered them**

- **Given** somebody signed in as a minor
- **When** they look at the bottom of the screen
- **Then** messages and the wallet are absent

## Test Plan

| Layer | What it proves |
| --- | --- |
| Instrumentation (emulator) | 98/98, including the five that regressed. |
| Instrumentation (emulator) | The same screen, two cohorts, opposite answers. |
| Instrumentation (emulator) | Age verification resolves its view model. |
| Unit | The resource pin fails on a changed corpus. |
| Device (real) | The local journey matrix still passes 15/15. |

## Out of Scope

- Changing SHY-0459's gating. It is correct; only the tests are stale.
- The cohort default. `minor` on unknown is deliberate and stays.

## Dependencies

- Completes SHY-0459, whose sweep did not reach the Android suite.

## Risks & Mitigations

- **Risk:** giving the fake an adult cohort hides a genuine regression in the
  minor surface. **Mitigation:** the minor case is asserted explicitly, on the
  same screen, in the same suite.
- **Risk:** the count pin is treated as noise and weakened next time.
  **Mitigation:** its message already says not to, and the AC repeats it.

## Definition of Done

- [ ] 98/98 on the emulator.
- [ ] Adult and minor surfaces both asserted on Android.
- [ ] The promotion PR's Android E2E job is green.

## Outcome

103/103 executed on a real OnePlus (`3b402284`), **all eight CI failures fixed**,
nothing regressed. Four failures remain and are **not this story's**:
`RoomBrowsingTest` (3) and `RoomCreationTest` (1) fail identically on **clean
develop** on the same phone, and pass on CI's emulator. Filed as SHY-0475.

Five causes were found, not the three the promotion showed, because fixing the
first three exposed two more:

1. `AgeVerificationSubmitViewModel` missing from `TestKoinModule` — and once
   registered, its `AgeVerificationRepository` was missing too, so Koin failed
   one layer deeper.
2. The resource-count pin, moved 838 → 884 deliberately.
3. Instrumentation tests were never SIGNED IN. `SharedNavGraph` reads
   `resolvedUniqueId`, the fake defaults it to null, so the user-flags listener
   never subscribed and `ownCohort` stayed `minor` regardless of the fake.
4. The cohort has **two readers**: the messages tab asks the nav graph's
   `ownCohort`; the wallet asks `user.cohort` on the profile document. Setting
   one left the other correctly hidden.
5. `FakeUserRepository` is a Koin singleton that `ResetFakesRule` never reset,
   so a cohort written by one test leaked into every later one.

And one design correction worth recording: signing every test in **wholesale**
broke ten passing tests, because a resolved id turns the whole app signed-in —
the private-message sync service starts and room screens take another path. The
shipped design is opt-IN (`cohort: String? = null`), so a test that does not ask
for a cohort behaves exactly as it did before.

## Notes

Found by the develop→main promotion, which is the first thing in months to run
this suite against the full set of merged stories. That is the gate working:
every constituent PR was green, and the failure only exists where they meet.
