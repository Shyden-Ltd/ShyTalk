---
id: SHY-0178
status: In Review
owner: claude
created: 2026-07-11
priority: P0
effort: XS
type: bug
roadmap_ids: []
pr:
---

# SHY-0178: Dev smoke fails room creation — payload predates the tightened rooms-create rule

## User Story

As the operator relying on the dev deployment pipeline,
I want the automated smoke checks to pass on a healthy dev environment,
So that a red deploy always means a real regression and the release gate can trust dev being green.

## Why

Deploy-To-Dev run 29152433000 (the first deploy carrying SHY-0029, merged 2026-07-08) went red on the **Dev Smoke** job: the LiveKit smoke check creates a temporary voice room via Firestore REST as the smoke user, and that write now gets `403 PERMISSION_DENIED`.

Root cause (triaged with the run log + `firestore.rules`): SHY-0029 tightened the rooms-create rule to require `ownerFirebaseUid` **present and equal to the caller's signed uid** (an omitted field defaults to `''`, which never matches — deliberately, so field-missing creates can no longer silently produce rooms that break the owner-left attestation). The smoke spec's payload predates that clause and omits the field, so the rule denies it. The rule is correct; the smoke spec is the out-of-date "legacy client".

This is not a SHY-0150 regression (the smoke account is not banned) and not an environment fault. Until fixed, every dev deploy reports failure, which blocks the release gate ("dev must be green").

## Acceptance Criteria

### Happy path

- [ ] The smoke suite's room-create payload stamps `ownerFirebaseUid` with the authenticated smoke user's own Firebase uid, taken from the **same fresh ID token** that authorizes the write.
- [ ] The **Dev Smoke** job of Deploy-To-Dev passes end-to-end against dev with the fix (all smoke tests, not just the LiveKit block).

### Error paths

- [ ] If the room create is still denied, the suite fails loudly with the HTTP status + response body, and the failure hint names every rule precondition — signed-in, not banned, cohort binding + enum, `ownerId` binding, and the `ownerFirebaseUid == auth uid` requirement. The hint text is a pure helper (`buildRoomsCreateFailureHint`) pinned exactly by a locally-runnable spec, so a typo or dropped precondition is caught locally, not on the next real regression.
- [ ] Negative controls prove the tightened clause is live on the deployed rules: a create that omits `ownerFirebaseUid`, and one that forges it, are each denied with 403 `PERMISSION_DENIED` while satisfying every other clause — going red if the SHY-0029 clause is ever reverted.

### Edge cases

- [ ] The stamped uid is derived from the refreshed JWT used as the write's Bearer token (not the initial sign-in response), so a token refresh that rotates claims can never desync the payload from the credential.
- [ ] The uid extraction only ever yields a non-empty string (`user_id` preferred, `sub` fallback; non-string/empty claims rejected, no trimming) — pinned by a pure-logic spec that runs in the local suites with no secrets.
- [ ] Room cleanup (owner-only delete in `afterAll`) is asserted, not swallowed: a 2xx or 404 (room never created / already reaped) passes; a denial or error soft-fails the run instead of silently orphaning `[SMOKE]` rooms on dev.

### Performance

- N/A — one additional field on an existing single REST request; no measurable surface.

### Security

- [ ] The fix satisfies the rule as a **regular user writing their own uid** — no admin credential, no rule relaxation, no server-side bypass. `firestore.rules` is not modified.

### UX

- N/A — no end-user surface; the operator-facing failure message is covered under Error paths.

### i18n

- N/A — no user-facing strings (CI harness spec only).

### Observability

- [ ] A future rule/payload drift surfaces as the descriptive thrown error (status + body + full precondition checklist) in the smoke job log, not as a silent skip or a downstream confusing 404 — and the diagnostic's exact wording is test-pinned locally so it cannot rot unnoticed.

## BDD Scenarios

**Scenario: A healthy dev deploy reports green smoke checks**
- **Given** the dev environment has just been deployed and is healthy
- **When** the automated smoke checks run
- **Then** the voice-room smoke check creates its temporary room successfully
- **And** the smoke job finishes green with no test failures

**Scenario: The temporary smoke room is cleaned up**
- **Given** the smoke checks created their temporary voice room
- **When** the smoke run finishes
- **Then** the temporary room is deleted by the same smoke user that created it

**Scenario: Sneaking a room past the owner-identity check stays impossible**
- **Given** a signed-in user attempts to create a voice room while leaving out — or faking — the room's owner identity
- **When** the creation request reaches the database
- **Then** the request is refused
- **And** the refusal shows up in the smoke-check report, so a weakening of this protection is noticed on the very next deploy

**Scenario: A future room-rule tightening is diagnosable from the log**
- **Given** the room-creation rules gain a new requirement the smoke payload does not yet satisfy
- **When** the smoke checks run
- **Then** the smoke job fails with a message showing the denial and listing the rule's requirements, so the operator can see exactly which precondition to update

## Test Plan

**Classification: CI-config-only (test-harness-only).** The changed runtime is confined to the dev-smoke test apparatus (`tests/web/dev-smoke.spec.ts`, its new pure-helper module `tests/web/helpers/dev-smoke.ts`, and its local spec `tests/web/dev-smoke-helpers.spec.ts`). The exemption is grounded in the file's **unreachable-locally nature**, not merely its path: `dev-smoke.spec.ts` unconditionally self-skips (file-level `test.skip`) without the smoke secret bundle that exists only in `.github/workflows/deploy-dev.yml`'s Dev Smoke job, so no local device/browser gauntlet run could ever execute its logic — the gauntlet would exercise nothing related to the change. No app (`shared/**`, `app/**`, `iosApp/**`), backend (`express-api/src/**`, `firestore.rules`, `database.rules.json`, `storage.rules`), or website (`public/**`) runtime surface is touched. **Scope note (anti-loophole):** this classification is claimed per-change, not inherited by the file — a future edit that weakens what this suite asserts still owes the dev-dispatch proof (which is also this story's own GREEN evidence).

**RED (watched):** Deploy-To-Dev run 29152433000 (ref `develop` @ `c004a6d5f0f`, 2026-07-11) — Dev Smoke job failed in `tests/web/dev-smoke.spec.ts` `beforeAll`: `Firestore REST write to rooms/smoke-livekit-<ts> failed (403): PERMISSION_DENIED`. This is the failing test observed through the canonical runner before the fix. **Local RED (watched):** `tests/web/dev-smoke-helpers.spec.ts` run before `tests/web/helpers/dev-smoke.ts` existed — fails with `Cannot find module './helpers/dev-smoke'` (feature missing).

**GREEN:** **Local:** `npx playwright test tests/web/dev-smoke-helpers.spec.ts --project=chromium` — 10/10 passed (uid-derivation branch matrix: user_id preferred / sub fallback / empty-string fallthrough / both-absent undefined / both-empty undefined / non-string skipped / both-non-string undefined / whitespace pinned verbatim; hint: exact-string pin + interpolation case). **Dev (to watch):** Deploy-To-Dev `workflow_dispatch` with `ref: story/SHY-0178-dev-smoke-owner-firebase-uid` (unmerged branch, protocol Phase 3) — Dev Smoke job passes, including the two negative controls (`rooms-create WITHOUT ownerFirebaseUid is denied`, `rooms-create with a FORGED ownerFirebaseUid is denied`), `POST /api/livekit/token returns a signed JWT with correct grants` (consumes the created room), and the asserted `afterAll` cleanup. Post-merge, a `ref: develop` dispatch re-proves green on the integration branch.

**Non-device frameworks still run:** story-frontmatter validator, `code-reviewer` 100% clean pre-push, CI checks green by name (Detect Changes / Analyze JavaScript / PR Gate). The pre-push hook's chromium suite runs as usual and now actually executes the new pure-helper spec (dev-smoke.spec.ts itself self-skips locally by design; no enforced prettier/eslint scope covers `tests/web/` — verified: no root config, no workflow/pre-push prettier step).

## Out of Scope

- The iOS TestFlight job failure on the same deploy run (`xcodebuild: Found no destinations for scheme 'iosApp'`) — separate diagnosis, no shared cause.
- The Seed Dev Personas job failure (pre-existing since ~2026-07-01) — separate fix.
- Any change to `firestore.rules` — the tightened rule is correct and stays as SHY-0029 shipped it.
- Restoring a local `dev-smoke` Playwright project (the stale header comment implied one; this story only corrects the comment).

## Dependencies

- SHY-0029 (merged 2026-07-08) — the rule tightening this spec catches up with.
- Dev environment reachable + smoke secret bundle present in repo secrets (already provisioned; used by every deploy).

## Risks & Mitigations

- **Risk:** the smoke account's fresh JWT lacks the expected uid claim shape (`user_id`), producing an empty stamp that still fails the rule. **Mitigation:** derive from `user_id` with `sub` fallback (both are the Firebase uid in ID tokens) and assert non-empty before the write, failing with a claim-shape message instead of an opaque 403.
- **Risk:** branch-ref deploy dispatch is forgotten and the fix merges unproven. **Mitigation:** DoD requires the green branch-ref run URL recorded in Notes before merge.
- **Risk:** another latent payload gap (beyond `ownerFirebaseUid`) surfaces only after this fix unblocks the write. **Mitigation:** the branch-ref dev run exercises the full smoke suite end-to-end; any next denial fails loudly with the improved hint and is fixed in this same story before merge.

## Definition of Done

- [x] `ownerFirebaseUid` stamped from the fresh JWT's uid claim (via `deriveOwnerFirebaseUid`) in the room-create payload; stale "pre-push dev-smoke project" header comment corrected; failure hint moved to the test-pinned `buildRoomsCreateFailureHint` helper naming every rule precondition.
- [x] `tests/web/dev-smoke-helpers.spec.ts` green locally (10/10, chromium); negative-control tests + asserted cleanup present in `dev-smoke.spec.ts`.
- [x] Story validator green; `code-reviewer` 100% clean on the local commit before push (R2 MERGE-READY, zero findings).
- [x] Deploy-To-Dev dispatched with `ref: story/SHY-0178-dev-smoke-owner-firebase-uid`: **Dev Smoke job green** including both negative controls (run URL in Notes).
- [ ] PR merged to develop (squash, title `SHY-0178: …`); post-merge `ref: develop` dispatch shows Dev Smoke green on develop.
- [ ] Story `In Review` after merge; `Done` on next release cut with `released_in:`.

## Notes (running log)

Reviewed-up-to: 56d534ae176

- 2026-07-11 21:26 WIB — **DEV PROOF GREEN.** Deploy-To-Dev branch dispatch https://github.com/Shyden-Ltd/ShyTalk/actions/runs/29155698877 (ref `story/SHY-0178-dev-smoke-owner-firebase-uid`): **Dev Smoke Tests SUCCESS — 23/23 passed (12.8s)**, both negative controls executed and green by name (`rooms-create WITHOUT ownerFirebaseUid is denied (SHY-0029 clause live)` ✓ 132ms; `rooms-create with a FORGED ownerFirebaseUid is denied` ✓ 447ms) against the real deployed dev rules — no silent skip (23 = the file's full chromium test count). Backend/Web/Android/Sanity also green on the branch deploy. Seed Dev Personas red = known pre-existing (~2026-07-01). iOS TestFlight job still in progress at recording time — its outcome is the manual-rerun datapoint for the separate iOS-destination diagnosis, not a gate for this tests-only story. Pre-push local suite on push: 1366 passed / 1 known flaky (admin-keyboard Enter) / 37 skipped, 15.7m. PR: https://github.com/Shyden-Ltd/ShyTalk/pull/1579.

- 2026-07-11 20:07 WIB — CREATED fully refined during the develop→dev deploy triage; RED already watched on run 29152433000 (Dev Smoke 403 on rooms create). Root cause pinned to SHY-0029's `ownerFirebaseUid` present-and-matching clause vs the older smoke payload; fix derives the uid from the same refreshed JWT that signs the write.
- 2026-07-11 20:47 WIB — code-reviewer R2 on `56d534ae176`: **MERGE-READY, zero findings.** All 6 R1 closures independently re-verified (8-case uid matrix hand-traced; hint pin character-diffed against helper output; negative-control payloads traced clause-by-clause against firestore.rules 248-256; no-formatter-scope claim re-verified). Reviewer notes the string-only guard also fixed a latent type-confusion bug the R1 `||` version had. Status → In Review. Remaining DoD = the live dev-dispatch proofs.
- 2026-07-11 20:30 WIB — code-reviewer R1 on `1d5827b3036`: 0 Critical / 5 Important / 1 Minor. All closed in-session: (1) failure-hint path untested → hint extracted to `buildRoomsCreateFailureHint` (exact-string pinned locally) + two live negative controls added (omitted/forged `ownerFirebaseUid` → 403, satisfying all other clauses — SHY-0029 revert detector); (2) hint missing signed-in/banned preconditions → full checklist in the helper; (3) `afterAll` swallowed the delete → soft-asserted 2xx/404 with teeth; (4) uid derivation unfalsifiable inline → extracted to `deriveOwnerFirebaseUid` (string-only, no trimming) with an 8-case local branch matrix, watched RED (module missing) → GREEN 10/10; (5) CI-config-only rationale grounded in the unreachable-locally property + per-change scope note; (6) type honesty → helper returns `string | undefined`. Reviewer verified clause-by-clause rule match, uid==request.auth.uid via three internal sources, delete-rule independence, and no-direct-backend scope (tests/** exempt by `scripts/check-no-direct-backend.js` design).
