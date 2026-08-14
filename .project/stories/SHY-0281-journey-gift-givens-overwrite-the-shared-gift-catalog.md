---
id: SHY-0281
status: Draft
owner: claude
created: 2026-08-05
priority: P1
effort: S
type: bug
roadmap_ids: []
---

# SHY-0281: Journey gift setup-Givens overwrite the shared gift catalog and leave it corrupted for every later run

## User Story

As **an engineer running the journey matrix and the web suite against the same local stack**,
I want **a journey's gift fixtures to stop rewriting the real gift catalog**,
So that **a run does not silently corrupt the data every later run depends on**.

## Why

Found while a `pre-push` run blocked on `admin-gifts.spec.ts:73` ("seeded gift appears in table with correct data"). The first row's name field was empty. The cause was not the web spec: the local gift catalog contained three malformed documents — `rose`, `crown`, `diamond` — each holding only `{ id, coins, beans }`, with no `name`, `coinValue`, `order`, `iconUrl` or the rest of a real gift. They were created 2026-08-04 at 13:28 and 15:24, during the previous day's gauntlet.

Two setup-Givens in `express-api/scripts/manual-qa-runner.js` write straight into the shared `gifts` collection:

- line 3993 — `await ctx.db.doc(\`gifts/${id}\`).set({ id, costCoins, awardBeans })`
- line 12873 — `await ctx.db.doc(\`gifts/${g.id}\`).set(g)` where `g` is `{ id, coins, beans }`

Both use `.set()` **without `merge`**, which replaces the whole document. Two distinct harms:

1. **Corruption by creation.** A gift id the catalog does not have (`rose`, `crown`, `diamond`) is created as a stub with a foreign shape. It then appears in `/api/config/gifts/all` and in the admin Gifts tab as a nameless row — which is exactly what broke the web suite, on a machine where no web change had been made.
2. **Destruction by collision.** If a journey names a gift id that DOES exist in the catalog (`local-gift-1`, say), `.set()` silently erases its `name`, `coinValue`, `order` and media URLs. Nothing warns; the catalog is simply smaller afterwards.

The leak is invisible inside the journey run — the journey passes. It surfaces later, in a different suite, as a failure that looks like a web defect. That is what makes it worth fixing rather than cleaning up by hand: the three documents were removed to unblock the push, and the next gauntlet run will recreate them.

Note the two Givens disagree with each other about the schema (`costCoins`/`awardBeans` vs `coins`/`beans`), and neither matches the real gift shape the admin UI and `/api/economy/gacha` read. A stringly-typed fixture with no shape contract ([[feedback-silent-guards-and-stringly-typed-contracts]]).

Violates [[feedback-test-isolation-no-leaks]] (HARD).

## Acceptance Criteria

### Happy path

- [ ] A journey that declares gift fixtures leaves the pre-existing gift catalog byte-identical for every document it did not declare.
- [ ] A gift fixture writes a document with the same shape the product reads: at minimum `name`, `coinValue`, `order`, plus the fixture's economy fields.

### Error paths

- [ ] Declaring a fixture whose id collides with an existing catalog gift fails the step loudly instead of overwriting it.
- [ ] A fixture write that cannot complete reports the id and the reason, rather than leaving a half-written document.

### Edge cases

- [ ] Two journeys declaring the same gift id in one matrix run do not corrupt each other.
- [ ] A journey that ends early (timeout, kill) does not leave stub documents behind.
- [ ] The two Givens agree on one schema — `costCoins`/`awardBeans` and `coins`/`beans` cannot both be right.

### Performance

- [ ] Cleanup adds no more than one extra write per declared fixture.

### Security

- [ ] N/A — fixture data only, no authorization surface and no user data.

### UX

- [ ] N/A — no user-facing surface.

### i18n

- [ ] N/A — fixture ids and numeric economy values only; no user-facing string.

### Observability

- [ ] The runner reports how many gift fixtures it created and removed, so a leak is visible in the log rather than discovered days later by another suite.

## BDD Scenarios

**Scenario: A journey's gift fixtures do not disturb the real catalog**
- **Given** the gift catalog holds the standard gifts
- **When** a journey that declares its own gift fixtures finishes
- **Then** the standard gifts are unchanged

**Scenario: A fixture cannot silently replace a real gift**
- **Given** a journey declares a gift that already exists in the catalog
- **When** the setup step runs
- **Then** it fails and names the clashing gift

**Scenario: The admin gift list stays trustworthy after a journey run**
- **Given** a full journey matrix has just run
- **When** an engineer opens the admin Gifts tab
- **Then** every gift listed has a name

## Test Plan

**Red (written first, must fail against today's code):**

- `express-api/tests/scripts/journey-gift-fixture-isolation.test.js` (new)
  - `a gift fixture does not overwrite an existing catalog gift` — **fails today**: `.set()` replaces it.
  - `a gift fixture writes the shape the product reads` — **fails today**: no `name`/`coinValue`/`order`.
  - `both gift Givens agree on one schema` — **fails today**: `costCoins`/`awardBeans` vs `coins`/`beans`.
  - `declared fixtures are removed when the journey ends` — **fails today**: nothing removes them.

**Green:** the above, plus `tests/web/admin-gifts.spec.ts` run immediately AFTER a journey that declares gift fixtures — the exact sequence that produced this bug, which currently no test covers.

**Real services only:** exercised against the real Firestore emulator on the local stack, using the runner's real `ctx.db` Admin SDK handle. No mocking — the defect is in what actually lands in the datastore.

## Out of Scope

- The `giftWalls/...` writes at `manual-qa-runner.js:596` — a per-recipient subcollection, not the shared catalog.
- Redesigning the gift schema itself.
- The admin Gifts tab's own behaviour: rendering a nameless row for a malformed document is a fair report of bad data, not a defect.

## Dependencies

- Touches `express-api/**`, so this PR runs `test-backend` — it must land **after** [[SHY-0243]] (PR #1670) fixes the two suites that currently fail there, or it will be blocked by them rather than by anything of its own.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Failing on collision breaks journeys that rely on overwriting today | Inventory the gift ids the corpus declares first; the three found (`rose`, `crown`, `diamond`) are not real catalog ids, so no journey depends on the overwrite |
| Cleanup deletes a gift the journey did not create | Only ids the step itself created in that run are removed, recorded at creation time |
| The two Givens' schemas are both load-bearing somewhere | Both are fixture-only; grep the corpus for readers before unifying |

## Definition of Done

- [ ] Red tests observed failing against unmodified code.
- [ ] Catalog provably unchanged across a full journey matrix run.
- [ ] `admin-gifts.spec.ts` passes immediately after a gift-declaring journey.
- [ ] `code-reviewer` 100% clean; CI green by name.

## Notes (running log)

- **2026-08-05 03:30 WIB** — Found while diagnosing a `pre-push` block on `admin-gifts.spec.ts`. Initial read of the emulator reported "0 gifts" — that was wrong: the response was `PERMISSION_DENIED` and the parser treated an error body as an empty list. Re-queried with the emulator's `Authorization: Bearer owner` bypass, which showed 20 gifts of which three were malformed. Worth recording as its own trap: a probe that cannot distinguish "denied" from "empty" will report corruption as cleanliness ([[feedback-absence-of-work-reported-as-success]]).
- **2026-08-05 03:32 WIB** — `rose`, `crown` and `diamond` deleted from the local `demo-shytalk` emulator to unblock the push; `admin-gifts.spec.ts` then passed 14/14. The deletion is local data only — nothing in the repo changed, and the next gauntlet run will recreate them until this story lands.
- **2026-08-05 03:33 WIB** — Deliberately NOT folded into [[SHY-0279]]: `manual-qa-runner.js` is under `express-api/`, so touching it would flip `backend_changed=true` and pull the two currently-failing `test-backend` suites into a PR whose whole purpose is to be the one that finally gets Playwright running.
