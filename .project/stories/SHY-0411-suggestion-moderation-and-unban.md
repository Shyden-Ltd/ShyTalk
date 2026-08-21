---
id: SHY-0411
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0411: The suggestion dispute process, and the way back from a ban

## User Story

As **somebody whose suggestion was moderated, or whose ban was lifted**, I want
the way back to have been walked, so that a decision made about me can be undone
when it should be.

## Why

**Suggestions have a whole moderation sub-system nobody walks.** Beyond the
`roadmap_auth` coverage of signing in and browsing, `routes/suggestions.js` has
32 endpoints including comments, tags, merge, and a **dispute process** —
`POST /admin/suggestions/:id/dispute`, `…/dispute/uphold`, `…/dispute/reject`,
and a `GET /admin/suggestions/disputes` queue.

An appeals process is exactly the kind of thing that must work on the day
somebody needs it, and there is no scenario in 610 that raises a dispute, upholds
one, or rejects one.

**Unban has no scenario either.** `POST /admin/bans/unban-all/:uniqueId`. Banning
is covered thoroughly — `moderation`, `j11`, `j12` all walk bans and
suspensions — and lifting a ban has nothing. It is the same shape as unblock,
which this audit already found: **the punishing direction is walked and the
forgiving direction is not.** That asymmetry matters because a wrongly banned
person is exactly who cannot tell us the unban is broken.

## Acceptance Criteria

### Happy path

- [ ] Somebody comments on a suggestion and others see it.
- [ ] An admin raises a dispute on a suggestion and it appears in the dispute
      queue.
- [ ] Upholding a dispute has the stated effect on the suggestion.
- [ ] Rejecting a dispute has the stated effect.
- [ ] Merging two suggestions keeps the votes and the authorship of both.
- [ ] An admin lifts a ban and the person can use the app again.

### Error paths

- [ ] Disputing the same suggestion twice does not create two disputes.
- [ ] Resolving an already-resolved dispute is refused.
- [ ] Merging a suggestion into itself is refused.
- [ ] Unbanning somebody who is not banned is harmless.

### Edge cases

- [ ] A comment on a merged suggestion is still reachable afterwards.
- [ ] A dispute on a suggestion that is deleted mid-process.
- [ ] A ban lifted while the person has the app open — access returns without a
      reinstall, matching the suspension behaviour `suspension_enforcement`
      already proves.
- [ ] Somebody banned on several axes at once — lifting all of them really lifts
      all of them, since the endpoint is `unban-all`.

### Performance

- [ ] The dispute queue loads within the same budget as the other admin queues.

### Security

- [ ] A non-admin cannot raise, uphold or reject a dispute — three refusals.
- [ ] A non-admin cannot merge suggestions.
- [ ] A non-admin cannot unban anybody.
- [ ] A comment cannot be posted as somebody else.

### UX

- [ ] Somebody whose suggestion was disputed can tell what happened to it.

### i18n

- [ ] Dispute outcomes and comments render per locale where user-facing.

### Observability

- [ ] Every dispute decision and every unban is auditable with who and when.

## BDD Scenarios

**Scenario: A dispute reaches the queue**

- **Given** an admin who has disputed a suggestion
- **When** another admin opens the dispute queue
- **Then** the dispute is there

**Scenario: Upholding a dispute**

- **Given** a suggestion with an open dispute
- **When** an admin upholds it
- **Then** the suggestion reflects that outcome

**Scenario: A dispute cannot be resolved twice**

- **Given** a dispute that has already been resolved
- **When** an admin tries to resolve it again
- **Then** they are refused

**Scenario: Merging keeps both sets of votes**

- **Given** two suggestions with votes on each
- **When** an admin merges them
- **Then** the surviving suggestion carries both sets of votes

**Scenario: A lifted ban gives the app back**

- **Given** somebody who was banned and has just been unbanned
- **When** they open the app
- **Then** they can use it again

**Scenario: Only admins can lift a ban**

- **Given** somebody who is not an admin
- **When** they try to unban another member
- **Then** they are refused

## Test Plan

| Layer | What it proves |
| --- | --- |
| Journey | The dispute lifecycle end to end, and an unban asserted from the UNBANNED PERSON's device — the only place it matters. |
| State | Merge asserted on the surviving suggestion's votes and authorship, not on a 200. |
| Idempotency | Double dispute, double resolve, and unban-when-not-banned each asserted. |
| Security | Six separate non-admin refusals across dispute, merge and unban. |
| Live effect | A ban lifted while the app is open restores access without a relaunch, as suspension already does. |

## Out of Scope

- Changing the dispute process or ban semantics.

## Dependencies

- Two admin personas, so "another admin sees it" is a real assertion rather than
  the same person looking twice.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The forgiving direction stays untested because the punishing one passes | Unban and dispute-reject are each required, mirroring the ban and uphold cases. |
| Merge is asserted on the API response | Asserted on the surviving suggestion's votes and authorship. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The unban walked on a real device by the person who was banned.

## Notes

- Found 2026-08-21 in the third audit pass. The pattern worth remembering: the
  punishing direction is always walked and the forgiving one often is not —
  unblock, unban, dispute-reject, cancel. Somebody wrongly punished is the
  person least able to report that the way back is broken.
