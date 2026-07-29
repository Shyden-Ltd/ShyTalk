---
id: SHY-0250
status: In Progress
owner: claude
created: 2026-07-29
priority: P1
effort: S
type: bug
roadmap_ids: []
epic: EPIC-0008
---

# SHY-0250: Comments posted on the suggestions board never appear

## User Story

**As a** person commenting on a suggestion on the public roadmap board
**I want** my comment to show up in the comment list after I post it
**So that** I can see that I was heard, and other people can read and reply to what I said.

## Why

Surfaced 2026-07-29 while eradicating silently-passing tests under SHY-0245.

Comments on the public suggestions board are **write-only**. A comment is accepted,
stored in Firestore, and then never rendered — for the author or for anyone else.

The chain, each link verified against the running local stack:

1. `renderCommentSection(suggestion)` (`public/js/suggestions-board.js:1156`) reads
   `suggestion.comments || []`.
2. The board only ever populates cards from the LIST endpoint, `GET /api/suggestions`.
3. That endpoint responds `{ suggestions: paged, total, page, pageSize }`
   (`express-api/src/routes/suggestions.js`). `paged` holds raw `suggestions`
   documents — comments live in the `suggestions/{id}/comments` SUBCOLLECTION and
   are never loaded, so **no list item has a `comments` key at all**.
4. Only `GET /api/suggestions/:id` loads them (lines 262-286) — and the board
   never calls it.
5. The comment-submit handler posts, then calls `fetchSuggestions()` — the LIST
   endpoint — to refresh. So the refresh that is supposed to reveal the new
   comment is precisely the call that cannot carry it.

Proven empirically against the local emulator (seeded suggestion + subcollection
comment):

```
=== LIST endpoint ===   found: true | has comments key? false | comments: undefined
=== SINGLE endpoint === has comments key? true
```

Nothing caught it because the only test covering the flow asserted
`expect(await comments.count()).toBeGreaterThanOrEqual(0)` — true of every list,
including an empty one — inside a describe block that route-mocked
`**/api/suggestions/*/comments` to `{comments: [], total: 0}` for every method and
never signed in, so `requireAuth("post comments")` returned early on every click.
The test could not fail in three independent ways at once.

## Acceptance Criteria

### Happy path

- [ ] `GET /api/suggestions` returns a `comments` array on every ACCEPTED suggestion in the page.
- [ ] A comment posted via `POST /api/suggestions/:id/comments` is visible in the board's comment list after the subsequent `fetchSuggestions()` refresh, with no page reload.
- [ ] The comment is still there after a full page reload (it was persisted, not merely painted).
- [ ] `commentCount` accompanies `comments` on list items, matching the single-suggestion endpoint's field name.

### Error paths

- [ ] If loading comments for one suggestion fails, that suggestion is still returned with `comments: []` — one bad subcollection read must not 500 the whole board.
- [ ] A failure to load comments is logged at warn with the suggestion id.

### Edge cases

- [ ] Non-accepted suggestions (pending / planned / completed / rejected) carry `comments: []` — `renderCommentSection` returns `''` for them, so loading their comments would be pure waste.
- [ ] A suggestion with zero comments returns `comments: []`, never `undefined`, so `suggestion.comments || []` is never load-bearing.
- [ ] An empty page (no suggestions) returns without issuing any subcollection read.

### Performance

- [ ] Comment loading is issued concurrently across the page, not sequentially.
- [ ] Only ACCEPTED suggestions on the CURRENT page trigger a read — bounded by `MAX_PAGE_SIZE` (50), and in practice far below it.
- [ ] The list endpoint's added latency is proportional to one round of concurrent reads, not to the number of suggestions in the corpus.

### Security

- [ ] Non-public comments (`isPublic === false`) are withheld from non-admin callers, matching `GET /api/suggestions/:id` exactly — the list must not become a hole through which private comments leak.
- [ ] An admin caller sees non-public comments in the list, as they do on the single endpoint.
- [ ] The doc-ref id wins over any `id` field inside stored comment data (same defence-in-depth spread order used elsewhere in this file).

### UX

- [ ] After posting, the comment appears without the user needing to reload or navigate.
- [ ] Existing comments are visible on an accepted card as soon as the board renders.

### i18n

- [ ] N/A — no new user-facing strings; the comment list and its "no comments yet" empty state already exist and are already translated.

### Observability

- [ ] A failed per-suggestion comment load emits a warn log naming the suggestion id and the error message.

## BDD Scenarios

**Scenario: a posted comment appears without a reload**
- **Given** an accepted suggestion exists and I am signed in
- **When** I type a comment and press the post button
- **Then** my comment text appears in that suggestion's comment list
- **And** it is still there after I reload the page

**Scenario: the list endpoint carries comments**
- **Given** an accepted suggestion has one public comment
- **When** `GET /api/suggestions` returns that suggestion
- **Then** the returned item has a `comments` array containing that comment
- **And** it has a `commentCount` of 1

**Scenario: private comments do not leak through the list**
- **Given** an accepted suggestion has one comment with `isPublic: false`
- **When** a non-admin requests `GET /api/suggestions`
- **Then** that comment is absent from the returned `comments` array
- **And** an admin making the same request does receive it

**Scenario: a broken comment read does not take down the board**
- **Given** loading comments for one suggestion fails
- **When** `GET /api/suggestions` is served
- **Then** the response is still 200
- **And** that suggestion is present with `comments: []`
- **And** a warn log names the suggestion id

**Scenario: non-accepted suggestions cost no reads**
- **Given** a page containing only pending and planned suggestions
- **When** `GET /api/suggestions` is served
- **Then** every returned item has `comments: []`
- **And** no comment subcollection read was issued

## Test Plan

**RED first** (each must fail against current `main`):

- `express-api/tests/routes/suggestions-list-comments.test.js` (new, real emulator):
  - `list endpoint returns comments for an accepted suggestion`
  - `list endpoint returns commentCount alongside comments`
  - `non-public comments are withheld from a non-admin caller`
  - `an admin sees non-public comments in the list`
  - `non-accepted suggestions carry an empty comments array`
  - `a suggestion with no comments returns [] not undefined`
  - `a failing comment read yields comments: [] and a 200, not a 500`
- `tests/web/suggestions-board.spec.ts` → `Suggestions Board — Comment Flow (real API)`:
  - `submit comment: appears in comment list` (real user, real seeded suggestion, real endpoint)
  - `a comment survives a reload — it was persisted, not just painted`

**GREEN:** load comments for accepted suggestions in the list handler, concurrently,
with per-suggestion failure isolation, reusing the single-endpoint visibility filter.

**Mutation checks:** removing the `isPublic` filter must fail the private-comment
test; making the loads sequential must not change correctness but must be caught by
review; returning `undefined` instead of `[]` must fail the empty-comments test.

## Out of Scope

- Comment pagination on the board (the product renders one flat list; a paging UI is a separate feature — see the parked `comments 500: paginated correctly` test under SHY-0247).
- Comment editing, deletion, or moderation flows.
- Reply threading.
- Migrating this describe block's remaining route mocks to real services (tracked under EPIC-0003).

## Dependencies

- None. `GET /api/suggestions/:id` already implements the exact comment-loading and visibility-filtering logic to mirror.

## Risks & Mitigations

- **Risk:** N+1 subcollection reads inflate list latency and Firestore quota.
  **Mitigation:** only ACCEPTED suggestions on the CURRENT page are read, concurrently; `pageSize` is already clamped to `MAX_PAGE_SIZE` (50) by `validatePageParams`.
- **Risk:** private comments leak through the new field.
  **Mitigation:** reuse the single-endpoint filter verbatim (`isPublic !== false` for non-admins) and cover both directions with tests.
- **Risk:** one failing subcollection read 500s the whole board.
  **Mitigation:** per-suggestion isolation — a failed read degrades to `comments: []` plus a warn log, never a thrown error.

## Definition of Done

- [ ] All RED tests above written first and observed failing.
- [ ] List endpoint returns `comments` + `commentCount` for accepted suggestions.
- [ ] Private-comment visibility matches the single-suggestion endpoint in both directions.
- [ ] Per-suggestion failure isolation proven by test.
- [ ] `cd express-api && npm test` green.
- [ ] `npx playwright test` green on chromium, including the two new real-API comment tests.
- [ ] LOCAL gauntlet green on real Android + real iPhone + all browsers.
- [ ] `code-reviewer` 100% clean.
- [ ] Status flipped to `In Review` before merge.

## Notes

- 2026-07-29 — Found while driving `scripts/check-test-defects.js` to zero under SHY-0245. The tautological assertion (`count() >= 0`) is what let this survive; the detector now flags that shape.
- The board is the ONLY consumer of the list endpoint's comment data, and it renders comments solely for `status === 'accepted'` — hence the accepted-only optimisation is behaviour-preserving, not a shortcut.
