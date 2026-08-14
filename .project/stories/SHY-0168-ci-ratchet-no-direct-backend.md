---
id: SHY-0168
status: Done
owner: claude
created: 2026-07-09
priority: P0
effort: M
type: infra
roadmap_ids: []
pr:
released_in: v0.98.0
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

- [ ] `scripts/check-no-direct-backend.js` scans production client code — `app/src/main/**/*.kt`, `shared/src/{commonMain,androidMain,iosMain}/**/*.kt`, and ALL of `public/**/*.{js,mjs,cjs,html,htm}` (the web scope guard is `^public/`, not just `public/js/`, so the admin console `public/admin/js/**` + `public/portal/**` are covered) — for direct backend-service references and exits non-zero when a NEW client file (absent from the baseline) references a backend SDK (file-presence ratchet).
- [ ] It matches BOTH Kotlin SDK namespaces — `com.google.firebase.{firestore,database,storage}` (Android native) AND `dev.gitlive.firebase.{firestore,database,storage}` (iOS/KMP) — and, on web: a modular import from a `firebase[-/]{firestore,database,storage}` module, compat `firebase.{firestore,database,storage}(`, and the modular entry-points/read-ops `get{Firestore,Database,Storage}(` / `onSnapshot(` / `onValue(` / `getDocs(` / `getDoc(` / `addDoc(`/`setDoc(`/`updateDoc(`/`deleteDoc(`. Both Kotlin namespaces AND all three web forms matter or violations pass. The web detector requires a call-paren (`\s*\(`) but NO `\b` left-anchor, so DI-renamed accessors like `_onSnapshot(` / `_getDocs(` are caught (recall over precision) while a bare mention isn't; matching the read-ops transitively covers `collection()` usage (a collection ref is passed to a read-op).
- [ ] A committed baseline (`scripts/direct-backend-baseline.json`, per-category arrays of file paths) exempts the current known sites; the ratchet is **file-presence**-based (matching the proven `check-no-new-stubs.js` pattern): it fails on a NEW file that references a backend SDK but is absent from the baseline. An already-baselined file stays flagged (regardless of how many calls it holds) until ALL its direct access is removed — at which point it becomes a STALE baseline entry to trim (`--generate-baseline`). The set of tracked files may only SHRINK.
- [ ] A new `lint.yml` step runs the ratchet; failure blocks the PR (surfaces under a required check).
- [ ] CLAUDE.md gains an "API-only backend access" rule (Architecture + Pre-Merge Testing Protocol) stating clients never touch Firestore/RTDB/Storage directly — everything via the Express API; `code-reviewer` treats a violation as blocking.

### Error paths

- [ ] **Baseline file missing/malformed** → the script exits non-zero with a clear message (fail-closed: never pass silently when it can't read its own baseline).
- [ ] **A baselined file is deleted/renamed** (remediated) → the script does not crash; it FAILS naming the now-stale baseline entry to trim (`--generate-baseline`), so the baseline stays honest (the ratchet only tightens).
- [ ] **Violation found** → stderr emits, per offending file, a GitHub `::error file=…::` annotation naming the file + the offending category (Firestore / RTDB / Storage / web) + the remediation pointer ("route via an Express API endpoint — CLAUDE.md § API-only backend access, EPIC-0006"), then a non-zero exit. File-level (matching `check-no-new-stubs.js`): a NEW violation is a NEW file the contributor authored, so the file identity is the actionable signal; per-line/symbol tracking is intentionally not added, for parity with the sibling ratchet.

### Edge cases

- [ ] The Express API's own Admin SDK usage (`express-api/**`) is NEVER scanned/flagged — it is the sanctioned server channel.
- [ ] **Test source sets** (`**/androidTest/**`, `**/*Test/**`, `shared/src/{jvmTest,commonTest,androidHostTest}/**`, `app/src/test/**`) are excluded from the production ratchet — a test hitting the real emulator is the no-mocks REAL path ([[feedback-no-stubs-mocks-fakes-real-only]]), not a shipped-client violation; they're tracked in the audit, not gated here.
- [ ] Comment/mention handling is per-detector: the Kotlin categories match the import namespace (`com.google.firebase.…` / `dev.gitlive.firebase.…`), which realistically only appears in real imports (an unused import fails ktlint); the web detector requires a call-paren, so a bare comment or a `let _onSnapshot = null` declaration does NOT hit while a real call (incl. a `_`-prefixed DI accessor) does. Recall is favoured over precision — a rare comment-with-parens false positive is safe (fail-closed), a missed call is not.
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

- [ ] On failure, the FULL list of new offender files prints (one `::error file=…::` per file, not just the first) so a contributor fixes them in one pass, each with its category + remediation pointer. On success, prints the current total remaining (the ratchet countdown toward zero).

## BDD Scenarios

**Scenario: a new direct Firestore call is blocked**
- **Given** a contributor adds `import com.google.firebase.firestore.FirebaseFirestore` to a new file under `app/src/main`
- **When** the CI ratchet runs
- **Then** it exits non-zero, naming the offending file and pointing at the API-only rule
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

- [x] `scripts/check-no-direct-backend.js` + `direct-backend-baseline.json` (31 files) implemented; all Test-Plan cases green (RED-proven first) — 45 Jest tests.
- [x] Wired into `lint.yml`; a planted violation fails (proven end-to-end: exit 1).
- [x] CLAUDE.md documents the API-only rule (Architecture) + `code-reviewer` enforcement note.
- [x] **Pre-Merge Testing Protocol satisfied** (CI-config-only exemption): 48 Jest tests + eslint (0 warnings) + prettier + validator + `code-reviewer` 100% clean (4 rounds → zero findings) → **judgment-merge** to develop; NO auto-merge. (actionlint + CI-green-by-name confirmed by the develop→main promotion.)
- [ ] `released_in: vX.Y.Z` after the release cut; `status: Done`.

## Notes (running log)

- 2026-07-09 — Created as the FIRST child of [[EPIC-0006]] (prevention before remediation) in response to the operator's critical directive ([[feedback-no-direct-backend-all-via-api]]). Design mirrors `check-no-new-stubs.js`. Baseline sourced from the in-flight audit `.project/audit/direct-backend-access-audit-2026-07-09.md`. CI-config-only → gauntlet-exempt, so it can land fast to stop the bleeding while the remediation stories are written.
- 2026-07-09 — **code-reviewer round-1 caught a live false-NEGATIVE in the security control (Critical) + coverage/spec gaps — all fixed.** I verified the Critical myself before acting (ran the regex against the real files). Fixes: **(1)** the web regex used `\bonSnapshot\s*\(`, but `\b` treats `_` as a word char so it MISSED the real DI-renamed calls this codebase uses (`_onSnapshot(` at admin/js/tabs/logs.js:669, `_getDocs(` at spin-monitor.js:376) → my earlier "precision tightening" had silently dropped 3 real web-violation files from the baseline. Dropped the `\b` (kept the call-paren for precision); **(2)** added the modular web getters `getDatabase(`/`getStorage(`/`onValue(` (Finding 2) + reads `getDocs(`/`getDoc(`/`addDoc(`/`setDoc(`/`updateDoc(`/`deleteDoc(` + a `from '…firebase[-/]{firestore,database,storage}…'` import-source signal (Findings 2,3); **(3)** regenerated the baseline → **31 files** (webData 2→5, the 3 tabs restored); **(4)** added the 13 missing tests for the 5 previously-uncovered exports — incl. the **"scanRepo == committed baseline" drift invariant** (would have caught the incomplete baseline), the CLI exit-code contract via `process.execPath` (no `git` spawn → no `sonarjs/no-os-command-from-path`, no eslint-disable), `reportAndExit`, `generateBaseline` idempotence, `gitTrackedFiles` non-git-throws; **(5)** aligned the AC to the real (file-presence, file-level-annotation) design (removed the count/`.collection(`/`file:line:symbol` over-claims); **(6)** flipped status → In Review (Pre-Merge Gate). Now **45 tests** green (2 mutation + 1 precision sentinel), prettier+eslint clean, ratchet exit 0, e2e catch re-proven. **Reviewed-up-to: 7bcba1f858f.**
- 2026-07-09 — **code-reviewer round-2: NO Critical — security core empirically confirmed complete** (reviewer ran the fixed regex against the whole `public/` tree → exactly the 5 baselined web files match, zero false positives). Raised 3 Important + 2 minor coverage gaps, all prose/test-hygiene (none security-functional); I verified each against the real files, then fixed all: **(1)** residual `file:line` over-claim in BDD Scenario 1 → "the offending file"; **(2)** AC scope-glob said `public/js/**` but the code guard is `^public/` → corrected to all `public/**/*.{js,mjs,cjs,html,htm}` (the real code was broader/safer than the doc — admin console WAS covered); **(3)** the `generateBaseline` idempotency test wrote to the REAL tracked baseline every run → extracted a pure `serializeBaseline()` (the reviewer's own suggested fix) and replaced it with a **read-only** `serializeBaseline(scanRepo)==committed` check — no filesystem side-effect; **(4)** `--help` test now asserts the HELP banner in stdout (not just exit 0); **(5)** `gitTrackedFiles` non-git test now pins `.toThrow(/git ls-files failed/i)` (was a bare `.toThrow()`). Still 45 tests green, prettier+eslint clean, ratchet exit 0. **Reviewed-up-to: 8695bab67cc.**
- 2026-07-09 — **code-reviewer round-3 caught a REGRESSION MY round-2 fix introduced (Critical) + a tautology (Important) — both fixed.** Round-2 fixed the write-side-effect by *deleting* the idempotency test, which removed the ONLY coverage of `generateBaseline()` + the `--generate-baseline` CLI branch (a security-control remediation action left unverified). And the read-only `serializeBaseline(scanRepo)` test fed pre-ordered input, so the CATEGORIES key-order contract wasn't actually pinned (a mutation to drop the reorder would stay green). Verified both myself, then fixed by ISOLATING (not deleting): added a `makeTempRepo` helper that seeds a disposable git repo — **git spawned via a PATH-resolved ABSOLUTE path (`resolveGit`), so `sonarjs/no-os-command-from-path` is satisfied WITHOUT an eslint-disable** ([[feedback-never-suppress-fix-or-upgrade]]; the sibling ratchet suppresses, I don't). New tests: `generateBaseline` writes correctly into the temp repo (real baseline untouched); CLI `--generate-baseline` → exit 0 + "wrote" + correct file; and a **scrambled/partial-key `serializeBaseline` test** that pins key order (mutation-proven RED: mutant key order `webData,storage,…` ≠ asserted `firestore,rtdb,storage,webData`). Now **48 tests** green, prettier+eslint clean (0 warnings), ratchet exit 0. Lesson: "I verified green" ≠ safe — round-2's green hid a coverage regression; the reviewer's re-derivation caught it. **Reviewed-up-to: 63cadb0c908.**
- 2026-07-09 — **code-reviewer round-4: CLEAN — zero findings** (Critical/Important/coverage all empty) on the `8695bab67cc..63cadb0c908` delta. Independently confirmed: `makeTempRepo` isolates every generateBaseline/CLI test from the real baseline (all 3 `BASELINE` uses read-only); the two new tests assert return-value + written-content + real-baseline-untouched; the scrambled-key `serializeBaseline` test is mutation-proven non-tautological; NO `eslint-disable` (the git spawns use the `resolveGit` absolute path, and the reviewer verified `sonarjs/no-os-command-from-path` is live-configured + still applies to the test file under `--max-warnings=0`, so `resolveGit` was substantively necessary, not cosmetic); `git ls-files` after `init`+`add` (no commit) needs no git identity → no CI flake; no `.only`/`.skip`. **ZERO-findings bar met across 4 rounds → judgment-merge to develop.** (One sub-threshold note the reviewer explicitly did NOT flag: with the current 4 category names, CATEGORIES-order coincides with alphabetical, so the order test can't distinguish them — moot unless a future 5th category is added out of alphabetical position; the test correctly pins the real reorder-to-CATEGORIES-order behavior.)
