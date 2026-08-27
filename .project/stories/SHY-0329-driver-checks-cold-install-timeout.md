---
id: SHY-0329
status: Done
owner: claude
created: 2026-08-18
priority: P0
effort: XS
type: infra
roadmap_ids: []
mvp: true
released_in: v0.99.0
---

# SHY-0329: A driver PR cannot merge whenever the Playwright cache misses

## User Story

As a **developer opening a PR that touches the QA-runner drivers**, I want the
driver-checks job to survive a cold Playwright install, so that my PR can reach
a green gate instead of being blocked by a cancellation that has nothing to do
with my change.

## Why

**P0 because it blocks the merge queue, and it blocks it silently.**

Measured live on PR #1781, job `95539346116`:

| Step | Duration |
| --- | --- |
| `Cache Playwright browsers` | **1 second** — a MISS (a hit spends time restoring ~1 GB) |
| `Install Playwright browsers (chromium + firefox + webkit)` | **9m 53s** |
| job cancelled | **10m 16s** |

The job sets `timeout-minutes: 10`. A cold `npx playwright install --with-deps
chromium firefox webkit` needs ~10 minutes on its own, so **on any cache miss
the job is deterministically cancelled** — it is not flaky, it is doomed. The
install had very nearly finished.

**The consequences compound.**

1. Because the job was cancelled, `Driver contract test`, `--check-drivers` and
   the chromium smoke were all **SKIPPED**. The PR's driver changes went
   unchecked by the very job that exists to check them.
2. `PR Gate` (`pr-checks.yml:556`) has `qa-runner-driver-checks` in its `needs`,
   and its evaluation loop treats **`cancelled` exactly like `failure`**
   (`pr-checks.yml:579`). So `PR Gate` fails, and `PR Gate` is one of the three
   required checks on ruleset `19719048`.
3. A re-run does **not** help. The cancellation skips `Post Cache Playwright
   browsers`, so nothing is saved and the next attempt cold-installs again and
   dies in the same place. Retrying is not a workaround here, which is just as
   well — [[feedback-no-auto-retry-workflows]] forbids it as a fix anyway.

So **every PR touching `express-api/scripts/drivers/**` is unmergeable while the
cache is cold.** Confirmed live on two: **#1781** (SHY-0328) and **#1673**
(SHY-0245), both showing the same cancelled job.

**Why not just install fewer browsers.** Tempting — the smoke step is
chromium-only — but `--check-drivers` asserts that chromium, firefox AND webkit
all report `ok` on ubuntu. Dropping two browsers would quietly narrow that
diagnostic's coverage to buy time. The budget is the thing that is wrong, not
the browser set.

## Acceptance Criteria

### Happy path

- [ ] `qa-runner-driver-checks.yml`'s job budget comfortably exceeds a cold install (~10 min) plus the contract test and both diagnostics.
- [ ] A PR touching `express-api/scripts/drivers/**` reaches a conclusive driver-checks result on a cold cache instead of being cancelled.
- [ ] The three steps the job exists to run — contract test, `--check-drivers`, chromium smoke — actually execute rather than being skipped.

### Error paths

- [ ] A genuine hang still terminates: the budget is raised, not removed.
- [ ] Lowering the budget back below the measured cold-install time turns exactly one named test RED (mutation-proven).
- [ ] The pin is expressed against the measured cold-install cost, not a bare literal, so a future step addition that outgrows the budget fails at the test.

### Edge cases

- [ ] A cache HIT still completes far inside the budget — raising the ceiling costs a warm run nothing, since the job ends when its steps end.
- [ ] The browser set is unchanged, so `--check-drivers`' three-browser assertion keeps its current coverage.

### Performance

- [ ] No added cost on the common (warm-cache) path. `timeout-minutes` is a ceiling, not a wait.

### Security

- [ ] N/A — a workflow timeout value. No credential, permission or network surface changes.

### UX

- [ ] N/A — CI-internal. The developer-facing outcome is that a driver PR stops being blocked by an unrelated cancellation.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The next reader can tell a cold-install cancellation from a real failure: the story records the step timings and the 1-second cache-miss tell.
- [ ] The pinning test names the reason in its title, so a future failure explains itself.

## BDD Scenarios

**Scenario: A driver change can be checked even on a slow first run**

- **Given** a developer opens a change to the test-runner drivers
- **When** the automated checks run for the first time that day
- **Then** the driver checks finish and report a real result

**Scenario: A change that breaks a driver is still caught**

- **Given** a driver change that breaks the driver contract
- **When** the automated checks run
- **Then** they report the failure rather than passing

## Test Plan

**RED first.** The failing state is measured, not hypothesised: PR #1781 job
`95539346116`, cache step 1s, install 9m53s, cancelled at 10m16s.

### Node / Jest — `express-api/tests/scripts/qa-runner-driver-checks-timeout.test.js`

- `the driver-checks job declares a timeout at all`
- **`the budget exceeds a cold Playwright install plus the job's own steps`** — the defect in one assertion
- `the browser set still covers all three desktop engines --check-drivers asserts on`

The expected floor is derived from a named constant carrying the measured
cold-install cost, so the test states WHY the number is what it is.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| `timeout-minutes` lowered back to 10 | `the budget exceeds a cold Playwright install...` |
| `timeout-minutes` removed entirely | `the driver-checks job declares a timeout at all` |
| webkit dropped from the install line | `the browser set still covers all three desktop engines...` |

### Real-run proof

- The job reaches a conclusive result on PR #1781's next run, with `Driver
  contract test` actually executing rather than skipped.

### CI-config-only classification

Touches `.github/workflows/qa-runner-driver-checks.yml` and a new test under
`express-api/tests/scripts/**`. No app, backend or website runtime surface →
**CI-config-only**, so no device gauntlet for this change itself.

## Out of Scope

- Aligning the Playwright cache KEY so misses stop happening. **The cause is now
  known, not open** (see Notes): this job keys on
  `playwright-${{ runner.os }}-${{ version }}` while `playwright-tests.yml` —
  which runs on far more PRs and installs the same browsers to the same path —
  keys on `playwright-browsers-${{ version }}`. They can never share an entry.
  Deliberately not fixed here: that change touches three workflows, invalidates
  existing caches, and affects jobs gating most PRs, so it carries a different
  blast radius and earns its own story. This one restores *survivability* now.
- The `publish-unit-test-result-action` 404 blocking #1696/#1651 — different
  job, different cause, its own story.
- Trimming the browser set, which would narrow `--check-drivers`' coverage.

## Dependencies

- None. One workflow value plus its pinning test. It blocks SHY-0328 (#1781) and
  SHY-0245 (#1673), so it lands first.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| A raised ceiling masks a genuine hang | The budget is raised to a measured figure, not removed; a hung job still dies, just later. |
| The number drifts out of date as steps are added | The test derives the floor from a named cold-install constant and asserts headroom, so outgrowing it fails at the test rather than on a PR. |
| Someone "optimises" by dropping browsers | Explicitly asserted against, and in the mutation table. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`; `actionlint` clean under CI's `SHELLCHECK_OPTS`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Found while waiting on PR #1781's gate. `wait-pr-checks.sh`
  reported OVERRUN with `mergeState=BLOCKED`; its exit code was 0, which is
  exactly the false-pass [[reference-wait-pr-checks-helper]] warns about. Reading
  the checks by name showed `qa-runner-driver-checks` CANCELLED.
- **2026-08-18** — Diagnosed from step timings rather than guessed: the 1-second
  cache step is the tell for a MISS, and the install then consumed 9m53s of a
  10-minute budget.
- **2026-08-18** — Confirmed the same cancelled job is blocking #1673, so this is
  a queue-wide blocker rather than one PR's bad luck.
- **2026-08-18** — `code-reviewer` round 1: no Critical. It found the cause-level
  answer this story had listed as an open question. Three independent reasons
  the cache can never hit:

  | | `qa-runner-driver-checks.yml:92` | `playwright-tests.yml:132` |
  | --- | --- | --- |
  | prefix | `playwright-` | `playwright-browsers-` |
  | `runner.os` | present | absent |
  | version source | `require('playwright/package.json').version` → `1.x.y` | `npx playwright --version` → `Version 1.x.y` |

  So the job that would most often warm `~/.cache/ms-playwright` writes to a
  namespace this one never reads. Filed as a fast-follow rather than fixed here.
  It also compounds with this workflow's `cancel-in-progress: true`: a
  fast-iterating PR can cancel itself before a cold run ever self-warms.

- **2026-08-18** — Reviewer findings applied: the workflow readers are now ONE
  shared helper (`express-api/tests/_helpers/qa-runner-driver-checks-workflow.js`)
  instead of a regex duplicated byte-for-byte in two files. Two fragilities in
  that regex were demonstrated rather than argued — `timeout-minutes: 25  # note`
  returned NULL (reddening three tests for a cosmetic edit) and a second job
  earlier in the file returned the WRONG job's number. The helper now scopes to
  the `driver-checks:` job and anchors on exactly four spaces of indent, so a
  STEP-level budget can no longer masquerade as the job's. Nine direct tests
  cover it, including the `null` branch nothing reached before.

- **2026-08-18** — **DoD exception, stated rather than glossed.** The DoD line
  "`cd express-api && npm test` passes" is not literally true right now: the full
  suite carries ONE pre-existing, unrelated red —
  `tests/routes/conversations-coverage.test.js` "handles DND with start <= end"
  passes ALONE (25/25) but fails in-suite, observing an FCM call from a different
  group-message test. Cross-test mock-state leak, order-dependent (green at
  05:0x, red at 06:2x on the same code). Nothing in this diff touches
  conversations, DND, FCM or group messaging. Filed separately; recorded here so
  the gap is auditable instead of silent.

Reviewed-up-to: 78abaa2232a
