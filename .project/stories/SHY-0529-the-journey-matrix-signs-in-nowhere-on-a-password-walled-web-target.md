---
id: SHY-0529
status: In Review
owner: claude
created: 2026-09-07
priority: P0
effort: S
type: bug
roadmap_ids: []
mvp: false
---

# The journey matrix signs in nowhere on a password-walled web target

## User Story

As the operator running the journey matrix against the dev environment,
I want the browser the matrix drives to get past the non-prod password wall,
so that a matrix run tells me whether ShyTalk works instead of telling me
that a locked door is locked.

## Why

The dev journey matrix run `20260906-184009-dev` reported **0 passed, 559
failed** across every feature file. A uniform failure across unrelated
features is never 559 product defects — it is one shared broken
precondition.

Every non-production ShyTalk web host sits behind an HTTP Basic password
wall served by the Cloudflare Pages middleware. The dev site itself is
healthy: it returns 401 without a password and 200 with one, serving the
expected page, and the deployed commit matches the tip that was released.

The browser the matrix drives has never been given that password. Every
page it opened returned "401 Unauthorized", so every scenario asserted
against an empty error page and failed. The two Playwright specs that do
carry the password have always passed, which is why the gap stayed
invisible: the wall only exists on the deployed environments, and the
matrix is normally exercised locally where there is no wall at all.

Two things are wrong, and fixing only the first leaves the trap armed:

1. The browser is never given the password.
2. When the password is missing or wrong, the run proceeds anyway and
   spends hours producing 559 meaningless failures instead of stopping
   immediately with a one-line explanation.

## Acceptance Criteria

### Happy path

- Given the matrix is pointed at a password-walled ShyTalk web target and
  the password is available to the run, when a scenario opens any page,
  then the page loads the real ShyTalk site rather than a password prompt.
- Given the matrix is pointed at the local development site, which has no
  password wall, when a scenario opens any page, then it loads exactly as
  it does today and no password is sent.
- Given the matrix is pointed at the live public site, which has no
  password wall, when a scenario opens any page, then it loads exactly as
  it does today and no password is sent.

### Error paths

- Given the matrix is pointed at a password-walled target and no password
  is available, when the run starts, then it stops immediately with a
  message naming the target and the exact step needed to supply the
  password, and it does not attempt a single scenario.
- Given the run stops for a missing password, when the operator reads the
  result, then the run is reported as a setup failure and not as failed
  scenarios, so a broken environment can never be mistaken for broken
  product behaviour.
- Given a password is supplied but the wall rejects it, when the run
  starts, then the failure names the rejected password as the cause rather
  than reporting hundreds of unrelated scenario failures.

### Edge cases

- Given a target whose address merely resembles a ShyTalk address but is
  not one, when the run starts, then it stops and refuses to continue, and
  the password is never sent to that address.
- Given the live public site's address written with different letter
  casing, when the run starts, then it is still recognised as the live
  site and no password is sent.
- Given a temporary preview deployment of the web site, when the run
  starts, then it is treated as password-walled, because every non-live
  deployment is.
- Given a local address written as a loopback address rather than by name,
  when the run starts, then it is treated as having no wall.

### Performance

- The decision about whether a target is walled is made once when the run
  starts, not on every page open, so a long matrix run pays no repeated
  cost.
- A run that must stop for a missing password stops within seconds, in
  place of the multi-hour run it replaces.

### Security

- The password is read from the environment at run time and is never
  written into the repository, a log line, a screenshot caption, a report
  file, or an error message.
- The password is sent only to addresses recognised as belonging to
  ShyTalk's own non-live web hosts. Any other address is refused outright
  rather than being given the password.
- Address matching for the live site uses exact comparison, never a
  partial or "contains" match, so a lookalike address cannot impersonate
  the live site to suppress the wall or attract the password.
- The rule for what counts as the live site is taken from the single
  existing definition that the wall itself uses, so the two can never
  drift apart.

### UX

- The message shown when the password is missing tells the operator, in
  one line, which target needed it and what to run to provide it.
- The operator needs no new flag, argument, or per-run step: pointing the
  matrix at a walled target is enough for it to ask for what it needs.

### i18n

- Not applicable. This affects the internal test harness only; no
  user-facing surface, string, or locale file changes.

### Observability

- The run's startup output records whether the target was treated as
  walled, unwalled, or refused, so a future run can be diagnosed from its
  own output without re-deriving the rule.
- The recorded line names the target address and the classification only,
  never the password.

## BDD Scenarios

```gherkin
Feature: Reaching a password-walled ShyTalk site during a matrix run

  Scenario: The matrix reaches the dev site behind its password wall
    Given the dev site is protected by a password
    And the password is available to the run
    When the matrix opens the ShyTalk home page
    Then the real ShyTalk page is shown
    And no password prompt is shown

  Scenario: The matrix stops when the password is missing
    Given the dev site is protected by a password
    And no password is available to the run
    When the operator starts the matrix
    Then the run stops before any scenario is attempted
    And the operator is told which target needed a password

  Scenario: The live site is never sent a password
    Given the live site is not protected by a password
    When the matrix opens the ShyTalk home page
    Then the page loads
    And no password is sent to the live site

  Scenario: An unrecognised address is refused
    Given the matrix is pointed at an address that is not a ShyTalk site
    When the operator starts the matrix
    Then the run stops before any scenario is attempted
    And no password is sent to that address
```

## Test Plan

- Unit tests for the target classifier covering: the live site (exact
  match, and mixed casing), the dev site, a preview deployment, a local
  address by name, a local address as a loopback number, and a lookalike
  address that must be refused.
- Unit tests for the browser driver asserting the credentials actually
  reach the browser context for a walled target, are absent for the local
  and live targets, and that construction fails loudly for a walled target
  with no password and for an unrecognised address.
- A test that fails if the driver is constructed without consulting the
  classifier at all, so a future edit cannot quietly drop the wiring.
- Full existing driver suite must stay green, proving the change is
  additive for the local target that every developer uses.
- Verification run: the `chromium` leg of the dev matrix, which needs no
  physical device, must load real pages. Success is measured by scenarios
  that assert against real content, not merely by a non-zero pass count.

## Out of Scope

- The on-device mobile browser drivers. They drive a real browser on a
  physical phone and cannot be given credentials the same way; that gap is
  real but needs a device present to investigate and will be filed
  separately once diagnosed.
- The native Android and iOS app drivers. The app talks to the API, which
  has its own authentication and is not behind this wall.
- Any change to the wall itself, its password, or where that password is
  stored.
- Re-running the full matrix and clearing the resulting product defects.
  This ticket makes the matrix capable of reporting real results; acting
  on those results is separate work.

## Dependencies

- The non-prod wall implemented by the Cloudflare Pages middleware, which
  remains the authority on which hosts are walled.
- The dev password must be present in the environment of any run that
  targets a walled host. It already is for the deploy pipeline and for the
  existing Playwright specs.

## Risks & Mitigations

- **Risk:** the classifier and the wall drift apart, so the matrix sends
  credentials to the live site or withholds them from dev.
  **Mitigation:** the classifier reuses the wall's own definition of the
  live host rather than restating it, and tests pin both directions.
- **Risk:** the password leaks into a log, report, or screenshot caption.
  **Mitigation:** it is read from the environment at the moment of use,
  never stored on the driver's reported state, and the observability line
  records the classification only.
- **Risk:** a hostile or mistyped address is handed the dev password.
  **Mitigation:** unknown addresses are refused rather than defaulted to
  walled; refusal is a startup failure with a named cause.
- **Risk:** the fix wires the credentials but a wrong password still
  produces an uninformative mass failure.
  **Mitigation:** the loud-failure requirement is a first-class acceptance
  criterion with its own test, not a side effect of the wiring.

## Definition of Done

- All acceptance criteria met and covered by tests written before the
  implementation.
- The full express-api test suite passes, including the pre-existing
  driver tests, unchanged in behaviour for the local target.
- The dev matrix `chromium` leg has been run and demonstrably loads real
  ShyTalk pages, with the evidence recorded on the ticket's evidence page.
- A run with the password deliberately removed stops in seconds with the
  intended message, proving the loud-failure path rather than assuming it.
- Reviewed inline, merged into `develop`, and `develop` deployed to the
  dev environment.

## Notes

- Discovered while clearing the first gate of the 2026-09-06 handover:
  proving that dev-web loads. Dev-web *does* load; the matrix could not
  reach it.
- This is a test-harness defect, not a product defect. Its severity is
  that it masked the state of the entire product: for as long as it stood,
  no dev matrix run could report anything true about ShyTalk.
- Device-independent, and therefore workable while the physical test
  phones are unavailable.
