---
id: SHY-0253
status: In Progress
owner: claude
created: 2026-07-29
priority: P0
effort: XS
type: bug
roadmap_ids: []
epic: EPIC-0008
---

# SHY-0253: Every vote on the public roadmap returns 500

## User Story

**As a** person who wants to back an idea on the public roadmap
**I want** my vote to register when I press the arrow
**So that** the board reflects what people actually want instead of silently discarding every vote.

## Why

Surfaced 2026-07-29 while unparking the vote-indicator test under SHY-0245.

`POST /suggestions/:id/vote` ran its transaction with a **path string** where
Firestore requires a `DocumentReference`:

```js
const sugRef = db.doc(`suggestions/${id}`);
const sugDoc = await t.get(`suggestions/${id}`);   // <- string, not sugRef
```

`Transaction.get` throws on a string. The throw happened *inside* the
transaction, so the route's catch fell through to
`{"error":"Internal server error"}` — a bare 500 naming nothing. The reference
it needed was built on the line directly above and never used. The same defect
appeared twice, the second time for the voter's own vote document.

**Voting has therefore never worked.** Every arrow press on the public
suggestions board returned 500 and the vote was discarded.

A second defect sat behind it: the endpoint answered `{ success: true }` with no
counts, while the client updates the card straight from that response
(`state.suggestions[i].score = data.score`, suggestions-board.js). `data.score`
was `undefined`, and `var score = s.score != null ? s.score : 0` then rendered
the card as **0** — so on the first vote that did not 500, the score would have
visibly reset to zero.

Nothing caught either because no test ever voted through the real endpoint: the
web specs route-mocked `/vote`, and the board's own vote tests ran signed out,
where the click only opens the login modal.

## Acceptance Criteria

### Happy path

- [ ] An upvote returns 200 and the suggestion's `upvotes` increases by one.
- [ ] A downvote returns 200 and `downvotes` increases by one.
- [ ] The response carries `upvotes`, `downvotes` and `score` so the card can update in place without a refetch.
- [ ] The vote document is written under the voter's id.

### Error paths

- [ ] Voting on a non-votable status is refused with its own 4xx, never a 500.
- [ ] Voting on a suggestion that does not exist is a 404, never a 500.
- [ ] A duplicate vote in the same direction is refused with its own status.
- [ ] The creator voting on their own suggestion is refused with its own status.

### Edge cases

- [ ] Toggling up→down adjusts BOTH counters and the returned tally matches what was stored.
- [ ] A suggestion whose `upvotes`/`downvotes` are absent is treated as zero rather than NaN.

### Performance

- [ ] The tally is computed from the snapshot already read inside the transaction — no extra read.

### Security

- [ ] The endpoint still requires auth and refuses a suspended account.
- [ ] The returned tally exposes only counts already public on the board.

### UX

- [ ] After voting, the card shows the new score immediately and does not flash 0.

### i18n

- [ ] N/A — no user-facing strings change; the failure toast already reads from `sgT`.

### Observability

- [ ] A transaction failure no longer presents as an unexplained 500 for the ordinary path; classified refusals keep their own statuses.

## BDD Scenarios

**Scenario: an upvote registers**
- **Given** I am signed in and looking at an accepted suggestion with one upvote
- **When** I press the up arrow
- **Then** the request succeeds
- **And** the suggestion has two upvotes

**Scenario: the card shows the new score straight away**
- **Given** I have just voted
- **When** the card re-renders from the response
- **Then** it shows the new score rather than 0

**Scenario: a refusal is classified, not a 500**
- **Given** a completed suggestion, which cannot be voted on
- **When** I try to vote
- **Then** I get that rule's own 4xx status, not an internal error

**Scenario: voting on a missing suggestion**
- **Given** a suggestion id that does not exist
- **When** I vote on it
- **Then** the response is 404

## Test Plan

**RED first** — `express-api/tests/routes/suggestions-vote-transaction.test.js`
(new, real emulator, real Auth tokens):

- `an upvote succeeds and is reflected in the score`
- `the vote is persisted under the voter, not just returned`
- `a downvote succeeds too`
- `a non-votable status is REFUSED with its own status, not a 500`
- `voting on a suggestion that does not exist is a 404, not a 500`

Plus `tests/web/suggestions-board.spec.ts` →
`Suggestions Board — Vote indicator (real API)`, which votes as a real signed-in
user through the real endpoint and asserts the response status explicitly.

**GREEN:** pass `sugRef` / `voteRef` to `t.get`, and return the post-commit
tally computed from the read snapshot plus the applied deltas.

**Mutation checks:** restoring either path string must fail the suite; dropping
the tally from the response must fail the score assertions. All three verified.

## Out of Scope

- The vote-reason modal (`vote reason: optional modal appears`) — still unbuilt, tracked under SHY-0247.
- Rate-limiting or abuse controls on voting.

## Dependencies

- None. The fix is local to the vote route.

## Risks & Mitigations

- **Risk:** the returned tally could drift from the stored value if a concurrent vote commits between read and response.
  **Mitigation:** both come from the same transaction's snapshot plus its own deltas, so the response describes exactly the transaction that committed; the next list fetch is authoritative either way.
- **Risk:** other transactions in the codebase share the string-path mistake.
  **Mitigation:** swept — `t.get(` with a template-literal path appears nowhere else in `express-api/src`.

## Definition of Done

- [ ] RED tests written first and observed failing.
- [ ] Voting returns 200 and persists.
- [ ] Response carries the tally; the card no longer flashes 0.
- [ ] Mutations killed.
- [ ] `cd express-api && npm test` green.
- [ ] `npx playwright test` green on chromium.
- [ ] LOCAL gauntlet green on real Android + real iPhone + all browsers.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-29 — Found by rewriting a parked test to vote as a REAL signed-in user through the REAL endpoint. Every previous version of that test either mocked `/vote` or ran signed out, so the 500 was invisible to the entire suite.
