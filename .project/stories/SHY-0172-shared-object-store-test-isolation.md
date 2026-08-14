---
id: SHY-0172
status: Draft
owner: claude
created: 2026-07-10
priority: P2
effort: M
type: bug
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0172: Two cron suites wipe the same object-store folders and the same mailbox, so a green run proves nothing

## User Story

**As** an engineer trusting a green test run,
**I want** no test file to delete stored files or messages another file is actively using,
**So that** a passing suite means the code is right, not that the parallel scheduling happened to be kind.

## Why

SHY-0149 closed this defect class for **Firestore and Auth** by giving each wholesale-wiping suite its own emulator project (`FIRESTORE_TEST_NAMESPACE`), and added `express-api/tests/unit/test-isolation-guard.unit.test.js` so a new violation fails loudly. **The object store and the mailbox were left shared**, and a Firestore namespace gives them no isolation at all.

Two real-emulator suites wipe the **same five MinIO folders** wholesale, in `beforeEach`:

- `express-api/tests/cron/accountDeletion.test.js` — `R2_PREFIXES = ['profiles/', 'covers/', 'messages/', 'groups/', 'evidence/']`, and additionally deletes **every Mailpit message**.
- `express-api/tests/cron/orphanedStorage.test.js` — lists and deletes every object under `profiles/`, `covers/`, `messages/`, `groups/`, `evidence/`, `banners/`.

Jest runs test files in parallel workers against ONE MinIO bucket (`shytalk-media`) and ONE Mailpit instance. If one suite's `beforeEach` fires while the other is mid-test, the objects under test vanish and the assertions pass or fail for reasons unrelated to the code under test.

This is currently **latent, not observed**: the pair passed five consecutive parallel runs during the SHY-0149 round-10 review. That is exactly the evidence the Firestore collision offered before it fired — three full green suite runs, then a hard failure the moment worker packing changed. Green under a scheduler you do not control is not evidence.

Three further suites write real objects under their own prefixes (`rotateLogs` → `logs/`, `backups` → `backups/`, `expireDataExports` → `exports/`) and do not currently overlap. `tests/utils/r2.test.js` also writes real objects. They are in scope for the guard, not necessarily for a fix.

Surfaced by the SHY-0149 round-10 code review (finding R10-I4). Not a production defect — this is test-infrastructure correctness — but it silently undermines every suite that stores a real object or sends a real email.

## Acceptance Criteria

### Happy path
- [ ] Every suite that stores real objects still asserts exactly what it asserts today, and passes.
- [ ] `accountDeletion` and `orphanedStorage` pass when run together, repeatedly, under parallel scheduling.

### Error paths
- [ ] One suite's cleanup can no longer delete an object or an email another test file created — demonstrated by a reproduction, not asserted by inspection.

### Edge cases
- [ ] The chosen mechanism holds when a suite fails mid-test (cleanup stays scoped, nothing leaks into the next run).
- [ ] `local/seed.js`, the `npm run local` server and the dev-deploy smoke path keep using the canonical bucket and mailbox.
- [ ] A suite that wipes a folder it alone uses is not forced to isolate needlessly.

### Performance
- [ ] No full-suite wall-clock regression beyond ~10%.

### Security
- N/A — test-infrastructure change; no production surface.

### UX
- N/A — no user-facing surface.

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] A new wholesale object-store or mailbox wipe that collides with another suite **fails loudly at test time**, by extending `tests/unit/test-isolation-guard.unit.test.js` (and its analyzer, `tests/helpers/test-isolation-analyzer.js`) rather than by adding a second, parallel guard.

## BDD Scenarios

**Scenario: two test files that both store files run at the same time**
- **Given** one test file that tidies away all stored files before it starts
- **And** another test file that has just stored a file and is checking it is still there
- **When** both run at the same time
- **Then** neither disturbs the other, and both report the truth about the code

**Scenario: a tidy-up runs while another test is working**
- **Given** a test file finishing and clearing out the shared mailbox
- **When** another test file is midway through checking the email it just sent
- **Then** the tidy-up removes only the first file's messages

**Scenario: someone adds a new wholesale clear-out**
- **Given** a new test file that empties a shared storage folder without claiming it
- **When** the test suite runs
- **Then** it fails immediately with a message naming the file, the folder, and the other files that rely on it

## Test Plan

Touches `express-api/tests/**` (and possibly a small test helper) → no product runtime surface; the device/browser gauntlet does not apply.

**Red → Green:**
- **Reproduce first (this is the RED).** The collision is timing-dependent, so a plain parallel run is not enough: force the interleaving. Options: run the pair in a loop with `--maxWorkers=2` while artificially slowing `orphanedStorage`'s assertions, or drive both suites' cleanup/seed from a harness that pins the order. A reproduction that only *sometimes* fires is acceptable as RED provided it is shown to fire.
- **Express/Node (Jest, real MinIO + real Mailpit):** apply the isolation, then show 10 consecutive green parallel runs of the previously-colliding pair, plus the full `npm test` green.
- **Guard:** extend `test-isolation-analyzer.js` with object-store/mailbox facts and add fixture tests proving the detector catches a wholesale prefix wipe and a mailbox wipe. Mutation-verify: revert each detection and watch the fixture test go red.
- **Static/quality:** `npm run lint` 0 warnings; prettier clean.

**Options to weigh (pick with evidence, not taste):**
1. **Per-file key prefix** — every suite writes under `test-<file>/profiles/...` and clears only its own prefix. Cheapest, mirrors the per-file document-id prefixes SHY-0149 used for `deviceBindings`. Risk: the crons under test hardcode folder names, so the *production* code would have to accept a configurable root.
2. **Per-file bucket** — `shytalk-media-<namespace>`, created on demand, mirroring `FIRESTORE_TEST_NAMESPACE` exactly. Most symmetrical with the Firestore fix and needs no production change if `r2.js` already reads the bucket from config. Risk: bucket lifecycle/cleanup, and MinIO bucket-creation cost per suite.
3. **Serialise the object-store suites** — a dedicated Jest project run after the parallel ones. Simplest, slowest.
4. **Mailpit:** it has no namespace concept. Either assert on messages matching this suite's recipient address (surgical, no wipe) or accept a serialised mailbox suite. Prefer the surgical read — `accountDeletion` is the only cron asserting on email.

## Out of Scope
- The Firestore/Auth isolation — delivered by SHY-0149.
- The `orphanedStorage` production risk flagged in SHY-0120 (media in the 31st+ conversation swept as orphans). Separate defect, separate story.
- Any production code change beyond, at most, making the storage root/bucket configurable.

## Dependencies
- `express-api/tests/helpers/test-isolation-analyzer.js`, `tests/unit/test-isolation-guard.unit.test.js` (both delivered by SHY-0149).
- `express-api/src/utils/r2.js` (bucket + endpoint resolution), `local/docker-compose` MinIO + Mailpit services.

## Risks & Mitigations
- **Risk:** the fix looks green because the flake is probabilistic. **Mitigation:** the RED step must reproduce the collision before the fix; the GREEN step needs repeated parallel runs, not one.
- **Risk:** per-file prefixes require production code to accept a configurable storage root, widening the blast radius. **Mitigation:** prefer the per-bucket option if `r2.js` already resolves the bucket from config.
- **Risk:** creating a bucket per suite is slow. **Mitigation:** measure; only the handful of real-object suites need it.

## Definition of Done
- [ ] The collision is reproduced BEFORE the fix, and 10 consecutive parallel runs pass after it.
- [ ] No test file wipes an object-store folder or a mailbox another file writes; violations fail loudly via the existing guard.
- [ ] `code-reviewer` 100% clean → In Review → CI green by name → merge → `released_in:` on the next cut.

## Notes (running log)

- 2026-07-10 — **CREATED fully-refined** from the SHY-0149 round-10 review (finding R10-I4). SHY-0149 fixed the same defect class for Firestore (`FIRESTORE_TEST_NAMESPACE`) and Auth (deriving the accounts-wipe URL from the suite's own project), and added a structural guard — but a Firestore namespace does not scope MinIO or Mailpit, and both `accountDeletion` and `orphanedStorage` wipe the identical five folders wholesale. Verified live: the two suites share `profiles/`, `covers/`, `messages/`, `groups/`, `evidence/`, and `accountDeletion` additionally deletes every Mailpit message. Five consecutive parallel runs passed — which is precisely how the Firestore collision looked right up until it fired, so this is filed as a real latent defect rather than dismissed. Filed rather than folded into SHY-0149: it needs an isolation-mechanism decision (per-file prefix vs per-file bucket vs serialised project), it may require making the storage root configurable in production code, and its RED step is a reproduction harness rather than a code change. Related: [[SHY-0171]] (cancelled; its Firestore scope landed inside SHY-0149), [[SHY-0120]] (real-emulator cron migration, which introduced the real-MinIO usage).
