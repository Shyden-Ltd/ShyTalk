---
id: SHY-0168
status: Draft
owner: claude
created: 2026-07-09
priority: P0
effort: M
type: infra
roadmap_ids: []
pr:
mvp: true
epic: EPIC-0006
---

# SHY-0168: CI ratchet + reviewer rule that blocks any NEW direct client→backend access

## User Story

As the ShyTalk operator, I want a **CI guard that fails the build when any client file gains a direct call to a backend service** (Firestore / RTDB / Storage), plus a documented reviewer rule, so that while we remediate the existing ~26 direct-access sites nobody can merge a NEW one — the [[feedback-no-direct-backend-all-via-api]] rule is enforced structurally, not by memory.

## Why

The operator's 2026-07-09 directive is "never ever repeat this mistake again … ensure our review process picks up on this and blocks it … testing to ensure it doesn't happen again ever." Remediation (EPIC-0006) is many stories over time; without a ratchet the count would regrow faster than we fix it. This is the [[feedback-root-cause-not-symptom]] structural-prevention move: make the bad state **un-mergeable**. Modeled on the proven `scripts/check-no-new-stubs.js` ratchet (SHY-0108/0112) that halted mock regrowth.

## Acceptance Criteria

### Happy path

- [ ] `scripts/check-no-direct-backend.js` scans production client code — `app/src/main/**/*.kt`, `shared/src/{commonMain,androidMain,iosMain}/**/*.kt`, `public/js/**/*.js`, `public/**/*.html` — for direct backend-service references and exits non-zero when a file exceeds its baseline count.
- [ ] It matches BOTH Kotlin SDK namespaces — `com.google.firebase.{firestore,database,storage}` (Android native) AND `dev.gitlive.firebase.{firestore,database,storage}` (iOS/KMP) — and web data usage (`getFirestore`, `firebase.firestore(`, `firebase.database(`, `firebase.storage(`, `onSnapshot`, `.collection(`). Both namespaces matter or half the violations pass.
- [ ] A committed baseline (`scripts/direct-backend-baseline.json`, per-category arrays of file paths) exempts the current known sites; the ratchet is **file-presence**-based (matching the proven `check-no-new-stubs.js` pattern): it fails on a NEW file that references a backend SDK but is absent from the baseline. An already-baselined file stays flagged (regardless of how many calls it holds) until ALL its direct access is removed — at which point it becomes a STALE baseline entry to trim (`--generate-baseline`). The set of tracked files may only SHRINK.
- [ ] A new `lint.yml` step runs the ratchet; failure blocks the PR (surfaces under a required check).
- [ ] CLAUDE.md gains an "API-only backend access" rule (Architecture + Pre-Merge Testing Protocol) stating clients never touch Firestore/RTDB/Storage directly — everything via the Express API; `code-reviewer` treats a violation as blocking.

### Error paths

- [ ] **Baseline file missing/malformed** → the script exits non-zero with a clear message (fail-closed: never pass silently when it can't read its own baseline).
- [ ] **A baselined file is deleted/renamed** (remediated) → the script does not crash; it reports the now-unused baseline entry so it can be trimmed toward empty.
- [ ] **Violation found** → stderr names `file:line`, the offending symbol, and the remediation pointer ("route via an Express API endpoint — CLAUDE.md § API-only backend access, EPIC-0006"), then a non-zero exit.

### Edge cases

- [ ] The Express API's own Admin SDK usage (`express-api/**`) is NEVER scanned/flagged — it is the sanctioned server channel.
- [ ] **Test source sets** (`**/androidTest/**`, `**/*Test/**`, `shared/src/{jvmTest,commonTest,androidHostTest}/**`, `app/src/test/**`) are excluded from the production ratchet — a test hitting the real emulator is the no-mocks REAL path ([[feedback-no-stubs-mocks-fakes-real-only]]), not a shipped-client violation; they're tracked in the audit, not gated here.
- [ ] Matches ignore commented-out lines and string literals only if trivially cheap; otherwise a commented reference still counts (conservative — a comment referencing the SDK is harmless noise, and false-positives are removed by fixing the comment, which is safe). Document the chosen stance.
- [ ] Firebase **Auth** (`com.google.firebase.auth` / `dev.gitlive.firebase.auth`) is NOT matched by this ratchet — auth-plane token minting is a separate operator ruling (EPIC-0006 scope note), not a data-plane violation.

### Performance

- [ ] Pure file-glob + regex; completes in well under the existing lint budget (no network, no build). Comparable to `check-no-new-stubs.js` runtime.

### Security

- [ ] This IS a security control. It must **fail closed** — any internal error (bad baseline, unreadable file) exits non-zero, never a false green. A green run must mean "no new direct-backend access", provably.

### UX

- [ ] N/A — CI/dev-tooling; the "user" is the contributor, served by the clear violation message + remediation pointer.

### i18n

- [ ] N/A — developer tooling, English.

### Observability

- [ ] On failure, the full list of new/increased violations prints (file:line:symbol), not just the first — a contributor fixes them in one pass. On success, prints the current total remaining (the ratchet countdown toward zero).

## BDD Scenarios

**Scenario: a new direct Firestore call is blocked**
- **Given** a contributor adds `import com.google.firebase.firestore.FirebaseFirestore` to a new file under `app/src/main`
- **When** the CI ratchet runs
- **Then** it exits non-zero, naming the file:line and pointing at the API-only rule
- **And** the PR's required check fails, so it cannot merge

**Scenario: the known baseline still passes (no false block during remediation)**
- **Given** the repo at the audit baseline (the ~26 already-known direct-access files, unchanged)
- **When** the ratchet runs
- **Then** it exits zero (baseline-exempted) — remediation isn't blocked by pre-existing debt

**Scenario: remediating a file and forgetting to trim the baseline is surfaced, not silently passed**
- **Given** a file's direct-access calls are removed (remediated) but its baseline entry remains
- **When** the ratchet runs
- **Then** it FAILS, naming the now-stale baseline entry to remove (run `--generate-baseline`) — the ratchet only tightens, so the baseline must stay honest

**Scenario: the iOS gitlive namespace is caught too**
- **Given** a new `dev.gitlive.firebase.firestore` reference in `shared/src/iosMain`
- **When** the ratchet runs
- **Then** it fails — both SDK namespaces are enforced, not just Android's

## Test Plan

**Red:** add `express-api/tests/scripts/check-no-direct-backend.test.js` (Jest, unit — pure script logic over fixture dirs, a permitted unit-test double location). RED cases before the script exists / is correct:
- a fixture file with `com.google.firebase.firestore` under a client glob → script exits non-zero.
- a fixture with `dev.gitlive.firebase.database` → non-zero (iOS namespace).
- a clean fixture (no backend refs) → exits zero.
- a baselined fixture → exits zero; the same file with an ADDED violation → non-zero.
- an `express-api/**` fixture with Admin SDK usage → exits zero (never flagged).
- a `**/androidTest/**` fixture with a direct call → exits zero (test source set excluded).
- malformed baseline JSON → non-zero (fail-closed).

**Green:** implement `scripts/check-no-direct-backend.js` + `scripts/direct-backend-baseline.json` (baseline = the audit's enumerated sites) until all the above pass.

**Coverage gate:** every AC bullet maps to a named test; the mutation check — reverting the both-namespaces match to Android-only must turn the iOS-namespace test RED (proves the test isn't a tautology, [[feedback-test-must-fail-if-logic-skipped]]).

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**CI-config-only classification** (exemption 2): this story touches only `scripts/**` (the ratchet + baseline), `.github/workflows/lint.yml` (one step), its Jest test, and `CLAUDE.md` — **no app/backend/website runtime surface**. So the device/browser gauntlet is EXEMPT. It STILL runs the full relevant non-device gauntlet: the new Jest script test (`cd express-api && node --experimental-vm-modules node_modules/.bin/jest tests/scripts/check-no-direct-backend.test.js`), `eslint`/`prettier` `--max-warnings=0`, `actionlint` on the workflow edit, the story-frontmatter validator, `code-reviewer` 100% clean, and CI green by name (Detect Changes · Analyze JavaScript · PR Gate). **Judgment-merge** to develop when green + review-clean; NO auto-merge.

## Out of Scope

- Remediating the existing violations — that's the EPIC-0006 remediation stories; this only STOPS new ones and documents/baselines the known set.
- The real-time-read transport decision — [[EPIC-0006]] spike (SHY-0169).
- Tightening `firestore.rules` — later remediation story.
- Firebase Auth ruling — separate operator decision.

## Dependencies

- The audit `.project/audit/direct-backend-access-audit-2026-07-09.md` (in progress) provides the authoritative baseline site list; the ratchet's `direct-backend-baseline.json` is derived from it (or from a fresh grep at implementation time, cross-checked against the audit).
- `scripts/check-no-new-stubs.js` as the reference implementation pattern; `lint.yml` for the wiring.

## Risks & Mitigations

- **Risk: the ratchet's regex misses a usage form** (e.g. a re-exported alias) → a violation sneaks through. **Mitigation:** match the import namespaces (hard to alias across a module boundary) + the call forms; the audit cross-checks the baseline count equals the ratchet's detected count at creation (any mismatch = a missed pattern to add).
- **Risk: false positives block legitimate code.** **Mitigation:** scoped globs (production client only), `express-api`/test-source exclusions, and a clear message + the baseline escape valve for the (temporary) known set.
- **Risk: contributors pad the baseline to bypass.** **Mitigation:** baseline may only shrink; the reviewer rule + a `code-reviewer` checklist item flag any baseline ADDITION as blocking.

## Definition of Done

- [ ] `scripts/check-no-direct-backend.js` + `direct-backend-baseline.json` implemented; all Test-Plan cases green (RED-proven first).
- [ ] Wired into `lint.yml`; a planted violation fails CI by name.
- [ ] CLAUDE.md documents the API-only rule (Architecture + Pre-Merge Testing Protocol) + `code-reviewer` enforcement note.
- [ ] **Pre-Merge Testing Protocol satisfied** (CI-config-only exemption): Jest script test + eslint + actionlint + validator + `code-reviewer` 100% clean + CI green by name → **judgment-merge** to develop; NO auto-merge.
- [ ] `released_in: vX.Y.Z` after the release cut; `status: Done`.

## Notes (running log)

- 2026-07-09 — Created as the FIRST child of [[EPIC-0006]] (prevention before remediation) in response to the operator's critical directive ([[feedback-no-direct-backend-all-via-api]]). Design mirrors `check-no-new-stubs.js`. Baseline sourced from the in-flight audit `.project/audit/direct-backend-access-audit-2026-07-09.md`. CI-config-only → gauntlet-exempt, so it can land fast to stop the bleeding while the remediation stories are written.
