---
id: SHY-0147
status: Draft
owner: claude
created: 2026-07-01
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0004
pr:
mvp: true
---

# SHY-0147: Portal "remember this browser" for TOTP (bounded MFA-verified window)

## User Story

**As** a privileged user of the web portal,
**I want** to tick "remember this browser" after I enter my authenticator code, so I'm not asked for a code on every single visit — only after a set period, or on a new browser,
**So that** the portal stops re-prompting MFA every visit, while my account stays protected (re-verification still happens when the window expires, on any unrecognised browser, and when I sign out).

## Why

The portal re-prompts the TOTP (authenticator) code on **every** page load, and it's **server-enforced**: `public/portal/portal.js` handles the signed-in state, calls `/api/portal/me`, the server returns `403 "MFA required"` (`portal.js:250-260`), and the portal shows the code-entry section — with **no memory** that this browser already passed MFA this session. The operator chose (2026-07-01) a **bounded "trust this browser" window** (bank-style "remember this device", e.g. 30 days).

Because the re-prompt is server-driven, this can't be a client-only tweak: after a correct code the **server must issue a short-lived, per-browser MFA-verified token** and honour it on subsequent `/api/portal/me` calls (skip the 403) until it expires; the client offers a "remember this browser" choice and stores the token securely. MFA is a security control, so the design is **fail-closed** (any invalid/expired/absent token → re-prompt) and the window is bounded + revocable.

## Acceptance Criteria

### Happy path
- [ ] After a correct TOTP code with **"remember this browser" ticked**, the server issues a short-lived (configurable, default 30-day) **per-browser MFA-verified token**; subsequent portal visits on that browser go straight to the dashboard **without** the code prompt until the window expires.
- [ ] `/api/portal/me` **honours** a valid MFA-verified token (no `403 "MFA required"`) and **rejects/ignores** an absent/expired/invalid one (re-prompt).
- [ ] The token is issued **only** on a genuinely correct code (never on a failed attempt).

### Error paths
- [ ] **Window expired** → the portal re-prompts for the code on the next visit.
- [ ] **New / unrecognised browser** (no valid token) → re-prompts for the code.
- [ ] **Wrong code** → rejected; nothing is remembered.
- [ ] **Tampered / malformed / forged token** → treated as no token → re-prompt (fail-closed; never skip MFA on a bad token).
- [ ] **Suspended / revoked during the window:** an account that is suspended, has its session revoked, or is force-signed-out **while its browser is still "remembered"** is still blocked on the next visit — shown the suspension screen or signed out, **never** granted the dashboard. The MFA-remember skips only the code prompt; it is **not** an access grant.

### Edge cases
- [ ] **"Remember" unticked** → current behaviour preserved (code prompt on every visit).
- [ ] **Sign-out** → the MFA-verified token is cleared client-side **and** revoked/invalidated server-side, so the next visit on that browser re-prompts.
- [ ] **Per-browser isolation** → remembering on browser A does **not** skip the code on browser B / another device.
- [ ] **Window boundary** → a just-expired token re-prompts (no off-by-one that keeps skipping past expiry).

### Performance
- [ ] Honouring the token is a fast local validation on the existing `/api/portal/me` call — no extra network round-trip added to portal load; no busy-wait.

### Security
- [ ] The MFA-verified token is **short-lived** (bounded window), **server-signed**, **per-browser**, and **revocable** (on sign-out / admin action) — a stolen token is time-bounded and can be invalidated.
- [ ] It is stored securely (prefer an **httpOnly, Secure, SameSite** cookie over JS-readable storage so it isn't script-exfiltratable) and **never logged**.
- [ ] It **does not** replace or weaken the primary password/OAuth login (still required) — it only governs the MFA re-prompt frequency.
- [ ] **Fail-closed:** any doubt (invalid/expired/absent/forged token) → re-prompt MFA; MFA re-verification is enforced at window expiry, on a new browser, and on sign-out.
- [ ] **The MFA-remember token governs ONLY the authenticator re-prompt — it is not an access grant.** Suspension, session revocation, and force-sign-out are **re-evaluated on every `/api/portal/me` call** (the same access checks as today) and still enforced **within** the 30-day window; a remembered browser never bypasses them.

### UX
- [ ] A clear **"remember this browser for 30 days"** choice at code entry; when remembered, the admin lands on the dashboard directly; on expiry the re-prompt is presented as normal (not an error).

### i18n
- [ ] The "remember this browser" choice + any new copy follow the portal's existing localization (English today for this internal privileged surface); no user-facing translated string is dropped or hard-coded outside that mechanism.

### Observability
- [ ] MFA-window lifecycle events are logged for audit (token **issued** · **honoured/skip** · **expired** · **revoked-on-sign-out** · **rejected-bad-token**), capturable per [[feedback-comprehensive-default-debug-logging]] — no secret/token value in the logs.

## BDD Scenarios

**Scenario: ticking "remember this browser" means no code prompt next time**
- **Given** a portal user who signs in and enters their authenticator code with "remember this browser" ticked
- **When** they come back to the portal on the same browser within the trust period
- **Then** they go straight to the dashboard without being asked for a code

**Scenario: the code is asked for again after the trust period ends**
- **Given** a portal user whose "remember this browser" period has expired
- **When** they open the portal
- **Then** they are asked for their authenticator code again

**Scenario: a different browser still asks for the code**
- **Given** a portal user who ticked "remember this browser" on one browser
- **When** they open the portal on a different browser or device
- **Then** they are asked for their authenticator code

**Scenario: signing out forgets the browser**
- **Given** a portal user who ticked "remember this browser"
- **When** they sign out
- **Then** the next visit on that browser asks for their authenticator code again

**Scenario: not ticking "remember" keeps asking every visit**
- **Given** a portal user who does not tick "remember this browser"
- **When** they visit again
- **Then** they are asked for their authenticator code, exactly as before

**Scenario: a bad "remembered" token never skips the code**
- **Given** a portal user whose stored "remembered" proof has been tampered with or has expired
- **When** they open the portal
- **Then** they are asked for their authenticator code (the tampered proof is never trusted)

**Scenario: a suspended user is still blocked, even on a remembered browser**
- **Given** a portal user whose browser is still "remembered" (inside the trust period) but whose account has since been suspended
- **When** they open the portal
- **Then** they are shown the suspension notice, not the dashboard

**Scenario: a revoked session is still signed out, even on a remembered browser**
- **Given** a portal user whose browser is still "remembered" but whose access has been revoked
- **When** they open the portal
- **Then** they are signed out and not allowed into the dashboard

## Test Plan

Touches `express-api/**` (a new MFA-verified token issue/validate + `/api/portal/me` honouring) + `public/portal/**` → **backend change ⇒ Gate 4 forces the FULL app+web+device gauntlet** (per SHY-0127). Security-sensitive (MFA) → careful `code-reviewer` pass. Per § No Stubs: backend runs against the **real Firebase emulator**; the portal flow is driven in **real browsers** via Playwright.

**Red → Green (framework by framework):**
- **Express/Node (Jest, real emulator)**:
  - MFA-verified token: issued only on a correct code; validates within the window; rejects expired/forged/absent; revoked on sign-out. Exact-value matrix over `{valid, expired, forged, absent}` → `{skip-MFA, re-prompt}`.
  - `/api/portal/me`: returns the dashboard payload (no 403) with a valid token; returns `403 "MFA required"` without one. Both create (first verify) + subsequent-visit paths.
- **Playwright (ALL 5 browsers — chromium/firefox/webkit/mobile-chrome/mobile-safari)** `tests/web/`:
  - tick "remember" → correct code → reload/return → dashboard shown, **no** code prompt.
  - expired window (fast-forwarded / short test window) → reload → code prompt returns.
  - second browser context (fresh storage) → code prompt shown (per-browser isolation).
  - sign out → return → code prompt returns.
  - "remember" unticked → every visit prompts.
  - extend `tests/web/portal-auth.spec.ts` (adds the missing MFA-session coverage).
- **Suspension / revocation override the MFA-remember (real emulator + Playwright)** — the security-critical case: with a **valid** remember-token already in place, (a) suspend the account → the portal shows the suspension screen, **not** the dashboard; (b) revoke the session / force-sign-out → the portal signs the user out. Proves the remember-token skips only the code prompt and **never** the access checks (MFA-convenience is not an authorization bypass). Asserted on the emulator (server re-evaluates on `/api/portal/me`) and in-browser.
- **Static/quality:** `npm run lint` 0 warnings (portal JS + express); prettier clean.
- **Phase 1 LOCAL gauntlet:** Gate-4-forced full matrix — all 5 browsers prove the remember-flow + the app/device legs regression-proof.
- **Phase 2:** `code-reviewer` 100% clean (extra scrutiny on the MFA token: bounded, signed, httpOnly, fail-closed, revocable) → In Review → push → CI green by name.
- **Phase 3 (DEV):** re-run the remember-flow against dev (real Firebase) in all browsers; confirm Safari/WebKit stores + honours the cookie within the window.

## Out of Scope
- Cross-browser "stay signed in" coverage for the **public** pages (roadmap/suggestions/admin) — that is **SHY-0148**.
- The **app** session (SHY-0143) and the primary password/OAuth **login** flow (unchanged — only the MFA re-prompt frequency changes).
- Changing the TOTP enrolment flow itself.

## Dependencies
- `public/portal/portal.js` TOTP flow (`:250-260` the 403 gate, `:526-549` code verification) + `/api/portal/me`.
- A new server-side **MFA-verified session token** mechanism (issue on verify, validate on `/api/portal/me`, revoke on sign-out) + secure cookie handling.
- The portal's Firebase auth + the real emulator (backend tests) + the 5-browser Playwright config.

## Risks & Mitigations
- **Risk:** a long-lived / stealable MFA-remember token weakens admin security. **Mitigation:** bounded window (default 30d, configurable), server-signed, per-browser, revocable, httpOnly+Secure+SameSite storage, fail-closed on any doubt; a stolen token is time-bounded and revocable.
- **Risk:** "new browser" detection is too loose → MFA skipped where it shouldn't be. **Mitigation:** conservative — a request without a **valid** token always re-prompts; no fuzzy fingerprint trust.
- **Risk:** Safari/WebKit cookie/ITP handling drops the token early or blocks it. **Mitigation:** first-party httpOnly cookie (not third-party); cross-browser Playwright proves storage + honouring within the window.
- **Risk:** the change accidentally lets the token stand in for the primary login. **Mitigation:** the token governs **only** the MFA re-prompt; the password/OAuth login remains required (explicit test).
- **Risk (operator-flagged):** the MFA-remember becomes an **authorization bypass** — a suspended or revoked admin still gets into the dashboard on a "remembered" browser. **Mitigation:** the token gates only the TOTP step; suspension / revocation / force-sign-out are re-checked on **every** `/api/portal/me` and still enforced within the window — proven by the explicit "suspended/revoked within the 30-day window is still blocked" tests.

## Definition of Done
- [ ] Server MFA-verified token (issue/validate/expire/revoke) + `/api/portal/me` honouring + portal "remember this browser" choice + secure storage implemented.
- [ ] **Pre-Merge Testing Protocol satisfied (Gate-4 full matrix):** Jest RED→GREEN (token matrix + `/api/portal/me`) + Playwright remember-flow on **all 5 browsers** (skip-when-remembered · re-prompt-on-expiry · per-browser · sign-out · unticked · bad-token) + lint/prettier clean → LOCAL full gauntlet green → `code-reviewer` 100% clean (MFA scrutiny) → In Review + `Reviewed-up-to:` → push → CI green by name → DEV gauntlet green (all browsers) → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0004-persistent-session-instant-coldstart]]. Scoped from the web-surfaces Explore map: the portal's TOTP re-prompt is server-enforced (`/api/portal/me` → 403) with no per-session MFA memory. Operator chose (2026-07-01, AskUserQuestion) a **bounded "trust this browser" window (default 30 days)** over keep-re-prompting or remember-until-sign-out, and **`mvp: true`** (launch-blocking). Security-sensitive (MFA) — fail-closed, bounded, revocable, httpOnly. **Operator (2026-07-01) added the invariant:** suspensions / revoked sessions must remain blocked even within the 30-day MFA-remember window — the token skips only the authenticator code, never the access checks (re-evaluated on every `/api/portal/me`; tested explicitly). Sibling web story: SHY-0148 (cross-browser "stay signed in" for the public pages).
