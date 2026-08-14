---
id: SHY-0114
status: Draft
owner: claude
created: 2026-06-17
priority: P0
effort: XL
type: refactor
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0114: Migrate Auth / Sign-In tests to real services (EPIC-0003)

## User Story

**As** the team executing EPIC-0003,
**I want** every Auth / Sign-In test (express `auth` / `portal` / `otp` / `pin` / `biometric` routes + the Android auth journey) moved off in-process doubles and onto the real Firebase Auth emulator + real Express API,
**So that** the gate every other surface depends on — "can a real user actually sign in?" — is proven against the real auth path, not mocked tokens.

## Why

Auth is the universal precondition: if sign-in is faked, every downstream "signed-in" test inherits a fiction. It is sequenced **P0, right after Rooms**, because the real-device gauntlet itself depends on `androidPersonaSignIn` working against real auth (the SHY-0096 linchpin proved the real signed-out reset; this proves the real signed-in path). The current tests mock Firebase Auth / token verification, so a broken real sign-in (the class of failure behind the operator's "can't perform basic core tasks") would pass. Migrating to the real Auth emulator + real REST sign-in removes that blind spot.

## Acceptance Criteria

### Happy path
- [ ] Every express auth/portal/otp/pin/biometric test runs against the **real Firebase Auth emulator** (real user records, real ID-token mint + verify via the real Admin SDK) and the real Express API; no `jest.mock`/`jest.fn` collaborator/fetch-mock/`makeStatefulFakeDb` remains.
- [ ] The Android auth journey signs a real persona in against the local stack on the **real device** and reaches the signed-in home — asserted on real auth state (a real session, a real user doc).
- [ ] Real REST sign-in (persona password flow) is exercised end-to-end against the real Auth emulator, replacing any mocked sign-in helper used by the runner.

### Error paths
- [ ] Wrong password / unknown user / disabled account are rejected by the **real** Auth emulator (real error codes), asserted on the real response — not a mocked rejection.
- [ ] Expired / malformed / wrong-audience ID tokens are rejected by the **real** Admin verify path.
- [ ] OTP / PIN / biometric negative paths (wrong code, lockout) exercised against the real backend contract.

### Edge cases
- [ ] Session persistence: a real session survives the documented lifecycle (sign-out → sign-in; app relaunch) on the real surface (mirrors /manual-qa persistence probe).
- [ ] A moderation-gated account (suspended/warned) hitting sign-in is handled by the real gate (coordinates with the moderation area SHY-0116 + the SHY-0101 reset).
- [ ] Surfaced bugs: non-blocking → file `type: bug` SHY + tag the real test `@known-failure-SHY-NNNN` (assertion intact); blocking → pivot-fix TDD-first.

### Performance
- [ ] Real sign-in completes within an asserted budget on the real surface; the migrated express suite completes in a few seconds against a warm Auth emulator.

### Security
- [ ] No persona passwords / private keys logged (`localdev123` is the well-known LOCAL pw; dev/prod secret stays in `~/.shytalk/dev-personas.env`). Real token scoping/expiry enforced by the real Admin SDK. Release builds prove no baked persona password (ties to SHY-0104 pattern).

### UX
- [ ] The real sign-in → home flow is walked as the consumer; a real user genuinely gets in (the operator's "basic core task").

### i18n
- [ ] Auth error/strings render in at least one RTL + one CJK locale on the real surface (spot-check).

### Observability
- [ ] Real auth/server logs run unmocked during tests (exercised, not asserted).

## BDD Scenarios

**Scenario: a real persona signs in against the real Auth emulator**
- **Given** the real Auth emulator seeded with the persona's real user record
- **When** the persona signs in via real REST / the real app
- **Then** a real ID token is minted, verified by the real Admin SDK, and the signed-in home is reached — asserted on real auth state

**Scenario: a wrong password is rejected for real**
- **Given** the same real user
- **When** sign-in is attempted with a wrong password
- **Then** the real Auth emulator returns the real error and the migrated test asserts it (no mocked rejection)

**Scenario: an expired token is rejected by the real verify path**
- **Given** an expired/malformed ID token
- **When** a protected route is called
- **Then** the real Admin verify rejects it and the route returns the real 401

**Scenario: a surfaced auth bug is catalogued**
- **Given** a migrated real test exposes a non-blocking auth defect
- **When** triaged
- **Then** a `type: bug` SHY is filed and the test tagged `@known-failure-SHY-NNNN` with its correct assertion intact

## Test Plan

**RED:** rewrite each auth test to require the real Auth emulator + real Admin verify (no mocks) → fails until seeded against real services; a failing real sign-in test reproduces any real sign-in blocker.

**GREEN:** seed real Auth users + Firestore docs in `beforeAll`; exercise real sign-in / token / negative paths; pivot-fix blockers TDD-first; file + `@known-failure`-tag non-blocking surfaced bugs. Android auth journey on the real device gauntlet; canonical `npm test` green for the express layer.

**Frameworks:** express Jest (real Auth + Firestore emulator), Android journey gauntlet (real device), frontmatter validator. **Real backend:** Firebase Auth + Firestore emulator + real Express API + real device. **Gauntlet:** REQUIRED for the journey — operator-gated.

## Out of Scope
- Fixes for non-blocking surfaced bugs (own SHYs, drained post-epic).
- OAuth/Google-account real flows that genuinely cannot be induced locally → escape-hatch escalation to the operator if encountered (do NOT silently mock).
- Sub-splitting: delivered as 1-SHY-1-PR slices (auth-routes · otp/pin · biometric · Android journey) at pickup.

## Dependencies
- **SHY-0112** (keystone) first.
- **SHY-0096** (linchpin, merged) — real signed-out reset; this is the signed-in counterpart.
- **SHY-0109** + `firebase-emulator.js`; real Auth emulator (port 9099).
- Real Android/iPhone for the journey.

## Risks & Mitigations
- **Risk:** OAuth/biometric cannot be fully automated. **Mitigation:** real persona-password REST path covers automatable auth; OAuth/biometric are @manual ledger entries (/manual-qa) or operator-approved escape-hatch — never silently mocked.
- **Risk:** real token timing/expiry makes tests flaky. **Mitigation:** control real clock-adjacent inputs via the emulator; bounded waits; assert real state.
- **Risk:** XL scope. **Mitigation:** vertical 1-SHY-1-PR slices.

## Definition of Done
- All auth tests double-free + asserting real auth state; baseline shrinks per file.
- Real sign-in genuinely works on the real surface; surfaced bugs filed + `@known-failure`-tagged with intact assertions.
- Gauntlet + canonical `npm test` green; `code-reviewer` + `security-reviewer` zero findings; CI green by name.
- Judgment-merge per slice. Each slice → In Review → Done on its release cut.

## Notes (running log)
- **2026-06-17 — created Draft (P0).** The universal precondition; sequenced right after Rooms because the gauntlet itself needs real sign-in. XL → sub-split at pickup. OAuth/biometric handled via @manual ledger or operator escape-hatch, never a silent mock.
