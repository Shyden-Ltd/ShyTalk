# Handover — 2026-08-23, part 14

Continues part 13. **Nothing has been pushed.** 25 unpushed commits on
`feature/SHY-0387-support-page`.

Part 13 ended with both phones passing J38 and the evidence page published.
Everything since came from the operator reviewing that evidence and finding it
wanting — correctly, three times over.

---

## What the operator caught

### 1. A screenshot that did not show its claim

> "The limits are stated before anybody picks ← the screenshot for this showed
> you checked for updates. nothing to do with support. invalid test case"

`at01-limits-stated.png` was the **About screen with an "Up to Date" dialog**,
captured a minute earlier while navigating TO support. The screenshot that
actually shows the limits (`at02`) existed and was not used at all.

Audited the rest by hand. `at02`, `at04`, `at05`, `at06` are genuine. `at08`
exposed a **systemic** flaw: its claim is *"ticket X carries keys A and B"* — a
Firestore fact a phone screenshot cannot evidence. The page conflates **visual**
claims, where the screenshot IS the proof, with **state** claims, where it merely
sits alongside.

Also queried: how a step showing "Unable to Connect" could be a pass. Fair —
step 1 seeds a ticket through the API and never touches the phone, so the
assertion held, but a device screenshot was attached to it anyway. **The error
screen it caught was real**, and became SHY-0442.

### 2. Attachments could be removed but never deleted — SHY-0434

> "there is no test to prove that the user can remove an uploaded attachment and
> to prove that the file is deleted from the server once removed (we must not
> keep files we don't need - GDPR risk)"

There was no test because **nothing deleted anything.** Bytes upload the moment a
file is *picked*; `removeAttachment` only filtered the local list; and there was
**no DELETE route on the API at all**. Once the form dropped the key nothing
referenced that object — no ticket carried it, so no retention rule and no
erasure request could reach it. Permanent and unreachable.

A comment documented it as deliberate: *"the object stays in R2 unreferenced…
unreferenced objects are the storage lifecycle's problem."* No lifecycle ever
collected them.

Fixed: `DELETE /api/support-tickets/attachments`, reusing the existing prefix and
traversal checks. The form lets go first and deletes in the background.

The operator also asked for a functional count test: three attached, remove one,
two left — and the freed slot genuinely reusable at the ten-file limit. Both now
exist; the old test asserted only the surviving *set*.

### 3. Coordinate taps

> "you're still using clicks based on coordinates of where you expect an element
> to be… leading you to click the wrong things, see a result and assume it's
> passed."

Every tap DID resolve by id — from a dump taken **earlier**, then tapped
`node.center`. `advanceUntil`, which every walk goes through, dumped once, ran
four handlers that each rearrange the screen, then tapped a coordinate from a
screen that no longer existed.

---

## Where the taps ended up

Four rounds, each one finding the previous incomplete.

1. **Element clicks for iOS.** `POST /element` → `/element/{id}/click`. Proven on
   device from the Appium HTTP log: coordinate `/actions` **23 → 4 (−83%)**, all
   13 lookups by `accessibility id`. Cost ~1.6s across the walk.
2. **`tapResolved` for adb**, which has no element click: re-resolve immediately
   before tapping, and THROW if the target has gone.
3. **A P0 I introduced.** `tapLowestText` picks the LOWEST node with a text —
   in a dialog, the button under the identically-worded title. `tapResolved`
   re-resolved with `byText` (first match) and handed back the **title**.
   Sign-out hung; every journey after the first would have failed. Callers now
   pass the rule they used.
4. **Reachability — SHY-0441.** Findable is not reachable.

---

## SHY-0441, the one that matters most

At t≈67s of the iOS recording **the Send button is completely hidden behind the
keyboard**, and the walk taps it and moves on. An occluded button is still in the
tree, with an id, sane bounds and `enabled=true`.

**SHY-0419 was exactly that defect.** Three readings to fix, shipped twice. The
journey written to prove it stays fixed **could not detect it**. SHY-0428 is the
same class from the other side.

`occluderOf` — document order is paint order, so only a node drawn LATER can be
on top; it occludes when its box holds the target's tappable **centre**; a node
wholly inside the target is its own child and ignored. `visible` is now read,
having been parsed since the driver was written with a comment naming SHY-0419
and **zero uses**.

The element-click shortcuts had to go: they skipped the dump, and therefore the
check, on iOS — the platform the defect came from.

**Risk being verified right now:** this gates EVERY tap. Both agents are running
J38 specifically to find out whether it reddens healthy walks.

---

## Three times I tested one side of a seam

Worth stating plainly, because it is the through-line of this stretch.

1. Six source-scanning locator guards passed while the code tapped the wrong
   element — they check the SHAPE of the code.
2. The `forceStop` guard pinned the one method I was shown; `screencap`, `tap`
   and `swipe` had the identical bug — 13 sites, one of which was already
   destroying evidence (every iOS run lost its last screenshot while the report
   linked it).
3. The reachability suite: twelve tests of `occluderOf` and `assertReachable`,
   **zero callers driven**. Deleting the call left all twelve green.

Mutation caught 2 and 3. Both suites now enter through the real caller.

---

## Tickets

| Ticket | Pri | Status | What |
| --- | --- | --- | --- |
| SHY-0433 | P2 | Draft | Attachments show a filename, not what you attached. Thumbnails, tap to view. |
| SHY-0434 | P1 | In Review | A removed attachment was never deleted. **Fixed.** |
| SHY-0435 | P1 | Draft | Abandoned uploads orphaned identically — the likelier path. Not fixed. |
| SHY-0436 | P1 | Draft | Closed tickets deleted after 7 days, with attachments. **Needs an operator decision.** |
| SHY-0437 | P1 | Draft | Teach people to report before offering a ticket. |
| SHY-0438 | P1 | Draft | An admin turns a ticket into a report. |
| SHY-0439 | P1 | Draft | A converted ticket closes for good. |
| SHY-0440 | P2 | Draft | **A room cannot be reported.** Needs a decision. |
| SHY-0441 | P1 | In Review | The walk taps buttons it cannot see. **Fixed, being device-verified.** |
| SHY-0442 | P1 | Draft | "Unable to Connect" on cold start. Cause confirmed, deliberately not built. |

### Two decisions waiting on Shyden

**SHY-0440 — there is no way to report a room.** `reportRoom`, `report_room`,
`reportedRoom`, `roomReport`: zero matches across app, API and admin. The
operator's closing copy for SHY-0439 says "report the user, message or room
directly", so a third of it names something that does not exist. Either build it
or drop the word. The case I would weigh most is age segregation: a room a minor
should never have entered is a safeguarding matter about the ROOM, and nobody can
currently raise it as one.

**SHY-0436 — seven-day deletion vs safety history.** Narrowed by SHY-0438: once a
safety matter becomes a report, the report carries the moderation record, so
deleting the ticket loses nothing. Remaining question is tickets raised before
SHY-0437 ships.

---

## SHY-0442 — ready to build, deliberately not built

`AuthViewModel.handleBackendError` routes auth-shaped failures to sign-in and
sends **everything else** to `isBackendUnreachable`, which renders the
full-screen error. **No retry before it** — `retryConnection()` exists only
behind the button a person must press. So one transient failure on the very
first call (identity resolution, line 366) produces a full-screen "check your
internet" on a stack that is up and answering, and a relaunch fixes it.

There is no `AuthViewModelTest` at all.

Not implemented because both phones were mid-run, and shipping an unverified
change to sign-in would repeat this session's central mistake: a recorder, a
scrcpy flag set and a locator fix all shipped on green unit tests and failed the
moment they met hardware.

---

## Where to pick up

1. **Read the two device reports.** The question is whether the reachability
   check is quiet on healthy walks. A failure is either a real find or a false
   positive; the agents were told to diagnose which, not to retry past it.
2. If it is quiet: **SHY-0442's fix** — bounded retry inside
   `handleBackendError`, with the `AuthViewModelTest` harness it needs — then
   device-verify.
3. **Regenerate the evidence page** and re-audit every hand-paired row before
   asking for sign-off again. Distinguish visual claims from state claims.
4. Operator sign-off remains the merge gate. Then push, merge `main`→`develop`,
   `develop`→branch, merge, deploy dev.

### Known, not chased

- The OnePlus delivers live third-party notifications (TikTok, Facebook) during
  runs — a real instance of "the screen moved between dump and tap". The Android
  agent was asked to enable Do Not Disturb.
- Test data accumulates: the iOS persona reached **8 open tickets** against a
  display cap of 5. That is SHY-0432.
- Gift Wall artwork renders as broken-image fallbacks on Android; a "600 × 200"
  placeholder banner dominates the Rooms screen. Neither triaged.
