---
id: SHY-0069
status: In Progress
owner: claude
created: 2026-06-09
priority: P0
effort: S
type: infra
roadmap_ids: []
pr:
---

# SHY-0069: Pin local Node to CI version + pre-push hook observability + watchman config

## User Story

As the ShyTalk maintainer, I want the local toolchain pinned to CI's Node major with a fail-fast guard, observable pre-push hook output, and a committed watchman config, so that environment drift can never again silently wedge local verification (2026-06-09: brew's floating `node` → 26.3.0 hung every full Jest run for ~2h of diagnosis).

## Why

On 2026-06-09 19:38 brew silently upgraded `node` to 26.3.0 during an unrelated cask install. Every full express-api Jest run after that wedged at 0% CPU with no output and no timeout (`--experimental-vm-modules` implicated); the same 316-suite/11,787-test run passes in ~113s on node@24 (CI's version). Diagnosis took hours partly because the pre-push hook discards the Jest step's stderr (`2>/dev/null`). Separately, watchman had recrawled the repo watch 77× over the 13GB `build/` tree (no `.watchmanconfig`). Three real fixes, all currently machine-local only — this story commits them to the repo.

## Acceptance Criteria

### Happy path
- [ ] `.nvmrc` at repo root contains `24` (matches the `node-version: 24` used by the Express-API and Playwright workflows; `sync-roadmap-data.yml` intentionally uses node 20 for its mjs script — aligning it is out of scope).
- [ ] `express-api/package.json` gains `"engines": { "node": ">=24 <25" }`. The field is advisory (enforcement via `npm config engine-strict` is out of scope); it emits an npm warning on install when the running node major is outside the range.
- [ ] New `scripts/check-node-version.sh`: reads `.nvmrc`, compares against `node -v` major; exit 0 on match with no output; exit 1 with a one-line actionable message (current vs expected, `brew link node@24` hint) on mismatch; exit 2 with message if `.nvmrc` is missing/unreadable/non-numeric; exit 3 with message if `node` is not on PATH.
- [ ] `.husky/pre-push` invokes `scripts/check-node-version.sh` BEFORE the Express-tests step and aborts the push on non-zero exit.
- [ ] `.watchmanconfig` committed at repo root with `ignore_dirs`: `.gradle`, `build`, `shared/build`, `androidApp/build`, `iosApp/build`, `express-api/coverage`.
- [ ] The pre-push hook's Jest step no longer discards stderr: `2>/dev/null` removed so failures/warnings reach the operator.

### Error paths
- [ ] Node major mismatch (e.g. 26 vs `.nvmrc` 24): push aborts within 1s at the guard, BEFORE any test runs, with the actionable message on stderr.
- [ ] `.nvmrc` deleted/garbage content (`abc`): guard exits 2 with `unreadable .nvmrc` message; push aborts (fail-closed, never fail-open).
- [ ] `node` not on PATH: guard exits 3 with a `node not found` message; push aborts (fail-closed).

### Edge cases
- [ ] `.nvmrc` with `v24`, `24.16.0`, trailing whitespace/newline variants all normalise to major `24` and pass against node v24.x.
- [ ] Guard works when invoked from any directory within the repo's work-tree (resolves `.nvmrc` via `git rev-parse --show-toplevel`); it does NOT need to work outside a git work-tree (exit 2 or 3 there is acceptable, fail-closed).

### Performance
- [ ] Guard adds <1s to pre-push (single `node -v` + file read; no subshell pipelines beyond that).

### Security
- [ ] N/A — local dev tooling; no secrets, no network, no elevated operations.

### UX
- [ ] Mismatch message names BOTH versions and the exact remediation command — operator can fix without reading the script.

### i18n
- [ ] N/A — developer tooling; English-only by repo convention for scripts.

### Observability
- [ ] The `.husky/pre-push` line invoking the Jest coverage run contains no `2>/dev/null` (machine-verified by the hook-wiring test case asserting the Jest step line does not match `/2>\/dev\/null/`).
- [ ] Guard's failure message includes the string `node-version-guard` for greppability in push logs.

## BDD Scenarios

**Scenario: push blocked on Node major mismatch**
- **Given** `.nvmrc` contains `24` and the active `node -v` reports `v26.3.0`
- **When** `scripts/check-node-version.sh` runs
- **Then** it exits 1
- **And** stderr contains `node-version-guard`, `26`, `24`, and `brew link`

**Scenario: guard passes silently on matching major**
- **Given** `.nvmrc` contains `24` and `node -v` reports `v24.16.0`
- **When** the script runs
- **Then** it exits 0 with empty stdout and stderr

**Scenario: fail-closed on unreadable .nvmrc**
- **Given** `.nvmrc` contains `abc`
- **When** the script runs
- **Then** it exits 2 and stderr mentions `.nvmrc`

**Scenario: fail-closed when node is not on PATH**
- **Given** a PATH containing no `node` executable
- **When** the script runs
- **Then** it exits 3 and stderr mentions `node not found`

**Scenario: version-string normalisation**
- **Given** `.nvmrc` contains `v24.16.0` followed by a trailing newline
- **When** the script runs under node v24.x
- **Then** it exits 0

## Test Plan

**Red first** (new file `express-api/tests/scripts/check-node-version.test.js`, pattern: existing `tests/scripts/*.test.js` shell-script harnesses):
- `exits 0 + silent when .nvmrc major matches node major`
- `exits 1 + actionable stderr (node-version-guard, both versions, brew hint) on major mismatch` (mismatch simulated via PATH shim fake `node` printing `v26.3.0`; shim injected via `spawnSync`'s `env` option scoped to that single spawn — never `process.env` globally — to avoid leaking across test workers)
- `exits 2 on missing .nvmrc` / `exits 2 on garbage .nvmrc` / `exits 3 when node absent from PATH (empty-PATH spawn)`
- `normalises v-prefix, full semver, trailing whitespace`
- `resolves .nvmrc from git root when invoked from a subdirectory`
- Hook-wiring assertion: `.husky/pre-push` contains the guard invocation ordered before the Express-tests step; the Jest step line does not match `/2>\/dev\/null/`.

**Green**: implement `scripts/check-node-version.sh`, edit `.husky/pre-push`, add `.nvmrc`, `.watchmanconfig`, engines field.

## Out of Scope

- Enforcing engines via `npm config engine-strict` (advisory only for now).
- CI-side node-version assertions (CI already pins via `actions/setup-node`).
- Pinning other toolchain versions (Java, ruby) — separate stories if drift bites.
- The SonarCloud/AWS-WAF engine-JAR caching work (tracked as [[SHY-0068]]).

## Dependencies

- None on other SHYs. Machine state already pinned (`brew unlink node && brew link --overwrite --force node@24`, 2026-06-09 22:33 BST) — this story makes it durable + portable.

## Risks & Mitigations

- **Risk:** future intentional Node upgrade blocked by guard. **Mitigation:** upgrade = edit `.nvmrc` + engines in the same PR that validates the new version; message says exactly that.
- **Risk:** `.watchmanconfig` changes watch behaviour for other tools (Metro is not used; Jest benefits). **Mitigation:** ignore list contains only generated dirs; verified live since 2026-06-09 21:34 BST with zero recrawls.
- **Risk:** removing `2>/dev/null` makes push output noisier. **Mitigation:** node 24 suite is green; warnings ARE failures per repo policy — visibility is the point.

## Definition of Done

- [ ] All AC checked; new Jest script tests pass red→green; full local gate green on node@24.
- [ ] Reviewer (code-reviewer agent) at ZERO findings before push.
- [ ] PR auto-merged; `status: Done` deferred until next release cut per done-equals-release-cut (`released_in` set then).
- [ ] SHY-INDEX updated in lockstep.

## Notes (running log)

- 2026-06-09 ~23:25 BST — **Reviewer cycle 1 (feature-dev:code-reviewer): 2 findings, both applied.** (Important) `--help` sed range off-by-one leaked `set -euo pipefail` into help output → replaced with `usage()` heredoc per check-large-files.sh convention. (Minor) guard sat inside the HAS_CODE code-only path, skipping config-only pushes → moved to the unconditional guard block before HAS_CODE; hook-wiring test strengthened to assert guard < HAS_CODE < Express-step ordering. Re-verified: 12/12 tests, shellcheck clean, --help clean. ZERO remaining findings.

- 2026-06-09 ~23:10 BST — **Architect verdict: APPROVE-WITH-CHANGES** (feature-dev:code-architect, 7 concerns). Applied: #1 exit-code split (2=.nvmrc unreadable, 3=node missing) + new BDD scenario; #3 CWD claim narrowed to work-tree; #4 corrected node-version claim (sync-roadmap-data.yml uses 20); #5 PATH-shim isolation via spawnSync env; #6 observability AC made machine-verifiable (no-2>/dev/null assertion); #7 engines advisory note. **Rejected #2 ("watchmanconfig already committed") with evidence:** `git status -s` shows `?? .watchmanconfig` — file exists on disk but is UNTRACKED; committing it stays in scope. Story flipped Draft → In Progress.
- 2026-06-09 ~23:00 BST — Authored fully-refined during overnight autonomous run (operator pre-authorized 22:42 BST; architect agent validates in lieu of operator draft-approval). Root-cause evidence in memory `feedback-pin-node-to-ci-version-brew-drift`.
