---
id: SHY-0247
status: Draft
owner: claude
created: 2026-07-28
priority: P2
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0008
---

# SHY-0247: Build the roadmap-board features the tests describe but the product never had

## User Story

**As a** person using the public suggestions board
**I want** the actions the interface implies — reviewing my own submissions, withdrawing one,
explaining a vote, and being told plainly when a list is empty
**So that** the board is complete rather than a set of half-referenced ideas that exist only in a test file.

## Why

Surfaced 2026-07-28 while de-sleeping `tests/web/suggestions-board.spec.ts` under SHY-0245.
A cluster of tests referenced `data-testid`s that appear NOWHERE in `public/` — they
guarded their bodies on `if (x.count() > 0)`, which was permanently false, so they ran
nothing and reported green. Removing the guard is not enough: there is nothing to assert
against, because the feature does not exist.

Confirmed absent from the whole of `public/` (not just `suggestions-board.js`):

| testid | feature it implies |
| --- | --- |
| `my-suggestions` | a "my submissions" view |
| `withdraw-suggestion-btn` | withdrawing your own suggestion |
| `edit-suggestion-btn` | editing your own suggestion |
| `re-review-warning` | warning that an edit sends it back for review |
| `vote-reason-modal`, `reason-public`, `reason-private`, `reason-submit` | optionally explaining a vote, publicly or privately |
| `your-vote-indicator` | showing which way you voted on a card |
| `decline-reason` | surfacing why a suggestion was declined |
| `no-comments`, `no-features` | explicit empty states |

`duplicate-load-more` was ALSO in this set but is deliberately excluded: the panel caps at
`Math.min(suggestions.length, 3)` (`suggestions-board.js:907`) and the lookup asks the
server for `&limit=3` (`:456`), so a Load-more would contradict a deliberate design. Those
two tests were deleted under SHY-0245 and replaced with a test of the cap.

Each item below needs a product decision before it can be built, which is why this is its
own story rather than a quiet addition to the de-sleeping work.

## Acceptance Criteria

### Happy path

- [ ] A signed-in person can see a list of their own suggestions with each one's current status.
- [ ] A person can withdraw their own suggestion while it is still pending, and it disappears from the public board.
- [ ] A person can edit their own pending suggestion, and is told plainly that editing sends it back for review.
- [ ] A person can optionally add a short reason when voting, and choose whether that reason is visible to others.
- [ ] A card shows which way the viewer voted, without having to remember.
- [ ] A declined suggestion shows the reason it was declined, where a reason was given.

### Error paths

- [ ] Withdrawing a suggestion that is no longer pending is refused with a plain explanation, not a silent no-op.
- [ ] Editing a suggestion someone else submitted is refused server-side, regardless of what the interface offers.
- [ ] A failed withdraw/edit leaves the suggestion exactly as it was and says so.
- [ ] A vote reason that exceeds the allowed length is refused before submission, with the limit shown.

### Edge cases

- [ ] An empty "my suggestions" list shows a plain empty state, not a blank panel.
- [ ] A suggestion with no comments shows an explicit "no comments yet" state.
- [ ] Withdrawing a suggestion that others have voted on preserves the audit record.
- [ ] A vote reason left blank submits the vote with no reason attached.
- [ ] Changing a vote replaces any previous reason rather than accumulating them.

### Performance

- [ ] The "my suggestions" list is fetched with a server-side filter on the submitter, never a client-side scan of all suggestions.
- [ ] Vote reasons add no extra round-trip to the existing vote request.

### Security

- [ ] Withdraw and edit are authorised server-side against the submitter, never trusted from the client.
- [ ] A PRIVATE vote reason is never returned to any other user by any endpoint, including admin list views that are not explicitly moderation surfaces.
- [ ] A decline reason never exposes moderator identity.

### UX

- [ ] Every new control states its consequence before acting (withdraw is destructive; editing re-opens review).
- [ ] Empty states explain what to do next, not merely that a list is empty.
- [ ] Works at the smallest supported viewport first, per the mobile-first rule.

### i18n

- [ ] Every new user-facing string ships in all four supported locales (en, zh, id, vi) per SHY-0194, reusing the existing board translation mechanism rather than adding a parallel one.

### Observability

- [ ] Withdraw and edit each emit one structured log line with the suggestion id and actor.
- [ ] A refused withdraw/edit logs the reason, so "nothing happened" is never silent.

## BDD Scenarios

**Scenario: withdrawing my own pending suggestion**
- **Given** I submitted a suggestion that is still pending
- **When** I withdraw it
- **Then** it no longer appears on the public board
- **And** I am told it was withdrawn

**Scenario: editing sends a suggestion back for review**
- **Given** I submitted a suggestion that has already been accepted
- **When** I edit it
- **Then** I am warned that editing returns it to review before I confirm
- **And** its status returns to pending once I do

**Scenario: a private vote reason stays private**
- **Given** I voted and added a reason marked private
- **When** another person views that suggestion
- **Then** they see my vote counted
- **And** they do not see my reason

**Scenario: an empty list explains itself**
- **Given** I have never submitted a suggestion
- **When** I open my submissions
- **Then** I see a plain explanation and a way to submit one
- **And** not a blank panel

## Test Plan

### Red (must fail first)

- `tests/web/suggestions-board.spec.ts` — the currently-parked tests, unskipped one feature at a time.
- Server-side authorisation tests in `express-api/tests/routes/` for withdraw and edit, asserting refusal for a non-submitter.

### Green

- Build each feature behind the testids above so the parked tests can be unskipped as they land.

### Mutation proof

- Remove the submitter check on withdraw → the authorisation test must fail.
- Return a private reason from the list endpoint → the privacy test must fail.
- Drop the re-review transition on edit → the status test must fail.

## Out of Scope

- `duplicate-load-more` — contradicts the deliberate 3-match cap; see Why.
- Any change to how votes are counted or scored.
- Admin-side moderation surfaces for vote reasons.

## Dependencies

- None blocking. Shares `tests/web/suggestions-board.spec.ts` with SHY-0245, so it is sequenced after it.

## Risks & Mitigations

- **Risk:** vote reasons become an abuse surface. **Mitigation:** length-capped, and private by default is a product decision to settle before build — flagged in the AC rather than assumed.
- **Risk:** withdraw destroys audit history. **Mitigation:** withdrawal is a status transition, never a delete; covered by an edge-case AC.
- **Risk:** building to satisfy stale test names rather than user need. **Mitigation:** `duplicate-load-more` was already excluded on exactly this basis; each item here was re-justified from the user's point of view, not from the test file.

## Definition of Done

- All AC boxes ticked; every BDD scenario has a named test.
- Every parked test in `suggestions-board.spec.ts` that names one of these features is unskipped and passing.
- Reviewer 100% clean; CI green by name; journey matrix per the pre-merge protocol.

## Notes (running log)

- **2026-07-28** — Filed from SHY-0245 de-sleeping. The tests were not merely unasserted; the
  features are absent from all of `public/`. Parked as `test.skip` so they stop reporting
  green, with each skip pointing here.
