---
id: SHY-0276
status: Draft
owner: claude
created: 2026-08-04
priority: P2
effort: XS
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0276: The Playwright pre-push gate is a slower, weaker duplicate of a CI job

## User Story

As someone pushing work from this machine,
I want the pre-push hook to finish in seconds rather than half an hour,
So that pushing is cheap and the browser suite is enforced where it can actually be trusted.

## Why

`.husky/pre-push` runs Playwright on every push whose diff touches `public/` or `tests/web/`.
Measured twice on 2026-08-04: **17.2 min and 17.3 min**, back to back. That cost buys nothing that
CI does not already provide, and the gate is unreliable in three separate ways.

**1. It duplicates a CI job that already does more.** `playwright-web` (`pr-checks.yml` →
`playwright-tests.yml`) already stands up the whole stack on the runner — seeds data, serves
`public/` on `:8888`, runs the LiveKit/MinIO/Mailpit containers — and runs a **five-browser**
matrix (chromium, firefox, webkit, mobile-chrome, mobile-safari). The hook runs **chromium
only**. So the local gate is a strict subset of a job that runs anyway.

**2. It silently skips exactly when it matters.** `.husky/pre-push:222,226` — if `:3000` or
`:8888` is not answering, it prints a warning and lets the push through green:

```
⚠ Web changes detected but local stack not running — skipping Playwright pre-push
```

A gate that no-ops whenever the stack is down, while still reporting a successful push, is the
`if (check) { act() }`-with-no-else pattern: it produces confidence without evidence. Either it
costs 17 minutes or it checks nothing, and the push output looks similar in both cases.

**3. On a stacked branch it re-tests other stories' code.** `CHANGED` is computed as
`git diff --name-only origin/main...HEAD`, which on a stacked branch spans every commit beneath
it. Measured on `story/SHY-0275`: the three commits under test touched **0** files under
`public/` or `tests/web/`, while the diff versus `main` contained **28** — all from SHY-0270 /
0271 / 0272, each already tested on its own PR. Both pushes that evening paid full price to
re-run a suite for changes that had already passed it.

**It also causes a documented workflow conflict.** `[[feedback-no-push-during-gauntlet-prepush-playwright-conflict]]`
exists *only* because pre-push Playwright collides with a running device matrix — both drive the
same local stack. Removing the hook block dissolves that rule rather than working around it.

**What replaces it:** nothing new. `playwright-web` already runs post-push in CI against a
CI-hosted local stack, and the branch protections on `develop` (ruleset 19719048) and `main`
(12613584) already require `PR Gate` to pass before merge. The browser suite stays a hard gate;
it simply stops being enforced twice, once badly.

## Acceptance Criteria

### Happy path
- [ ] A push whose diff touches `public/` or `tests/web/` completes without running Playwright
- [ ] `playwright-web` still runs on the resulting PR and still gates the merge

### Error paths
- [ ] A genuinely failing browser test still blocks the merge, via CI rather than via the hook

### Edge cases
- [ ] A push made while the local stack is down behaves identically to one made while it is up —
      no silent difference in what was verified
- [ ] A push from a stacked branch is not charged for the branches beneath it

### Performance
- [ ] Pre-push wall-clock for a web-touching change drops from ~17 min to the hook's remaining
      fast guards (target: under 60s)

### Security
- [ ] No change to what is enforced before merge; the force-push guard, paid-runner check,
      release-trigger guard, node-version pin and stub ratchet all stay in the hook

### UX
- [ ] N/A — developer tooling; no user-facing surface.

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The hook no longer prints a "skipping Playwright" warning that implies a check happened

## BDD Scenarios

**Scenario: Pushing a web change is fast**
- **Given** a change to a web page
- **When** the developer pushes it
- **Then** the push completes without running the browser suite

**Scenario: A broken web page still cannot be merged**
- **Given** a change that breaks a web page
- **When** it is pushed and its pull request is checked
- **Then** the browser suite reports the failure and the merge is blocked

**Scenario: A push made with the stack down is honest about it**
- **Given** the local stack is not running
- **When** the developer pushes a web change
- **Then** nothing claims a browser check was skipped, because none was expected

## Test Plan

**CI-config-only classification.** This touches `.husky/pre-push` and its meta-tests only. No
app (`shared/**`, `app/**`, `iosApp/**`), backend (`express-api/src/**`, rules files) or website
(`public/**`) runtime surface changes, so per CLAUDE.md's second exemption it skips the
device/browser gauntlet — there is no user-observable behaviour to walk. It still runs the full
non-device gauntlet: the affected Jest script tests, `actionlint`, `eslint` + `prettier`
(`--max-warnings=0`), the story validator, `code-reviewer` 100%-clean, and CI green by name.

**RED first** — `express-api/tests/scripts/pre-push-no-playwright.test.js` (new):
- the hook contains no `npx playwright test` invocation;
- it contains no "skipping Playwright" branch, so no path can report a check it did not run;
- the fast guards that must SURVIVE are each still present — force-push/fast-forward check,
  `check-no-paid-runners.sh`, `check-release-trigger.sh`, `check-node-version.sh`,
  `check-no-new-stubs.js` — asserted individually so a future edit cannot quietly strip one
  while "removing Playwright";
- `pr-checks.yml` still wires the `playwright-web` job to `playwright-tests.yml`, so the gate is
  provably still enforced SOMEWHERE (this is the assertion that stops the change from being a
  net removal of coverage).

Each assertion is mutation-verified: re-adding the Playwright block reddens the first two;
deleting any one guard reddens its own case; unwiring `playwright-web` reddens the last.

**Regression** — `pr-checks-*.test.js` and any other test reading `.husky/pre-push` stay green;
`grep` the tree for readers of the hook before editing (`[[feedback-yaml-structure-grep-tests]]`).

**Proof it worked** — push a web-touching branch and observe the hook complete in seconds, then
observe `playwright-web` run and report on the resulting PR. Both halves are required: fast push
AND the CI job actually reporting. A fast push with no CI job is the failure mode.

## Out of Scope

- The `integration-tests` CI job, which has the same shape but was not measured here.
- Any change to what `playwright-tests.yml` runs — browsers, sharding, or trace settings.
- The Playwright WebKit timeout characterisation from SHY-0200.
- Making stacked-branch `CHANGED` computation smarter. Removing the block makes it moot for this
  hook; if another hook block ever needs a diff base, `merge-base` against the PR base is the fix.

## Dependencies

- None. `playwright-web` already exists and already runs.

## Risks & Mitigations

- **Risk:** a browser regression reaches the remote that previously would have been caught locally.
  **Mitigation:** it is caught by `playwright-web` on the PR, before merge, across five browsers
  rather than one — and branch protection blocks the merge until `PR Gate` is green. The window
  moves from "before push" to "before merge"; it does not open.
- **Risk:** someone later removes `playwright-web` too, leaving nothing.
  **Mitigation:** the new test asserts the CI job is still wired, so removing it reddens this
  story's own guard.
- **Risk:** "remove Playwright" turns into "remove the hook", taking the fast guards with it.
  **Mitigation:** each surviving guard has its own assertion.

## Definition of Done

- [ ] RED tests written first and seen to fail
- [ ] Playwright block removed from `.husky/pre-push`; fast guards untouched
- [ ] Pre-push measured under 60s on a web-touching change (was ~17 min)
- [ ] `playwright-web` observed running and reporting on the resulting PR
- [ ] `code-reviewer` 100% clean; CI green by name
- [ ] Merged to develop; `released_in:` at the next release cut

## Notes (running log)

- **2026-08-04 20:1x WIB** — Raised by the operator after two consecutive ~17-minute pushes:
  "playwright takes a long time as a pre-push hook … it should be just part of a post-push ci-run
  check instead." Confirmed against the config rather than from memory, and the case turned out
  stronger than the time cost alone: the CI job already exists and covers five browsers to the
  hook's one, the hook silently skips when the stack is down, and on a stacked branch it charges
  for the branches beneath it. Operator confirmed the intended target is the existing
  CI-hosted-local-stack job, so this is deletion rather than new plumbing, and asked for the story
  to be filed now and implemented after the running journey gauntlet completes.
