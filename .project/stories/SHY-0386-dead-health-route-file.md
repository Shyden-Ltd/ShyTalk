---
id: SHY-0386
status: Draft
owner: unassigned
created: 2026-08-20
priority: P3
effort: XS
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0386: A health-check route file that has never been mounted

## User Story

As **someone changing how health checks behave**, I want only one place that
defines them, so that I do not edit a file that serves no traffic.

## Why

`express-api/src/routes/health.js` defines `GET /health` and is **never mounted**
in `index.js`. The live endpoint is defined inline in `index.js` as
`app.get('/api/health', generalLimiter, …)`.

So the file exists, looks authoritative, passes review, and does nothing. Its
only reference anywhere is a single test that requires it directly.

This is very likely the source of a real confusion already recorded in the
2026-08-20 part-6 handover:

> Health gate observed passing, not assumed. **`/health` 404s — the real path is
> `/api/health`.**

Somebody reasoned from the file, and the file was wrong.

Found while adding SHY-0380's support-tickets router, by a guard asserting that
every file in `src/routes/` is mounted. `health.js` was one of two misses; the
other was the new router, which was then mounted.

## Acceptance Criteria

### Happy path

- [ ] There is exactly one definition of the health endpoint, and it is the one
      that serves traffic.
- [ ] `/api/health` behaves exactly as it does today.

### Error paths

- [ ] Nothing that currently calls the health endpoint breaks — deploy gates and
      the preview watermark both use it.

### Edge cases

- [ ] The test that requires `routes/health` directly is updated or removed
      rather than left pointing at a deleted file.

### Performance

- [ ] No change.

### Security

- [ ] The endpoint keeps its current rate limiting; it is unauthenticated.

### UX

- [ ] Not user-facing.

### i18n

- [ ] No copy changes.

### Observability

- [ ] The health response keeps the fields consumers already read, including the
      serving SHA.

## BDD Scenarios

**Scenario: The health check still answers**

- **Given** the service is running
- **When** something checks its health
- **Then** it answers exactly as it does today

## Test Plan

| Layer | What it proves |
| --- | --- |
| Mount guard | `every-route-file-is-mounted.test.js` — remove `health` from the allowlist and the guard must stay green, proving the file is gone rather than merely unmounted. |
| Endpoint test | `/api/health` returns the same shape, including the SHA field the deploy gate reads. |
| Live | Dev `/api/health` still returns 200 after the change. |

## Out of Scope

- Changing what the health endpoint reports.
- The wider question of inline routes in `index.js` versus route modules.

## Dependencies

- None. The mount guard that found it landed with SHY-0380.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Something imports the dead file that the grep missed | The mount guard's allowlist assertion fails if the file disappears while still listed, forcing the entry to be removed deliberately. |
| Deploy gates read the health endpoint | They read `/api/health`, which is the inline one and is untouched. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] `health` removed from the mount guard's allowlist.
- [ ] Dev `/api/health` verified 200 after deploy.

## Notes

- The allowlist entry in `express-api/tests/scripts/every-route-file-is-mounted.test.js`
  names this story. Removing the file should remove the entry in the same change.
