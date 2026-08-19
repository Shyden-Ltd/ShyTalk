---
id: SHY-0322
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: M
type: refactor
roadmap_ids: []
mvp: true
---

# SHY-0322: Remove the gacha age-verification gate, and keep cohort segregation exactly as it is

## User Story

As the **operator**, I want the age-verification gate in front of gacha removed,
so that users are not asked to verify their age for a mechanic that awards
nothing of cash value — while minors and adults remain in separate cohorts.

## Why

Operator decision, 2026-08-17. The reasoning: gacha awards no cash-out value and
there is no way to earn real money from the app, so the gambling-age rationale
does not apply to it.

**The critical distinction, and the reason this story's scope is drawn where it
is:** age *verification* and cohort *segregation* are two different mechanisms in
this codebase serving two different purposes.

- **Age verification** proves how old someone is, and gates gacha. The
  no-cash-out argument reaches this.
- **Cohort segregation** (SHY-0132/0137) keeps minors and adults out of the same
  voice rooms and chats. It exists because ShyTalk is a product where strangers
  talk to each other. The gacha argument does not reach it at all, and it stays.

Removing the first while keeping the second is the operator's explicit choice.
This story must not become a general age-teardown by drift: **the single largest
risk here is over-removal**, and most of the AC below exists to pin what must
survive.

Facts raised before the decision and recorded so they are not re-derived:
Indonesia is stricter on gambling than the UK (criminal under Art. 303 KUHP,
with active Kominfo blocking), jurisdiction generally follows the user rather
than the company, and store Families policy is contractual and global. Full
context in `[[project-indonesia-relocation-and-age-gating-decision]]`. The
operator reaffirmed the decision after these were raised; this story implements
it.

## Acceptance Criteria

### Happy path

- [ ] A user can open and use gacha without being asked to verify their age.
- [ ] The age-verification screen is no longer reachable from the gacha flow.
- [ ] No user-facing reference to age verification remains in the gacha flow, in any of the 20 locales.

### Error paths

- [ ] A user who had previously started age verification is not left in a stuck or partial state after the change.
- [ ] A user who had previously *completed* age verification is unaffected — their stored data is handled per the data decision recorded in Notes, not silently orphaned.
- [ ] Any API endpoint that existed only to serve the gacha age gate returns a clean `404`, not a `500`.

### Edge cases

- [ ] **Cohort segregation is untouched.** A minor and an adult still cannot share a voice room, asserted end-to-end on two real accounts.
- [ ] **The cohort gate remains a sealed screen** (SHY-0311) and remains server-enforced (`requireSameCohort`).
- [ ] Date-of-birth collection, if it serves cohort assignment rather than gacha gating, is retained — cohort assignment must keep working.
- [ ] The admin age-verification review surface is removed only if it served exclusively the gacha gate; if it also serves cohort disputes, it is retained.
- [ ] Removing the gate does not change which cohort any existing user is in.

### Performance

- [ ] Removing the gate does not slow any remaining flow; gacha entry is measurably no slower on a real device.

### Security

- [ ] `requireSameCohort` call sites are unchanged in number and behaviour, asserted by count and by test.
- [ ] Ban, suspension and App-Lock enforcement are unchanged, asserted.
- [ ] No endpoint loses an authorization check as a side effect of this removal — every touched route is re-asserted for its remaining guards.
- [ ] Any stored age-verification personal data is handled per an explicit, recorded decision (retain / export-then-delete), not left in place by default. Deletion, if chosen, is operator-gated per the precedent in SHY-0145.

### UX

- [ ] The gacha flow has no leftover dead step, empty screen or orphaned back-navigation.
- [ ] Screenshots of the gacha flow before and after, on real Android and real iPhone at every viewport, reviewed by eye.
- [ ] No user is shown a message about a feature that no longer exists.

### i18n

- [ ] Strings used only by the removed gate are deleted from all 20 locale files.
- [ ] Strings shared with cohort segregation or any surviving flow are retained — asserted per string, since deleting a shared string is the likeliest collateral damage.
- [ ] The gacha flow renders correctly in all 20 locales after removal, asserted on rendered text.

### Observability

- [ ] Removal of the gate is recorded with the operator decision and its date, so the reasoning is discoverable from the code's history.
- [ ] Any metric or log line that referenced the gacha age gate is removed rather than left emitting a permanently-zero series.

## BDD Scenarios

**Scenario: Gacha no longer asks for age**

- **Given** a signed-in user who has never verified their age
- **When** they open gacha
- **Then** they can use it without being asked to verify their age

**Scenario: Minors and adults are still kept apart**

- **Given** a minor and an adult
- **When** the minor tries to join a room the adult is in
- **Then** they are not allowed to join

**Scenario: A user who already verified is not disrupted**

- **Given** a user who verified their age before the change
- **When** they open the app
- **Then** everything works normally for them

**Scenario: Nobody changes age group because of this**

- **Given** users assigned to their age groups before the change
- **When** the change is applied
- **Then** every user remains in the same age group

## Test Plan

**RED first.** The tests that matter most here are the ones asserting what
**survives**, because over-removal is the real risk.

### Kotlin unit (`shared/src/commonTest/`)

- `gacha entry requires no age verification`
- `the gacha flow has no unreachable step after removal`
- `cohort assignment still resolves for a user with a stored date of birth`

### Kotlin unit — survival assertions (the important half)

- `cohort segregation still refuses a cross-cohort room join`
- `the cohort gate is still a sealed screen`
- `App-Lock enforcement is unchanged`
- `ban enforcement is unchanged`

### Node / Jest (`express-api/tests/`)

- `requireSameCohort call-site count is unchanged` (pinned at 23)
- `every route touched by this change retains its remaining guards`
- `endpoints serving only the gacha age gate return 404`
- `no route lost an authorization check`

### Android instrumented BDD

- Update `age_verification.feature` and `gacha.feature` to reflect the removal,
  keeping every cohort-segregation scenario intact and passing.

### Device, REAL Android + REAL iPhone

- Gacha opened without an age prompt on both devices.
- **Cross-cohort room join refused, on two real accounts** — this is the
  survival proof and cannot be delegated to a unit test.
- Screenshots of the gacha flow at every viewport, before and after.
- All 20 locales verified on rendered text in the gacha flow.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| a `requireSameCohort` call site removed | `requireSameCohort call-site count is unchanged` |
| the cohort gate removed from the sealed set | `the cohort gate is still a sealed screen` |
| cross-cohort room join permitted | `cohort segregation still refuses a cross-cohort room join` |
| a shared locale string deleted along with the gate's own | the per-string retention assertions |
| date-of-birth collection removed entirely | `cohort assignment still resolves for a user with a stored date of birth` |

Every one of these mutations is an over-removal. That is deliberate: this story's
failure mode is not doing too little.

## Out of Scope

- **Removing cohort segregation.** Explicitly retained by operator decision.
- Removing ban enforcement, App-Lock, or the unsafe-device gate.
- Changing gacha's mechanics, odds, or odds disclosure. Store policy requires
  loot-box odds disclosure regardless of whether it is legally gambling, and that
  is untouched here.
- Geo-blocking or distribution changes.
- The bean-transfer-for-a-fee feature, which is the item most likely to change
  the gambling analysis and is tracked separately in
  `[[project-shytalk-bean-transfer-for-a-fee]]`.

## Dependencies

- `.project/plans/2026-05-03-age-verification.md` and
  `.project/plans/2026-05-13-age-segregation-design.md` — read both before
  starting, to establish which mechanism owns which code.
- **SHY-0143's spec is stale after SHY-0187** — re-validate before assuming
  anything about the current cold-start ban/age path.
- Independent of EPIC-0011, though it removes a screen the sealed set would
  otherwise have had to cover.
- **Operator decision required** on the stored age-verification personal data:
  retain, or export-then-delete. Blocking only for the data step; the code
  removal proceeds either way.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| **Over-removal takes cohort segregation with it** — the primary risk | Most of the AC and every mutation in the table assert what survives. Cross-cohort refusal is proven on two real accounts on real devices, not in a unit test. |
| A shared locale string is deleted with the gate's own strings | Per-string retention assertions across all 20 locales. |
| Date-of-birth collection is removed, breaking cohort assignment | Explicit AC and mutation: cohort assignment must still resolve. |
| An endpoint loses an unrelated authorization check during cleanup | Every touched route is re-asserted for its remaining guards. |
| Personal data is left orphaned in the datastore | Explicit Security AC requiring a recorded decision; deletion is operator-gated per the SHY-0145 precedent. |
| The legal reasoning turns out to be wrong for Indonesia | Out of this story's control and recorded, not re-litigated: the facts raised are in `[[project-indonesia-relocation-and-age-gating-decision]]` and the operator reaffirmed the decision. A reversal would be a new story. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] **Cross-cohort room join proven refused on two real accounts, on a real Android device and a real iPhone.**
- [ ] Gacha opened with no age prompt on both real devices.
- [ ] `requireSameCohort` call-site count unchanged at 23.
- [ ] All 20 locales verified on rendered text; no shared string deleted.
- [ ] The stored-data decision is recorded in Notes, and executed if deletion was chosen.
- [ ] Screenshots at every viewport before and after, reviewed by eye.
- [ ] Full protocol gauntlet green, then DEV green.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Operator decision: remove the gacha age-verification gate, keep cohort segregation. Reasoning: gacha awards no cash-out value, so the gambling-age rationale does not apply. The business is also relocating from the UK to Indonesia.
- **2026-08-17** — Facts raised before the decision, recorded so they are not re-derived: Indonesia is stricter on gambling than the UK (criminal under Art. 303 KUHP, active Kominfo blocking of gambling apps); jurisdiction generally follows the user rather than the company (UK OSA applies to services with UK users, GDPR to EU users, COPPA to US under-13s); store Families policy is contractual and global, triggering on whether children are likely in the audience. Operator reaffirmed after these were raised. Full context in `[[project-indonesia-relocation-and-age-gating-decision]]`.
- **2026-08-17** — Scope drawn deliberately narrow. Age verification and cohort segregation are separate mechanisms; the no-cash-out argument reaches the first and not the second. Over-removal is this story's primary risk and the mutation table is built entirely from over-removals.
