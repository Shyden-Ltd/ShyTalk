---
id: SHY-0204
status: Draft
owner: claude
created: 2026-07-18
priority: P2
effort: M
type: feature
roadmap_ids: []
pr:
---

# SHY-0204: Device-local legal acceptance with per-document change detection

> **DRAFT — awaiting operator answers to the Open Questions in `## Notes` before architect refinement.** Written 2026-07-18 at operator request; several design points (server audit record, web "device" semantics, offline behaviour) need a ruling first.

## User Story

As a returning ShyTalk user,
I want my acceptance of the legal documents to persist on my device and only be asked again when a document I accepted has actually changed,
So that I am not forced to re-accept the same unchanged policies every time I sign out and back in, and when something does change I am told exactly which document changed and why I must re-read it.

## Why

Today legal acceptance is tracked **per-user, server-side** (`user.acceptedLegalVersion` + `usersAcceptedPolicies/<uid>`), and the app gates on `acceptedLegalVersion < CURRENT_LEGAL_VERSION`. Two problems:

1. **Acceptance is coupled to the auth session.** The fresh-install legal gate re-appears on every signed-out cold launch (verified on-device 2026-07-18 while building the QA harness: sign-out → relaunch re-shows the gate). A user who accepts, signs out, and returns is re-gated for no reason.
2. **Change detection is monolithic.** A single `acceptedLegalVersion` integer can't tell the user *which* document changed, even though the server already versions documents independently (`GET /api/legal/versions` → `{ privacy, terms, community }`). When the Privacy Policy bumps, the user just sees a generic "accept everything again" wall.

Operator directive (2026-07-18): acceptance is **saved on the device**; at launch the app checks online for newer versions and, if any document changed, shows the acceptance screen, **names the changed document(s)**, and tells the user they must re-read and re-accept to keep using the service. Acceptance is **not affected by sign-out/in**.

## Acceptance Criteria

### Happy path
- [ ] A first-ever launch (no local acceptance record) shows the acceptance screen listing all legal documents; the user must accept all to proceed.
- [ ] After accepting, the accepted **per-document versions** are persisted on the device (survives app restart AND sign-out/in).
- [ ] A subsequent launch where the device's accepted versions match the current server versions shows NO gate — the user proceeds straight in, signed out or in.
- [ ] When exactly one document's server version is newer than the device's accepted version, the acceptance screen shows on next launch, **names that document** ("The Privacy Policy has been updated"), and requires re-read + re-accept of (at minimum) the changed document.

### Error paths
- [ ] If the launch-time version check cannot reach the server (offline), the app applies the OFFLINE policy (see Open Question 4) deterministically and logs the fallback.
- [ ] A malformed / partial `/legal/versions` response does not crash launch and does not silently treat "unknown" as "unchanged" (fail-closed toward re-prompting, or the ruled behaviour).

### Edge cases
- [ ] A document REMOVED from the server version set, or a NEW document added, is handled (new doc → must accept; removed doc → no longer gates).
- [ ] Downgrade protection: a server version LOWER than the device's accepted version does not spuriously re-gate (accept `accepted >= current`).
- [ ] Clearing app data / reinstall resets to first-launch behaviour (device record gone).

### Performance
- [ ] The launch-time version check is non-blocking or fast enough not to delay first paint beyond the current budget; cached last-known versions are used if the check is slow.

### Security
- [ ] N/A — server-side authz unchanged; `/legal/versions` is already public. BUT see Open Question 1 (compliance audit record) — a minors-facing app under UK OSA may require a server-side consent record regardless of device-local UX.

### UX
- [ ] The "document changed" message is non-technical, names the specific document(s), explains re-read + re-accept is required to continue, and is translated (4 locales: en/zh/id/vi per current locale policy).
- [ ] Re-accept flow lets the user open/read the changed document before accepting.

### i18n
- [ ] All new strings (change notice, per-document names) added to en + zh + id + vi only (current interim locale policy).

### Observability
- [ ] Launch-time version check result (up-to-date / changed:<docs> / offline-fallback) is logged unredacted on local+dev.

## BDD Scenarios

**Scenario: Returning user with unchanged policies is not re-gated after sign-out**
- **Given** a user has accepted all current legal documents on this device
- **And** the server document versions are unchanged
- **When** the user signs out and relaunches the app
- **Then** no legal acceptance screen is shown and the user reaches the sign-in screen directly

**Scenario: A changed Privacy Policy re-gates and names the document**
- **Given** a user's device recorded privacy=4 as accepted
- **When** the server reports privacy=5 at launch
- **Then** the acceptance screen is shown
- **And** it states that the Privacy Policy has been updated and must be re-read and re-accepted
- **And** the Terms/Community documents (unchanged) are not presented as changed

**Scenario: Offline at launch applies the ruled fallback**
- **Given** the device has a prior full acceptance record
- **When** the launch-time `/legal/versions` check fails (offline)
- **Then** the app applies the OFFLINE policy (Open Question 4) and logs the fallback reason

**Scenario: First launch requires acceptance of all documents**
- **Given** a fresh install with no device acceptance record
- **When** the app launches
- **Then** the acceptance screen lists all current legal documents and blocks entry until all are accepted

## Test Plan

**RED first**, across the surfaces the change touches (web + Android + iOS):
- Shared (commonTest / jvmTest): a `LegalAcceptanceStore` (device-local, per-document map) + a `resolveLegalGate(deviceVersions, serverVersions)` pure function — unit-test the matrix (first-launch, unchanged, one-changed, new-doc, removed-doc, downgrade, offline).
- Express (Jest): `/api/legal/versions` per-document response + (if ruled) a consent-audit write endpoint.
- Playwright (web): first-launch gate, unchanged-no-gate-after-clearing-session, changed-doc-names-document.
- Android instrumented + iOS XCUITest: the on-device persistence across sign-out/in + the "which document changed" copy.
- manual-qa journey: extend j01/j03 legal steps; the QA harness's `androidResetToSignedOut` legal-clear (SHY-0203) can be SIMPLIFIED once the gate no longer recurs on sign-out.

**GREEN**: device-local store + per-document resolver + change-notice UI + launch check, all platforms.

## Out of Scope

- Per-region legal versioning (the `/legal/versions` "Future" note) — separate story.
- Rewriting the legal document CONTENT.
- The App-Lock / device-credential work (SHY-0196) — unrelated.

## Dependencies

- Interacts with the QA harness state-reset (SHY-0203): once the gate persists across sign-out, `androidResetToSignedOut`'s legal-clear branch becomes dead code and should be removed.
- `GET /api/legal/versions` (`express-api/src/routes/legal-versions.js`) — already returns per-document versions; may need a 4th document (Cyber Bullying — see Open Question 6).
- Current gate: `CURRENT_LEGAL_VERSION` (`shared/.../feature/legal/LegalAcceptanceScreen.kt`), `user.acceptedLegalVersion` (`User.kt`), `usersAcceptedPolicies/<uid>` server doc, `SharedNavGraph.kt` `needsLegalAcceptance` routing.

## Risks & Mitigations

- **Risk:** dropping the server-side consent record breaks a UK-OSA / GDPR compliance requirement. **Mitigation:** Open Question 1 — likely KEEP a server audit write when signed in, in ADDITION to the device-local UX record.
- **Risk:** "device" has no stable meaning on web (localStorage clears). **Mitigation:** Open Question 2 — accept localStorage semantics or use the signed-in server record as a fallback source of truth on web.
- **Risk:** offline users blocked at launch. **Mitigation:** Open Question 4 — fail-open to last-accepted for availability.

## Definition of Done

- All AC boxes checked; RED→GREEN across web + Android + iOS + Express; the full pre-merge device/browser gauntlet passes (app-runtime change — NOT exempt); `code-reviewer` 100% clean; strings in 4 locales; observability logs present; SHY-0203's legal-clear branch removed as part of this or a fast-follow.

## Notes (running log)

- 2026-07-18 — Created at operator request during the device-return gauntlet. App-runtime change → rides the full gauntlet. Current system surveyed: `/legal/versions` = `{privacy:4, terms:1, community:N}`; app stores a single `acceptedLegalVersion` (monolithic) on the USER doc; gate is per-user + auth-coupled (hence the sign-out recurrence).

### OPEN QUESTIONS FOR OPERATOR (must answer before this leaves Draft)
1. **Server-side consent audit:** keep a per-user server record (`usersAcceptedPolicies`, written when signed in) for OSA/GDPR compliance IN ADDITION to the device-local record, or go purely device-local with no server trail? (Recommend: keep server audit when signed in.)
2. **Web "device" semantics:** on web, "saved on the device" = `localStorage` per browser profile (cleared if the user clears site data → re-gated). Acceptable, or should signed-in web users fall back to the server record?
3. **Per-document granularity:** replace the single `acceptedLegalVersion` with a per-document accepted-versions map (privacy/terms/community/…): required to name the changed document. Confirm.
4. **Offline at launch:** if the version check fails, (a) allow entry with the last-accepted record and re-check next launch [recommended, availability-first], or (b) block until reachable?
5. **Re-accept scope:** when one document changes, must the user re-accept ONLY the changed document, or re-tick all? (Recommend: only the changed one(s), but show which.)
6. **Cyber Bullying policy:** the app's fresh-install gate has 4 checkboxes (Terms, Privacy, Community, **Cyber Bullying**) but `/legal/versions` returns only 3. Add Cyber Bullying to the server version set so it participates in change detection?
