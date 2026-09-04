---
id: SHY-0521
status: In Review
owner: unassigned
created: 2026-09-04
priority: P0
effort: XS
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0521: Both lockfiles resolve outside every open advisory range

## User Story

As **the operator who treats every published vulnerability as P0**, I want the
API's dependency lock to resolve outside every open advisory range and a test
that goes red the moment it does not, so that a vulnerable transitive package
can never sit unnoticed behind a green build again.

## Why

Dependabot alert #76 (`GHSA-x5fp-wj9c-mxmx`, CVE-2026-82562, medium) names
`qs` — *array-limit bypass via bracket-key comma parsing* — for the range
`>= 6.14.2, <= 6.15.3`, first patched in `6.16.0`. `express-api` resolves
`qs@6.15.2` transitively: `express@5.2.1` wants `^6.14.0`, `body-parser@2.3.0`
wants `^6.15.2`, `superagent@10.3.0` (via `supertest`) dedupes to the same copy.
Every one of those ranges already admits `6.16.0`, so the whole fix is
`npm update qs` in `express-api/`. Dependabot raised no pull request for it,
because the package is transitive and no manifest names it.

The class, not the instance: nothing in the repository asserts that a
lockfile resolves outside a published range. `>= first_patched` is the wrong
check ([[feedback-a-vulnerability-check-needs-the-advisory-range]]) — a
lockfile may hold several majors of one package, and only copies *inside* the
range are vulnerable. This story adds a table of the open advisories, verbatim
from the Dependabot API, checked against every locked copy in both lockfiles.
The four `fast-uri` rows for the root lockfile go green when Dependabot PR
#2134 (retargeted to `develop` today) merges; this branch rebases on it.

## Acceptance Criteria

### Happy path

- [ ] `express-api/package-lock.json` resolves a single, hoisted
      `node_modules/qs` at `6.16.0` (with `side-channel@1.1.1`, which it
      requires); `package.json` is unchanged and `npm ci` is clean.
- [ ] `express-api/tests/scripts/lockfiles-outside-open-advisory-ranges.test.js`
      is green for the `qs` row on this branch, and for the `fast-uri` rows
      once rebased on the merge of #2134.
- [ ] `npm test` in `express-api/` is green locally and in CI.

### Error paths

- [ ] A row whose package is absent from the named lockfile fails the anchor
      test (`no vacuous pass`) instead of passing.
- [ ] A range clause the helper cannot parse (`~1.0`, `latest`) throws with
      the clause named; it never returns `false` silently.

### Edge cases

- [ ] Nested copies (`node_modules/a/node_modules/qs`) are checked as well as
      the hoisted one.
- [ ] With several majors locked, only copies inside the range fail; a safe
      older major passes.
- [ ] The first patched version of every row is itself outside its range
      (row sanity), so a mistyped range cannot pass.

### Performance

- [ ] The test reads two JSON files and finishes in milliseconds; no new
      dependency (the range helper is fifteen lines, no `semver`).

### Security

- [ ] The advisory's own surface — query strings and bracketed form bodies
      parsed by `qs` under `express` and `body-parser` — is closed by the
      bump; no `overrides` entry is needed because every dependant's range
      admits the patched version.

### UX

- [ ] N/A — no user-facing change; request parsing behaviour is unchanged for
      well-formed input.

### i18n

- [ ] N/A.

### Observability

- [ ] Every failure names the GHSA id, the package, the lockfile path and the
      offending locked copy, so the job log says what to bump without opening
      the alert.

## BDD Scenarios

**Scenario: A vulnerable parser cannot stay in the API's dependencies**

- **Given** the API's dependency lock holds a package version inside a
  published advisory range
- **When** the backend test suite runs
- **Then** it fails, naming the advisory and the package

**Scenario: A patched dependency passes**

- **Given** every locked copy of the package is outside the advisory range
- **When** the backend test suite runs
- **Then** the advisory check passes

**Scenario: An advisory for a package we do not ship is a typo, not a pass**

- **Given** an advisory row naming a package that is not in the lockfile
- **When** the backend test suite runs
- **Then** it fails, saying the package is absent

## Test Plan

### Red

- `express-api/tests/scripts/lockfiles-outside-open-advisory-ranges.test.js`
  written first against the live alerts: on `develop` at `c2122764a83` it
  fails 5 of 25 — the `qs` row (`6.15.2` inside `>= 6.14.2, <= 6.15.3`) and
  the four `fast-uri` rows (`3.1.5` inside `>= 3.0.0, < 3.1.6` and its
  narrower siblings); the 20 helper, anchor and row-sanity tests pass.

### Green

- `npm update qs` in `express-api/` → the lockfile moves `qs` to `6.16.0`
  together with the `side-channel@1.1.1` patch it requires (19 lockfile
  lines, no manifest change); the `qs` row passes. The `fast-uri` rows pass after rebasing
  on the merge of Dependabot PR #2134.

## Out of Scope

- The root lockfile's `fast-uri` bump itself — Dependabot PR #2134.
- Replacing `qs` under `express` (not possible without forking `express`).
- Automating the table from the API at test time (network in unit tests).

## Dependencies

- Dependabot PR #2134 must merge before this branch's CI can be fully green;
  this story's PR is rebased on it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `qs@6.16.0` tightens array-limit handling and changes parsing of a request the API relied on | The full `express-api` suite exercises query and body parsing through `supertest`; the dev sanity and smoke jobs run on deploy. Well-formed input is unaffected by the fix. |
| The table drifts from the live alerts | The row header says where the rows come from; a row is added when an alert opens and deleted when it is withdrawn. A wrong package name is caught by the anchor test. |

## Definition of Done

- [ ] Merged to `develop`, all checks green; dev deploy green.
- [ ] Dependabot alert #76 shows state `fixed` once the bump reaches `main`
      (alerts are evaluated on the default branch, so it stays `open` on
      `develop` until the next promotion); recorded in Notes with the alert URL.

## Notes

- **2026-09-04** — Found in the EPIC-0013 handover's owed list. Red run
  recorded above; `qs` bumped in the same session.
