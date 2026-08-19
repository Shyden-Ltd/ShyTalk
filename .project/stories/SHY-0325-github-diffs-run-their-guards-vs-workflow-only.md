---
id: SHY-0325
status: Draft
owner: claude
created: 2026-08-17
priority: P2
effort: S
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0325: A workflow-only change can either skip CI or run its guards, and right now it silently does the first

## User Story

As the **operator**, I want a decision on whether a `.github/**`-only change
runs its guard tests, so that a workflow-only PR either pays for CI
deliberately or skips it deliberately — not by accident.

## Why

These two cannot both be true, and today the second one silently wins.

`WORKFLOW_ONLY` is **defined** as "no flag is set" — `pr-checks.yml:160` sets it
true only when `APP`, `BACKEND`, `WEB`, `INTEGRATION`, `SCRIPTS` and `OTHER` are
all false. So routing `.github/*` to *any* flag necessarily makes
`workflow_only` false, and `workflow_only` gates jobs including `sonarcloud`
(`:404`).

- **SHY-0226's position:** a `.github/**` diff must run the pin guards. It set
  nothing at all, which is how #1646 merged a workflow-only pin bump with
  `test-backend` AND `sonarcloud` both skipped, reintroducing a two-SHA drift
  that then failed every queued Dependabot PR.
- **SHY-0284's position:** `workflowOnlyFor(['.github/workflows/lint.yml'])`
  must stay `true` — "the flag must keep working for what it was built for."

Both are reasonable and they are mutually exclusive. The tie-breaker is cost:
this repo is **$0-hosting** with a no-paid-runners rule, and flipping the switch
means every workflow tweak starts paying for `sonarcloud` + `test-backend`.
That is an operator trade-off, which is why SHY-0226 reverted its half rather
than deciding unilaterally.

**Evidence the hole is real, not theoretical.** While SHY-0226's routing was
briefly in place, `test-backend` ran on a `.github/**`-only diff for the first
time and immediately failed: `develop-ci-gate.test.js` only understood
`directory:` (singular) and read the newer `directories:` form as `?`. A real
incompatibility, invisible for as long as the guard never ran.

## Acceptance Criteria

### Happy path

- [ ] A decision is recorded: either `.github/**` sets a flag (guards run) or it stays workflow-only (guards skip), with the reasoning written down.
- [ ] Whichever is chosen, `pr-checks.yml` and the guard tests agree with each other and with SHY-0284's test.
- [ ] A `.github/**`-only PR demonstrably behaves as decided, proven by a real PR rather than by reading the YAML.

### Error paths

- [ ] If guards-run is chosen, a deliberately-broken guard on a `.github/**`-only diff **fails CI** — proven, not assumed.
- [ ] If workflow-only is kept, the residual risk is documented on SHY-0226 so the next #1646 is diagnosed in minutes rather than rediscovered.

### Edge cases

- [ ] A PR touching BOTH `.github/**` and product code behaves as the product-code path dictates, unchanged either way.
- [ ] `.github/pull_request_template.md` (matching both `.github/*` and the residual `*.md` arm) resolves per the first-match ordering, whichever decision lands.
- [ ] A third option is considered and either taken or explicitly rejected: a narrow flag that runs ONLY the pin/structure guards without `sonarcloud`.

### Performance

- [ ] The CI-minute cost of the chosen option is estimated against the $0 budget before it lands — the whole point of the decision.

### Security

- [ ] N/A — no runtime surface and no authorization change. The security-adjacent property is supply-chain pin integrity, which is the *subject* of the decision rather than something this story alters.

### UX

- [ ] N/A — no end-user surface. The developer-facing outcome is that a workflow PR's CI behaviour is predictable and documented.

### i18n

- [ ] N/A — CI configuration only; no user-facing strings.

### Observability

- [ ] The detect-changes step already echoes every flag (`pr-checks.yml:191,194`); the chosen behaviour must be visible in that line so a future diagnosis reads one log rather than re-deriving the case statement.

## BDD Scenarios

**Scenario: A workflow-only change behaves as decided**

- **Given** a pull request that changes only a CI workflow file
- **When** the checks run
- **Then** the guard tests either run or are skipped exactly as the recorded decision says

**Scenario: A broken guard is caught, if guards are chosen to run**

- **Given** the decision to run guards on CI-only changes
- **When** someone opens a workflow-only pull request that breaks a guard test
- **Then** the checks fail

**Scenario: A mixed change is unaffected**

- **Given** a pull request touching both a workflow and application code
- **When** the checks run
- **Then** the application code's usual checks all run as before

**Scenario: The residual risk is written down, if skipping is chosen**

- **Given** the decision to keep skipping guards on CI-only changes
- **When** someone reads the story afterwards
- **Then** they find the known gap and its symptom recorded

## Test Plan

**RED first** for whichever branch of the decision is taken.

### Node / Jest (`express-api/tests/scripts/`)

- If guards-run: reinstate a gate guard asserting the chosen flag for `.github/*`, plus `.github/pull_request_template.md` first-match ordering, plus a no-bleed assertion that `APP`/`ANDROID_APP`/`IOS_APP`/`WEB`/`INTEGRATION` stay false.
- If workflow-only: keep SHY-0284's `workflowOnlyFor` pin and add a test documenting that `.github/*` sets no flag **deliberately**, so the next reader knows it is a choice and not an oversight.
- Either way: the `pr-checks-app-changed-split.test.js` harness must observe every flag it asserts on (`SCRIPTS` was added by SHY-0226's merge after shipping uncovered).

### Real-PR proof

- Open a throwaway `.github/**`-only PR and read the actual check list. The YAML
  is not the behaviour; the check list is.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| the chosen `.github/*` case arm removed | the gate assertion for the chosen flag |
| the arm moved after the residual `*.md` arm | the `pull_request_template.md` ordering test |
| `SCRIPTS` dropped from the `WORKFLOW_ONLY` condition | whichever `workflowOnlyFor` test the decision keeps |

### CI-config-only classification

Touches `.github/workflows/**` and `express-api/tests/scripts/**` with no app,
backend or website runtime surface → **CI-config-only** per CLAUDE.md, so it
skips the device/browser gauntlet and runs actionlint, eslint, prettier, the
affected Jest suites, the story validator and `code-reviewer`.

## Out of Scope

- Re-landing SHY-0226's firebase-tools pinning or dependabot changes — those are uncontested and land with SHY-0226 itself.
- Changing what `sonarcloud` or `test-backend` actually do.
- The `SCRIPTS` flag's own definition (SHY-0284's); this story only decides what routes into it.

## Dependencies

- **SHY-0226** — reverted its half of this and is where the residual risk is recorded. Should merge first; this story is the follow-up decision.
- **SHY-0284** — owns the `SCRIPTS` flag and the `workflowOnlyFor` pin this decision must reconcile with.
- **Operator decision required.** The technical options are all cheap; the choice is a CI-cost judgement.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The decision is deferred indefinitely and #1646 recurs | The symptom is recorded on SHY-0226 with the exact diagnosis, so a recurrence costs minutes. This story is the durable record that it is a known, chosen gap. |
| Guards-run is chosen and CI minutes balloon on a $0 budget | Cost is estimated before it lands (Performance AC), and the third option — a narrow guards-only flag that skips sonarcloud — is required to be considered rather than ignored. |
| The YAML is changed and the tests are not, or vice versa | The AC requires they agree, and the real-PR proof reads the actual check list rather than the config. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] The decision and its reasoning are recorded in this story's Notes.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] A real `.github/**`-only PR was opened and its actual check list matches the decision.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`; `actionlint` clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Raised out of SHY-0226's develop merge. The mutual exclusivity is structural, not incidental: `WORKFLOW_ONLY` is defined as the absence of every flag, so "set a flag" and "stay workflow-only" cannot both hold.
- **2026-08-17** — The hole is proven, not theoretical. With SHY-0226's routing briefly in place, `test-backend` ran on a `.github/**`-only diff for the first time and immediately caught a real incompatibility in `develop-ci-gate.test.js`.
- **2026-08-17** — Deliberately P2 and `mvp: false`: it is a CI-cost decision, not launch-blocking. But it should not be lost, because the gap it describes has already cost one broken Dependabot queue.
