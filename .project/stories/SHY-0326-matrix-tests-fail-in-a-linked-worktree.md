---
id: SHY-0326
status: Draft
owner: claude
created: 2026-08-17
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0326: Six gauntlet tests pass in one checkout and fail in another, on byte-identical files

## User Story

As a **developer using git worktrees**, I want the `50-matrix.sh` test suites to
give the same verdict in any checkout, so that a green run means the code is
right rather than that I happened to be in the primary worktree.

## Why

Measured 2026-08-17, same machine, same commit content:

| Checkout | Result |
| --- | --- |
| `/Users/shyden/Developer/Repos/ShyTalk` (primary) | **0 failed, 15 passed** |
| `/Users/shyden/Developer/Repos/ShyTalk-cifix` (linked worktree) | **6 failed, 9 passed** |

The files under test are **byte-identical** — `git diff origin/develop...HEAD`
returns nothing for `runner-pids.sh`, `50-matrix.sh` or their suites on the
branch where it failed. So the code is not the variable. The checkout is.

Failing tests (all in the SHY-0304 / SHY-0236 process-reaping area):

- `a runner belonging to ANOTHER run does not fail this run's stop`
- `a runner from another run is still surfaced, attributed, not silently dropped`
- `a process that only NAMES the runner is not a leftover`
- `does not kill an operator's tail -f on the run's own log`
- `the recorded pid's WHOLE process tree is killed (the tree gate fires)`
- `shell metacharacters in the run directory name cannot execute`
- plus `50-matrix.sh cmd_stop … clean run (dead pid, no live runners)`

**Why this matters more than a local annoyance.** These are the tests that keep
`runner_pids` from killing the wrong process — including an operator's own
`tail -f`. A suite that reports green depending on which directory you ran it
from cannot be trusted to be red when the reaping logic actually breaks. That is
the "green suite that could never be red" failure mode, one layer up: here it
*can* be red, but whether it is depends on the checkout.

An environmental cause was ruled out: a stray Appium server was killed and the
failures persisted in the worktree and stayed absent in the primary tree.

**Most likely cause, to be confirmed not assumed:** these suites shell out and
resolve paths from the repo root, and a linked worktree's `.git` is a *file*
pointing elsewhere rather than a directory. Anything deriving a path from
`.git`, `git rev-parse --show-toplevel`, or a hard-coded relative hop will differ.

## Acceptance Criteria

### Happy path

- [ ] The SHY-0304 and SHY-0236 suites give an identical verdict in the primary worktree and in a linked worktree.
- [ ] The root cause is identified and named in Notes — not worked around by pinning the tests to one checkout.

### Error paths

- [ ] A genuinely broken `runner_pids` predicate fails the suite **in both checkouts**, proven by the same mutation applied twice.
- [ ] A missing prerequisite (absent script, absent `node_modules`) fails loudly with a message naming what is missing, rather than producing a confusing assertion failure.

### Edge cases

- [ ] The suites pass from a worktree whose path contains a space or a shell metacharacter (they already assert this for the run directory; the checkout path deserves the same).
- [ ] The suites pass when the worktree is on a branch whose name differs from the primary's.
- [ ] Running both checkouts' suites concurrently does not make either fail — process-reaping tests are the most likely place for cross-talk.

### Performance

- [ ] No added runtime beyond what the fix requires; these suites already run in the ordinary `tests/scripts` sweep.

### Security

- [ ] The fix must not widen what `runner_pids` matches. Any change to the identity predicate re-runs the full SHY-0304 mutation table, because a broader match means killing an innocent process.

### UX

- [ ] N/A — developer-facing test infrastructure with no end-user surface.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] When a prerequisite is missing, the failure message says which one and where it looked.
- [ ] The suites log the resolved repo root they are operating on, so a future checkout-dependent divergence is one log line to spot rather than an afternoon.

## BDD Scenarios

**Scenario: The same tests give the same answer in a second checkout**

- **Given** two checkouts of the same code on one machine
- **When** the gauntlet stop tests run in each
- **Then** both report the same result

**Scenario: A broken reaper is caught wherever it runs**

- **Given** a deliberately broken process-identification rule
- **When** the tests run in either checkout
- **Then** both report a failure

**Scenario: A missing prerequisite says what is missing**

- **Given** a checkout without the script the tests exercise
- **When** the tests run
- **Then** the failure names the missing file

**Scenario: An operator's own log viewer is never killed**

- **Given** an operator watching a run's log
- **When** the stop routine runs in either checkout
- **Then** the operator's log viewer keeps running

## Test Plan

**RED first — and the RED here is reproducing the divergence deliberately.**

### Reproduce, then diagnose

1. `git worktree add` a second checkout at the same commit.
2. Run `npx jest tests/scripts/ -t "SHY-0304"` in both; capture both verdicts.
   That divergence is the failing test this story starts from.
3. Instrument the resolved repo root / script path in each and diff them. Do not
   guess the cause; print it.

### Node / Jest (`express-api/tests/scripts/`)

- The existing SHY-0304 and SHY-0236 suites, unchanged in intent, made checkout-independent.
- New: `resolves its script path from the git common dir, not a relative hop` (or whatever the diagnosis shows).
- New: `fails with a named message when the script under test is absent`.
- New: `passes from a checkout path containing a space`.

### Mutation proof — run in BOTH checkouts

The whole point of the story is that a verdict must not depend on the checkout,
so every mutation is applied twice:

| Mutation | Must kill, in BOTH checkouts |
| -------- | --------- |
| `runner_pids` matches any process merely NAMING the runner | `a process that only NAMES the runner is not a leftover` |
| the ancestor-exclusion dropped | `does not kill an operator's tail -f on the run's own log` |
| the tree gate removed | `the recorded pid's WHOLE process tree is killed` |
| run-id scoping removed | `a runner belonging to ANOTHER run does not fail this run's stop` |

### Concurrency check

- Run the suites in both checkouts simultaneously and assert both pass — the
  cross-talk case these tests are uniquely exposed to.

### CI-config-only classification

Touches `express-api/tests/scripts/**` and possibly
`express-api/scripts/lib/runner-pids.sh` / `scripts/gauntlet/50-matrix.sh`.
These are CI/QA tooling with no app, backend or website runtime surface →
CI-config-only, so no device gauntlet; full non-device suite plus
`code-reviewer`.

## Out of Scope

- Changing what the gauntlet's stop routine actually does. This story makes the
  existing tests trustworthy, not the reaping logic different — and the Security
  AC forbids widening the predicate as a side effect.
- The linked-worktree workflow itself; multiple worktrees are legitimate and
  already in use (`ShyTalk-cifix`).
- Any other suite's worktree portability, unless the diagnosis shows a shared
  helper is at fault — in which case the fix is shared and the sweep is in scope.

## Dependencies

- **SHY-0304** — owns `runner-pids.sh` and the identity predicate these tests
  cover. Its mutation table is the regression guard this story must not weaken.
- **SHY-0236** — owns `cmd_stop`'s honest-stop verification.
- None blocking; this can be picked up at any time.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| "Fixed" by making the tests skip outside the primary worktree | Explicitly forbidden by the Happy-path AC: the root cause must be named, and the mutation table must kill in **both** checkouts. A skip would satisfy neither. |
| The fix widens `runner_pids` and it starts killing innocent processes | Security AC requires re-running the full SHY-0304 mutation table on any predicate change. This is the one failure mode with real consequences. |
| The diagnosis is guessed rather than measured | The Test Plan's step 3 requires printing the resolved paths in both checkouts and diffing them. |
| The same latent fault exists elsewhere and is missed | If a shared helper is implicated, the sweep is explicitly in scope, per this repo's consistency rule. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] The divergence is **reproduced** in two checkouts before any fix, and the root cause is named in Notes with the evidence that identified it.
- [ ] The SHY-0304 and SHY-0236 suites give identical verdicts in both checkouts.
- [ ] Every mutation in the table killed its named test **in both checkouts**.
- [ ] The SHY-0304 mutation table still passes in full — the predicate is no wider than before.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Found while running the guard suites for SHY-0226 in the `ShyTalk-cifix` linked worktree. 6 failed / 9 passed there; 0 failed / 15 passed in the primary tree, on byte-identical files. Not a develop regression and not SHY-0226's doing.
- **2026-08-17** — An environmental cause was ruled out rather than assumed: a stray Appium server was killed and the split persisted. The variable is the checkout.
- **2026-08-17** — Filed rather than chased, because SHY-0226 was already three layers deep in reconciling stale designs. The leading hypothesis (a linked worktree's `.git` is a file, not a directory, so any path derived from it differs) is recorded as a hypothesis, not a finding.
