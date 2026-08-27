# Session handover — part 22

**2026-08-27, continuing.** Everything after the v0.99.0 release recorded in
[part 21](2026-08-27-session-handover-part21.md).

---

## Closing the release loop

**76 stories flipped `In Review` → `Done`**, `released_in: v0.99.0` (#2046).
"Done = release cut" is a HARD GLOBAL rule and **Claude's** responsibility, not
the operator's.

The rule's stated method needed adapting. It says to walk `--first-parent` squash
subjects — written when stories squash-merged straight to `main`. Under git-flow
the promotion is a **merge**, so `--first-parent` shows three commits and every
story squash sits on the second-parent side. Walked the full `v0.98.0..v0.99.0`
range instead, taking ids only from subjects ending `(#NNNN)`.

**18 stories named in released commits were deliberately left `Draft`.** A story
id appearing in a commit is not proof that story shipped. They are listed in
#2046 for the operator; several (SHY-0470, SHY-0471, SHY-0244) are clearly still
open work.

Board now: **175 Done**, 182 Draft, 35 In Review, 1 In Progress, 10 Cancelled.

---

## The most valuable finding of the day

Merging the promotion deleted `develop`. I diagnosed it, wrote it up, filed a
story — **and then found SHY-0296, filed 2026-08-13, same mechanism, same
recovery, already marked resolved.**

Its acceptance criterion was:

> **CLAUDE.md states** that a promotion PR is opened from a throwaway branch.

It was done — line 203, marked **HARD**. **SHY-0358 deleted CLAUDE.md on
2026-08-20**, by operator decision, for reasons having nothing to do with
promotions. The rule went with it. Six days later the same bug destroyed the same
branch.

**A fix whose only artefact is a line in a document has no failure mode, and dies
when the document does.**

So **SHY-0478** (#2047) ships a **check that fails**: a `pr-checks.yml` job,
gated on `github.base_ref == 'main'`, refusing any PR whose head is `develop`,
`main` or `master` — the hazard is head-branch *deletion*, not the name. A test
asserts the job still exists; deleting it fails 7 of 8 assertions.

**It would have refused #2033. That is correct.** The next promotion must cut
`promote/YYYY-MM-DD` from develop first.

Also fixed en route: I filed SHY-0478 **without checking for an existing
ticket** — my own standing rule. The near-duplicate is what surfaced the real
finding.

---

## EPIC-0003 — two slices of the SHY-0113 umbrella

SHY-0113 (P0, In Progress) is the Rooms/Voice/LiveKit migration off in-process
doubles. Three express files remained; two are now done.

### SHY-0479 — the cross-cohort gate (#2048)

The test that says **an adult cannot invite a minor into a room** replaced
Firestore with a `Map`. **28 doubles → 0.**

The FCM double, carved out in advance as unavoidable, turned out to be
**unnecessary**: the route only calls FCM when the invitee has `fcmTokens`, and
no test seeds any.

A collision the isolation guard caught **before it could happen**:
`livekit-cohort.test.js` cleared `segregationEvents` **wholesale**, justified by
*"ONLY this file touches it"* — true when written, false the moment this
migration started asserting its own audit rows. It now clears only its own id
range. **A shared collection may only be cleared of one's own rows.**

### SHY-0480 — the rooms write routes (#2050)

**94 doubles → 0**, and the count understated it: `db.doc()` ignored its path and
returned the same stub for every document, so no assertion could tell the room
from the invitee from the inviter.

Split rather than migrated. The FCM behaviours moved to
`rooms-fcm.unit.test.js` — the location the ratchet reserves for a genuinely
isolated collaborator. Migrating as one file would have kept it baselined forever
for a dozen tests that were never route tests.

**38 tests → 43.** Two behaviours gained coverage that never existed: the RTDB
room event read back, and the full stored shape of a seat request.

### Ratchet

**615 → 609 baselined paths.** `jest.mock` 179 → 177, `jest.fn` 209 → 207,
`mockResolvedValue` 187 → 185.

---

## Next

**`room-mutations.test.js` — 181 doubles, 1922 lines**, the umbrella's largest
remaining express file. Its decomposition names it as **two** slices:

- seat-claim / accept / leave / move (no RTDB-presence dependency)
- owner-away / close (RTDB presence — sequence against SHY-0103)

## Open, for the operator

- **SHY-0475** — room instrumentation tests fail on a real device, pass on the
  emulator. The product is fine; the harness is not.
- **SHY-0470 / SHY-0471 / SHY-0244** — Draft, awaiting decisions.
- **#1519** — the firebase-bom major bump, SHY-0471's subject. The only open PR.
- The 18 Drafts listed in #2046, if any of them did in fact ship.
