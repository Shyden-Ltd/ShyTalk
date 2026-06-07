---
id: SHY-0029
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: S
type: bug
roadmap_ids: [G026]
pr:
---

# SHY-0029: Tighten ownerFirebaseUid rule (strict equality, no legacy fallback)

## User Story

As the ShyTalk operator concerned about authorization correctness, I want **`firestore.rules:218-225`'s `ownerFirebaseUid` check to enforce strict equality with `request.auth.uid`** (no fallback when the field is absent), so that a class of legacy-client/IDOR/missing-field bypass attempts becomes impossible at the database layer.

## Why

Current rule at `firestore.rules:218-225`:

```javascript
// (current, vulnerable to missing-field-fallback bypass)
allow update: if request.auth != null &&
    resource.data.get('ownerFirebaseUid', request.auth.uid) == request.auth.uid;
```

The `.get('ownerFirebaseUid', request.auth.uid)` pattern returns the field's value if present, **otherwise returns the second argument** (`request.auth.uid`). This means: if the document lacks the `ownerFirebaseUid` field entirely, the comparison becomes `request.auth.uid == request.auth.uid` — trivially true. Any authenticated user can update such a document, regardless of intended ownership.

This was introduced as a legacy compatibility shim during the cron-elimination cluster (closed 2026-06-04/05). At the time, several stale documents lacked `ownerFirebaseUid` because the field was added mid-rollout. The fallback prevented breakage. But the cluster is now closed; new documents always carry the field; and Play Store rollout of the field-introducing release should have substantially completed by now.

Roadmap row G026 (line 116 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟠 Important. Category: Security — `ownerFirebaseUid` rule has legacy fallback. Location: `firestore.rules:218-225`. Gap: `.get('ownerFirebaseUid', request.auth.uid)` allows absent field (legacy pre-cron-elim). Fix: If Play Store rollout complete (>90d), tighten to strict `== request.auth.uid` + add rules test. Scope: S.

Bumped to Tier 1 P0 under SHY-0032 because (a) it's a security tightening, (b) pre-public-release window is the cheap time to land it without disrupting a real user base, (c) the operator's "quality + reliability over speed" weighting.

Rollout window check: the field-introducing release was part of the cron-elim cluster commits 2026-06-04/05; today is 2026-06-07 (only ~2 days, NOT >90d). However: ShyTalk is pre-public (only the shytalk.com website is live), so there is no installed-base of stale clients in the wild. The ">90d" guard from the roadmap was written when public release was assumed; pre-public release inverts the calculus — tighten NOW because there are no users to break.

## Acceptance Criteria

### Happy path

- [ ] `firestore.rules:218-225` is rewritten to require strict equality without fallback:
  ```javascript
  allow update: if request.auth != null &&
      'ownerFirebaseUid' in resource.data &&
      resource.data.ownerFirebaseUid == request.auth.uid;
  ```
  (The `'ownerFirebaseUid' in resource.data` check makes the absent-field case explicit and denied; the equality is now safe because we know the field is present.)
- [ ] A new emulator test in `firestore-rules-tests/owner-firebase-uid-strict.test.js` asserts:
  - Legit owner (auth.uid matches doc.ownerFirebaseUid) is allowed.
  - Non-owner authenticated user is denied.
  - Anonymous (unauthenticated) is denied.
  - Document without `ownerFirebaseUid` field is denied (the case the old fallback let through).
- [ ] The change is deployed to dev via `npx firebase deploy --only firestore:rules --project shytalk-dev`.
- [ ] A smoke check via curl/admin SDK confirms the new rule is in effect on dev.
- [ ] Documentation: a comment block immediately above the new rule names the date + SHY-NNNN + summary of why the fallback was removed.

### Error paths

- [ ] If a legacy document (no `ownerFirebaseUid` field) exists in dev or prod and a user attempts to update it, the request returns `PERMISSION_DENIED`. Verified by:
  - Seeding a no-`ownerFirebaseUid` doc into the emulator
  - Issuing an update as an authenticated user
  - Asserting `assertFails(...)` from `@firebase/rules-unit-testing`
- [ ] If the rule deploy fails (network, auth, project mismatch), the previous rule remains active (Firebase's rules deploy is atomic) — verified by checking the rule version SHA before vs after.
- [ ] If the dev smoke check fails post-deploy, the SHY does NOT proceed to prod; instead it rolls back via `firebase deploy --only firestore:rules` with the prior rule file.
- [ ] If the new rule accidentally blocks a legitimate flow (e.g. admin-override path that relies on a different rule), a sibling rule for the admin override is added (using the `isAdmin()` helper at `firestore.rules:140`).
- [ ] If the comment block accidentally introduces a syntax error in the rules file, `firebase deploy --only firestore:rules` fails locally before reaching dev — caught by the deploy command's pre-validation.

### Edge cases

- [ ] Ownership transfer flows: if any code path legitimately UPDATES `ownerFirebaseUid` from old-owner-uid to new-owner-uid (e.g. account-deletion handover), it MUST go via the Express API + admin SDK (which bypasses rules). Verified by:
  - Grep for `ownerFirebaseUid` updates in client code (`grep -rn "ownerFirebaseUid" app/ shared/ ios/ public/js/`)
  - Asserting all client-side write call sites go through Express, not direct Firestore
- [ ] Admin-override path: an admin with `request.auth.token.admin == true` may need to edit other users' docs (moderation). The new rule does NOT cover this; the existing admin path at `firestore.rules:140` (via the safe `isAdmin()` helper) must be confirmed to still work post-tightening.
- [ ] Pre-cron-elim documents migrated incorrectly: if any stale prod docs still lack `ownerFirebaseUid`, this rule starts denying their updates. Mitigation: scan dev Firestore for such docs first (`firebase firestore:export` + grep) and surface a count; if non-zero, file a migration follow-up SHY before proceeding.
- [ ] Cross-rule interactions: this rule lives in a `match /someCollection/{docId}` block. If the collection has sibling rules (create, delete, list, get) that use the same legacy `.get()` pattern, they should be tightened in the same PR. Audit + close all sibling drift.

### Performance

- [ ] Rule evaluation time is unchanged (constant-time field check + equality). Verified by reading the Firebase rules-monitoring logs post-deploy for a 5-min window and asserting no regression in p99 latency.
- [ ] No new external calls (`get()` to other docs, etc.) introduced — the new rule is a pure local-doc check.
- [ ] Emulator test suite runs within 30s.

### Security

- [ ] A security-review subsection in the rule file's comment block enumerates:
  - **Prior vuln class**: legacy clients (or any caller) writing a doc without `ownerFirebaseUid` field bypassed the owner check.
  - **Threat actors**: any authenticated user attempting to modify another user's owned data.
  - **Closed bypass**: missing-field via `.get(default)` pattern.
- [ ] The new rule's logic is exercised by adversarial test cases (per [[feedback-exhaustive-tests-first-no-gaps]]): try uid-spoofing in custom claims, try edge cases like empty-string uid, try cross-user write attempts.
- [ ] No other rule file in `firestore.rules` still uses the legacy `.get('ownerFirebaseUid', request.auth.uid)` pattern; if any do, they are tightened in the same PR.
- [ ] Defence-in-depth: the Express API server-side validation also checks ownership (verify a sample Express route uses `req.firebaseUser.uid === room.ownerFirebaseUid`). This is documented; not in scope to enforce here.

### UX

- [ ] In pre-public release: no end-user impact (no users to break).
- [ ] In post-public release (future): a stale client attempting a now-denied update would see a generic "permission denied" error. Future SHY will add a more precise client-side error message (out of scope for this SHY but flagged).
- [ ] Admin moderation flows continue to work (verified via the admin-tools BDD scenarios if any apply post-deploy).

### i18n

- [ ] N/A — server-side rule change; no user-facing strings introduced.

### Observability

- [ ] Firebase rules logs (accessed via console or `firebase functions:log` if instrumented) capture denied requests; expected to be ~0 in pre-public (no users to deny).
- [ ] If a future Crashlytics non-fatal report references the new `PERMISSION_DENIED`, it's traceable to this SHY via the rule comment block.
- [ ] The new emulator test logs an explicit message per failed assertion (`expect(...).toHaveBeenDeniedDueToAbsentField()` or equivalent), so a future regression's diagnostic is precise.
- [ ] The `firestore.rules` file's diff is part of the PR (not a separate deploy-only artifact) for git-blameability.

## BDD Scenarios

**Scenario: Legit owner allowed to update their own document**

- **Given** a Firestore doc `someCollection/abc123` with `ownerFirebaseUid: "user-alice"`
- **And** user "user-alice" is authenticated via Firebase Auth
- **When** alice attempts to update the doc via the Firestore SDK
- **Then** the update succeeds (rule allows it)

**Scenario: Non-owner denied**

- **Given** the same doc owned by alice
- **And** user "user-bob" is authenticated
- **When** bob attempts to update the doc
- **Then** the update fails with `PERMISSION_DENIED` (rule denies — `ownerFirebaseUid != bob.uid`)

**Scenario: Anonymous denied**

- **Given** the same doc owned by alice
- **And** no user is authenticated (Firebase Auth signed out)
- **When** the update is attempted from the client
- **Then** the update fails with `PERMISSION_DENIED` (rule denies — `request.auth == null`)

**Scenario: Missing-field document denied (the bypass case this SHY closes)**

- **Given** a Firestore doc `someCollection/legacy456` with NO `ownerFirebaseUid` field
- **And** any authenticated user (e.g. mallory) attempts to update the doc
- **When** the update is sent
- **Then** the update fails with `PERMISSION_DENIED` (NEW behaviour — previously this would have succeeded because of the `.get(default)` fallback)

**Scenario: Sibling rules audited**

- **Given** the PR is opened
- **When** reviewer grep runs `grep -nE "\\.get\\('?ownerFirebaseUid'?" firestore.rules`
- **Then** the only match is the now-removed legacy pattern (deleted in this PR)
- **And** no other sibling rule still uses the legacy fallback pattern

**Scenario: Admin moderation path unaffected**

- **Given** an admin with `request.auth.token.admin == true`
- **When** they attempt to update any document for moderation
- **Then** the existing admin-override rule path at `firestore.rules:140` (via `isAdmin()`) still permits the update
- **And** the new tightened owner rule does NOT block admins (because the admin clause is OR-ed, not AND-ed)

**Scenario: Ownership transfer routed through Express API**

- **Given** the codebase grep `grep -rn "ownerFirebaseUid" app/ shared/ public/js/`
- **When** the results are reviewed
- **Then** no client-side code path updates the field directly via Firestore SDK
- **And** all transfer flows go through Express API + admin SDK (which bypasses rules)
- **And** if any direct-write site exists, it's flagged as a security issue and fixed in this PR

## Test Plan (TDD)

### Red

1. Add `firestore-rules-tests/owner-firebase-uid-strict.test.js`:
   - Test A: alice owns doc; alice updates → assertSucceeds.
   - Test B: alice owns doc; bob updates → assertFails (denied).
   - Test C: alice owns doc; no auth → assertFails.
   - Test D: legacy doc (no ownerFirebaseUid field); any user updates → assertFails. **This test currently passes (i.e. the update succeeds) because of the bypass — meaning it's a RED test that REVEALS the vuln.**
2. Run `cd firestore-rules-tests && npm test -- owner-firebase-uid-strict`.
3. Test D fails the assertion (`expected assertFails but got assertSucceeds`). RED confirmed.

### Green

1. Audit `firestore.rules` for all uses of `.get('ownerFirebaseUid', ...)`; collect line numbers.
2. Replace each occurrence with the new strict pattern:
   ```javascript
   "ownerFirebaseUid" in resource.data &&
     resource.data.ownerFirebaseUid == request.auth.uid;
   ```
3. Add the security-review comment block above each tightened rule.
4. Run `firebase emulators:start --only firestore` + re-run the emulator test → GREEN on all 4 cases.
5. Deploy to dev: `npx firebase deploy --only firestore:rules --project shytalk-dev`.
6. Smoke via curl: POST to `dev-api.shytalk.shyden.co.uk/api/...` with valid auth + verify owner check via the API layer (which adds defence-in-depth).
7. Scan dev Firestore for any docs lacking `ownerFirebaseUid` (`firebase firestore:export` + grep). If non-zero count, file a migration follow-up SHY but do NOT block this one (the rule still tightens; stale docs become read-only via this path, which is the correct behaviour for stale state).

## Out of Scope

- **Migrating stale dev Firestore docs to add `ownerFirebaseUid`** — separate follow-up SHY if needed.
- **Improving the client-side error message for `PERMISSION_DENIED`** — future SHY (the apps have no users yet).
- **Adding a Cloud Function trigger to back-fill `ownerFirebaseUid` on writes** — out of scope; the tightening is the fix.
- **Refactoring the Express API ownership check** — already defence-in-depth; unchanged.
- **Tightening any other unrelated rules** — only `ownerFirebaseUid` siblings; other rule audits are separate SHYs.

## Dependencies

- **SHY-0004** (Room mutation P3 deploy verify) — should ideally land first so we know the room-mutation path is in a known state before we tighten this rule.
- `firestore-rules-tests/` test harness — verify exists; create if not.
- `npx firebase deploy --only firestore:rules` — must work against `shytalk-dev` project.
- Firebase emulator suite (already a CLAUDE.md prerequisite).
- The legacy `.get()` pattern locations identified via grep.

## Risks & Mitigations

- **Risk:** Stale dev Firestore docs without `ownerFirebaseUid` become un-updatable post-tightening. **Mitigation:** scan dev pre-deploy; count is expected to be near-zero (cron-elim closed 2026-06-04/05); if non-zero, document the docs and decide whether to migrate (file follow-up SHY) or accept (they become effectively read-only via this code path).
- **Risk:** A sibling rule for `create`/`delete` uses the same legacy pattern and gets missed. **Mitigation:** the grep + audit is part of AC + BDD; reviewer agent re-runs the grep.
- **Risk:** The admin-override path silently breaks (e.g. the admin rule was ALSO using the legacy fallback). **Mitigation:** explicit AC bullet under `### Edge cases` verifies admin moderation still works post-tightening.
- **Risk:** Production deploy is risky if pre-public-release assumption is wrong (e.g. a beta-tester cohort exists with stale clients). **Mitigation:** deploy to dev first; manual smoke; before prod deploy, query Firebase Auth user count + recent activity to confirm "no installed base" assumption.
- **Risk:** The new rule's `'ownerFirebaseUid' in resource.data` syntax is wrong (some Firestore rules versions use `resource.data.keys().hasAll([...])` instead). **Mitigation:** verify syntax against Firebase rules docs + run emulator test; both gates catch a syntax error.

## Definition of Done

- [ ] `firestore.rules:218-225` (and all sibling occurrences of the legacy `.get()` pattern) tightened to strict equality + field-present check.
- [ ] `firestore-rules-tests/owner-firebase-uid-strict.test.js` added; all 4+ test cases green.
- [ ] Rule comment block added with security-review summary + SHY-0029 reference.
- [ ] Dev deploy completed; smoke check passes.
- [ ] Sibling-rule audit completed; no legacy `.get()` pattern remains for `ownerFirebaseUid`.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`bug` → auto-merge + dev smoke; pre-public so no prod deploy in this SHY).
- [ ] PR merged via auto-merge.
- [ ] `status: Done`; `pr:` populated; merge + dev-deploy outcomes in Notes.

## Notes (running log)

- 2026-06-07 ~20:30 BST — Refined under SHY-0032. Bumped P1 → P0. Pre-public window inverts the roadmap's ">90d rollout" guard: tighten now because no users to break.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-I7` (roadmap_ids: G026).
