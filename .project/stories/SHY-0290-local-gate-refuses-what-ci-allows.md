---
id: SHY-0290
status: Draft
owner: claude
created: 2026-08-06
priority: P2
effort: S
type: infra
roadmap_ids: []
pr:
---

# SHY-0290: The local merge gate refuses a PR that CI allows

## User Story

As someone about to merge,
I want the local gate's verdict to mean the same thing as CI's,
So that when it refuses I investigate instead of shrugging and merging anyway.

## Why

`scripts/pre-merge-check.sh` exists to predict the CI Pre-Merge Gate before you
push. On 2026-08-06 the two disagreed on a real PR: **#1704 filed EPIC-0010 and
Cancelled the four stories it supersedes.** CI's
`scripts/check-pr-story-status.js` allowed it — its `ALLOWED` set is
`{In Review, Done, Cancelled}` and it passed by name. The local script refused
it outright.

The divergence is deliberate and documented in three places — the script
header ("Only `In Review` passes locally"), an inline comment ("the local gate
stays stricter than CI on terminals"), and a dedicated test, `REFUSES on a
Cancelled story`. So this is NOT a bug to be quietly fixed; the behaviour is
pinned on purpose. The stated reason is that "you don't merge a Done/Cancelled
story via a normal PR" and CI "tolerates Done/Cancelled for incidental"
changes.

What the design did not anticipate is a PR where cancelling IS the work. A
supersession — filing an epic that retires the tickets it replaces — has no
implementation to be In Review about, and the four cancelled stories carry
nothing but a status flip and a Notes line.

The cost is not the one blocked merge. It is that a gate which cries wolf stops
being read. #1704 was merged on CI's verdict after confirming the three
required checks green by name, which is the correct outcome and exactly the
habit that makes the local gate worthless if it recurs.

## Acceptance Criteria

### Happy path

- [ ] A supersession PR — new Draft stories added, existing stories moved to
      Cancelled, no implementation — passes the local gate.
- [ ] The local gate's verdict matches CI's on every status combination that
      CI accepts.

### Error paths

- [ ] A story Cancelled as part of a PR that ALSO changes implementation files
      still refuses — that is the case the current strictness exists for, and
      it must survive.
- [ ] A story modified to Draft still refuses.
- [ ] A newly-added non-Draft story still refuses.

### Edge cases

- [ ] A Cancelled story with no `Reviewed-up-to:` marker passes, because there
      is no reviewed implementation for it to point at.
- [ ] A PR mixing a filing (added Draft), a supersession (modified Cancelled)
      and an implementation (modified In Review) is judged per story, not
      per PR.

### Performance

- [ ] N/A — the gate is a local shell script over a diff; no measurable cost.

### Security

- [ ] N/A — no new inputs, no new privileges, no network.

### UX

- [ ] When the gate refuses, the message names the story, its status, and what
      would make it pass. A refusal that does not say what to do is why gates
      get ignored.

### i18n

- [ ] N/A — developer tooling, English only, no user-facing strings.

### Observability

- [ ] The gate prints one line per story explaining which rule applied
      (In Review / filing exemption / supersession), so a verdict can be
      audited without re-reading the script.

## BDD Scenarios

**Scenario: A supersession PR passes**

- **Given** a pull request that files a new story and retires the ones it replaces
- **When** the local gate runs
- **Then** it passes, and says which rule it applied to each story

**Scenario: A cancellation hidden inside real work still refuses**

- **Given** a pull request that changes implementation and also cancels a story
- **When** the local gate runs
- **Then** it refuses and names that story

**Scenario: The two gates agree**

- **Given** any pull request the CI gate accepts
- **When** the local gate runs on the same branch
- **Then** it reaches the same verdict

## Test Plan

**RED first**, in `express-api/tests/scripts/pre-merge-check.test.js` (which
already has the harness — `init()`, `writeStory()`, `commit()`, `run()`):

- A supersession fixture (added Draft + modified Cancelled, no other files)
  passes. RED today.
- A Cancelled story alongside a changed `express-api/src/**` file still
  refuses. Should stay GREEN — it is the protection being preserved.
- A Cancelled story with no `Reviewed-up-to:` passes.
- Modified-to-Draft and added-non-Draft still refuse.
- A parity test asserting the local script's accepted statuses are a superset
  of `check-pr-story-status.js`'s `ALLOWED`, read from that file rather than
  restated — the divergence existed because two implementations each held
  their own copy of one rule.

The existing `REFUSES on a Cancelled story` test must be REWRITTEN, not
deleted: it currently pins the behaviour being changed. Its replacement pins
the narrower rule (cancelled + implementation refuses).

**GREEN:** widen the local gate per the chosen option below.

## Out of Scope

- Changing CI's `check-pr-story-status.js`. It is the authoritative required
  check and its behaviour is correct; this story moves the local helper toward
  it, never the reverse.
- The human-judgment checklist the gate prints. Unchanged.

## Dependencies

- None.

## Risks & Mitigations

- **The strictness is deliberate, so widening it could let through the thing it
  was built to catch.** Mitigation: the widening is conditional on the PR
  containing no implementation change, and the existing protection keeps a
  test of its own. If that condition proves hard to express cleanly, the
  fallback is an explicit opt-in flag (`--supersession`) so the default stays
  strict.
- **Operator may prefer the gates to stay different.** Then the fix is the
  message, not the rule: the refusal should say "CI would allow this; the local
  gate is deliberately stricter — see the header" so it is understood rather
  than ignored. Either outcome closes the story; the current state, where the
  gate is silently wrong about a legitimate PR, does not.

## Definition of Done

- [ ] All AC met; the new tests written RED first; the rewritten test pins the
      narrower rule.
- [ ] Local gate and CI gate reach the same verdict on a supersession PR.
- [ ] `code-reviewer` 100% clean; CI green by name; `Reviewed-up-to:` recorded.
- [ ] CI-config-only (no app, backend, or website runtime surface) — the
      device/browser gauntlet is not applicable per the SHY-0163 exemption.

## Notes (running log)

- **2026-08-06 08:40 WIB** — Found while merging PR #1704 (EPIC-0010 filing).
  The local gate refused; CI's Pre-Merge Gate passed. Checked the test suite
  before touching the script and found `REFUSES on a Cancelled story` pinning
  the behaviour deliberately, plus two comments explaining why — so this is a
  design decision to put to the operator, not a defect to fix unilaterally
  while they are away. #1704 was merged on CI's verdict after confirming
  Detect Changes, Analyze JavaScript and PR Gate green by name.
- **2026-08-06 08:40 WIB** — Root cause of the divergence is duplication: the
  same rule is implemented twice, in bash and in JavaScript, each with its own
  copy of the allowed-status list. Whatever verdict the operator picks, the
  parity test in the Test Plan is what stops them drifting again.
