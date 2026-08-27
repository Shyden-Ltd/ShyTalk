---
id: SHY-0476
status: Done
owner: unassigned
created: 2026-08-27
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
released_in: v0.99.0
---

# SHY-0476: The shared-header Sign In test races the header it clicks

## User Story

As **whoever promotes develop to main**, I want the web suite to be green on
WebKit, so that a promotion is not held up by a test that is wrong rather than
by a product that is broken.

## Why

`tests/web/shared-header-signin-fallback.spec.ts:41` fails on **both** WebKit
projects — `webkit` and `mobile-safari` — on the develop→main promotion, and
passes locally in 7.3s. It is deterministic, not flaky: the same test, both
engines, every run.

The two tests in that file do not wait for the same thing:

```js
// homepage test — waits for the HEADER
await page.waitForFunction(() => !!document.querySelector('[data-testid="shared-header"]'));

// roadmap test — waits only for the MODAL HOOK
await page.waitForFunction(() => typeof window.shytalkShowLoginModal === 'function');
```

The roadmap test then reaches straight for the button:

```js
const btn = document.querySelector('[data-testid="header-signin-btn"]');
if (!btn) return { invoked: false, calledWith };
```

`shared-header.js` injects the header itself, and the modal hook is registered by
a **different** script (`suggestions-board.js`). Waiting for one says nothing
about the other. When the header has not been injected yet, `btn` is null and the
test reports `invoked: false` — indistinguishable, in the output, from a Sign In
button that is genuinely broken.

WebKit injects the header later than Chromium under CI load, so the race only
ever loses there.

### The product is fine

`shared-header.js` reads `window.shytalkShowLoginModal` at CLICK time, so the
spy the test installs is seen whenever the button exists. Nothing about the Sign
In flow is broken; the test simply clicks before there is anything to click.

## Acceptance Criteria

### Happy path

- [ ] The test waits for the header AND the modal hook before clicking.
- [ ] It passes on chromium, firefox, webkit and mobile-safari.

### Error paths

- [ ] A missing button fails with a message that says the button was missing,
      not `invoked: false`.

### Edge cases

- [ ] The test still fails if the modal hook is genuinely never invoked — the
      wait is not allowed to mask the defect it exists to catch.

### Performance

- [ ] The wait exits the moment the header appears; no fixed delay is added.

### Security

- [ ] None: test-only.

### UX

- [ ] None. No production change.

### i18n

- [ ] None.

### Observability

- [ ] The failure names which of the two preconditions was missing.

## BDD Scenarios

**Scenario: Somebody signs in from the roadmap**

- **Given** somebody on the roadmap page
- **When** they choose Sign In
- **Then** the sign-in box opens on the page

## Test Plan

| Layer | What it proves |
| --- | --- |
| Playwright (webkit) | The test passes on the engine that failed. |
| Playwright (mobile-safari) | Same, on the second WebKit project. |
| Playwright (all projects) | No regression on chromium or firefox. |
| Mutation | Removing the modal hook still fails the test. |

## Out of Scope

- `shared-header.js`. It is correct.
- The `admin-users-profile` test, flaky on both WebKit projects in the same run
  and passing on retry — separate, and not blocking.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** the added wait masks a real failure. **Mitigation:** an AC and a
  mutation check require the test to still fail when the hook is absent.
- **Risk:** treated as flake and retried away. **Mitigation:** it is
  deterministic on both WebKit projects; retries did not rescue it.

## Definition of Done

- [ ] Green on all four Playwright projects.
- [ ] A missing button reports itself as a missing button.

## Notes

Found on the develop→main promotion (#2033). `playwright-web` runs on PRs whose
web files changed, so a test that only loses under WebKit CI load can survive a
long time before a promotion surfaces it.
