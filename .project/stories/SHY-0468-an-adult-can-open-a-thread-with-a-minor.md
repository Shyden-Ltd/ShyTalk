---
id: SHY-0468
status: Done
owner: unassigned
created: 2026-08-26
priority: P0
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0005
released_in: v0.99.0
---

# SHY-0468: An adult can open a direct-message thread with a minor

## User Story

As **a minor on ShyTalk**, I want an adult to be unable to open a private
thread with me, so that the cohort wall that exists for my safety actually
holds on the endpoint that creates threads.

## Why

`POST /api/conversations` carries a server-side cohort gate. It never fires.

```js
const callerCohort = req.auth.cohort;
if (callerCohort && other.cohort && String(other.cohort) !== String(callerCohort)) {
```

`authMiddleware` sets `req.auth = { uid, uniqueId, token: decoded }`. There is
no `cohort` on it — the claim lives at `req.auth.token.cohort`. So
`callerCohort` is `undefined`, the `&&` short-circuits, and **every caller
passes the gate**.

Proven against the real Auth emulator and the real middleware chain, adult
caller to minor target:

```
POST /api/conversations   adult -> minor
  status          : 200          (expected 404)
  body.id         : 64209001_64209002
  stored document : {"participantIds":["64209001","64209002"],"isGroup":false,
                     "crossCohortAtMigration":false, ...}
  VERDICT         : CROSS-COHORT THREAD CREATED
```

The thread is not merely permitted, it is written — with
`crossCohortAtMigration: false`, so the migration filter that hides legacy
cross-cohort threads ([[SHY-0132]]) will not hide this one either. It is a
brand-new, fully legitimate-looking adult↔minor thread.

### Why nothing caught it

The suite that covers this endpoint mocked the gate away:

```js
jest.mock('../../src/middleware/sameCohort', () => ({
  requireSameCohort: () => (req, res, next) => next(),
}));
```

and hand-built `req.auth = { uniqueId, cohort: 'adult' }` — supplying the very
field production does not have. The test asserted a 404 that the double
produced, while the code path that must produce it was switched off. It passed
for exactly as long as it was fiction.

Found on 2026-08-26 while migrating that suite to the real stack under the
no-new-stubs ratchet (EPIC-0003). The migration was a policy chore; it turned
up a P0.

### Scope of the class

Swept: `req.auth.cohort` is read in exactly ONE place in the codebase, this
one. Every other cohort decision already uses the defensive resolvers —
`cohortFromClaim(req)` in `sameCohort.js`, `config.js` and `livekit.js`, and
`effectiveCohort(userData)` for the target. Both fall back to `'minor'` rather
than to "unknown", so a stripped claim restricts the caller instead of freeing
them. This site simply never adopted them.

Note the second half of the same condition: `other.cohort &&` means a target
whose `cohort` field is missing ALSO skips the gate. `effectiveCohort` closes
that half, and honours an admin `cohortOverride` the raw field ignores.

## Acceptance Criteria

### Happy path

- [ ] An adult opening a thread with another adult still succeeds.
- [ ] A minor opening a thread with another minor still succeeds.

### Error paths

- [ ] An adult opening a thread with a minor is refused, and no conversation
      document is written.
- [ ] A minor opening a thread with an adult is refused, in that direction too.

### Edge cases

- [ ] A caller whose token carries no cohort claim is treated as a minor, not
      as unrestricted.
- [ ] A target whose user document has no `cohort` field is treated as a minor.
- [ ] An admin `cohortOverride` on the target is honoured over the raw field.

### Performance

- [ ] No additional read: the caller's cohort comes from the token already
      decoded, and the target document is already fetched.

### Security

- [ ] The refusal stays a 404 with the same body as "user not found", so a
      probe cannot tell a blocked cohort from a missing account.
- [ ] The refusal is audited the way other segregation refusals are, so a
      pattern of attempts is visible to moderators.

### UX

- [ ] Unchanged for legitimate users: same success, same wording on refusal.

### i18n

- [ ] None: server response, already handled by the client's existing copy.

### Observability

- [ ] The refusal logs both cohorts, so a wrong verdict is diagnosable without
      reproducing it.

## BDD Scenarios

**Scenario: An adult tries to message a minor**

- **Given** an adult and a minor who have never messaged
- **When** the adult tries to open a chat with the minor
- **Then** it is refused, and no thread exists afterwards

**Scenario: Two adults message normally**

- **Given** two adults
- **When** one opens a chat with the other
- **Then** the thread is created as before

## Test Plan

| Layer | What it proves |
| --- | --- |
| Route (real stack) | Adult→minor is refused and writes nothing; adult→adult still works. Real token, real middleware — no double may stand in for the gate. |
| Route (real stack) | A token with no cohort claim is treated as a minor. |
| Route (real stack) | A target with no `cohort` field is treated as a minor. |
| Mutation | Reverting the resolver to `req.auth.cohort` must turn the refusal test red. A gate test that passes against the broken code is the defect this ticket exists to end. |

## Out of Scope

- The read/messaging path on an EXISTING thread, which already routes through
  `requireSameCohort` and is not affected.
- Migrating the rest of the mocked suites — that is the EPIC-0003 ratchet work
  this was found under.

## Dependencies

- [[SHY-0132]] — the cross-cohort thread leak whose migration filter does not
  cover threads created new by this defect.
- [[SHY-0467]] — the sibling gap: nothing asserts the shape a new conversation
  is stored in.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Failing closed to `minor` locks out adults whose claim is missing | That is the deliberate posture of the three existing call sites, and the claim is set at sign-in. An adult with no claim is already restricted everywhere else. |
| Existing cross-cohort threads created by this defect stay in the data | None can exist — the endpoint is unreleased. Verified against `main` and `develop`, not assumed. |
| The fix is asserted by a test that mocks the gate again | The test plan requires the real middleware chain, and a mutation check. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The probe that produced the evidence above returns `refused`.
- [ ] Landed on the SHY-0458 branch BEFORE that story merges, so the endpoint
      never reaches `develop` with the gate open.

## Notes

- Filed 2026-08-26. P0 by the standing rule that any defect of this class is
  P0 regardless of triviality — a safeguarding wall that reports itself as
  present and is not, on a product with a minor cohort.
- **It has never shipped, and exposure is zero.** `POST /api/conversations`
  exists in neither `main` nor `develop`; it lives only on the unmerged
  SHY-0458 branch. This is a defect caught before release, not an incident.
  That is also why the fix belongs on that branch: the story that introduces
  the endpoint should introduce it correctly.
- No data sweep is needed, because no such thread can exist. That was checked
  rather than assumed: the route is absent from both released branches.
