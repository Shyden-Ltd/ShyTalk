---
id: SHY-0150
status: In Progress
owner: claude
created: 2026-07-01
priority: P1
effort: M
type: bug
roadmap_ids: []
epic: EPIC-0005
pr:
mvp: true
---

# SHY-0150: Firestore-rules-level ban gate (deny banned writes at the database layer)

## User Story

**As** the team enforcing bans,
**I want** a ban enforced in the Firestore security rules themselves,
**So that** even a **direct database write** from a banned user — bypassing our API entirely (the app writes rooms/messages straight to Firestore) — is denied at the strongest possible layer.

## Why

The bypass-surface review (2026-07-01) found the Firestore rules gate user-writable collections on `request.auth != null` alone (`firestore.rules:687,697` for suggestions; the same trust model elsewhere) — **no ban check**. SHY-0149 closes the **API** layer, but the app talks to **Firestore directly** for much of its writes (rooms, messages, etc.), which never touch the Express API. A rules-level gate is the only thing that stops a banned user (or a modified client) writing straight to the database.

Rules can't see a device ID or IP, so the tractable, strong mechanism is a **`banned` signal the rules can read** — a custom claim on the user's token (consistent with the existing cohort custom-claim pattern), set when a ban applies and cleared when it lifts. Rules add an `isBanned()` helper reading that claim and gate the user-write collections. Propagation uses a token refresh (as SHY-0143 already does for cohort) — with refresh-token revocation available for prompt effect; the ≤1h stale-token window is backstopped by SHY-0149's per-request API check.

## Acceptance Criteria

### Happy path
- [ ] An **unbanned** user's direct Firestore writes to user-write collections (rooms, messages, suggestions, votes, comments, and the wider set) succeed exactly as today.
- [ ] An `isBanned()` rules helper reads the ban signal (a `banned` custom claim on `request.auth.token`) and is applied on the create/update/delete rules of the user-write collections.

### Error paths
- [ ] A **banned** user (ban signal present) attempting a direct Firestore write to any gated collection is **denied at the rules layer** (permission denied), independent of the API.

### Edge cases
- [ ] The ban signal is **set** when a ban (device/network/account) applies and **cleared** when it lifts; picked up by the client via a token refresh (refresh-token revocation forces prompt effect).
- [ ] The bounded stale-token window (a token minted before the ban, ≤ its lifetime) is covered by SHY-0149's per-request API check + refresh-token revocation — so there is no indefinite gap.
- [ ] Read access is unchanged where reads are already permitted (this gates **writes**; it does not newly restrict legitimate reads).

### Performance
- [ ] `isBanned()` reads a **token claim** — no extra Firestore `get()` per rule evaluation, so no added document-read cost or latency on writes.

### Security
- [ ] Rules-level enforcement is the **strongest backstop** — a banned user's direct Firestore SDK write is denied even if they bypass our API and the app's own checks; combined with SHY-0149 (API) it closes the write path at both layers.
- [ ] The `banned` claim is server-controlled (set only by trusted backend/admin logic), never client-settable.

### UX
- N/A — a rules denial surfaces to the client as a blocked write; the client shows the ban screen (app) or an appropriate message. No new user-facing surface here.

### i18n
- N/A — Firestore rules + custom claims are an enforcement layer, not a user-facing translated surface.

### Observability
- [ ] The ban-claim lifecycle (set / cleared / refresh-forced) is logged server-side for audit; rules-level denials are visible in the standard Firestore audit logs.

## BDD Scenarios

**Scenario: a banned person can't write to the database directly either**
- **Given** a banned person
- **When** they try to write data straight to the database, bypassing our app and service
- **Then** the database itself refuses the write

**Scenario: an ordinary person's actions save normally**
- **Given** a person in good standing
- **When** they do something in the app that saves data
- **Then** it saves normally

**Scenario: the block lifts when the ban is lifted**
- **Given** a person whose ban has been removed
- **When** their app refreshes and they act again
- **Then** their actions save normally again

## Test Plan

Touches `firestore.rules` (+ the backend ban-claim set/clear logic) → **backend/rules change ⇒ Gate 4 forces the FULL gauntlet** (per SHY-0127). Per § No Stubs + the SHY-0129 precedent, rules are tested against the **real Firebase Rules engine** (emulator), not asserted by string-matching.

**Red → Green (framework by framework):**
- **Firestore rules (real Rules engine, emulator — SHY-0129 pattern)**:
  - a write to each gated user-write collection (rooms/messages/suggestions/votes/comments) with a token **carrying** the `banned` claim → **denied**; the same write with an **unbanned** token → **allowed**. RED before the `isBanned()` gate exists (banned writes currently allowed).
  - reads that are currently permitted remain permitted (no over-restriction).
- **Express/Node (Jest, real emulator)**: the ban-claim set/clear lifecycle — applying a ban sets the claim (+ triggers a refresh/revocation); lifting clears it; the claim is not client-settable.
- **Static/quality:** rules lint / `firebase deploy --only firestore:rules --dry-run` clean; `npm run lint` 0 warnings on the backend claim logic.
- **Phase 1 LOCAL gauntlet:** Gate-4 full matrix — a banned user's direct write is denied on-device; an unbanned user is unaffected.
- **Phase 2:** `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name.
- **Phase 3 (DEV):** re-run against dev — banned direct-write denied; ban lift restores access after refresh.

## Out of Scope
- The **API/middleware** ban gate — SHY-0149 (this story is the rules layer; they ship together for full coverage).
- **Device re-registration** resistance — SHY-0151.
- Re-architecting the custom-claim / token-refresh mechanism itself (reuses the existing cohort-claim + `getIdToken(forceRefresh)` machinery).

## Dependencies
- SHY-0149 (the API-layer gate + the ban lifecycle that sets the `banned` claim) — this story consumes that claim in rules.
- `firestore.rules` (the user-write collection rules to gate) + the SHY-0129 real-Rules-engine test harness.
- The existing custom-claim mechanism (cohort claims) + `getIdToken(forceRefresh)` / Admin `revokeRefreshTokens` for propagation.

## Risks & Mitigations
- **Risk:** the stale-token window lets a just-banned user write until their token refreshes. **Mitigation:** refresh-token revocation on ban for prompt effect + SHY-0149's per-request API check covers the window; the window is bounded (≤ token lifetime).
- **Risk:** a too-broad rules gate blocks legitimate writes (or reads). **Mitigation:** gate only writes on user-write collections; real-Rules-engine tests assert both the banned-denied and unbanned-allowed paths per collection.
- **Risk:** the `banned` claim could be spoofed if settable client-side. **Mitigation:** the claim is set only by trusted backend/admin logic (custom claims are server-only by construction); a test asserts a client cannot self-set it.

## Definition of Done
- [ ] `isBanned()` rules helper + write-gates on the user-write collections + the backend ban-claim set/clear (with refresh/revocation) implemented.
- [ ] **Pre-Merge Testing Protocol satisfied (Gate-4 full matrix):** real-Rules-engine RED→GREEN (banned-denied · unbanned-allowed · reads-unchanged, per collection) + Jest claim-lifecycle + rules-dry-run/lint clean → LOCAL full gauntlet green → `code-reviewer` 100% clean → In Review + `Reviewed-up-to:` → push → CI green by name → DEV gauntlet green → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-11 — **PICKUP-FITNESS REVIEW (passed) → In Progress.** Premises re-verified against current code: `firestore.rules` still gates user-writes on `request.auth != null` alone (no ban signal anywhere); the cohort-claim machinery (`express-api/src/utils/firebase-claims.js` — `mintClaimsMerging`) + `auth.revokeRefreshTokens` (used at `admin-users.js`, `portal.js`) are reusable as-is; the SHY-0129 real-Rules-engine harness lives at `express-api/tests/firestore-rules/` (`admin-claim-rules.test.js` is the closest pattern — custom claims on the test token). **Lifecycle points enumerated** (more than the spec assumed): explicit ban-standing mutations at `admin-bans.js` (ban device / ban network / unban device / unban network / unban-all) **plus suspend/unsuspend auto-applied bans** (`admin-users.js` — suspend batches `deviceBans` per bound device + a `networkBans` doc for last IP, `linkedUniqueId`-tagged; unsuspend lifts them), plus passive paths (lazy expiry reaping; binding mint/unbind changing hardware-ban standing). Design: one `syncBannedClaim` chokepoint — called explicitly by the ban-mutation routes (prompt mint + revocation) and lazily by authMiddleware's existing per-request gate when the fresh verdict disagrees with the decoded token's `banned` claim (covers expiry/binding flips, no cron, no extra reads). Structural limit to document: an **unlinked network ban** has no enumerable target → no claim at ban time; the lazy path + SHY-0149's API gate cover it. **Framing check:** rules gate = defense-in-depth *behind* the API-only ratchet ([[feedback-no-direct-backend-all-via-api]]) — rules still permit direct client writes, so a tampered client bypasses SHY-0149 without this. DoD's "judgment-merge (NO auto-merge; notify operator)" predates the git-flow pivot — superseded by the develop-autonomous merge convention (gates unchanged).
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0005-ban-enforcement-hardening]] from the bypass-surface map (vector 7: no rules-level ban gate). Mechanism: a server-set `banned` custom claim (like cohort) + an `isBanned()` rules helper gating user-write collections; propagated via token refresh / refresh-token revocation; the bounded stale-token window is backstopped by [[SHY-0149]]'s per-request API check. `type: bug`, `mvp: true`. Ships alongside SHY-0149. Non-technical BDD per [[feedback-non-technical-bdd]].
