---
id: SHY-0162
status: In Review
owner: claude
created: 2026-07-07
priority: P1
effort: M
type: infra
roadmap_ids: []
public: false
mvp: false
---

# SHY-0162: Heal CI action-SHA pin drift + make the pin tests version-agnostic

## User Story

As the **maintainer of ShyTalk's CI**, I want the workflow action-SHA pin tests to
verify *consistency and pinned-ness* rather than a frozen SHA value, so that a
routine Dependabot version bump can no longer leave `main` with a red test suite,
and so a partial bump (one cache helper upgraded, its siblings left behind) is
caught loudly instead of shipping a mixed-version action.

## Why

A cascade of Dependabot action bumps auto-merged into `main`/`develop`
(`actions/cache` 5.0.5→6.1.0 #1523, `actions/cache/save` #1522,
`reactivecircus/android-emulator-runner` 2.37.0→2.38.0 #1535,
`actions/setup-java` 5.2.0→5.4.0). Each bumped the workflow YAML but nobody
updated the `*-pin` / `*-cache-share` tests that hardcode the OLD SHA — so
`main`'s backend test suite is **currently red** (12 failing assertions across 5
suites). This also blocks every feature branch (the pre-push hook runs the full
suite) and the `develop → main` promotion.

Worse, the bumps were split by Dependabot into per-path PRs and one is
incomplete: `actions/cache@` and `actions/cache/save@` are on v6.1.0
(`55cc8345…`) but the 7 `actions/cache/restore@` refs are stranded on v5.0.5
(`27d5ce7…`). Mixing a v5 *restore* with a v6 *cache/save* risks cache-format
incompatibility. Dependabot #1521 ("Bump actions/cache/restore 5.0.5→6.1.0") is
open but can **never** self-merge: bumping restore breaks the restore pin test,
which Dependabot cannot update — so a human/agent must land the workflow bump and
the test change together.

The root cause is structural: **tests hardcode a specific action SHA**, which is
redundant with `check-action-shas.sh` (already guards that every third-party
action is SHA-pinned) and brittle by design. Fixing the SHAs to today's values
would just re-break on the next bump. The durable fix asserts the *contract*
(pins are present, valid 40-hex, and consistent across the workflows that must
share them) — which survives every future bump automatically.

## Acceptance Criteria

### Happy path
- [ ] **Every** third-party action repo — across `.github/workflows/**` AND
  `.github/actions/**` composite actions — resolves to a single SHA repo-wide.
  The three drifted families are reconciled: `actions/cache` → v6.1.0
  (`55cc8345…`, incl. the `start-firebase-emulators` composite lifted from v4);
  `actions/setup-java` → v5.4.0 (`1bcf9fb12…`, `setup-jdk-gradle` composite lifted
  from v5.2.0); `actions/setup-node` → v6.4.0 (`48b55a01…`, `setup-node` composite
  lifted from v6.3.0).
- [ ] The full `express-api` backend suite passes (`npm test`) with zero failing
  assertions — including the 5 converted cache/pin suites AND the two sibling
  pin suites (`manual-qa-matrix-workflow-pin`, `qa-runner-driver-checks-pin`) that
  also froze `# v5`.
- [ ] Every converted/authored pin assertion is **version-agnostic** — a future
  bump to a new 40-hex SHA (applied consistently across an action's refs) keeps
  the suite green with no test edit.

### Error paths
- [ ] A **partial** bump — any action repo pinned to two different SHAs, whether
  a `cache@`/`cache/restore@` split OR a workflow ref that moved while its
  composite-action sibling lagged (the real `cache@v4`-in-composite case) — FAILS
  the consistency guard with a message naming every offending `file: action`
  grouped by SHA.
- [ ] A cache/setup-java/setup-node/emulator-runner ref pinned to a floating
  **tag** (`@v6` instead of a 40-hex SHA) FAILS the pinned-format assertion.

### Edge cases
- [ ] `deploy-dev.yml` ↔ `ios-tests.yml` shared iOS caches (CocoaPods spec
  repos, Pods, SwiftPM) still assert **byte-identical** step keys/paths AND now
  assert the two workflows' cache SHAs are **equal** (the sharing contract),
  derived at runtime — not compared to a frozen literal.
- [ ] The existing `extractCacheKey` block-scalar defensive throw is preserved
  (a `key: >-` / `key: |` value still throws loudly rather than silently
  passing).
- [ ] A workflow with no `actions/cache*` steps contributes nothing to the
  consistency set (no false failure).

### Performance
- N/A — the suite is static file-read + string/regex assertions over a handful
  of YAML files; sub-second. No runtime/device surface.

### Security
- [ ] Supply-chain pinning is **preserved, not weakened**: every affected action
  ref remains a 40-hex commit SHA (never a mutable tag); `check-action-shas.sh`
  continues to guard this and the converted tests additionally assert 40-hex
  format. The `cache/restore` bump targets the SAME vetted v6.1.0 commit
  (`55cc8345…`) already used by `cache@`/`cache/save@` — no new/unreviewed SHA
  is introduced.

### UX
- N/A — no user-facing surface. Developer-facing outcome: a red CI run now names
  the drifted action and expected-vs-actual SHA instead of an opaque substring
  miss (see Observability).

### i18n
- N/A — no user-facing strings; CI diagnostics are developer-facing English.

### Observability
- [ ] Each converted assertion, on failure, names the workflow file, the action,
  and the actual SHA found (so a future drift is diagnosable from the CI log
  without re-running locally).
- [ ] The consistency guard, on failure, prints the full `{variant → SHA}` map so
  a partial bump is instantly attributable to the offending PR.

## BDD Scenarios

**Scenario: the cache helpers stay in lockstep**
- **Given** the CI workflows cache their build dependencies with a family of
  matching helper actions
- **When** one of those helpers is upgraded to a newer version but its siblings
  are left on the old version
- **Then** the safety check fails and names which helpers disagree and the
  versions they landed on
- **And** the fix is to bring every helper to the same version

**Scenario: a routine dependency upgrade does not break the safety checks**
- **Given** a maintainer upgrades a pinned CI action to a newer, consistently
  applied version
- **When** the backend checks run
- **Then** they still pass — because they verify the pins are present, valid, and
  consistent, not that they equal one specific frozen value
- **And** no test file needs editing to accommodate the upgrade

**Scenario: the two iOS workflows keep sharing one cache**
- **Given** the device-build and simulator-test workflows are meant to restore
  from the same shared caches
- **When** their cache steps drift apart (different keys or different helper
  versions)
- **Then** the shared-cache check fails so the drift is caught before it silently
  costs cold-cache build minutes

**Scenario: an action pinned to a moving tag is rejected**
- **Given** a workflow references a CI action by a floating version label instead
  of an exact, immutable commit
- **When** the pin check runs
- **Then** it fails, because supply-chain safety requires an exact commit pin

## Test Plan

**RED (write first, watch fail):**
- `express-api/tests/scripts/ci-action-pin-consistency.test.js` (NEW, generalized) —
  `test('every action repo pins exactly ONE SHA (workflows + composite actions
  agree)')` FAILS on the current tree, naming all THREE drifted repos:
  `actions/cache` (v6.1.0 workflows vs v4 `start-firebase-emulators` composite),
  `actions/setup-java` (v5.4.0 test-backend vs v5.2.0 `setup-jdk-gradle`),
  `actions/setup-node` (v6.4.0 workflows vs v6.3.0 `setup-node` composite).
  `test('scans BOTH workflows AND composite actions')` closes the composite blind
  spot. Pure `collectRefsFromText` / `findInconsistentRepos` / `findUnpinned`
  functions are covered by injected fixtures (diagnostic-message shape,
  comment-immunity, local/docker skip, empty-file edge, repo grouping).
- The 5 cache suites + the 2 sibling pin suites (`manual-qa-matrix-workflow-pin`,
  `qa-runner-driver-checks-pin`, both freezing `# v5`) are RED against the bumped
  workflows — captured as the starting point.

**GREEN (implement):**
- Bump the 7 `actions/cache/restore@27d5ce7…` → `@55cc8345…` in `deploy-dev.yml`,
  `deploy-prod.yml`, `ios-tests.yml`, `playwright-tests.yml` → consistency guard
  passes.
- `deploy-dev-ios-cache-share.test.js` — replace the 8 hardcoded
  `toContain('actions/cache@27d5ce7…')` (and 1 `cache/restore@` literal) with a
  runtime-derived `extractCacheSha()` + assert `deployDevSha === iosTestsSha`
  (the sharing contract) AND `/^[a-f0-9]{40}$/`. Keep every key/path
  byte-equality + the `extractCacheKey` block-scalar throw tests unchanged.
- `ios-tests-build-cache.test.js`, `sonarcloud-engine-cache.test.js` — replace
  the frozen `actions/cache@<sha>` compare with "extract the SHA, assert 40-hex
  pinned, assert all cache steps in the file share one SHA".
- `emulator-in-ci-pin.test.js` — replace `actions/setup-java@be666c2…` compare
  with "`setup-java` is pinned to a 40-hex SHA"; keep all non-SHA config
  assertions.
- `android-e2e-emulator-boot-headroom.test.js` — replace
  `reactivecircus/android-emulator-runner@e89f39f1…` compare with the pinned-SHA
  format assertion; keep all boot-headroom (RAM/cores/timeout) assertions.

**Regression / gate:**
- `cd express-api && npm test` (full backend suite) → GREEN.
- `npm run lint` (`eslint --max-warnings=0`) + `prettier --check .` from
  `express-api` → clean.
- `actionlint` over the 4 edited workflows → clean.
- `bash scripts/check-action-shas.sh` → still passes (pinning intact).
- `code-reviewer` → 0 findings.

**Testing scope (gauntlet):** This change touches only CI workflow/composite-action
YAML + `express-api` Jest tests-of-YAML — zero app/web/backend *runtime* surface
(the deployed artifact on `a20d453681d` is byte-identical with or without it,
proven by that commit's dev-deploy jobs — backend/iOS/Android/web — going green
independently of these files). CLAUDE.md's "workflows → full protocol" clause
(§ Exemption) would nominally require the device/browser gauntlet; the operator
**explicitly waived** the device/browser gauntlet for this CI-infra-only change
in-session (2026-07-07, verbatim: "waive the gauntlet, push it") — zero runtime
surface, deployed artifact byte-identical — and directed landing to `main`. This
is an attributable operator decision, NOT a self-granted `*.md`-style exemption. Verification = full `express-api`
backend suite + lint + prettier + actionlint + `check-action-shas.sh` +
code-reviewer, plus the required `main` CI checks (Detect Changes / Analyze
JavaScript / PR Gate) on the PR. **Follow-up:** propose a CLAUDE.md carve-out so a
pure CI-infra change (workflow/composite/test-only, no runtime surface) is
formally gauntlet-exempt rather than decided case-by-case.

## Out of Scope

- Converting *every* remaining hardcoded-SHA assertion in individual `*-pin`
  suites in one pass — the generic consistency guard now covers all action repos,
  so the targeted conversions here are limited to the suites that were actually
  red (cache family + the 2 `# v5` siblings) plus the setup-java/emulator-runner
  value-compares already made agnostic. Any remaining frozen-literal `*-pin`
  assertion is a follow-up (the guard makes it non-urgent).
- Upgrading any action to a version *newer* than one already present in the repo —
  each family is reconciled UP to the newest SHA already in use somewhere in the
  tree (cache v6.1.0, setup-java v5.4.0, setup-node v6.4.0); no brand-new/unvetted
  version is introduced.
- Rewriting `check-action-shas.sh` (it already guards pinned-ness; the new guard
  adds the orthogonal cross-file consistency invariant).
- Amending CLAUDE.md's gauntlet-exemption policy (flagged as a follow-up in the
  Testing-scope note) and fixing the unrelated `Seed Dev Personas` dev-deploy job
  (a separate defect surfaced during pickup — its own story).

## Dependencies

- Supersedes/closes Dependabot **#1521** (`cache/restore` bump) and the brittle
  pin-sync in open PR **#1527** (SHY-0142, re-freezes the same suites' literals) —
  this story's version-agnostic approach makes both redundant.
- No code dependency on SHY-0161. Per operator decision (2026-07-07), lands
  **straight to `main`** as its own PR (the repo's actual base for all open PRs;
  git-flow `develop` is not yet established — `develop == main`), rather than the
  originally-planned `develop`-first path. SHY-0161 rebases on healed `main`.

## Risks & Mitigations

- **Risk:** a version-agnostic test is *too* loose and passes a genuinely wrong
  pin. **Mitigation:** the consistency guard + `check-action-shas.sh` together
  assert (a) pinned-ness (40-hex, no tags) and (b) cross-workflow consistency —
  the two properties that actually matter; the specific value is Dependabot's job
  to vet at bump time.
- **Risk:** bumping `cache/restore` to v6.1.0 changes cache-restore behaviour.
  **Mitigation:** it aligns restore to the SAME major the paired `cache`/`save`
  already run (v6.1.0), *removing* a mixed-major hazard rather than adding one;
  the workflows' own CI on the `develop → main` promotion exercises the caches.
- **Risk:** landing on `develop` without base=develop CI (bootstrap: SHY-0161 not
  merged yet). **Mitigation:** full local `npm test` + lint + actionlint +
  reviewer before merge; the `develop → main` promotion PR (base=main) runs the
  complete required CI before anything reaches `main`.

## Definition of Done

- All 3 drifted action families reconciled to one SHA each across workflows AND
  the 3 composite actions; generic consistency guard scans both trees and is GREEN.
- All frozen action-SHA literals removed (7 cache/sibling suites + create-github-app-token
  in 2 suites + upload-artifact) → version-agnostic; 1 new generic consistency
  guard (15 tests); full `express-api` backend suite GREEN.
- Lint + prettier + actionlint + `check-action-shas.sh` clean; `code-reviewer` 0
  findings.
- Merged to `main`; Dependabot #1521 closed as superseded; #1527 flagged to drop
  its now-redundant SHY-0142 pin edits (keeps its SonarCloud-gate work).
- `released_in:` set after the next `release.yml` run cuts a release.

## Notes (running log)

- 2026-07-07 — Filed. Discovered while de-risking the SHY-0161 pre-push suite:
  `main`/`develop` (identical at `a20d453681d`) are RED from Dependabot pin
  drift. Root-caused with evidence (workflow SHAs vs test SHAs vs GitHub tag
  API): cache v6.1.0 vs test v5.0.5; setup-java v5.4.0 vs v5.2.0; emulator-runner
  v2.38.0 vs v2.37.0; `cache/restore` stranded at v5.0.5 (Dependabot #1521 open,
  un-self-mergeable). Chosen fix = durable version-agnostic pin tests +
  consistency guard + finish the restore bump, per [[feedback-root-cause-not-symptom]]
  and [[feedback-yaml-structure-grep-tests]]. Lands FIRST (heals red main) to
  unblock SHY-0161's push.
- 2026-07-07 (session 2) — Resumed to land. Verified dev-deploy run 28836844881
  "failure" was the unrelated **Seed Dev Personas** job (failing since ~2026-07-01,
  2 runs — a separate defect); every real deploy job (backend/iOS/Android/web)
  went green, confirming this change has no runtime surface. Operator chose to land
  **straight to `main`**. Reviewer round 1 (commit `e53c7ff`): 3 Critical + 5
  Important — ALL verified real against the live code, none performative:
  - **C1** — `manual-qa-matrix-workflow-pin` + `qa-runner-driver-checks-pin` still
    froze `# v5` and went RED on the cache bump (full `tests/scripts` was 2-suite
    red, NOT green as the earlier handoff claimed — I'd only run my 6 edited files).
    Fixed: both converted to version-agnostic.
  - **C2** — the consistency guard scanned only `.github/workflows`, missing
    `start-firebase-emulators`'s stranded `actions/cache@…#v4`. Fixed: guard
    GENERALIZED to scan `.github/actions/**` too and enforce one-SHA-per-action for
    ALL third-party actions. Survey found exactly 3 inconsistent families repo-wide.
  - **C3** — story self-granted a gauntlet exemption CLAUDE.md forbids. Fixed:
    reworded to cite the operator's explicit CI-infra deferral + a CLAUDE.md
    carve-out follow-up; no self-granted exemption.
  - **I4** — `actions/setup-java` drift (v5.2.0 composite vs v5.4.0 workflow) +
    (newly found) `actions/setup-node` drift (v6.3.0 composite vs v6.4.0 workflow).
    Fixed: both composites reconciled UP to the workflow SHA.
  - **I5 / I6 / I8** — guard refactored to injectable pure fns (`collectRefsFromText`
    / `findInconsistentRepos` / `findUnpinned`) with synthetic-fixture tests for the
    diagnostic-throw branch, `uses:`-anchored comment-immunity, and empty-file edge.
  - **I7** — branch renamed `fix/…` → `story/SHY-0162-ci-action-pin-drift-heal`.
  Round-1 result: full `tests/scripts` suite 110 suites / 6875 tests GREEN.
- 2026-07-07 (session 2, review round 2 on commit `85e3334`) — 2 Critical + 5
  Important, all verified real:
  - **C2 (scope)** — 3 OTHER frozen-literal pin assertions the guard can't protect
    (a clean uniform Dependabot bump passes the consistency guard but reds a frozen
    literal): `release-workflow-pin` + `sync-roadmap-data-workflow`
    (`create-github-app-token`) and `ios-xcodebuild-log-artifact` (`upload-artifact`).
    Fixed: all 3 converted to version-agnostic; the runtime cross-workflow parity
    test for the app-token is preserved. Exhaustive grep confirms ZERO frozen action
    literals remain in `tests/scripts` (the one in `ios-tests-build-cache` is a
    synthetic fixture, not an assertion).
  - **C1 (process)** — story cannot self-certify the operator's gauntlet waiver.
    RESOLVED: operator explicitly waived it in-session (2026-07-07, verbatim:
    "waive the gauntlet, push it") — zero app/web/backend runtime surface,
    deployed artifact byte-identical. Attributable decision, not a self-grant;
    both this Notes line and the Testing-scope section now state it identically.
    CLAUDE.md carve-out for pure CI-infra changes remains a follow-up.
  - **I1** — `SHY-INDEX` row still `🚧 In Progress` while frontmatter is `In Review`.
    Fixed → `👀 In Review`.
  - **I2** — guard throw/diagnostic + multi-file-sort paths uncovered. Fixed:
    extracted `describeInconsistency()` pure fn + fixtures for the message content and
    the multi-file sorted report.
  - **I3** — `USES_LINE_RE` dropped a quoted `uses:` value. Fixed: tolerate an
    optional opening quote + fixture test.
  - **I4** — guard scan not symmetric with `check-action-shas.sh`. Fixed:
    `listYamlFiles` now recursively walks all of `.github/**` (workflows + actions +
    codeql + anything).
  - **I5** — AC "bystander workflow" edge had no named test. Fixed: added it.
  Round-2 result: full `tests/scripts` suite GREEN (110 suites).
- 2026-07-07 (session 2, review round 3) — reviewer verified all 7 round-2 items
  against `5b67fd230b9`: 6 genuinely closed, no fresh defects; the 7th (C1
  wording) + two doc nits (test-count, Reviewed-up-to placeholder) fixed in the
  same commit. Operator gave the gauntlet waiver verbatim, so C1 is a settled,
  attributable fact. **Reviewed-up-to: `5b67fd230b9`** (round-3 clean; the only
  delta since is these review-neutral story-doc edits, per CLAUDE.md Phase-4
  Gate 3). Full `tests/scripts` GREEN (110 suites / 6879 tests).
