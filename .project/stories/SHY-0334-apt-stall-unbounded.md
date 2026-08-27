---
id: SHY-0334
status: Done
owner: claude
created: 2026-08-18
priority: P0
effort: S
type: infra
roadmap_ids: []
mvp: true
released_in: v0.99.0
---

# SHY-0334: A stalled package mirror hangs a build until its budget runs out

## User Story

As a **developer waiting on CI**, I want a stalled package-mirror connection to
fail in seconds and retry, so that a network blip costs me a minute instead of
two hours and a red gate on a PR that is perfectly fine.

## Why

**P0, and it is the reason SHY-0329 did not work.**

Measured twice on 2026-08-18, in two different jobs, with an identical signature:

| Run | apt reaches `archive.ubuntu.com` | job killed | silence |
| --- | --- | --- | --- |
| PR #1782 `Playwright (webkit)` | 00:50:06Z | 02:49:10Z | **119 min** |
| PR #1781 `qa-runner-driver-checks` | 03:30:33Z | 03:54:49Z | **24 min** |

Both fetched the fast repos (microsoft, google) in ~200 ms, reached
`archive.ubuntu.com`, and then emitted **nothing at all** until the job budget
expired. That is a dead socket, not a slow one: **apt has no acquire timeout by
default**, so it waits forever.

**This is why a bigger `timeout-minutes` cannot fix it.** SHY-0329 raised the
driver-checks budget from 10 to 25 on a measured ~10-minute cold install. The
very next run consumed 24m54s of the new 25 and was cancelled at the ceiling. An
unbounded wait consumes whatever budget it is given; the WAIT has to be bounded.
SHY-0329 bought one more attempt — it did not remove the failure mode, and its
story should not be read as if it had.

**It is not confined to one job.** Five steps across four workflows shell out to
apt through Playwright, and every one is equally exposed:

- `qa-runner-driver-checks.yml` — `playwright install --with-deps`
- `manual-qa-matrix.yml` — `playwright install --with-deps`
- `playwright-tests.yml` — `playwright install-deps`
- `deploy-dev.yml` — `playwright install chromium --with-deps` (**two** sites)

**Fixing the caches would not have helped.** `playwright install --with-deps`
shells out to apt *even when the browser cache hits*, so the apt path is not
avoidable by caching. (The cache keys are separately broken — see Out of Scope.)

## Acceptance Criteria

### Happy path

- [x] A stalled mirror connection fails in ~30 s and is retried, rather than waited on indefinitely.
- [x] Every step that invokes apt via Playwright is preceded by the hardening action.
- [x] Every such step carries its own `timeout-minutes`, so even the bounded retry loop cannot consume a job budget.

### Error paths

- [x] A genuinely unreachable mirror still fails the step — the wait is bounded, not removed.
- [x] Removing the hardening from any one site turns exactly one named test RED (mutation-proven).
- [x] Removing a step's `timeout-minutes` turns exactly one named test RED (mutation-proven).

### Edge cases

- [x] A NEW apt site added later is covered automatically — the test discovers sites rather than listing them.
- [x] `playwright install` WITHOUT `--with-deps` never touches apt and is correctly exempt.
- [x] The guard is not vacuous: it asserts at least one apt site exists, so deleting them all cannot make it pass trivially.

### Performance

- [x] Retries make a transient blip cost ~30 s instead of failing the build; a healthy run is unchanged.

### Security

- [x] N/A — bounds network waits. No credential, permission or package-source change. Mirrors are unchanged.

### UX

- [x] N/A — CI-internal. The developer-facing outcome is that a network blip stops presenting as a mysterious 2-hour cancellation.

### i18n

- [x] N/A — no user-facing strings.

### Observability

- [x] The applied config is echoed in the log, so a future reader can confirm the bound was actually in force.
- [x] The action's comment carries both measured incidents, so the next person meets evidence rather than a bare number.

## BDD Scenarios

**Scenario: A network blip no longer costs hours**

- **Given** the package mirror stops responding partway through a build
- **When** the build tries to install what it needs
- **Then** it gives up quickly and tries again instead of waiting indefinitely

**Scenario: A genuinely broken mirror still fails the build**

- **Given** the package mirror cannot be reached at all
- **When** the build tries to install what it needs
- **Then** the build fails and says so, rather than appearing to succeed

## Test Plan

**RED first.** The failing state is measured twice, above, with timestamps.

### Node / Jest — `express-api/tests/scripts/apt-stall-guard.test.js`

- `there IS at least one apt-invoking site — the guard is not vacuous`
- **`apt site <file>:<line> is preceded by harden-apt in its own job`** — per site
- **`apt site <file>:<line> carries its own timeout-minutes`** — per site
- **`apt site <file>:<line>'s job declares an explicit timeout-minutes`** — per site
- **`apt site <file>:<line> has a REACHABLE step timeout (strictly below its job ceiling)`** — per site
- `<Acquire::*::Timeout> is bounded, not merely present` — per directive
- `retries at least once, and not so many times that the wait is unbounded again`
- `discovery primitives` — the parser itself, against synthetic input, with
  `js-yaml` as the oracle for the block-scalar edge case

Sites are DISCOVERED by scanning every workflow, not hardcoded — a sixth apt
site added later fails here rather than hanging on someone's PR.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| `harden-apt` removed from one site | that site's `is preceded by harden-apt` |
| a step's `timeout-minutes` removed | that site's `carries its own timeout-minutes` |
| the action's `Acquire::Retries` removed or set to `0` | `retries at least once...` |
| `Acquire::Retries` raised to `50` (bounded wait × unbounded multiplier) | `...not so many times that the wait is unbounded again` |
| a step's `timeout-minutes` raised above its job ceiling | that site's `has a REACHABLE step timeout` |
| an apt command added inside a multi-line `run: \|` block in ANY workflow | all per-site assertions for the new site |
| the escape skip changed from `i += 1` to `i += 2` | `the escape skip consumes EXACTLY the escaped character` |
| the whole quote machine replaced by `line.split('#')[0]` | 3 quote tests |

### Real-run proof

- The driver-checks job on PR #1781 completes instead of being cancelled, with
  `Driver contract test` actually executing.

### CI-config-only classification

Touches `.github/workflows/**`, a new `.github/actions/**` composite, and a test
under `express-api/tests/scripts/**`. No app, backend or website runtime surface
→ **CI-config-only**.

## Out of Scope

- **Unifying the Playwright cache keys.** Separately broken and worth fixing, but
  it would NOT have prevented this: `--with-deps` runs apt on a cache hit too.
  Three keys disagree today —
  `playwright-${{ runner.os }}-${{ version }}` vs `playwright-browsers-${{ version }}`,
  and the version itself is `require('playwright/package.json').version` in one
  place versus raw `npx playwright --version` in another, which prints
  `Version 1.62.1`. The log shows that leaking verbatim into a key:
  `key: apt-playwright-Version 1.62.1`, space included. Own story.
- Mirror selection / apt-mirrors.txt.

## Dependencies

- None. It unblocks SHY-0328 (#1781), and supersedes the assumption SHY-0329 was
  built on.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A 30 s timeout is too aggressive on a slow-but-working mirror | Paired with `Acquire::Retries "3"`, so a slow fetch retries rather than failing; the healthy path is untouched. |
| A new apt site is added without the guard | The test DISCOVERS sites by scanning; a new one fails immediately. |
| The guard is silently deleted everywhere | Asserted against — the suite refuses to pass with zero apt sites. |

## Definition of Done

- [x] Every AC checkbox above is met.
- [x] Every named test exists, was observed RED first, and is now green.
- [x] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [x] `npm run lint` clean at `--max-warnings=0`; `actionlint` clean under CI's `SHELLCHECK_OPTS`.
- [x] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [x] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [x] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Found because SHY-0329's fix did not work. The driver-checks
  install consumed 24m54s of its new 25-minute budget, versus the 9m53s that
  budget was sized against. Reading the log showed the same
  `archive.ubuntu.com`-then-silence signature as the webkit hang hours earlier.
- **2026-08-18** — Correcting my own earlier claim: SHY-0329 is a stopgap, not a
  cure. Sizing a budget against a single measurement of an unbounded operation
  was the error; one sample of a wait that has no upper bound tells you nothing
  about its worst case.
- **2026-08-18** — Swept all four workflows rather than fixing the one that hurt,
  per the whole-project consistency rule. Five sites, one shared composite action.

- **2026-08-18** — `code-reviewer` round 1: three Importants, all applied. It
  verified the mechanism I was least sure of by reading `playwright-core`'s own
  `coreBundle.js` — the apt call is a bare `apt-get install -y
  --no-install-recommends ...` with no `-o` overrides and no env shadowing, so
  the `apt.conf.d` fragment genuinely takes effect. It also caught a real bug I
  introduced: `timeout-minutes: 15` on steps inside jobs capped at 10 and 12,
  which can never fire. Fixed to 6 and 8, AND the guard now asserts the
  relationship so the class cannot recur.

- **2026-08-18** — Round 2: one Critical, seven Importants. The Critical was
  real and subtle — the job-ceiling lookup walked BACKWARD to the first matching
  line, so a job declaring no `timeout-minutes` would silently borrow the
  previous job's ceiling. `deploy-dev.yml`'s `seed-dev-personas` already has no
  ceiling, so the precondition exists today. Now attributed by CONTAINMENT: job
  ranges are computed, and a miss inside the containing job yields `null`
  rather than a neighbour's number.

  Also real, and worse: `expect(null).toBeLessThan(25)` **passes**, because JS
  coerces `null` to `0`. A step with NO timeout therefore satisfied a test named
  "REACHABLE", going red only because a sibling test happened to catch it. That
  is a lying green inside the guard written to catch lying greens.

- **2026-08-18** — One round-2 finding was NOT a defect, and the test now proves
  why. It suspected a column-6 line inside a `run: |` block would wrongly split
  a step. A block scalar's content must be indented DEEPER than its key, so a
  column-6 line genuinely terminates the block and genuinely starts a new list
  item — `js-yaml` confirms 3 steps for that input, exactly as the line-scan
  reports. Rather than argue, the test now uses `js-yaml` as the ORACLE and
  asserts agreement with it, plus a separate case for content that IS inside the
  block. "Fixing" the parser here would have broken correct code to satisfy a
  wrong expectation.

Reviewed-up-to: d2d7dbd36b8

- **2026-08-18** — Round 5: **merge verdict, zero Critical**. It constructed a
  mutant I had not: changing the escape skip from `i += 1` to `i += 2` survives
  ALL FOUR quote tests, because in those fixtures the over-skip only eats an
  innocuous space. It only misbehaves with zero gap between the escaped quote
  and the real closer. Added, and mutation-verified to catch it.

  It also caught that my "unterminated quote" test passed for a narrower reason
  than its name claimed — its `#` came BEFORE the stray quote, so the ordinary
  truncation path fired and the quote machine was never consulted. Replaced
  with one that genuinely reaches the unterminated state.

  Known follow-up, pre-existing and NOT introduced here: a bare `\#` OUTSIDE
  any quotes is still read as a comment start, since the escape handling only
  runs inside a quoted string. No real apt site uses that shape.
