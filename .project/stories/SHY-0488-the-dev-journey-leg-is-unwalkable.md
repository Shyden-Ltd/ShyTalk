---
id: SHY-0488
status: In Review
owner: unassigned
created: 2026-08-28
priority: P0
effort: L
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0488: The dev leg of the release gate cannot be walked, and does not say why

## User Story

As **whoever gates a release**, I want the device journey matrix to run against
dev, so that a promotion is proven on the environment users reach rather than
only on the laptop that built it.

## Why

The journey matrix has a `dev` target, and it has never produced a passing run.
Today it was run for the first time, and the reason is in the runner's own
comment:

```js
// dev/prod DB assertions are deferred (would need creds): db is
// null there and DB steps are skipped with a clear note.
function initDb(target) {
  if (target !== 'local') return null;
```

On dev, `ctx.db` is null, so **every Firestore assertion silently skips**. The
core-set journeys are mostly those assertions, so J07, J08 and J09 execute their
sign-in preamble and nothing else — and then SHY-0457's guard correctly fails
them for *"never touching the device outside sign-in"*.

So the dev leg is not flaky and not broken by a regression. It is **structurally
unfinishable**, and has been since the target was added.

### It also fails silently

`endJourney(status, error)` records the reason and prints only the icon:

```js
const icon = status === 'pass' ? '✓ PASS' : '✗ FAIL';
console.log(`--- ${this.current.id}: ${icon} (...)`);
```

A failing journey therefore prints four green steps, then `✗ FAIL`, with no
reason anywhere on screen. The reason is in `report.json` and nowhere a person
looking at the terminal would find it. Diagnosing today's run cost about an hour
that one printed line would have saved.

## What this changes

Assertions become **target-aware**, exactly as the API surface did in SHY-0473:

- **local** — the Firestore emulator through firebase-admin, unchanged.
- **dev** — the **product's own API**, using the persona tokens SHY-0473 already
  mints. Better than handing the runner admin credentials: it asserts the
  surface a real client uses, and needs no service-account secret on the
  machine.

## Acceptance Criteria

### Happy path

- [ ] The core-set journeys complete on `--target dev`, with assertions that
      really ran.
- [ ] The local target behaves exactly as before.

### Error paths

- [ ] A failing journey PRINTS its reason, not only records it.
- [ ] An assertion that cannot be made on a target says so and FAILS, rather
      than skipping silently.

### Edge cases

- [ ] A journey whose assertions all skip still fails SHY-0457's guard — the
      guard is not weakened to make dev pass.
- [ ] The dev path tolerates data it did not create: assertions read what the
      journey itself just did, never a fixed global state.

### Performance

- [ ] Dev assertions are single API reads; no added polling beyond the existing
      condition-based waits.

### Security

- [ ] No service-account credential is introduced on the developer machine.
- [ ] Persona tokens are minted per run and never logged.

### UX

- [ ] None: test harness only.

### i18n

- [ ] None.

### Observability

- [ ] The run header states which target's assertions are in use.
- [ ] The failure line carries the reason.

## BDD Scenarios

**Scenario: Proving a release on the real environment**

- **Given** a release ready to be promoted
- **When** the journeys run against the shared environment
- **Then** they check what really happened there

**Scenario: A journey that fails**

- **Given** a journey that does not pass
- **When** somebody looks at the output
- **Then** it says why

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Assertions resolve to the emulator on local and the API on dev. |
| Unit | A failing journey's reason reaches the console, asserted on the printed line. |
| Device (real, dev) | The core set completes against dev with assertions that ran. |
| Device (real, local) | The full matrix still passes 15/15. |

## Outcome

**The dev leg runs, and says what it cannot assert.**

| Run | Result |
| --- | --- |
| Before | 5 core journeys, 3 failed with **no printed reason**; assertions skipped silently |
| After | **6 of 8 passed, 2 failed, 7 SKIPPED — all named, all with reasons** |
| Local matrix | **15/15**, unchanged |

Three things changed:

1. **The failure reason prints.** `endJourney` recorded it and showed only the
   icon. One line would have saved the hour this diagnosis took.
2. **`ctx.state` is target-aware** — the emulator locally, the product API on
   dev, which is the better instrument there: it reads the surface a real client
   reads and needs no service-account credential on the machine.
3. **A journey that cannot be asserted is SKIPPED out loud**, named in the
   summary, instead of running a sign-in preamble and failing SHY-0457's guard
   with a message about the wrong thing. A skip is counted separately from a
   pass, because "absent from the failure list" must never read as "verified".

### What the dev leg found immediately

- **SHY-0490** — J06 buys `local_100_coins`, a local-only SKU, so dev correctly
  404s. Same class as SHY-0473, one layer up: a constant in a target-aware
  runner.
- **SHY-0491** — one persona picker miss on dev, plausibly the sign-out round
  trip that is already documented as slower off-loopback. Filed to be counted,
  not chased on a single sighting.

### Cohort cannot be asserted through the API, by design

`GET /api/users/:id` strips it — the route's own comment says *"Strip
admin-only / PII / deletion / cohort fields"*. That is safeguarding, not a gap,
so the reader now declares the field **unanswerable** on dev and the journey
says so, rather than timing out on `undefined`. The cohort is still proven
there — behaviourally, by the minor-UI assertions, which is arguably stronger
than reading the field.

### Still local-only

Seven journeys read Firestore **collections** (conversations, rooms, support
tickets, audit logs) and clean up after themselves. No API route answers those,
so they are marked `requiresLocalState` and skipped on dev. Converting them is
its own piece of work, not this one.

## Out of Scope

- prod. The target list is `local|dev` and stays that way.
- Giving the runner admin credentials for dev.

## Dependencies

- Builds on SHY-0473, which made the API surface target-aware and mints the
  persona tokens this uses.

## Risks & Mitigations

- **Risk:** an API-based assertion is weaker than a direct document read.
  **Mitigation:** each is written against the same field the DB assertion read,
  and the dev run is compared against the local one for the same journey.
- **Risk:** dev data drift makes assertions flaky. **Mitigation:** assertions
  read what the journey itself just changed.

## Definition of Done

- [ ] The core set completes on dev.
- [ ] A failed journey prints its reason.
- [ ] The local matrix still passes 15/15 on a real device.

## Notes

Found while re-seeding the dev personas under the AFK-week authority. Two
operational blocks were cleared first and are worth recording: the dev APK on
the phone was six days old with an **empty** baked persona password, and
`host@shytalk.dev` carried a moderation warning that the provisioner neither
seeds nor clears — so the app auto-signed-in as them and the warning screen
blocked every journey's persona picker. The provisioner not resetting moderation
state is filed separately.
