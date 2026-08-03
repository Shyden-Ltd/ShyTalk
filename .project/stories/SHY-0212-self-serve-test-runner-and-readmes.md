---
id: SHY-0212
status: Draft
owner: claude
created: 2026-07-19
priority: P0
effort: L
type: infra
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0212: Self-serve test foundation — framework registry, one-command runner, plain-English READMEs

## User Story

As a ShyTalk maintainer (and any non-engineer who wants to check the app is healthy), I want **one documented command that runs the whole test suite**, every individual framework runnable from **one documented command of its own**, and a **plain-English README per framework** explaining what it checks and how to read the result — all driven by a single machine-readable **framework registry** — so that nobody needs Claude (or tribal knowledge buried in `CLAUDE.md`) to run our tests, and so the public health page (SHY-0220), CI, and humans all read the same source of truth about "what frameworks exist and how they run."

## Why

The audit (`.project/audit/2026-07-19-testing-frameworks-audit.md`) found the real self-serve gap: every framework has *a* command, but they are scattered across two `package.json` files, `build.gradle.kts`, `xcodebuild` incantations, and ad-hoc `scripts/*`, documented mostly inside `CLAUDE.md` (internal, jargon-dense). There is **no single "run everything" command** and **no per-framework plain-language doc**. This blocks three of EPIC-0008's pillars at once:

1. **Self-serve** — the operator's explicit requirement: "all frameworks need to be able to be easily executed without using Claude to trigger them … must include easy to follow instructions in the readme."
2. **Public transparency** — SHY-0220's health page needs a stable, normalized result feed per framework; today only Allure emits `metadata.json`, and only for the suites wired into it.
3. **Breadth without chaos** — the 13 new-framework stories (SHY-0213…0225) each need a *place to plug in*. A registry + runner they register into keeps the growing suite coherent instead of adding 13 more bespoke commands.

This story is the **keystone** of EPIC-0008: it builds the shared contract (`framework registry`), the aggregate runner, and the docs skeleton the other 13 stories extend. It also does the audit's "remediation" work — make every *existing* framework green-or-provably-env-gated and record an explicit keep/remove decision for each (honoring the operator's "remove any testing framework that is not really giving value").

## Acceptance Criteria

### Happy path

- [ ] A **framework registry** exists at `scripts/test/framework-registry.mjs` exporting an array of typed entries. Each entry has: `id` (kebab, unique), `name` (short human name), `plainName` (non-jargon, e.g. "Voice-room reliability checks"), `category` (`host` | `stack` | `device` | `mac` | `live` — defined in the category AC below), `command` (exact shell string), `cwd` (repo-relative), `readme` (repo-relative path under `docs/testing/`), `resultsDir` (repo-relative dir the runner normalizes results into), `timeoutMs` (per-framework bound), and `publicArea` — **one or more** of (`Safety` | `Sign-in` | `Voice rooms` | `Messaging` | `Payments` | `Cross-cutting`) for the SHY-0220 rollup (a framework may contribute to several user-area cards).
- [ ] Every framework confirmed present by the audit is registered: Kotlin/JVM unit, detekt, ktlint, Express Jest (unit+integration), eslint, prettier, Playwright e2e, Playwright integration, Firestore rules tests, story-frontmatter validator, epic-frontmatter validator, `check-no-direct-backend`, `check-no-new-stubs`, `check-action-shas`, `check-large-files`, `check-no-paid-runners`, `check-workflow-concurrency-scoping`, Android instrumented BDD (`device`), iOS XCTest (`mac` — needs macOS + Xcode; NOT runnable on the ubuntu `host` profile), iOS UI Appium (`device`), manual-QA journey matrix (`device`). **Each is also assigned its `publicArea`(s)** per the attribution AC below (e.g. payments/wallet suites → `Payments`, auth/OTP → `Sign-in`, rooms/LiveKit → `Voice rooms`, messaging → `Messaging`, moderation/age → `Safety`).
- [ ] A **top-level aggregate runner** at `scripts/test/run-all.sh` runs every registered framework filtered by `--profile <host|stack|device|mac|all>` (default `host`), printing a per-framework PASS/FAIL/SKIPPED line and a final summary, exiting non-zero if any selected framework failed. (`live` frameworks are schedule-driven and excluded from `run-all` — see the category AC.)
- [ ] `npm run test:all` (root `package.json`) is an alias for `scripts/test/run-all.sh --profile host` so the documented "one command" works from a clean checkout with no device/stack.
- [ ] `scripts/test/run-all.sh --profile host` runs green on a clean checkout with **no devices and no local stack** (it selects only `category: host` frameworks).
- [ ] For each registered framework the runner writes a normalized `<resultsDir>/metadata.json` with at least `{ id, plainName, publicArea, passed, failed, total, status: "pass"|"fail"|"skipped", startedAt, finishedAt, durationMs }` PLUS an optional, extensible **`details`** object — a documented sub-schema carrying the richer per-framework data consumers emit: severity counts (SHY-0217), per-metric value+budget (SHY-0214), per-area verdicts (SHY-0219), per-locale coverage (SHY-0222), per-screen counts (SHY-0213), the live section (SHY-0224). Unknown `details` keys are tolerated by the consumer (SHY-0220) so a framework can extend the shape without a contract break. `details` carries **no secrets and no PII** (asserted by the registry validator + SHY-0223).
- [ ] `docs/testing/README.md` is a plain-English index listing every framework by `plainName`, one line on what it proves, and its one-command invocation — generated-or-checked from the registry so it can never drift (a `scripts/test/check-readme-in-sync.mjs` gate fails if the index omits a registered framework).
- [ ] `docs/testing/<id>.md` exists for every registered framework: what it checks (plain language), the exact command, how to read a pass vs. fail, and what to do on failure. A non-engineer can follow it.
- [ ] A per-framework **keep/remove decision** is recorded in `docs/testing/framework-value-audit.md` (one row per existing framework: keep + why, or remove + why + the PR that removes it). Honors the operator's "remove low-value frameworks" directive with an explicit, reviewable decision even where the answer is "keep."
- [ ] The five **`category`** values are defined: `host` (runs on a clean checkout — no device, stack, or Mac; the default `--profile host` + the ubuntu CI job), `stack` (needs the local emulator stack up), `device` (needs a real Android/iOS device), `mac` (needs macOS + Xcode — e.g. iOS XCTest/build; cannot run on the ubuntu `host` profile), `live` (schedule-driven against a deployed environment — e.g. SHY-0224 synthetic; excluded from `run-all` profiles and reported into the live feed separately).
- [ ] **publicArea attribution is complete for all five headline cards** (resolves the "empty card" risk). Every registered framework (existing + new) is assigned one or more `publicArea`s, and a documented **`Cross-cutting` → cards fan-out** maps each cross-cutting framework (a11y, perf, security, contract, PII) onto the specific cards it touches — so no headline card is empty. In particular the **Payments** card has ≥1 contributor (the payments/wallet Express suites + the contract/compliance/perf coverage of payment endpoints), and **Sign-in** (auth/OTP suites + contract) and **Messaging** (messaging suites + contract) are likewise populated. The mapping lives once in the registry; a test asserts every one of the five cards has ≥1 contributing framework.
- [ ] A canonical **trend-history store** is defined once — `test-results/trends/<id>.jsonl` (append-only, bounded to the last N runs per framework, compact, no PII) — written by the runner after each run. Every consumer that shows a trend (SHY-0214/0216/0222/etc. + SHY-0220's per-card trend arrow) reads this one store; no story invents its own trend format.
- [ ] `docs/testing/` is the **deliberate public/self-serve documentation home**, distinct from `.project/` (which CLAUDE.md reserves for *internal planning* docs). These READMEs are the discoverable, non-engineer "how do I run + read the tests" surface the operator asked for; siting them at `docs/testing/` rather than `.project/` is an intentional, reviewed exception to the internal-docs convention, recorded here and in `docs/testing/README.md`.

### Error paths

- [ ] `scripts/test/run-all.sh --profile stack` when the local stack is **down** fails fast with a plain message naming the missing service (e.g. "Firestore emulator not reachable on :8080 — run `bash local/start.sh`") and exits non-zero — it does NOT silently skip a `stack` framework and report green ([[feedback-environmental-is-not-a-diagnosis]]).
- [ ] `scripts/test/run-all.sh --profile device` with no real device attached fails fast naming which device is missing (Android / iOS) — never a false green.
- [ ] A registry entry with a duplicate `id`, an unknown `category`, an unknown `publicArea`, or a `command`/`readme`/`resultsDir` pointing at a nonexistent target fails a `scripts/test/check-registry.mjs` validator (exit non-zero, names the offending `id` + field).
- [ ] A framework whose `command` exits non-zero surfaces as `FAIL` in the summary AND propagates to the runner's exit code; a subsequent framework still runs (the runner does not abort the batch on first failure unless `--fail-fast` is passed) so one run reports every failure.
- [ ] `run-all.sh` run through a pipe still reports the true failing exit code — the runner captures each framework's real exit status, never masking it behind a pipe ([[feedback-pipe-swallows-exit-codes]]).

### Edge cases

- [ ] `--profile all` on a host with a stack but no devices runs host+stack, marks each `device` framework `SKIPPED` **with reason "no device attached"**, and (by policy) exits non-zero when a selected-but-unrunnable framework is skipped under `all` unless `--allow-skips` is passed — so "all" can never quietly mean "the runnable subset."
- [ ] A framework that legitimately has zero test cases for the current diff (e.g. a lint with no matching files) reports `PASS total:0`, never `FAIL`.
- [ ] Registry order is deterministic (host → stack → device, then `id` ascending) so runner output and the README index are stable across runs.
- [ ] Running two aggregate runners concurrently against distinct `resultsDir`s does not interleave/clobber `metadata.json` (each framework owns its own dir).
- [ ] A framework `command` that hangs is bounded by a per-framework `timeoutMs` (registry field, default 20 min) after which it is killed and reported `FAIL: timeout` — no unbounded run ([[feedback-no-indefinite-monitors]]).

### Performance

- [ ] `--profile host` full run completes within the current sum of its constituent commands + <10% orchestration overhead (measured: runner wall-clock vs. sum of individual `time` runs).
- [ ] The registry + runner add **zero** new heavyweight dependencies to the host profile (pure Node ESM + bash; no new install for `npm run test:all` to work).
- [ ] Result normalization is streaming/bounded-memory — the runner never buffers a whole suite's stdout to compute pass/fail (parses each framework's own machine output or exit code).

### Security

- [ ] The runner executes only the exact `command` strings from the registry — no interpolation of untrusted input, all variable expansions quoted (shellcheck-clean `run-all.sh`), no `eval` of registry values.
- [ ] `metadata.json` files carry **no secrets and no PII** (counts + timings + ids only) — verified by an assertion in the registry validator and cross-checked by SHY-0223 (PII-leak) once it lands.
- [ ] `check-registry.mjs` rejects a `command` that references a secret-bearing env var by name in a way that could echo it (defense-in-depth; belt with SHY-0223).

### UX

- [ ] Runner output is scannable: aligned `PASS`/`FAIL`/`SKIP` column, plainName, duration; a final `N passed, M failed, K skipped` summary line; failures repeated at the bottom with the one-command to reproduce that single framework.
- [ ] `scripts/test/run-all.sh --help` prints the profiles, what each includes, and an example — non-engineer legible.
- [ ] `docs/testing/README.md` opens with a 3-line "How do I check ShyTalk is healthy?" answer (the one command + where results appear) before any framework detail.

### i18n

- [ ] N/A — developer-and-operator-facing tooling; runner + README are English by CI/repo convention (matches the story-frontmatter validator's English-stderr ruling in SHY-0001). The *public* health page's plain-language + localization is SHY-0220's scope, not this story's.

### Observability

- [ ] Every run writes a top-level `test-results/run-summary.json` aggregating all per-framework `metadata.json` for that run (profile, git SHA, started/finished, totals) — the artifact CI uploads and SHY-0220 reads.
- [ ] Each framework's PASS/FAIL/SKIP + duration is logged with a stable `[framework:<id>]` prefix so CI logs are greppable.
- [ ] The runner's own exit code is deterministic per outcome (0 all-selected-passed; 1 ≥1 failed; 2 usage error; 3 profile-precondition unmet e.g. stack/device missing) and documented in `--help`.

## BDD Scenarios

**Scenario: One command runs the whole host suite on a clean checkout**

- **Given** a fresh clone with no local stack running and no device attached
- **When** I run `npm run test:all`
- **Then** the runner selects only `category: host` frameworks
- **And** it prints a `PASS`/`FAIL` line per framework plus a final `N passed, 0 failed` summary
- **And** it exits 0
- **And** `test-results/run-summary.json` and each framework's `metadata.json` exist

**Scenario: Stack profile fails loudly when the stack is down**

- **Given** the local emulator stack is NOT running
- **When** I run `scripts/test/run-all.sh --profile stack`
- **Then** the runner exits 3
- **And** stderr names the unreachable service and the exact command to start it (`bash local/start.sh`)
- **And** no `stack` framework is reported as passed

**Scenario: A failing framework propagates to the runner exit code**

- **Given** the registry includes a framework whose `command` currently fails
- **When** I run the aggregate runner over a profile that includes it
- **Then** that framework's line reads `FAIL`
- **And** every other selected framework still runs
- **And** the runner exits 1
- **And** the failure is repeated at the bottom with its single-framework reproduce command

**Scenario: `--profile all` never quietly means "the runnable subset"**

- **Given** a host with the stack up but no device attached
- **When** I run `scripts/test/run-all.sh --profile all`
- **Then** each `device` framework is reported `SKIPPED` with reason "no device attached"
- **And** the runner exits non-zero (skips are not silent) unless `--allow-skips` is passed

**Scenario: Registry validator rejects a malformed entry**

- **Given** a registry entry with `category: "sometimes"` (not one of host/stack/device)
- **When** I run `node scripts/test/check-registry.mjs`
- **Then** it exits non-zero
- **And** stderr names the offending `id` and the `category` field

**Scenario: README index cannot drift from the registry**

- **Given** a newly registered framework whose row is missing from `docs/testing/README.md`
- **When** I run `node scripts/test/check-readme-in-sync.mjs`
- **Then** it exits non-zero naming the framework absent from the index
- **And** CI's lint job fails on that gate

**Scenario: Result feed shape matches what the public page consumes**

- **Given** a completed `--profile host` run
- **When** SHY-0220's page reads a framework's `metadata.json`
- **Then** it finds `{ id, plainName, publicArea, passed, failed, total, status, startedAt, finishedAt, durationMs }`
- **And** no field carries a secret or PII

## Test Plan

**Classification:** infra/tooling. The runner + registry + validators are host-runnable pure Node/bash — their own tests run on the host JVM/Node (unit-location allowed for doubles), but the frameworks they orchestrate are REAL (the runner shells out to the real commands; no faking a framework's pass). Per EPIC-0003 real-only policy, the runner's integration tests drive the actual registered commands against the real local stack, not mocked child processes — except pure argument-parsing/registry-validation unit tests.

### Red — write failing tests first

- `express-api/tests/scripts/test-runner/check-registry.test.js` — `it('rejects duplicate id')`, `it('rejects unknown category')`, `it('rejects unknown publicArea')`, `it('rejects readme path that does not exist')`, `it('rejects resultsDir outside test-results/')`, `it('accepts the live registry')`.
- `express-api/tests/scripts/test-runner/run-all.test.js` — `it('selects only host frameworks under --profile host')`, `it('exits 3 when a stack framework is selected but the stack is down')`, `it('exits 1 when any selected framework fails')`, `it('marks device frameworks SKIPPED with reason under --profile all with no device')`, `it('exits non-zero on skips under all unless --allow-skips')`, `it('reports true exit code through a pipe')`, `it('writes run-summary.json aggregating every metadata.json')`, `it('kills and reports FAIL:timeout for a framework exceeding timeoutMs')`, `it('--help lists the 4 profiles and 4 exit codes')`.
- `express-api/tests/scripts/test-runner/metadata-shape.test.js` — `it('every metadata.json has the SHY-0220 contract fields')`, `it('metadata.json contains no secret-shaped or PII-shaped values')`.
- `express-api/tests/scripts/test-runner/readme-sync.test.js` — `it('fails when a registered framework is missing from docs/testing/README.md')`, `it('passes on the live docs')`.
- Registry-drift meta-test: `it('every framework named in the audit as present is registered')` (parses the audit table + the registry).

### Green — implement until red flips

1. Build `scripts/test/framework-registry.mjs` with the full audited framework set.
2. Build `scripts/test/check-registry.mjs`, `scripts/test/run-all.sh` (shellcheck-clean, `set -euo pipefail`, per-framework timeout via `timeout`/`gtimeout` fallback), `scripts/test/normalize-results.mjs` (per-framework adapter → `metadata.json`), `scripts/test/check-readme-in-sync.mjs`.
3. Author `docs/testing/README.md` + one `docs/testing/<id>.md` per framework + `docs/testing/framework-value-audit.md` (keep/remove decisions).
4. Add `test:all` to root `package.json`; wire `check-registry` + `check-readme-in-sync` into `.github/workflows/lint.yml`; add a CI job that runs `--profile host` and uploads `test-results/`.
5. Remediate any existing framework the audit flagged flaky/broken so `--profile host` is genuinely green (or record it env-gated with evidence).

### Gauntlet

CI-config-and-tooling story, but it TOUCHES how every product framework is invoked, so the Test Plan runs the FULL relevant non-device gauntlet: `npm run test:all --profile host` green, the runner's own Jest suite green, eslint/prettier `--max-warnings=0`, shellcheck on `run-all.sh`, actionlint on the new CI job, story validator, `code-reviewer` 100% clean. The `stack`/`device` profiles are proven on the real local stack + real Android + real iOS before merge per the Pre-Merge Testing Protocol.

## Out of Scope

- The new *kinds* of tests (a11y, perf, visual, mutation, etc.) — each is its own child SHY (SHY-0213…0225); this story only builds the registry/runner/docs they plug into and registers the frameworks that already exist.
- The public health **page** and the Allure-vs-alternative reporting decision — SHY-0220.
- Re-architecting `manual-qa-runner.js` or the device matrix (EPIC-0003 owns the matrix's realness); this story registers it and normalizes its result feed, nothing more.
- Migrating existing mock tests to real — EPIC-0003.
- Deleting a framework that the value-audit marks "remove": if the audit finds one, the removal is a **separate** follow-up SHY (kept out of this PR to keep 1-PR-1-concern), and this story only records the decision.

## Dependencies

- **Blocks:** SHY-0213…0225 (each registers into this registry + writes its README + emits the normalized result feed) and SHY-0220 (consumes `run-summary.json` + per-framework `metadata.json`).
- **Blocked by:** none — builds only on what exists. Uses the audit doc as input.
- **Tooling assumptions:** Node ESM (already used by `sync-shy-to-roadmap-data.mjs`), bash 3.2-compatible `run-all.sh` (macOS dev + ubuntu CI), `timeout`/`gtimeout` for the per-framework bound. No new runtime dependency for the host profile.

## Risks & Mitigations

- **Risk:** The runner becomes a second source of truth that drifts from the real `package.json`/gradle commands. **Mitigation:** The registry stores the exact command string and `check-registry.mjs` asserts each target exists; a meta-test cross-checks the registry against the audit's framework list so a newly-added framework can't be silently omitted.
- **Risk:** A `stack`/`device` framework silently skipped and reported green (the exact "environmental is not a diagnosis" trap). **Mitigation:** Precondition probes fail with exit 3 naming the missing service; `--profile all` treats skips as failures unless `--allow-skips`; BDD scenario + test pin this.
- **Risk:** Pipe/tee in CI masks a real failure. **Mitigation:** Runner captures each child's raw exit status into an array and computes its own exit from that, never from a pipeline tail ([[feedback-pipe-swallows-exit-codes]]).
- **Risk:** README rot — docs written once, never updated. **Mitigation:** `check-readme-in-sync.mjs` is a CI gate; the index is registry-derived.
- **Risk:** Scope creep — this story tries to also *build* the new frameworks. **Mitigation:** Out-of-Scope pins that each new kind is its own SHY; this story ships the empty-but-typed plug-in points only.
- **Risk:** Normalizing 20+ heterogeneous framework outputs into one shape is fiddly and could fake numbers. **Mitigation:** Per-framework adapters read the framework's OWN machine output (JUnit XML, Jest JSON, gradle test XML, exit code) — never a re-parse of human stdout; each adapter has a fixture test.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `npm run test:all` green on a clean checkout; `--profile stack` green on the real local stack; `--profile device` green on real Android + real iOS.
- [ ] `node scripts/test/check-registry.mjs` and `node scripts/test/check-readme-in-sync.mjs` exit 0 and are wired into `lint.yml`.
- [ ] Every existing framework registered; `docs/testing/` index + per-framework docs + value-audit present and non-engineer-legible.
- [ ] Runner's own Jest suite green; eslint/prettier `--max-warnings=0`; shellcheck + actionlint clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.
- [ ] Branch `story/SHY-0212-self-serve-test-runner-and-readmes`; PR title `SHY-0212: Self-serve test foundation — registry, one-command runner, plain-English READMEs`; status `In Review` before merge; `pre-merge-check.sh` prints `PRE-MERGE-CHECK: OK`.
- [ ] Full Pre-Merge Testing Protocol satisfied (registry touches how every product framework runs → full gauntlet); `released_in:` set at release for Done.

## Notes

- 2026-07-19 — Created as the keystone child of EPIC-0008 (operator directive: self-serve + public testing, MVP hard-blocker). Design decision: a single **framework registry** is the one home for "what frameworks exist + how they run + what user-area they map to" ([[feedback-consumer-first-surface-design]]) — read by the runner, CI, the README-sync gate, and SHY-0220's public page, so the fact lives once. Precondition-fails-loud + skips-are-not-silent chosen deliberately to avoid the [[feedback-environmental-is-not-a-diagnosis]] false-green class. All new-framework stories depend on this landing first.
- 2026-07-20 — **Architect-review refinement (EPIC-0008 batch, Critical 1).** The original flat `metadata.json` was insufficient for its 6 consumers. Extended the contract: added an optional extensible **`details`** object (severity/budget/area/locale/screen/live data), a canonical **`test-results/trends/<id>.jsonl`** trend store (all trend-showing consumers read this one store), a **complete `publicArea` attribution** (existing frameworks assigned areas + a documented `Cross-cutting`→cards fan-out so every headline card — incl. **Payments** — has ≥1 contributor, asserted), two new **`mac`/`live`** categories (iOS XCTest is `mac` not host; synthetic is `live`), and a recorded justification for `docs/testing/` as the deliberate public/self-serve docs home (distinct from `.project/` internal planning docs).
