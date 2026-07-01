---
id: SHY-0149
status: Draft
owner: claude
created: 2026-07-01
priority: P1
effort: L
type: bug
roadmap_ids: []
epic: EPIC-0005
pr:
mvp: true
---

# SHY-0149: Enforce bans server-side on every request + fix client-IP / XFF derivation

## User Story

**As** the team relying on bans to keep abusers out,
**I want** bans enforced server-side on every sensitive request — not just when the app chooses to check at sign-in — using the real client IP,
**So that** a banned user cannot evade by using the website, calling the API directly with a valid token, forging a header, running a modified client, or staying signed in past the moment of the ban.

## Why

The bypass-surface review (2026-07-01) found `checkBans()` is invoked in **exactly one place** — `express-api/src/routes/device-info.js:118`, called by the app **once, at sign-in** (`AuthViewModel.checkAndApplyBan()`). Consequences:
- **Web / direct-API (Critical):** `POST /api/suggestions` (create/vote/comment) enforce `requireAuth` + `requireNotSuspended` only (`suggestions.js:390,654,818`); `authMiddleware` checks suspension (`auth.js:196`) but **never bans**. A banned user with a valid token acts freely from the website or `curl`.
- **XFF spoofing (Critical):** `device-info.js:75-76` reads `forwarded.split(',')[0]` — the **leftmost, client-supplied** `X-Forwarded-For` — instead of `req.ip` (which respects `app.set('trust proxy', 1)` at `index.js:33`). A forged `X-Forwarded-For: <clean-ip>, <real-ip>` evades network/IP bans.
- **Mid-session (Major):** suspension is re-checked every request; device/network bans are not — a ban issued after sign-in doesn't bite until the next cold-start.
- **Empty tests (Critical):** `tests/web/suggestions-security.spec.ts:108` ("banned user: direct API call returns 403") has **no body**; `:100`/`:104` likewise. `device-info.test.js` mocks Firestore (violates the § No Stubs policy for a route test).

The fix: add a **per-request ban gate** to the shared `authMiddleware` (mirroring the existing suspension check) so **every** auth-gated sensitive route enforces bans server-side, fed the **correct edge IP**; and fix the IP derivation to use `req.ip`. This is the authoritative counterpart to [[SHY-0143]]'s client-side pre-routing gate.

## Acceptance Criteria

### Happy path
- [ ] An **unbanned** user's requests to sensitive endpoints (create/vote/comment, and other auth-gated mutations) succeed exactly as before.
- [ ] The per-request ban gate lives in the shared `authMiddleware` (alongside the suspension check), so it applies uniformly to every auth-gated sensitive route — app, web, and direct API alike.

### Error paths
- [ ] A **device-banned** user's request to a sensitive endpoint is refused with `403` + a ban reason — from the **website**, the **app**, and a **direct API call**.
- [ ] A **network-banned** user (matched on the **real edge IP** / subnet / ASN) is refused with `403`.
- [ ] A user **banned mid-session** is refused on their **next request** (per-request check, like suspension), not only after re-launch.

### Edge cases
- [ ] The IP used for network-ban matching is the **real edge IP** (`req.ip` with `trust proxy: 1`); a forged/extra `X-Forwarded-For` value does **not** change the matched IP (no leftmost-XFF trust).
- [ ] The ban gate applies to **mutating / sensitive** routes; genuinely public reads keep their current access (an explicit exempt list, mirroring how the suspension check exempts certain paths) so the gate doesn't over-block.
- [ ] **Ban-lookup transient error:** the gate matches the **suspension check's existing error posture** for consistency (documented); for a safety control on a *mutation*, prefer fail-closed if it doesn't lock out all users on a transient blip — the chosen posture is explicit + tested.
- [ ] Both **device** and **network** ban types (IP / subnet / ASN) are enforced by the server-side gate (not only device).

### Performance
- [ ] The per-request ban check is a **bounded** lookup (mirroring the suspension check's cost/caching approach) — no unbounded Firestore scan, no per-request lookup storm; a short cache is acceptable if it matches the suspension check's freshness.

### Security
- [ ] Bans are enforced **server-side on every sensitive request** → the web, direct-API, modified-client, and mid-session bypasses are all closed; no ban check is skippable by the client.
- [ ] The network-ban IP is **unspoofable via headers** (real edge IP only).
- [ ] The gate does not leak ban internals beyond the necessary `403` + reason.

### UX
- [ ] A banned user receives a clear `403` with the ban reason (the app maps it to the ban screen; the web shows an appropriate blocked message) — not a generic/confusing error.

### i18n
- N/A — the server returns a machine-readable reason; the **client** localizes the ban/blocked message (the API layer is not a translated surface).

### Observability
- [ ] Server-side ban denials are logged for audit (endpoint · uid · ban type · matched IP-or-device), per [[feedback-comprehensive-default-debug-logging]] — no secret values logged.

## BDD Scenarios

**Scenario: a banned person can't post on the website**
- **Given** someone whose device or network is banned
- **When** they try to post a suggestion, vote, or comment on the website
- **Then** the action is refused

**Scenario: a banned person can't get around the app by contacting the service directly**
- **Given** a banned person using a tool to talk to the service directly instead of the app
- **When** they try to perform a banned action
- **Then** the service refuses it

**Scenario: forging your network address doesn't get past a network ban**
- **Given** someone on a banned network who forges a different network address in their request
- **When** they contact the service
- **Then** they are still recognised as banned and refused

**Scenario: being banned while using the app stops you right away**
- **Given** someone using the app who is banned while still signed in
- **When** they next try to do something
- **Then** they are refused — they do not stay in until they close the app

**Scenario: an ordinary user is unaffected**
- **Given** a user in good standing
- **When** they post, vote, or comment
- **Then** it works as normal

## Test Plan

Touches `express-api/**` (shared auth middleware + IP derivation + sensitive routes) → **backend change ⇒ Gate 4 forces the FULL app+web+device gauntlet** (per SHY-0127). Per § No Stubs: run against the **real Firebase emulator** — and this story **migrates `device-info.test.js` off its Firestore mocks** as part of the fix (a documented No-Stubs debt).

**Red → Green (framework by framework):**
- **Express/Node (Jest, real emulator)**:
  - `authMiddleware` ban gate: a device-banned uid → `403` on a sensitive route; a network-banned edge IP → `403`; an unbanned user → passes. Both ban types (device + network IP/subnet/ASN). RED before the gate exists (routes let banned users through today).
  - **XFF derivation:** a request with a forged `X-Forwarded-For` is matched against the **real edge IP**, not the header value — banned real-IP still `403`, forged clean-IP does **not** bypass. Exercised against the real `trust proxy` config (no mock).
  - **Mid-session:** sign-in passes → issue a ban → the next request to a sensitive route → `403`.
  - Migrate `express-api/tests/routes/device-info.test.js` off `jest.mock` → real emulator.
- **Playwright (web, all 5 browsers)** `tests/web/suggestions-security.spec.ts`: **implement the empty skeletons** — `:100` banned user sees suggestions read-only; `:104` no vote/comment/suggest controls; **`:108` a banned user's direct API call returns `403`** (the critical missing test).
- **Static/quality:** `npm run lint` 0 warnings; prettier clean.
- **Phase 1 LOCAL gauntlet:** Gate-4 full matrix — real Android + real iPhone + all browsers — banned user blocked everywhere; unbanned unaffected.
- **Phase 2:** `code-reviewer` 100% clean (security scrutiny: error posture, IP derivation, exempt list) → In Review + `Reviewed-up-to:` → push → CI green by name (incl. the backend-forced matrix).
- **Phase 3 (DEV):** re-run against dev (real Firebase) — banned user blocked on web + app + direct API; forged XFF ineffective.

## Out of Scope
- **Firestore-rules-level** ban enforcement — SHY-0150 (this story is the API/middleware layer).
- **Device re-registration** resistance — SHY-0151.
- The app's **client-side pre-routing** ban gate — SHY-0143 (this is the server-side counterpart; both ship).
- Adding new ban **types** or the admin ban-management UI (unchanged).

## Dependencies
- `express-api/src/middleware/auth.js:195-210` (the suspension check to mirror + extend), `device-info.js` `checkBans()` (the ban-matching logic to reuse server-side) + its IP derivation (`:75-76`), `express-api/src/index.js:33` (`trust proxy`).
- The sensitive routes (`suggestions.js` create/vote/comment, and the wider set of auth-gated mutations) that must inherit the gate.
- `tests/web/suggestions-security.spec.ts` (the empty skeletons to implement) + the real Firebase emulator.

## Risks & Mitigations
- **Risk:** fail-open on a ban-lookup error lets bans slip; fail-closed on an outage blocks everyone. **Mitigation:** match the suspension check's posture for consistency, prefer fail-closed on **mutations** if it doesn't lock out all users on a transient blip; the chosen posture is explicit + tested.
- **Risk:** a per-request Firestore lookup is a cost/latency hit. **Mitigation:** mirror the suspension check's bounded/cached approach; no unbounded scans.
- **Risk:** over-broad enforcement blocks legitimate public reads. **Mitigation:** apply to mutating/sensitive routes with an explicit exempt list (like suspension); tested both ways.
- **Risk:** `trust proxy` misconfiguration still yields a spoofable IP. **Mitigation:** use `req.ip` (respecting `trust proxy: 1`) + a test that a forged XFF does not change the matched IP against the **real** config.

## Definition of Done
- [ ] `authMiddleware` per-request ban gate (device + network, real edge IP) on sensitive routes + `device-info.js` IP-derivation fix + the empty `suggestions-security.spec.ts` skeletons implemented + `device-info.test.js` migrated to the real emulator.
- [ ] **Pre-Merge Testing Protocol satisfied (Gate-4 full matrix):** Jest RED→GREEN (ban gate · XFF · mid-session · real-emulator migration) + Playwright web security specs (incl. direct-API-403) + lint/prettier clean → LOCAL full gauntlet green → `code-reviewer` 100% clean (security scrutiny) → In Review + `Reviewed-up-to:` → push → CI green by name → DEV gauntlet green (banned blocked on web+app+direct-API; forged XFF ineffective) → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0005-ban-enforcement-hardening]] from the adversarial bypass-surface map. The core fix: bans checked in exactly one place (app sign-in) → move enforcement server-side, per-request, in `authMiddleware`, with the real edge IP. Closes vectors 1 (web/API), 2 (XFF), 3 (direct-API), 4 (mid-session) + fills the empty security skeleton tests. `type: bug`, `mvp: true` (operator 2026-07-01). Authoritative counterpart to [[SHY-0143]]'s client pre-routing gate. Non-technical BDD per [[feedback-non-technical-bdd]].
