# SHY-0379 — refined spec, held out of the story file

**Status: not yet applied to `.project/stories/SHY-0379-hide-age-gated-features-from-known-minors.md`.**

This is the full refinement of SHY-0379 from the operator's 2026-08-21 decisions —
the age-gate state machine, the two consequences, and the traps. It lives here
rather than in the story file because **`scripts/check-pr-story-status.js` refuses
a MODIFIED story still at `Draft`**: its exemption is add-only (`code === 'A' &&
status === 'Draft'`), so filing a new Draft passes but rewriting an existing one
does not. Flipping the status to `In Review` with nothing implemented would be
false, and the `Reviewed-up-to` marker would point at a commit that reviewed no
implementation.

**How to apply it:** when SHY-0379 is picked up, the first commit of its branch
replaces the story body with everything below the rule, flips `status:` to
`In Review`, and deletes this file. That commit is legitimately a modified story
at `In Review`, so the gate passes.

This is the second time the trap has fired (SHY-0146, 2026-08-20 — PR #1876 was
closed rather than faking a status). **SHY-0394 is filed to decide whether the
gate should learn a spec-only mode; that is an operator call, not a unilateral
loosening of a merge gate.**

---

# SHY-0379: Stop offering under-18s things they cannot have

## User Story

As **someone under 18 using ShyTalk**, I want the app to simply not offer me the
things my age excludes, so that I am not repeatedly invited to tap something that
always turns me away.

## Why

**Operator decision, 2026-08-20:** "if the account is verified as underage, just
do not show any underage blocked features at all." Refined 2026-08-21 into the
full state machine below.

Today a known under-18 account sees Lucky Spin and private-message affordances,
taps them, and gets a dialog that is a dead end. Noticed while walking SHY-0372
on a real device as a minor persona: the wheel is fully rendered, the coin
balance is shown, the three spin buttons look live, and every one of them is a
wall.

## The state machine

**Operator, 2026-08-21**, resolving how verification interacts with age:

| Date of birth | Verified? | Age-gated features |
| --- | --- | --- |
| **under** the threshold | — | **hidden entirely** |
| at or over the threshold | **yes** | visible and usable |
| at or over the threshold | **no** | visible; using one prompts verification |
| at or over the threshold | verification proves **under** | **hidden**, and the account is suspended — [[SHY-0388]] |

Two consequences worth stating plainly:

- **Ageing in restores them.** Somebody who was hidden from these features gets
  them back the day their date of birth crosses the threshold, without
  reinstalling or contacting anybody.
- **Existing verification is enough.** Operator: *"if we already have
  verification then verification is not needed. if we don't then require
  verification."* So an already-verified adult is not re-prompted, and an
  unverified one is — which is today's `NeedsVerification` behaviour, unchanged.

## The distinction that must not be lost

`AgeRestrictionService.computeState()` returns `SubEighteen` in **two** different
situations:

| Situation | Meaning |
| --- | --- |
| DOB present and under the threshold | genuinely, knowably under age |
| **DOB missing** | a deliberate fail-closed default, not a finding |

Hiding on the second would mean somebody whose date of birth merely failed to
load silently loses features with no explanation — a silent failure, and worse
than the dialog. **Hiding applies only to the first.** Unknown age keeps today's
behaviour: the feature is shown and the existing gate decides.

## Hiding is never the gate

This story changes what is **offered**, not what is **allowed**. The checks in
`GachaViewModel.pull()`, `PrivateChatViewModel`, and the server stay exactly as
they are. A build with its UI patched, or a request made directly, must still be
refused. If this ever becomes the only thing standing between a minor and gacha,
it has been implemented wrong.

## Acceptance Criteria

### Happy path

- [ ] Somebody known to be under the threshold never sees an entry point to
      Lucky Spin or to private messages.
- [ ] Somebody at or over the threshold **and already verified** sees both and
      can use them without being re-prompted.
- [ ] Somebody at or over the threshold and **not** verified sees both, and is
      prompted to verify when they try to use one.
- [ ] Somebody who crosses the threshold gets the features back on their next
      natural refresh, without reinstalling.

### Error paths

- [ ] If the date of birth cannot be determined, the features stay **visible**
      and the existing gate handles it. Hiding on unknown would be a silent
      failure.
- [ ] Nothing is hidden on the strength of a value that is still loading; a
      feature must not flicker in and then be taken away.

### Edge cases

- [ ] Somebody who turns the threshold age **while the app is open** is handled
      coherently — decide and state whether it takes effect immediately or on
      next launch.
- [ ] A room whose only listed activity is Lucky Spin does not leave an empty
      space or a broken carousel where the tile used to be.
- [ ] An under-18 who received a private message before this change is handled
      coherently — decide and state whether existing threads remain readable.
- [ ] A deep link straight to a gated screen is handled, not left blank.
- [ ] **Support is never hidden.** It is not an age-gated feature, and hiding it
      would strand exactly the person most likely to need it.

### Performance

- [ ] No extra network call to decide visibility; the age is already known to
      the client.

### Security

- [ ] **The existing gates are untouched.** Server-side and ViewModel refusals
      remain and are still tested. Visibility is a courtesy, not a control.
- [ ] A patched client that forces the entry point back is still refused.
- [ ] Nothing new is logged that would reveal a minor's date of birth.

### UX

- [ ] Where a feature disappears, the surrounding layout still reads as
      deliberate — no gaps, no dead carousel slots, no orphaned headings.
- [ ] No copy anywhere tells a minor what they are missing. The point is to stop
      drawing attention to it.

### i18n

- [ ] Any replacement copy goes to **all 21 locale files** — the MVP rule governs
      which languages the product ships in, not which files stay in parity, and
      both the parity guard and the pinned string count require every key
      everywhere until SHY-0194 deletes the retired directories.

### Observability

- [ ] It is possible to tell from a log whether a surface was hidden by age or
      absent for another reason, **without recording anyone's date of birth**.

## BDD Scenarios

**Scenario: An under-18 is not shown what they cannot have**

- **Given** somebody under the age limit is using ShyTalk
- **When** they look at a room and their messages
- **Then** they see no way in to Lucky Spin or private messages

**Scenario: An adult who has already verified is not asked again**

- **Given** somebody over the age limit whose age is already verified
- **When** they open Lucky Spin
- **Then** it works, with no prompt to verify

**Scenario: An adult who has not verified is asked to**

- **Given** somebody over the age limit who has not verified
- **When** they try to spin
- **Then** they are invited to verify their age

**Scenario: An unknown age is not treated as under age**

- **Given** somebody whose date of birth could not be loaded
- **When** they look at a room
- **Then** the features are still shown and the existing check decides

**Scenario: The rule still holds without the UI**

- **Given** a build whose hidden entry point has been forced back
- **When** the person tries to spin
- **Then** they are refused exactly as they are today

## Test Plan

| Layer | What it proves |
| --- | --- |
| Visibility unit tests | Each row of the state machine, including **unknown DOB shows** and **already-verified is not re-prompted**. |
| Boundary tests | The day before, the day of, and the day after the threshold birthday. Off-by-one here hides features from an adult or shows them to a minor. |
| Gate regression | Every existing refusal test passes **unmodified** — proof the gate was not weakened while the UI changed. |
| Bypass test | Visibility forced on, pull attempted, still refused. This is the test that stops "hiding" quietly becoming "gating". |
| Layout tests | No empty slot where a tile was; a carousel with one fewer item still behaves. |
| Device journeys | Real Android and real iPhone, as a minor persona **and** an adult persona. The minor reaches no dead ends; the adult sees no change. |

## Out of Scope

- Changing who is **allowed** to use these features.
- The DOB-entry warning ([[SHY-0387]]) and suspension on a verified mismatch
  ([[SHY-0388]]).
- The dead-end wording of the existing dialog, which stays for the unknown-age
  and forced-entry paths.

## Dependencies

- `AgeRestrictionService` must expose "known under the threshold" distinctly
  from its fail-closed default before visibility can key on it.
- [[SHY-0385]] (merged or in review) touches the same dialog.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Hiding becomes the only gate | Bypass test asserts a forced entry point is still refused; existing gate tests stay untouched. |
| The fail-closed default silently hides features from adults | Visibility keys on *known* under-age only; unknown DOB keeps today's behaviour, with its own test. |
| Off-by-one on the birthday | Explicit boundary tests either side of the threshold date. |
| A minor infers what they are missing from a gap in the layout | Layout is re-flowed, not blanked; no copy references the missing feature. |
| A third gated feature is added later and forgets this rule | Visibility derives from `AgeRestrictionService`, so a new gate inherits it. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device and a real iPhone, as a minor persona and
      an adult persona.
- [ ] Bypass test present and passing.
- [ ] Every pre-existing age-gate test still passing, unmodified.

## Notes

- The two gates today are `AgeRestrictionService.checkPmAccess` and
  `checkGachaAccess`, so the surfaces are **private messages** and **Lucky Spin**.
  A third gate added later must inherit this behaviour, not re-implement it.
- Raised while SHY-0372 was being device-verified as **[SEED] Marcus (P-04 minor
  power)**, who saw a fully rendered wheel, a coin balance, and three live-looking
  spin buttons — every one of them a wall.
