# Session handover — part 23

**2026-08-27 → 28.** Five EPIC-0003 slices against the SHY-0113 umbrella,
following the v0.99.0 release in [part 21](2026-08-27-session-handover-part21.md)
and the board sweep in [part 22](2026-08-27-session-handover-part22.md).

---

## What moved

`SHY-0113` (P0, In Progress) is the Rooms / Voice / LiveKit migration off
in-process doubles. Its three remaining express files carried **303 doubles** at
pickup. Two are now at zero and the third is down by more than half.

| Slice | What | Result |
|---|---|---|
| **SHY-0479** | the cross-cohort gate | 28 doubles → **0** |
| **SHY-0480** | the rooms write routes | 94 → **0**, FCM split to a `*.unit.test.js` |
| **SHY-0481** | seat lifecycle | extracted, 43 → 45 tests |
| **SHY-0482** | moderation (kick / mute / hosts) | extracted, 29 tests |
| **SHY-0483** | membership (join / leave / decline / first-join) | extracted, 26 → 27 |
| **SHY-0484** | settings (name / require-approval) | extracted, 19 → 20 |
| **SHY-0485** | closing a room | extracted, 17 tests |

`room-mutations.test.js`: **1922 → 503 lines, 181 → 78 doubles, 170 → 36 tests**
still on the fake. No-stubs baseline **615 → 609** paths. Express suite **525
suites / 15,663 tests**, green throughout.

---

## The point wasn't the count

The fake `runTransaction` called its callback **once**, with a fixed snapshot,
and recorded an update that was never applied. So routes whose entire purpose is
to resolve a race were tested by a harness with no concurrency in it, and every
`FieldValue` was a marker object nothing ever resolved.

**Every slice was mutation-tested.** Several now catch things the old harness
structurally could not express:

- **A real two-caller race for one seat.** `409 SEAT_TAKEN` used to be asserted
  against a stub that had been *told* the seat was taken.
- **Reintroducing SHY-0272** — self-mute routed back through the moderator gate,
  so nobody could mute their own microphone — fails 3 tests. That defect reached
  a real device precisely because nothing covered self-mute.
- **Skipping the participant release on close** is now caught as *people were not
  released from the room*, rather than *a spy was called 0 times instead of 3*.
- **`!req.body?.requireApproval`** — the classic falsy bug, which would mean
  nobody could ever *disable* room approval.

---

## Two traps worth carrying forward

**A docstring counts as a double.** The first draft of `room-seats.test.js`
quoted the `runTransaction` stub it had replaced, to explain what changed — and
the ratchet, which matches its patterns as *text*, counted the quotation.
Quoting the thing you removed counts as still having it.

**Replacing `db.batch` breaks the transaction.** The Firestore SDK builds its own
`WriteBatch` through `db.batch()`, so a wholesale spy made the route answer 500
with `this._writeBatch._reset is not a function`. Had that test been asserting
500, it would have **passed for entirely the wrong reason**. The spy now returns
a real batch and refuses only the commit carrying a `users/` write.

---

## The umbrella could not record its own progress

This handover was meant to carry a running-log update on SHY-0113 itself. The
**pre-merge gate refused it**: `check-pr-story-status.js` fails any PR that
modifies a story unless its status is `In Review`/`Done`/`Cancelled`, and
SHY-0113 is deliberately **In Progress**.

Both ways out were wrong — flipping the status would be a lie told to satisfy a
check, and never updating the log leaves an umbrella unable to say what has been
done under it. Filed as **SHY-0486** (Draft, a policy decision for the operator).
The progress it would have recorded is the table above.

## Next

`owner-away` (10 tests) and `disconnect-user` (12) are the remaining
presence-dependent groups, and the umbrella sequences both against **SHY-0103**
(the RTDB presence uid mismatch) — they should be taken with that story, not
before it. The Chunk C review-hardening group (14) is independent and can go any
time.

## Open, for the operator

- **SHY-0103** — Draft. Gates the last two express groups.
- **SHY-0475** — room instrumentation tests fail on a real device, pass on the
  emulator. The product is fine; the harness is not.
- **SHY-0470 / SHY-0471 / SHY-0244** — Draft, awaiting decisions.
- **#1519** — the firebase-bom major bump (SHY-0471's subject). The only open PR.
- **The next promotion must cut `promote/YYYY-MM-DD` from develop.** SHY-0478's
  guard now refuses a promotion PR whose head is `develop`, because merging one
  deletes the integration branch.
