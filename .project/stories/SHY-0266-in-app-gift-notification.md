---
id: SHY-0266
status: In Progress
owner: claude
created: 2026-08-02
priority: P1
effort: M
type: feature
roadmap_ids: []
mvp: false
---

# SHY-0266: Gift notification — a recipient learns they were gifted

## User Story

- **As a** ShyTalk user who has just been sent a gift
- **I want** to be told about it, whether or not the app is open
- **So that** the sender's gesture actually lands, instead of sitting unseen in a wallet until I happen to look

## Why

j05 has asserted both halves of this since it was written:

```gherkin
Then the tester sees an FCM push notification on Selma's Android device with body containing "Alice" and "crown"
Then within 5000ms Selma's Android UI shows the in-app gift notification with sender "Alice" and gift "crown"
```

**Neither exists.** `express-api/src/routes/economy.js` sends no push at all — no
call to `sendFcmToTokens` anywhere in the file — and there is no in-app
notification surface in `shared/src`. The driver assertion looked for
`giftNotification_`, a testTag nothing renders. So both steps have failed on
every run since they were written, and the failures pointed at the app.

Operator 2026-08-01: *"if we have tests written for them then that means they
should have been built already, because of TDD… which is another failure we need
to fix."*

Gifting is the product's revenue path. A gift the recipient never notices is a
purchase whose entire value to the sender — being seen — silently evaporates.

## Acceptance Criteria

### Happy path

- [ ] Sending a gift dispatches an FCM message to every valid token of the recipient, with `type: 'GIFT'`, the sender's display name, and the gift name.
- [ ] With the app BACKGROUNDED, the recipient sees a system notification naming the sender and the gift.
- [ ] With the app FOREGROUNDED, the recipient sees an in-app banner naming the sender and the gift, and no duplicate system notification.
- [ ] The banner is dismissible and auto-dismisses after 5 seconds.

### Error paths

- [ ] A push failure never fails the gift: the coins have moved and the transaction is written regardless.
- [ ] Invalid tokens are cleaned up exactly as the PM path already does.
- [ ] A recipient with no tokens is a no-op, not an error.

### Edge cases

- [ ] Two gifts in quick succession produce two notifications, not one replacing the other unseen.
- [ ] A gift to oneself sends no notification.
- [ ] A blocked sender sends no notification — a block must not be a delivery channel.
- [ ] A gift sent while the recipient is signed out on that device still notifies on next launch via the system tray, and does NOT replay as an in-app banner for a different user who signs in afterwards.

### Performance

- [ ] Push dispatch does not extend the gift request: it is fired after the response path is decided.

### Security

- [ ] The notification carries the sender's display name and gift name only — never balances, never the recipient's own totals.
- [ ] Cross-cohort dispatch obeys the existing `isCrossCohortDispatch` guard in `utils/fcm.js`, so an adult gifting a minor cannot use the notification as a message channel.

### UX

- [ ] The banner names both the sender and the gift; "You received a gift" alone is not enough to make the gesture land.

### i18n

- [ ] All new user-facing strings exist in ALL 21 locale files.

### Observability

- [ ] Dispatch logs the recipient id and gift id, never the display names.

## BDD Scenarios

**Scenario: A gift notifies a backgrounded recipient**

- **Given** Selma has the app backgrounded
- **When** Alice sends Selma a crown
- **Then** Selma's device shows a notification naming Alice and the crown

**Scenario: A gift notifies a foregrounded recipient in-app**

- **Given** Selma has the app open
- **When** Alice sends Selma a crown
- **Then** Selma sees an in-app banner naming Alice and the crown

**Scenario: A failed push never costs the gift**

- **Given** push delivery is failing
- **When** Alice sends Selma a crown
- **Then** the coins still move and the transaction is still written

**Scenario: A block is not a delivery channel**

- **Given** Selma has blocked Vexa
- **When** Vexa sends Selma a gift
- **Then** Selma receives no notification

**Scenario: Self-gifting is silent**

- **Given** Alice sends a gift to herself
- **Then** no notification is dispatched

## Test Plan

**Red first:**

1. `express-api/tests/routes/economy-gift-notification.test.js` — real emulator + the existing FCM capture harness (`getFcmCaptures`). Dispatch shape, self-gift, blocked sender, push-failure isolation, token cleanup.
2. `shared` — `GiftNotificationBusTest` for emit/consume and the sign-out clear.
3. Android instrumented — the banner renders sender and gift.
4. `journey-tests/j05-alice-monetization.feature` — both existing steps stop being permanent failures.

**Green:** j05's FCM step and in-app step both pass on the real stack.

## Out of Scope

- Grouping several gifts into one digest notification.
- Notification preferences specific to gifts (the existing global push settings apply).

## Dependencies

- `utils/fcm.js` `sendFcmToTokens` + `cleanupInvalidTokens`, already used by the PM path.
- `PushDeepLinkBus.kt` as the shape to follow for the in-app bus.

## Risks & Mitigations

- **Risk:** a push failure rolls back a paid-for gift. **Mitigation:** dispatch is outside the transaction and its failure is swallowed and logged; asserted by a test that makes FCM throw.
- **Risk:** the in-app banner replays for the next user to sign in on that device. **Mitigation:** the bus is a nullable StateFlow cleared on sign-out, the same reason `PushDeepLinkBus` uses that shape; asserted.
- **Risk:** notifications become a cross-cohort message channel. **Mitigation:** reuse `isCrossCohortDispatch`, already enforced for PMs.

## Definition of Done

- All AC met; both j05 steps pass on local and dev.
- Express, Kotlin and instrumented tests green; `npm test` and lint clean.
- Strings in all 21 locales.
- `:shared:compileKotlinIosArm64` green.
- Full journey matrix green on both devices.

## Notes (running log)

- **2026-08-02** — Created while closing the app-testing gaps in SHY-0259. `economy.js` contained no push dispatch of any kind, and no in-app notification surface existed in `shared/src`, while j05 asserted both. Filed at the operator's instruction that a test without a feature is itself a defect to fix.
