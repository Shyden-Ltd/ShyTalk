---
id: SHY-0195
status: In Review
owner: claude
created: 2026-07-16
priority: P1
effort: S
type: infra
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1614
---

# SHY-0195: Fix the Deploy-To-Dev pipeline — iOS archive destination, persona-seed secret name, setup-java SHA drift

## User Story

- **As the** ShyTalk operator
- **I want** every Deploy-To-Dev run to distribute the iOS build to TestFlight and refresh the dev test personas again (and the same latent iOS failure fixed in the prod workflow before it ever fires)
- **So that** dev deploys are whole — testers get iOS builds, journey runs get fresh personas, and the pipeline is green instead of chronically half-red

## Why

Three verified pipeline defects, diagnosed 2026-07-16 from run 29456042020 (and history):

1. **iOS TestFlight archive dead since 2026-07-11** (runs 29152433000, 29456042020): `xcodebuild … -sdk iphoneos … archive` with NO `-destination` → `xcodebuild: error: Found no destinations for the scheme 'iosApp' and action archive.` (exit 70). The macOS runner image changed `20260630.0202.1 → 20260630.0213.1` between the last pass (07-07) and first failure (07-11) with an identical invocation — destination inference from `-sdk` alone stopped resolving; the destination list in the error is EMPTY. The canonical fix is the explicit `-destination 'generic/platform=iOS'` (correct on every Xcode). **`deploy-prod.yml:563` has the same latent bug** — it must not wait to fail at the next prod deploy.
2. **Persona seeding dead since 2026-07-01** (every run): `seed-dev-personas.yml` declares required secret `PERSONAS_PASSWORD_DEV`, but the SHY-0136 consolidation (week of 06-29) made `DEV_QA_PERSONAS_PASSWORD` canonical and the old repo secret no longer exists → `secrets: inherit` cannot satisfy it → the job fails at call time ("Secret PERSONAS_PASSWORD_DEV is required, but not provided"). `FIREBASE_SERVICE_ACCOUNT_DEV` (the other required secret) verified present.
3. **setup-java SHA drift** (arrived with the 07-16 main→develop sync): dependabot bumped `actions/setup-java` to `0f481fcb…` (v5.5.0) in `test-backend.yml` but not in the composite action `.github/actions/setup-jdk-gradle/action.yml` (still `1bcf9fb1…` / v5.4.0) → the SHY-0162 one-SHA-repo-wide invariant test (`ci-action-pin-consistency.test.js`) is RED on develop right now (13,495/13,496).

## Acceptance Criteria

### Happy path

- [ ] `deploy-dev.yml`'s archive step carries `-destination 'generic/platform=iOS'`; a dispatched Deploy-To-Dev run's "Distribute iOS to TestFlight" job passes (archive + export + upload).
- [ ] `deploy-prod.yml`'s archive step carries the same explicit destination (latent-fix; proven by the pin test — prod is NOT dispatched for this story).
- [ ] `seed-dev-personas.yml` requires + consumes `DEV_QA_PERSONAS_PASSWORD`; the "Seed Dev Personas" job passes on the same dispatched run.
- [ ] `setup-jdk-gradle/action.yml` pins the same setup-java SHA as every workflow (`0f481fcb613427c0f801b606911222b5b6f3083a`); `ci-action-pin-consistency.test.js` is green.

### Error paths

- [ ] If the seed workflow is invoked without the canonical secret available, it still fails LOUDLY at call time (the `required: true` contract is kept — no silent skip).
- [ ] N/A beyond that — the changes remove failure modes rather than adding branches.

### Edge cases

- [ ] `seed-dev-personas.yml`'s `workflow_dispatch` path (standalone re-seed without a deploy) resolves the renamed secret from repo secrets — comment updated to match.
- [ ] Every OTHER `actions/setup-java` reference repo-wide stays on the one canonical SHA (the consistency test enumerates workflows + composite actions).

### Performance

- [ ] N/A — flag + name changes only; no added steps.

### Security

- [ ] The secret RENAME does not widen access: same secret material, same scopes; `secrets: inherit` forwards by name to the reusable workflow exactly as before. No secret value is ever echoed.
- [ ] The SHA bump is dependabot's own reviewed 5.5.0 SHA already trusted in `test-backend.yml` — no new supply-chain surface.

### UX

- [ ] N/A — no user-facing surface (CI plumbing only).

### i18n

- [ ] N/A — no strings.

### Observability

- [ ] The dispatched verification run's job list is the proof artifact: previously-failing jobs green, recorded in Notes with the run id.

## BDD Scenarios

**Scenario: the dev deploy distributes iOS again**

- **Given** the fix branch carries the destination fix
- **When** Deploy-To-Dev is dispatched with the fix branch as its `ref` (Phase-3 unmerged-branch pattern)
- **Then** the "Distribute iOS to TestFlight" job completes successfully (no "Found no destinations" error)

**Scenario: personas reseed on deploy again**

- **Given** the same dispatched run
- **When** the "Seed Dev Personas" job executes
- **Then** it resolves `DEV_QA_PERSONAS_PASSWORD` and completes successfully

**Scenario: the pin suite enforces the fixed state**

- **Given** the repo after the fix
- **When** the express script-pin tests run
- **Then** the seed-personas pins assert the CANONICAL secret name, the archive pins assert the explicit generic destination on BOTH deploy workflows, and the action-SHA consistency test passes

**Scenario: prod carries no latent copy of the bug**

- **Given** `deploy-prod.yml` after the fix
- **When** its archive invocation is inspected (pin test)
- **Then** it carries `-destination 'generic/platform=iOS'` identically

## Test Plan

**CI-config-only classification:** changes confined to `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml`, `.github/workflows/seed-dev-personas.yml`, `.github/actions/setup-jdk-gradle/action.yml`, and their pin tests in `express-api/tests/scripts/` — no app, backend, or website runtime surface → device/browser gauntlet exempt per the protocol's exemption 2. Verification is the REAL dispatch (verified-needs-dispatch).

**Red → Green:**

- **`express-api/tests/scripts/deploy-dev-seed-personas.test.js`**: flip the three `PERSONAS_PASSWORD_DEV` expectations (lines ~93/122/129) to `DEV_QA_PERSONAS_PASSWORD` — RED against current YAML → rename in `seed-dev-personas.yml` → GREEN.
- **`express-api/tests/scripts/ios-deploy-archive-signing.test.js`**: new `test.each(WORKFLOWS)` asserting the archive invocation (existing `archiveInvocation` helper) contains `-destination 'generic/platform=iOS'` — RED on both workflows → add the flag → GREEN.
- **`express-api/tests/scripts/ci-action-pin-consistency.test.js`**: ALREADY RED on develop (the drift) → bump the composite action's SHA → GREEN. No test edit needed (the ratchet is the test).
- **Full express suite** (`npm test`, CI harness up) — proves no other pin/structure test regressed.
- **actionlint + prettier/eslint + story validator + `code-reviewer` clean** (CI-config-only gate set).
- **Dispatch proof:** Deploy-To-Dev dispatched with the story branch as `ref` (Phase-3 unmerged-branch pattern) BEFORE merge; previously-failing jobs must pass (iOS TestFlight + Seed Dev Personas). Any failure → fix-forward loop on the branch.

## Out of Scope

- Restructuring the pre-push hook / develop CI (SHY-0197).
- The `pre-merge-check.sh` Cancelled/Done story exemption (SHY-0197's scope).
- Prod deploy dispatch (latent fix is pin-test-proven only; prod deploys remain operator-gated).
- dependabot grouping/config changes to prevent future partial bumps (candidate follow-up if drift recurs).

## Dependencies

- None blocking. Coordinates with the in-flight Deploy-To-Dev run 29475103691 (pre-fix, expected to fail the two jobs — it is the control sample).

## Risks & Mitigations

- **Risk:** the empty destination list actually means the runner image lost the iOS platform, and the explicit destination still fails. **Mitigation:** the dispatch IS the experiment; if it fails, evidence-driven iteration (e.g. `-downloadPlatform iOS` step) on the same branch before merge is declared done — the story is not Done until the dispatched jobs are green.
- **Risk:** renaming the secret breaks the standalone `seed-dev-personas.yml` dispatch path. **Mitigation:** both call paths reference the same `secrets.X` name; the workflow_dispatch path reads repo secrets directly — covered by the same rename + the pin test.

## Definition of Done

All four YAML/action files fixed; pin tests flipped RED→GREEN; full express suite green; `code-reviewer` 100% clean; **a dispatched Deploy-To-Dev run (story branch as `ref` — Phase-3 unmerged-branch pattern) shows "Distribute iOS to TestFlight" AND "Seed Dev Personas" green BEFORE merge** (run id in Notes); merged to MAIN per the CI-config-only→main rule (operator 2026-07-16) with main back-merged into develop immediately after; story → Done on main-merge (no release-cut wait for this class).

## Notes

- 2026-07-16 ~13:0x WIB — Filed and picked up in one motion (diagnosis completed this morning: runner-image delta `0202.1→0213.1`, empty destination enumeration, secret-name archaeology to SHY-0136, drift test RED since the main sync). Control sample: run 29475103691 (pre-fix, in flight at filing time).
- 2026-07-16 ~13:2x WIB — TDD: destination + seed-secret pins RED first, fixes landed (target suites 45/45). `code-reviewer`: APPROVE + 2 Important findings (destination-exclusivity guard on `-exportArchive`; usage-line secret pin) — both fixed (33/33; test-only delta implementing the reviewer's own prescriptions). Full express suite 13,498 green (REAL_EXIT=0) on the develop-based branch; actionlint + prettier + eslint + story validator clean. Control run 29475103691 completed: failed exactly the two target jobs — clean control sample.
- 2026-07-16 ~13:5x WIB — DoD verification dispatched from the develop-based branch via the Deploy-To-Dev `ref` input (Phase-3 unmerged-branch pattern): run 29478170583 — https://github.com/Shyden-Ltd/ShyTalk/actions/runs/29478170583. Merge gates on "Distribute iOS to TestFlight" AND "Seed Dev Personas / Seed test personas (dev)" green (control failed exactly these two).
- 2026-07-16 ~14:2x WIB — Operator directive (now codified): CI-config-only tickets merge DIRECTLY to main; story → Done on main-merge; main back-merged into develop immediately. PR #1613 (base develop) closed superseded — that branch was develop-based, so retargeting it would have dragged develop's whole unreleased delta past the device gauntlet. Re-cut from origin/main: cherry-picks cad84aa9562 + 8fe9c1c5582 verified BYTE-IDENTICAL to the reviewed content (per-file diff = 0 across all 6 code files); targeted pin suites 48/48 on the main tree; actionlint + prettier + story validator clean. Run 29478170583 remains the DoD verification — it exercises the exact fixed archive invocation + secret plumbing; the develop-vs-main tree delta touches neither failure mode.

- 2026-07-16 ~14:3x WIB — PR [#1614](https://github.com/Shyden-Ltd/ShyTalk/pull/1614) (base main) opened; #1613 closed superseded. Verification run 29478170583 progress: **"Seed Dev Personas / Seed test personas (dev)" GREEN** (red in control — secret fix proven); "Distribute iOS to TestFlight" in progress; all other jobs green.
- 2026-07-16 ~16:5x WIB — **Root cause #2** from verification run 29478170583: "Distribute iOS to TestFlight" fails with "iOS 26.0 is not installed" (exit 70) — runner image 20260630.0213.1 ships the default Xcode WITHOUT the iOS platform runtime (the earlier EMPTY "Found no destinations" list was the same gap pre-`-destination`). Fix: `sudo xcodebuild -downloadPlatform iOS` ensure-step (`timeout-minutes: 20`) before the archive in BOTH deploy workflows. Idempotency probed empirically (Xcode 27.0 host, platform already installed): exit 0 in 0.745s — NOT the Metal-Toolchain `-importComponent` exit-70 "already installed" mode; probe output also shows the plain invocation auto-resolves the arm64 architecture variant. **Caching decision trail:** Actions cache at 9.76/10 GB (98% of the HARD per-repo quota, stale/dupe entries pending audit); platform dmg size unmeasured; arm64 `-architectureVariant` export probe NOT a fast no-op (~90s locally) — decision: ship the uncached ensure-step now (seconds when present, ~3-10 min fetch, step-capped) and revisit dmg caching under the cache-hygiene task once quota headroom + measured size are known. `code-reviewer` R1: 5 findings (3 Imp / 1 Min / 1 Nit) — ALL fixed: job envelopes 100→120 both workflows (TDD: ≥120 pin RED at 100, GREEN at 120), install-step `timeout-minutes: 20` pinned scoped to its step block (20→50 drift mutant RED), order pin scoped to the real xcodebuild archive invocation + same-job `runs-on` guard (cross-job decoy mutant RED — the R1 whole-file pin PASSED that mutant), idempotency claim replaced with probe evidence, root-cause #1/#2 comment wording disambiguated. R1.1: **ZERO FINDINGS** (reviewer independently grep-verified job boundaries, ARCHIVE_JOBS mapping, mutation soundness across both full workflows). Gates on final tree: 11 workflow pin suites 218/218; prettier + eslint `--max-warnings=0`; actionlint; tree clean at 0887bd52cd2.

- 2026-07-16 ~18:5x WIB — Develop-side drift half: the device-return gauntlet's express battery failed exactly ci-action-pin-consistency (setup-java pinned to 2 SHAs — the drift THIS story fixed on the main-based branch never reached develop after #1613 was closed superseded). Aligned `.github/actions/setup-jdk-gradle/action.yml` to the SAME SHA #1614 uses (0f481fcb… v5.5.0) so the eventual main→develop back-merge cannot conflict or re-drift. RED = the canonical full express run (13,495/13,496, sole failure named this drift + fix verbatim); GREEN = pin suite 15/15. One-line test-prescribed alignment, self-verified per the agent-frugality rule (the R1/R1.1-reviewed main-side fix is byte-identical on this SHA).

Reviewed-up-to: 2238d4e3640

**2026-08-14 — correction.** This story was flipped to `Done` +
`released_in: v0.98.0` by the v0.98.0 bookkeeping sweep (PR #1741) and that
was WRONG. Reverted here.

The sweep derived membership from "the story ID appears in `git log v0.98.0`".
SHY-0195 appears there via PR #1617 — whose own title says it is _"the drift
half of the main-based fix"_. A partial fix carries the story ID exactly as
loudly as a complete one.

The other half is still open in **PR #1614**, and its changes are demonstrably
not on develop: `deploy-dev.yml`, `.github/actions/setup-jdk-gradle/action.yml`
and `deploy-dev-seed-personas.test.js` all differ between develop and that
branch. The branch's own copy of this story still reads `In Review`, which is
the honest status.

Checked for the same fault across the whole sweep: cross-referencing all 59
flipped stories against open PRs found SHY-0195 and nothing else.
