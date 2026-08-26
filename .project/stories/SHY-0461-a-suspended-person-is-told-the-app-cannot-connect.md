---
id: SHY-0461
status: Draft
owner: unassigned
created: 2026-08-25
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0005
---

# SHY-0461: A suspended person is told the app cannot connect, and can never appeal

## User Story

As **somebody who has been suspended**, I want to be told that I am suspended
and offered the appeal, so that I can answer the accusation instead of staring
at a connection error.

## Why

A suspended person signs in and is shown the **"cannot connect"** screen. Not
the suspension screen. Not the reason. Not the appeal form.

The app discovers suspension by reading the signed-in user's own document
(`AuthViewModel` → `userRepository.getUser(userId)` → `user.isActivelySuspended`).
Being suspended forbids that read:

```
GET /api/users/50000050        -> 403 {"error":"Account suspended"}
GET /api/appeals               -> 403 {"error":"Account suspended"}
```

`isSuspensionExemptPath` carves out the appeal flow, deletion, data-export and
the portal — but **not** reading your own user document. So the app cannot
learn why it was refused, falls through to
`_uiState.update { it.copy(isBackendUnreachable = true) }`, and renders
`signIn_retryConnection`.

Verified on the OnePlus 2026-08-25, with Firestore agreeing the account really
was suspended and appealable:

```
users/50000050  isSuspended=true  canAppeal=true  reason="harassment confirmed"
screen:         signIn_retryConnection
```

The appeal endpoint IS exempt (`POST /appeals`), so the right exists — it is
simply unreachable, because the only screen that offers it never appears. For a
minors-facing product with a moderation process, a person who cannot see why
they were suspended and cannot answer it is a compliance problem, not only a
UX one.

Found by rewriting J11 to sign in as the suspended person on a real phone
([[SHY-0457]]). The previous J11 POSTed to `/api/appeals` with a token and never
went near the sign-in screen, so it reported this cycle green for months.

## Acceptance Criteria

### Happy path

- [ ] A suspended person signing in sees the suspension screen: the reason, the
      end date, and the appeal form.
- [ ] They can submit an appeal from that screen.

### Error paths

- [ ] A genuine connectivity failure still shows the connection screen. The two
      must be distinguishable — conflating them is the defect.
- [ ] A refused read that carries `Account suspended` is never reported as
      unreachable.

### Edge cases

- [ ] A person suspended DURING a session reaches the same screen, not a silent
      failure.
- [ ] A suspended person can still exercise deletion and data-export, which are
      already exempt and must stay so.

### Performance

- [ ] No extra round trip on the normal sign-in path.

### Security

- [ ] Whatever becomes readable must expose only the caller's own suspension
      state — reason, end date, appeal status. Nothing else.

### UX

- [ ] The reason is shown. "You are suspended" without a reason is not an
      answer a person can act on.

### i18n

- [ ] Existing suspension strings already ship in 21 locales; no new ones if
      possible.

### Observability

- [ ] A 403 classified as unreachable is logged as such, so this cannot recur
      silently.

## BDD Scenarios

**Scenario: A suspended person opens the app**

- **Given** somebody whose account has been suspended
- **When** they sign in
- **Then** they are told they are suspended and why
- **And** they are offered the appeal

**Scenario: The backend really is down**

- **Given** an app that cannot reach the server at all
- **When** somebody signs in
- **Then** they are told the connection failed, not that they are suspended

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | A 403 carrying "Account suspended" maps to suspended, not unreachable. |
| Unit | A transport failure still maps to unreachable. |
| Device | J11 on a real phone: Raul signs in, meets the suspension screen, appeals. |

## Out of Scope

- Redesigning the suspension screen. It already exists and is already
  translated; it simply never appears.

## Dependencies

- [[SHY-0457]] — the journey rewrite that found it.
- Related to [[EPIC-0005]] ban-enforcement hardening.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Exempting the user-doc read widens what a suspended caller can see | Return only the caller's own suspension fields, or add a dedicated self-status route that discloses nothing else. |
| The two failure modes get conflated again | A unit test asserts each maps to its own state, in both directions. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] J11 green on both real devices, driving the suspension screen.

## Notes

- Filed 2026-08-25. J11 stays red until this is fixed: the journey is correct,
  the product is not.
