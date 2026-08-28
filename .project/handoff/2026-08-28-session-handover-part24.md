# Session handover — part 24

**2026-08-28.** The AFK week begins. Four authorities were granted before the
operator left, and three of them have already paid for themselves.

---

## The authorities (recorded in memory as `project-afk-week-authorities-2026-08-27`)

| Authority | Status |
|---|---|
| Take **SHY-0103**, including rules deploys to dev | used — and the story turned out to be **stale** |
| **FCM/FID migration** with the data-migration guardrail **lifted** | not yet started |
| Change **CI and merge gates** on own judgement, saying so | used — SHY-0486 |
| **Re-seed dev personas** myself | used — and it unblocked the dev leg |

---

## The dev leg of the release gate now exists

It never has before. Getting there cleared four separate blocks, each real:

1. **The dev persona password.** Rotated `DEV_QA_PERSONAS_PASSWORD`, re-seeded,
   and proved three personas mint real ID tokens against dev Firebase Auth.
2. **A six-day-old APK** on the phone with an **empty** baked password — the
   runner had not rebuilt it.
3. **`host@shytalk.dev` carried a moderation warning** from an old walk. The app
   persists the session and routes a warned user to the warning screen, so **one
   persona's leftover state blocked every journey's persona picker**. The
   provisioner neither seeds nor clears moderation state — filed as SHY-0489.
4. **The real cause (SHY-0488).** `initDb` returned **null** off local, so every
   state assertion silently skipped; the journeys ran a sign-in preamble and
   nothing else, and SHY-0457's guard failed them for *"never touching the
   device"* — a message about the wrong thing entirely. The dev leg was
   **unfinishable by construction**, and the runner's own comment said so.

**Now:** 6 of 8 pass, 2 fail, 7 skipped — every one **named, with printed
reasons**. `endJourney` had been recording the reason and printing only the
icon; one line would have saved the hour that diagnosis took.

Cohort turned out to be **unanswerable through the API by design** — the profile
route strips it as a safeguarding measure — so the reader declares that rather
than timing out, and the minor-UI assertions carry it behaviourally instead.

---

## SHY-0113's express scope is COMPLETE

`room-mutations.test.js` is **deleted**. All 170 tests migrated. Across
SHY-0479 → SHY-0492 the three files carrying **303 doubles** are all at zero,
and the no-stubs baseline fell **615 → 606** paths.

The last slice was unblocked by **cancelling SHY-0103**. Re-validating it at
pickup found the bug already fixed by SHY-0270 and **live on dev** — proven by
probing the deployed RTDB rules with a real token: own id **200**, someone
else's **401**, unauthenticated **401**. Both negative controls mattered; a rule
permitting everything would also have returned 200 on the first.

Its `ownerLeft` half was never a bug either — the app writes the Firebase uid
there, so the rule matching `auth.uid` is correct.

**Cancelling that story was worth more than fixing it would have been**: it had
been gating two groups of a P0 umbrella for months.

---

## SHY-0486 — the gate that would not let an umbrella speak

The pre-merge gate refused any edit to an `In Progress` story, so SHY-0113 could
not record its own progress. The two ways out were both wrong: flip the status
(a lie a gate would have accepted, with the board downstream of it) or keep the
record where the story does not point.

Now a **body-only** change is allowed — defined by what did *not* change, with
frontmatter and Acceptance Criteria byte-identical. Touching either is still
refused, and the message says **not** to flip the status.

It was used on its first outing, in its own PR.

---

## State

| | |
|---|---|
| `main` | v0.99.0 |
| `develop` | 24 ahead, 0 behind |
| Open PRs | **#1519** only (firebase-bom / SHY-0471) |
| Dependabot alerts | 0 |
| Express suite | 526 suites, 15,667 tests |
| Local device matrix | 15/15 |
| Dev device matrix | 6/8, 2 failed, 7 skipped — all named |

## Next

**SHY-0471 / #1519** — the firebase-bom major bump and the FCM→FID migration,
with the data-migration guardrail lifted for it specifically. Re-validate before
implementing: SHY-0103 was a well-written P1 that had already been fixed.

## Open, filed, not started

- **SHY-0489** — the provisioner never clears moderation state.
- **SHY-0490** — J06 buys `local_100_coins`, a local-only SKU.
- **SHY-0491** — one persona-picker miss on dev; filed to be counted, not chased.
- **SHY-0475** — room instrumentation fails on a real device, passes on the
  emulator.
- The seven journeys still marked `requiresLocalState`, which read Firestore
  collections the product API does not expose.
