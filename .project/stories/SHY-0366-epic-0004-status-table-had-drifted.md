---
id: SHY-0366
status: In Progress
owner: unassigned
created: 2026-08-20
priority: P2
effort: XS
type: docs
roadmap_ids: []
mvp: false
---

# SHY-0366: EPIC-0004's child statuses say nothing has started, when half of it has

## User Story

As **whoever picks up EPIC-0004 next**, I want the epic to state where each child
actually is, so that I do not plan work that is already merged or start work that
is blocked.

## Why

`EPIC-0004-persistent-session-instant-coldstart.md` annotated **every** child as
`Status: Draft`. The real state on `develop`:

| Child | Epic said | Actually |
| --- | --- | --- |
| SHY-0143 | Draft | **In Review — MERGED** (#1752, 2026-08-16) |
| SHY-0144 | Draft | **In Review — PR #1846 open**, device-proven |
| SHY-0145 | Draft | Draft — correct, and gated on #1846 |
| SHY-0146 | Draft | Draft — correct, but **no longer blocked** |
| SHY-0147 | Draft | **In Review — PR #1853 open** |
| SHY-0148 | Draft | **In Review — MERGED** (#1847) |

So the epic implied nothing had started when four of six children were underway
or done. The previous session recorded this explicitly: *"Fix the epic's
child-status table on pickup — it cost me real time."* It then cost this session
time as well, which is the argument for fixing it rather than working around it.

Two blockers recorded in the epic were also **stale**:

- **SHY-0146** was described as needing a multi-GB iOS Simulator runtime
  download. The iOS 27.0 runtime **is installed** (7.8 GB, Ready); only simulator
  *devices* are missing, and `xcrun simctl create` makes one in seconds.
- **SHY-0147** is not blocked on the code. It is blocked on one operator-run
  CodeQL dismissal, and renaming the flagged constant does **not** clear it —
  three names were flagged identically.

## Acceptance Criteria

### Happy path

- [ ] Each child's line states its real status, with the PR number where one exists.
- [ ] Statuses were verified against the story files on `develop` and the open PR
      list, not from memory.

### Error paths

- [ ] N/A — a documentation correction.

### Edge cases

- [ ] The epic says plainly that these lines are a hand-maintained convenience
      summary and that each story's `status:` frontmatter is the authority, so a
      future drift is understood rather than trusted.
- [ ] Stale blockers are corrected, not just statuses — a wrong blocker is worse
      than a wrong status because it stops work that could proceed.

### Performance

- [ ] N/A — documentation only.

### Security

- [ ] N/A — no code, credential or permission change.

### UX

- [ ] N/A — internal planning document.

### i18n

- [ ] N/A — internal, English only.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: Someone picking up the epic sees the real position**

- **Given** someone opens the epic to plan the next piece of work
- **When** they read the list of child items
- **Then** they see which are finished, which are in progress, and which are free to start

## Test Plan

Verified by reading each child story's `status:` on `develop` and cross-checking
the open PR list — the same two sources the table now claims to reflect.

## Out of Scope

- Generating the table automatically. That is the same class of problem as
  `SHY-INDEX.md` drifting 31 stories behind, and is folded into **SHY-0360**.
- Changing any child's actual status or scope.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The table drifts again | The epic now states the frontmatter is the authority; automatic generation is tracked in SHY-0360. |
| A status is wrong at the moment of writing | Each entry names its evidence (PR number / merge date) so it can be re-checked rather than trusted. |

## Definition of Done

- [ ] Child statuses and blockers corrected.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Filed after hitting the stale table while preparing to start
  EPIC-0004. The previous session had flagged exactly this and it had still not
  been fixed, which is why it is a ticket rather than a silent edit.
