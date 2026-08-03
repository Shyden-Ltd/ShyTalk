---
id: SHY-0029
status: In Review
owner: claude
created: 2026-06-07
priority: P0
effort: S
type: bug
roadmap_ids: [G026]
pr:
mvp: true
---

# SHY-0029: Tighten ownerFirebaseUid rule (strict equality, no legacy fallback)

## User Story

As the ShyTalk operator concerned about authorization correctness, I want **the room `allow create` rule's `ownerFirebaseUid` check (`firestore.rules:229`) to require the field be present AND equal to `request.auth.uid`** (no fallback when the field is absent), so that a room can never be created without a trustworthy owner binding — closing the legacy-client "fieldless create" accommodation now that we are pre-public.

## Why

Current rule at `firestore.rules:223-230` — the room **create** gate:

```javascript
allow create: if request.auth != null
  && request.resource.data.get('cohort', '') == request.auth.token.get('cohort', 'minor')
  && (request.resource.data.get('cohort', '') == 'adult'
      || request.resource.data.get('cohort', '') == 'minor')
  && string(callerUniqueId()) == request.resource.data.ownerId
  && request.resource.data.get('ownerFirebaseUid', request.auth.uid)   // ← line 229
      == request.auth.uid;
```

The `request.resource.data.get('ownerFirebaseUid', request.auth.uid)` pattern returns the incoming field if present, **otherwise returns the second argument** (`request.auth.uid`). So when a client creates a room WITHOUT the `ownerFirebaseUid` field, the comparison becomes `request.auth.uid == request.auth.uid` — trivially true — and **a room is created with no `ownerFirebaseUid` at all**.

That field is not decorative: the owner-left presence mechanism denormalises it and the RTDB `onDisconnect` attestation compares its signal value against `room.ownerFirebaseUid` (`shared/.../data/remote/PresenceService.kt:31-45`). A fieldless room therefore **silently breaks owner-left enforcement** for that room. (It is NOT an IDOR/update bypass — client-side room-doc *updates* are already fully denied by the PR #858 server-authz cutover at `firestore.rules:232-237`; all mutations route through the Admin-SDK Express endpoints. This SHY narrows to the one remaining soft spot: create.)

The `.get(default)` was a deliberate legacy-compat shim (comment at `firestore.rules:213-222`) so pre-cron-elim app versions that don't write the field could still create rooms during Play/App-Store rollout. The comment itself prescribes the follow-up: *"tightens this to a strict `get('ownerFirebaseUid', '') == request.auth.uid`."* **This SHY is that follow-up.** We are still pre-public (only `shytalk.com` is live; no installed app base) — so there are no legacy clients in the wild to break, and the current client already writes the field (`HomeViewModel.kt:434` → `createRoom(..., ownerFirebaseUid, ...)` → `IosRoomRepositoryImpl.kt:102`). Tighten now — the pre-public window is the cheap time.

Roadmap G026 (`.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`): 🟠 Security — `ownerFirebaseUid` rule has a legacy fallback; tighten to strict `== request.auth.uid` + add a rules test. Scope: S.

## Acceptance Criteria

### Happy path
- [ ] `firestore.rules:229` changes the default from `request.auth.uid` to `''` so the field must be present-and-matching:
  ```javascript
  && request.resource.data.get('ownerFirebaseUid', '') == request.auth.uid;
  ```
  (Absent → `'' == uid` → deny; present-and-matching → allow; present-and-forged → deny; empty-string → deny.)
- [ ] The `rooms/{roomId} create` describe block in `express-api/tests/firestore-rules/room-rules.test.js` (real emulator, `@firebase/rules-unit-testing`) asserts create is: allowed for a matching owner; denied when the field is absent (the bypass this closes — the flipped `DENY (SHY-0029): a create that OMITS ownerFirebaseUid` test); denied when forged (≠ auth.uid, pre-existing); denied when empty-string, explicit-null, whitespace-only, and non-string (new `DENY (SHY-0029)` pins); denied when unauthenticated (pre-existing). The pre-refinement plan named a new `room-owner-firebase-uid-strict.test.js` file; extending the existing room-create suite is more cohesive (the OMIT test already lived there) and reuses its `ADULT`/`roomDoc()`/`dbFor()` harness.
- [ ] A dated `SHY-0029` comment above the rule records the tightening + why the fallback was removed (replacing the stale "follow-up PR after rollout" note).

### Error paths
- [ ] A create request that OMITS `ownerFirebaseUid` returns `PERMISSION_DENIED` (previously succeeded). Proven by `assertFails(...)` against the real emulator with a no-field payload.
- [ ] A create request with a forged `ownerFirebaseUid` (some other user's uid) returns `PERMISSION_DENIED` — behaviour unchanged from today (the old rule already denied a present-and-forged value), pinned so a regression can't reopen it.
- [ ] The current client's `HomeViewModel.currentFirebaseUid ?: ""` empty-string edge (`HomeViewModelTest:323`) now creates NOTHING (denied) rather than a fieldless room — asserted as correct, safer behaviour (no unattributable-owner rooms). No client change is in scope; the deny is the desired outcome.

### Edge cases
- [ ] Only ONE occurrence of the legacy `.get('ownerFirebaseUid', request.auth.uid)` pattern exists (grep-confirmed: `firestore.rules:229`). No sibling create/read/delete rule uses it. The audit is re-run in the reviewer pass.
- [ ] Room **read** (same-cohort gate), **delete** (owner-only), and the locked-down **update** path are untouched — the change is scoped to the create gate's owner binding.
- [ ] Admin moderation is unaffected: the create gate has no admin-bypass clause (admins don't create rooms on behalf of others); the `isAdmin()` moderation paths elsewhere in the file are not touched.

### Performance
- [ ] Rule-evaluation cost is unchanged — a constant-time `.get()` + equality; no new cross-document `get()`/`exists()` calls introduced.
- [ ] The extended `rooms/{roomId} create` block in `room-rules.test.js` runs in < 30s against the local emulator.

### Security
- [ ] The rule comment enumerates: prior soft spot (a create omitting `ownerFirebaseUid` produced a fieldless room, breaking owner-left attestation); closed by requiring present-and-matching; residual defence-in-depth (the create still binds `ownerId == callerUniqueId`, and updates are Admin-SDK-only).
- [ ] Adversarial create cases are exercised (forged uid, empty string, absent field, unauthenticated) — per [[feedback-exhaustive-tests-first-no-gaps]] — with exact allow/deny outcomes, both an allowed baseline and each deny.

### UX
- [ ] Pre-public: no end-user impact (no app users). The current app writes `ownerFirebaseUid` on create, so the legitimate create flow is unaffected.

### i18n
- [ ] N/A — server-side rule; no user-facing strings.

### Observability
- [ ] The new test names each denial explicitly (absent / forged / empty / unauth) so a future regression's diagnostic is precise.
- [ ] The `firestore.rules` diff is in the PR (git-blameable), not a deploy-only artifact.

## BDD Scenarios

**Scenario: legitimate owner CAN create their room**

- **Given** an authenticated caller whose `request.auth.uid` is `firebase-alice` and whose `ownerId` matches their `callerUniqueId()`
- **When** they create a room whose `ownerFirebaseUid` is `firebase-alice`
- **Then** the create succeeds (all create clauses pass)

**Scenario: fieldless create is DENIED (the bypass this SHY closes)**

- **Given** the same authenticated caller
- **When** they attempt to create a room with NO `ownerFirebaseUid` field
- **Then** the create fails with `PERMISSION_DENIED` (NEW — previously the `.get(default)` made it succeed and produced an owner-left-broken room)

**Scenario: forged ownerFirebaseUid is DENIED**

- **Given** the authenticated caller `firebase-alice`
- **When** they create a room whose `ownerFirebaseUid` is `firebase-bob`
- **Then** the create fails with `PERMISSION_DENIED`

**Scenario: empty-string ownerFirebaseUid is DENIED**

- **Given** the authenticated caller (mirrors the client's `currentFirebaseUid ?: ""` edge)
- **When** they create a room whose `ownerFirebaseUid` is `""`
- **Then** the create fails with `PERMISSION_DENIED` (no unattributable-owner rooms)

**Scenario: unauthenticated create is DENIED**

- **Given** no authenticated user
- **When** a room create is attempted
- **Then** it fails with `PERMISSION_DENIED` (`request.auth == null`)

**Scenario: sibling audit clean**

- **Given** the reviewer runs `grep -nE "\.get\('?ownerFirebaseUid'?" firestore.rules`
- **Then** the only historical match (line 229) is the one tightened in this PR, and no other rule uses the legacy fallback

## Test Plan (TDD)

1. Extend the `rooms/{roomId} create` describe block in `express-api/tests/firestore-rules/room-rules.test.js` (real emulator via `@firebase/rules-unit-testing`; reuses the existing `ADULT` / `roomDoc()` / `dbFor()` harness). A/C/E already existed; this SHY flips B and adds the D-family pins:
   - A: owner create with matching `ownerFirebaseUid` → `assertSucceeds` (pre-existing).
   - B: create with the field ABSENT → `assertFails`. **RED: the pre-existing test asserted `assertSucceeds` (the `.get(default)` fallback let it through); flipped to `assertFails`.**
   - C: create with forged `ownerFirebaseUid` → `assertFails` (pre-existing; pins the invariant).
   - D: create with empty-string / explicit-null / whitespace-only / non-string `ownerFirebaseUid` → `assertFails` (new pins; each already denied pre-fix since the value `!= auth.uid`, pinned so the tightening cannot regress them).
   - E: unauthenticated create → `assertFails` (pre-existing; pins).
2. `cd express-api && npx jest tests/firestore-rules/room-rules.test.js -t create` against the running emulator → case **B fails** (`Expected request to fail, but it succeeded`). RED confirmed.

### Green
1. Edit `firestore.rules:229`: `request.auth.uid` default → `''`.
2. Update the rule comment (dated SHY-0029 security note; drop the stale "after rollout" wording).
3. Re-run the emulator test → all cases GREEN.
4. Regression: re-run the existing `room-rules.test.js` (create happy paths + read/delete/update-lockdown) → still green — the tightening must not break a legitimate create or alter read/delete/update.
5. No PRODUCTION client change (the app already writes the field). One now-false comment in `app/src/test/java/com/shyden/shytalk/feature/home/HomeViewModelTest.kt` (which claimed the old `.get(default)` still let an empty-uid create pass) is corrected to reference SHY-0029 — a test-comment fix caused by this rule change, not a logic change (`detekt` / `ktlint` still N/A; the test's assertions are unchanged).

### Pre-Merge Testing Protocol
**Not `*.md`-only** — edits `firestore.rules` (backend/product runtime; the CI-config-only exemption explicitly does NOT apply to `firestore.rules`). The FULL gauntlet applies: rules-emulator suite (the RED→GREEN) + the room-create owner journey re-walked on real Android + real iPhone + all browsers (owner create succeeds; the deny paths are emulator-proven) → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet (deploy the branch's rules to `shytalk-dev`, re-walk create) → judgment-merge (operator; a broken create flow or a re-opened fieldless path is a safety incident). Device/browser execution is batched to the operator's final real-device pass per the MVP-sprint model.

## Out of Scope
- Migrating any existing fieldless rooms in dev/prod (pre-public; expected count ~0 — separate follow-up SHY only if a scan finds any).
- Improving the client `PERMISSION_DENIED` message (no app users yet).
- The Express-side ownership check (already defence-in-depth; unchanged).
- Tightening any unrelated rule; only the `ownerFirebaseUid` create binding.
- Any client change — the current app already writes `ownerFirebaseUid`; the empty-string edge deny is intended.

## Dependencies
- `express-api/tests/firestore-rules/` real-emulator harness (exists: `room-rules.test.js`, `admin-claim-rules.test.js`).
- Firebase emulator suite (`firebase emulators:start --only firestore,auth` — Java, no Docker).
- The PR #858 room-update lockdown is already merged (this SHY relies on updates being Admin-SDK-only).

## Risks & Mitigations
- **Risk:** the current client passes an empty `ownerFirebaseUid` in a real authenticated create (not just the null edge) → the tightened rule denies a legitimate create. **Mitigation:** `HomeViewModel:434` derives it from `currentFirebaseUid`, which for an authenticated caller equals `request.auth.uid`; the empty branch only fires when the uid is genuinely absent (in which case denying is correct). Proven by re-walking the create journey in the gauntlet.
- **Risk:** a sibling rule elsewhere uses the same fallback and is missed. **Mitigation:** grep audit in AC + BDD + reviewer re-run; grep already shows a single occurrence.
- **Risk:** rules syntax error. **Mitigation:** `firebase deploy --only firestore:rules` pre-validates; the emulator test won't load a broken file.

## Definition of Done
- [ ] `firestore.rules:229` tightened to `get('ownerFirebaseUid', '') == request.auth.uid`; dated SHY-0029 comment added; sibling audit clean (single occurrence).
- [ ] The `rooms/{roomId} create` block in `room-rules.test.js` extended (OMIT flipped to deny + empty/null/whitespace/non-string pins); all firestore-rules suites green (incl. the absent-field deny).
- [ ] **Pre-Merge Testing Protocol satisfied**: rules-emulator suite green → room-create journey re-walked on real Android + real iPhone + all Mac browsers → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet (rules deployed to `shytalk-dev` + create re-walked) → judgment-merge (operator; zero doubt). Pre-public → no prod deploy in this SHY.
- [ ] `released_in: vX.Y.Z` after release cut; `status: Done`; `pr:` populated; outcomes in Notes.

## Notes (running log)
- 2026-06-07 ~20:30 BST — Refined under SHY-0032. Bumped P1 → P0. Pre-public window inverts the roadmap's ">90d rollout" guard.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle PR-I7 (G026).
- 2026-06-12 ~23:45 BST — Embedded the Pre-Merge Testing Protocol (SHY-0091 pass).
- 2026-07-08 — **RE-REFINED at pickup (pickup-fitness; the prior spec was materially stale).** The `.get('ownerFirebaseUid', request.auth.uid)` fallback is on the room **`allow create`** rule (now `firestore.rules:229`, on `request.resource.data`), NOT an `allow update` rule — client-side room-doc **updates were fully locked down** by the PR #858 server-authz cutover (`firestore.rules:232-237`), so the story's original "any authed user can UPDATE a fieldless doc" premise is obsolete. Real remaining gap: a create that omits `ownerFirebaseUid` yields a fieldless room, breaking the owner-left RTDB attestation (`PresenceService.kt:31-45`). Fix = the code comment's own prescribed tightening (default `request.auth.uid` → `''`). Verified the current client writes the field (`HomeViewModel.kt:434` → `IosRoomRepositoryImpl.kt:102`), so no client change needed; grep confirms a single occurrence. Test target corrected to the real `express-api/tests/firestore-rules/` harness (was the non-existent `firestore-rules-tests/`). Status Draft → In Progress.
- 2026-07-08 — **TDD**: extended `room-rules.test.js` `create` block — flipped the pre-existing OMIT test `assertSucceeds`→`assertFails` (RED confirmed: "Expected request to fail, but it succeeded"), tightened `firestore.rules:229` default `request.auth.uid`→`''` (GREEN). Full `express-api/tests/firestore-rules/` suite 129 green; eslint `--max-warnings=0` + prettier clean.
- 2026-07-08 — **code-reviewer pass 1 (local, pre-push): NO Critical.** 2 Important + 1 coverage gap, all applied same-day: (gap) added null/whitespace/non-string `ownerFirebaseUid` deny pins (126→129 green); (I) 4 stale AC/Test-Plan/DoD refs to a never-created `room-owner-firebase-uid-strict.test.js` → repointed at the `room-rules.test.js` create block; (I) now-false comment in `HomeViewModelTest.kt:328` (claimed the old default still passed) → corrected to the SHY-0029 deny (VM assertions unchanged). **Confirmation pass: all resolved, zero new blocking findings** (plus this Notes-audit entry + a "test file"→"block" wording nit, now applied). Rule byte-identical since first review. No production logic changed beyond the one `firestore.rules` line.
- 2026-07-08 — **Disposition:** built + reviewed + committed on branch `story/SHY-0029-tighten-ownerfirebaseuid-rule` (off `origin/main`). NOT pushed yet: its CI is gated by the android-e2e flake until SHY-0163/#1539 lands the gate deferral on main, and a clean push needs the full local stack (Docker, down) or an operator-authorised `--no-verify`. Push + open PR (base `main`) once #1539 is merged (a rebase then makes CI green). Flip to In Review at push.
- 2026-07-08 — **Landed via develop (SHY-0164 unblocked the push).** SHY-0164 (merged to develop) made the pre-push Sonar gate main-only, so feature→develop pushes no longer need the local emulator or `--no-verify`. Rebased this branch onto `develop` (clean replay, no conflicts; SHAs `ee7052101e7`→`40fe9499f68`, content byte-identical → the prior 100%-clean review still holds — nothing new to re-review). Re-verified the full `express-api/tests/firestore-rules/` suite **129/129 green** against the live Firestore emulator. Retargeted from `main` to `develop` per the sprint. Backend⇒full device/browser gauntlet DEFERRED to the operator's final real-device batch at the develop→main promotion (sprint's device-E2E deferral). Status → In Review. Pre-existing follow-up noted (not this SHY): the firestore-rules suites lack `afterAll(testEnv.cleanup())` → jest "worker failed to exit gracefully" warning across all 4 suites; separate test-hygiene story.

Reviewed-up-to: 40fe9499f68
