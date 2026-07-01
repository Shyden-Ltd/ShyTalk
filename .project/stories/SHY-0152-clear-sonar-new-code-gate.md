---
id: SHY-0152
status: In Progress
owner: claude
created: 2026-07-01
priority: P1
effort: S
type: bug
roadmap_ids: []
pr:
mvp: false
---

# SHY-0152: Clear the SonarCloud new-code quality gate (2 bugs + 2 content-length reviews)

## User Story

**As** a developer whose every push runs the local pre-push SonarCloud gate,
**I want** the 4 new-code issues that fail that gate (2 real bugs + 2 upload content-length findings) fixed,
**So that** the gate returns to green and stops blocking *all* pushes on debt unrelated to whatever change is being pushed — while the two real defects and the two upload envelopes are genuinely fixed/hardened, not suppressed.

## Why

The pre-push hook runs `./gradlew sonar -Dsonar.qualitygate.wait=true`; the gate currently **FAILS** on two conditions — `new_reliability_rating = D` and `new_security_rating = C` — while `new_coverage` (91.6%), duplications, and maintainability all pass. A red gate blocks **every** push (discovered while pushing the unrelated SHY-0142 pin-fix: its own suite was 12,516-green, yet the push was refused on this pre-existing debt). The four gate-driving issues are:

- **BUG/CRITICAL** `tests/utils/email-local.test.js:47` — `expect(sendEmail(...)).rejects.toThrow(...)` in a non-async test with no `await`/`return`: the assertion resolves *after* the test ends, so it passes even if `sendEmail` never rejects (a false-green).
- **BUG/MAJOR** `src/utils/log.js:16` — a promise created inside a `try` whose block can only catch a synchronous throw (the async rejection is handled separately by `.catch`); SonarCloud flags the "promise in try without await" shape as a latent bug.
- **VULNERABILITY/MAJOR ×2** `src/routes/banners.js:18` + `src/routes/storage.js:20` — rule `javascript:S5693` ("Make sure the content length limit is safe here") on the two multer upload configs. Both already cap `fileSize` at 10 MB; the finding asks for the request envelope to be confirmed/bounded safe.

The 717 other new-code issues (mostly `S2699` "test should include assertions") are code-smells that land in *maintainability* (rating A) and do **not** gate — so they are explicitly out of scope here.

## Acceptance Criteria

### Happy path
- [ ] `new_reliability_rating` returns to **A**: the un-awaited async assertion is awaited, and the fire-and-forget logger no longer holds a promise inside a `try` without `await`.
- [ ] `new_security_rating` returns to **A**: both upload routes carry an explicit, documented, bounded request envelope (≤1 file, ≤10 MB) that resolves the two `S5693` findings.
- [ ] The SonarCloud quality gate reports **OK**, so `gradlew sonar -Dsonar.qualitygate.wait=true` (and therefore the pre-push hook) passes.

### Error paths
- [ ] The `email-local` test, now awaited, still **passes** — proving `sendEmail` in non-local mode genuinely rejects with the expected error (the fix must not just silence the assertion; it must show the behaviour is correct). If it had failed, that would have exposed a real defect the false-green was hiding.
- [ ] `log.js` still **never throws** on a synchronous throw from the logger **and** never surfaces an unhandled rejection on an async failure — both paths preserved by the refactor (existing `log.test.js` sync-throw test stays green).

### Edge cases
- [ ] The two upload routes still accept a normal single-file upload unchanged (`files: 1` matches their existing `.single('file')` usage — non-breaking); a request with >1 file is now explicitly rejected by the count bound.
- [ ] The `log.js` refactor keeps the helper **synchronous** (fire-and-forget): callers that invoke it without `await` are unaffected (it must not become `async`).

### Performance
- N/A — no hot-path change; the logger stays non-blocking and the upload envelope is only made stricter.

### Security
- [ ] Both upload envelopes are explicitly bounded (`fileSize` ≤10 MB **and** `files: 1`) and the reviewed-safe rationale is documented in-code, so a future reader sees the deliberate, safe bound rather than an unexplained limit.
- [ ] No suppression: the fixes are real (await / refactor / explicit bounds), not `// NOSONAR` or rule disables. If `S5693` proves to be a pure review-rule that persists despite the explicit bound, the sanctioned resolution is a **reviewed-safe mark** on the finding (with justification), not a code suppression — recorded in Notes.

### UX
- N/A — no user-facing surface; developer-facing benefit is an un-blocked push flow.

### i18n
- N/A — backend/tooling change.

### Observability
- [ ] `log.js` behaviour (structured logging, never throwing) is unchanged and still covered by `log.test.js`; no logging output changes.

## BDD Scenarios

**Scenario: the code-quality gate goes green so pushes are no longer blocked**
- **Given** the automated code-quality gate was failing because of a couple of real defects and two upload size-limit checks awaiting confirmation
- **When** those defects are fixed and the upload limits are confirmed safe
- **Then** the gate passes, and a developer can push their work again instead of being blocked by unrelated problems

**Scenario: a test that used to pass without really checking now truly checks**
- **Given** a test meant to confirm that sending email fails safely when email isn't configured
- **When** the test is corrected so it actually waits for that outcome
- **Then** it genuinely confirms the failure happens — and would now catch it if that safety behaviour ever broke

**Scenario: file uploads stay within a safe, explicit size**
- **Given** the banner and file-upload features that accept an image or file
- **When** someone uploads a normal single file
- **Then** it is accepted as before, while anything beyond one file or the size cap is rejected — a clearly-bounded, safe upload

## Test Plan

Touches `express-api/src/**` + one `express-api/tests/**` file ⇒ `backend_changed` ⇒ FULL Pre-Merge gauntlet (Gate-4). Real dependencies per CLAUDE.md § No Stubs (the route tests hit the real MinIO/R2 + Firebase emulator; no new doubles added — the pre-push no-new-stubs ratchet passes).

**Red → Green:**
- **`email-local.test.js`** — the awaited assertion is the fix; run `tests/utils/email-local.test.js` → **4/4 green** (confirms `sendEmail` really rejects; the fix is not a silencer). ✅ done.
- **`log.js`** — refactor moves the promise out of the `try`; run `tests/utils/log.test.js` → **6/6 green** (all 5 levels + the sync-throw guard preserved). ✅ done.
- **`banners.js` + `storage.js`** — `files: 1` + documented bound; run `tests/routes/banners.test.js` + `tests/routes/storage.test.js` + `tests/routes/storage-delete.test.js` against the real MinIO → **55/55 green** (single-file uploads unaffected). ✅ done.
- **Lint** — eslint `--max-warnings=0` + prettier clean on all 4 files. ✅ done.
- **Gate proof** — the pre-push `gradlew sonar` re-analysis reports the quality gate **OK** (`new_reliability_rating` A + `new_security_rating` A). This is the load-bearing verification; if `S5693` persists as a review-only finding, resolve via a reviewed-safe mark (Notes) and re-confirm the gate.
- **Device gauntlet** — no app/web RUNTIME/UI change (backend route-config + logging + test); device leg = no-corruption proof, batched to the operator-gated window.

## Out of Scope
- The 717 other new-code `CODE_SMELL` issues (e.g. `S2699` "tests should include assertions" in `room-rules.test.js`) — they hit maintainability (rating A) and do not gate; a separate clean-up story can address them.
- Lowering the 10 MB upload cap (a product decision) — this story bounds file **count** + documents the existing size cap as safe, it does not change the size value.
- The SHY-0142 pin-fix (separate story/branch); this story unblocks its push once merged to main.

## Dependencies
- The local stack (Docker + MinIO + Firebase emulators) for the route tests + the pre-push coverage run.
- `SONAR_TOKEN` (from `.env`) for the pre-push gate analysis.
- SonarCloud project `ShydenMcM_ShyTalk` new-code-period configuration (defines the window these ratings evaluate).

## Risks & Mitigations
- **Risk:** `javascript:S5693` is a review-class rule that persists despite the explicit `files: 1` bound. **Mitigation:** the bound is a genuine hardening regardless; if the finding remains, mark it reviewed-safe with the documented justification (single-file, ≤10 MB, authenticated/admin, memoryStorage) — the sanctioned resolution for a confirmed-safe review finding, not a suppression. Recorded in Notes with the outcome.
- **Risk:** the `log.js` refactor subtly changes fire-and-forget behaviour. **Mitigation:** existing `log.test.js` (sync-throw guard + 5 levels) stays green; the `.catch` still swallows async rejections, just relocated outside the `try`; the helper stays synchronous.
- **Risk:** `files: 1` breaks a legitimate multi-file upload. **Mitigation:** both routes use `.single('file')` (exactly one file), so the bound matches existing behaviour — proven by 55/55 route tests.

## Definition of Done
- [ ] 4 fixes applied; `email-local` 4/4, `log` 6/6, route suites 55/55, eslint + prettier clean, no-new-stubs ratchet green (all done locally).
- [ ] Pre-push `gradlew sonar` quality gate **OK** (verified by the actual push succeeding); if `S5693` needed a reviewed-safe mark, that is recorded in Notes.
- [ ] Pushed + PR opened (operator-gated, NO auto-merge). Once merged to main, the SHY-0142 pin-fix branch merges main and pushes clean.
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED + PICKED UP** fully-refined ([[feedback-no-skeleton-stories-fully-refined]]); status In Progress. Discovered while pushing the SHY-0142 pin-fix: the pre-push SonarCloud gate was red (`new_reliability_rating` D + `new_security_rating` C) on 4 pre-existing new-code issues, **none in the pin-fix diff** — blocking every push. Operator chose "fix the 4 first" over a `--no-verify` bypass. Investigated each via the SonarCloud API (not guessed): 2 real bugs (un-awaited async assertion; promise-in-try) + 2 `S5693` content-length findings where a 10 MB `fileSize` limit already existed. Fixes: `await` the assertion (verified it genuinely rejects); relocate the logger promise outside the `try` (behaviour-preserving, stays synchronous); add explicit `files: 1` bound + documented reviewed-safe rationale to both upload configs. All local checks green + no-new-stubs ratchet green. Branch `fix/SHY-0152-clear-sonar-new-code-gate` off `origin/main`. **Architect gate skipped** ([[feedback-rate-limit-slowdown-strategies]]: small, well-scoped defect/hardening fixes). The pre-push sonar re-analysis is the load-bearing gate proof (recorded on push).
- 2026-07-01 — **`code-reviewer`: 0 Critical / 3 Important / 0 suppression** (log.js refactor + email fix verified clean by the reviewer). All 3 fixed TDD: **I1** — adding `files: 1` made multer's `LIMIT_FILE_COUNT` reachable in `storage.js`, but that route wired multer as bare middleware, so multer errors hit Express's default handler → **500/HTML** (`banners.js` already wraps multer in a custom error callback → 400/413). Mirrored the `banners.js` pattern into `storage.js` — this ALSO fixes the **pre-existing** `LIMIT_FILE_SIZE`→500 gap on that route ([[feedback-fix-pre-existing-and-new-same]]). RED→GREEN: 2 new `storage.test.js` tests failed at 500, pass at 400/413 after the fix. **I2** — added `LIMIT_FILE_COUNT` coverage to `banners.test.js` (400, guard — banners already handled it) + `storage.test.js` (400 + 413). **I3** — added the async-rejection guard to `log.test.js` (`mockRejectedValueOnce` on the existing `mockLog` — not a new double; no-new-stubs ratchet green). All 62 route/log tests green; email 4/4; eslint + prettier clean. Re-review of the fix **self-reviewed** (mirrors the already-reviewed `banners.js` pattern verbatim + TDD RED→GREEN; a full re-dispatch is disproportionate for a prescribed, tested fix — flagged not silently skipped).
