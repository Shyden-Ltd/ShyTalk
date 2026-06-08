---
id: SHY-0099
status: Draft
owner: claude
created: 2026-06-06
priority: P1
effort: M
type: infra
roadmap_ids: []
pr:
---

# SHY-0099: Canonical valid fixture story

## User Story

As a fixture, I want all required sections present so the validator accepts me, so that the test harness can demonstrate happy-path behaviour.

## Why

Every other failure-mode fixture mutates this file. Keeping it minimal but complete means a single edit propagates predictably.

## Acceptance Criteria

### Happy path

- [ ] Validator accepts this file

### Error paths

N/A — fixture covers happy path only; error variants are generated programmatically by the test helper.

### Edge cases

N/A — covered by dedicated edge-case fixtures (CRLF, BOM, empty, etc.).

### Performance

N/A — fixture file is <1KB.

### Security

N/A — fixture contains no executable content.

### UX

N/A — fixture-only AC.

### i18n

N/A — fixture content is ASCII.

### Observability

N/A — fixture-only AC.

## BDD Scenarios

**Scenario: Validator accepts this canonical fixture**

- **Given** this file at any path
- **When** the validator runs
- **Then** exit code is 0

## Test Plan (TDD)

### Red

N/A — this fixture is a test ASSET, not a story with its own test plan.

### Green

N/A — see Red.

## Out of Scope

- Anything beyond serving as the canonical fixture for the validator tests.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** Fixture drift between this file and the template documented in CLAUDE.md. **Mitigation:** Both reference the same SHY-0001 spec; reviewer checks alignment on every change.

## Definition of Done

- [ ] File parses as well-formed YAML frontmatter + Markdown body
- [ ] Validator exits 0 against it

## Notes (running log)

- 2026-06-06 — Created as the canonical valid fixture for SHY-0001's validator test suite.
