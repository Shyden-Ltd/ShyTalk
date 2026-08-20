---
id: SHY-0379
status: Draft
owner: unassigned
created: 2026-08-20
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0379: Stop offering under-18s things they can never have

## User Story

As **someone under 18 using ShyTalk**, I want the app to simply not offer me the
things my age excludes, so that I am not repeatedly invited to tap something
that always turns me away.

## Why

**Operator decision, 2026-08-20:** "if the account is verified as underage, just
do not show any underage blocked features at all."

Today a known under-18 account sees Lucky Spin and private-message affordances,
taps them, and gets:

> **Feature unavailable** — Private messages and gacha are only available to
> users 18 or older. Based on the date of birth on your account, you are not yet
> eligible. If you believe this is wrong, please contact support — we cannot
> accept ID submissions to override the date of birth on file.

That dialog is a dead end. There is no action the person can take, and nothing
changes until their next birthday. Offering the feature anyway is an invitation
to a refusal — it reads as the app teasing them, and it generates support
contacts that support cannot resolve.

This was noticed while walking SHY-0372 on a real device as a minor persona: the
wheel is fully rendered, the coin balance is shown, the three spin buttons look
live, and every one of them is a wall.

### Two gated features today

`AgeRestrictionService` exposes exactly two gates — `checkPmAccess` and
`checkGachaAccess`. So the surfaces are **private messages** and **Lucky Spin
(gacha)**. Any third gate added later must join this behaviour, not re-invent it.

### The distinction that matters

`computeState` returns `SubEighteen` in **two different situations**:

| Situation | Meaning |
| --- | --- |
| DOB present and under 18 | genuinely, verifiably under age |
| **DOB missing** | a deliberate fail-closed default, not a finding |

The operator's words were "**verified** as underage". Hiding on the second case
would mean someone whose date of birth merely failed to load silently loses
features with no explanation — a silent failure, and worse than the dialog. So
hiding applies **only** to the first.

Likewise `NeedsVerification` (18+ on DOB, not yet verified) keeps its current
behaviour: that prompt is **actionable**, so the feature should stay visible.

### Hiding is never the gate

This story changes what is **offered**, not what is **allowed**. The checks in
`GachaViewModel.pull()`, `PrivateChatViewModel`, and the server stay exactly as
they are. A build with its UI patched, or a request made directly, must still be
refused. If this story ever ends up as the only thing standing between a minor
and gacha, it has been implemented wrong.

## Acceptance Criteria

### Happy path

- [ ] Someone known to be under 18 never sees an entry point to Lucky Spin or to
      private messages.
- [ ] Someone 18 or over sees both, exactly as today.
- [ ] Someone 18 or over who has not yet verified still sees both, and still
      gets the prompt inviting them to verify.

### Error paths

- [ ] If the person's date of birth cannot be determined, the features stay
      **visible** and the existing gate handles it. Hiding on unknown would be a
      silent failure.
- [ ] Nothing is hidden on the strength of a value that is still loading; the
      display must not flicker a feature in and then take it away.

### Edge cases

- [ ] Someone who turns 18 while using the app gets the features on their next
      natural refresh, without reinstalling.
- [ ] A room whose only listed activity is Lucky Spin does not leave an empty
      space or a broken carousel where the tile used to be.
- [ ] An under-18 who receives a private message from before this change is
      still handled coherently — decide and state whether existing threads
      remain readable.
- [ ] A deep link straight to a gated screen is handled, not left blank.

### Performance

- [ ] No extra network call to decide visibility; the age is already known to
      the client.

### Security

- [ ] **The existing gates are untouched.** Server-side and ViewModel refusals
      remain, and are still tested. Visibility is a courtesy, not a control.
- [ ] A patched client that forces the entry point back is still refused.
- [ ] Nothing new is logged that would reveal a minor's date of birth.

### UX

- [ ] Where a feature disappears, the surrounding layout still reads as
      deliberate — no gaps, no dead carousel slots, no orphaned headings.
- [ ] No copy anywhere tells a minor what they are missing. The point is to stop
      drawing attention to it.

### i18n

- [ ] If any replacement copy is added, it goes to the **5 MVP locales only**
      (en, zh, id, vi, th).

### Observability

- [ ] It is possible to tell from a log whether a surface was hidden by age or
      absent for another reason, without recording anyone's date of birth.

## BDD Scenarios

**Scenario: An under-18 is not shown what they cannot have**

- **Given** someone under 18 is using ShyTalk
- **When** they look at a room and their messages
- **Then** they see no way in to Lucky Spin or private messages

**Scenario: An adult is unaffected**

- **Given** someone over 18 is using ShyTalk
- **When** they look at a room
- **Then** Lucky Spin is there and works as before

**Scenario: An unknown age is not treated as under-age**

- **Given** someone whose date of birth could not be loaded
- **When** they look at a room
- **Then** the features are still shown and the existing check decides

**Scenario: The rule still holds without the UI**

- **Given** a build whose hidden entry point has been forced back
- **When** the person tries to spin
- **Then** they are refused exactly as they are today

## Test Plan

| Layer | What it proves |
| --- | --- |
| ViewModel / visibility unit tests | Known under-18 hides; 18+ shows; not-yet-verified shows; **unknown DOB shows**; loading state hides nothing. |
| Gate regression tests | Every existing refusal test still passes untouched — proof the gate was not weakened while the UI changed. |
| Bypass test | Visibility forced on, pull attempted, still refused. This is the test that stops "hiding" quietly becoming "gating". |
| Layout tests | No empty slot where a tile was; carousel with one fewer item still behaves. |
| Device journeys | Real Android and real iPhone, as a minor persona **and** an adult persona. The minor must reach no dead ends; the adult must see no change. |

## Out of Scope

- Changing who is allowed to use these features. This story changes what is
  shown, not the policy.
- The dead-end wording of the existing dialog. It stays for the unknown-age and
  forced-entry paths.
- SHY-0372's latch fix, which is independent — the coins and unknown-tier
  refusals latch the wheel for **adults**, with no age gate involved.

## Dependencies

- SHY-0372 (in review) touches the same overlay. Land it first to avoid a
  conflict in `LuckySpinOverlay`.
- `AgeRestrictionService` must expose "known under 18" distinctly from its
  fail-closed default before visibility can key on it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Hiding becomes the only gate | Bypass test asserts a forced entry point is still refused; existing gate tests stay untouched. |
| Fail-closed default silently hides features from adults | Visibility keys on *known* under-18 only; unknown DOB keeps today's behaviour. |
| A minor infers what they are missing from a gap in the layout | Layout is re-flowed, not blanked; no copy references the missing feature. |
| A third gated feature is added later and forgets this rule | Visibility derives from `AgeRestrictionService`, so a new gate inherits it rather than re-implementing it. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real Android device and a real iPhone, as a minor persona and
      an adult persona.
- [ ] Bypass test present and passing.
- [ ] Every pre-existing age-gate test still passing, unmodified.

## Notes

- Raised by the operator while SHY-0372 was being device-verified as
  **[SEED] Marcus (P-04 minor power)**, who saw a fully rendered wheel, a coin
  balance, and three live-looking spin buttons — every one of them a wall.
- The two gates are `AgeRestrictionService.checkPmAccess` and `checkGachaAccess`.
- This is squarely aligned with ShyTalk's age-segregation model; it removes an
  invitation, it does not relax a control.
