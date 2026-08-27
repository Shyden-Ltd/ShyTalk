---
id: SHY-0461
status: Done
owner: unassigned
created: 2026-08-25
updated: 2026-08-26
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0005
released_in: v0.99.0
---

# SHY-0461: A suspended person is told the app cannot connect, and can never appeal

## User Story

As **somebody whose account has been suspended or banned**, I want to be told
which it is and offered the way back, so that I can answer the accusation
instead of staring at a connection error.

## Why

A suspended person signs in and is shown the **"cannot connect"** screen. Not
the suspension screen. Not the reason. Not the appeal form. A **banned** person
gets the same wrong screen, for the same reason.

### The mechanism (re-verified 2026-08-26 — the original filing was wrong)

The first filing said the app discovers suspension by reading its own user
document, and that suspension forbids that read. **Both halves are false**, and
building on them would have added a route nobody needs.

The own-document read is **allowed**. `firestore.rules` gates `users/{uniqueId}`
reads on `callerUniqueId() == int(uniqueId) || cohortMatchesCaller() ||
isAdmin()` — an own-doc carve-out with no standing check. Proven against the
local stack as the suspended user:

```
GET  users/50000050  (Firestore, as suspended Raul)  -> 200
     isSuspended=true  suspensionReason="…"  suspensionCanAppeal=true
```

The real blocker is **one step earlier**. `AuthViewModel.resolveIdentityAndProceed`
opens with `identityRepository.resolveIdentity(...)` → `POST /api/users/sign-in`,
and the global `authMiddleware` refuses it:

```
POST /api/users/sign-in   (suspended) -> 403 {"error":"Account suspended"}
POST /api/users/sign-in   (banned)    -> 403 {"error":"Account banned", code:"banned", …}
POST /api/devices/lock-check (suspended) -> 403 {"error":"Account suspended"}
POST /api/device-info        (suspended) -> 403 {"error":"Account suspended"}
POST /api/appeals            (suspended) -> 400 {"error":"appealText is required"}
```

Identity resolution never completes, so the app never reaches the user document
it is allowed to read, never reaches `checkAndApplyBan()`, and never learns
anything about itself. `resolveIdentity` surfaces the refusal as a generic
`Resource.Error`; `handleBackendError` classifies it as neither an auth error
nor a success, so it lands in the only remaining branch —
`isBackendUnreachable = true` — and renders `signIn_retryConnection`.

### The route already answers this correctly, and the answer is dead code

`POST /users/sign-in` **already** carries a deliberate branch for exactly this
case, added by Audit M5 (Phase 2A) so the client could surface suspension
without the account being mutated first:

```js
if (isSuspended) {
  return res.json({ found: true, suspended: true, uniqueId });   // no mutation
}
```

The middleware 403s the request before that line can run. Nothing needs
building; the middleware needs to stop shadowing what exists.

### It is a class, not an instance

`PRE_IDENTITY_ROUTES` lists the routes that run **before** an identity — and
therefore before a standing — can be known: `POST /users`,
`POST /users/sign-in`, `POST /devices/lock-check`, `POST|GET /device-info`.
Gating any of them on standing is circular by construction.

Both standing gates do it. `isSuspensionExemptPath` exempts **none** of them.
`isBanExemptPath` exempts `/device-info` and `/devices/lock-check` — its own
comment says they are how "the app LEARNS it is banned" — but not
`/users/sign-in`, which every one of them runs after. The rule was derived
correctly for two routes out of four, and never carried to the suspension gate
at all.

For a minors-facing product with a moderation process, a person who cannot see
why they were refused and cannot answer it is a compliance problem, not only a
UX one.

Found by rewriting J11 to sign in as the suspended person on a real phone
([[SHY-0457]]). The previous J11 POSTed to `/api/appeals` with a token and never
went near the sign-in screen, so it reported this cycle green for months.

## Acceptance Criteria

### Happy path

- [ ] A suspended person signing in sees the suspension screen: the reason, the
      end date, and the appeal form.
- [ ] They can submit an appeal from that screen.
- [ ] A banned person signing in sees the ban screen, with the reason and expiry.

### Error paths

- [ ] A genuine connectivity failure still shows the connection screen. The two
      must be distinguishable — conflating them is the defect.
- [ ] A refusal carrying a standing verdict (`Account suspended` /
      `Account banned`) is never reported as unreachable, from any call site.

### Edge cases

- [ ] A person suspended DURING a session reaches the same screen, not a silent
      failure.
- [ ] A suspended person can still exercise deletion and data-export, which are
      already exempt and must stay so.
- [ ] Every route that is NOT pre-identity still refuses a suspended or banned
      caller with 403. The gate must not be widened beyond the class.

### Performance

- [ ] No extra round trip on the normal sign-in path.
- [ ] A standing verdict is not retried. It is deterministic, so the current
      transient-retry budget spends ~1.2s per call re-asking a settled question.

### Security

- [ ] Exempting `POST /users/sign-in` must NOT let a suspended or banned caller
      mutate anything. The suspension branch already returns before
      `update({ firebaseUid, lastSeenAt })` and the custom-claim grant; the ban
      path needs the same branch, or the exemption reintroduces the exact
      Audit M5 (Phase 2A) hazard.
- [ ] The response exposes only the caller's own standing. Nothing else.

### UX

- [ ] The reason is shown. "You are suspended" without a reason is not an
      answer a person can act on.

### i18n

- [ ] Existing suspension and ban strings already ship in 21 locales; no new
      ones.

### Observability

- [ ] A refusal classified as a standing verdict is logged as such, so this
      cannot recur silently.

## BDD Scenarios

**Scenario: A suspended person opens the app**

- **Given** somebody whose account has been suspended
- **When** they sign in
- **Then** they are told they are suspended and why
- **And** they are offered the appeal

**Scenario: A banned person opens the app**

- **Given** somebody whose device has been banned
- **When** they sign in
- **Then** they are told they are banned and why

**Scenario: The backend really is down**

- **Given** an app that cannot reach the server at all
- **When** somebody signs in
- **Then** they are told the connection failed, not that they are suspended

## Test Plan

| Layer | What it proves |
| --- | --- |
| API | Every `PRE_IDENTITY_ROUTES` entry answers a suspended caller, not 403. |
| API | Every `PRE_IDENTITY_ROUTES` entry answers a banned caller, not 403. |
| API | Sign-in as a suspended caller returns `suspended:true` and mutates nothing. |
| API | Sign-in as a banned caller returns the verdict and mutates nothing. |
| API | A route outside the class still 403s both standings — no widening. |
| Unit | A refusal carrying a standing verdict maps to suspended/banned, not unreachable. |
| Unit | A transport failure still maps to unreachable. |
| Unit | A standing verdict is never retried; a transient failure still is. |
| Device | J11 on a real phone: Raul signs in, meets the suspension screen, appeals. |

## Out of Scope

- Redesigning the suspension screen. It already exists and is already
  translated; it simply never appears.
- A dedicated self-status route. The original filing proposed one; the sign-in
  route already returns the caller's own standing and nothing else.

## Dependencies

- [[SHY-0457]] — the journey rewrite that found it.
- Related to [[EPIC-0005]] ban-enforcement hardening.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Exempting sign-in lets a banned caller refresh `firebaseUid` and take custom claims | Give the route a ban branch that returns the verdict BEFORE any mutation, mirroring the suspension branch. Asserted by a test that reads the doc after the call. |
| The exemption is widened past the pre-identity class | The exemption is derived FROM `PRE_IDENTITY_ROUTES`, not hand-listed, so the two cannot drift. A test asserts a non-member route still 403s. |
| The two failure modes get conflated again | A unit test asserts each maps to its own state, in both directions. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] J11 green on both real devices, driving the suspension screen.

## Notes

- Filed 2026-08-25. Mechanism corrected 2026-08-26 after reproducing against the
  local stack: the original diagnosis named the wrong call and the wrong layer.
- Scope widened the same day to the ban twin. One root cause, one indivisible
  fix — splitting it would produce two PRs that must land together.
