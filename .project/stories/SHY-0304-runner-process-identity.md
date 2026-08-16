---
id: SHY-0304
status: In Progress
owner: claude
created: 2026-08-17
priority: P1
effort: S
type: bug
roadmap_ids: []
---

# SHY-0304: The gauntlet finds runners by name, so it reports and kills the wrong processes

## User Story

As an **operator stopping or cleaning up after a matrix run**, I want the
gauntlet to act on the processes that really belong to that run, so that
**`stop` tells me the truth and `cleanup` never kills something I am using**
instead of matching anything that merely mentions the runner's name.

## Why

Two scripts decide "is this a manual-qa-runner?" by asking whether the string
`manual-qa-runner` appears **anywhere in a process's command line**. That is a
substring test, not an identity test, and it is wrong in both directions.

### Site 1 — `50-matrix.sh:205` reports runs it was not asked about

```sh
leftover="$(pgrep -fl manual-qa-runner 2>/dev/null | grep -v ' grep' | grep -vw "$self" || true)"
```

`cmd_stop` kills correctly — the kill set is scoped to `$run_id` (line 185).
Then it verifies **machine-wide**. So `stop A` returns 1, printing
`runner(s) STILL alive after 3 kill passes`, because run B is running. The run
it was asked about did stop; the message says it did not.

The same line also matches processes that are not runners at all. Sampling
`pgrep -fl manual-qa-runner` at 4 Hz during a `tests/scripts/` run caught the
Jest process, the `npm` wrapper and the invoking shell — all of them matched
because the **test filenames** are on their command lines:

```
43813 node .../jest --forceExit tests/scripts/manual-qa-runner.test.js ...
43791 npm test -- tests/scripts/manual-qa-runner-shard-flag.test.js ...
```

Measured 2026-08-17, `express-api`, macOS 27.0:

| what ran | `50-matrix-cmd-stop.test.js` |
| --- | --- |
| the file alone | **9 passed** (3 consecutive runs) |
| the file + the 5 suites that spawn the real runner | **2 failed** (3 consecutive runs) |

Deterministic, not flaky. The five siblings are
`manual-qa-runner-{shard-flag,dry-run,help-version,smoke-flag}.test.js` and
`manual-qa-runner.test.js`; Jest runs them in parallel workers, they spawn the
real `node scripts/manual-qa-runner.js`, and `cmd_stop` honestly reports what
it was honestly asked to look for. The test is red for a true reason — the
question is wrong, not the answer.

This is a **test-isolation leak** under the repo's HARD rule: a suite whose
result depends on what other suites are doing at the time.

### Site 2 — `qa-cleanup-orphans.sh:113` kills processes that are not runners

```sh
RUNNER_PIDS=$(pgrep -f "manual-qa-runner" 2>/dev/null || true)
SELF_PID=$$
RUNNER_PIDS=$(echo "$RUNNER_PIDS" | grep -v "^$SELF_PID$" || true)
...
echo "$RUNNER_PIDS" | xargs -r kill
```

Same predicate, but this one **kills**, and `clean` is the **default mode** —
`./qa-cleanup-orphans.sh` with no arguments kills. Proven 2026-08-17 with a
decoy whose argv mirrors a real Jest invocation and which is not a runner:

```
$ /bin/bash -c 'exec -a "node jest tests/scripts/manual-qa-runner.test.js" sleep 20' &
$ bash scripts/qa-cleanup-orphans.sh --dry-run
[qa-cleanup]   found runner PIDs: 45969      <- the decoy
```

So running the documented cleanup while the runner's own test suite is running
kills that suite. The existing comment at line 114 anticipates exactly this
("if launched via npm/node ancestry that happens to grep-match") and defends
only against `$$` — not against ancestors, and not against processes that
merely name the runner.

### Site 3 — the run-scoped kill set is also a substring test

`pgrep -f "$run_id"` (line 185) is the right *scope* but still the wrong
*predicate*. `$run_id` is `matrix-<timestamp>-<target>`, and the run's log
lives at `$GAUNTLET_TMP/$run_id/log` — so an operator watching progress with
`tail -f .../matrix-20260817-004500-local/log` is on the kill list and is
`kill -9`'d. Narrower than the other two, same root cause, and it is in the
lines being changed anyway.

### Root cause, once

A process is being identified by **what its command line mentions** rather than
by **what it is**. This repo already learned this rule
([[feedback-pkill-f-matches-your-own-waiters]],
[[feedback-identify-process-by-identity-not-by-port]],
[[feedback-substring-is-not-existence]]) and `50-matrix.sh:186` already applies
it correctly to the file-cached pid. These three sites predate or missed it.

## Acceptance Criteria

### Happy path

- [ ] `stop <id>` exits 0 and reports the run stopped when that run's processes
      are gone, **regardless of what else is running on the machine**.
- [ ] `stop <id>` still kills the run's whole process tree, unchanged.
- [ ] `qa-cleanup-orphans.sh` still finds and kills a genuine orphaned
      `manual-qa-runner.js` process — the capability it exists for.
- [ ] `50-matrix-cmd-stop.test.js` passes alongside the five sibling suites that
      spawn the real runner, in the same Jest invocation.

### Error paths

- [ ] A process belonging to **this** run that survives all three kill passes
      still produces exit 1 and `STILL alive` — SHY-0236's honest-failure
      contract is preserved, not traded away for the fix.
- [ ] The surviving process's pid and command line still appear on stderr, so
      the operator can act on it.
- [ ] A missing pid file still exits 1 with `no pid file`.

### Edge cases

- [ ] A live runner from a **different** run does not change `stop <id>`'s exit
      code, and is reported as a separate, attributed notice rather than
      silently dropped.
- [ ] A process that merely names the runner (Jest, `npm`, a shell, an editor,
      `tail -f` on the run log) is neither reported as a leftover nor killed, at
      any of the three sites.
- [ ] `qa-cleanup-orphans.sh` never kills its own ancestors — the invoking
      shell, `npm`, or a wrapper script.
- [ ] A runner whose path is absolute and one invoked relatively are both
      recognised.
- [ ] A filename that merely *starts with* the runner's name
      (`manual-qa-runner-shard-flag.test.js`) is not treated as the runner.

### Performance

- [ ] The check stays a fixed number of `pgrep`/`ps` calls per invocation — no
      per-process shell-out loop that scales with the process table.

### Security

- [ ] `$run_id` reaches `pgrep` as a single argument and is never interpolated
      into a shell string, so a crafted run directory name cannot inject.
- [ ] The set of pids that receive a signal only ever **shrinks** relative to
      today. No input can make the fixed version kill something the current
      version would spare.

### UX

- [ ] The success line still names the run.
- [ ] "Other runs are still live" is phrased so it cannot be misread as this
      run having failed to stop — that ambiguity is the whole bug.

### i18n

- [ ] N/A — operator tooling, English-only by design.

### Observability

- [ ] The leftover report keeps pid + command line for anything it flags.
- [ ] `--dry-run` in `qa-cleanup-orphans.sh` continues to list exactly what
      `clean` would kill, with no divergence between the two paths.

## BDD Scenarios

**Scenario: stopping one run while another is running**

- **Given** two matrix runs are live
- **When** the operator stops the first
- **Then** it reports that run stopped and exits 0
- **And** it separately notes that another run is still live

**Scenario: a process that only mentions the runner is left alone**

- **Given** a process whose command line names the runner but does not run it
- **When** the operator stops a run or sweeps for orphans
- **Then** that process is neither reported as a leftover nor killed

**Scenario: a genuine survivor is still reported honestly**

- **Given** a process belonging to this run survives every kill pass
- **When** the operator stops that run
- **Then** it exits non-zero and prints the surviving process

**Scenario: a real orphaned runner is still cleaned up**

- **Given** an orphaned runner process from a dead matrix run
- **When** the operator sweeps for orphans
- **Then** that process is killed

## Test Plan

**CI-config-only classification:** confined to operator tooling
(`express-api/scripts/gauntlet/50-matrix.sh`, `express-api/scripts/qa-cleanup-orphans.sh`)
and their tests. No app, backend or website runtime surface, so the
device/browser gauntlet is exempt under the protocol's exemption 2.

**RED first.** Every case spawns REAL processes and runs the REAL shell — the
house pattern already used by `50-matrix-cmd-stop.test.js` and
`qa-cleanup-orphans-pin.test.js`. No doubles: the defect only exists in the
relationship between a real process table and a real `pgrep`.

New — `express-api/tests/scripts/runner-process-identity.test.js`:

- `stop is unaffected by a runner from a different run` — spawn a fixture
  tagged with a DIFFERENT run's id, stop this run, expect exit 0. RED today
  (exit 1).
- `stop ignores a process that only names the runner` — decoy argv
  `node jest tests/scripts/manual-qa-runner.test.js`, expect exit 0. RED today.
- `stop still fails on a survivor belonging to this run` — GREEN today; the
  regression guard that stops the fix becoming "never fail".
- `stop does not kill a tail -f on its own run log` — real `tail -f` on the run
  dir, expect it alive afterwards. RED today.
- `cleanup does not list a process that only names the runner` — `--dry-run`,
  assert the decoy pid is absent. RED today.
- `cleanup does not list its own ancestors` — invoke through a wrapper whose
  argv names the runner, assert the wrapper's pid is absent. RED today.
- `cleanup still lists a genuine runner` — spawn a real
  `node scripts/manual-qa-runner.js --help`-shaped process, assert present.
- `cleanup dry-run and clean agree` — the two modes select the same set.

Amended — `express-api/tests/scripts/50-matrix-cmd-stop.test.js`: the case
`a surviving manual-qa-runner-tagged process → honest exit 1` currently pins
the machine-wide behaviour, i.e. it pins the bug as the contract
([[feedback-tests-can-pin-the-bug-as-the-contract]]). It is rewritten to tag
its fixture with **this run's id**, which preserves exactly what SHY-0236
cared about (never a false "stopped") while dropping the false attribution.
The rewrite is called out in the PR body so it is reviewed as a deliberate
contract change and not waved through as a test fix.

**Mutation checks** — each new assertion must be shown to fail against a
mutant, not merely to pass:

- revert the verification to `pgrep -fl manual-qa-runner` ⇒ the four
  cross-run/decoy cases redden;
- widen the identity predicate back to a bare substring ⇒ the decoy cases
  redden;
- make the verification unconditionally exit 0 ⇒ `still fails on a survivor`
  reddens. This is the specific wrong fix the bug invites
  ([[feedback-mutation-passed-means-investigate]]).

**Isolation proof** — the fix's own acceptance test is the reproduction:
`50-matrix-cmd-stop.test.js` run in the SAME Jest invocation as the five
runner-spawning siblings, three consecutive times, all green. That command is
recorded in the Notes so the next session can re-run it.

**Green** — `cd express-api && npm test -- tests/scripts/`; `npm run lint`
(`--max-warnings=0`); prettier; shellcheck on both changed scripts.

## Out of Scope

- `local/stop.sh`'s `pkill -f "firebase emulators"` and siblings. Swept and
  reviewed: those target long-lived named services during a deliberate
  whole-stack teardown, where machine-wide is the intent rather than an
  accident. Recorded here as a measurement, not an assumption.
- The `adb ... pkill -f uiautomator` calls in `cmd_stop`. They run **on the
  device**, inside `adb shell`, where the process table is the phone's and the
  match is unambiguous.
- Any change to which processes a matrix run spawns.
- Rewriting the sibling suites to stop spawning real runners. They are correct
  — real-only is the repo rule — and "make the neighbours quieter" would leave
  the production defect in place.

## Dependencies

- `express-api/scripts/gauntlet/50-matrix.sh` — sites 1 and 3.
- `express-api/scripts/qa-cleanup-orphans.sh` — site 2.
- `pgrep`/`ps`, whose flags differ between macOS and Linux; the tests run on
  both (developer macOS, CI ubuntu) so the predicate must be portable.

## Risks & Mitigations

- **Risk:** scoping the verification to one run hides a runner from another run
  that is still driving the phone. **Mitigation:** it is not hidden — it is
  reported, attributed to its own run, and only removed from *this* run's exit
  code. The operator gets strictly more information than the current blanket
  failure.
- **Risk:** the identity predicate is too narrow and a genuine orphan escapes
  cleanup. **Mitigation:** `cleanup still lists a genuine runner` spawns the
  real script, and the mutation set proves the predicate is doing work.
- **Risk:** the fix degenerates into "always report success", which would pass
  most of the new tests. **Mitigation:** the survivor case is explicitly kept
  RED-able and the unconditional-exit-0 mutant is required to redden it.
- **Risk:** `pgrep` flag differences make the fix macOS-only.
  **Mitigation:** restricted to flags common to both, and CI runs the suite on
  ubuntu.

## Definition of Done

- [ ] RED tests written and observed failing before any fix.
- [ ] All three sites identify runner processes by identity; the whole-repo
      sweep result is recorded either way.
- [ ] `50-matrix-cmd-stop.test.js` green three consecutive times alongside the
      five runner-spawning siblings in one Jest invocation.
- [ ] Every mutation in the Test Plan proven to redden its test.
- [ ] `qa-cleanup-orphans.sh` proven to still kill a genuine orphan.
- [ ] shellcheck, eslint `--max-warnings=0`, prettier all clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] Status → In Review → judgment-merge → deploy develop to dev.

## Notes (running log)

- **2026-08-17 — filed and reproduced.** Carried over from the 2026-08-16
  handoff, which recorded it as an intermittent cross-file leak. Reproduction
  showed it is **deterministic** when the five runner-spawning siblings are
  co-scheduled (3/3 runs, 2 failures each), and the investigation found two
  further sites the handoff had not identified — including a destructive one,
  `qa-cleanup-orphans.sh`, whose default mode kills.
- Reproduction command:
  ```sh
  cd express-api && npm test -- \
    tests/scripts/50-matrix-cmd-stop.test.js \
    tests/scripts/manual-qa-runner-shard-flag.test.js \
    tests/scripts/manual-qa-runner-dry-run.test.js \
    tests/scripts/manual-qa-runner-help-version.test.js \
    tests/scripts/manual-qa-runner-smoke-flag.test.js \
    tests/scripts/manual-qa-runner.test.js
  ```
- The diagnostic that settled it was sampling `pgrep -fl manual-qa-runner` at
  4 Hz for the duration of the run. Worth reaching for whenever a process-table
  assertion is intermittent: it distinguishes "the thing I am looking for is
  there" from "something that looks like it is there", which no amount of
  re-reading the assertion can.

- **2026-08-17 — `code-reviewer` round 1: 3 Critical, 4 Important, 5 Minor.**
  Every claim was verified before being acted on; three changed the code.

  1. **The tree gate was untested and a plausible regression passed 31/31.**
     Every test wrote a DEAD pid to the run's pid file, so every fixture was
     reached through the orphan path and `_pid_tree` was never driven through
     `cmd_stop`. Narrowing the gate to `runner_pids` — the exact change the
     code comment warns against — survived as a mutant. Now covered by a test
     that builds a real 2-level tree, writes the LIVE parent pid, and uses a
     fixture that is deliberately NOT runner-shaped so the gate is the only
     route by which it can die. Mutant now killed.

  2. **A real parsing bug, found by the test written for the review finding.**
     A `ps` continuation line beginning with digits is shape-identical to a
     new record. Fed `["5150 bash -c ", "99999 node …/manual-qa-runner.js"]`
     the filter reported **99999** — a pid no process owns, on its way to
     `kill` — and MISSED the real 5150. The parse is now anchored on pids that
     actually exist rather than on line shape.

  3. **Two fold tests were decorations.** macOS `ps` renders an embedded
     newline as the escape `\012` and keeps every record on one line, so the
     folding branch is unreachable on this machine: a spawn-a-fixture test
     passed identically with the folding deleted. Both mutants survived. The
     filter was split out (`_runner_filter`, reading records on stdin) so the
     branch can be driven with the record text a `ps` that does emit newlines
     would produce — the real awk program, real record text, no stand-in.

  Also applied: `[ \t]` instead of `[[:space:]]` (Ubuntu CI resolves `awk` to
  mawk, whose POSIX-class support has varied, and an unrecognised class would
  silently match NOTHING on Linux only); `node(js)?` for Debian's binary name;
  `|| true` on the `ps` pipeline so a `ps` failure cannot abort a `set -e`
  cleanup mid-sweep; assertions on the survivor report's PAYLOAD and on the
  success line naming its run; an adversarial run-id injection test.

- **Known limitation, deliberate.** `qa-cleanup-orphans.sh`'s killing branch is
  never executed against a real target anywhere in the suite. It is
  machine-wide by design, Jest runs ~150 suites in parallel, and five siblings
  spawn real runners — so a clean-mode run inside the suite would kill THEIR
  processes, which is the exact interference this story removes. Buying
  coverage by reintroducing the defect is a bad trade. What is enforced instead
  is the property that makes `--dry-run` a faithful preview: the kill branch
  must consume the same variable the report printed and derive nothing of its
  own. Mutant (a kill branch that re-derives its own set) killed.

- **Two harness lessons, both of which produced a false result before being
  caught.** A mutation harness using paths relative to a `cd` silently failed
  to restore and left a mutated production file on disk. And a mutation whose
  `-t` filter matched no test after a rename reported `16 skipped, 16 total`
  and was scored as a SURVIVOR — zero tests ran. The harness now uses absolute
  paths, verifies the restore against git, and fails loudly when a mutation
  runs no tests.

- **Exemption-2 classification, consciously taken.** CLAUDE.md's examples name
  `.github/workflows/**` and CI-only helpers; these are operator-invoked local
  tooling. The exemption's anti-loophole boundary is the deciding text — it
  asks whether the PR touches app (`shared/**`, `app/**`, `iosApp/**`), backend
  (`express-api/src/**`, rules) or website (`public/**`), and this touches none
  of them — and its stated rationale ("no user-observable behaviour to walk")
  applies exactly. Recorded as a judgment, not a rubber stamp.

- Verification after review: full `express-api tests/scripts/` **150 suites /
  7549 tests** green; the reproduction command green **3/3** (2033 tests);
  **7/7 mutants killed**; shellcheck, eslint `--max-warnings=0` and prettier
  clean.
