---
id: SHY-0309
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: S
type: bug
roadmap_ids: []
---

# SHY-0309: The uuid transform makes the driver load the real Playwright instead of its mock

## User Story

As a **developer merging SHY-0245**, I want the web-driver unit tests to hold
when the uuid transform is enabled, so that **both fixes can be on develop at
once** instead of one blocking the other.

## Why

Two landed fixes are mutually exclusive today, and that is what blocks PR
#1673 (SHY-0245, 210 commits of test-sleep eradication and 1187 lines of new
driver methods).

`express-api/jest.config.js` on that branch carries SHY-0264's fix:

```js
transformIgnorePatterns: ['/node_modules/(?!uuid/)'],
```

It exists because `uuid@14` is ESM-only and Jest's CJS registry cannot load it,
which took a whole real-services suite down at import. The `uuid: ">=14.0.0"`
override is load-bearing — SHY-0264 measured dropping it and it takes npm audit
from 5 vulnerabilities to 13.

With that line present, `express-api/tests/scripts/drivers/web-playwright-driver.test.js`
fails **11 tests**, all of the form:

```
expect(playwright.chromium.launch).toHaveBeenCalledTimes(1)
  Expected number of calls: 1
  Received number of calls: 0
```

Zero calls means the driver did not call the mock at all — it called something
else. The driver loads Playwright lazily
(`express-api/scripts/drivers/web-playwright-driver.js`, `loadPlaywright()`)
and, if the bare `require('playwright')` throws `MODULE_NOT_FOUND`, falls back
to `<repoRoot>/node_modules/playwright` — the REAL package, by absolute path,
which no `jest.mock('playwright', …)` can intercept. The real `launch` is not a
spy, so the assertion sees nothing.

## What was measured, and what it ruled out

Each of these is a run, not a guess:

| experiment | result |
| --- | --- |
| the suite alone, twice | **17/17 pass** |
| paired with `web-common-methods.test.js` | **83/83 pass** |
| full `tests/scripts/` on the branch | **11 fail** (180 suites) |
| full run with `--runInBand` | **11 fail** — so NOT worker interference |
| full `tests/scripts/` on develop | **0 fail** (153 suites) |
| revert the driver to develop's copy | **19 fail** — worse; the branch's tests need its 1187 new lines |
| add `babel-preset-jest` to `babel.config.js` | **11 fail** — so NOT `jest.mock` hoisting |
| **remove `transformIgnorePatterns`** | **180 suites / 7828 tests, 0 fail** |

So the cause is isolated to that one config line. It is not the driver version,
not parallelism, and not hoisting.

What is NOT yet established is the mechanism — why enabling the transform makes
the bare specifier stop resolving to the mock. That is the first job of this
story, because the fix depends on it: a `moduleNameMapper` entry, a narrower
`transform` key, or making the driver's fallback mockable are different answers
to different mechanisms, and picking one before knowing which is guessing.

## Acceptance Criteria

### Happy path

- [ ] `transformIgnorePatterns` (or an equivalent that keeps uuid loadable) is
      in place AND the full `tests/scripts/` run is green.
- [ ] `web-playwright-driver.test.js` passes both alone and in a full run.

### Error paths

- [ ] If the driver ever silently falls back to the real Playwright under test,
      a test FAILS saying so — rather than an assertion counting zero calls,
      which describes the symptom and hides the cause.
- [ ] The uuid import path stays covered: removing the transform must redden a
      test, so the SHY-0264 fix cannot be quietly dropped as "the way to make
      this green".

### Edge cases

- [ ] Works where Playwright is NOT installed. The express-api `test-backend`
      CI job does not install it, which is why the mock is `virtual: true` —
      any fix must hold in both environments.
- [ ] Works whether the run is parallel or `--runInBand`.
- [ ] Holds for the whole 180-suite set, not just the suite in isolation.

### Performance

- [ ] No whole-node_modules transform. SHY-0264 rejected that on wall-clock
      grounds and that reasoning still stands.

### Security

- [ ] The `uuid: ">=14.0.0"` override is retained. Dropping it takes npm audit
      from 5 vulnerabilities to 13 and surfaces a real uuid advisory.

### UX

- [ ] N/A — developer tooling.

### i18n

- [ ] N/A.

### Observability

- [ ] The failure, if it recurs, says which Playwright the driver loaded.

## BDD Scenarios

**Scenario: both fixes hold together**

- **Given** the uuid transform enabled
- **When** the full express test suite runs
- **Then** every suite passes

**Scenario: a real Playwright under test is reported, not silently counted**

- **Given** a driver that loads the real Playwright instead of its mock
- **When** the driver's unit tests run
- **Then** they fail saying the real package was loaded

**Scenario: the uuid fix cannot be dropped to go green**

- **Given** the transform removed
- **When** the suite runs
- **Then** a test fails on the uuid import path

## Test Plan

**Establish the mechanism first.** Add a temporary probe asserting the identity
of what `loadPlaywright()` returned (mock vs real) and run it under both configs
to see which branch of the fallback is taken and why the bare specifier stopped
resolving. Do not choose a fix before that read.

**RED first**, once known — a test that fails for the CURRENT cause, then the
fix, then the full 180-suite run.

**Then make the class visible**, which is the durable part: the driver should
not be able to load the real Playwright inside a unit test without saying so.
An assertion on the loaded module's identity fails with "loaded the real
playwright" instead of "expected 1 call, got 0" — the difference between a
diagnosis and a symptom.

**Mutation checks:**

- remove `transformIgnorePatterns` ⇒ a uuid-path test must redden, or the
  SHY-0264 fix has no guard and will be deleted the next time it is
  inconvenient;
- force the fallback branch ⇒ the new identity assertion must redden.

**Green** — full `tests/scripts/` (180 suites) parallel AND `--runInBand`, plus
the suite alone.

## Out of Scope

- The rest of PR #1673. This story exists so that PR can merge; its sleep
  eradication and driver methods are reviewed on their own terms.
- Upgrading or replacing `uuid`.
- Making the express-api CI job install Playwright. That would mask the problem
  rather than fix it, and it would cost every backend run a browser download.

## Dependencies

- `express-api/jest.config.js`, `express-api/babel.config.js`
- `express-api/scripts/drivers/web-playwright-driver.js` (`loadPlaywright()`)
- `express-api/tests/scripts/drivers/web-playwright-driver.test.js`

## Risks & Mitigations

- **Risk:** the fix is "delete `transformIgnorePatterns`", which turns the suite
  green by reintroducing the ESM-only uuid crash and keeping a real advisory.
  **Mitigation:** the Security AC forbids it and a mutation must prove the uuid
  path is still covered.
- **Risk:** the fix is "install Playwright in the backend CI job", which hides
  the fallback instead of fixing it. **Mitigation:** explicitly out of scope.
- **Risk:** the mechanism is never established and a plausible-looking fix is
  applied. **Mitigation:** the Test Plan makes the probe the first deliverable.

## Definition of Done

- [ ] Mechanism established with evidence, not inferred.
- [ ] Full `tests/scripts/` green with the uuid transform in place, parallel and
      serial.
- [ ] A silent fallback to the real Playwright now fails loudly.
- [ ] Both mutations proven to redden their tests.
- [ ] PR #1673 unblocked.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes (running log)

- **2026-08-17 — filed while merging develop into PR #1673.** The branch was 65
  behind with 15 conflicts; after resolving them the only remaining failure was
  this one, and it is a genuine interaction between two landed fixes rather
  than a merge artefact.
- **A correction to the record.** The merge commit on that branch
  (`b12736b960e`) claimed this failure was "NOT introduced here". That was
  wrong and is retracted: develop's full run is clean at 153 suites, the
  branch's fails at 180, and the cause is a config line the branch carries. The
  claim was made before develop had been measured. Stated here because a wrong
  claim in a commit message outlives the session that made it.
