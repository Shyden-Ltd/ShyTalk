---
id: SHY-0292
status: Draft
owner: claude
created: 2026-08-06
priority: P2
effort: M
type: refactor
roadmap_ids: []
pr:
mvp: false
---

# SHY-0292: firebase-admin 14 breaks the backend suite

## User Story

As someone keeping ShyTalk's dependencies current,
I want the Express API to run on a supported major of firebase-admin,
So that we are not left behind on the SDK the entire backend depends on.

## Why

Dependabot PR **#1520** bumps `firebase-admin` from **13.10.0 to 14.1.0** — a
major version — and the backend suite fails. Brought up to date with develop
first, so these are real failures and not the stale ones that were sitting on
the PR since 2026-07-25.

Observed on the rebased branch: multiple `tests/scripts/manual-qa-runner`
suites fail, and `tests/middleware/auth-ban-gate.test.js` fails to run at all
with `TypeError: Cannot read properties of undefined (reading 'length')` —
which reads like a changed return shape rather than a renamed method.

This is a migration, not a rebase. Left alone it strands the backend on a major
that will stop receiving fixes, and every subsequent firebase-admin bump piles
up behind it. The Express API is the single authorization chokepoint for every
client, so it is not a dependency to fall behind on quietly.

## Acceptance Criteria

### Happy path

- [ ] The Express API runs on firebase-admin 14.x with the full backend suite
      green.
- [ ] Every Admin SDK call site is on the 14.x shape, not shimmed.

### Error paths

- [ ] The `TypeError` in `auth-ban-gate` is traced to the actual API change
      and fixed there, not caught and defaulted.
- [ ] Admin SDK errors still surface as the same HTTP responses to clients —
      an auth failure must not become a 500.

### Edge cases

- [ ] Any call whose RETURN SHAPE changed in 14.x is found by reading the
      migration guide and grepping the call sites, not by fixing whichever
      test happened to fail first.
- [ ] Emulator-backed suites pass against the real local stack, not only in
      CI.

### Performance

- [ ] No regression in cold-start or per-request latency attributable to the
      SDK change.

### Security

- [ ] Token verification, custom claims and the ban gate behave identically —
      these are the authorization chokepoint, so "the tests pass" is not
      sufficient without reading the diff at those call sites.

### UX

- [ ] N/A — server-side only, no user-facing surface.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] Existing Admin SDK error logging still fires with the same shape, so a
      production failure is diagnosable.

## BDD Scenarios

**Scenario: The backend runs on the new major**

- **Given** the Express API is on firebase-admin 14
- **When** the backend suite runs against the real local stack
- **Then** it passes with nothing skipped

**Scenario: A banned account is still refused**

- **Given** an account with an active ban
- **When** it calls an authenticated endpoint
- **Then** it is refused exactly as it was on the previous major

**Scenario: A valid token is still accepted**

- **Given** a signed-in account in good standing
- **When** it calls an authenticated endpoint
- **Then** the request succeeds

## Test Plan

**RED first:** the existing suite IS the red — `npm test` on the rebased #1520
branch fails today in `tests/middleware/auth-ban-gate.test.js` and several
`tests/scripts/manual-qa-runner` suites. Capture the exact failures before
changing anything, so the fix can be proven to have changed THAT failure.

Then, per call site changed:

- `tests/middleware/auth-ban-gate.test.js` — the ban gate against a real
  emulator, covering active ban, expired ban and no ban.
- Token verification and custom-claims suites, against the real emulator.
- The manual-qa-runner state-seed suites that failed.

**GREEN:** migrate the call sites per the firebase-admin 14 migration guide.

**Regression:** the FULL backend gauntlet. Per the repo's rule a backend change
means every client needs retesting, so this lands with the full app + web
matrix, not backend tests alone.

## Out of Scope

- The Android firebase-bom deprecations (SHY-0291) — different SDK.
- Any behaviour change. This is a like-for-like migration; if 14.x makes a
  behaviour change desirable, that is a separate story.

## Dependencies

- Dependabot PR #1520 is the trigger and stays open until this lands.

## Risks & Mitigations

- **The failing tests are in the authorization path.** A migration that makes
  them green without understanding the change could weaken the ban gate.
  Mitigation: the Security AC requires reading the diff at those call sites,
  and the ban gate gets its own scenarios rather than relying on the suite
  going green.
- **A major bump can change return shapes silently** — the `undefined.length`
  failure is that signature. Mitigation: grep every Admin SDK call site
  against the migration guide rather than fixing test-by-test.
- **Backend ⇒ full gauntlet**, so this is not a quick merge. That cost is the
  rule, not an exception to argue about.

## Definition of Done

- [ ] All AC met; the failing suites proven to fail before and pass after.
- [ ] Full backend + client gauntlet per the Pre-Merge Testing Protocol, local
      then dev, on real devices.
- [ ] #1520 merges green.
- [ ] `code-reviewer` 100% clean; CI green by name; `Reviewed-up-to:` recorded.

## Notes (running log)

- **2026-08-06 10:30 WIB** — Found by bringing #1520 up to date with develop
  (85 commits behind, failing on runs that predated the WebKit fix). Rebasing
  first is what separated "stale CI" from "the bump genuinely breaks us" — the
  other four Dependabot PRs treated the same way went green and merged.
