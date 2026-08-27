# Session handover — 2026-08-25 (part 17)

Self-contained. Everything needed to resume is here; nothing points at notes that
do not exist in the repository.

---

## 1. Where the work is

| | |
| --- | --- |
| Branch | `story/SHY-0458-conversations-read-path-via-api` |
| HEAD | `77c23d051c0` |
| Ahead of `origin/develop` | **169 commits** |
| `origin/develop` | `c691ad046e6` — **untouched** |
| Working tree | clean |
| **Pushed** | **NOTHING. Deliberate.** |

The branch also contains `story/SHY-0457-journeys-must-touch-the-ui` merged in, so
it is the single branch with all of today's work.

`develop` locally is at `516895dfdef` and already contains the `main` back-merge
plus PR #1940's 45 stories, merged **locally only**.

---

## 2. Why nothing is pushed

The operator's instruction (2026-08-25) is that PR #1940 sign-off runs:
`main → develop`, `develop → ticket`, ticket → `develop`, then the journey matrix
and evidence **from `develop` against local**, then **wait for operator sign-off**,
and only then push and deploy to dev.

Sign-off has not been given. Two journeys are deliberately red (§5), so an evidence
bundle produced now would contain two known failures.

---

## 3. What landed today

**PR #1940 sign-off prep**
- `main` → `develop` (3 commits), `develop` → ticket, ticket → `develop`. Zero conflicts.
- Android **15/15** and iPhone **15/15** at the same SHA, evidence bundle built at
  `~/Desktop/shytalk-signoff-0456/` (221 frames + 2 videos, SHA stamped in the page).

**SHY-0456 — a mandatory core set** (`In Progress`)
- Fixed set runs FIRST every session and cannot be skipped by `--journeys`:
  `J-SMOKE, J09, J07, J02, J08`.
- **J09 did not exist** — written from scratch: create room → mic on → mic off →
  close, asserted in Firestore at each step.

**SHY-0457 — a journey that never touches the phone must not pass** (`In Progress`)
- The runner counts real UI operations per step, excluding the sign-in preamble.
  A journey declaring `kind: 'ui'` that performs none now FAILS.
- Found because J07 was green while its screenshots showed 20+ frames of an empty
  room list: four consecutive frames were byte-identical.
- J07, J08, J11 converted to real UI walks. J12 declared `api-contract` (its screen
  is unreachable — SHY-0460).

**SHY-0169 — SSE ratified** (`Done`)
- Operator chose SSE for real-time reads. This had blocked every read-path story in
  EPIC-0006 since July.
- `express-api/src/utils/sse.js` + `GET /api/conversations/stream`, with
  **authorization re-checked per fan-out**. 21 tests.

**SHY-0458 — conversation read path via API** (`In Progress`)
- Fixed a **P0**: private messaging could not be started at all.
- Added `GET /api/conversations`, `POST /api/conversations`.

**EPIC-0006 — the sweep began**
- Complete call-site audit: `scripts/audit-direct-backend.js` +
  `.project/audit/direct-backend-access-audit-2026-08-25.md`.
- 3 files migrated: `BannerRepositoryImpl`, `NotificationRepositoryImpl`,
  `IosSmallRepositories`.

---

## 4. Tickets filed today

| Ticket | Status | What |
| --- | --- | --- |
| SHY-0456 | In Progress | The mandatory core set + J09 |
| SHY-0457 | In Progress | Journeys must touch the phone; J07/J08/J11 converted |
| SHY-0458 | In Progress | Conversations read path via API (the P0 fix) |
| SHY-0459 | Draft | A minor is shown controls they are refused server-side |
| SHY-0460 | Draft | `ReportReviewScreen` is registered in two nav graphs and unreachable |
| SHY-0461 | **Draft, P1** | **A suspended person is told "cannot connect" and can never appeal** |
| SHY-0462 | Draft | Every Compose dialog is invisible to device tests (17 files) |
| SHY-0169 | Done | SSE ratified |

---

## 5. Two journeys are RED on purpose

Both point at filed defects. They are red because the product is, not the test.

**J02** — `Minor UI hides the features spec j02 says it hides` throws. It previously
PASSED while recording the violation in its detail text. Operator decision: make it
fail. Defect: **SHY-0459**.

**J11** — reaches the suspension step and fails naming **SHY-0461**. The app learns
it is suspended by reading its own user document, and suspension forbids that read
(`403 Account suspended`), so it falls through to `isBackendUnreachable` and shows
"cannot connect". `POST /appeals` is exempt, so the appeal right exists but is
unreachable.

Everything else in the core set is green on the OnePlus:
`J-SMOKE ✓ J09 ✓ J07 ✓ J08 ✓`.

---

## 6. EPIC-0006 sweep — exact position

Operator instruction: **find everything first, then fix each one by one**, then a
full journey sweep with evidence.

Finding is **complete**, including a second pass over everything the first scan's
scope excluded (native Swift, flavour source sets, `jvmMain`/`jvmTest`, `functions/`,
all of `public/js`, inline HTML scripts, direct REST bypassing the SDK, R2/MinIO).
Nothing new was found.

| | Start | Now |
| --- | --- | --- |
| Call sites | 244 | **215** |
| Files | 24 | **21** |
| Ratchet baseline | 32 | **29** |

**The listener count was corrected**: 74 → **49**. `return@addSnapshotListener` is a
continuation, not a second subscription; 25 of 42 raw Android occurrences are
continuations, so Android has **17** real Firestore listeners, not 42.

**Done:** `BannerRepositoryImpl`, `NotificationRepositoryImpl`, `IosSmallRepositories`.

**Next, in order** (from §4 of the audit document):

1. `PrivateMessageRepositoryImpl` (android, 47) + `IosPrivateMessageRepositoryImpl`
   (ios, 27) — **partly started**: get-or-create and the list are already behind the
   API via SHY-0458.
2. RTDB: `RtdbPresenceService`, `RtdbConversationService`, `RtdbTypingRepository`,
   `IosRtdbServices` — carries the `onDisconnect()` question. SSE gives the server a
   connection-close event, which is the equivalent signal, but presence needs that
   wired deliberately rather than assumed.
3. Rooms + seat requests, then users, then economy/gifts, then web, in that order.

**Every file follows the same loop:**

```sh
node scripts/audit-direct-backend.js --file <Name>   # enumerate its call sites
# add/confirm the endpoint (+ SSE for listeners), TDD
# migrate BOTH platforms — they are near-mirrors and drift if split
# move the client tests to the new path; verify the server covers what moved
node scripts/audit-direct-backend.js                 # count must go DOWN
# shrink scripts/direct-backend-baseline.json to match; never grow it
node scripts/check-no-direct-backend.js              # must stay clean
```

---

## 7. Two things awaiting an operator decision

- **LiveKit is a direct client→media WebSocket** (`ws://…:7880`). Authorization is the
  token, which the API issues, and media cannot be proxied through Express. It is
  architecturally necessary but it IS a direct backend connection, and deserves to be
  a **ratified exception rather than an oversight**.
- **`public/portal/index.html` loads `firebase-firestore-compat.js`** in a script tag.
  Its consumer `portal.js` is already counted, so it is not a separate site — but
  removing the JS usage must also remove the tag, or the SDK keeps shipping to
  browsers for nothing.

---

## 8. Environment as left

- Local stack UP: express-api `:3000`, Firebase emulators `:4000/:8080/:9099/:9000`,
  web `:8888`, LiveKit/Mailpit/MinIO via Docker. Started with `bash local/start.sh`
  (it blocks; it was launched detached, and its `cleanup()` trap tears down the Docker
  containers if it is killed).
- **The express-api on :3000 was restarted manually** so the new conversation routes
  are live. If it is gone, restart from `express-api/` with
  `NODE_ENV=local TEST_API_KEY=local-test-key node src/index.js`.
- OnePlus `CPH2653` (serial `3b402284`) and Sean's iPhone both connected by USB.
- Raul (`50000050`) was left **unsuspended**; J11 also lifts a leftover suspension on
  the way in, so a stale one no longer breaks the next run.
- Firebase emulator project is **`demo-shytalk`** (not `shytalk-local`), and
  `FIRESTORE_EMULATOR_HOST=localhost:8080`.

---

## 9. Traps met today, so they are not met again

- **A Compose dialog is its own window.** `Dialog`/`AlertDialog`/`ModalBottomSheet`/
  `DropdownMenu` do not inherit `testTagsAsResourceId`; the dump shows only
  `android:id/content` while the screen looks fine. Fix:
  `Modifier.exposeTestTagsToPlatformDumps()`, once per window. Met **four times**
  today. 17 files remain — SHY-0462.
- **The keyboard is a separate window too**, invisible to the dump, so a control
  underneath looks reachable and the tap is silently eaten. `dismissKeyboard()` exists
  now.
- **`input text` APPENDS on both platforms.** XCUITest's `/value` does too, despite a
  code comment that said otherwise. `typeInto(..., clearFirst = true)`.
- **`participantIds` are STRINGS**; `req.auth.uniqueId` is a NUMBER. Query with the
  wrong one and you match nothing and blame the product.
- **People search is a PREFIX match** and every seeded display name begins `"[SEED] "`,
  so searching `"Lena"` finds nobody. Search by uniqueId.
- **Check which branch is checked out before blaming a fix.** Two device runs were
  spent testing an app built from a branch that never contained the fix.
