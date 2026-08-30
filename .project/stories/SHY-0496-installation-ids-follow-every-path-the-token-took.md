---
id: SHY-0496
status: In Review
owner: claude
created: 2026-08-30
priority: P0
effort: S
type: bug
roadmap_ids: []
---

# SHY-0496: Installation IDs must follow every path the registration token took

## User Story

As **somebody whose phone is registered for notifications**,
I want **my device's push address treated as the secret it is, and my notifications to keep arriving**,
So that **nobody else can be handed a way to reach my phone, and my messages do not silently stop**.

## Why

SHY-0244 added `fcmInstallationIds` beside `fcmTokens`. `fcmTokens` is handled
specially in several places — it is a **device address**, so it is stripped
from responses and exports, and it is what "can this person be reached" is
decided on. The new field was added to the model and the dispatcher but **not
to any of those other paths**, so three defects shipped together:

1. **It leaked.** `users.js` deletes `fcmTokens` before returning a user and did
   not delete `fcmInstallationIds`, so the new identifier came back from the
   user API — reproduced against dev, where `GET /api/users/50000010` returned
   it. SHY-0244's own security AC says the identifier is *"never returned to a
   client other than its owner"*. That AC was violated by the change that wrote
   it.
2. **It leaked again, into GDPR exports.** `data-export-builder.js` lists
   `fcmTokens` among the fields stripped from an export and did not list the
   new one.
3. **Worst: it silently stopped DM notifications for migrated users.**
   `shouldNotifyRecipient` asked only `user.fcmTokens?.length`. A migrated
   device appears ONLY in `fcmInstallationIds`, so that check returned false for
   every upgraded user. Nothing errors and nothing is logged — "should not
   notify" and "notified successfully" are indistinguishable downstream. The
   first symptom is somebody saying messages stopped arriving. This is the exact
   silent failure SHY-0244 exists to prevent, reintroduced one layer up.

`alertManager.js` had the same shape for operational alerts: it gathered only
tokens, so an alert never reached a migrated device.

Found while checking whether dev exposed `shyCoins` for an unrelated journey
conversion — the response listed `fcmInstallationIds`, which should not have
been there.

## Acceptance Criteria

### Happy path

- [ ] A user read through the API never contains `fcmInstallationIds`, exactly as it never contains `fcmTokens`.
- [ ] A recipient whose device is registered under EITHER model is considered reachable and receives notifications.
- [ ] Operational alerts reach a device registered under either model.

### Error paths

- [ ] A recipient with neither store is still treated as unreachable — widening the check must not make everybody reachable, since a dispatch to nobody is what looks like success.

### Edge cases

- [ ] A user with both stores populated (mid-migration, two devices) is reachable and receives on both.
- [ ] A GDPR export contains neither identifier.

### Security

- [ ] Neither identifier is returned to any caller, including admins reading another user.
- [ ] Neither appears in a data export.

### Performance

- [ ] No extra reads: both fields come from the user document already fetched.

### Observability

- [ ] Unchanged — the loud zero-identifier log added by SHY-0244 still fires.

### UX

- N/A — no user-visible surface changes; notifications resume for affected users.

### i18n

- N/A — no strings change.

## BDD Scenarios

**Scenario: a device address never comes back from the API**
- **Given** somebody's phone is registered for notifications
- **When** their profile is read through the API
- **Then** the response contains no push identifier of any kind

**Scenario: an upgraded phone still receives messages**
- **Given** somebody's phone is registered under the newer model only
- **When** another person sends them a message
- **Then** the notification is sent to that phone

**Scenario: somebody with no registered device is not notified**
- **Given** somebody has no registered device
- **When** another person sends them a message
- **Then** no notification is attempted

## Test Plan

**Classification: FULL protocol.** Backend runtime, and one defect is a
disclosure.

### Red (must fail first)

- Extend the existing `not.toHaveProperty('fcmTokens')` leak tests to the new field — RED before the strip.
- A recipient with ONLY installation IDs is notified — RED before the reachability fix.

### Green

- `cd express-api && npm test`; full matrix on a real device, local then dev.

### Mutation proof

- Remove the new `delete` → the leak tests fail.
- Narrow reachability back to tokens only → the migrated-recipient test fails.
- Widen reachability to always true → the "neither store" test fails.

## Out of Scope

- The dispatcher itself, which SHY-0244 already handles correctly for both stores.
- Any change to which identifier model a client uses.

## Dependencies

- **SHY-0244** introduced the field; this completes it.

## Risks & Mitigations

- **Risk: another path still reads `fcmTokens` alone.** **Mitigation:** swept every occurrence in `express-api/src`; the remaining ones are the dispatcher and reaper, which handle both kinds explicitly, and comments.
- **Risk: widening reachability makes a dispatch to nobody look like success.** **Mitigation:** the "neither store" case is pinned by its own test.

## Definition of Done

- [ ] All four sites fixed, each with a test that fails without the fix.
- [ ] Full express suite green.
- [ ] Real-device matrix green, local then dev.
- [ ] `released_in:` set when the release is cut.

## Notes (running log)

- **2026-08-30** — Filed and fixed together; the defect was mine, introduced by
  SHY-0244 two days earlier. The lesson is the one already recorded as "guard
  the CLASS, not the instance": a new field added beside a sensitive one has to
  follow it everywhere it goes, and `grep fcmTokens` was all it took to find
  where that was.
