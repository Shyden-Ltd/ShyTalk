---
id: SHY-0255
status: In Progress
owner: claude
created: 2026-07-30
priority: P0
effort: S
type: bug
roadmap_ids: []
epic: EPIC-0003
---

# SHY-0255: The journey runner reports success for runs that never happened

## User Story

**As a** developer trusting the gauntlet to gate a merge
**I want** a matrix cell that did not actually complete its journeys to be reported as a failure
**So that** "the gauntlet is green" means the journeys ran and passed, rather than the runner having quietly stopped existing.

## Why

Surfaced 2026-07-30 from gauntlet run `20260730-005554-local`.

The Mac entered `Clamshell Sleep` on battery at 05:26. USB suspended, so the
Android device and the iPhone both disappeared mid-run. Three cells —
`firefox`, `webkit`, `edge` — each burned ~2 hours doing nothing, printed 12
`FAIL` lines and no further output, and were recorded by the matrix as:

```
[matrix] ← firefox: pass (7200524ms)
[matrix] ← webkit:  pass (7200247ms)
[matrix] ← edge:    pass (8724357ms)
```

The per-cell log header agrees: `## browser=webkit outcome=pass`, directly
above twelve `FAIL` scenarios.

**Root cause — success is the runner's default exit state.** `main()` ends
with `process.exit(allFindings.length > 0 ? 1 : 0)`
(`manual-qa-runner.js:16420`), but nothing guarantees that line is reached.
When a driver call never settles (a device that went away), the awaited
promise stays pending, the event loop drains, and **Node exits 0** — proven
directly:

```
$ node -e 'const p=new Promise(()=>{}); (async()=>{ await p; })();' ; echo $?
0
```

`matrix-dispatch.js:193` classifies on `outcome = result ? 'pass' : 'fail'`
where `result` is `code === 0` (`matrix-cell-dispatch.js:179`). So a cell that
died halfway through feature file 2 of 20 is indistinguishable from a cell
that passed all 20.

The cell timeout did not save it either: `timedOut` requires
`code === null && signal === 'SIGTERM'` (`matrix-cell-dispatch.js:136`), and
these children exited 0 of their own accord before any SIGTERM landed.

**A second instance of the same defect class** is reproducible in one command
— a cell that matched *zero* feature files also reports success:

```
$ node express-api/scripts/manual-qa-runner.js --target local --browser chromium \
    --plan-dir <empty-dir>; echo $?
Running 0 feature file(s) against local (http://localhost:3000)
Findings: 0
0
```

A mistyped `--plan-dir`, a corpus glob regression, or a `--journey` naming a
file that no longer exists therefore greens the entire matrix.

Both are the same bug: **absence of work is reported as success.**

## Acceptance Criteria

### Happy path

- [ ] A cell that runs every feature file and records zero findings still exits 0 and is classified `pass`.
- [ ] A cell that runs every feature file and records findings exits 1 and is classified `fail`.

### Error paths

- [ ] A run whose event loop drains before `main()` reaches its explicit exit terminates non-zero, so the matrix classifies it `fail`, never `pass`.
- [ ] That run prints a distinct, greppable `RUNNER_INCOMPLETE` diagnostic naming the condition, so the cause is visible in the cell log without re-running.
- [ ] A run that matched zero feature files terminates non-zero with a distinct `RUNNER_NO_FEATURES` diagnostic naming the resolved plan dir.
- [ ] A `--journey` naming a file that does not exist terminates non-zero rather than reporting a clean sweep of nothing.
- [ ] The existing crash contract is unchanged: runtime error → exit 2 `RUNNER_CRASH`; driver-init failure → exit 3 `DRIVER_INIT_FAILED` → cell `skip`.

### Edge cases

- [ ] `--list`, `--help`, `--version`, `--dry-run` and an empty `--shard` still exit 0 — they are complete runs of a non-journey mode, not incomplete journey runs.
- [ ] The incomplete marker is distinct from `DRIVER_INIT_FAILED` (3), so a drained run is never downgraded to `skip` and silently tolerated.
- [ ] A run that completes with findings keeps exit 1 — the incomplete marker must not mask the ordinary failure code.

### Performance

- [ ] The guard is two assignments and one `beforeExit` listener; no measurable cost on a run that already takes minutes.

### Security

- [ ] N/A — no authorization, input, or data-exposure surface changes; only the process exit code and two stderr diagnostics.

### UX

- [ ] The operator reading a cell log can tell "this cell died" from "this cell failed its assertions" without opening the matrix report.

### i18n

- [ ] N/A — runner diagnostics are developer-facing English, consistent with every other `[runner]` message.

### Observability

- [ ] `RUNNER_INCOMPLETE` and `RUNNER_NO_FEATURES` are greppable literals on stderr, matching the existing `RUNNER_CRASH` / `DRIVER_INIT_FAILED` convention.

## BDD Scenarios

**Scenario: a cell loses its device mid-run**
- **Given** a journey runner part-way through its feature files
- **When** the driver call it is waiting on never settles and the process runs out of work
- **Then** the runner exits non-zero and the matrix records the cell as failed, not passed

**Scenario: the operator can see why a cell died**
- **Given** a cell that ended without completing its run
- **When** the operator reads that cell's log
- **Then** a `RUNNER_INCOMPLETE` line explains the run ended before finishing

**Scenario: a plan directory with no journeys**
- **Given** a plan directory containing no feature files
- **When** the runner is pointed at it
- **Then** it exits non-zero with `RUNNER_NO_FEATURES` instead of reporting a clean run

**Scenario: a genuine clean run is still green**
- **Given** a plan directory whose journeys all pass
- **When** the runner completes every file
- **Then** it exits 0 and the cell is classified `pass`

**Scenario: a genuine failing run is still a failure**
- **Given** a plan directory whose journeys produce findings
- **When** the runner completes every file
- **Then** it exits 1 and the cell is classified `fail`

## Test Plan

**RED first** — `express-api/tests/scripts/manual-qa-runner-incomplete-exit.test.js`
(new; real spawned processes, no doubles — same shape as the existing
`manual-qa-runner-driver-init-exit.test.js`):

- `a drained event loop exits with the incomplete marker, not 0` — spawns a real
  child that loads the real guard module and then genuinely drains, reproducing
  the proven Node behaviour rather than simulating it.
- `the drained run prints RUNNER_INCOMPLETE on stderr`
- `an empty plan dir exits non-zero with RUNNER_NO_FEATURES`
- `a --journey naming a missing file exits non-zero`
- `the incomplete code is not DRIVER_INIT_FAILED` (a drained cell must not be
  downgraded to `skip`)
- `--list still exits 0` (complete run of a non-journey mode)
- `--dry-run still exits 0`

Plus `express-api/tests/scripts/matrix-dispatch.test.js` — extend with
`a cell exiting the incomplete code classifies fail, not pass/skip`.

Existing `manual-qa-runner-driver-init-exit.test.js` must stay green unchanged
(exit 2 / exit 3 contract preserved).

**GREEN:**
1. Seed `process.exitCode = EXIT_RUNNER_INCOMPLETE` before `main()` so falling
   off the end can never be 0; every genuine completion path already calls
   `process.exit()` explicitly and overrides it.
2. A `beforeExit` listener (fires only on drain, never on explicit `exit`)
   prints the `RUNNER_INCOMPLETE` diagnostic.
3. Guard the feature-file list: zero executed files → `RUNNER_NO_FEATURES`,
   non-zero exit.

**Mutation checks:**
- Removing the `process.exitCode` seed must fail the drained-loop test.
- Changing the seed to 0 must fail it.
- Changing the seed to 3 must fail the not-`DRIVER_INIT_FAILED` test.
- Removing the zero-files guard must fail the empty-plan-dir test.
- Reverting `process.exit(allFindings.length > 0 ? 1 : 0)` must still leave the
  genuine-failure test red, proving that test is not tautological.

## Out of Scope

- Per-feature-file timeouts so a hang fails fast instead of consuming the cell
  budget — real, but a separate change with its own budget-calibration
  question; filed separately rather than bundled here.
- The `--cell-timeout=7200` policy value in the launcher.
- Preventing host sleep during a gauntlet (launcher precondition, not runner).
- Re-classifying cells whose child ignores SIGTERM (`matrix-cell-dispatch.js:136`).

## Dependencies

- None. `EXIT_DRIVER_INIT_FAILED` already lives in `matrix-dispatch.js`; the new
  codes sit beside it.

## Risks & Mitigations

- **Risk:** an existing legitimate path returns from `main()` without calling
  `process.exit`, and would now exit non-zero.
  **Mitigation:** every exit path is enumerated in the RED tests (`--list`,
  `--help`, `--version`, `--dry-run`, empty shard, health-check, matrix,
  single-cell); each is pinned green.
- **Risk:** a distinct incomplete code is treated as `skip` by some caller and
  silently tolerated.
  **Mitigation:** a test asserts the code is not `EXIT_DRIVER_INIT_FAILED`, and
  a matrix-dispatch test asserts the resulting cell classifies `fail`.
- **Risk:** the zero-files guard fires on a legitimately-empty shard.
  **Mitigation:** shard emptiness exits earlier at its own `process.exit(0)`;
  pinned by an explicit test.

## Definition of Done

- [ ] RED tests written first and observed failing.
- [ ] A drained run exits non-zero with `RUNNER_INCOMPLETE`.
- [ ] A zero-feature-file run exits non-zero with `RUNNER_NO_FEATURES`.
- [ ] Exit 2 / exit 3 contracts unchanged.
- [ ] Mutations killed.
- [ ] `cd express-api && npm test` green.
- [ ] `code-reviewer` 100% clean.
- [ ] Gauntlet re-run on real Android + real iPhone + all browsers with the
      fixed harness, and its verdict trusted only because of this fix.

## Notes

- 2026-07-30 — Found while reading gauntlet run `20260730-005554-local`, which
  reported `firefox: pass`, `webkit: pass` and `edge: pass` for cells that had
  each printed 12 `FAIL` scenarios and then nothing for two hours. The host had
  gone into clamshell sleep on battery at 05:26 and taken both devices with it.
  The sleep is the trigger; the reported `pass` is the defect. Every previous
  "green" matrix result in this repo is retrospectively suspect for the same
  reason.
