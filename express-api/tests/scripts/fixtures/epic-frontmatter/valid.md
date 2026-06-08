---
id: EPIC-0099
status: In Progress
owner: claude
created: 2026-06-08
priority: P1
title: Canonical valid EPIC fixture
child_shys: []
---

# EPIC-0099: Canonical valid EPIC fixture

## Vision

As a fixture, I exist so the EPIC validator's happy path has a single source of truth. Mutating helpers in the test harness derive every failure-mode fixture from this file.

## Scope

In scope: serving as the canonical valid EPIC fixture.
Out of scope: anything else.

## Child SHYs

(none yet — pre-creation)

## DoD at Epic Level

- [ ] File parses as well-formed YAML frontmatter + Markdown body
- [ ] EPIC validator exits 0 against it

## Notes

- 2026-06-08 — Created as the canonical valid fixture for SHY-0037's EPIC validator test suite.
