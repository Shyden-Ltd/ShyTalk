---
id: SHY-0328
status: In Review
owner: claude
created: 2026-08-18
priority: P0
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0328: The local journey matrix cannot pass on any branch, because it seeds with one password and signs in with another

## User Story

As a **developer running the pre-merge gauntlet**, I want the local journey
matrix to seed and sign in with the same persona password, so that Phase 1 of
the Pre-Merge Testing Protocol is actually achievable.

## Why

**This is P0 because it invalidates the gate every story is supposed to pass.**

Measured live on run `20260817-235347-local`: **0 pass / 5 fail / 7 skip**, and
per cell **exactly `OK=2 / FAIL=224`** — on `chromium`, `mobile-chrome-android`,
`mobile-firefox-android`, `mobile-safari-ios` and `mobile-chrome-ios` alike. The
uniformity is the diagnosis: real product debt does not fail every scenario of
every feature on every browser, including desktop `chromium`, which touches no
device at all.

Two scripts disagree about one credential:

- `20-reseed.sh:43` **FORCES** local personas to `localdev123`, because the
  `.local` app flavour bakes `DEV_QA_PERSONAS_PASSWORD='localdev123'`.
- `50-matrix.sh` sources `~/.shytalk/dev-personas.env` and requires
  `PERSONAS_PASSWORD` from it (`:56,:61`) — the **32-character DEV** secret —
  then passes it to the runner with no local override (`:114`).

So the run seeds with one credential and signs in with another. Every persona
sign-in fails, so every journey dies at its first gate.

**The asymmetry that hid it.** The SEED side has been guarded since 2026-07-11 —
`20-reseed.sh:63` dies with "personas seeded with the WRONG password
(INVALID_PASSWORD) — a dev PERSONAS_PASSWORD leaked into the seed". Nobody ever
guarded the RUNNER side, so the mirror-image failure was silent.

**And it was believed fixed.** A reference note dated 2026-07-22 records this
exact root cause and states the fix is "in place since 2026-07-22", pinned by
`matrix-local-persona-password.test.js`. Neither exists: `git log -S
"PERSONAS_PASSWORD=localdev123" -- express-api/scripts/gauntlet/50-matrix.sh`
returns **no history at all**, and the test file is absent from develop, main and
every story branch. The fix was written up as done and never landed — so this is
not a regression, it is a fix that never shipped, and the note has been corrected.

The consequence is worth stating plainly: **any claim of "LOCAL gauntlet green"
since 2026-07-22 was not achievable.** That includes the release-gate protocol.

## Acceptance Criteria

### Happy path

- [ ] `50-matrix.sh` passes `PERSONAS_PASSWORD=localdev123` to the runner for `target = local`.
- [ ] A local matrix run reaches real journey execution — persona sign-in succeeds and the per-cell shape is no longer `OK=2 / FAIL=224`.
- [ ] The value is DERIVED from `20-reseed.sh` by the pinning test, not hard-coded twice.

### Error paths

- [ ] Removing the override turns exactly one named test RED (mutation-proven).
- [ ] A future change to the seeded password without a matching runner change fails the test.
- [ ] `target = dev` is NOT overridden — dev personas use the real secret, and pinning `localdev123` there would break every dev run just as uniformly.

### Edge cases

- [ ] The test reads the FORCING assignment in `20-reseed.sh`, not a mention of the password in a comment.
- [ ] If `20-reseed.sh` stops forcing a password at all, the test fails loudly rather than passing against `null`.
- [ ] A dev-length secret appearing on the seed line fails the test (the runtime guard at `20-reseed.sh:63` pinned statically too).
- [ ] An operator who has already exported `PERSONAS_PASSWORD` in their shell still gets the pinned local value — the override is in the runner's env prefix, so it wins.

### Performance

- [ ] N/A — a one-line env-prefix change and a file-reading test. No runtime cost.

### Security

- [ ] `localdev123` is a LOCAL-EMULATOR credential only; it is already committed in `20-reseed.sh` and the `.local` flavour, so pinning it in `50-matrix.sh` discloses nothing new.
- [ ] The real 32-char dev secret is never written into a script, a log, or this story.
- [ ] The `dev` target keeps sourcing the real secret from `~/.shytalk/dev-personas.env`, unchanged.

### UX

- [ ] N/A — developer tooling with no end-user surface. The developer-facing outcome is that a 0-pass matrix stops being the default state.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] A future 0-pass run is diagnosable from the run artefacts alone: the triage ladder (per-cell `OK`/`FAIL` counts, then the watermark `UID:` field in a scenario screenshot) is recorded in the reference note.
- [ ] The runner side now has parity with the seed side's existing loud failure.

## BDD Scenarios

**Scenario: A local test run can actually sign in**

- **Given** a freshly seeded local environment
- **When** the journey matrix runs
- **Then** the test personas sign in successfully

**Scenario: Every journey no longer dies at the first gate**

- **Given** a local journey matrix run
- **When** it finishes
- **Then** the results are not zero-passed across every browser

**Scenario: Changing the seeded password without the runner is caught**

- **Given** someone changes the password used to create the test accounts
- **When** the checks run
- **Then** they fail until the run's sign-in password is changed to match

**Scenario: Runs against the shared dev environment are unaffected**

- **Given** a run targeting the shared dev environment
- **When** it signs in
- **Then** it uses the real dev credential, not the local one

## Test Plan

**RED first.** The failing state was measured before any change: run
`20260817-235347-local`, `0 pass / 5 fail / 7 skip`, `OK=2 / FAIL=224` per cell.

### Node / Jest — `express-api/tests/scripts/gauntlet/matrix-local-persona-password.test.js`

- `20-reseed.sh forces an explicit local persona password`
- `50-matrix.sh has a local env_prefix at all`
- **`the runner password for local EQUALS the seeded password`** — the defect in one assertion
- `does NOT override the password for dev — dev personas use the real secret`
- `the seeded password is not the 32-char dev secret`

The expected value is derived from `20-reseed.sh`. A test hard-coding
`localdev123` on both sides would pass on the day someone changes the seed —
exactly the drift it exists to prevent.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| the `PERSONAS_PASSWORD=localdev123` override removed | `the runner password for local EQUALS the seeded password` |
| `localdev123` also pinned for the `dev` target | `does NOT override the password for dev` |
| the seed line's forcing assignment removed | `20-reseed.sh forces an explicit local persona password` |
| the test hard-codes the value on both sides | it would stop failing under mutation 3 — checked by inspection |

Verified: 5/5 green with the pin; removing the pin turns exactly one named test
RED, and the tree was restored with the pin re-applied and re-verified.

### Real-run proof

- Relaunch the matrix on the same machine and devices and confirm persona
  sign-in succeeds and the per-cell shape changes. **A green test is not the
  deliverable here — a matrix that can actually run is.**

### CI-config-only classification

Touches `express-api/scripts/gauntlet/**` and a new test under
`express-api/tests/scripts/**`. No app, backend or website runtime surface →
CI-config-only, so no device gauntlet for this change itself.

## Out of Scope

- Fixing whatever journey failures the matrix reveals ONCE it can sign in. Those
  are real findings and get their own stories; this one only makes them visible.
- The 7 skipped cells (Samsung Internet is not installable on the OnePlus; Edge
  needs its first-run flow completed; Chrome's CDP socket needs an active
  renderer).
- Any change to the `dev` target's credential handling.

## Dependencies

- None. This is a one-line script change plus its test, and it blocks everything
  that needs a local gauntlet — so it should land first.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| **Believed-fixed again without landing** — the exact failure mode last time | The pinning test is part of this story's DoD, and the reference note has been corrected to say the earlier fix was never committed. A note is not a fix. |
| `localdev123` pinned for `dev` by a later well-meaning edit | Explicitly asserted against, and in the mutation table. |
| The test hard-codes the value and stops detecting drift | It derives the expected value from `20-reseed.sh`; mutation 3 checks that derivation is real. |
| The matrix still fails after this, and the fix looks wrong | Expected and fine: this unblocks sign-in, it does not promise green journeys. The DoD asks for a CHANGED per-cell shape, not a passing matrix. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] **A real local matrix run shows persona sign-in succeeding** and a per-cell shape other than `OK=2 / FAIL=224`.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`; `actionlint` clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Found while running the local gauntlet for PR #1696 after the operator enabled iOS UI Automation. The matrix launched cleanly (reseed verified, 9 tunnels, both devices prepped, 14 ok / 0 fail / 3 skip on `--check-drivers`) and then returned `0 pass / 5 fail / 7 skip`.
- **2026-08-18** — Diagnosed via the documented triage ladder rather than guessed: per-cell `OK`/`FAIL` counts first (`OK=2 / FAIL=224`, uniform), which identifies auth over product debt.
- **2026-08-18** — The reference note claiming this was fixed on 2026-07-22 was WRONG. `git log -S` finds no history for the pin, and the pinning test does not exist on any ref. Corrected the note in place; it now leads with the correction so the next reader does not trust it again.
- **2026-08-18** — Filed P0 / `mvp: true`: it invalidates Phase 1 of the Pre-Merge Testing Protocol, so any "local gauntlet green" claim since 2026-07-22 was unachievable.
