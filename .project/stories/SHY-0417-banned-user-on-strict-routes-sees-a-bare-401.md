---
id: SHY-0417
status: Draft
owner: unassigned
created: 2026-08-21
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0417: A banned user on portal/admin routes is told nothing, not that they are banned

## User Story

As **somebody who has been banned**, I want to be told that I am banned and
why, so that I can appeal it instead of thinking the app is broken.

## Why

Found while root-causing SHY-0308.

`authMiddlewareStrict` verifies with revocation checking on:

```js
const decoded = await auth.verifyIdToken(idToken, true);
```

Banning revokes the account's refresh tokens — `syncBannedClaim` calls
`auth.revokeRefreshTokens(firebaseUid)` on purpose, so a banned session cannot
outlive its current ID token. Unlike the non-strict path, this is production
behaviour, not an emulator artefact.

So for a banned user whose token was minted before the ban — which is every
already-signed-in user, the normal case — the strict path rejects the
credential first and the ban gate never runs. They receive:

```
401 { "error": "Authentication failed", "code": "token_rejected" }
```

**This contradicts the middleware's own stated intent.** From the docblock
above `isBanExemptPath`:

> ONE deliberate subtraction: `/portal/me`. […] portal.js has no ban branch at
> all, so exempting a BANNED user would hand them a normal-looking dashboard
> with no hint they are banned. The gate's own 403 (`code: 'banned'` + reason +
> expiresAt) **IS the ban notice**, and it is the same shape every other client
> already renders.

`/portal/me` was deliberately kept non-exempt so the ban notice would reach
them. Revocation means it does not. The subtraction was reasoned about
carefully and then quietly defeated one layer up.

### Why it matters

A banned person who sees "Authentication failed" has no idea they were banned,
no reason, no expiry, and no route to the appeal flow that SHY-0149 went out of
its way to keep reachable. Being unable to tell a moderation decision from a
broken login is a safeguarding and appeals problem, not a cosmetic one — and it
lands on a platform with a minor cohort present.

### What it is NOT

The request is still refused, so this is not a bypass. It is a wrong answer,
not an open door.

## Acceptance Criteria

### Happy path

- [ ] A banned user with a pre-ban token reaching a strict route receives the
      ban notice — 403, `code: 'banned'`, reason, and expiry — not a bare 401.
- [ ] The notice carries the same shape every other client already renders, so
      no client needs a second code path.

### Error paths

- [ ] A genuinely bad credential (expired, malformed, wrong audience) still
      answers 401 `token_rejected`. Being banned must not become a way to make
      a rejected token look like something else.
- [ ] If the ban lookup cannot complete, the request is still refused —
      fail-closed is unchanged.

### Edge cases

- [ ] A SUSPENDED user, whose tokens are also revoked on some paths, is
      likewise told what happened rather than given a bare 401.
- [ ] An unbanned user with a legitimately revoked session (sign-out
      everywhere, password change) still gets 401 — they are not shown a ban
      notice they have not earned.
- [ ] `/portal/sign-out` keeps working while banned. A ban is not a reason to
      trap somebody in a session.

### Performance

- [ ] No extra Firestore read on the ordinary path. Any ban lookup for a
      revoked token happens only on the rejection path, which is rare.

### Security

- [ ] A revoked token must NOT become usable for anything beyond being told the
      standing. It authorises no action, no data read, and no write.
- [ ] Proven by mutation: a mutant that lets a revoked token through to a route
      handler must redden a test.

### UX

- [ ] The reason shown is the ban reason, in the reader's language, and the
      appeal route is reachable from it.

### i18n

- [ ] Asserted on rendered text per locale, not on the presence of a key.

### Observability

- [ ] The two cases are distinguishable in logs: a banned revoked token and an
      ordinary revoked token.

## BDD Scenarios

**Scenario: a banned person is told they are banned**

- **Given** somebody was banned while signed in
- **When** they open their account page
- **Then** they are told they are banned and why

**Scenario: an ordinary expired session still just asks them to sign in**

- **Given** somebody in good standing whose session has expired
- **When** they open their account page
- **Then** they are asked to sign in again, with no mention of a ban

## Test Plan

| Layer | What it proves |
| --- | --- |
| Middleware integration (real emulator) | A revoked token belonging to a banned account answers the ban notice; a revoked token on a clean account answers 401. |
| Contract | The 403 body is exactly the shape the existing clients render — no new field, no missing one. |
| Mutation | Letting a revoked token reach a route handler reddens a test. |
| Journey | A banned person signs in and reads the notice; the appeal route is reachable from it. |

## Out of Scope

- The non-strict path, which does not check revocation in production. Its
  emulator-only divergence is documented in SHY-0308.
- Whether a failed standing lookup should keep answering 401 — a separate
  decision recorded in SHY-0308.

## Dependencies

- None. `checkUserBans` already returns everything the notice needs.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Reading standing from a revoked token widens what a revoked token can do | It authorises nothing: the only outcome is a refusal that names the reason. Pinned by the Security AC and a mutant. |
| A clean expired session gets shown a ban notice | Explicit AC + test for the unbanned revoked case. |
| The extra lookup slows the hot path | It runs only on the rejection path, never on a successful verification. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Seen on a real device: a banned account is told why.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes

- Found 2026-08-21 while root-causing SHY-0308, which confirmed
  `auth/id-token-revoked` as the cause of that suite's intermittent 401. The
  strict path's version of the same interaction is not intermittent and not an
  emulator artefact — it is what production does today.
