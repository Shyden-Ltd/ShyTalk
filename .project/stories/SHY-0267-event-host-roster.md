---
id: SHY-0267
status: In Progress
owner: claude
created: 2026-08-02
priority: P1
effort: XL
type: feature
roadmap_ids: []
mvp: false
---

# SHY-0267: Event host — scheduled events with a roster of performers

## User Story

- **As an** MC_EVENT_HOST running a roster of performers
- **I want** to schedule an event, invite my roster, rotate performers through the seats, and see what the event earned
- **So that** a multi-performer show can run as one event, and the money is attributed to the performer who earned it rather than to whoever happens to hold the room

## Why

j16 has asserted this feature across 11 scenarios since it was written. **None of it
exists.** There is no events surface in `express-api/src` or `shared/src`, and the
fields the scenarios assert on — `teamRoster`, `rosterParticipants`,
`eventInvites`, `events/{id}/giftLedger` — appear nowhere outside the corpus.

The scenarios were tagged `@unimplemented` on 2026-08-01 to stop them reading as
regressions. Operator 2026-08-01: *"if something is marked an unimplemented, then
it needs implementing. don't ignore it"* and *"if we have tests written for them
then that means they should have been built already, because of TDD."* The tag
was an honest stopgap; it is not the fix.

The attribution is the point. A showcase with four performers where the tips all
land on the host is not a rounding error — it is the performers being paid
nothing for the audience they drew.

## Acceptance Criteria

### Happy path

- [ ] An MC_EVENT_HOST can schedule an event with a title, a start time, a duration, and a roster of user ids.
- [ ] Each rostered user receives an invite they can accept or decline.
- [ ] At the start time the host can open the event, which creates a room bound to the event.
- [ ] The host can promote a rostered participant into a performer seat, and demote them again.
- [ ] Gifts sent during the event are attributed to the SEATED PERFORMER, and recorded in an event-level ledger.
- [ ] Closing the event produces a summary: gift count, coin total, bean total, and top contributor.

### Error paths

- [ ] Scheduling by a non-MC_EVENT_HOST is refused with 403.
- [ ] Promoting a user who is not on the roster is refused.
- [ ] Starting an event before its start time is refused, with the remaining time in the message.
- [ ] Accepting an invite for an event that has already closed is refused, not silently accepted.
- [ ] A double-accept is idempotent, not a second roster entry.

### Edge cases

- [ ] An empty roster schedules a valid event — a host may perform solo.
- [ ] A rostered user who never responds stays PENDING and does not block the event starting.
- [ ] Demoting an empty seat is a no-op, not an error.
- [ ] Two hosts cannot bind an event to the same room.
- [ ] A gift arriving in the instant between demote and the next promote is attributed to the event and the host, never to a seat that is empty.

### Performance

- [ ] The event summary is computed from the ledger in one query, not by walking every gift.

### Security

- [ ] **An adult host cannot add a minor to a roster, and a minor host cannot add an adult.** The cohort boundary holds here exactly as it does in rooms and PMs — a roster is a working relationship between named people, and this is the one place a cross-cohort one could be created.
- [ ] Only the host may promote, demote, or close their own event.
- [ ] The ledger is readable only by the host and by the performer whose earnings it records.

### UX

- [ ] An invited performer sees who invited them and when the event starts, not just that they were invited.
- [ ] The roster panel shows each member's state: waiting, seated, or declined.

### i18n

- [ ] All new user-facing strings exist in ALL 21 locale files.
- [ ] Times are formatted in the viewer's locale and timezone — a start time shown in the host's timezone is a missed event.

### Observability

- [ ] Event lifecycle transitions log the event id and state, never display names.

## BDD Scenarios

**Scenario: A host schedules an event and a performer accepts**

- **Given** Tariq is an MC_EVENT_HOST with Selma on his team roster
- **When** Tariq schedules "Saturday Showcase" with Selma on the roster
- **Then** Selma has a pending invite naming Tariq and the start time
- **And** accepting it marks her ACCEPTED

**Scenario: A minor cannot be added to an adult's roster**

- **Given** Tariq is an adult MC_EVENT_HOST
- **When** Tariq tries to add a minor to his roster
- **Then** the request is refused and the roster is unchanged

**Scenario: Tips reach the performer, not the host**

- **Given** Selma is the seated performer in Tariq's event
- **When** Alice tips 500 coins
- **Then** Selma's beans increase
- **And** the event ledger records the gift against Selma

**Scenario: A gift with no seated performer is attributed to the event**

- **Given** Tariq has just demoted Selma and no one is seated
- **When** a tip arrives
- **Then** it is attributed to the event and the host
- **And** no empty seat is credited

**Scenario: Only the host controls their event**

- **Given** Selma is on Tariq's roster
- **When** Selma tries to promote herself
- **Then** the request is refused

**Scenario: An event cannot start early**

- **Given** an event scheduled for one hour from now
- **When** the host tries to start it
- **Then** the request is refused and the message says how long remains

## Test Plan

**Red first, in this order:**

1. `express-api/tests/routes/events-schedule.test.js` — real emulator. Schedule, 403 for non-host, empty roster, cross-cohort roster refusal.
2. `express-api/tests/routes/events-invites.test.js` — accept, decline, double-accept idempotency, accept-after-close.
3. `express-api/tests/routes/events-lifecycle.test.js` — start gating on time, room binding, one-room-per-event.
4. `express-api/tests/routes/events-roster-seats.test.js` — promote/demote, non-roster refusal, host-only authorisation.
5. `express-api/tests/routes/events-ledger.test.js` — attribution to the seated performer, the empty-seat case, summary in one query.
6. Kotlin `:shared:jvmTest` for the event/roster models and state machine.
7. `journey-tests/j16-event-host-team-leader.feature` — the `@unimplemented` tags come OFF, scenario by scenario, as each phase lands.

**Green:** j16 runs untagged and passes on the real stack, on both devices and the web.

## Out of Scope

- Ticketed or paid entry to events.
- Recurring events.
- Payout splits between host and performer beyond the existing bean share.

## Dependencies

- Rooms (`rooms/{id}`, seats) — events bind a room rather than reinventing one.
- The gift path in `express-api/src/routes/economy.js`, which must learn to attribute to a seated performer.
- The cohort helpers in `utils/firebase-claims.js` and `utils/cohort-filter.js`.

## Risks & Mitigations

- **Risk:** a roster becomes a cross-cohort channel — the one relationship the product does not otherwise allow between named minors and adults. **Mitigation:** the same verified-claim cohort check used by rooms, asserted in both directions.
- **Risk:** attribution lands on the host when a seat is empty, quietly paying the wrong person. **Mitigation:** the empty-seat case is an explicit scenario, not an implicit fallback.
- **Risk:** the feature is large and lands half-built, which is how j16 got here. **Mitigation:** the phases above are independently shippable, and each removes its own `@unimplemented` tag — a tag still present is an honest statement that the phase has not landed.

## Definition of Done

- All AC met; every j16 scenario untagged and passing on local and dev.
- Express, Kotlin and instrumented tests green; `npm test` and lint clean.
- Strings in all 21 locales.
- `:shared:compileKotlinIosArm64` green.
- Full journey matrix green on both devices and all browsers.

## Notes (running log)

- **2026-08-02** — Created while closing the app-testing gaps in SHY-0259. j16 has asserted this feature across 11 scenarios since it was written and none of it exists; the `@unimplemented` tags added on 2026-08-01 stopped the noise but were never a plan. Filed at the operator's instruction that an unimplemented tag is a gap to fill, not a state to keep.
