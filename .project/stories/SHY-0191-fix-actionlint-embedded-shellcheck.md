---
id: SHY-0191
status: In Progress
owner: claude
created: 2026-07-15
priority: P2
effort: S
type: bug
roadmap_ids: []
pr:
mvp: false
---

# SHY-0191: Resurrect actionlint's embedded shellcheck (the `-shellcheck='-e SC2086'` flag silently disabled it) + clear the hidden findings

## User Story
As the maintainer of ShyTalk's CI, I want the actionlint lint gate to actually run its embedded shellcheck (in CI and in the pre-push hook), so that shell bugs in workflow `run:` blocks are caught before they ship instead of silently passing a gate that checks nothing.

## Why
Found during SHY-0128 pickup (2026-07-15): `lint.yml` and `.husky/pre-push` both invoke `actionlint -shellcheck='-e SC2086'`, believing the flag "passes shellcheck flags into embedded shellcheck" (the comment says exactly that). It does not — actionlint's `-shellcheck` flag takes **the command name or file path of the shellcheck executable**; given `'-e SC2086'`, actionlint looks for an executable literally named `-e SC2086`, finds nothing, and **silently disables shellcheck integration** (exit 0, no warning — verified live against actionlint 1.7.12 `--help` and by A/B probe). The gate has been shellcheck-blind since the flag was introduced. The documented way to pass flags is the `SHELLCHECK_OPTS` environment variable. Running REAL embedded shellcheck (0.11.0) repo-wide surfaces 9 hidden findings: 2 are the intentionally-excluded SC2086 (stay excluded via `SHELLCHECK_OPTS`), the rest are real and must be fixed — never suppressed ([[feedback-never-suppress-fix-or-upgrade]]). Fix count landed at **8**: SC2001 ×2 (`allure-report.yml` merge-props — the second was MASKED behind the first, shellcheck reports one instance per script at a time), SC2188 (merge-props lone redirect), SC2012 (prune `ls`→NUL-safe `find`), SC2129 ×3 (allure summary + both `branch-discipline-check.yml` step-summary branches), SC2034 (`dependabot-auto-merge.yml` unused `DEP_TYPE` — deleted; the two USED metadata outputs also moved to an `env:` block as injection hygiene). Additionally the repo's ONE pre-existing `# shellcheck disable=SC2016` (`sync-stories-to-issues.yml` sidecar jq) is REMOVED honestly: the jq program moved into a quoted heredoc bound to `"$JQ_PROG"` — byte-identical program text, nothing left for SC2016 to flag, zero-suppression restored repo-wide.

## Acceptance Criteria

### Happy path
- [ ] `lint.yml` and `.husky/pre-push` invoke actionlint as `SHELLCHECK_OPTS='-e SC2086' actionlint` (env-based flag passing); the broken `-shellcheck='-e …'` form is gone from both.
- [ ] `SHELLCHECK_OPTS='-e SC2086' actionlint` exits 0 repo-wide with shellcheck ACTIVE (proven by the A/B evidence in Notes: the same command exits 1 on the pre-fix tree — 7 findings surfaced, an 8th unmasked mid-fix).
- [ ] All 8 real findings fixed in place AND the one pre-existing `# shellcheck disable` (SC2016) removed via restructure — zero suppression comments remain anywhere in workflows or the hook.

### Error paths
- [ ] A future shell bug of the classes shellcheck catches (e.g. an unquoted glob, a lone redirection) now FAILS `lint.yml`'s actionlint step and blocks the pre-push hook — the gate bites again (behavioral evidence: the pre-fix repo state itself fails the fixed invocation).
- [ ] The comment above each invocation states the flag semantics (executable name, not flags) so the broken form is not reintroduced by "cleanup".

### Edge cases
- [ ] The SC2086 exclusion (intentional: GH-managed unquoted paths) is preserved via `SHELLCHECK_OPTS` — the two SC2086-info sites stay legal, everything else applies normally.
- [ ] `.husky/pre-push` still skips actionlint gracefully when the binary is absent (`command -v actionlint` guard unchanged).
- [ ] The fixed prune/merge-props/summary steps keep byte-identical OBSERVABLE behavior (same files written, same summary rendered, same prune retention) — style-level rewrites only.

### Performance
- [ ] N/A beyond the status quo — `SHELLCHECK_OPTS` adds no work; shellcheck now actually running restores the intended (already-budgeted) lint cost.

### Security
- [ ] The dead-gate fix itself is the security win (workflow shell injection lint was OFF). Bonus hardening while touching `dependabot-auto-merge.yml`: the two used `steps.metadata.outputs.*` interpolations move from inline `${{ }}` in `run:` to an `env:` block (injection-hygiene convention), and the unused `DEP_TYPE` interpolation is deleted outright.
- [ ] No new secrets, tokens, or permissions.

### UX
- [ ] N/A — CI/tooling only; developer-facing lint messages improve (real findings instead of silence).

### i18n
- [ ] N/A — CI infrastructure.

### Observability
- [ ] The lint.yml step name/comment says shellcheck is active via `SHELLCHECK_OPTS`, so a green run documents what it checked; findings surface as normal actionlint annotations.

## BDD Scenarios

**Scenario: The gate actually runs shellcheck again**
- **Given** a workflow `run:` block containing a shellcheck-detectable bug
- **When** CI's lint job (or the pre-push hook) runs actionlint
- **Then** the run FAILS with the shellcheck finding named
- **And** the same command on the fixed repo exits 0

**Scenario: The intended SC2086 exclusion survives**
- **Given** a `run:` block with an intentionally-unquoted GH-managed path (SC2086-info site)
- **When** the fixed invocation runs
- **Then** no SC2086 finding is reported while all other rules apply

**Scenario: No suppression sneaks in**
- **Given** the 8 real findings + the one legacy suppression
- **When** they are fixed
- **Then** no `# shellcheck disable` comment and no new `SHELLCHECK_OPTS` exclusion exists anywhere in the diff

## Test Plan
**Classification: CI-config-only (SHY-0163 exemption)** — `.github/workflows/**`, `.husky/pre-push`, and a CI meta-test; no app/backend/website runtime surface; device/browser gauntlet N/A.

- **Red:** `express-api/tests/scripts/actionlint-shellcheck-invocation.test.js` (NEW) — pins BOTH invocation sites (`lint.yml` actionlint step + `.husky/pre-push`): must contain `SHELLCHECK_OPTS='-e SC2086' actionlint`, must NOT match `-shellcheck=` anywhere (line-anchored to the live invocation, comments legal), and sweeps the repo's workflows + hook for `shellcheck disable` (none allowed). Watched RED against the current broken form.
- **Green:** the two invocation fixes + the 8 finding fixes + the SC2016 suppression restructure; pin test GREEN.
- **Execution proof of the risky rewrites:** `express-api/tests/scripts/allure-report-merge-props.test.js` (NEW, 5 tests, REAL-only — real bash + real fixture trees, zero doubles) executes the rewritten merge-props block: dot-joined suite ids (incl. 3-segment path killing a global→first-only replace mutant), leading-whitespace strip, blank-line skip, `=`-in-value preservation, stale-output truncation, sorted determinism.
- **Behavioral (real command, not simulated):** `SHELLCHECK_OPTS='-e SC2086' actionlint` run locally — exits 1 BEFORE the workflow fixes (7 findings visible; an 8th SC2001 unmasked after the first was fixed — the resurrection proof, captured in Notes), exits 0 AFTER. Bare `actionlint` (no exclusion) additionally confirms only the 2 intended SC2086-info sites remain.
- Frameworks: express Jest (canonical `npm test`; full suite with the CI harness — emulators `demo-shytalk` + Docker MinIO 9002 + Mailpit 8025), actionlint+shellcheck (the live command IS the subject), eslint `--max-warnings=0`, prettier, story validator, `code-reviewer` 100% clean. Existing pins guarding the touched workflows re-run (`reusable-workflow-concurrency`, `large-file-guard-pin`, `pr-checks-app-changed-split`, the SHY-0128 cap pins + execution tests for `allure-report.yml`).

## Out of Scope
- Deleting the dead archive/prune/trend steps in `allure-report.yml` (separate cleanup SHY from SHY-0128's findings) — here they only get style-level shellcheck fixes in place.
- Any new shellcheck exclusions or suppressions.
- The 54MB `room_background.gif` and other unrelated pickup findings.

## Dependencies
- actionlint 1.7.7 (CI-pinned download) / 1.7.12 (local brew) — `-shellcheck` flag semantics identical (executable name).
- shellcheck present on CI runners (preinstalled on ubuntu-latest) and locally (0.11.0).
- SHY-0128's merged pins on `allure-report.yml` (this story edits three of its `run:` blocks — those pins must stay green).

## Risks & Mitigations
- **Risk:** a style rewrite changes step behavior (merge-props/prune/summary). **Mitigation:** pure-bash equivalents chosen for byte-identical output; the SHY-0128 execution-harness precedent test for metadata stays green; reviewer verifies each rewrite.
- **Risk:** resurrected shellcheck flags future contributions aggressively. **Mitigation:** that is the point — the gate was always meant to do this; SC2086 stays excluded by design.
- **Risk:** `head -n -N` GNU-ism in the prune rewrite breaks on macOS. **Mitigation:** the step only executes on ubuntu-latest runners (GNU coreutils); local actionlint only LINTS it.

## Definition of Done
- [ ] Pin test green; behavioral A/B evidence in Notes; all 7 findings fixed with zero suppression; full express suite green; actionlint/eslint/prettier/validator clean.
- [ ] `code-reviewer` 100% clean before push; PR → develop; merged via `pre-merge-check.sh` (`BASE_REF=origin/develop`, `--skip-ci-check`, line-leading `Reviewed-up-to:`).
- [ ] `released_in: vX.Y.Z` on the next release cut.

## Notes (running log)
- 2026-07-15 — **FILED + picked up** (follow-up duty from SHY-0128 pickup, [[feedback-fix-pre-existing-and-new-same]]). Evidence at discovery: `actionlint --help` — "`-shellcheck string`: Command name or file path of 'shellcheck' external command. If empty, shellcheck integration will be disabled"; A/B probe — `actionlint -shellcheck='-e SC2086' .github/workflows/allure-report.yml` exits 0 while bare `actionlint` on the same file reports 4 shellcheck findings; repo-wide bare run: 9 findings (7 real + 2 intended SC2086). The comment in `lint.yml` ("passes shellcheck flags into embedded shellcheck") documents the wrong mental model — flag takes an executable, not flags.
