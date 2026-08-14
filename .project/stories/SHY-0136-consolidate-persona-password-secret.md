---
id: SHY-0136
status: In Review
owner: claude
created: 2026-06-20
priority: P2
effort: XS
type: infra
roadmap_ids: []
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/PENDING
public: false
mvp: false
---

# SHY-0136: Consolidate the dev persona-password secret to a single source of truth

## User Story

As a **maintainer deploying dev builds for device testing**,
I want **the seeded test-persona password and the password the app build bakes in to come from ONE GitHub secret**,
So that **persona sign-in on dev can never silently break from two redundant secrets drifting out of sync**.

## Why

There were **two** GitHub Actions secrets holding the same logical value — the dev test-persona password:

- **`DEV_QA_PERSONAS_PASSWORD`** (created 2026-05-21) — the canonical one, read by the **Android app build** (`MainActivity.kt` → `BuildConfig.DEV_QA_PERSONAS_PASSWORD`), the **iOS app build** (`$(DEV_QA_PERSONAS_PASSWORD)` xcconfig), **pr-checks**, **deploy-dev** (APK build) and the **manual-qa journey matrix**.
- **`PERSONAS_PASSWORD_DEV`** (created 2026-05-29, when the standalone `seed-dev-personas` workflow was added) — read by **exactly one place**: the seed workflow, to set the personas' password.

Nothing enforced the two equal. They drifted, so the personas got seeded with one value while every client signed in with the other → Firebase `INVALID_CREDENTIALS` → the app's generic _"Persona sign-in failed"_ (the `DevSignInHelper` swallows the specific error). This blocked the SHY-0130 dev device-test session on 2026-06-20.

The redundant secret created a **manual synchronisation obligation with no enforcement** — the textbook duplicated-config failure. This story removes it: the seed workflow now reads the canonical `DEV_QA_PERSONAS_PASSWORD`, so there is **one** persona-password secret used everywhere.

## Acceptance Criteria

### Happy path

- [ ] `seed-dev-personas.yml` reads `secrets.DEV_QA_PERSONAS_PASSWORD` (not `PERSONAS_PASSWORD_DEV`) for both invocation paths (`workflow_call` from deploy-dev + direct `workflow_dispatch`).
- [ ] A repo-wide grep for `PERSONAS_PASSWORD_DEV` returns **zero** references (workflow + comments + tests) — the secret name is fully retired in code.
- [ ] After deploy, the freshly-built APK (bakes `DEV_QA_PERSONAS_PASSWORD`) and the freshly-seeded personas (now seeded from the same secret) share one value → persona sign-in succeeds on a real device.

### Error paths

- [ ] The `workflow_call` `secrets:` block still declares the persona-password secret `required: true`, so a future caller that forgets `secrets: inherit` fails at workflow_call validation, not silently at runtime.

### Edge cases

- [ ] The direct `workflow_dispatch` path still resolves the secret from repo-level Actions secrets (it now resolves `DEV_QA_PERSONAS_PASSWORD`, which exists repo-wide).

### Performance

- N/A — CI config rename; no runtime path changed.

### Security

- [ ] No secret VALUE is committed or logged; only the secret NAME reference in YAML changes. Retiring the redundant `PERSONAS_PASSWORD_DEV` reduces the secret surface (one fewer credential to rotate/leak).
- [ ] The change does not alter what the seed script does or which project it targets (still dev-only, `assertSafeProject()` unchanged).

### UX

- N/A — no user-facing surface.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] The pin test `deploy-dev-seed-personas.test.js` asserts the canonical secret name, so a future re-introduction of a divergent name fails CI loudly.

## BDD Scenarios

**Scenario: seed workflow reads the canonical secret**

- **Given** the consolidated `seed-dev-personas.yml`
- **When** the `deploy-dev` workflow calls it with `secrets: inherit`
- **Then** the seed action receives `personas-password` from `secrets.DEV_QA_PERSONAS_PASSWORD`
- **And** the personas are seeded with the same value the app build bakes in

**Scenario: the redundant secret name is gone (regression guard)**

- **Given** the repo after this change
- **When** `deploy-dev-seed-personas.test.js` runs
- **Then** it asserts `DEV_QA_PERSONAS_PASSWORD:` is declared `required: true` in the workflow
- **And** a re-introduction of `PERSONAS_PASSWORD_DEV` would fail the suite

## Test Plan

**Red:** flip `express-api/tests/scripts/deploy-dev-seed-personas.test.js` to expect `DEV_QA_PERSONAS_PASSWORD:` → run `node --experimental-vm-modules node_modules/.bin/jest tests/scripts/deploy-dev-seed-personas.test.js` → FAILS against the unchanged workflow (proves the guard).

**Green:** rename the 3 references in `seed-dev-personas.yml` (`workflow_call.secrets` declaration + the comment + `personas-password:` usage) → rerun the suite → **20/20 pass** + actionlint clean + repo grep for `PERSONAS_PASSWORD_DEV` returns none.

**Live:** deploy-dev (Android) from the consolidated workflow re-seeds + rebuilds from the one secret; persona sign-in verified on a real Android device (the SHY-0130 device session this unblocks).

## Out of Scope

- The SHY-0130 conversations id-type fix and its device test (this only fixes the sign-in infra that blocked it).
- Rotating / setting the secret VALUE (an operational step done out-of-band; this PR only changes which secret NAME the seeder reads).
- The `local` flavor persona password (hardcoded `localdev123` for the emulator — a separate, intentional constant).

## Dependencies

- The repo-level GitHub secret `DEV_QA_PERSONAS_PASSWORD` must hold the intended dev persona password (it does; set fresh 2026-06-20).
- After merge, the now-unused `PERSONAS_PASSWORD_DEV` repo secret should be **deleted** in GitHub settings (operational follow-up; no code depends on it).

## Risks & Mitigations

- **Risk:** a future caller of the reusable workflow passes secrets explicitly by the old name. **Mitigation:** the only caller (`deploy-dev.yml`) uses `secrets: inherit`; the pin test asserts the declared name.
- **Risk:** the secret value is wrong/empty post-rename. **Mitigation:** the deploy's seed + the app build now read the SAME secret, so they cannot disagree; an empty value would fail BOTH symmetrically (loud), not silently mismatch.

## Definition of Done

- `seed-dev-personas.yml` + the pin test reference only `DEV_QA_PERSONAS_PASSWORD`; repo grep for the old name is empty.
- Pin test green via the canonical runner; actionlint clean; CI required checks green by name.
- `code-reviewer` clean; merged; `PERSONAS_PASSWORD_DEV` repo secret deleted.
- Released in a `vX.Y.Z` cut with `released_in:` set.

## Notes (running log)

- 2026-06-20 — Filed live while unblocking the SHY-0130 dev device-test (persona sign-in failed on a real Android device). Root cause traced to the two-secret drift (`DEV_QA_PERSONAS_PASSWORD` 2026-05-21 vs `PERSONAS_PASSWORD_DEV` 2026-05-29). Fix is TDD'd (red→green on the pin test, 20/20) + actionlint clean + repo grep clean. Architect step skipped (XS config rename, low-risk; per rate-limit-slowdown guidance). Deployed to dev via `gh workflow run deploy-dev.yml --ref chore/SHY-0136-... -f ref=story/SHY-0130-...` so the re-seed + APK rebuild both read the single secret before the PR merges. After merge: delete the redundant `PERSONAS_PASSWORD_DEV` GitHub secret.

**2026-08-14 — review + rebase onto develop.**

Retargeted from `main` to `develop` (the merge policy moved to develop-first on
2026-07-25; this PR predated it). `develop` merged into the branch, which
cleared a `lint / Lint` failure caused by the branch carrying pre-promotion
workflow files — actionlint was linting stale copies, not this PR's changes.

Reviewed the diff. Three files, one coherent change: the seeded-persona secret
renamed `PERSONAS_PASSWORD_DEV` → `DEV_QA_PERSONAS_PASSWORD`, with
`deploy-dev-seed-personas.test.js` updated in lockstep so the tests assert the
new name rather than the old.

The one risk in a secret rename is that the new name does not exist, which
fails at `workflow_call` secrets validation rather than anywhere obvious.
Checked: `DEV_QA_PERSONAS_PASSWORD` IS provisioned on the repo (secret names
only — values are never readable), and no `PERSONAS_PASSWORD_DEV` remains.
Safe to merge.

Reviewed-up-to: 1a02a01fe6745c030e595b447bae4121969a4051
