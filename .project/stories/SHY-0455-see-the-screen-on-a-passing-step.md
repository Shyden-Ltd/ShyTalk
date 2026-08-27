---
id: SHY-0455
status: In Review
owner: unassigned
created: 2026-08-25
priority: P3
effort: S
type: feature
roadmap_ids: []
mvp: false
---

# SHY-0455: See the screen on a passing step, not only a failing one

## User Story

As **whoever is reading a journey run**, I want to see what was on screen at
each step, so that I can answer a question about the app without having to make
it fail first.

## Why

Operator, 2026-08-25:

> "The passing log doesn't dump tags (only failures do) — can we run it in a
> 'debug mode' or something similar so that we can see these logs, even without
> failures."

The runner dumped the screen only when a step FAILED. That is the right default
— the dump costs a full screen read, ~65ms on Android but ~700ms on iPhone, and
a fourteen-journey matrix makes several hundred steps — but it meant the only
way to see what a screen actually contained was to break it.

It came up while checking whether the preview watermark was rendering its full
contents. The run was green, so the log said nothing about the screen, and the
alternative was a screenshot — which is the wrong instrument: a person reading a
picture is a weaker and quieter oracle than the text the runner already holds.

## Acceptance Criteria

### Happy path

- [x] `--debug` prints the on-screen tags after every step, passing or failing.
- [x] Without it, behaviour is exactly as before.

### Error paths

- [x] A FAILING step is still dumped whether or not the flag is set. The
      diagnostic that already existed must not become opt-in.
- [x] A dump that itself fails does not fail the step.

### Edge cases

- [x] The flag is recorded in the run's `meta`, so the report says whether its
      passing steps carry a screen rather than leaving a reader to infer it.

### Performance

- [x] Off by default, because the cost is a screen read per step and on iPhone
      that is minutes across a matrix.

### Security

- [x] No change. The same tags a failing step already printed.

### UX

- [x] `--help` names the flag. `--platform` was parsed, typo-checked and
      undocumented for months; a flag only the author knows is not a feature.

### i18n

- [x] No change.

### Observability

- [x] This IS the observability change.

## BDD Scenarios

**Scenario: Somebody wants to see a screen that is working**

- **Given** a journey whose steps all pass
- **When** it is run in debug mode
- **Then** the log shows what was on screen at each step

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The flag parses, defaults off, and `--help` names it. |
| Unit | The capture policy: a failure is always captured, a pass only in debug. |
| Device | A green journey run with `--debug` prints tags for passing steps. |

## Out of Scope

- Making the dump cheaper. That is the iOS screen-read cost, which is its own
  problem (~690ms against Android's ~65ms) and much larger than this story.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Somebody leaves `--debug` on in an automated run and it gets slower | Off by default and named in the summary meta, so a slow run can be explained. |
| The policy drifts so failures stop being captured | The predicate is a pure function with its own test, asserted in both directions. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [x] Demonstrated on a real device: J-ALICE green, tags printed per step.

## Notes

- Filed 2026-08-25 from the operator's request, during SHY-0454's verification.
