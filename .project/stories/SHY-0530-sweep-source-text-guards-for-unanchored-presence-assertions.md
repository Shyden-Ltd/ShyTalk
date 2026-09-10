---
id: SHY-0530
status: Draft
owner: unassigned
created: 2026-09-10
priority: P1
effort: M
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0530: Sweep source-text guards for unanchored presence assertions

## User Story

As **the operator who relies on static guards to hold a contract no runtime
test covers**, I want every guard that asserts a setting EXISTS to be anchored
to that setting's real syntax rather than to the token appearing anywhere in
the file, so that deleting the setting turns the guard red instead of leaving
it green because the comment above it still names the thing.

## Why

Found 2026-09-10 while committing SHY-0520, and **measured rather than
reasoned**.

`express-api/tests/scripts/dependabot-retarget-security-updates.test.js`
asserted:

```js
expect(content).toMatch(/pull_request_target:/);
```

against the whole file. Line 12 of the workflow it reads is:

```yaml
# Why pull_request_target: a `pull_request` run on a bot-owned branch gets a
```

The real trigger was deleted — so the workflow would not fire at all — and the
comment left in place. **All 22 assertions still passed.** The guard could not
see its own workflow stop firing. Anchoring to `/^[ \t]+pull_request_target:/m`
made the same mutation fail 1 of 22. Fixed in `c11a55a2f84`.

### This is not the variant already known

Prior work on this class has been about guards asserting **absence**, fouled by
a comment naming the thing, with the remedy "strip comments before matching".
This is the opposite direction and hides far better:

| | absence assertion | **presence assertion** |
| --- | --- | --- |
| Comment names the thing | goes **RED** — you find out | stays **GREEN** |
| After the real setting is deleted | correctly red | **still green, forever** |

Stripping comments would have fixed it, but nothing would have prompted anyone
to: on the day it was written it matched real config, so both directions
passed. It becomes vacuous only later, silently, at the moment it is most
needed.

## Acceptance Criteria

- [ ] The file set is **derived from the filesystem**, not from a list written
      into this story. A hand-written scope is the failure that has already
      been paid for more than once.
- [ ] For every guard reading source text, each PRESENCE assertion is checked
      against a **comments-only projection** of its target file. Anything that
      still matches is satisfiable by prose alone.
- [ ] Each finding is fixed by **anchoring to the real syntax** — a YAML key at
      line start, a TS declaration — not only by stripping comments. An anchor
      states what is being asserted; a strip merely removes one way of faking
      it.
- [ ] Every fix is mutation-verified in BOTH directions: delete the real
      setting with the comment left in place and watch it red; restore it and
      watch it pass. Predict the expected result before running, so a pass is
      evidence rather than relief.
- [ ] A guard-on-guards prevents a new unanchored presence assertion from
      landing, detecting it **structurally rather than by name**.
- [ ] The count of guards inspected and the count fixed are both recorded, so
      "swept" is a number rather than an adjective.

## BDD Scenarios

```gherkin
Scenario: a presence assertion cannot survive deletion of what it guards
  Given a guard asserting that a workflow sets `pull_request_target`
  And a comment in that workflow explaining why it does
  When the real setting is deleted and the comment is left in place
  Then the guard fails

Scenario: the guard-on-guards rejects a new unanchored assertion
  Given a new test asserting a setting exists by scanning whole file content
  When the suite runs
  Then it fails, naming the assertion and the anchor it needs
```

## Test Plan

Mechanical, and cheap to run: build a comments-only projection of each guarded
file and re-run each guard's presence patterns against it. Anything matching is
a finding. Confirm each finding with the deletion mutation before fixing it —
a pattern matching a comment is only a defect if the guard would still pass
without the real setting.

## Out of Scope

- shyden.co.uk, tracked separately in that repo's issue #98.
- The absence-assertion variant, which is already understood and remedied by
  comment stripping.

## Dependencies

None. Independent of SHY-0520, though that is where it was found.

## Risks & Mitigations

- **Risk:** the sweep finds many assertions that match comments but are not
  actually vacuous, because the real setting is also present.
  **Mitigation:** the deletion mutation is the test, not the comment match. The
  match only shortlists.
- **Risk:** anchoring too tightly makes a guard brittle against legitimate
  reformatting.
  **Mitigation:** anchor to syntax that the formatter preserves — a key at line
  start with leading whitespace — not to exact column positions.

## Definition of Done

Every source-text guard in the repo has been inspected by a derived sweep, each
finding is anchored and mutation-verified both ways, a structural guard-on-
guards is in place, and the inspected/fixed counts are recorded on this story.

## Notes

Found while committing SHY-0520's implementation, which had been sitting
uncommitted and unpushed on a local-only branch. The `pull_request` absence
check three lines below the defect already had the anchor right — running one
against the other is what made the gap visible, not reading either.
