---
id: SHY-0243
status: In Review
owner: claude
created: 2026-07-25
priority: P0
effort: S
type: bug
roadmap_ids: []
epic: EPIC-0009
---

# SHY-0243: Two test harnesses lie on Linux CI — make the liveness probe and the git-identity probe environment-honest

## User Story

As **the engineer relying on the develop CI gate to tell the truth about a change**,
I want **the `gauntlet-v2` reap tests and the `serve-web` git-meta test to assert the product's contract rather than the assumptions of the machine they happen to run on**,
So that **every PR into develop is gated on a signal that is real — instead of being blocked by four failures that say nothing about the code under review**.

## Why

SHY-0242 armed the develop ruleset, so **every** develop PR now runs `test-backend` + `sonarcloud`. The first PRs through the new gate (#1668, #1669) went red on four tests that have nothing to do with their diffs. Both harnesses pass on macOS and fail on every Linux runner, for two independent reasons — and in both cases the *product* code is correct:

1. **`gauntlet-v2-overlap.test.js` (3 tests).** The fixture interpolates a unique tag into the `bash -c` script text, then probes liveness with `pgrep -f <tag>`. On Linux the script text **is** the parent's `/proc/<pid>/cmdline`, so `pgrep -f` matches the parent bash itself. `PRE=ALIVE` is therefore a tautology (true even if the fixture never started) and `POST=DEAD` is unreachable. macOS does not expose the `-c` body to `pgrep -f`, which is why it went green locally and has never been green on Linux.
2. **`serve-web-meta-injection.test.js` (1 test).** The test recomputes `git rev-parse --abbrev-ref HEAD` and asserts the result appears as a `<meta>` `content`. GitHub Actions checks out a **detached HEAD**, so that command returns the literal `"HEAD"` — which `local/build-meta.js:70-71` *deliberately* degrades to `null` ("branch unknown, not a branch name") so no `shytalk-git-branch` tag is emitted. The test asserts the exact thing the product is documented to never do.

Both are the same underlying defect: **the test encoded the caller's environment instead of sweeping the contract's class** ([[feedback-parameterized-probe-fixtures]]). Both hid a real coverage hole — a harness that cannot fail is not coverage ([[feedback-verify-the-harness-not-just-the-result]]).

Proven before any code was written (Linux container, real `gauntlet-v2.sh`): `reap_overlapped` and `on_signal` genuinely kill the suite tree, the tail tree and exit `130` on Linux — `POST=DEAD` on all three, with a negative control confirming the probe is not self-satisfying. The product is not broken; only the proof was.

## Acceptance Criteria

### Happy path

- [ ] `gauntlet-v2-overlap.test.js` passes on Linux **and** macOS, with the liveness tag passed through the environment so it never appears in any ancestor's command line.
- [ ] `serve-web-meta-injection.test.js` passes on Linux **and** macOS regardless of whether the ambient checkout is attached or detached.
- [ ] `test-backend` and `sonarcloud` are green on a develop PR that contains only this change.

### Error paths

- [ ] If `reap_overlapped` is neutered (body replaced with `:`), the reap tests **FAIL** on Linux — proving the assertion is load-bearing, not self-satisfying.
- [ ] If `on_signal`'s `reap_overlapped` call is removed, the signal test **FAILS** on Linux.
- [ ] If `build-meta.js` stops degrading detached `"HEAD"` to `null`, the new detached-HEAD test **FAILS**.

### Edge cases

- [ ] A negative control asserts a never-started tag reads MISSING, so a future self-match regression is caught by the harness itself rather than by a confusing red elsewhere.
- [ ] The git-identity test owns its git state: it drives a **scratch repository** it created, covering the attached-branch case and the detached-HEAD case explicitly, instead of inheriting whatever branch the runner happens to be on.
- [ ] A branch name containing shell/HTML-hostile characters still round-trips through `sanitizeLabel`/`escapeAttr` into a well-formed attribute.

### Performance

- [ ] No added sleeps: liveness is polled on the existing bounded `seq 1 60` × 0.05s loops. Total added wall-clock across both suites stays under ~5s.

### Security

- [ ] No secret, token or absolute developer path is written into a probe tag, a log line, or an injected `<meta>` value.
- [ ] The scratch repository is created under `os.tmpdir()` and removed in a `finally`, so no test artefact is left inside the working tree.

### UX

- N/A — test-harness only; no user-facing surface changes.

### i18n

- N/A — test-harness only; no user-facing strings.

### Observability

- [ ] Each probe prints an explicit `PRE=` / `POST=` verdict line so a future CI failure names which side of the reap broke, rather than only showing a regex miss.

## BDD Scenarios

**Scenario: the liveness probe does not count its own parent as the fixture**
- **Given** a fixture that starts a tagged long-running stub through `start_overlapped`
- **When** the harness probes liveness on a Linux runner where the parent's `cmdline` would contain the tag if it were inlined
- **Then** the probe reports `PRE=ALIVE` only because the stub is genuinely running
- **And** a never-started tag reports MISSING in the same run

**Scenario: reaping an overlapped suite really kills the tree**
- **Given** a tagged stub running under an overlapped suite
- **When** `reap_overlapped` runs
- **Then** the tag is gone from the process table within the bounded poll window
- **And** the same assertion FAILS if `reap_overlapped`'s body is emptied

**Scenario: a signal aborts the run and reaps**
- **Given** a tagged stub running under an overlapped suite
- **When** `on_signal 130` runs in a subshell
- **Then** the subshell exits `130`
- **And** the tagged stub is gone from the process table

**Scenario: the served page names the branch when the repo is on one**
- **Given** a scratch repository checked out on a real branch
- **When** an html page is served from it
- **Then** the response carries a `shytalk-git-branch` meta whose content is that branch
- **And** the `shytalk-git-sha` meta matches that repository's short sha

**Scenario: the served page omits the branch when the repo is detached**
- **Given** a scratch repository checked out at a detached commit
- **When** an html page is served from it
- **Then** the response carries **no** `shytalk-git-branch` meta at all
- **And** it still carries the sha and dirty metas, so the watermark degrades to "?" rather than lying

## Test Plan

**Classification: CI-config-only is NOT claimed.** This touches `express-api/tests/**` only — no app, backend or website runtime surface — but it is verified by real execution on the real target platform, not by inspection.

### Red (must fail first)

- `express-api/tests/scripts/gauntlet-v2-overlap.test.js` — the three reap/signal tests, executed on Linux, currently produce `POST=ALIVE` / `TAIL=ALIVE` / `SUITE=ALIVE`. Reproduced in a Linux container against the real `gauntlet-v2.sh` before any edit.
- `express-api/tests/scripts/serve-web-meta-injection.test.js` — a new detached-HEAD case fails before the fix because the existing assertion demands `content="HEAD"`.

### Green

- Both suites pass under `npm test -- tests/scripts/gauntlet-v2-overlap.test.js tests/scripts/serve-web-meta-injection.test.js` on macOS.
- Both suites pass on Linux — proven by the container probe pre-fix (RED) and post-fix (GREEN), and finally by `test-backend` + `sonarcloud` green on the PR.

### Mutation proof

- Empty `reap_overlapped`'s body → reap tests fail on Linux.
- Drop the `rawBranch === "HEAD" ? null : rawBranch` degradation in `local/build-meta.js` → the detached-HEAD test fails.

## Out of Scope

- The `firebase-bom 34.15.0` deprecation breakage (`onNewToken`, `Task<String>.token`) that fails `Build & Test` on #1669 — a real Android API migration, tracked separately.
- Any change to `gauntlet-v2.sh` or `local/build-meta.js` production behaviour. Both were proven correct; this story changes tests only.
- Re-running the device gauntlet: no runtime surface is touched.

## Dependencies

- SHY-0242 (develop CI hard-gate) — the reason these latent failures are now blocking.
- Docker Desktop, for the Linux reproduction of a Linux-only defect.

## Risks & Mitigations

- **Risk:** "fixing" the tests could quietly weaken them into always-green. **Mitigation:** every changed assertion carries an explicit mutation proof (neuter the product function, watch the test go red) plus an in-run negative control.
- **Risk:** the scratch-repo git fixture could inherit ambient `user.email`/`gpgsign` config and fail to commit. **Mitigation:** the fixture sets its own identity and disables signing locally.
- **Risk:** a future harness could reintroduce the self-match. **Mitigation:** the negative control lives in the test run itself, so the regression surfaces as a named failure.

## Definition of Done

- [ ] Both suites green on macOS and on Linux CI.
- [ ] `test-backend`, `sonarcloud`, `Detect Changes`, `Analyze JavaScript`, `PR Gate` green by name on the PR.
- [ ] Mutation proofs recorded verbatim in `## Notes`, showing the MUTANT and the resulting failure.
- [ ] `code-reviewer` 100% clean on the local commit before push.
- [ ] Status flipped to `In Review` before merge.

## Notes (running log)

- **2026-07-25 ~13:00 WIB** — Diagnosed from PR #1668/#1669 CI. Linux container probe against the real `gauntlet-v2.sh` returned `P1_POST=DEAD`, `P2_POST=DEAD`, `P3_RC=130`, `P3_POST=DEAD`, negative control `P4=MISSING` — product code correct, harness at fault. `pgrep -f` self-match confirmed on `ubuntu:24.04` (`PARENT_MATCHED=YES`) and refuted on macOS (`PARENT_MATCHED=NO`).

- **2026-07-25 ~13:30 WIB — RED reproduced, GREEN proven, mutations verified.** Jest cannot run on Linux against this repo's macOS-installed `node_modules` (jest-resolve is backed by `unrs-resolver`; only `@unrs/resolver-binding-darwin-arm64` is present, so `Resolver.findNodeModule` returns `null` for files that exist). The real test files were therefore executed **unmodified** on `node:24` under a minimal jest-globals shim; CI runs its own `npm ci` and is unaffected.

  | Run | Result |
  |---|---|
  | Original `gauntlet-v2-overlap.test.js`, Linux | **8 passed, 3 failed** — `POST=ALIVE`, `TAIL=ALIVE`, `SUITE=ALIVE` (byte-identical to the CI failure) |
  | Fixed, Linux | **11 passed, 0 failed** |
  | Fixed + `reap_overlapped` neutered to `:` | **8 passed, 3 failed** — assertions are load-bearing |
  | Original `serve-web-meta-injection.test.js`, Linux, detached HEAD | **3 passed, 1 failed** — `expected: content="HEAD"` (the CI message) |
  | Fixed, Linux, detached HEAD | **7 passed, 0 failed** |
  | Fixed + detached-HEAD degradation removed from `build-meta.js` | **6 passed, 1 failed** — the detached case catches it |
  | Fixed + `sanitizeLabel`/`escapeAttr` both neutered | **6 passed, 1 failed** — the hostile-branch case catches the breakout |
  | Both suites together, Linux, detached HEAD | **18 passed, 0 failed** |

  MUTANTS verbatim: `reap_overlapped() {\n  : # MUTANT (SHY-0243): reap disabled\n}` · `const branch = rawBranch; // MUTANT (SHY-0243): detached-HEAD degradation removed` · `return String(value); // MUTANT (SHY-0243): sanitiser disabled` + `// MUTANT (SHY-0243): escaping disabled`.

  The detached-HEAD condition was reproduced non-destructively by mounting a file containing a raw sha over `/repo/.git/HEAD` (`git rev-parse --abbrev-ref HEAD` → `HEAD`), leaving the host working tree untouched.

- **2026-07-25 ~13:35 WIB — class sweep.** Grepped the corpus for both defect shapes. `50-matrix-cmd-stop.test.js` matches on `pgrep -P` (parent PID, exact) or probes via `spawnSync` **from Node**, whose argv never carries the tag; `gauntlet-cold-boot-structure.test.js` only pins the script's source text; `prepush-sonar-main-only-gate.test.js` already documents the literal-`HEAD` case; `android-git-identity-pin.test.js` is a structural pin. The self-match trap requires the probe to run *inside* the `bash -c` whose body holds the tag — no other site does. Class confined to the one file.

- **2026-07-25 ~13:45 WIB — status → In Review.** Implementation complete, both suites green on macOS and Linux, lint clean. CI's Pre-Merge Gate (SHY-0127 Gate 1, `scripts/check-pr-story-status.js`) correctly refused the PR while this story sat at `In Progress` — the newly-added exemption covers `Draft` only. Flipped as the protocol prescribes.

  **Review provenance (honest record):** the `code-reviewer` agent was NOT dispatched — this session carries an explicit "do not call the Agent tool unless requested" constraint. Two self-review passes ran instead and both produced findings that were fixed before push (weak negative assertion; tag-prefix collision hazard). `Reviewed-up-to:` is deliberately NOT claimed. An agent review is owed before merge if the operator wants Gate 3 satisfied in the usual way.

- **2026-07-25 ~13:40 WIB — self-review finding (fixed before push).** The first draft of the hostile-branch case asserted `not.toContain('a<b')`, a substring that never existed in the raw refname `feat/a"b<c&d` — a trivially-passing negative. Replaced with the three pairs that genuinely appear in the raw value (`a"b`, `b<c`, `c&d`); mutation-proven above.
- **2026-08-05 07:50 WIB — the owed `code-reviewer` pass ran; Gate 3 now satisfied on merit.** The 2026-07-25 note above deliberately withheld `Reviewed-up-to:` because the agent was never dispatched. The operator authorised the dispatch during the pre-merge check on PR #1697, and it ran over exactly the two files this story contributes (`gauntlet-v2-overlap.test.js`, `serve-web-meta-injection.test.js`).
  **Verdict: no defects in what this story introduces.** The reviewer traced all three fixed probes against the real `reap_overlapped` / `on_signal` / `_pid_tree` implementations in `gauntlet-v2.sh` and confirmed each would genuinely go red if the corresponding production logic were skipped — which is the whole claim this story makes. It also confirmed `makeScratchRepo`'s git-identity isolation genuinely fixes the "asserting a property of the runner, not the product" problem, and that the hostile-branch-name assertions are defence-in-depth rather than vacuous cover.
  **Two coverage gaps found and closed** (commit `b57c3ce02fa`): `reap_overlapped` had no `set -u` empty-state test despite carrying the same two bash-3.2 guards its tested sibling does, and the git-meta contract never exercised `dirty="1"` because every case deliberately keeps the web root outside the repo. Both new tests were mutation-verified — removing the array guard empties stdout (the abort), and pinning `dirty` to `"0"` fails the new assertion — and both production files were restored byte-identical afterwards (`git diff` clean).
  `Reviewed-up-to: b57c3ce02fa`
