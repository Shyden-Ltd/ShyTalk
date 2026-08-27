# Handover part 10 — 2026-08-22

Previous: `2026-08-21-session-handover-part9.md`.

## Read this first — the merge rule CHANGED

**Operator rule, 2026-08-22. A ticket no longer progresses on green CI.** For
anything that changes product behaviour:

1. Run its tests on **ALL devices and ALL browsers, LOCALLY**.
2. Any RED ⇒ fix. Do not present a partial run.
3. At 100% green, build an **interactive evidence web page** and give him the
   link: every journey covering the ticket, every step, every assertion, each
   result, with **a screenshot per assertion and a video per journey**.
4. He checks each test off and says whether more are needed.
5. **Only after his explicit sign-off** may the ticket progress.

Four points he settled when setting it:

| Question | Answer |
| --- | --- |
| Applies to PRs already open? | **Yes, immediately** |
| How the page reaches him | **Hosted artifact link** — opens on his phone, outlives the session |
| Evidence depth | **Screenshot per assertion + video per journey** |
| Test-only / CI / docs changes | **Exempt** from page and sign-off; still must be 100% green |

Full rule: `feedback-tickets-need-an-evidence-page-and-operator-signoff` in
memory. **#1940 is the first ticket that must go through it.**

## Second rule, same day — DEV testing is post-merge only

**Dev testing happens only from `develop`, after the merge has landed and been
deployed. Everything before that is LOCAL only.**

I got this wrong in this session: `scripts/ios/build-debug-dev.sh` points the app
at the PUBLIC dev backend, and I used it to walk a FEATURE branch against dev.
Pre-merge device work must use the local configuration against the local stack
(Android `local` flavour; iOS local configs via
`scripts/ios/add-local-configurations.rb`). The evidence-page run is therefore a
LOCAL run. Rule: `feedback-dev-testing-only-after-merge-to-develop`.

## A correction that matters more than either — SHY-0396

**The support form BLOCKS a second ticket. It was never supposed to.** He asked
for multiple tickets to be ALLOWED with a warning, on 2026-08-21, and said so
again on 2026-08-22 after seeing the block on a device. What ships today:
`support-tickets.js:194-203` answers **409**, and the client disables Send and
says *"You already have a request open. We will reply to that one."*

Required instead — warn, never refuse:

- say a request is already open, and show a **very brief summary of each** so
  they can tell if it is the same problem;
- remind them a duplicate for the SAME problem only slows things down and puts
  them to the **back of the queue**;
- offer exactly three choices: **"It's the problem I already reported"** /
  **"It's a new problem"** / **"Go back"** (which keeps their typed message).

**SHY-0396** carries the sharpened ACs and a worked implementation direction
(new `GET /mine/open`, the 409 removed, a new append endpoint, and the client
flow). Not built. It is P1/MVP and it is the next code to write.

Note the trap recorded there: the 409 is load-bearing in existing tests. Those
assertions pin the defect and must be INVERTED, not deleted.

## Then this

**#1940 (SHY-0387) is no longer blocked by a defect** — SHY-0419 is fixed and
device-proven on both platforms (below). It is blocked only by the new evidence
gate: the page has NOT been built yet. That is the next piece of work.

---

## Landed

| What | State |
| --- | --- |
| **#1941 — SHY-0416** (no iOS dev build could sign in) | **MERGED** 15:08Z, deployed to dev |
| Deploy To Dev from `develop` (`32495997153`) | **success**, all jobs green |
| iOS TestFlight from `develop` | **success** — first build carrying the persona credential |
| **#1943 — SHY-0308** (the intermittent ban-test 401) | **MERGED** 20:57Z, deployed to dev, device-verified |

### SHY-0416 is proven, not assumed

The iOS job's env in the real run shows `DEV_QA_PERSONAS_PASSWORD: ***`
(run `32495997153`, "Build, archive, and export iOS app"). Then, on the actual
iPhone: the persona picker appeared, listed P-02…P-10, and **signing in worked**.
That is the first iOS dev build that has ever been able to sign in.

---

## SHY-0308 — root-caused, fixed, PR #1943

Was: `Expected: 403, Received: 401`, intermittent, three unconfirmed hypotheses.

**Cause, confirmed:** `auth/id-token-revoked`. Banning revokes refresh tokens on
purpose (`syncBannedClaim`). `authMiddleware` verifies WITHOUT `checkRevoked`,
so production never consults that — but `firebase-admin` forces the check on
against the Auth emulator (`if (checkRevoked || isEmulator)`, `base-auth.js`),
which is local AND CI. The token was refused before the ban gate ever ran.

Two further teeth: `iat`/`validSince` are second-granular, so even a forced
refresh can be minted in the same second and refused; and the revoke kills the
REFRESH token, so `getIdToken(true)` can keep returning the same dead token.

**Shipped:** the credential check is separated from the standing lookups in both
middlewares; the 401 body now carries `code: token_rejected` or
`standing_unavailable`. Status unchanged, fail-closed unchanged.

**Verified:** webkit 20/20 and chromium 10/10 at `--retries=0`; whole spec file
66/66 across both; Express suite 14,551/14,552. Mutation (exempting
`/suggestions` from the ban gate) is caught on the first response with the
suggestion actually created — and caught at the 403 assertion itself.

**Left for you:** whether a failed standing lookup should keep answering 401 at
all. It is pinned deliberately by the posture unit test, so I did not overturn
it. A 401 tells clients "your session is invalid"; a Firestore blip can
therefore read as a mass sign-out. Written up in the story.

---

## New tickets

| Id | P | What |
| --- | --- | --- |
| **SHY-0419** | **P1, MVP** | iOS: the support form cannot be sent — Send sits behind the keyboard. **Blocks #1940.** |
| SHY-0417 | P2 | Production: a banned user on portal/admin routes gets a bare 401, not the ban notice the docblock promises. |
| SHY-0418 | P2 | Two wall-clock assertions that go red under suite load. |

---

## SHY-0419 in one paragraph

On a real iPhone Air (iOS 27), the keyboard occupies y=609–854 and
`support_send` sits at y=616–665 — inside it, `visible="false"`. Tapping empty
margins, tapping between sections, tapping a category, and the iOS
swipe-down-over-keyboard convention all leave the keyboard up, and the page does
not scroll (a 700 ms drag left the button at y=616). **`imePadding()` was tried
in BOTH orderings, each with a full rebuild and reinstall, and neither moved the
button** — so the working hypothesis is that `WindowInsets.ime` is not reported
on iOS, which would also mean `RoomScreen`, `EmailOtpScreen` and
`PrivateChatScreen` have the same problem unnoticed. The speculative change was
reverted rather than shipped. 15 shared Compose files take text input without
any keyboard handling; the list is in the story.

---

## How to re-walk iOS (this now works end to end)

```bash
bash scripts/ios/build-debug-dev.sh          # builds + installs on the iPhone
xcrun devicectl device process launch --device <coredevice-uuid> com.shyden.shytalk
# Appium is already installed; session caps + a small UI helper are in the
# session scratchpad (ui.py): find/tap by accessibility id, summarise the tree.
```
Route: Profile → `main_settingsButton` → `settings_aboutItem` →
`settings_contactUsLink` → the support page.

Traps met on the way, all real:
- `xcrun devicectl list devices` gives a **coredevice UUID**; `xcodebuild` and
  Appium want the **hardware UDID** from `xcrun xctrace list devices`.
- Tapping an element whose `visible="false"` still returns success and lands
  somewhere else — one such tap typed a stray `t` into the message field.
  Always assert `visible="true"` before tapping.

## Traps met elsewhere today

- **`git push` dies with SIGPIPE (141) after the pre-push hook passes.**
  `git push </dev/null` works. The hook consumes git's ref stdin and the long
  Playwright child then kills the transfer. Use `</dev/null` every time.
- **The pre-push hook computes `CHANGED` against `origin/main`**, but branches
  are cut from `develop`. For any develop-based branch that reports ~291 code
  files and ~25 web files changed, so the full ~1,450-test chromium suite runs
  on every push — even a one-line story edit. ~20–25 min each. Not filed yet;
  worth a ticket.
- **`.project/handoff/**` is NOT in the gate's `NEUTRAL_RE`** (only
  `.project/stories/*.md` is), so pushing a handover to a PR branch makes an
  "unreviewed commit" and the gate refuses. Push the handover BEFORE recording
  the review marker, or bump the marker afterwards.
- **Running `npx prettier --write` from the repo root on `tests/web/**` churns
  the file** — there is no root prettier config, so it applies double-quote
  defaults and rewrote 362 lines, one of which the secret scanner then blocked
  as a new credential. `tests/web/` is not formatter-governed; lint-staged only
  covers `express-api/**/*.js`.
- `admin-users-profile.spec.ts:36` was "1 flaky" in every full run today. Not
  investigated.

## #1943 is in and verified

Merged 20:57Z; Deploy To Dev `32526194065` — backend, web, personas, sanity and
smoke all green. Verified against the DEPLOYED dev API, not inferred:

```
POST https://dev-api.shytalk.shyden.co.uk/api/support-tickets
  Bearer not.a.real.token
  -> 401 {"error":"Authentication failed","code":"token_rejected"}

  (no Authorization header)
  -> 401 {"error":"Missing or invalid Authorization header"}   # unchanged
```

Then on the real iPhone against dev: persona sign-in worked and the profile
loaded (Wallet 5,000, 5 followers, UID 50000010 · adult). That is the
auth-critical path proven on a device for a change every authenticated request
goes through.

Two things en route, both worth knowing:

- SonarCloud refused it first on `new_duplicated_lines_density` 16.2% vs a 3%
  threshold. It was right — splitting the catch had copied the same block into
  both middlewares, which is the exact hazard the story is about. Extracting
  `verifyCredentialOrReject()` / `rejectStandingUnavailable()` took it to 1.6%
  AND removed the drift risk. New coverage 100%.
- A single malformed story of mine (`### UX / i18n` merged into one heading)
  reddened THREE checks: the lint gate runs the validator directly, the
  board-sync script exits 40 when a story will not parse, and PR Gate aggregates
  both. Each AC dimension needs its own `###` heading.

## SHY-0419 — fixed and device-proven

`imePadding()` is `windowInsetsPadding(WindowInsets.ime)`, which respects insets
a parent has already **consumed**; the raw `WindowInsets.ime.getBottom()` read
does not. Something above the Column consumes the IME inset, so the modifier
applied exactly zero while the raw value was correct — which is why a probe read
960 and the button never moved. Padding by the raw value fixes it.

| | Before | After |
| --- | --- | --- |
| iPhone, keyboard open | Send y=616 `visible=false`, and scrolling changed nothing | y=620, then **y=470 `visible=TRUE`** after one scroll |
| iPhone, tap Send | unreachable | **"Thanks. We have your message and will look into it."** |
| Android | reachable after one scroll | unchanged — 2143 → 1552, no double-count |

Android's send answered the 409 "you already have a request open", because the
iPhone had just raised one as the same persona. Duplicate prevention proven
across devices, unplanned.

**Still owed on SHY-0419:** the other 14 text-input screens (list in the story),
and a guard — worth writing only once the mechanism is settled, since
`imePadding()` is demonstrably not it here.

## Suggested order next

1. **Build the evidence page for #1940** — the new gate, and the first ticket
   through it. Needs: the journey list for SHY-0387, all devices + all browsers
   locally, screenshot per assertion, video per journey, published as an
   artifact link.
2. Then #1940 on his sign-off.
3. SHY-0417 (banned user gets a bare 401 on strict routes).
4. The 16 journey-gap tickets SHY-0400–0415, none started.

---

# Later the same session — three more rules, and SHY-0396 half-built

## Rules added (all in memory, all HARD)

1. **Evidence page + sign-off** before any product ticket progresses (above).
2. **DEV testing only from `develop`, after merge and deploy.** Everything before
   that is LOCAL. I got this wrong: `scripts/ios/build-debug-dev.sh` points at the
   PUBLIC dev backend and I used it to walk a FEATURE branch against dev.
   Pre-merge device work must use the local configuration against the local stack.
   → `feedback-dev-testing-only-after-merge-to-develop`
3. **Push rarely.** Every push runs the full chromium suite: 20-25 minutes. I
   pushed seven times in one session — about two and a half hours. Commit locally
   often; push once, when the ticket is ready for dev. → same file as (2).
4. **Tests come first, always, and journeys count as tests.** Said twice in one
   session because my behaviour was inconsistent. →
   `feedback-exhaustive-tests-first-no-gaps` (reinforced section at the end).

## SHY-0396 — server DONE, client NOT started

**The defect:** the support form BLOCKED a second ticket. Never what was asked
for — multiple tickets are ALLOWED, with a warning.

**Done and green locally (52/52 in `support-tickets.unit.test.js`), committed, NOT pushed:**

| Change | Detail |
| --- | --- |
| 409 refusal **removed** | `support-tickets.js` no longer queries for an open ticket before creating |
| `GET /support-tickets/mine/open` | returns `{ ticketId, category, summary, createdAt }` per open ticket; summary is a 120-char shortening of their OWN message; ownership re-checked after the query |
| `POST /support-tickets/:id/messages` | appends via `FieldValue.arrayUnion`; somebody else's ticket answers **404**, not 403 — whether it exists is not their business |

Tests written FIRST. The old `refuses a second ticket while one is still open`
assertion pinned the defect and was **inverted**, not deleted, plus a
`no request is ever answered with 409` guard so the block cannot be reinstated
on one path only.

Two traps met, both now commented in place:
- the test harness signs requests as `uniqueId = 10000001`; fixtures using
  another id are silently filtered out by the ownership check and look like a
  route bug;
- the firebase mock had no `FieldValue`, so `arrayUnion` threw a 500 that also
  looks like a route bug.

**Still to build:** the client. Three choices — *"It's the problem I already
reported"* / *"It's a new problem"* / *"Go back"* (which must keep their typed
text). Blast radius: `SupportRepository.kt`, `SupportFormViewModel.kt`,
`SupportPage.kt`, `IosSmallRepositories.kt`, `SupportRepositoryImpl.kt`, and the
tests `SupportFormViewModelTest.kt`, `SupportFormWiringPinTest.kt`,
`SupportRepositoryImplTest.kt`. `RaiseTicketOutcome.AlreadyOpen` and
`alreadyHasOpenTicket` both encode the refusal and must go.

## SHY-0420 filed — attachments (P1, MVP)

Up to 10 files on **support tickets, reports AND appeals**; images ≤ 10 MB;
video ≤ **30 seconds, bounded by duration not bytes**; **virus scanning** with a
fail-closed gate; and **admins must not be able to download** — read-only
sandboxed viewing only. Today `GET /support-tickets/:id/attachments` mints signed
GET URLs, which is exactly the downloadable path to remove. Reports and appeals
have not been surveyed for attachment support at all — that is the first job.

## Journeys written (tests first)

- `journey-tests/j38-asking-for-help-twice.feature` — 10 scenarios for SHY-0396.
  The one that matters: *"Going back does not cost her what she wrote."*
- `journey-tests/j39-the-files-people-send-us.feature` — 12 scenarios for
  SHY-0420. The one that matters: *"A bad attachment never costs somebody their
  report"* — losing a report because its attachment failed a scan would punish
  the person raising the alarm.

Neither has step bindings yet; `journey-tests/INDEX.md` has not been updated.

## Where to pick up

1. Finish the SHY-0396 **client** (tests first), locally.
2. Bind j38's steps and run it locally on both devices.
3. Build the evidence page for #1940 + SHY-0396, publish it, get sign-off.
4. Only then push, merge, deploy.
