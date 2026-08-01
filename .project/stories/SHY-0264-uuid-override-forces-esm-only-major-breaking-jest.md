---
id: SHY-0264
status: In Review
owner: claude
created: 2026-08-01
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0264: An ESM-only `uuid` blanks 11 real-services tests under Jest

## User Story

- **As a** ShyTalk engineer relying on the test suite to tell the truth
- **I want** `tests/scripts/journey-moderation-seed-givens.test.js` to run instead of dying at import
- **So that** the moderation seed-Givens — the ones that establish suspension, appeal and warning state for the j11 journey — are actually verified rather than silently unexecuted

## Why

`express-api/package.json` carries `overrides: { "uuid": ">=14.0.0" }`. Nothing in the tree asked for it: `@google-cloud/storage` declares `uuid: ^8.0.0`, and `google-gax` and `gaxios` both declare `^9.0.1`. The override forces a **five-major** jump to `uuid@14.0.0`, which is **ESM-only** — its `exports` map offers `node` and `default` conditions and no `require` condition at all, both pointing at ESM builds.

Node 24 tolerates this in production because `require(esm)` landed in Node 22.12. Jest's own CJS module registry does not, so `firebase-admin` → `@google-cloud/firestore` → `google-gax` → `require('uuid')` throws:

```
node_modules/uuid/dist-node/index.js:1
export { default as MAX } from './max.js';
^^^^^^
SyntaxError: Unexpected token 'export'
```

The whole suite dies at load, so **11 tests report as failures without ever running**. That is the [[feedback-absence-of-work-reported-as-success]] shape inverted — absence of work reported as failure — and it hides whichever of those Givens might genuinely be broken.

**CORRECTED 2026-08-01 — the override IS justified.** This story originally claimed no advisory backed it, on the strength of an `npm audit` that reported no `uuid` finding. That reading was wrong: audit was clean _because the override was already applied_. Removing it takes the tree from **5 vulnerabilities to 13** and surfaces a real `uuid` advisory. The override is load-bearing and stays; the fix belongs in the test layer.

Discovered 2026-08-01 while getting the host suite green before a gauntlet run. Pre-existing — unrelated to that night's changes.

## Acceptance Criteria

### Happy path

- [ ] `npx jest tests/scripts/journey-moderation-seed-givens.test.js` loads and runs all 11 tests.
- [ ] The full host suite (`tests/scripts/` + `tests/unit/`) is 167/167 suites green.
- [ ] The resolved `uuid` version satisfies what the dependency authors declared (`^8` / `^9`) OR the ESM build is made loadable under Jest — whichever the chosen option is, the choice is recorded in Notes with its evidence.

### Error paths

- [ ] If the 11 tests reveal a genuine defect in the moderation Givens once they can finally run, that defect is fixed or filed — a load failure must not be swapped for a silent red.
- [ ] `npm audit` after the change reports **no new** advisory relative to the current baseline (record both outputs in Notes; a regression in the count blocks the change).

### Edge cases

- [ ] Production `require('uuid')` under Node 24 keeps working — the fix must not depend on Node's `require(esm)` support, since CI and the Oracle VMs must agree.
- [ ] Any other CJS consumer of `uuid` in the tree resolves the same version (no duplicated majors in `npm ls uuid --all`).
- [ ] The remaining four overrides (`fast-xml-parser`, `@tootallnate/once`, `protobufjs`, `js-yaml`) are each re-checked against `npm audit` and either justified in a comment or removed on the same evidence standard — an unjustified override is how this one arrived.

### Performance

- [ ] No measurable change to suite wall-clock. If the chosen fix adds a transform over `node_modules`, its cost is measured before/after and recorded — transforming a dependency tree can be far more expensive than the bug it fixes.

### Security

- [ ] The `uuid` version shipped is free of known advisories at merge time, evidenced by the recorded `npm audit` output — not by assumption.
- [ ] If the fix is a transform rather than a version change, it must not rewrite `uuid`'s own code paths: a subtly-broken transform of an ID library can produce **colliding identifiers**, which would be far worse than the red suite. Pin `uuidv4()` uniqueness across a large sample as part of the change.

### UX

- [ ] N/A — build/test tooling with no user-facing surface.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] A test asserts the suite can `require('uuid')` at all, so a future override or major bump reddens one obvious test instead of blanking a whole suite with a parse error.

## BDD Scenarios

**Scenario: the moderation Givens suite actually runs**

- **Given** the repository at HEAD with dependencies installed
- **When** an engineer runs the moderation seed-Givens suite
- **Then** all 11 tests execute and report individual results
- **And** no `SyntaxError: Unexpected token 'export'` appears

**Scenario: a future ESM-only bump is caught loudly**

- **Given** someone raises `uuid` to a version with no CJS entry point
- **When** the suite runs
- **Then** a single named test fails saying `uuid` cannot be required
- **And** the other suites still report their own results

**Scenario: no security regression is accepted in trade**

- **Given** the override is relaxed to the range the dependencies declare
- **When** `npm audit` runs
- **Then** the advisory count is no worse than the recorded baseline

## Test Plan

CI-config/tooling change confined to `package.json` / `jest.config.js` and their meta-tests — no app, backend or website runtime surface — so it takes the CI-config-only exemption from the device gauntlet, and the Test Plan states that classification explicitly.

**Red → Green:**

- **RED:** a new `tests/scripts/uuid-is-requirable.test.js` asserting `expect(() => require('uuid')).not.toThrow()` and that `uuidv4()` returns distinct RFC-4122 values across 10k draws. Fails today with the parse error.
- **RED:** `tests/scripts/journey-moderation-seed-givens.test.js` — currently 11 failures at load; must go green without editing the test.
- **GREEN:** apply the chosen fix (relax the override to the declared range, or make the ESM build loadable) and re-run.
- **Regression:** full `tests/scripts/` + `tests/unit/` (7898 tests) green; `npm audit` diffed against the recorded baseline; `npm ls uuid --all` shows a single resolved version.
- **Verification:** `npm test`, `npm run lint`, prettier — all from the `express-api` cwd, per the repo convention.

## Out of Scope

- Migrating the Express suite to Jest's ESM mode (a large, separate change).
- Upgrading `firebase-admin` or the `@google-cloud/*` tree to versions that declare `uuid@14` themselves — worth doing on its own evidence, not as a side effect of this fix.
- The four other overrides beyond the re-check + justify/remove pass named in the AC.

## Dependencies

- None. The change is confined to `express-api/package.json`, `package-lock.json`, and possibly `jest.config.js`.
- Touches the same lockfile Dependabot writes, so land it before opening unrelated dependency PRs to avoid a conflict ([[feedback-dependabot-priority]]).

## Risks & Mitigations

- **Risk:** relaxing the override silently reintroduces a vulnerable transitive version. **Mitigation:** the `npm audit` before/after diff is an AC with its output recorded, not a judgement call.
- **Risk:** a transform-based fix mangles `uuid` and produces colliding IDs — a silent data-integrity bug far worse than the red suite. **Mitigation:** the uniqueness pin over 10k draws is an AC; and the version-change option is preferred precisely because it transforms nothing.
- **Risk:** the 11 tests turn out to have been failing for real reasons too, and "fixed the loader" gets reported as "fixed the tests". **Mitigation:** an explicit AC that a genuine defect surfaced by the newly-running tests is fixed or filed ([[feedback-prove-the-fix-changed-the-failure]]).

## Definition of Done

The moderation seed-Givens suite runs all 11 tests; the full host suite is green at 167 suites; `npm audit` is no worse than the recorded baseline with both outputs in Notes; a guard test makes any future ESM-only `uuid` bump fail loudly and narrowly; the other four overrides are justified or removed; `code-reviewer` 100% clean; merged; released.

## Notes

- 2026-08-01 — Filed while clearing the host suite ahead of a gauntlet run. Measured at filing: `uuid@14.0.0` resolved; declared ranges `^8.0.0` (`@google-cloud/storage`) and `^9.0.1` (`google-gax`, `gaxios`); `uuid@14` `exports` map exposes only `node` and `default`, both ESM, with no `require` condition; `npm audit` shows 5 vulnerabilities (1 critical, 2 high, 1 moderate, 1 low) and **none** against `uuid`. Node here is v24.18.1, which is why production is unaffected and only Jest's CJS registry trips.
- Preferred option on the evidence available at filing is **relax the override to the declared range**, because it removes the cause rather than compensating for it and transforms nothing. The alternative (`@babel/preset-env` + `transformIgnorePatterns`) adds a build dependency and puts a rewrite in front of an ID library; it should only be chosen if an advisory turns up that genuinely requires `uuid@14`.

- 2026-08-01 — **RESOLVED, and my premise in this story was wrong.** I filed it
  claiming no advisory justified the override. Measured: removing it takes
  `npm audit` from **5 vulnerabilities to 13** and surfaces a real `uuid`
  advisory. audit reported none originally _because the override was already
  applied_ — the instrument was reading the fixed state, and I read that as
  evidence the fix was unneeded. Same mistake shape as measuring RSS on a
  process whose memory has already been reclaimed. **The override stays.**

  Fixed in the test layer instead: `@babel/preset-env@^7` (the default resolves
  to 8.x and conflicts with the tree's `@babel/core@7.29.7`), `targets:
node current` so nothing is down-levelled beyond what this Node already runs,
  and `transformIgnorePatterns: ['/node_modules/(?!uuid/)']` so only uuid is
  transformed — transforming the whole tree would cost more wall-clock than the
  bug. Guarded by `tests/unit/uuid-is-requirable.unit.test.js`, which pins that
  uuid loads AND that `v4()` still yields RFC-4122 values with no collisions
  over 10k draws: a transform that quietly altered an ID library's RNG would be
  far worse than the load error it replaced. Host suite 8130/8130.
