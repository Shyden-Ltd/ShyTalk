---
id: SHY-0412
status: Draft
owner: unassigned
created: 2026-08-21
priority: P0
effort: M
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0412: Twenty-six endpoints that wipe collections, walked by nobody

## User Story

As **the operator of a platform holding other people's money and history**, I
want the operations that delete it wholesale to have been used deliberately in a
test before they are used accidentally in production.

## Why

`routes/admin-cleanup.js` holds **26 endpoints that delete data wholesale**:

`all-coins` · `all-beans` · `all-transactions` · `all-backpacks` ·
`all-giftwalls` · `all-reports` · `all-warnings` · `all-spin-history` ·
`all-supershy` · `all-system-conversations`

Not one appears in 675 scenarios. These are the highest-blast-radius endpoints in
the product — `all-coins` removes every coin every member holds — and nothing
walks them, including whether they refuse a non-admin.

### The gate is by path prefix, and the file knows it is fragile

```js
router.use('/cleanup', adminGuard);
router.use('/storage/audit', adminGuard);
```

The file's own comment explains the trap: too broad a prefix intercepts every
sibling router's routes at the shared `/api` mount, too narrow and it covers
nothing. **All 26 are correctly covered today — that has been checked and is
now enforced by `destructive-routes-are-guarded.test.js`, which fails if a route
is added outside the guarded prefixes.** That test closes the "silently ungated"
risk. It does not walk what the endpoints DO.

### What is still unproven

- that each one deletes what it claims and **only** what it claims
- that a cleanup leaves the rest of the product working
- that a non-admin calling one is refused, per endpoint
- that a partial failure does not leave data half-deleted
- that a cleanup is auditable afterwards

A cleanup that deletes slightly more than intended is unrecoverable, and the
first person to notice is a member whose balance has gone.

## Acceptance Criteria

### Happy path

- [ ] Each cleanup removes the data it names, asserted by reading it back.
- [ ] Data it does **not** name survives, asserted explicitly — this is the
      assertion that catches a cleanup that reaches too far.
- [ ] The app keeps working for members afterwards.

### Error paths

- [ ] A cleanup that fails partway leaves a state somebody can recover from, and
      says what happened.
- [ ] Running a cleanup when there is nothing to clean is harmless.

### Edge cases

- [ ] Running the same cleanup twice is harmless the second time.
- [ ] A cleanup while somebody is actively using the affected feature does not
      leave that person in a broken session.
- [ ] More records than a single batch — the documented batch size is respected
      and nothing is skipped.

### Performance

- [ ] A cleanup over a large collection stays within its batching and does not
      exhaust quota.

### Security

- [ ] **Every one of the 26 refuses a non-admin.** Not a sample — each one, since
      the gate is by prefix and a prefix either covers a route or does not.
- [ ] A non-admin cannot reach the storage audit either.
- [ ] Enforced statically as well: no route in this file may sit outside a guard
      prefix. Already covered by `destructive-routes-are-guarded.test.js`.

### UX

- [ ] The admin panel makes clear what each cleanup will remove before it runs.

### i18n

- [ ] Not applicable — admin-only, English by policy.

### Observability

- [ ] Every cleanup writes an audit entry naming what was removed, by whom, and
      how much.

## BDD Scenarios

**Scenario: A cleanup removes what it names**

- **Given** members hold coins and an admin runs the coin cleanup
- **When** a member opens their wallet
- **Then** their coins are gone

**Scenario: A cleanup leaves everything else alone**

- **Given** members hold coins and beans, and an admin runs the coin cleanup
- **When** a member opens their wallet
- **Then** their beans are untouched

**Scenario: Cleanups are not open to everyone**

- **Given** somebody who is not an admin
- **When** they call a cleanup endpoint
- **Then** they are refused

**Scenario: Running a cleanup twice is harmless**

- **Given** a cleanup that has already run
- **When** an admin runs it again
- **Then** nothing further is removed and nothing breaks

**Scenario: A cleanup is on the record**

- **Given** an admin has run a cleanup
- **When** the audit log is examined
- **Then** it names what was removed, by whom and when

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Per-endpoint refusal** | All 26 refuse a non-admin, table-driven over the route list read from the file — so a new endpoint joins the table automatically rather than being forgotten. |
| Scope | For each cleanup, the named data is gone AND a named neighbour survives. A cleanup is only correct if it is also bounded. |
| Static | `destructive-routes-are-guarded.test.js` already fails if a route is added outside a guard prefix; mutation-proven. |
| Idempotency | Second run harmless. |
| Batching | More records than one batch, nothing skipped. |
| Audit | Every run leaves an entry. |

## Out of Scope

- Removing or redesigning any cleanup endpoint.

## Dependencies

- A disposable environment. **These tests must never run against dev or
  production data** — that constraint is part of the story, not a footnote.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The test itself deletes real data | Runs only against a disposable seeded environment, asserted before any destructive call. |
| Only a sample of the 26 is covered | The refusal test is table-driven over the routes parsed from the file, so coverage cannot drift below the endpoint count. |
| A cleanup that over-reaches passes because only its target is checked | Every scope scenario also asserts a neighbour SURVIVES. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Every one of the 26 endpoints asserted to refuse a non-admin.

## Notes

- Found 2026-08-21 in the third audit pass, by deriving capabilities from route
  paths. `cleanup` appears in 26 endpoints and zero scenarios.
- The static guard was written the same day and mutation-proven: adding
  `POST /wipe-every-balance` outside the prefixes fails it with the endpoint and
  the prefixes named.
