---
id: SHY-0269
status: In Review
owner: claude
created: 2026-08-03
priority: P0
effort: S
type: bug
roadmap_ids: []
pr:
mvp: true
---

# SHY-0269: Dev persona seeding died silently and stayed dead for 18 days

## User Story

As the operator relying on dev for manual QA and journey runs,
I want a deployment step that stops working to say so where I will see it,
So that I never test against stale data believing it is fresh.

## Why

Spotted while checking an unrelated dev deploy on 2026-08-03: the `Seed Dev
Personas` job had failed. It had also failed on the previous deploy, and on three
before that — five of the last eight, plus one run where it was silently
**skipped** while the deploy reported green. The last successful seed was
2026-07-16. Dev personas P-02..P-19 had not been refreshed for ~18 days.

Three separate defects, and the least interesting one is the trigger:

1. **The trigger.** `seed-dev-personas.yml` declares and reads
   `PERSONAS_PASSWORD_DEV`. SHY-0136 renamed that secret to
   `DEV_QA_PERSONAS_PASSWORD`; four other workflows moved with it, this one did
   not.
2. **The silence — the real defect.** The secret was declared `required: true`
   on `workflow_call`, so GitHub failed the call during *secrets evaluation*,
   before the job had any steps. The result is a failed job with **zero steps
   and zero logs**: `gh run view --log-failed` returns nothing. The reason
   ("Secret PERSONAS_PASSWORD_DEV is required, but not provided while calling")
   existed only as a check-run annotation, which nothing surfaces.
3. **Nothing was watching.** The seed result sat among seven jobs on a run that
   still deployed the backend, web, APK and TestFlight build. Nothing summarised
   it, and a *skipped* seed produced a fully green run.

And the test that should have caught (1) instead **pinned it**: it asserted the
workflow contained the literal `PERSONAS_PASSWORD_DEV:` and its comment claimed
"names match the repo's GitHub Actions secrets settings". A string compared to a
string has no ground truth.

## Acceptance Criteria

### Happy path
- [ ] A dev deploy refreshes the seeded personas and says so in the run summary

### Error paths
- [ ] A missing secret fails in a step, in the run log, naming the secret
- [ ] A seed that cannot run makes the consequence explicit: personas are stale
- [ ] A skipped seed is reported as skipped, not left to look like success

### Edge cases
- [ ] A provisioning script that exits 0 without completing is treated as failure
- [ ] A secret that is deliberately absent because it has a fallback is not
      reported as drift

### Performance
- [ ] N/A — the preflight is a shell test on two variables and the report job is
      a single `echo`; both are seconds against a multi-minute deploy.

### Security
- [ ] Neither the preflight nor the summary ever prints a secret VALUE — only
      names of secrets that are missing
- [ ] The service-account credential is still wiped by the existing `trap`

### UX
- [ ] The operator learns that dev data is stale from the run page, without
      opening a job or reading annotations

### i18n
- [ ] N/A — CI operator output, English-only by design.

### Observability
- [ ] Every referenced secret name is checked against a committed inventory, so
      a rename cannot silently disable a job again

## BDD Scenarios

**Scenario: A missing secret explains itself in the log**
- **Given** a secret the seeding needs is not configured
- **When** a dev deploy runs the seeding step
- **Then** the run fails naming the missing secret and says personas are stale

**Scenario: A skipped seeding is reported, not hidden**
- **Given** a dev deploy where the seeding does not run
- **When** the deploy finishes
- **Then** the summary states personas were not refreshed

**Scenario: Provisioning that does not complete is a failure**
- **Given** the provisioning finishes without confirming it seeded anyone
- **When** the seeding step checks the result
- **Then** the step fails rather than reporting success

**Scenario: A renamed secret cannot silently disable a job**
- **Given** a workflow referring to a secret name that is not in the inventory
- **When** the test suite runs
- **Then** it fails naming the workflow and the unknown secret

## Test Plan

**Red first** — 8 failures before the fix, in
`express-api/tests/scripts/`:

- `workflow-secrets-inventory.test.js` (new) — every `secrets.X` under
  `.github/workflows/**` and `.github/actions/**` must appear in
  `.github/known-secrets.yml`. Comments are stripped first so prose about a
  secret is not counted as a reference, and a vacuous-pass guard asserts the
  extractor actually finds references. An `optional:` section models names that
  are intentionally absent behind a documented `|| fallback`, and each entry
  must state that fallback.
- `deploy-dev-seed-personas.test.js` — corrected the mis-pinned secret name;
  added: `workflow_call` secrets must NOT be `required: true` (so failures land
  in logs), a preflight step must name every missing secret via `::error`, the
  deploy must report the seed outcome to `$GITHUB_STEP_SUMMARY` from an
  `if: always()` job distinguishing success/failure/skipped, and the seed action
  must assert the provisioning completion marker.

**Green** — 29/29 pass; `actionlint` clean on both workflows; `eslint
--max-warnings=0` clean; prettier clean.

**Live proof** — the reusable workflow is dispatched against this branch and
must reach `PROVISION_ALL_OK`, which also refreshes dev personas for the first
time since 2026-07-16.

## Out of Scope

- Verifying the inventory against GitHub's actual secret list at runtime — a
  workflow cannot enumerate secrets. The inventory proves the repo agrees with
  itself; the preflight catches a secret that is listed but absent.
- Auditing every other CI job for the same silent-failure shape. The inventory
  check already swept every workflow for the secret-name half; the
  `required: true` + no-summary shape elsewhere is a follow-up.

## Dependencies

- None. Secret `DEV_QA_PERSONAS_PASSWORD` already exists on the repository.

## Risks & Mitigations

- **Risk:** `required: false` weakens the contract — a caller could forget to
  forward the secret. **Mitigation:** the preflight fails the job on the very
  first step with a louder, more actionable message than the platform's, and it
  covers the `workflow_dispatch` path too, which `required:` never did.
- **Risk:** the inventory drifts from GitHub's real secret list.
  **Mitigation:** it is a committed file with a stated update rule, and the
  preflight independently catches a listed-but-absent secret at runtime.
- **Risk:** the `| tee` in the seed action masks the script's exit code.
  **Mitigation:** the step already runs under `set -euo pipefail`; a pin test
  asserts the invocation and the absence of a dotenv preload.

## Definition of Done

- [ ] 29/29 tests green; actionlint, eslint, prettier clean
- [ ] `seed-dev-personas.yml` dispatched against this branch and reaching
      `PROVISION_ALL_OK` — dev personas actually refreshed
- [ ] A deliberately-broken dispatch shows the failure in the run LOG, not only
      in an annotation
- [ ] Merged to develop; `released_in:` set at the next release cut

## Notes (running log)

- **2026-08-03 07:5x BST** — Found while verifying an unrelated dev deploy.
  Quantified before diagnosing: last 8 deploy-dev runs showed seed
  failure/failure/skipped/failure/failure/success/failure/failure, last success
  2026-07-16.
- **2026-08-03 08:0x BST** — Root cause read from the check-run annotation, not
  inferred. `git log -S` showed `PERSONAS_PASSWORD_DEV` unchanged in this
  workflow since 2026-05-29, so the repo secret was renamed under it.
- **2026-08-03 12:4x BST** — Flipped to In Review. CI-config-only (no app, backend or
  website runtime surface), so the device/browser gauntlet is not applicable; the fix is
  additionally live-proven by a real dispatch that reached `PROVISION_ALL_OK count=17`.
- The inventory check immediately found one further reference not backed by a
  configured secret — `SMOKE_FIREBASE_API_KEY` — which turned out to be a
  deliberate `|| DEV_FIREBASE_API_KEY` override with its own preflight. Modelled
  as `optional:` rather than silenced.
