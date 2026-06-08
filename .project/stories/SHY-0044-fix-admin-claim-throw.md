---
id: SHY-0044
status: Draft
owner: claude
created: 2026-06-08
priority: P0
effort: XS
type: bug
roadmap_ids: [G025]
pr:
---

# SHY-0044: Fix `firestore.rules:140` admin-claim throws-on-absent — use `isAdmin()` helper

## User Story

As a security-conscious ShyTalk maintainer, I want **`firestore.rules` line 140 to use the existing `isAdmin()` helper** (defined at rule line 37) **instead of the raw `request.auth.token.admin` direct property access**, so that requests from authenticated users WITHOUT an `admin` custom claim are correctly rejected (`false`) rather than throwing a rule-evaluation error that gets logged as a separate failure class.

## Why

Roadmap row (line 27, 2026-06-05): `G025 | 🔴 Critical | Security — request.auth.token.admin throws on absent claim | firestore.rules:140 | Direct property access throws (not returns false) when claim absent; rule 37 documents the safe .get() helper but rule 140 doesn't use it | Replace with isAdmin(); add emulator test asserting non-admin token denied | XS`.

Firestore Security Rules' direct property access (`request.auth.token.admin`) is semantically different from the `.get()` form:
- `request.auth.token.admin` → THROWS a rule evaluation error if the `admin` key is absent on the token.
- `request.auth.token.get('admin', false)` → returns `false` cleanly if absent.

The helper `isAdmin()` (defined at line 37 per the audit) uses the safe `.get()` form. Line 140 was not migrated when the helper was introduced. Result: non-admin users hitting the rule path on line 140 get a 500-class error rather than a clean 403.

This is a **security correctness defect** because:
1. Throwing rules can mask real denial logic.
2. Logging differs — throws aren't aggregated with normal denies.
3. Client error handling differs — generic error vs PERMISSION_DENIED.

## Acceptance Criteria

### Happy path

- [ ] `firestore.rules` line 140 (or wherever the direct access lives after any line shifts) replaces `request.auth.token.admin` with `isAdmin()`.
- [ ] A grep verification: `grep -n 'request\.auth\.token\.admin' firestore.rules` returns ZERO matches (NONE outside of `isAdmin()`'s definition at line 37).
- [ ] New emulator test in `firestore-rules-tests/` covering: (a) admin token → allowed, (b) non-admin token → denied with `PERMISSION_DENIED`, (c) absent admin claim → denied with `PERMISSION_DENIED` (NOT internal error).
- [ ] `firebase emulators:exec --only firestore "npm test"` runs the new test + passes.
- [ ] Production rule deploy via `npx firebase deploy --only firestore:rules` succeeds without warnings.

### Error paths

- [ ] **`isAdmin()` helper definition changed since audit**: re-grep before edit; rule body should match the helper's `.get('admin', false) == true` form.
- [ ] **Test for "absent claim" requires a custom-token harness**: use Firebase Test SDK's `initializeAdminApp` + custom-token mint without the `admin` claim; verify rule evaluation completes cleanly.
- [ ] **Other call sites of `request.auth.token.admin` discovered during grep**: convert them in the same PR (per [[feedback-fix-pre-existing-and-new-same]]).
- [ ] **Rule deploy fails due to unrelated issue**: fix unrelated issue or revert this commit; do not bypass the deploy gate.

### Edge cases

- [ ] **Compound rules using `admin && something_else`**: ensure short-circuit semantics preserved — `isAdmin() && something_else` is correct.
- [ ] **Rule line numbers may shift** if other rules edits land between SHY filing and PR: use `grep -n` to find current line, not the static `:140`.
- [ ] **Rule sub-collections that inherit the parent rule**: verify cascading rules also benefit (none expected since Firestore rules don't cascade).
- [ ] **`isAdmin()` helper itself becomes the throw source**: verify the helper uses `.get(...)`, not direct access.

### Performance

- [ ] No performance regression — `isAdmin()` is a single `.get()` call; same complexity as direct access (or even faster, since throws are slow).

### Security

- [ ] Verified the new emulator test covers all three token states (admin, non-admin-with-claim-false, no-claim-at-all).
- [ ] No new admin surface introduced — same rule path, just using the safe helper.
- [ ] Audit log: rule denials now consistently classified as `PERMISSION_DENIED`, not internal errors.

### UX

- [ ] Clients hitting this rule path see consistent `PERMISSION_DENIED` (was: mix of permission-denied + internal-error depending on token shape).
- [ ] Existing admin-only operations continue to work for true admins (no regression).

### i18n

- [ ] N/A — server-side rule, no user-facing strings.

### Observability

- [ ] Commit message: `[SHY-0044] firestore.rules: use isAdmin() helper at line N (G025 fix)`.
- [ ] Deploy log archived as part of the PR (Firebase deploy emits the commit SHA in its output).
- [ ] Rules test results captured in the PR description.

## BDD Scenarios

**Scenario: Admin token allowed**

- **Given** an authenticated user with `admin: true` custom claim
- **When** the user attempts the rule-140 protected operation
- **Then** the operation succeeds (`PERMISSION_DENIED` not raised)

**Scenario: Non-admin token denied cleanly**

- **Given** an authenticated user with `admin: false` custom claim
- **When** the user attempts the same operation
- **Then** the operation is denied with `PERMISSION_DENIED`
- **And** no internal-error metric increments

**Scenario: Absent claim denied cleanly (the bug-fix case)**

- **Given** an authenticated user with NO `admin` claim on their token at all
- **When** the user attempts the operation
- **Then** the operation is denied with `PERMISSION_DENIED`
- **And** no rule-evaluation-error metric increments (the pre-fix behaviour)

## Test Plan

**Red:**
- New emulator test (`firestore-rules-tests/admin-claim.test.js` or extend existing rules-test file) — must fail BEFORE the fix because the absent-claim case raises an internal error.
- Test runner: `firebase emulators:exec --only firestore "npx jest firestore-rules-tests/admin-claim.test.js"`.

**Green:**
- Edit `firestore.rules` line N (currently ~140; verify with grep): `request.auth.token.admin` → `isAdmin()`.
- Re-run the emulator test — all three scenarios pass.
- Deploy to dev: `npx firebase deploy --only firestore:rules --project shytalk-dev`.
- Manual smoke: hit the protected endpoint as non-admin → PERMISSION_DENIED in client logs.

**Coverage gate:** 3 emulator-test scenarios pass; production rules-deploy succeeds.

## Out of Scope

- Migrating EVERY direct `request.auth.token.*` access in `firestore.rules` — only the `.admin` direct access is in scope here. Other claims (if any direct accesses exist) get their own follow-up SHYs if a grep surfaces them.
- Refactoring `isAdmin()` itself — its definition is correct.
- Adding new admin custom claims — operator-policy work, separate scope.
- Front-end UX changes for the PERMISSION_DENIED error path.

## Dependencies

- `isAdmin()` helper at `firestore.rules:37` (audit-verified to exist).
- Firebase Test SDK + Emulator (already in use).
- `firebase emulators:exec` script (already in CI).
- `npx firebase deploy --only firestore:rules` (operator-authorised deploy; this SHY's PR includes the dev deploy as verification).

## Risks & Mitigations

- **Risk: line number shifted by another rules edit between SHY filing and pickup.** Mitigation: grep for `request.auth.token.admin` to find current location.
- **Risk: the fix breaks a legitimate admin operation if `isAdmin()` semantics differ from `request.auth.token.admin`.** Mitigation: emulator test scenario 1 (admin → allowed) catches; reviewer audits the helper definition.
- **Risk: production deploy fails (e.g. quota, transient Firebase issue).** Mitigation: deploy goes to dev first; production deploy is a separate operator-driven step.
- **Risk: similar pattern hides elsewhere in the rules**. Mitigation: full-file grep included in this PR.

## Definition of Done

- [ ] `firestore.rules` edited; grep verifies no remaining direct `.admin` access.
- [ ] Emulator test added covering 3 token states; all pass.
- [ ] Dev deploy verified.
- [ ] Reviewer ZERO findings.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~12:58 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 27 (G025). Reserved ID SHY-0044. **Critical security correctness item** — schedule pickup ahead of the lower-priority polish SHYs.
