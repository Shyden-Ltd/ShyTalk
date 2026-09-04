---
id: SHY-0504
status: Draft
owner: unassigned
created: 2026-09-04
priority: P1
effort: S
type: feature
roadmap_ids: []
mvp: true
epic: EPIC-0013
---

# SHY-0504: Staff sign in to the admin dashboard with Google or Apple, like the app

## User Story

As **the operator**, I want to sign in to the admin dashboard with the same
Google or Apple ShyTalk account I use in the app, so that my administrator
identity is my real ShyTalk account and no password-only staff login exists.

## Why

The app offers only Google and Apple sign-in (`shared/…/AuthRepository.kt:
71-73`). The admin dashboard offers only email and password
(`public/admin/js/main.js:457`, form at `public/admin/index.html:3160-3164`).
Nothing connects the two: there is no way for a person who is a ShyTalk member
to become the administrator *as themselves*. So administration has run on a
password login created outside the product, with an admin flag set in the
Firebase console — the operator's `sasteberis@hotmail.co.uk`, which SHY-0503
now refuses because it has never been a ShyTalk account.

The portal already signs in with Google and Apple (`public/portal/portal.js:
372-440`), forces the account chooser (`prompt: 'select_account'`, `:388`,
matching `public/js/roadmap-auth.js:195`) and falls back to a full-page
redirect when the popup is blocked. The dashboard borrows that behaviour on
its own SDK (it uses the modular Firebase SDK; the portal uses compat).

Operator decision 2026-09-04: staff sign in with Google or Apple ShyTalk
accounts only; email sign-up for everyone is EPIC-0014, post-MVP.

## Acceptance Criteria

### Happy path

- [ ] The dashboard sign-in screen offers **Sign in with Google** and **Sign
      in with Apple** buttons above the existing form, in the same order and
      style as the portal's (`btn--google`, `btn--apple`).
- [ ] Google and Apple use a popup with the account chooser forced, and fall
      back to a full-page redirect when the popup is blocked; after the
      redirect the person lands back on the dashboard sign-in flow.
- [ ] After provider sign-in the SHY-0503 identity check runs; an
      administrator whose ShyTalk account holds the admin role lands in the
      dashboard.
- [ ] The password form is shown only where seeded test personas exist: when
      `CONFIG.PASSWORD_SIGN_IN === true` (`public/admin/config.js` for local
      and `config.dev.js` for dev). Production config omits it and the form is
      not rendered.

### Error paths

- [ ] A Google or Apple login with no ShyTalk account gets SHY-0503's
      no-account message.
- [ ] A ShyTalk account without the admin role gets the admin-required
      message.
- [ ] Closing the popup shows nothing; a blocked popup silently falls back to
      redirect; any other provider error shows "Sign-in with Google failed.
      Try again." (or Apple) in `#login-error`.
- [ ] `auth/account-exists-with-different-credential` shows "This email is
      already used with a different sign-in method. Use that method."

### Edge cases

- [ ] Sign-out ends the provider session for this page; the next sign-in shows
      the account chooser again rather than silently reusing the last account.
- [ ] Redirect return with an expired or cancelled result shows the sign-in
      form, not a spinner.
- [ ] Both provider buttons disabled while a sign-in is in flight; re-enabled
      on any outcome.
- [ ] With the password form hidden, the existing `admin-login.spec.ts`
      password tests skip with a named reason rather than failing.

### Performance

- [ ] No request beyond the provider round-trip and SHY-0503's single identity
      call. Buttons are interactive as soon as the page's own script has run.

### Security

- [ ] No client secret in the page; provider configuration lives in Firebase.
- [ ] Authorised domains for the web OAuth clients include `localhost`, the
      dev site and the production site (Firebase console; operator step listed
      under Dependencies), verified by signing in on each.
- [ ] Entry is still decided by SHY-0503's server check. Provider sign-in
      grants nothing by itself.

### UX

- [ ] Buttons are keyboard focusable with visible focus, carry the provider
      name as their accessible name, and the form's tab order is Google, Apple,
      then the password form where present.

### i18n

- [ ] Button labels and the two new error strings exist in all five shipped
      locales in `public/admin/translations.js`; rendered text asserted.

### Observability

- [ ] The dashboard's logger records `signed in via <provider>` on success and
      the provider error code on failure, so a stuck sign-in is diagnosable
      from the Logs tab.

## BDD Scenarios

**Scenario: An administrator signs in with Google**

- **Given** an administrator whose ShyTalk account was created with Google
- **When** they choose Sign in with Google on the admin dashboard
- **Then** the dashboard opens

**Scenario: An administrator signs in with Apple**

- **Given** an administrator whose ShyTalk account was created with Apple
- **When** they choose Sign in with Apple on the admin dashboard
- **Then** the dashboard opens

**Scenario: A Google login without a ShyTalk account is turned away**

- **Given** somebody with a Google login and no ShyTalk account
- **When** they choose Sign in with Google on the admin dashboard
- **Then** they are told this login has no ShyTalk account and how to create one

**Scenario: A blocked popup still lets the person sign in**

- **Given** the browser blocks popups
- **When** an administrator chooses Sign in with Google
- **Then** the sign-in continues as a full page and returns them to the dashboard

**Scenario: Production offers only Google and Apple**

- **Given** the admin dashboard is running in production
- **When** the sign-in screen is shown
- **Then** only Google and Apple are offered

**Scenario: The local stack still offers the test-account form**

- **Given** the admin dashboard is running on the local stack
- **When** the sign-in screen is shown
- **Then** Google, Apple and the test-account password form are all offered

## Test Plan

### Red

- `tests/web/admin-login.spec.ts` — new describe `Provider sign-in`: drives
  the Auth emulator's provider widget (it renders a fake account chooser
  where a spec can add an account), asserts the dashboard opens for a seeded
  admin's Google identity and the no-account message for a fresh one;
  `password form is hidden when config does not allow it` by serving the page
  with a production-shaped config.
- `express-api/tests/admin-client/provider-sign-in-static.test.js` — pins
  `prompt: 'select_account'`, the popup-to-redirect fallback, and that the
  password form is gated on `CONFIG.PASSWORD_SIGN_IN`.
- Rendered labels asserted in all five locales.

### Green

- Buttons in `index.html`; handlers in `main.js` using `GoogleAuthProvider`,
  `OAuthProvider('apple.com')`, `signInWithPopup` / `signInWithRedirect`;
  `CONFIG.PASSWORD_SIGN_IN` in the local and dev config files and their
  `.example` twins; strings in `translations.js`.

## Out of Scope

- Removing password sign-in from local and dev — the seeded personas and the
  journey harness use it; SHY-0511 revisits when the page is retired.
- The portal's sign-in — it already has both providers.
- Granting the admin role to the operator's Google account — SHY-0505.

## Dependencies

- SHY-0503 must land first: provider sign-in without the server gate would
  widen today's defect to more logins.
- Operator: confirm the dev and production sites are authorised domains for
  the Google and Apple web clients in the Firebase console (they are for the
  portal, which shares the origin, so this is a check, not new work).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The emulator's provider flow differs from real Google | Emulator proves the page logic; the operator signs in with real Google on dev as the evidence step. |
| Apple's web sign-in needs a Services ID and return URL | Already configured for the portal on the same origin; the spec on dev proves it. |
| Hiding the password form breaks CI | CI runs against local and dev configs where `PASSWORD_SIGN_IN` is true; the specs assert both shapes. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Dev-verified: the operator signs in to the dev dashboard with Google and,
      after SHY-0505, lands in it as himself.
- [ ] Evidence page signed off.

## Notes

- **2026-09-04** — Filed with EPIC-0013. The operator's answer to "how should
  staff sign in" was Google or Apple ShyTalk accounts only for now, with email
  sign-up for everyone as a later post-MVP epic (EPIC-0014).
