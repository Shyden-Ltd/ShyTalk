---
id: SHY-0239
status: In Review
owner: claude
created: 2026-07-25
priority: P1
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0009
---

# SHY-0239: Gauntlet v2 — PIN-ready start gate + event-driven self-notify (console + phone) + fail-fast first-failure ping

## User Story

As **the engineer running the release gauntlet detached**,
I want **the run to pause and ping me to confirm the devices are PIN-ready before it dispatches anything, then announce itself — live on the console and to my phone — the moment it completes, fails, or hits the first failure**,
So that **I can prep + unlock the devices, watch the first minute to confirm liveness, then walk away and be pulled back exactly when the run needs me or is done — instead of babysitting a silent multi-hour run or discovering a stall hours later**.

## Why

The grounding investigation (2026-07-25, recorded in `## Notes`) mapped the real primitives and settled two load-bearing facts:

1. **Nothing self-announces today.** Completion is signalled *only* by the `DONE`/`FAIL` filesystem sentinels a human or wrapper must poll (`gauntlet-v2.sh:268/276`). There is no push, desktop, audible, or console self-announce anywhere in the orchestration layer — the placeholder comment at `gauntlet-v2.sh:30` literally reserves it for this story.
2. **The detached device matrix cannot pause mid-run for a human.** The runner is built fully unattended — zero `readline`/`stdin`/prompt primitives across `manual-qa-runner.js` + every driver — and the real PIN problem is solved today by *preparation*, not mid-run pausing: `30-android.sh:70` warns a secure lock *"cannot be dismissed here — disable it for runs"*, and `50-matrix.sh:94` requires the iPhone already unlocked + trusted. Auto-detecting an OS PIN overlay inside the detached matrix would need a driver rewrite — exactly the kind of large, low-payoff change EPIC-0009's Pragmatic decision excludes.

So the achievable, high-value shape of "pause/ping + self-notify" is:

- **A PIN-ready START gate** — the correct place to handle PIN, since the real fix is up-front device prep. Before any device is touched, the run pauses, pings (console + phone), and awaits an explicit confirm — the *"explicit checkpoint fallback where the OS overlay can't be detected"* the epic already anticipates. Bounded, so a walked-away operator can't hang the gate forever (the same liveness discipline SHY-0238 put on matrix-wait).
- **Event-driven self-notify** — the run emits a machine-readable event at each moment that matters (start, pin-wait, pin-ready, first-failure, complete, failed, aborted) to an append-only `events.log` **and** a loud source-prefixed `[notify]` console line (+ terminal bell). The console half is pure bash. The **phone** half is assistant-mediated by the operator's chosen channel (Claude Code app push): the script emits the events; the orchestrating assistant bridges them to the phone via `PushNotification`, driven by the already-sanctioned "detached run + scheduled check" pattern — **one status read per checkpoint, never a polling loop**.
- **A single-shot `--status` reader** — resolves the current run to one line (`complete`/`failed`/`pin-wait`/`running`/`died`) from the sentinels + a `pid` liveness check, so the assistant's per-checkpoint wake is a single cheap read rather than ad-hoc `ls`-ing of sentinels.

This delivers the operator's verbatim intent — *"pause + ping for PIN before start; ping on complete/fail; no token-burning polling"* — without the infeasible mid-run auto-pause.

## Acceptance Criteria

### Happy path
- [ ] When the matrix is dispatched, a **PIN-ready start gate** runs *before* matrix-dispatch (and before android-prep): it writes a `PIN_WAIT` marker (with the readiness reason), emits a `pin-wait` notify (console + event), and blocks until confirmed.
- [ ] On a TTY the gate confirms via an interactive `read` (operator presses Enter); with no TTY (detached) it confirms when a `PIN_READY` token file appears under `RUN_DIR` (touched by the operator or the orchestrating assistant).
- [ ] On confirm, the gate removes `PIN_WAIT`, emits a `pin-ready` notify, and the run proceeds to dispatch.
- [ ] The run emits a `complete` notify (console + event + bell) and writes `DONE` when every step passed; a `failed` notify + `FAIL` when any step failed (SHY-0236 sentinel contract preserved — exactly one of `DONE`/`FAIL`).
- [ ] `gauntlet-v2.sh --status [run_dir]` prints the run's current state on one line — a single word (`complete`/`failed`/`running`/`died`/`unknown`), or `pin-wait<TAB><reason>` for the gate-blocked case so the bridge can surface *what* is needed — and exits 0, defaulting to the `latest-v2` run when no dir is given.

### Error paths
- [ ] If the gate is not confirmed within `PIN_GATE_TIMEOUT` (default 1800s; env-overridable), it removes `PIN_WAIT`, emits an `aborted` notify, and fails the run (non-zero, `FAIL` written) — a gate that never returns is worse than a FAIL.
- [ ] A fatal step (ERR trap) emits a `failed` event before the existing red banner + `FAIL` (SHY-0236 fail-fast contract intact); the notify path in the trap is pure-append and cannot re-enter the trap.
- [ ] An interrupt (SIGINT/SIGTERM) emits an `aborted` event, reaps the overlapped suites (SHY-0238 `on_signal`), and exits `128+signal`.

### Edge cases
- [ ] `--no-pin-gate` (or a frameworks-only `--no-matrix` run) skips the gate entirely — no `PIN_WAIT` written, run proceeds straight to work.
- [ ] **Fail-fast, once:** the *first* recorded step failure emits a single `suite-fail` notify (the phone ping); subsequent failures are console `WARN`s only — no per-failure phone spam. The run still completes best-effort (SHY-0236), the tally still lists every failure.
- [ ] `--status` precedence is honoured: `DONE` ⇒ `complete` even if a stale `PIN_WAIT`/`FAIL` co-exists; `FAIL` ⇒ `failed`; else `PIN_WAIT` ⇒ `pin-wait`; else pid-alive ⇒ `running`, pid-dead-without-sentinel ⇒ `died`.
- [ ] `notify`/`emit_event`/`pin_ready_gate`/`cmd_status` are defined in the library-mode section (above the `GAUNTLET_V2_LIB` early-return) so they are exercisable by the behavioural tests without running the orchestration.

### Performance
- [ ] The gate adds zero measurable overhead to a `--no-pin-gate`/`--no-matrix` run (single guard check, immediate return).
- [ ] `emit_event` is an O(1) append; `--status` is a single-shot read (no loop, no `sleep`) — consistent with "no token-burning polling".

### Security
- [ ] N/A — local dev/QA orchestration tooling. `events.log` records only run-lifecycle event kinds + non-secret detail strings (phase names, suite names, counts); no credentials, tokens, or persona data are written. No network trust boundary, no runtime surface.

### UX
- [ ] Every self-notify is a single loud, colour-distinct `[notify] <event> <detail>` console line (+ terminal bell) so it stands out from the interleaved `[matrix]`/suite streams a watching operator sees.
- [ ] The gate prints a clear, actionable prompt naming exactly what "PIN-ready" means (unlock both devices, disable the Android secure lock, unlock + trust the iPhone) and how to confirm/abort.

### i18n
- [ ] N/A — developer-facing CLI tooling; no user-facing strings, no locale files touched.

### Observability
- [ ] `RUN_DIR/events.log` is an append-only, timestamped, tab-separated audit trail (`<iso-ts>\t<event>\t<phase>\t<detail>`) capturing every lifecycle event, readable post-hoc + parseable by the `--status`/assistant bridge.
- [ ] The `PIN_WAIT` marker's presence + contents are the machine-readable "operator action needed" signal; its removal is the machine-readable "gate released" signal.

## BDD Scenarios

**Scenario: The run pauses + pings before touching any device**

- **Given** a v2 run with the matrix enabled and the PIN gate not disabled
- **When** the orchestrator finishes bringing the stack up
- **Then** before matrix-dispatch it writes a `PIN_WAIT` marker under `RUN_DIR` and emits a `pin-wait` notify to the console + `events.log`
- **And** it does not dispatch the matrix until the gate is confirmed

**Scenario: Detached confirm via the PIN_READY token**

- **Given** a gate blocking with no controlling TTY
- **When** a `PIN_READY` file appears under `RUN_DIR`
- **Then** the gate removes `PIN_WAIT`, emits a `pin-ready` notify, and the run proceeds

**Scenario: The gate refuses to hang forever**

- **Given** a gate blocking with a short `PIN_GATE_TIMEOUT` and no confirm
- **When** the timeout elapses
- **Then** the gate emits an `aborted` notify, removes `PIN_WAIT`, and the run exits non-zero with `FAIL` written

**Scenario: First failure pings once, run continues**

- **Given** a v2 run in which two suites fail
- **When** the failures are recorded
- **Then** exactly one `suite-fail` event is emitted (the first), the run still completes best-effort, and the final tally lists both failures

**Scenario: Completion announces itself**

- **Given** a v2 run where every step passes
- **When** the run reaches the tally
- **Then** it emits a `complete` notify (console + event + bell) and writes exactly `DONE`

**Scenario: Status reader resolves the run to one line**

- **Given** a run dir containing a `DONE` sentinel
- **When** `gauntlet-v2.sh --status <dir>` is invoked
- **Then** it prints `complete` and exits 0
- **And** with only a live `pid` and no sentinel it prints `running`; with a dead `pid` and no sentinel it prints `died`

## Test Plan

**Classification: test-tooling-only.** Confined to `express-api/scripts/gauntlet/gauntlet-v2.sh` + new test files under `express-api/tests/scripts/` — a local dev/QA orchestration harness with no app/backend/website runtime surface. Per the Pre-Merge Protocol tooling exemption (CI-config/tooling), the device/browser gauntlet does not gate this change; the proof is the tooling running correctly + the structural/behavioural pins. The **phone-push leg is proven at the first real v2 run** (the release gate), where the orchestrating assistant bridges the emitted events to `PushNotification` — it cannot be unit-asserted because `PushNotification` is an assistant tool, not a script call.

**Structural pins** (`express-api/tests/scripts/gauntlet-v2-notify-structure.test.js`, new — regex/source over the orchestrator):
- the `pin-ready-gate` phase appears **before** `matrix-dispatch` and before the first `start_overlapped`;
- the gate is guarded by both the PIN-gate flag and the matrix flag (skippable), writes `PIN_WAIT`, and is **bounded** (a `read -t`/timeout path, not an unbounded block) with both a `[ -t 0 ]` TTY branch and a non-TTY `PIN_READY`-file wait;
- `notify`/`emit_event` write to `events.log` **and** a `[notify]` console line;
- the first-failure sites (`wait_overlapped`, `run_logged`, matrix-wait FAIL branch) route through the once-only fail-fast notify;
- terminal notify is wired into the tally (`complete`/`failed`), `on_signal` (`aborted`), and `on_fail` (`failed` event);
- a `--status` subcommand exists, short-circuits **before** the orchestration, and encodes the `DONE>FAIL>PIN_WAIT>running/died` precedence;
- the helpers live above the `GAUNTLET_V2_LIB` early-return; `--no-pin-gate` is parsed.

**Behavioural pins** (`express-api/tests/scripts/gauntlet-v2-notify.test.js`, new — real `spawnSync` in lib mode, the SHY-0236/0238 discipline against real throwaway files/processes):
- `notify` real-appends a parseable `\t`-separated event line to `events.log` and prints `[notify]` to the console;
- `pin_ready_gate` non-TTY happy path: backgrounded, it writes `PIN_WAIT`; after a real `touch PIN_READY` it returns, removes `PIN_WAIT`, and logs `pin-ready`;
- `pin_ready_gate` timeout path: with `PIN_GATE_TIMEOUT=1` and no confirm, it emits `aborted`, removes `PIN_WAIT`, and exits non-zero (run in a subshell so it doesn't kill the harness);
- `pin_ready_gate` skip: with the gate flag off it returns 0 immediately and writes no `PIN_WAIT`;
- fail-fast guard: recording two failures yields exactly one `suite-fail` line in `events.log`;
- `--status` real entrypoint: a temp run dir with `DONE`⇒`complete`, `FAIL`-only⇒`failed`, `PIN_WAIT`-only⇒`pin-wait`, live-pid+no-sentinel⇒`running`, dead-pid+no-sentinel⇒`died`.

**Guards:** `bash -n` on the orchestrator; `eslint --max-warnings=0` + `prettier` on the new JS tests; `shellcheck` clean; `scripts/check-no-new-stubs.js` clean (no doubles — the fixtures are real files/processes the harness drives); `code-reviewer` 100% clean on the diff.

## Out of Scope

- **Mid-run auto-pause** of the detached device matrix for a PIN overlay — needs an unattended-runner/driver rewrite (Pragmatic v2 explicitly OUT); the START gate + pre-disabled secure lock is the sanctioned handling.
- **The `PushNotification` call itself** — an assistant runtime action, not script code; proven at the first real v2 run. The script's testable contract is *emitting the consumable events*.
- **ntfy / script-direct-to-phone channels** — the operator chose the Claude Code app push (assistant-mediated); a script-native push channel is a possible future swap, not this story.
- **Adding a self-detach (`--detach`) to the orchestrator** — the assistant nohup-wraps the foreground script at launch (the sanctioned detach idiom); no new flag needed here.
- Pre-flight smoke + cross-platform real-time coverage (SHY-0240); the overlap core (SHY-0238, done).

## Dependencies

- **SHY-0238** (merged to develop) — this extends the v2 orchestrator: the gate slots before its matrix-dispatch phase, the notify hooks attach to its `on_fail`/`on_signal`/tally, and the helpers live alongside its `start_overlapped`/`run_logged` in the lib-mode section.
- **SHY-0236** (merged) — the `DONE`/`FAIL` sentinel + best-effort-with-tally contract the notify + `--status` build on.

## Risks & Mitigations

- **Risk:** the gate hangs forever if the operator never confirms. **Mitigation:** a bounded `PIN_GATE_TIMEOUT` with an `aborted`+`FAIL` exit — the same liveness discipline SHY-0238 applied to matrix-wait; a behavioural pin drives the real timeout.
- **Risk:** `notify` inside the ERR/signal trap re-triggers the trap or loops. **Mitigation:** the trap uses the pure-append `emit_event` (a guarded `printf >> … 2>/dev/null || true`), no command that can fail-and-re-enter; structural pin asserts the trap wiring.
- **Risk:** every failure pings the phone (notification spam). **Mitigation:** a once-only `NOTIFIED_FIRST_FAIL` guard — only the first failure emits `suite-fail`; a behavioural pin asserts exactly one event after two failures.
- **Risk:** the phone leg is invisible in tests, so a regression could ship silently. **Mitigation:** the script's job is reduced to *emitting a consumable event* (fully tested via `events.log`); the assistant bridge + the first real run's live `PushNotification` are the end-to-end proof, recorded at the release gate.
- **Risk (documented limitation):** because the channel is assistant-mediated, the phone ping only fires when the assistant orchestrates the run; a standalone terminal run gets console-only. **Mitigation:** operator-accepted trade-off (channel chosen 2026-07-25); an ntfy swap remains a clean future option if standalone phone push is ever wanted.

## Definition of Done

- `gauntlet-v2.sh` gains a bounded PIN-ready start gate (TTY + non-TTY confirm), event-driven `notify`/`emit_event` wired into start/gate/first-failure/complete/failed/aborted, and a single-shot `--status` reader — all in the lib-testable section.
- Structural + behavioural pins green (real-execution, SHY-0236/0238 discipline); `bash -n` + `shellcheck` + eslint `--max-warnings=0` + prettier + no-new-stubs clean; `code-reviewer` 100% clean; merged to develop.
- The phone-push leg is exercised end-to-end at the first real v2 run (release gate) and the outcome recorded in `## Notes`.

## Notes

**2026-07-25 — grounding investigation (Explore).** Mapped the primitives before designing (evidence, not guesswork): **Q1** no notification/pause primitive exists anywhere — completion is only the `DONE`/`FAIL` sentinel; `gauntlet-v2.sh:30` reserves self-notify for this story. **Q2** integration surface: `phase()` at `:165`, `on_fail` ERR at `:155-158`, `on_signal` INT/TERM at `:103-107`, tally/sentinel at `:266-279`, CLI parse at `:128-146`; the orchestrator runs foreground and dispatches the *detached* matrix via `50-matrix.sh launch` (`:191`). **Q3** the runner is fully unattended (zero `readline`/`stdin`/prompt in `manual-qa-runner.js` + drivers); the PIN problem is solved by pre-disabling the secure lock (`30-android.sh:70`) + pre-unlocking the iPhone (`50-matrix.sh:94`), so mid-run auto-pause is infeasible without a driver rewrite (out of Pragmatic scope). **Q4** the run dir exposes `log`/`pid`/`DONE`/`FAIL`/`matrix-latest`; there is no machine-readable event stream — so this story introduces `events.log` + `PIN_WAIT`/`PIN_READY` markers as the consumable signals.

**2026-07-25 — channel decision (operator).** Phone channel = **Claude Code app push** (my `PushNotification`), chosen over ntfy/Brevo/console-only. Architectural consequence: the phone leg is **assistant-mediated** — the bash script emits events; the orchestrating assistant bridges them to the phone via the sanctioned "detached run + one scheduled `--status` check per checkpoint" pattern (no polling loop). Active-suppression means the push stays quiet while the operator is in-session and reaches the phone once they walk away — exactly the intended "watch the first minute then leave" behaviour; presence-file tricks are not used ([[project-phone-push-active-suppression-and-presence-file]]). Design honours [[feedback-detached-suites-scheduled-checks]] + [[feedback-scheduled-wakeups-over-monitors]].

**2026-07-25 — implemented.** `express-api/scripts/gauntlet/gauntlet-v2.sh`: added (all in the lib-testable section) `emit_event` (guarded pure-append tab-separated `events.log`), `notify` (event + loud `[notify]` console line + bell), `notify_first_fail` (once-only guard), `pin_ready_gate` (guarded + bounded; TTY `read -t` / non-TTY `PIN_READY`-file wait; writes/clears `PIN_WAIT`), and `cmd_status` (DONE>FAIL>PIN_WAIT>running/died). `phase()` relocated above the lib-return so the gate can set its phase in lib mode. Wiring: gate called after `services` before any device touch; `notify_first_fail` at the three failure sites; `emit_event failed/aborted` in `on_fail`/`on_signal`; `notify complete/failed` in the tally; `notify start` + `echo $$ > pid` at startup; `--status [dir]` short-circuit before the flag loop; `--no-pin-gate` flag; `-h` made range-robust (`sed …/^set -uo/…` — also fixes a pre-existing leak of two code lines into the help). Tests (SHY-0236/0238 real-execution discipline): `gauntlet-v2-notify-structure.test.js` (12 structural pins) + `gauntlet-v2-notify.test.js` (10 behavioural — real `spawnSync`/files: event trail, non-TTY gate release, bounded-timeout abort, skip, once-only fail-fast, and the `--status` precedence incl. live/dead pid liveness). **51 gauntlet-v2 tests green** (SHY-0238's 29 + these 22); the fail-fast guard is mutation-proven (disabling it → 2 events, test goes red). `bash -n` + shellcheck + eslint + prettier + no-new-stubs clean.

**2026-07-25 — pre-self-review catch (before the reviewer).** The gate-timeout path first used `die` (= `printf; exit 1`), but an explicit `exit` does NOT fire the `ERR` trap — so it would exit non-zero WITHOUT `on_fail` writing the `FAIL` sentinel, violating the "FAIL written" AC + the SHY-0236 contract and making `cmd_status` report `died` instead of `failed`. Fixed to `return 1` from the function, so the bare `pin_ready_gate` call fails under `set -e` → `ERR` → `on_fail` writes `FAIL` uniformly (the single sentinel-owner). Added a structural pin that `on_fail` still writes `FAIL` (the dependency the gate's `return 1` relies on).

**2026-07-25 — Code-review R1** (`code-reviewer`, reviewer-before-push gate on the local commit): 2 Critical + 5 Important + minors, ALL applied (fix round self-certified per [[feedback-agent-token-frugality]]).
- **C1 — the non-TTY timeout branch STILL called `die`.** My pre-review `replace_all` matched only the 6-space TTY branch; the 8-space non-TTY branch — the PRIMARY detached path — was missed, so the most-used path failed WITHOUT writing `FAIL` (`cmd_status` → `died`, not `failed`). Fixed: BOTH timeout branches now `touch "$RUN_DIR/FAIL"; return 1` (explicit sentinel = belt; `ERR`→`on_fail` = suspenders; matches gauntlet.sh's proven mid-run idiom).
- **C2 — the `return 1 → ERR → FAIL` mechanism was unverified + untestable in lib mode.** Verified empirically (a bare `return 1` from inside a nested while/if in a function DOES fire an outer `trap ERR` under `set -e` without `errtrace`). Making `FAIL` explicit (C1) also made it provable in lib mode; added a behavioural pin asserting `FAIL` on timeout — **mutation-proven** (drop the `touch` → test goes red, confirming lib-mode can't lean on the ERR trap).
- **I3/I4 — `--status` default (`latest-v2`) + the `MATRIX=0` skip had no behavioural coverage.** Added real tests for both.
- **I5 — a non-integer `PIN_GATE_TIMEOUT` hung the non-TTY loop forever** (the `[ -ge ]` errs every iteration inside an `-e`-exempt `if`, never aborting). Fixed: clamp non-numeric to the default with a loud `warn`; behavioural pin (`PIN_GATE_TIMEOUT=abc` → warns + releases, no hang).
- **I6/I7 — `on_signal`'s new `aborted` event + `emit_event`'s unwritable-`RUN_DIR` guard had no behavioural proof.** Added real tests (drive `on_signal 130` in lib mode → `aborted` in `events.log`; `notify` against a `/nonexistent` `RUN_DIR` → survives, RC 0, console line still printed).
- **Minors (all applied):** event-order pin (pin-wait before pin-ready), missing-detail-arg tolerance, `-h` no-code-leak pin, `--status` AC wording (pin-wait carries a tab-reason), README `PIN_GATE_TIMEOUT` knob row.
- Gates: **58 gauntlet-v2 tests green** (SHY-0238's 29 + these 29 = 12 structural + 17 behavioural); FAIL-on-timeout + the fail-fast guard both mutation-proven; `bash -n` + shellcheck + eslint `--max-warnings=0` + prettier + no-new-stubs clean.

Reviewed-up-to: 125cd34dafae29cfaec2ddba42a899024b4cad3e
