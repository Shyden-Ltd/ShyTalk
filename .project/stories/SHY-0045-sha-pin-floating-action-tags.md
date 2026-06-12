---
id: SHY-0045
status: Draft
owner: claude
created: 2026-06-08
priority: P1
effort: XS
type: infra
roadmap_ids: [G011]
pr:
mvp: true
---

# SHY-0045: SHA-pin floating Action tags in manual-qa-matrix.yml + qa-runner-driver-checks.yml

## User Story

As a security-conscious ShyTalk operator, I want **every `uses:` reference in `.github/workflows/manual-qa-matrix.yml` and `.github/workflows/qa-runner-driver-checks.yml` SHA-pinned to a 40-hex commit SHA** (matching the rest of the repo's supply-chain hardening per `scripts/check-action-shas.sh`), so that a compromised tag on any of the third-party Actions cannot inject malicious code into our CI pipeline.

## Why

Roadmap row (line 79, 2026-06-05): `G011 | 🟠 Important | CI — floating Action tags | .github/workflows/manual-qa-matrix.yml:71-80, qa-runner-driver-checks.yml:53-63 | @v6/@v7 floating tags vs rest of repo's SHA pins; supply-chain risk | SHA-pin all 4 Actions; update manual-qa-matrix-workflow-pin.test.js to assert SHA format | XS`.

The repo-wide SHA-pin policy is enforced by `scripts/check-action-shas.sh` (post-PR #1016) which runs in `lint.yml`. This check would normally fail for these floating tags, but the two YAML files were either added/edited before the policy landed or the check has an exemption for them. Whatever the reason, the gap exists.

Supply-chain hardening (see [[feedback-update-sweep-comprehensive]]): every `uses: foo/bar@vN` should become `uses: foo/bar@<40-hex-sha> # vN`.

## Acceptance Criteria

### Happy path

- [ ] `.github/workflows/manual-qa-matrix.yml` lines 71-80: every `uses:` line uses a 40-hex SHA + an inline `# vN` comment for human readability.
- [ ] `.github/workflows/qa-runner-driver-checks.yml` lines 53-63: same treatment.
- [ ] `bash scripts/check-action-shas.sh` exits 0 against both files.
- [ ] `express-api/tests/scripts/manual-qa-matrix-workflow-pin.test.js` updated to assert the SHA format (40-hex regex) instead of (or in addition to) tag format.
- [ ] If a `qa-runner-driver-checks-workflow-pin.test.js` doesn't exist, file a one-line follow-up SHY (do NOT create as part of this PR — out of scope here, separate work).
- [ ] `actionlint` clean on both files post-edit.

### Error paths

- [ ] **SHA lookup fails** (network blip): `gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '.object.sha'` may fail. Retry once; if still failing, defer and add Notes entry.
- [ ] **An Action has been retagged since the last release** (e.g. `v6` now points to a different SHA than before): use the SHA the action's CURRENT tag points to; record both old + new SHA in PR description for diff clarity.
- [ ] **Test file's assertion was the old tag-format check**: must be updated atomically — leaving the old assertion + adding a new one would fail because the actual workflow now has SHA, not tag.
- [ ] **A floating tag references a private Action** (we don't own + can't pin): NO known cases in this repo, but flag to operator if discovered.

### Edge cases

- [ ] **The 4 Action references aren't all third-party** — some may be local (`./...`) refs which are exempt from the policy. Cross-check via `check-action-shas.sh`'s output (it allowlists local refs).
- [ ] **One Action's tag points to a SHA on a fork**, not the upstream repo: use the upstream SHA from the canonical repo.
- [ ] **Action releases a new major between SHA lookup + PR merge**: this PR pins the SHA at-time-of-PR. Dependabot will handle future bumps once both files are tracked.
- [ ] **Comment formatting variance** — `# v6` vs `# v6.1.0` — be consistent with existing repo style (check 3 other workflow files for precedent).

### Performance

- [ ] No CI runtime change — SHA vs tag resolves identically server-side.

### Security

- [ ] **THIS IS THE PRIMARY SECURITY DELIVERABLE** — closes the floating-tag attack vector for these two workflows.
- [ ] After the PR merges, the `check-action-shas.sh` lint gate covers these files going forward.
- [ ] No new permissions or secrets added.

### UX

- [ ] N/A — CI-only change.

### i18n

- [ ] N/A — no strings.

### Observability

- [ ] PR description lists each of the 4 (or more) Action refs with `<owner>/<repo>@<sha> # <previous-tag>` mapping for diff transparency.
- [ ] Commit message: `[SHY-0045] SHA-pin floating Action tags in manual-qa-matrix + qa-runner-driver-checks workflows (G011)`.

## BDD Scenarios

**Scenario: SHA-pin gate accepts the edited workflows**

- **Given** the two workflow files have been edited per the AC
- **When** `bash scripts/check-action-shas.sh` runs against the repo
- **Then** the script exits 0
- **And** stderr does NOT contain `::error::`

**Scenario: Pin test enforces SHA format**

- **Given** the updated `manual-qa-matrix-workflow-pin.test.js`
- **When** `npx jest express-api/tests/scripts/manual-qa-matrix-workflow-pin.test.js` runs
- **Then** all assertions pass
- **And** at least one assertion checks for a 40-hex SHA pattern (e.g. `/[a-f0-9]{40}/`)

**Scenario: Regression — a future floating-tag edit is blocked**

- **Given** the SHA-pin gate is in `lint.yml`
- **When** a future PR replaces a 40-hex SHA with `@v7` in either file
- **Then** the lint step exits non-zero with `::error::` naming the offending line

## Test Plan

**Red:**
- `bash scripts/check-action-shas.sh` — currently passes IF the script has exemptions for these files; OR fails listing the floating tags. Verify current behaviour first.
- `npx jest express-api/tests/scripts/manual-qa-matrix-workflow-pin.test.js` — currently passes against tag-format assertion; needs to fail against SHA assertion until the workflow is updated.

**Green:**
- For each `uses:` line in the two files, run `gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '.object.sha'` to get the SHA.
- Edit both YAML files: replace `@vN` with `@<sha> # vN`.
- Update `manual-qa-matrix-workflow-pin.test.js` assertion regex to `/[a-f0-9]{40}/` (or stronger: `/^[a-f0-9]{40}$/` per-line capture).
- Re-run `check-action-shas.sh` + pin tests + actionlint.

**Coverage gate:** lint script + pin test + actionlint all pass.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (edits two workflow YAMLs + a Jest pin-test) → the FULL gauntlet applies even though this is a CI-only supply-chain change. The honest connection to the device/browser gauntlet: one of the edited files IS `manual-qa-matrix.yml` — the workflow that orchestrates the device×browser matrix — so a successful dev matrix run *is* the proof the SHA-pin didn't break CI orchestration.

**Frameworks exercised (RED→GREEN):**
- ✅ **Express Jest** — `manual-qa-matrix-workflow-pin.test.js` flipped to assert the 40-hex SHA format (RED against the new assertion until the YAML is pinned).
- ✅ **eslint** (`--max-warnings=0`) — the edited pin-test.
- ✅ **actionlint** + **`scripts/check-action-shas.sh`** — both YAML files clean + exit 0.
- ✅ **SonarCloud** — quality gate.
- ⬜ **Kotlin / detekt / ktlint / iOS compile / Web Playwright** — N/A (no app/web/Kotlin source change); the apps + all-browser journeys run only as the REGRESSION net.

**LOCAL gauntlet:** pin-test + eslint + actionlint + `check-action-shas.sh` green; full journey corpus on real Android + real iPhone + all browsers as the regression net (proving no behavioural change). Any failure → fix TDD → restart.
**DEV gauntlet:** dispatch the SHA-pinned `manual-qa-matrix.yml` on the unmerged branch via Deploy-To-Dev `ref` → confirm it still fans out the device×browser matrix correctly; apps regression on real devices, web on Chrome. Restart from LOCAL on failure. **Judgment-merge** only when production-ready with zero doubt.

## Out of Scope

- Creating a NEW pin test for `qa-runner-driver-checks.yml` if one doesn't exist (follow-up SHY).
- Pinning Actions in other workflow files — handled by the existing repo-wide policy via `check-action-shas.sh`.
- Pinning Actions used by Dependabot configuration itself — separate scope.
- Refactoring to use composite actions to reduce duplication of refs.

## Dependencies

- `scripts/check-action-shas.sh` (delivered by PR #1016 / earlier supply-chain work).
- `express-api/tests/scripts/manual-qa-matrix-workflow-pin.test.js` (must exist; verify via `git ls-files`).
- `gh` CLI with `repo:read` scope for SHA lookup.
- Internet access for SHA lookup (CI runner OR local dev with auth).

## Risks & Mitigations

- **Risk: SHA lookup hits a transient 5xx.** Mitigation: retry once; otherwise defer.
- **Risk: An Action's tag has been moved since policy was created.** Mitigation: record old + new SHA in PR description; reviewer can spot if a deliberate move.
- **Risk: Updating the pin test's regex breaks ITS pin test (test-of-test).** Mitigation: there's no test-of-test; this is one-level deep.
- **Risk: Dependabot has been silently failing on these floating tags.** Mitigation: post-merge, check Dependabot's alert log — file follow-up if any pending updates.

## Definition of Done

- [ ] Both YAML files edited with SHA pins + inline tag comments.
- [ ] `check-action-shas.sh` exits 0.
- [ ] Pin test updated + passes.
- [ ] `actionlint` clean.
- [ ] PR body includes the Action-ref mapping table.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): Jest pin-test + eslint + actionlint + `check-action-shas.sh` green locally; full journey regression net green on real Android + real iPhone + all browsers → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green (SHA-pinned `manual-qa-matrix.yml` re-confirmed to orchestrate the matrix; Chrome web) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:05 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 79 (G011). Reserved ID SHY-0045.
- 2026-06-13 ~00:05 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): CI/workflow change (SHA-pin + Jest pin-test) → NOT `*.md`-only → full protocol applies; headline frameworks = Express Jest pin-test + eslint + actionlint + `check-action-shas.sh`, with the apps/all-browser journeys as the regression net (the SHA-pinned `manual-qa-matrix.yml` is itself the matrix orchestrator, so the dev matrix run doubles as proof the pin didn't break CI). DoD gains the protocol-satisfied + judgment-merge bullets. Pickup-fitness: AC already current (G011 supply-chain policy + `#1016` live); no stale cross-refs found.
