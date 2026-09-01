---
id: SHY-0448
status: In Review
owner: unassigned
created: 2026-08-24
priority: P2
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0448: The admin dashboard's JavaScript is never linted

## User Story

As **whoever maintains the admin dashboard**, I want its JavaScript held to the
same standard as the API's, so that a mistake in the code that renders strangers'
messages is caught before it is committed rather than after.

## Why

`lint-staged` covers three things:

```json
"express-api/**/*.js"   "*.feature"   "*.{kt,kts}"
```

`public/**` is in none of them. Every file under `public/admin/js/` — the tabs
that render support tickets, reports, appeals and user records — is committed
without ESLint or Prettier ever seeing it.

That is the wrong surface to leave unchecked. These files take text written by
members of the public and put it into `innerHTML`. The Support tab's own header
comment says as much: *"precisely the shape of a stored-XSS problem if it is ever
trusted."* The discipline that keeps it safe is currently entirely manual.

It is also already costing formatting churn: `public/admin/js/tabs/support.js`
and `public/admin/index.html` both failed `prettier --check` on 2026-08-24
against edits made minutes earlier, because nothing had ever formatted them.

## Why it is not a one-line fix

Pointing the existing command at these files does not work:

```
$ npx --prefix express-api eslint --config express-api/eslint.config.mjs \
    public/admin/js/tabs/support.js
  26:1  error  Parsing error: 'import' and 'export' may appear only with 'sourceType: module'
```

`express-api/eslint.config.mjs` describes CommonJS files running in Node. These
are ES modules running in a browser: different `sourceType`, different globals
(`window`, `document`, `localStorage`), no `require`. They need their own block
in the config, and turning it on will surface whatever has accumulated in files
that have never been checked.

## Acceptance Criteria

### Happy path

- [x] `public/**/*.js` is linted and format-checked on commit, like every other
      JavaScript in the repository.
- [x] The rules applied suit a browser ES module: `sourceType: module`, browser
      globals, no Node globals.
- [x] CI fails on a lint error in these files, not only the local hook.

### Error paths

- [x] A deliberate error in an admin tab fails the commit. Asserted by
      introducing one, not by reading the config.

### Edge cases

- [x] `public/js/core/*.js`, which Jest loads through a transform, is covered
      too and does not break that transform.
- [x] Vendored or generated assets under `public/`, if any, are excluded
      explicitly rather than by accident.
- [x] The existing `express-api/**` behaviour is unchanged.

### Performance

- [x] No meaningful change to commit time.

### Security

- [x] `no-unsanitized` or an equivalent `innerHTML` rule is considered
      explicitly, and the decision recorded — this is the surface that renders
      untrusted text.

### UX

- [x] N/A.

### i18n

- [x] N/A.

### Observability

- [x] N/A.

## BDD Scenarios

**Scenario: A mistake is caught before it is committed**

- **Given** an admin dashboard file with a lint error
- **When** somebody commits it
- **Then** the commit is refused, naming the file and the error

**Scenario: Existing checks keep working**

- **Given** a change to the API's JavaScript
- **When** somebody commits it
- **Then** it is checked exactly as it was before

## Test Plan

| Layer | What it proves |
| --- | --- |
| Config | A fixture file with a known error is reported; a clean one is not. |
| Hook | Committing a deliberately broken admin tab fails. |
| Regression | Every existing `public/**` file passes, or its fixes are in this ticket. |

## Out of Scope

- Rewriting the dashboard's rendering to stop using `innerHTML`. If the rule
  above finds real problems, they are their own tickets.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Turning it on surfaces a large backlog and the ticket stalls | Fix what it finds in this ticket; it is a small tree, and the alternative is leaving it unchecked indefinitely. |
| Browser and Node rules fight each other in one config | Separate `files:` blocks, which is what flat config is for. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [x] A deliberately broken admin file fails a real commit.

## Notes

- Found on 2026-08-24 while adding the SHY-0438 conversion control to the
  Support tab: the file could not be linted at all.

## Notes (running log)

- **2026-09-01** — Linted, as a RATCHET rather than a wall.

  `public/` needed its own ESLint config: express-api's is
  `sourceType: commonjs` with Node globals, the opposite of browser code.
  The first pass reported **133 problems** — of which **84 were one thing**,
  `sgT` and friends, globals loaded by their own `<script>` tags. Declaring
  those, and switching to module parsing (much of `public/` uses
  import/export), left **56 real findings across 24 files**.

  Two looked like live bugs and are not: `ShyTalkLogger` and `loadAuditLog`
  are both used behind `typeof X !== 'undefined'` guards. They are declared
  rather than flagged — the guard is the point, and reporting it would train
  people to delete guards. `loadAuditLog` is dead, though: nothing else in
  `public/` defines it, so that backward-compat branch never fires.

  Fifty-six findings is too many to fail a build on today: that either blocks
  every change to this surface or gets switched off. Per-file counts may only
  **shrink**, and a file that improves without shrinking the baseline is a
  STALE failure — the same shape as `check-no-new-stubs.js`.

  **Still owed:** Prettier. 43 of 52 files fail `prettier --check`, which is
  a ~27k-line reformat and belongs in its own commit, not smuggled in beside a
  config change. `lint-staged` runs ESLint on `public/**/*.js` now; adding
  `prettier --check` there should follow that reformat.
- 2026-09-01 — **Completed.** PR #2121 shipped the ESLint config and the ratchet; every acceptance criterion was still open. This finishes them.
- 2026-09-01 — **Prettier had no config or ignore file at the repository root.** lint-staged and CI both run it from root, and Prettier resolves config relative to the file being formatted — so `express-api/.prettierrc` applied to express-api and nothing else. Two consequences, both found by trying to add the format check rather than by reading anything: `public/` would have been formatted with Prettier's DEFAULTS (the first `--write` rewrote thousands of lines from single to double quotes, against the only style the repo declares); and `express-api/.prettierignore`'s protection of `public/js/legal-translations.js` as *"deliberately single-line per locale"* **was not working** — from the root Prettier wanted to reformat it. Adding the check without noticing would have destroyed formatting somebody had already written a reason for.
- 2026-09-01 — **The commit hook agreed with nothing.** lint-staged ran raw `eslint` over `public/**/*.js` while CI ran the ratchet. Raw eslint exits 1 on the 56-finding baseline the ratchet exists to hold, so **no commit touching any of the 24 files with a finding could pass the hook** — including one that only reformats them. The hook now runs the same ratchet CI runs.
- 2026-09-01 — **The URL guard and Prettier interact, and the single line is load-bearing.** `.husky/pre-commit` requires every added line naming a shytalk host to also name localhost. Prettier wraps long ternaries, so two correct environment-resolution expressions became four lines that read as hardcoded remote URLs. Both were already deliberately single-line — one carrying an `eslint-disable` saying so — and now carry `// prettier-ignore` with the reason above them. Two example configs were missing the `// localhost:` marker their siblings have; added, matching `public/admin/config.js`.
- 2026-09-01 — **Reformat: 40 files, 11,172 insertions, 9,262 deletions**, in its own commit. Verified semantics-preserving rather than assumed: the 228 suites that load `public/` through Jest are identical at 8889 passing before and after, and the lint ratchet is unchanged at 56 findings. (The baseline run also caught stale local `node_modules` — the lockfile had firebase-admin 14.3.0 and 14.2.0 was installed; `npm ci` fixed it, which is that test doing its job.)
- 2026-09-01 — **The error path is proven by breaking it, as the AC demands.** A deliberate error in `admin/js/tabs/reports.js` took it from 6 findings to 10 and the ratchet failed naming the file. `express-api/tests/scripts/public-js-lint-gate.test.js` makes that permanent — and asserts the converse, that a CLEAN new file passes, without which a gate rejecting every new file would satisfy the first half and be useless. 7 tests.
- 2026-09-01 — **`no-unsanitized`: considered, measured, decided, recorded.** **148** assignments to `innerHTML`/`outerHTML`/`insertAdjacentHTML` under `public/`, and `escapeHtml` defined **four separate times**. The decision is *yes, and not here*: switching the rule on inside a linting-setup story means ~148 suppressions (having the rule in appearance only) or a gate nobody can pass. Filed as **SHY-0499** (P1) with the numbers, and the reasoning sits in `public/eslint.config.mjs` next to the config it explains.
- 2026-09-01 — Commit time: ratchet 1.1s + `prettier --check` 0.9s = **2.0s** added for a `public/` commit, comparable to the ktlint step already accepted. `public/js/core/*.js` — all five linted, zero findings, and the Jest transform still loads them (57 tests). `express-api` behaviour unchanged: it keeps its own `.prettierrc` (nearest config wins) and `prettier --check` over `express-api/src` still passes.

Reviewed-up-to: 6144e4278fc
