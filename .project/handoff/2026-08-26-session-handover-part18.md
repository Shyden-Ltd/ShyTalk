# Session handover — 2026-08-26 (part 18)

Self-contained. Everything needed to resume is here.

---

## 1. Where the work is

| | |
| --- | --- |
| Branch | `story/SHY-0458-conversations-read-path-via-api` |
| HEAD | `74b77fe47a6` |
| Ahead of `origin/develop` | **174 commits** |
| `origin/develop` | `c691ad046e6` — **untouched** |
| Working tree | clean |
| **Pushed** | **NOTHING. Deliberate** — PR #1940 sign-off is still gated on the operator. |

Four commits added this session, all on top of part 17's state:

```
74b77fe47a6  fix(SHY-0464): the test suite no longer destroys the personas journeys need
16757c784cd  fix(SHY-0463): a field describing a suspension must not outlive it
306f175893e  fix(SHY-0463): an appeal from the phone now reaches a moderator, every time
aaa4eca5316  fix(SHY-0461): a refused person is told which standing refused them
```

---

## 2. What was fixed, and what the filing got wrong

### SHY-0461 — a refused person is told which standing refused them

**The filed diagnosis was wrong and would have led to building a route nobody
needs.** It said the app learns it is suspended by reading its own user
document, and that suspension forbids that read. The read is **allowed** —
`firestore.rules` has an own-doc carve-out with no standing check, proven
against the emulator as the suspended user (200, `isSuspended=true`).

The real blocker was one step earlier: `POST /api/users/sign-in`, the FIRST
call the app makes, was refused by both standing gates. Identity resolution
never completed, so the app never reached the document it may read, never
reached `checkAndApplyBan()`, and `handleBackendError` — which classifies
auth-error or unreachable and has no third branch for a standing verdict —
landed on `isBackendUnreachable`. A **banned** person hit the same wall, so
the ban screen was unreachable on a cold sign-in too.

The route already answered correctly and the answer was dead code: `POST
/users/sign-in` has carried a `{ found, suspended }` branch since Audit M5
(Phase 2A), returning the verdict without mutating.

Fixed as a class. `PRE_IDENTITY_ROUTES` now carries `standingExempt`, and both
gates read it through `isStandingVerdictChannel()`. `POST /users` is
deliberately `standingExempt: false` — it ACTS rather than reports, and with no
identity to resolve the gates match it by device and IP, which is exactly what
stops a banned handset opening a fresh account. **The first draft of the fix
would have exempted it and legalised ban evasion**; the table-driven test
caught that.

### SHY-0463 — an appeal from the phone reached nobody, once

Found by device-proving SHY-0461. Two independent defects in
`POST /api/users/:uniqueId/appeal`, the endpoint the app calls:

- It wrote `uniqueId` (a String) where every reader looks for `userId` (a
  Number), so `GET /appeals` enriched an app-submitted appeal to
  `userUniqueId: null, userDisplayName: null, suspensionReason: null`. Nobody
  to approve or deny.
- It decided "already pending" from `users/{id}.suspensionAppealStatus`, a flag
  cleared by ONE of the three writers that end a suspension. After a single
  appeal every later suspension was refused `409` for ever.

Both routes now share `utils/appeals.js`. The second commit went further: the
flag is written from eight places across four route files, so
`utils/suspension.js` states the lifecycle once —
`suspensionEndedFields()` / `SUSPENSION_STARTED_RESET`.

The first pass fixed only the READER and left the stale data, and the phone
showed the defect one layer out: J11 reached the suspension screen and the
appeal field and button were **absent**, because the screen renders the form
from that same flag.

### SHY-0464 — the test suite destroyed the personas the journeys need

`npm test` silently corrupted the local seed. `mintRealUser` writes with
`.set()` and no merge; three suites minted on personas' own uniqueIds
(`livekit.test.js` on 50000010 and on 50000020 **as suspended**,
`livekit-cohort.test.js` on 60000010). A 24-key persona became three keys.

Cost, in one evening: the journey pre-flight refused to start **twice**, and
J07 failed with `Lena's reply expected 200; got 403 Account suspended` — which
reads exactly like a product defect and is not one. **Re-seeding does not clear
it**: the seeder merges the persona's fields back and never writes
`isSuspended`.

`mintRealUser` now refuses any uniqueId in the persona registry, read from the
registry the seeder itself uses. Grepping for what suspended Lena did not find
it; the guard found it on its first run.

---

## 3. Device evidence (OnePlus CPH2653, serial 3b402284, local target)

Last run started immediately after a full suite run with **no re-seed** —
which is SHY-0464's Definition of Done.

```
J-SMOKE ✓   J07 ✓   J08 ✓   J11 ✓
J09 ✗  — voice chat unavailable on the phone (§5)
J02 ✗  — SHY-0459, deliberately red
```

J11 end to end, every step green, including `DB: the appeal is pending review`
— the assertion that was failing. Before the fix the same journey showed
`signIn_retryConnection`; it now shows `suspension_title`,
`suspension_appealField`, `suspension_submitAppealButton`.

API-level proof against the local stack:

```
POST /api/users/sign-in  (suspended) -> 200 {"found":true,"suspended":true,...}   (was 403)
POST /api/users/50000050/appeal      -> 200                                        (was 409, permanently)
moderator sees userUniqueId 50000050, reason "harassment confirmed"                (was null, null, null)
```

J11 also carried a defect of its own: `signInAs` always asserted "Land on
Home", which a suspended person never reaches, so the journey recorded a red
step for correct behaviour and could not pass however well the app behaved. It
now takes `expectHome: false`, and the replacement step still ASSERTS —
`waitForAnyId` requires one of the terminal screens and names which arrived.

---

## 4. Test state

`npm test`: **15645 passing**, 5 failures in 4 suites — all pre-existing and
none in a file this branch touches:

- `check-no-new-stubs.test.js` — names the PREVIOUS session's
  `conversations-read-path`, `conversations-stream`,
  `notification-settings-read` and `sse` suites. They introduced `jest.mock`
  usage against the repo's no-stubs policy and the baseline was never updated.
  **This is real debt belonging to SHY-0169 / SHY-0458**, and it is the one
  remaining red that is arguably in this branch's lineage.
- `device-journey-parallel-isolation`, `ios-session-recovery`,
  `journey-device-parity` — journey/driver suites, untouched by this branch.

`no-funfact-splash-app-surface.test.js` failed once under the parallel run and
passes in isolation — flake, not a regression.

---

## 5. J09 is red, and it blocks the mandatory core set

`UI+DB: Theo opens his mic` fails: the seat stays `isMuted: true`. The failure
text reads like a test-timing problem. **The screenshot answers it in one
look** — the app renders its own banner, "Voice chat is temporarily
unavailable".

What was ruled out:

- The LiveKit container is **up** and answers on `:7880`.
- Token issuance **works**: `POST /api/livekit/token` with a real room returns
  200 and a valid JWT for Theo. (A first probe 404'd only because
  `probe-room` is not a real room — that route hides existence deliberately.)
- Nothing in this branch touches seats, mute, or the LiveKit route.

So the gap is the phone's WebSocket link to LiveKit — `adb reverse`, or the
app's LiveKit client. **J09 is in SHY-0456's mandatory core set, so while it is
red no evidence session can be clean.** This needs a decision and probably a
ticket; it was not filed because the diagnosis is not finished.

---

## 6. Awaiting the operator

- **PR #1940 sign-off** — unchanged from part 17. Nothing is pushed.
- **J02 / SHY-0459** — still deliberately red; the minor UI exposes controls
  the server refuses. Product decision, not a bug to paper over.
- **J09 / voice chat** — §5.
- **Branch topology** — this branch now carries SHY-0169, 0456, 0457, 0458,
  0461, 0463 and 0464. That is six stories on one branch, against "ONE Story =
  ONE PR". Nothing is pushed, so it can still be split before the PR; it needs
  a call.
- **LiveKit as a ratified exception** and **the portal script tag** — both
  still open from part 17 §7.

---

## 7. Environment as left

- Local stack UP: express-api `:3000` (restarted manually — the conversation
  and appeal routes need it), Firebase emulators, web `:8888`, LiveKit/Mailpit/
  MinIO via Docker (`local-livekit-1` up 17h).
- Restart the API from `express-api/` with
  `NODE_ENV=local TEST_API_KEY=local-test-key node src/index.js`. `.env.local`
  supplies the other 13 vars, LiveKit keys included.
- Personas re-seeded and **verified intact after a full suite run** (all 17).
  Re-seed with `cd express-api && node --env-file=.env.local
  scripts/seed-personas-local.js`.
- OnePlus `CPH2653` (`3b402284`) and Sean's iPhone both connected by USB.
- Raul (`50000050`) left unsuspended; J11 cleans up after itself.

---

## 8. Traps met this session

- **A handover's diagnosis is a hypothesis.** SHY-0461's filing named the wrong
  call and the wrong layer. Reproducing it first turned a new-endpoint design
  into a three-line exemption.
- **A sentinel can disarm the thing it asserts.** A decoy `firebaseUid` in a
  no-mutation test broke `resolveUniqueId`, so the middleware resolved nobody,
  skipped both standing checks, and let the request through — the test would
  have gone green proving nothing.
- **A mock LESS complete than reality invents a defect.** A snapshot without
  `size` made `bans.js` compare `undefined < LIMIT` — false, not an error — so
  its pagination loop ran on and dereferenced `docs[-1]`.
- **A partial module mock lies about the module's surface.** `firestore-helpers`
  mocked with `getDoc` alone gave a new consumer of `queryDocs` `undefined`,
  arriving as a product 500.
- **A `where()` mock taking a `Filter.or` object** compared
  `data[undefined] === undefined` and would have matched EVERY document —
  reporting bans that do not exist.
- **Fixtures unlike reality hide divergence.** Three suites drove appeals with
  a STRING uniqueId; `users/{id}.uniqueId` is an integer. That is why the
  String/Number split survived in a covered route.
- **Eyes beat assertions.** J09's failure text described a DB predicate; the
  screenshot named the cause.
