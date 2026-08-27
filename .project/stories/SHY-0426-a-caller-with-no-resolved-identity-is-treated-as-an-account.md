---
id: SHY-0426
status: In Review
owner: unassigned
created: 2026-08-22
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0426: A caller whose account cannot be identified is treated as an account

## User Story

As **somebody using ShyTalk**, I want a request the server cannot attribute to
my account to be refused, so that "unknown" never behaves like an identity that
several people share.

## Why

`resolveUniqueId(uid)` queries `users` by `firebaseUid` and answers **null** when
no document matches. The auth middleware passes that straight through:

```js
req.auth = { uid, uniqueId, token: decoded };   // uniqueId may be null
```

Nothing downstream treats null as *unknown*. It is used as though it were an
account number, and because `null === null`, every ownership test passes for
every unidentified caller at once:

| Shape | What it does with a null id |
| --- | --- |
| `where('userId', '==', uniqueId)` | matches every unidentified caller's rows |
| `doc.userId !== uniqueId` | false — the write is allowed |
| `support-tickets/${uniqueId}/` | one shared folder, `support-tickets/null/` |
| `checkSuspension(null)` | returns **false** — not suspended |
| `computeUserBanStanding(null)` | returns **false** — not banned |

The last two are the sharpest: an account the server cannot identify is also an
account it will never see as banned or suspended.

**192 uses of `req.auth.uniqueId` across 29 route files.** Exactly one —
`routes/subscriptions.js:33` — checks it is present.

### What was actually observed, and what was not

On 2026-08-22, against a LOCAL stack, two personas with a null `uniqueId` could
read each other's support tickets — including the summary of a **safety**
report — and append to each other's. That is a real reproduction of the code
path, and it is why this ticket exists.

**It was not a production breach, and this ticket must not be written up as
one.** The personas' `users` documents had been removed by a full Jest run
earlier in the session (a known local hazard), which is what made
`resolveUniqueId` answer null for everybody. Re-seeding restored correct
isolation immediately: a ticket raised by one persona was invisible to the
other, an append was refused, and the upload key was
`support-tickets/50000010/` rather than `support-tickets/null/`.

So the honest statement is: **the code has no defence against a null identity**,
and a degraded environment demonstrated exactly what that absence costs.

### The open question this story must answer

**Can a real user reach `uniqueId: null` in production?** A Firebase account
that authenticates before its `users` document exists, or whose document lost
its `firebaseUid`, would. Until somebody answers that with evidence, the ban and
suspension bypass above is an unquantified risk, not a theoretical one.

Answering it is part of this story, not a preamble to it.

## Acceptance Criteria

### Happy path

- [ ] A request whose account cannot be identified is refused, with a distinct
      code, on every user-scoped route.
- [ ] A request with a resolved identity is unaffected.

### Error paths

- [ ] The refusal is distinguishable in logs from "not signed in" and from
      "suspended", because the three need different answers.

### Edge cases

- [ ] **uniqueId `0` is a real account** and must not be refused — a `!uniqueId`
      test locks it out. `Number.isInteger` is the check.
- [ ] Routes that legitimately run BEFORE an identity exists — account creation
      in `routes/users.js` — keep working. This is why the fix cannot simply be
      a blanket rejection in the middleware, and the exempt set must be listed
      explicitly rather than discovered by breakage.

### Performance

- [ ] No extra lookup; the value is already resolved.

### Security

- [ ] `checkSuspension` and `computeUserBanStanding` must not answer "clear" for
      an unidentified account. Fail closed, or refuse before reaching them.
- [ ] No storage prefix may ever be built from an unresolved id.

### UX

- [ ] Somebody in this state is told their account could not be identified and
      what to do, not shown a bare failure.

### i18n

- [ ] Any user-facing wording goes in all 21 locale files.

### Observability

- [ ] Every refusal logs the Firebase uid, so "can this happen in production?"
      becomes a question the logs answer.

## BDD Scenarios

**Scenario: An unidentified request is refused**

- **Given** somebody whose account cannot be identified
- **When** they ask for anything belonging to an account
- **Then** they are refused

**Scenario: Two unidentified people are not the same person**

- **Given** two people whose accounts cannot be identified
- **When** one asks for their own things
- **Then** they are never shown the other's

**Scenario: Being unidentified is not a way past a ban**

- **Given** a banned account the server cannot identify
- **When** it makes a request
- **Then** it is refused, not waved through

## Test Plan

| Layer | What it proves |
| --- | --- |
| Middleware | A null identity is refused everywhere except the explicitly exempt creation routes. |
| Guard | No route builds a query, a document path or a storage prefix from an unresolved id — the check that stops the next one. |
| Security | Two unidentified callers cannot see or write each other's data, asserted against the real emulator. |
| Ban gate | An unidentified account is not treated as clear by the suspension or ban helpers. |
| Evidence | Whether production can reach this state at all, answered with data rather than argued. |

## Out of Scope

- Changing how `uniqueId` is assigned.
- The support surface, which is already guarded — see Notes.

## Dependencies

- Needs the exempt-route list agreed before the middleware changes, or account
  creation breaks.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A blanket middleware rejection breaks signup | Exempt set listed explicitly and tested, not found by breakage. |
| `!uniqueId` locks out account 0 | `Number.isInteger`, with a test for 0. |
| The fix is applied route-by-route and one is missed | A guard asserts no route derives a scope from an unresolved id. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The production-reachability question answered in this file, with evidence.

## Notes

- The **support** routes are already guarded, in the SHY-0387 branch:
  `requireIdentity(req, res)` refuses with 403 `no_identity` on raise, list,
  append and upload-slot. That was done immediately because the hole was
  demonstrated there. It is deliberately scoped — the same shape exists in 28
  other route files and the central fix belongs here.
- Found while proving attachment uploads end to end: an upload key came back as
  `support-tickets/null/…`, which is what exposed the whole shape.

## How it was built

**Refused ONCE, in the middleware.** 211 uses of `req.auth.uniqueId` across 30
route files, and exactly one checked it was present. Guarding thirty files is
thirty chances to miss one, and thirty more for every route added afterwards.
Deny by default; the routes that legitimately run before an identity exists are
named in a list short enough to read and argue with.

**The allowlist, and why each entry is on it:**

| Route | Why |
| --- | --- |
| `POST /users` | Creates the account. There is no identity yet, by definition. |
| `POST /users/sign-in` | May be what creates the document for an account that authenticated first. |
| `POST /devices/lock-check` | Device binding, in the SIGN-IN flow, before any account exists. Already carved out of the ban gate for the same reason. |
| `POST/GET /device-info` | How the app LEARNS it is banned. Gating it replaces the ban screen with a generic error while enforcing nothing. |

Matched on **method and exact path**, so `GET /users` (a listing) is not exempt
and `/users/50000010/appeal` cannot inherit `/users`'s exemption by prefix.
A ratchet test pins the list, so adding to it is a deliberate act.

**The guard is on PRESENCE, not type.** The first attempt used
`Number.isInteger`, which fixed the hole and also changed an unrelated
contract: this codebase is inconsistent about whether a uniqueId is a number or
a string — the seeded personas use numbers, several suites use strings — so a
type gate would have locked out real callers for a reason nobody asked about.
The defect is `null` collapsing every unidentified caller into one account
because `null === null`. That, and only that, is refused.

**A distinct 403 `no_identity`, not a 401.** The credential was fine. A client
needs to tell "sign in again" from "your account is in a state we cannot
resolve" — the second is a bug report, not a retry.

### What the full suite then said

The change was made and all 15,335 Express tests run. 77 failures across 5
suites, every one of them informative:

- **`devices/lock-check` and `device-info`** genuinely run pre-identity. Added
  to the allowlist — the suite found them, not guesswork.
- **Twelve admin fixtures** used `mintTokenWithoutUserDoc({ admin: true })` — an
  admin with no `users` document, which is not a real shape. `requireAdmin`
  writes `req.auth.uniqueId` into the audit log, so such an admin writes
  `adminUid: null`, which is this very bug. Given real documents.
- **Four tests PINNED the defect**: three asserting a null uniqueId passes
  through a user-scoped route, and one asserting livekit's "User profile not
  found" — a fair message from a route that should never have been handed a
  null identity. All four inverted.

Final: **491 suites, 15,335 tests, all passing. Lint clean.**

### The open question, and where it now stands

The story asked whether a real user can reach `uniqueId: null` in production.
**That is still unanswered, and it now matters far less.** Whether or not they
can, they are refused rather than being merged into a shared "null account"
with every other unidentified caller — including the ban and suspension bypass,
which was the sharpest part. The measurement is still worth taking; it is no
longer load-bearing for safety.

