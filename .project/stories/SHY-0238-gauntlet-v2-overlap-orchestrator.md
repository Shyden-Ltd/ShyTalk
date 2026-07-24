---
id: SHY-0238
status: In Progress
owner: claude
created: 2026-07-24
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0009
---

# SHY-0238: Gauntlet v2 orchestrator — overlap state-independent suites with the live device matrix + live console streaming

## User Story

As **the engineer running the release gauntlet**,
I want **the device journey matrix to start immediately after the reseed, run visibly live in the console, and have the state-independent framework suites (static analysis + host unit tests) run concurrently with it — while any stack-mutating suite is kept out of the live matrix's way**,
So that **the phones are never sitting idle while the Mac grinds through suites, I can see it working instead of assuming it's dead, and nothing clashes on the shared emulator stack**.

## Why

The grounding investigation (EPIC-0009 Vision) established the real shape of the problem:

- The device matrix is **already** parallel (`manual-qa-runner --matrix --parallel` runs Mac-web ∥ Android ∥ iPhone concurrently, one group per physical device — `matrix-dispatch.js` `Promise.all` over device groups).
- The "Mac runs first, phones idle" pain is the **framework phase** (`gauntlet.sh:133`) running to completion **before** matrix-dispatch (`gauntlet.sh:158`). That serialization — not the matrix — is the bottleneck, and it is exactly the operator's "don't run Mac then phones, run them together."
- On ONE emulator stack, two **stack-coupled** workloads cannot run concurrently without corrupting each other (the per-lane data-isolation rewrite the operator declined). So the overlap must be limited to suites that never touch the emulator stack.

The framework suite inventory (`gauntlet.sh:135-144`) classifies cleanly:

| Suite | Command | Stack contact | Overlap the live matrix? |
|---|---|---|---|
| `gradle-unit-detekt` | `./gradlew testDevDebugUnitTest :shared:jvmTest detekt` | none (host JVM + static) | **YES — safe** |
| `ktlint` | `ktlint --relative` | none (static) | **YES — safe** |
| `eslint` | `npm run lint` | none (static) | **YES — safe** |
| `express-jest` | `npm test` | **wipes emulator Auth/users** | **NO** |
| `playwright-e2e` | `npx playwright test` | mutates shared stack | **NO** |
| `playwright-integration` | `npx playwright test --config=integration` | mutates shared stack | **NO** |

So v2 dispatches the device matrix immediately, overlaps only the three stack-independent suites with it, keeps the three stack-coupled suites in a slot that never overlaps the live matrix, and streams everything live to the console (still writing the run file). Result: devices visibly working from the first minute, the static suites absorbed "for free" into the matrix window, and zero cross-workload clash on the shared stack.

## Acceptance Criteria

### Happy path
- [ ] A v2 run brings the stack up once, reseeds once, then dispatches the device matrix (detached, streaming) **before** running any framework suite.
- [ ] The three stack-independent suites (`gradle-unit-detekt`, `ktlint`, `eslint`) run **concurrently** with the live device matrix.
- [ ] All child output (matrix + overlapped suites) is **streamed live to the console** AND written to the run file (`tee`-style, not file-only).
- [ ] After the matrix + overlapped suites complete, the three stack-coupled suites (`express-jest`, `playwright-e2e`, `playwright-integration`) run in a slot that does **not** overlap the live matrix, each with a reseed where the current gauntlet already requires one.
- [ ] The run ends with an aggregated tally (every suite + the matrix pass/fail) and exactly one `DONE`/`FAIL` sentinel in the advertised `RUN_DIR` (SHY-0236 contract preserved).

### Error paths
- [ ] A failing stack-independent suite is recorded (not fatal) and does not abort the live matrix; it surfaces in the final tally as `FAIL`.
- [ ] A fatal infra step (services / reseed / matrix-dispatch failure) still fails fast via the ERR trap + writes `FAIL` (SHY-0236 contract).
- [ ] If the matrix dispatch itself fails to launch, the overlapped suites are still reaped (no orphaned background suites) and the run writes `FAIL`.

### Edge cases
- [ ] The Auth-wiping `express-jest` suite **never** runs while the device matrix is live (proven: no code path schedules it concurrently with the matrix window).
- [ ] Overlapped background suites are cleaned up on any exit path (success, failure, or Ctrl-C) — no orphaned `gradlew`/`node`/`ktlint` processes (reuses the SHY-0236 tree-reaping discipline).
- [ ] A run with `--frameworks` omitted still dispatches the matrix + streams (the overlap phase is a no-op, not an error).

### Performance
- [ ] Wall-clock for a run with the stack-independent suites is **≤** the equivalent v1 serial run (the static suites overlap the matrix window rather than adding to it); measured + recorded as data, not asserted as a fixed multiplier ([[feedback-first-sample-is-the-fastest-sample]]).
- [ ] No suite runs more than once (the overlap is scheduling, not duplication).

### Security
- [ ] N/A — local dev/QA orchestration tooling; no secrets, no network trust boundary, no runtime surface.

### UX
- [ ] The live console output is readable: each streamed line is prefixed with its source (`[matrix]`, `[gradle]`, `[ktlint]`, `[eslint]`) so interleaved concurrent output is attributable.
- [ ] The final tally names every suite with its pass/fail + its log path (SHY-0236 triage-in-one-glance preserved).

### i18n
- [ ] N/A — developer-facing CLI tooling, no user-facing strings.

### Observability
- [ ] Exactly one of `DONE`/`FAIL` in the advertised `RUN_DIR`; the FAIL path enumerates every failed suite + the matrix verdict.
- [ ] The run file captures the full interleaved output (the console stream is a tee, never a replacement for the file).

## BDD Scenarios

**Scenario: Devices start before the Mac suites**
- **Given** a v2 run with `--frameworks`
- **When** the orchestrator reaches the execution phase
- **Then** the device matrix is dispatched (detached) **before** the first framework suite starts
- **And** the three stack-independent suites run concurrently with the live matrix

**Scenario: The Auth-wiping suite never overlaps the live matrix**
- **Given** a v2 run
- **When** the schedule is inspected
- **Then** `express-jest` (and the two Playwright suites) are scheduled in a window with no live device matrix
- **And** no code path starts them concurrently with the matrix

**Scenario: Live console + file both receive output**
- **Given** a v2 run
- **When** a suite emits a line
- **Then** that line appears on the console (source-prefixed) AND in the run file

**Scenario: An overlapped suite failure is recorded, not fatal**
- **Given** a v2 run where `eslint` fails
- **When** the run completes
- **Then** the matrix + other suites still ran to completion
- **And** the final tally writes `FAIL`, lists `eslint`, and the run exits non-zero

**Scenario: Overlapped suites are reaped on exit**
- **Given** a v2 run with background suites in flight
- **When** the run is interrupted (Ctrl-C) or a fatal step fires
- **Then** no orphaned `gradlew`/`ktlint`/`node` suite processes remain

## Test Plan

**Classification: test-tooling-only.** Confined to `express-api/scripts/gauntlet/**` — a local dev/QA orchestration harness with no app/backend/website runtime surface. Per the Pre-Merge Protocol tooling exemption, the device/browser gauntlet does not gate this change; the proof is the tooling running correctly + the structural/behavioural pins.

**Structural pins** (`express-api/tests/scripts/gauntlet-v2-structure.test.js`, new — regex/AST over the v2 orchestrator source):
- the matrix is dispatched before the first framework suite (ordering invariant);
- exactly the three named stack-independent suites are in the overlap set, and none of `express-jest`/`playwright-*` are;
- the stream is a `tee` to both console and the run file (no file-only redirect on the overlapped/matrix output);
- the exit trap reaps background suite PIDs (reuses the SHY-0236 tree-reap idiom);
- the final tally + `DONE`/`FAIL` sentinel branches are preserved (SHY-0236 invariants still hold).

**Behavioural pins** (`express-api/tests/scripts/gauntlet-v2-overlap.test.js`, new — real `spawnSync` execution, the SHY-0236 pattern, against a stub "suite" + a stub "matrix" so no real stack/devices are needed):
- with a fast stub matrix + stub stack-independent suites, the orchestrator streams both sources' output to the console AND the file, and the matrix's start timestamp precedes the first suite's start timestamp;
- a stub suite that exits non-zero is recorded (tally `FAIL`, non-zero exit) without killing the stub matrix;
- on `SIGINT`, the orchestrator reaps its background stub suites (asserted via `pgrep` going empty — the SHY-0236 zombie-safe liveness check, [[reference-node-spawn-zombie-liveness-check]]);
- a scheduling assertion: the stub `express-jest` slot's start time is strictly after the stub matrix's end time (proves the Auth-wiping suite never overlaps the live matrix).

**Guards:** `bash -n` on the new orchestrator; `eslint --max-warnings=0` + `prettier` on the new JS tests; `code-reviewer` 100% clean on the diff. Real-execution discipline (no stubbed *collaborators* — the stub matrix/suite are throwaway shell fixtures the harness drives for real, exactly like SHY-0236's `sleep` fixtures).

## Out of Scope

- Per-lane data isolation (persona-ID bands, room-id prefixes, per-`.feature` ID rewrites, per-lane global-collection assertion scoping) — EPIC-0009 explicitly OUT (operator's Pragmatic decision).
- Overlapping the **stack-coupled** suites (`express-jest`, `playwright-*`) with the live matrix — impossible on one emulator stack without the isolation rewrite; they stay serialized relative to the matrix.
- Multi-emulator-project lanes.
- Pause/ping + self-notify (SHY-0239) and the pre-flight smoke + cross-platform coverage (SHY-0240) — sibling stories under EPIC-0009.
- Changing the matrix's existing device-group parallelism or the drivers.

## Dependencies

- **SHY-0236** (DONE, merged to develop) — the orchestrator relies on the hardened `cmd_stop` tree-reap + best-effort suites + correct `DONE`/`FAIL` sentinel. The exit-path reaping of overlapped suites reuses the same `_pid_tree` discipline.

## Risks & Mitigations

- **Risk:** an "overlap-safe" suite secretly touches the stack and corrupts the live matrix. **Mitigation:** the overlap set is a fixed allowlist of the three provably static/host suites; adding to it requires a Test Plan justification. A structural pin asserts the exact set.
- **Risk:** the Jest Auth-wipe lands mid-matrix. **Mitigation:** `express-jest` is structurally excluded from the overlap set and scheduled only in a no-live-matrix window; a behavioural pin asserts its slot starts after the matrix ends.
- **Risk:** interleaved concurrent output is unreadable. **Mitigation:** every streamed line is source-prefixed; the file retains the full capture for post-hoc reading.
- **Risk:** background suites orphan on interrupt. **Mitigation:** an EXIT/SIGINT trap reaps the suite PID tree (SHY-0236 idiom); a behavioural pin proves reaping via `pgrep`-empty.

## Definition of Done

- A v2 orchestrator dispatches the device matrix before the framework suites, overlaps exactly the three stack-independent suites with the live matrix, streams live to the console while writing the file, keeps the stack-coupled suites out of the live-matrix window, and ends with an aggregated tally + correct sentinel.
- Structural + behavioural pins green (real-execution, SHY-0236 discipline); `bash -n` + eslint `--max-warnings=0` + prettier clean; `code-reviewer` 100% clean; merged to develop.
- Wall-clock measured + recorded (data, not a policy multiplier).

## Notes

**2026-07-24:** Filed under EPIC-0009 after the grounding investigation corrected the design (persona-slicing lanes dropped as unsound; operator chose Pragmatic v2). This story is the orchestrator core: overlap + streaming. The suite stack-coupling classification (table in `## Why`) is the load-bearing design decision — derived from `gauntlet.sh:135-144` + the "Jest wipes emulator Auth" comment already in the script. Honest scope note: the big ~75-min Playwright suite is stack-coupled, so it cannot overlap the matrix on one stack — the speed win here is the static-suite overlap; the transformative win is devices-immediate + live visibility (+ SHY-0239 self-notify). Sibling stories: SHY-0239 (pause/ping + self-notify), SHY-0240 (smoke + cross-platform coverage).

**2026-07-24 — implemented.** `express-api/scripts/gauntlet/gauntlet-v2.sh` (new): dispatch matrix first (50-matrix launch, detached — it reseeds + preps devices + carries its own `DONE`/`FAIL`), `start_overlapped` the 3 stack-independent suites concurrent with the live matrix, `tail -F` the matrix log to console `[matrix]`-prefixed, `wait_overlapped` + poll the matrix sentinel, then the stack-coupled suites (jest → reseed → playwright×2 → reseed) after the matrix, then android-bdd, then the SHY-0236 tally/sentinel. Streaming = `… | awk '{print p $0; fflush()}' | tee "$logf"` (live console + file). Reap trap (`EXIT INT TERM`) tears down overlapped-suite trees + the tail via a local `_pid_tree` (never the detached matrix). Lib mode (`GAUNTLET_V2_LIB=1`, `${BASH_SOURCE[0]}` for HERE) makes the helpers unit-testable. Tests (SHY-0236 real-execution discipline): `gauntlet-v2-structure.test.js` (15 — reorder ordering, exact overlap allowlist, jest-after-matrix-wait, tee-not-file-only, reap trap, sentinel) + `gauntlet-v2-overlap.test.js` (4 — real `spawnSync` in lib mode: concurrency, PIPESTATUS exit-code preservation [mutation-proven: bare pipeline swallows the exit-3 → 0], console+file streaming, zombie-safe `pgrep` reap). **19 green.** eslint/prettier/shellcheck/`bash -n`/no-new-stubs clean. Wall-clock measurement is owed at the first real v2 run (needs the full stack + devices; SHY-0240 smoke + SHY-0239 PIN pause land first).

**2026-07-24 — Code-review R1** (`code-reviewer`, final reviewer-before-push gate): 2 Critical + 5 Important, ALL applied (fix round self-certified per [[feedback-agent-token-frugality]]; reviewer confirmed the load-bearing isolation invariant — jest/playwright can never start while the matrix is live — holds).
- **C1 — the reorder silently dropped v1's guaranteed pre-jest reseed** (jest ran against post-matrix journey debris; `--no-matrix` had no reseed at all). Restored `phase "reseed-pre-jest"` immediately before `express-jest` + structural pin (reseed-pre-jest < jest).
- **C2 — Ctrl-C/SIGTERM during the overlap phase did NOT abort** (a bare `INT/TERM` trap that only reaps RESUMES the run → marched on into the hours-long matrix-wait). Split the trap: `on_signal` reaps THEN `exit 128+sig`; `EXIT` reaps only. Structural pin (INT/TERM→on_signal, on_signal exits) + behavioural pin (real `on_signal 130` in a subshell → RC=130 + suite reaped).
- **I4 — the `TAIL_PID` reap branch was untested, and testing it surfaced a latent bug**: the real tail is `( tail -F | awk ) &` so `TAIL_PID` is the subshell; a bare `kill $TAIL_PID` orphans the inner `tail -F` (runs forever). Fixed to tree-kill `TAIL_PID` (same `_pid_tree` idiom) + behavioural pin with a grandchild-shaped fixture.
- **I5 — `wait_overlapped`'s `${!OVERLAP_PIDS[@]}` was an unguarded empty-array expansion** (bash-3.2 + `set -u` aborts). Added the `[ "${#…[@]}" -gt 0 ] || return 0` guard + a zero-suite behavioural pin (runs under `/bin/bash` 3.2).
- **I6 — the tee-not-file-only pin matched only ONE of the two call sites**; now extracts `start_overlapped` + `run_logged` bodies and asserts each independently.
- **I7 — CLI flag parsing was untested**; added real-entrypoint behavioural pins (`-h`, unknown-flag die, invalid `--target`, missing `--target` value).
- Deferred (reviewer-tempered, not blocking): a full stubbed-orchestration e2e (F3) — needs a `HERE`-override knob; the first real local dispatch (release gate) is the mitigation. Gates: **29 tests green** (16 structural + 13 behavioural), eslint/prettier/shellcheck/`bash -n` clean. Reviewed-up-to: pending the R1-fix commit (marker added on push).
