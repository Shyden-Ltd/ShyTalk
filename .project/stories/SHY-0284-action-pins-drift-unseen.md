---
id: SHY-0284
status: Done
owner: claude
created: 2026-08-05
priority: P2
effort: S
type: infra
roadmap_ids: []
public: false
released_in: v0.98.0
---

# SHY-0284: The guard against half-finished action upgrades never runs on the changes that cause them

## User Story

As **the person responsible for what this repository executes in CI**,
I want **the check for half-finished action upgrades to run on every change that could cause one**,
So that **the repository cannot quietly end up running two versions of the same tool**.

## Why

Third-party GitHub Actions are pinned to an exact commit so a compromised release tag cannot change what CI runs. When an upgrade lands, **every** reference to that tool must move together; if some move and others do not, the repository runs two versions of the same tool at once — different behaviour in different jobs, from a change nobody reviewed as a version change.

A guard for exactly this already exists — SHY-0162's *"every action repo pins exactly ONE SHA"*, in `express-api/tests/scripts/ci-action-pin-consistency.test.js`. Its own comments call out composite actions as the blind spot it was written to cover. **It works. It simply never runs when it matters.**

It lives in the Express test suite, and `pr-checks.yml` gates `test-backend` on `backend_changed`. An upgrade to a CI tool touches only workflow files, so `backend_changed` is false, `test-backend` is skipped, and the guard is skipped with it. The check written to catch partial action bumps is skipped on precisely the pull requests that contain partial action bumps. It can only fire by accident — when some unrelated backend edit happens to ride along in the same PR.

That is not theoretical. On 2026-08-05, both of these were live on `main`, and had been since 2026-08-03:

| Tool | Referenced from | Version |
|---|---|---|
| `actions/setup-node` | six workflow files | **7.0.0** |
| | `.github/actions/setup-node/action.yml` | 6.4.0 |
| `actions/setup-java` | `.github/workflows/test-backend.yml` | **5.7.0** |
| | `.github/actions/setup-jdk-gradle/action.yml` | 5.6.0 |

Two tools, each running at two versions, for two days, on the default branch — through green CI both times. The split reached `develop` on 2026-08-05 via the routine main→develop sync (PR #1701) and was found only because that sync was being checked by hand.

There is a second, compounding reason the shared wrappers are always the stale half: Dependabot's `github-actions` entry in `.github/dependabot.yml` is declared with `directory: "/"`, which watches `.github/workflows/` but **not** `.github/actions/`. So the pins inside the repository's own composite actions are never offered an update at all — not for a feature release, and not for a security advisory. Dependabot bumps what it can see; the guard that would have caught the resulting mismatch is skipped; and nothing else looks.

Related but separate: `scripts/check-action-shas.sh` verifies that actions *are* pinned, never that the `# vN` comment beside a pin is true. Dependabot's own bump left all seven `setup-node` references reading `# v6` beside a v7.0.0 commit. That passed CI and reached `develop`; it was corrected by hand in PR #1701. The comment is the only signal a reviewer reads when judging how large an upgrade is, and one naming the wrong major invites waving a major through as a patch.

## Acceptance Criteria

### Happy path

- [ ] A pull request that moves some references of an action but not others fails, whatever else it touches.
- [ ] The check runs on a pull request that changes only workflow files.
- [ ] Every tool in the repository is referenced at exactly one version.

### Error paths

- [ ] A reference pinned to a moving tag rather than an exact commit fails.
- [ ] If the check finds implausibly few references, it reports that it could not scan rather than reporting success.

### Edge cases

- [ ] A mismatch inside one of the repository's own shared wrappers is caught, not only mismatches between workflow files.
- [ ] Tools referenced from sub-paths of the same repository are treated as one tool and must share a version.
- [ ] References to the repository's own local actions are not treated as third-party.

### Performance

- [ ] The check adds no dependency install to the workflow-only path, which is deliberately a few seconds of cheap scripts.

### Security

- [ ] The existing "must be pinned to an exact commit" rule is never relaxed, only added to.
- [ ] A shared wrapper left behind on an old version can no longer reach the default branch unnoticed.

### UX

- [ ] A failure names the tool, every version in play, and the file each came from.

### i18n

- N/A — CI tooling output, developer-facing; `scripts/` is English-only by convention.

### Observability

- [ ] A passing run states how many references it checked, so a run that checked nothing is distinguishable from a clean one.

## BDD Scenarios

**Scenario: A half-finished upgrade is caught**
- **Given** one reference to a tool has been upgraded and another has not
- **When** the checks run
- **Then** the build fails, naming the tool and both versions

**Scenario: The check runs on a workflow-only change**
- **Given** a pull request that changes only workflow files
- **When** the checks run
- **Then** the half-finished-upgrade check is among those that ran

**Scenario: A mismatch in a shared wrapper is caught**
- **Given** a shared wrapper references an older version than the workflows do
- **When** the checks run
- **Then** the build fails and names the wrapper

**Scenario: A check that scanned nothing does not pass**
- **Given** the scan finds implausibly few references
- **When** the checks run
- **Then** the result says it could not scan, rather than reporting success

**Scenario: A stale shared wrapper cannot reach the default branch**
- **Given** an upgrade that moves the workflow references but not the shared wrapper
- **When** the checks run on that change
- **Then** the build fails before it can be merged

## Test Plan

**Red (written first, must fail against today's code):**

- `express-api/tests/scripts/check-action-pin-consistency.test.js` (new) — drives the real script as a real process against real scratch directories via `ACTION_PINS_ROOT`; no injected reader or stream, since `tests/scripts/` is not a unit-test location.
  - `a partial bump fails and names the action repo and BOTH SHAs` — **fails today**: no script exists.
  - `drift inside a composite action is caught, not just drift between workflows`.
  - `a floating tag fails even when every repo is internally consistent`.
  - `a tree with too few references refuses instead of reporting success` — exit 2, and no success marker on stdout.
  - `a clean run reports how many references it verified` — count must exceed 20.
  - `a consistent scratch tree passes, so the failures above are about drift` — negative control.
  - `lint.yml runs this guard unconditionally` — **the defect itself was an invariant in a job that did not run**, so deleting the step or gating it behind an `if:` must redden.
  - `the live repository passes` — fails against the tree as found on 2026-08-05 (setup-node and setup-java both split).

**Green:** the five existing suites that pin `lint.yml`'s structure (`pr-checks-app-changed-split`, `actionlint-shellcheck-invocation`, `large-file-guard-pin`, `reusable-workflow-concurrency`, `ci-action-pin-consistency` — 78 tests), since this adds a step to that workflow; plus `actionlint` and `scripts/check-action-shas.sh`.

**Real services only:** the guard is exercised as a real child process against real files on disk, and the SHAs in the fixtures are real 40-hex shapes. Where a real published version must be resolved, the real tags API answers.

## Out of Scope

- Making Dependabot watch the shared wrappers. GitHub's own reference states that for `github-actions` the directory value is `/`, and that it searches `.github/workflows` plus a ROOT-level `action.yml` — it documents no way to cover `.github/actions/**`. So the wrappers cannot currently be watched by configuration, and shipping a config change whose syntax cannot be verified would be worse than shipping none. The consequence is explicit and accepted: every future action upgrade will now RED this check until the wrapper is moved in the same pull request. That is the point — the alternative was the split reaching the default branch silently, which is what happened twice. Eliminating the split properly (inline the wrappers so Dependabot sees every pin, or route every workflow through the wrapper so only one pin exists) is a design choice with real trade-offs and belongs in its own story.
- Checking that a pin's `# vN` comment matches the commit it names. Real, and it let the mislabelled `setup-node` pins through, but it is a different check with a different failure mode (needs network resolution); filed separately.
- `sync-roadmap-data.yml` pinning Node 20 while everything else pins 24.
- The two pre-existing `actionlint` findings in `reap-stuck-runs.yml` and `sonarcloud.yml`.

## Dependencies

- None. `scripts/check-action-shas.sh`, `lint.yml` and the SHY-0162 suite all already exist.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Moving the scan out of the test file breaks the 15 existing SHY-0162 tests | The logic moved verbatim into `scripts/lib/action-pins.js` and the suite now imports it; all 15 still pass, plus the other four `lint.yml`-pinning suites (78 total) |
| The new step slows the cheap workflow-only lint path | Node builtins only, no dependency install; it reads the same files `check-action-shas.sh` already reads |
| The guard is silently removed later | An explicit test asserts `lint.yml` invokes it and that the step carries no `if:` |
| Watching `.github/actions/` floods the update queue | Only two pins are currently unwatched, and the ecosystem's existing grouping applies |
| The guard passes because it scanned nothing | A minimum-reference floor exits non-zero with an explicit refusal, covered by its own test |

## Definition of Done

- [x] Red tests observed failing against unmodified code.
- [x] Both split tools restored to one version each, proven by the guard going green.
- [x] The guard runs on a workflow-only pull request — proven by this PR, which is workflow-and-scripts only.
- [x] `code-reviewer` 100% clean; CI green by name; `Reviewed-up-to:` recorded.
- [x] CI-config-only (no app, backend, or website runtime surface) — device/browser gauntlet not applicable per the SHY-0163 exemption.

## Notes (running log)

- **2026-08-05 13:10 WIB** — Found while merging main into develop (PR #1701). First framing of this story was wrong and is corrected above: I initially wrote that no consistency guard existed. One does — SHY-0162's, and a good one. The defect is not a missing check but a **check that cannot run on the changes it targets**, which is worse, because the repository looked protected.
- **2026-08-05 13:10 WIB** — Sequence that produced the split: #1683 and #1685 (Dependabot, workflow-only) merged to main on 2026-08-03 → `backend_changed` false → `test-backend` skipped → SHY-0162 guard skipped → two tools left at two versions each on the default branch → carried to develop by PR #1701 on 2026-08-05.
- **2026-08-05 13:10 WIB** — Both splits were restored forward, not backward: the shared wrappers were moved up to the versions the workflows already use (`setup-node` → v7.0.0, `setup-java` → v5.7.0). Rolling the workflows back would have reverted a Dependabot upgrade.
- **2026-08-05 13:20 WIB** — Checked GitHub's Dependabot options reference before assuming the watch-gap was configurable: for `github-actions` the documented directory value is `/`, covering `.github/workflows` and a root-level `action.yml` only. No documented syntax reaches `.github/actions/**`. So this story does NOT widen the config; it makes the resulting drift impossible to miss instead. Follow-up story owed for removing the split at the source.
- **2026-08-05 13:10 WIB** — Precedent that this recurs and has been absorbed by hand before: `279e5313c08` ("Merge main into develop + resolve setup-java pin drift") fixed the same class of drift in an earlier sync, for the same tool.
- **2026-08-05 13:30 WIB — review provenance (honest record).** Status is In Review because the PR is open and awaiting review, NOT because an agent review has happened. `code-reviewer` was NOT dispatched: this session may only call the Agent tool when the operator asks, and the one dispatch they authorised was scoped to PR #1697. `Reviewed-up-to:` is deliberately NOT claimed, so `scripts/pre-merge-check.sh` will refuse this PR until it is — which is the correct behaviour. Same handling SHY-0243 used for the same constraint. What HAS run: every applicable guard (`check-action-shas.sh`, the new `check-action-pin-consistency.js`, `check-no-new-stubs.js`, `actionlint` on the changed workflow) and 86 tests across the six suites that pin `lint.yml`'s structure, all green; both new guards mutation-verified by reintroducing the real drift and confirming exit 1.

- **2026-08-06 01:35 WIB — `code-reviewer` cycle 1.** TWO Critical findings, both verified against the workflow before being accepted. (1) `scripts/*) BACKEND=true` got the fifteen root-script suites running by claiming the shared backend had changed; the SHY-0127 block reads BACKEND as "retest every client" and forces APP/ANDROID_APP/IOS_APP/WEB/INTEGRATION on while clearing both E2E skip markers, so editing `scripts/backup-r2.sh` would have triggered a Gradle build, the full browser matrix and device E2E. This PR's own diff would have tripped its own rule. (2) Pre-existing and more serious: nothing pinned that the `lint` JOB in pr-checks.yml is ungated. The 16 tests all read lint.yml and check the STEP; an `if:` on the job would have left every one of them green while skipping the guard on exactly the workflow-only PRs it exists for. There is a comment on that job saying it must stay unconditional — a comment is not a test.
- **2026-08-06 01:35 WIB — response.** Root scripts carry their own `scripts_changed` flag; `test-backend` runs on either it or `backend_changed`; the cascade is untouched and pinned so the fix cannot over-correct. The lint job's ungated-ness is now a test. 11 new tests driving the REAL case statement through real bash, 7 RED first; four mutants, four kills.
- **2026-08-06 01:40 WIB — `code-reviewer` cycle 2.** Confirmed both cycle-1 findings resolved end to end, and found a regression the FIX had introduced: `WORKFLOW_ONLY` is computed from APP/BACKEND/WEB/INTEGRATION/OTHER, and moving root scripts out of `OTHER` meant a scripts-only PR now declared itself workflow-only and skipped every job gated on that, sonarcloud included. Fixing one silent skip had created another. Reproduced from the source, fixed by adding SCRIPTS to the condition, pinned by three more tests (scripts-only is NOT workflow-only; a real workflow-only change still is; docs-only still is) and a fifth killed mutant. 144 suites / 7,444 tests green; actionlint clean.

- **2026-08-06 07:20 WIB — `code-reviewer` cycle 3: 100% CLEAN, zero findings.** Reviewed `2b35f58345f`, the answer to cycle 2. Confirmed the WORKFLOW_ONLY fix is complete rather than partial (sonarcloud is the ONLY consumer of that output, grepped repo-wide), that the case-arm ordering has no overlap with `express-api/scripts/drivers/*`, that the pre-existing `pr-checks-backend-forces-full.test.js` pin is untouched and still correct, and that the line-scanning `workflowOnlyCondition()` helper stops at the RIGHT `fi` — `WORKFLOW_ONLY=false` occurs exactly once, and only comments sit between it and its closing `fi`, so the three new tests assert the complete condition and not a truncated one. `1a9935d052d` is story-`.md`-only and review-neutral.
- **2026-08-06 07:20 WIB — DoD verified item by item before ticking.** Red-first: 7 of the 11 cycle-1 tests and all 3 cycle-2 tests were observed failing first. Both split tools restored, proven by the live-repository case passing. The guard ran on THIS pull request — `lint / Lint: completed/success` on run 31035710175, which is the whole point of the story. CI green BY NAME: Detect Changes, Analyze JavaScript, PR Gate, plus Build & Test, Pre-Merge Gate, SonarCloud, Unit Tests, CodeQL. CI-config-only confirmed mechanically, not asserted: the ten changed files are `.github/actions/**`, `.github/workflows/**`, this story, three `express-api/tests/scripts/**` meta-tests and two root `scripts/**` CI helpers — a grep for every product-runtime path named in CLAUDE.md's boundary (`shared/`, `app/`, `iosApp/`, `express-api/src/`, `public/`, the three rules files) returns nothing. So the device/browser gauntlet is N/A by the SHY-0163 exemption, and there is no backend runtime change to trigger the SHY-0127 full-gauntlet rule.
- **2026-08-06 07:20 WIB — `BASE_REF=origin/develop bash scripts/pre-merge-check.sh 1702` → `PRE-MERGE-CHECK: OK`.** Merging with zero doubt.

Reviewed-up-to: 2b35f58345fe7e7fec2d75b822ca042a9947d453
