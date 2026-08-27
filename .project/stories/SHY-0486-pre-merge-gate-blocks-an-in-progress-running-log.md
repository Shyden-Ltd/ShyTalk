---
id: SHY-0486
status: Draft
owner: unassigned
created: 2026-08-28
priority: P2
effort: S
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0486: The pre-merge gate blocks updating an In Progress story's running log

## User Story

As **whoever keeps an umbrella story current**, I want to record progress on it
while it is in progress, so that the story states its own state rather than
relying on a handover somebody has to go looking for.

## Why

`check-pr-story-status.js` fails any PR whose diff modifies a story `.md` unless
that story's status is `In Review`, `Done` or `Cancelled`. The only exemption is
a **newly added** story at `Draft`.

So a story at **`In Progress`** cannot be edited by any PR — including a PR whose
only purpose is to append to that story's **running log**, which is what an
umbrella's log exists for.

Hit on 2026-08-28: a docs-only PR appending five completed slices to SHY-0113's
running log was refused:

```
pre-merge-gate: .project/stories/SHY-0113-....md has status "In Progress" —
it must be "In Review" (or Done/Cancelled) before this PR can merge.
```

The two ways out are both wrong:

- Flip SHY-0113 to `In Review`. It is not — it has remaining slices, and the
  status would be a lie told to satisfy a check.
- Never update the log. Then the umbrella cannot say what has been done under
  it, and its progress lives only in handovers, which is the "see session notes"
  pattern the repo forbids in durable artefacts.

The gate is right about what it was built for — **do not merge implementation
whose story is not ready**. It just cannot tell that from **appending to the log
of a story that is deliberately still open**.

## Acceptance Criteria

### Happy path

- [ ] A PR that only appends to an `In Progress` story's running log can merge.
- [ ] A PR carrying implementation for a story that is not ready still cannot.

### Error paths

- [ ] The refusal message distinguishes the two cases, so the next person does
      not conclude the fix is to flip the status.

### Edge cases

- [ ] A PR that changes an `In Progress` story's **frontmatter or acceptance
      criteria** is still refused — those are not a running log.
- [ ] The add-only `Draft` exemption is unchanged.

### Performance

- [ ] None.

### Security

- [ ] None.

### UX

- [ ] None.

### i18n

- [ ] None.

### Observability

- [ ] The gate says which rule it applied, not only that it failed.

## BDD Scenarios

**Scenario: Recording progress on ongoing work**

- **Given** a piece of work that is deliberately still open
- **When** somebody writes down what has been finished so far
- **Then** that record can be saved

## Test Plan

| Layer | What it proves |
| --- | --- |
| Script test | An `In Progress` story with a body-only change passes. |
| Script test | An `In Progress` story with a frontmatter or AC change still fails. |
| Script test | The add-only `Draft` exemption is untouched. |

## Out of Scope

- Widening `ALLOWED` to include `In Progress` outright. That would let
  implementation merge against a story nobody has marked ready, which is the
  thing the gate exists to stop.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** a "log-only" carve-out becomes a way to smuggle AC changes past the
  gate. **Mitigation:** the carve-out is defined by WHICH part of the file
  changed — frontmatter and Acceptance Criteria are excluded — and a test pins
  it.

## Definition of Done

- [ ] An `In Progress` running-log append can merge.
- [ ] An `In Progress` AC change still cannot.

## Notes

Filed **Draft** rather than fixed: loosening a merge gate is a policy decision,
and the operator may prefer a different shape — for example a `Merged` status, or
requiring log updates to ride with the slice PR that produced them.

Worked around for now by dropping the log update from the docs PR. The progress
it recorded is in handover part 23.
