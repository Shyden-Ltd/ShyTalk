---
id: SHY-0503
status: Draft
owner: unassigned
created: 2026-09-04
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0013
---

# SHY-0503: The admin dashboard lets a login with no ShyTalk account in

## User Story

As **the operator signing in to the admin dashboard**, I want a login that has
no ShyTalk account to be refused at the door and told why, so that I am never
shown a dashboard where every tab is present and nothing works.

## Why

Reported by the operator on 2026-09-04, on dev: the dashboard opened with all
its tabs, and every one of them failed with "Your account could not be
identified".

Two surfaces share one missing rule — *ask the server who this is before
showing anything* — and fail it in different ways.

**The dashboard never asks.** Its only gate is a flag inside the sign-in token
(`public/admin/js/main.js:327-349`): if the token says `admin`, the page shows
the dashboard and imports every tab module (`main.js:111-121`). The server,
since SHY-0426, refuses every request from a login whose Firebase uid has no
`users` document (`express-api/src/middleware/auth.js:295` and `:574`, via
`rejectMissingIdentity` at `:416`, answering `code: 'no_identity'`). So a login
with the flag but no account sees the whole dashboard and then watches each
tab fail. That is the operator's login: an admin flag set outside any API on a
password account that was never a ShyTalk account (SHY-0505 ends that path).

**The portal asks, but no longer understands the answer.** It calls the
identity endpoint first (`public/portal/portal.js:261`) and has a "no account"
screen for a missing account (`portal.js:290-295`, `no-account-section`). That
branch keyed on a not-found answer. Since SHY-0426 the refusal arrives as a
forbidden answer with `code: 'no_identity'` — which falls into the "other
forbidden → sign out" branch (`portal.js:287-289`). The person is silently
bounced to the sign-in form; the screen written for exactly this case is dead
code.

One more gap makes the fix fragile: the admin refusal (`requireAdmin`,
`auth.js:645-662`) carries only English text, no machine-readable `code`, so a
page cannot branch on it without matching prose.

## Acceptance Criteria

### Happy path

- [ ] Dashboard: after Firebase sign-in, `main.js` calls `GET /api/portal/me`
      and shows the dashboard (`showScreen('dashboard')`, `main.js:349`) only
      when the answer is OK with `isAdmin: true`. Tab modules are imported
      after that answer, not before.
- [ ] Portal: an answer with `code: 'no_identity'` shows `no-account-section`
      and signs the person out — the behaviour the not-found branch had before
      SHY-0426.
- [ ] An administrator with a ShyTalk account signs in exactly as today, on
      both surfaces.

### Error paths

- [ ] `code: 'no_identity'` on the dashboard: the sign-in form shows "This
      login has no ShyTalk account. Create your account in the ShyTalk app with
      Google or Apple, then sign in here." and the person is signed out. No tab
      module is imported.
- [ ] `requireAdmin` refusals carry `code: 'admin_required'` on both of its
      branches (`auth.js:648`, `:657`); the dashboard branches on the code and
      shows the existing "Access denied — admin privileges required" message.
- [ ] `code: 'banned'`: the dashboard shows the ban notice and signs out. The
      wording is SHY-0417's; this story only routes to it.
- [ ] `isSuspended: true`: the dashboard shows "Your account is suspended.
      Administration is not available." and does not open.
- [ ] Network failure or a server error: "We could not check your account.
      Try again." — the form stays, nothing loads, the console-errors spec stays
      clean.

### Edge cases

- [ ] The token says admin but the server says not (a demotion within the
      hour): refused. The server's answer wins.
- [ ] Sign-out during the identity check: the late answer is ignored; no
      dashboard flash.
- [ ] A second auth-state event while a check is in flight does not start a
      second check or show the dashboard twice.
- [ ] `uniqueId: 0` is a real account and is not treated as missing (the
      server already guarantees this; the page must not add a truthiness test).

### Performance

- [ ] One extra request per sign-in. On the local stack the dashboard is
      visible within one second of the identity answer. Tab modules for a
      refused login are never fetched — asserted from the browser's network
      log, not assumed.

### Security

- [ ] Entry is decided by the server's answer. A static pin asserts that
      `showScreen('dashboard')` is reachable in `main.js` only after a
      successful identity answer, and that no code path shows it from the
      token claim alone.
- [ ] No tab module runs and no Firestore listener opens for a refused login.

### UX

- [ ] Every refusal says what happened and what to do, in plain words (exact
      wording in the error paths above). Messages render in the existing
      `#login-error` live region so screen readers announce them.

### i18n

- [ ] The new strings exist in all five shipped locales (`en`, `zh`, `id`,
      `vi`, `th`) in both `public/admin/translations.js` and
      `public/portal/portal-translations.js`; tests assert the rendered text,
      not the key.

### Observability

- [ ] The server's existing warning `Refused a caller with no resolved
      identity` (`auth.js:411`) fires once per refused sign-in with the uid,
      method and path — asserted in the middleware test.
- [ ] The dashboard reports the refusal code through its existing logger
      (`ShyTalkLogger`, source `admin-panel`) so a refused login is visible in
      the Logs tab to an administrator who *can* get in.

## BDD Scenarios

**Scenario: A login with no ShyTalk account is turned away at the door**

- **Given** somebody has a Google login but never created a ShyTalk account
- **When** they sign in to the admin dashboard
- **Then** they are told this login has no ShyTalk account and how to create one
- **And** no part of the dashboard is shown

**Scenario: An administrator gets in as before**

- **Given** an administrator with a ShyTalk account
- **When** they sign in to the admin dashboard
- **Then** the dashboard opens

**Scenario: A member without admin rights is refused**

- **Given** a member with a ShyTalk account but no administrator rights
- **When** they sign in to the admin dashboard
- **Then** they are told administrator access is required
- **And** nothing else is shown

**Scenario: The portal tells a person they have no account**

- **Given** somebody with a login but no ShyTalk account
- **When** they sign in to the portal
- **Then** they see the page telling them to create their account in the app

**Scenario: The server cannot be reached**

- **Given** the server cannot be reached
- **When** an administrator signs in to the admin dashboard
- **Then** they are told their account could not be checked and to try again
- **And** nothing is shown as if it had worked

**Scenario: A demoted administrator is kept out**

- **Given** an administrator whose rights were removed a few minutes ago
- **When** they sign in to the admin dashboard
- **Then** they are refused

**Scenario: A suspended administrator cannot administer**

- **Given** an administrator whose own account is suspended
- **When** they sign in to the admin dashboard
- **Then** they see the suspension notice, not the dashboard

## Test Plan

### Red

- `tests/web/admin-login.spec.ts` — new tests against the local stack:
  `a login with no ShyTalk account is told so and signed out`,
  `a member without admin rights is refused with the admin message`,
  `no tab module is fetched for a refused login` (network log assertion),
  `a suspended administrator sees the suspension notice`. The
  claim-without-account fixture is created through the Auth emulator's own
  API in the spec — the same lever J40 uses — and removed in `afterAll`.
- `tests/web/portal-auth.spec.ts` — `a login with no ShyTalk account sees the
  no-account page` (currently fails: the page bounces to sign-in).
- `express-api/tests/middleware/auth-admin-required-code.test.js` —
  `requireAdmin` answers `code: 'admin_required'` on the token branch and on
  the live-claim branch; the existing `no_identity` refusal logs uid, method
  and path.
- `express-api/tests/admin-client/login-gate-static.test.js` — pins that
  `main.js` awaits the identity call before `showScreen('dashboard')`, and that
  `portal.js` branches on `code === 'no_identity'`, not on a status alone.
- Every rendered string asserted in all five locales.

### Green

- `main.js`: one `resolveIdentity()` after `onAuthStateChanged`, with a
  generation counter so a late answer after sign-out is ignored; tab imports
  move behind it. `portal.js`: `no_identity` joins the branch list. `auth.js`:
  `code` on both `requireAdmin` refusals. Strings in both translation files.

## Out of Scope

- Google and Apple sign-in on the dashboard — SHY-0504.
- Granting administrator rights — SHY-0505.
- Turning the two-factor refusals (`MFA required`, `Re-verify TOTP`) into codes
  — SHY-0409 owns two-factor.
- The ban notice's wording — SHY-0417.

## Dependencies

- SHY-0426 (In Review) — introduced the identity refusal both surfaces must
  now understand. This story adapts to it; it does not change it.
- SHY-0417 — the ban branch routes to the notice that story defines.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The "claim but no account" fixture cannot exist on dev or prod | It exists only against the Auth emulator; on dev the operator's own login is the proof, which is the report that raised this. |
| The extra request slows sign-in | Tab modules load after the answer instead of before; the net first-tab time is unchanged and refused logins get faster. |
| Branching on English error text somewhere else | The static pin fails on any `error === '…'` comparison added to the login path; codes are the contract. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the operator signs in on dev with the hotmail login and is
      told it has no ShyTalk account, with nothing else shown; the seeded admin
      persona still opens the dashboard.
- [ ] Browser specs green locally and in CI; evidence page signed off.

## Notes

- **2026-09-04** — Filed from the operator's report. The hotmail login has an
  admin flag set outside any API and no `users` document; SHY-0505 gives that
  flag an owner. Portal regression confirmed by reading `auth.js:295` — the
  identity refusal runs before every route, so the portal's not-found branch
  has been unreachable since SHY-0426 landed on dev.
