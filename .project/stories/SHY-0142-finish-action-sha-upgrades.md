---
id: SHY-0142
status: In Review
owner: claude
created: 2026-07-01
priority: P1
effort: XS
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0142: Sync the CI pin-tests to the dependabot-bumped action SHAs (finish the pin-drift cleanup)

## User Story

**As** the team relying on "green backend CI = the pinned CI toolchain is what we vetted",
**I want** the SHA-pin guard tests to assert the *current* pinned SHAs that dependabot already rolled into the workflows (`actions/setup-java` → v5.4.0, combined `actions/cache` + `actions/cache/save` → v6.1.0),
**So that** the next backend PR's test suite goes green on those guards instead of inheriting 11 latent failures, and the guard keeps doing its real job — catching the *next* unreviewed SHA drift.

## Why

Dependabot (#1522, #1523) bumped the pinned SHAs **in the workflow YAML** but those PRs only touched `.github/workflows/**`, so they were classified workflow-only and never ran the backend Jest suite — meaning the `*-pin.test.js` guards, which assert the *old* SHAs, were never exercised and merged latently red. The failure only surfaces on the next PR that touches `express-api/**` (like the parked SHY-0137/0138/0139 trio, which carry backend changes). This is the classic pin-drift trap: the SHA-pin guard is working as designed (a SHA changed ⇒ a human must re-affirm it), it just hasn't been fed the new expected value yet. This story feeds it — test-side only, because the workflows are already correct for these SHAs.

Confirmed by reproduction (not by the handoff note, which had been inverted once before): `npx jest` on the 4 suites yields **11 failures / 87 passes**, every failure an `expect(received).toContain(oldSHA)` where the workflow now contains the new SHA. Ground-truth SHAs were read from the live workflow files and cross-checked with `git ls-remote` tag resolution: `55cc834…` = `actions/cache` v6.1.0, `1bcf9fb…` = `actions/setup-java` v5.4.0.

## Acceptance Criteria

### Happy path
- [ ] The four pin-drift suites pass because each asserts the SHA its workflow **actually uses now**: `actions/setup-java` → `1bcf9fb…` (v5.4.0) in `emulator-in-ci-pin`; combined `actions/cache` → `55cc834…` (v6.1.0) in `sonarcloud-engine-cache`, `deploy-dev-ios-cache-share` (×3), and `ios-tests-build-cache` (×4).
- [ ] The full express suite (`npm test`) is green with those 4 suites included; the previously-failing 11 assertions now pass and nothing else regresses.

### Error paths
- [ ] A **future** SHA drift (next dependabot bump not yet reflected here) still fails these suites loudly with an exact expected/received SHA diff — the guard's purpose is preserved, not weakened.

### Edge cases
- [ ] The `actions/cache/restore` sub-action assertion is **left unchanged** (the workflows still pin restore to the older `27d5ce7…` / v5.0.5), so this story syncs only the SHAs that actually moved — it does **not** silently mask the restore↔save version-skew (carved to the follow-up, see Out of Scope).
- [ ] The synthetic parser-contract fixture (a hand-built step string, not read from any workflow) is **left untouched** — its embedded SHA is a don't-care value, so changing it would be meaningless churn.
- [ ] Stale test-**name** strings that read `actions/cache@v5.0.5` are corrected to `v6.1.0` so the names don't lie, even though a name string is not itself an assertion.

### Performance
- N/A — pure test-constant edits; no runtime code, no new I/O; suite execution time is unchanged (sub-second).

### Security
- [ ] The supply-chain guarantee is preserved: every third-party action stays pinned to a full 40-char commit SHA (never a mutable tag). This story updates the *expected* SHA to the vetted new release; it does not relax pinning or accept a tag form.

### UX
- N/A — no user surface. Developer-facing: the guard's CI failure message is already a clear expected/received SHA diff; unchanged.

### i18n
- N/A — engineering CI/test tooling; no translated surface.

### Observability
- [ ] On drift, Jest output names the exact suite, the workflow-derived received SHA, and the expected SHA — enough to identify and fix the next drift with no added logging.

## BDD Scenarios

**Scenario: the version guards agree with the updated pipeline**
- **Given** our automated build pipeline has been updated to newer pinned versions of its build-cache and Java-setup tools
- **When** the checks that verify those pinned versions run
- **Then** they confirm the pipeline is using exactly the expected versions and report success

**Scenario: a stale guard refuses to pass until it is brought up to date**
- **Given** a check still expects an older pinned version than the pipeline actually uses
- **When** that check runs
- **Then** it fails and reports the exact mismatch, so nobody merges believing the versions agree

**Scenario: a future unexpected version change is still caught**
- **Given** the pinned version of a build tool is later changed without the matching guard update
- **When** the checks run on the next change to backend code
- **Then** they fail and surface the new mismatch, keeping unreviewed version changes from slipping in

## Test Plan

Touches only `express-api/tests/scripts/*.test.js` (4 files) ⇒ `backend_changed` ⇒ the FULL Pre-Merge gauntlet is forced (Gate-4). But this is a **test-only** change with zero app/web/backend RUNTIME code, so the device/browser legs are the **no-corruption proof** (batched to the operator-gated window per the SHY-0108/SHY-0127 precedent), not a behavioural re-test.

**Red → Green (reproduce-first):**
- **RED (done):** `cd express-api && npx jest tests/scripts/emulator-in-ci-pin.test.js tests/scripts/sonarcloud-engine-cache.test.js tests/scripts/deploy-dev-ios-cache-share.test.js tests/scripts/ios-tests-build-cache.test.js` → 11 failed / 87 passed, each an old-SHA `toContain` mismatch.
- **Apply** the SHA syncs (constants + literal assertions) exactly as the live workflows now read.
- **GREEN:** re-run those 4 suites → 0 failures; then run the whole `*-pin.test.js` corpus + full express `npm test` → no other drift.
- **Lint:** eslint + prettier clean on the 4 files.
- No new test files — the existing assertions **are** the guard; this feeds them the correct expected value.

## Out of Scope
- **Re-pinning `actions/cache/restore`** (still `27d5ce7…`/v5.0.5 while `cache` + `cache/save` are v6.1.0 in the same files) and **correcting the 4 mislabeled `# v5` comments** on the v6.1.0 cache SHA (in `qa-runner-driver-checks`, `manual-qa-matrix`, `playwright-tests`, `sonarcloud`). These are **workflow** edits with a safety dimension (the deliberate split restore/save anti-hang design documented in the workflows) and require updating two flexible pin-matcher regexes — tracked as a **separate follow-up story this session**.
- Any dependabot configuration change.
- An auto-fixer/codemod for future drift — the guard detects + refuses; satisfying it stays human/Claude work.

## Dependencies
- The `actions/setup-java` v5.4.0 (`1bcf9fb…`) and `actions/cache` v6.1.0 (`55cc834…`) bumps already merged into the workflow YAML by dependabot (#1522/#1523).
- The Pre-Merge Gate (SHY-0127) — this PR's story must be `In Review` at merge.

## Risks & Mitigations
- **Risk:** a mistyped new SHA leaves CI red. **Mitigation:** every SHA was copied from the live workflow file and independently confirmed via `git ls-remote` tag→SHA resolution; the green suite is the proof, not a claim.
- **Risk:** a test-only sync papers over a real workflow problem. **Mitigation:** the restore↔save version-skew and comment mislabels were **discovered** during this fix and explicitly carved into a tracked follow-up — not swept under the sync.
- **Risk:** proportionate review under-scrutinises the diff. **Mitigation:** the diff is a mechanical SHA/label swap with a value matrix cross-checked against ground truth; a full `code-reviewer` dispatch is disproportionate for an XS test-constant sync (flagged, not silently skipped — SHY-0127 precedent).

## Definition of Done
- [ ] The 4 suites green + full express `npm test` green + eslint/prettier clean.
- [ ] Pre-Merge gauntlet satisfied (test-only ⇒ device leg = no-corruption proof); proportionate self-review documented in Notes.
- [ ] The follow-up story for the workflow restore-skew + label hygiene is filed (fully-refined) this session.
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED + PICKED UP** fully-refined ([[feedback-no-skeleton-stories-fully-refined]]); status In Progress immediately. **Reproduced RED first** (11 failures / 4 suites) rather than trusting the handoff fix-map (which had been inverted once earlier this cohort of work) — reproduction confirmed the workflows already carry the new SHAs (dependabot #1522/#1523) and the **tests** lag. Ground-truth SHAs read from the live workflow YAML and verified with `git ls-remote` (`55cc834…`=actions/cache v6.1.0; `1bcf9fb…`=actions/setup-java v5.4.0). **Discovered two adjacent defects the handoff missed** — (a) `actions/cache/restore` left on v5.0.5 while `cache/save` moved to v6.1.0 (functional version-skew), (b) 4 workflows comment `# v5` on the v6.1.0 cache SHA — both carved to a follow-up story (workflow-touching + regex-matcher updates, out of scope here). **Architect gate skipped** ([[feedback-rate-limit-slowdown-strategies]]: mechanical test-constant sync; spec fully-refined). Branch `fix/SHY-0142-finish-action-sha-upgrades` off `origin/main`.
- 2026-07-01 — **Push blocked by a pre-existing, unrelated SonarCloud gate failure** (main's new-code debt: 2 bugs + 2 `S5693` upload reviews, none in this diff). Fixing that debt became [[SHY-0152]]. The two turned out **circularly dependent** — this pin-fix couldn't push (its tree lacks SHY-0152's reliability fixes → gate red), and SHY-0152's CI would fail on this pin-drift. Resolution: **this commit was cherry-picked onto the SHY-0152 branch** so a single fully-green branch (pin 98/98 + sonar gate OK) unblocks main in one PR ([[feedback-stacked-pr-squash-merge-pattern]]). This story lands via that combined PR; the standalone `fix/SHY-0142` branch is dropped (never pushed → no separate PR). Test-side fix + verification unchanged from above.
