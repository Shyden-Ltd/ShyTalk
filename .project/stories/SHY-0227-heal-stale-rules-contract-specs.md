---
id: SHY-0227
status: In Progress
owner: claude
created: 2026-07-21
priority: P1
effort: S
type: bug
roadmap_ids: []
pr:
---

# SHY-0227: Heal the stale Firestore-rules contract specs and kill the tautological cohort-forging tests

## User Story

- **As the** ShyTalk operator shipping an age-segregated, minors-facing product
- **I want** the integration specs that guard our Firestore security rules to actually assert the rules we ship — and to fail when a rule is removed
- **So that** a green integration suite is real evidence that the cohort and device-binding defences work, instead of a comfortable number that would stay green if those defences were deleted

## Why

1. **Four specs assert a contract the product deliberately revoked.** `integration-tests` is red on main lineage — 4 of 136 specs, every one a positive-permission ("CAN") assertion:
   - `07-firestore-rules-enforcement.spec.ts:493` — "user CAN read their own device binding". `firestore.rules` L529 is `allow read, write: if false`: **SHY-0170** (#1550, 2026-07-09) moved the device-lock decision server-side and denies ALL client access by design. The spec encodes the pre-SHY-0170 contract.
   - `10-firestore-cohort-rules.spec.ts:1099/1115/1211` — room creates whose payload omits `ownerFirebaseUid`. `firestore.rules` L223 requires `ownerFirebaseUid == request.auth.uid`; **SHY-0029** (#1541, 2026-07-08) removed the legacy fallback and its own rule comment states the intended outcome: "**absent -> deny**".
   The specs last changed 2026-05-13 and 2026-05-28 — **6-8 weeks before** the rules that now deny them. The rules are right; the specs are stale.
2. **Nothing ran them, because develop PRs have no CI.** Both #1541 and #1550 targeted `develop`; `statusCheckRollup` length is **0** on each (verified). `firestore.rules` does set `BACKEND=true`, and `integration-tests` does gate on `backend_changed` — so on a main-targeted PR the suite would have run. No such PR touched a triggering path between 2026-07-09 and now, so the debt sat latent. **`main` is red against its own integration suite today**, and only surfaced because SHY-0226's `.github/* -> BACKEND` leg finally lit the job up.
3. **The forging-defence tests are tautologies — PROVEN by mutation, not asserted.** Every negative test in the create-time-bind block also omits `ownerFirebaseUid`, so L223 denies them on the missing field and never reaches the cohort conjunct they claim to test. Mutant applied to `firestore.rules` (caller-cohort binding deleted outright), suite re-run against the real emulator:
   - `adult caller CANNOT create a room tagged cohort=minor (forging defence)` — **PASSED under the mutant**
   - `minor caller CANNOT create a room tagged cohort=adult (forging defence)` — **PASSED under the mutant**
   The entire age-segregation forging defence could be deleted from production rules and this suite would stay green. Six negative tests in that block are affected. Per [[feedback-mutation-passed-means-investigate]] a passing mutant IS the finding.
4. **`ownerFirebaseUid` has zero integration coverage.** `grep -rn "ownerFirebaseUid" tests/integration/` returns **0 hits** across the whole corpus — SHY-0029's central invariant (the anti-forgery bind between the room doc and the caller's Firebase UID) is asserted nowhere.
5. **It was never a firebase-tools problem.** SHY-0226 attributed these 4 failures to emulator rules-engine drift and pinned `firebase-tools@15.15.0`. Measured three ways, the failing set is byte-identical: CI unpinned (~15.24.0) 132 passed/4 failed; CI pinned 15.15.0 132/4; local 15.15.0 132/4. The pin changed nothing here, and SHY-0226's claim that "the locally-proven 15.15.0 passes these exact rules+specs" is refuted by a local run on 15.15.0. SHY-0226's rationale is corrected separately; this story fixes the actual cause.

## Acceptance Criteria

### Happy path
- [ ] `npm run test:integration` is fully green (0 failed) against the real local emulator stack, with every previously-red spec passing because the payload now satisfies the shipped rule — not because an assertion was weakened.
- [ ] Room-create specs that assert success send `ownerFirebaseUid` equal to the authenticated caller's Firebase UID, matching what the app actually writes.

### Error paths
- [ ] `user CANNOT read their own device binding` replaces the inverted assertion — the owner is denied exactly like a stranger, per the API-only contract.
- [ ] A client attempting to WRITE (forge) a `deviceBindings` doc is denied — the `write: if false` half of L529, which has no coverage today.
- [ ] A room create omitting `ownerFirebaseUid` is denied, naming SHY-0029's `absent -> deny` outcome.
- [ ] A room create carrying a `ownerFirebaseUid` belonging to a DIFFERENT user is denied (forgery defence).

### Edge cases
- [ ] The null-cohort (legacy, no `cohort` claim) caller still defaults to `minor` and can create a `cohort=minor` room once the payload is contract-correct.
- [ ] Empty-string `ownerFirebaseUid` is denied (distinct from absent — `.get(...,'')` makes both fall to the same deny, and both are pinned).

### Performance
- [ ] No wall-clock regression to the integration tier: the suite stays in the ~25s band (specs added are rules-evaluation only, no new fixtures or stack services).

### Security
- [ ] **Mutation-verified**: with the caller-cohort binding deleted from `firestore.rules`, the forging-defence specs FAIL. The same mutant that passed before this story must be caught after it.
- [ ] **Mutation-verified**: with the `ownerFirebaseUid` conjunct deleted from `firestore.rules`, the new anti-forgery specs FAIL.
- [ ] No spec is made green by relaxing an assertion, deleting a case, or widening a rule — `firestore.rules` is byte-identical to `origin/main` in the merged diff.

### UX
- N/A — test-tier only; no user-facing surface, string, or flow is touched.

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] Each corrected spec names the governing story in a comment (SHY-0029 / SHY-0170) so the next reader can trace the contract to the decision that set it, instead of re-deriving it from rule line numbers.

## BDD Scenarios

**Scenario: The safety tests notice when a safety rule is removed**
- **Given** the rule that stops someone tagging a room with an age group they don't belong to
- **When** that rule is taken out of the product
- **Then** the tests that claim to guard it fail
- **And** the failure names the age-group check as the thing that broke

**Scenario: Someone tries to create a room in another person's name**
- **Given** a signed-in member creating a room
- **When** the room record claims to be owned by a different account
- **Then** the system refuses to create it

**Scenario: Device records are private to the service**
- **Given** a member whose device is registered to their account
- **When** that member's app tries to read or change the device record directly
- **Then** the system refuses
- **And** the refusal is the same one a stranger receives — the record is reachable only through the service

**Scenario: The suite reflects the product as shipped**
- **Given** the security rules currently in production
- **When** the integration suite runs against them
- **Then** every test passes
- **And** no test asserts a permission the product deliberately removed

## Test Plan

- **RED first** (reproduced via the canonical runner `npm run test:integration` against the real local stack — Firebase emulators + Express + MinIO all probed live — on firebase-tools 15.15.0, the CI-pinned version; 132 passed / 4 failed, matching CI byte-for-byte):
  1. `07-firestore-rules-enforcement.spec.ts:493` — RED, `false for 'get' @ L529`.
  2. `10-firestore-cohort-rules.spec.ts:1099` — RED, `false for 'create' @ L223`.
  3. `10-firestore-cohort-rules.spec.ts:1115` — RED, same.
  4. `10-firestore-cohort-rules.spec.ts:1211` — RED, same.
- **RED-by-mutation** (the tautology proof, run BEFORE the fix): mutant = caller-cohort binding removed from `firestore.rules` L224-225; `-g "create-time bind"` re-run → 12 passed / 3 failed, with BOTH forging-defence specs **passing under the mutant**. Rules restored via `git checkout --` and byte-verified.
- **GREEN**: full `npm run test:integration` at 0 failed; the same two mutants re-applied AFTER the fix must now FAIL the forging specs and the new anti-forgery specs (mutant caught = the assertion is real). Rules restored and byte-verified after each mutation run.
- **NEW specs**: deviceBindings owner-read denial + client-write denial (`07-...`); `ownerFirebaseUid` absent / empty / forged denials (`10-...`).
- **Frameworks**: Playwright integration (`playwright.integration.config.ts`) against the REAL local emulator stack — no doubles, per the real-only rule; `eslint --max-warnings=0` + prettier from the `express-api` cwd; story-frontmatter validator.
- **Device gauntlet**: **claimed EXEMPT, flagged for operator/reviewer scoring.** The diff touches only `tests/integration/**` + this story `.md` — no app (`shared/**`, `app/**`, `iosApp/**`), no backend runtime (`express-api/src/**`, `firestore.rules`, `database.rules.json`), no website (`public/**`). There is no user-observable behaviour change to walk, so the gauntlet would exercise nothing related to this diff. This is NOT one of the two literal exemptions in CLAUDE.md (`*.md`-only / CI-config-only), so the classification is stated explicitly rather than assumed — see Risks.

## Out of Scope

- Correcting SHY-0226's refuted firebase-tools rationale and its pin direction — that is a separate change on #1651 (operator-decided 2026-07-21: keep pinned, correct the comment, pin forward), not this diff.
- Any edit to `firestore.rules`. The rules are correct as shipped; mutations here are transient proof steps that are reverted and byte-verified, never committed.
- Restoring CI to develop PRs — the structural gap that let this debt land (verified: 0 checks on #1541 and #1550) is real and worth its own story, but is a CI-topology change, not a spec fix. Filed as follow-up.
- Auditing the remaining ~120 green integration specs for the same tautology pattern beyond the rooms-create block. Worth doing; scoped as follow-up so this story stays one reviewable unit.

## Dependencies

- None for the work itself. Cut from `origin/main` @ `37a9dc175e0`.
- **Unblocks**: PR #1651 (SHY-0226) cannot go green until this lands on main — `gate` requires `integration-tests`, and #1651 rebases onto this.

## Risks & Mitigations

- **Risk: fixing a red test by weakening it.** The whole failure class here IS a weakened assertion. Mitigated by the mutation gate — every corrected negative spec must demonstrably FAIL against a mutant that deletes the rule it guards; a spec that can't catch its mutant is not fixed.
- **Risk: the gauntlet-exemption claim is wrong.** Tests-only is not a literal CLAUDE.md exemption. Mitigated by stating the claim in the Test Plan for explicit reviewer/operator scoring rather than silently skipping; phones are USB-unplugged at time of writing, so a gauntlet requirement is an operator call, not a silent assumption.
- **Risk: the 6 negative specs change from "pass" to "pass for a different reason", which looks like a no-op in review.** Mitigated by the recorded before/after mutant verdicts in Notes — the diff's value is invisible in the test names and visible only in mutation results.
- **Risk: `ownerFirebaseUid` values drift from what the app really writes.** Mitigated by binding each spec's value to the same `authenticatedContext(uid, ...)` uid the test already authenticates with, mirroring `HomeViewModel -> createRoom` as the rule comment describes.

## Definition of Done

- [ ] RED captured for all 4 specs via the canonical runner; tautology captured by mutant BEFORE the fix.
- [ ] Fix applied; `npm run test:integration` 0 failed; both post-fix mutants CAUGHT (forging + anti-forgery specs fail as required); `firestore.rules` byte-identical to `origin/main`.
- [ ] `eslint --max-warnings=0` + prettier clean; story validator clean.
- [ ] `code-reviewer` 100% clean on the LOCAL commit before push; `Reviewed-up-to:` recorded in Notes.
- [ ] Pushed; PR to **main**; CI green BY NAME (Detect Changes, Analyze JavaScript, PR Gate) with `integration-tests` green — the direct proof this story works.
- [ ] `scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK` with no `--skip-ci-check`; status flipped to In Review before merge.
- [ ] Follow-up stories filed: develop-PR CI gap; tautology audit of the remaining integration corpus.

## Notes

- 2026-07-21 — Born fully refined mid-incident, from evidence rather than suspicion. Chain: SHY-0226's `.github/* -> BACKEND` leg lit `integration-tests` on a main-targeted PR for the first time since 2026-07-09 -> 4 reds surfaced -> differential comparison of the two CI runs on #1651 (unpinned vs pinned) showed byte-identical failing sets, refuting the firebase-tools-drift hypothesis -> reading rules against specs showed a direct contradiction (`allow read, write: if false` vs `assertSucceeds(getDoc(...))`) -> git dates showed the specs predate the rules by 6-8 weeks -> `statusCheckRollup == 0` on #1541/#1550 explained why nobody caught it -> the mutation run turned "these negatives look suspicious" into a proven tautology.
- 2026-07-21 — Operator decisions (asked, not assumed): (1) fix scope = separate story + PR into main first, rebase #1651 after — keeps ONE-story-ONE-PR and preserves #1651's CI-config-only classification; (2) SHY-0226's pin = keep pinned but correct the refuted comment and pin forward. Decision (2) is executed on #1651, not here.
