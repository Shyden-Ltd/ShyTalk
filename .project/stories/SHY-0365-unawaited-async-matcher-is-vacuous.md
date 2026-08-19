---
id: SHY-0365
status: In Progress
owner: unassigned
created: 2026-08-20
priority: P1
effort: XS
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0365: A test asserts nothing, because its async matcher is never awaited

## User Story

As **a developer relying on the suite**, I want a green test to mean the
assertion actually ran, so that I am not protected by a test that would pass
whatever the code did.

## Why

`express-api/tests/utils/email-local.test.js:47`:

```js
test('throws when SMTP not configured in non-local mode', () => {
  process.env.NODE_ENV = 'production';
  const { sendEmail } = require('../../src/utils/email');
  expect(sendEmail('a@b.com', 's', 'h')).rejects.toThrow('SMTP not configured');
});
```

There is no `await`. The matcher settles **after the test has already ended**, so
the assertion is never part of the test's result. The test is green because
nothing was checked.

### Proven, not argued

Mutating the expected message to something that cannot possibly match:

| Variant | Result |
| --- | --- |
| no `await` + wrong expectation | **Jest worker crash** — "child process exceptions, exceeding retry limit", `Tests: 0 total` |
| `await` + wrong expectation | clean, named failure — `1 failed, 3 passed` |
| `await` + real expectation | `4 passed` |

So the failure mode is worse than a silent pass: when such an assertion *would*
fail, the rejection escapes the test lifecycle and takes the **worker** down
rather than reporting a named failure — which is exactly how it stays unnoticed.

This has been sitting on `develop` since at least 2026-07-01, and is one of the
449 lines inside the stale PR **#1527**. Extracted here because a vacuous test is
a defect in its own right and should not wait on a 7-week-old PR being revalidated.

## Acceptance Criteria

### Happy path

- [ ] The assertion is awaited and the test genuinely fails when the code stops
      throwing.
- [ ] A guard prevents the whole class returning, not just this one line.

### Error paths

- [ ] The guard names the offending `file:line` so a failure is actionable
      without hunting.

### Edge cases

- [ ] The legitimate fake-timer pattern is **not** flagged:
      `const assertion = expect(p).rejects...; await advanceTimers(); await assertion;`
      — six of these exist in `android-adb-driver.test.js` and are correct.
- [ ] A multi-line `await expect(\n  fn()\n).rejects` is not a false positive.
- [ ] A **comment** mentioning the pattern is not flagged.
- [ ] The guard **excludes itself** — any guard that greps for a pattern contains
      that pattern in its own doc comment and test names.
- [ ] The guard is **not vacuous**: it asserts the scanned corpus is non-empty and
      that at least one file really uses an async matcher, so an empty scan cannot
      pass.

### Performance

- [ ] The guard is a file scan over the test corpus; it adds no meaningful time.

### Security

- [ ] N/A.

### UX

- [ ] N/A — developer-facing.

### i18n

- [ ] N/A.

### Observability

- [ ] Offenders are reported as `path:line: <source line>`.

## BDD Scenarios

**Scenario: A green test really did check something**

- **Given** a test that expects an operation to fail
- **When** the operation stops failing
- **Then** that test reports a failure

## Test Plan

**RED first, and mutation-proven both ways.**

1. Mutate the expected message → confirm the un-awaited form does **not** produce
   a clean failure (it crashes the worker).
2. Add `await`, keep the mutation → confirm a clean named failure.
3. Restore the expectation → confirm green.
4. Write the guard; confirm it passes on the fixed tree.
5. **Mutate the guard**: remove the `await` again → confirm the guard goes red and
   names `email-local.test.js:47`. A guard that has only ever been green proves
   nothing.

## Out of Scope

- **PR #1527**, which contains this fix among 449 lines. Its fate is a separate
  decision; this story does not revalidate it.
- Adding `eslint-plugin-jest`. `jest/valid-expect` with `asyncMatchers` would
  cover this, but it is a new dependency, and the codebase's established idiom is
  a home-grown greppable guard (`check-no-new-stubs.js`,
  `locale-string-content.test.js`). Worth revisiting if more of this class appears.
- The other vacuity class — assertions behind `if (count > 0)` guards. That is
  the still-unfiled SHY-0357.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The guard produces false positives and gets disabled | The legitimate fake-timer pattern, multi-line expects, and comments are all explicitly handled and covered by AC. |
| The guard is vacuous itself | It asserts a non-empty corpus **and** that the pattern is genuinely present, and it was mutation-tested. |
| The fix conflicts with #1527 | Same one-line change; a conflict is trivial to resolve in whichever lands second. |

## Definition of Done

- [ ] Assertion awaited; guard in place and mutation-proven.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Found while triaging the stale #1527. A line-based grep found
  only this one instance; the guard, which walks back from the matcher to the
  owning `expect(`, is the durable check.
