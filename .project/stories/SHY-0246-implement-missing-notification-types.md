---
id: SHY-0246
status: In Progress
owner: claude
created: 2026-07-28
priority: P1
effort: L
type: bug
roadmap_ids: []
epic: EPIC-0008
---

# SHY-0246: Create the six notification types the clients already handle but the server never emits

## User Story

**As a** ShyTalk user who has subscribed to a suggestion or opted into roadmap updates
**I want** to actually receive the notification when that suggestion is accepted, planned,
completed, rejected or commented on, and when the roadmap changes
**So that** the subscribe control I used is not a no-op, and I find out about the thing I asked to be told about.

## Why

Surfaced 2026-07-28 while de-sleeping `suggestions-notifications.test.js` under SHY-0245.
24 of its 49 tests were ACTIVE with empty bodies — they ran, asserted nothing and reported
green. The reason they were empty is that **the features under test do not exist**.

Comparing the types the clients parse (`shared/src/jvmTest/.../RoadmapNotificationTest.kt:31-37`,
spec 11.15) against every notification-creating site in the server
(`express-api/src/routes/suggestions.js:508`, `:1422`, `:1551` — the only three):

| type | client parses | server creates |
| --- | --- | --- |
| `roadmap_update` | yes | **no** |
| `suggestion_accepted` | yes | **no** |
| `suggestion_planned` | yes | **no** |
| `suggestion_completed` | yes | **no** |
| `suggestion_rejected` | yes | **no** |
| `comment` | yes | **no** |
| `suggestion_merged` | yes | yes |
| `suggestion_submitted` | **no** | yes |
| `dispute_resolved` | **no** | yes |

Six of the seven types the clients handle are never produced, and two types the server does
produce are not in the clients' parse list.

Compounding it, the in-app channel is silently dropped in dispatch. `dispatchNotificationInline`
(`express-api/src/utils/notification-channels.js:38-111`) documents `inApp` as a supported
channel in its own JSDoc at `:26` but implements only `email`, `push` and `systemMessage`.
Because the DEFAULT roadmap preference is in-app only
(`express-api/src/routes/subscriptions.js:21` — `{email:false, push:false, inApp:true, systemMessage:false}`)
and `computeRoadmapOptedIn` counts `inApp` as opted-in (`utils/notification-prefs.js:22`), every
user on the default setting is selected by the fan-out query, passes the `hasAnyChannel` guard,
is dispatched, and receives **nothing on any channel** — while the dispatcher returns success and
logs `"Notification dispatched"`, so monitoring shows it healthy.

The gap was actively defended by a test: `tests/utils/notification-channels.test.js:368`
("inApp channel flag is accepted in payload but has no dispatch side effect") asserts the broken
behaviour as intended, justified by the claim that "in-app notifications are surfaced by clients
reading their own paths". No such client path exists — the only in-app inbox is
`GET /api/notifications`, which queries the `notifications` collection by `uid`.

## Acceptance Criteria

### Happy path

- [ ] Accepting a suggestion creates a `suggestion_accepted` notification for the submitter and every subscriber.
- [ ] Moving a suggestion to planned creates `suggestion_planned` for all subscribers.
- [ ] Completing a suggestion creates `suggestion_completed` for all subscribers.
- [ ] Rejecting a suggestion creates `suggestion_rejected` for the submitter only.
- [ ] Adding a comment creates `comment` for the suggestion's subscribers, excluding the comment author.
- [ ] A roadmap change creates a `roadmap_update` in-app notification for every opted-in subscriber.
- [ ] `dispatchNotificationInline` honours `channels.inApp` by writing a `notifications` doc and reporting `inApp: 'sent'` in its result.

### Error paths

- [ ] A failure on one channel does not prevent the others (existing per-channel try/catch extended to `inApp`).
- [ ] A Firestore write failure on the in-app channel returns `inApp: 'failed'` and logs at error level; it never throws to the caller.
- [ ] A status transition whose notification write fails still completes the status change (fire-and-forget, matching the existing pattern at `suggestions.js:522`).
- [ ] A suggestion with no submitter (`submitterUid` absent) does not create a notification and does not throw.

### Edge cases

- [ ] No duplicate notification when a status is re-set to its current value (no-op transitions emit nothing).
- [ ] The comment author never receives a notification for their own comment.
- [ ] A subscriber who is also the submitter receives exactly ONE notification, not two.
- [ ] Completing a suggestion clears the subscription, per spec 11.7, without breaking a later re-subscribe.
- [ ] A subscriber list of zero produces no writes and no error.

### Performance

- [ ] Fan-out uses a single batched write per status change rather than one round-trip per subscriber.
- [ ] The subscriber query filters server-side (indexed field), never a full-collection scan — the constraint that shaped `roadmapUpdateOptedIn` in `utils/roadmap-notify.js:24-30`.

### Security

- [ ] Notification creation is only reachable through the existing admin/authorised status-change routes; no new unauthenticated surface.
- [ ] A notification body never leaks another user's email address, uid, or any moderation note.
- [ ] Recipients are resolved server-side from the subscription records — never from client-supplied recipient lists.

### UX

- [ ] Title and body are non-technical and name the suggestion, e.g. "Your suggestion was accepted" / `"<title>" is now planned`.
- [ ] Notification shape matches the fields the existing inbox and clients already read (`uid`, `userId`, `recipientUid`, `type`, `title`, `body`, `suggestionId`, `isRead`, `createdAt`), so no client change is required to display them.

### i18n

- [ ] User-facing notification strings follow the existing localisation approach used by `utils/suggestion-email-templates.js`; any new string ships in all four supported locales (en, zh, id, vi) per SHY-0194.

### Observability

- [ ] Each fan-out logs one structured line with type, suggestionId and recipient count.
- [ ] The in-app channel appears in the `dispatchNotificationInline` result object and its structured log, so a silent no-op is impossible to mistake for success — the exact failure this story fixes.

## BDD Scenarios

**Scenario: a subscriber is told when their suggestion is accepted**
- **Given** a suggestion with a submitter and two subscribers
- **When** an admin accepts it
- **Then** three `suggestion_accepted` notifications exist, one per person, each naming the suggestion title
- **And** each is unread

**Scenario: rejection is private to the submitter**
- **Given** a suggestion with a submitter and two subscribers
- **When** an admin rejects it
- **Then** exactly one `suggestion_rejected` notification exists, addressed to the submitter
- **And** neither subscriber receives one

**Scenario: the default roadmap setting actually delivers**
- **Given** a subscriber whose roadmap preference is the shipped default (in-app only)
- **When** the roadmap changes
- **Then** a `roadmap_update` notification appears in that user's inbox
- **And** no email and no push is sent

**Scenario: commenting does not notify yourself**
- **Given** a suggestion whose subscribers include the person about to comment
- **When** that person adds a comment
- **Then** no `comment` notification is addressed to them
- **And** the other subscribers each receive one

**Scenario: one broken channel does not silence the rest**
- **Given** a subscriber with in-app and email both enabled
- **When** the in-app Firestore write fails
- **Then** the email is still sent
- **And** the dispatch result reports `inApp: 'failed'` and `email: 'sent'`

## Test Plan

### Red (must fail first)

- `express-api/tests/utils/notification-channels.test.js` — `dispatchNotificationInline` writes a `notifications` doc when `channels.inApp` is set; asserts `inApp: 'sent'`. Fails today (no branch exists).
- `express-api/tests/routes/suggestions-notifications.test.js` — one named test per missing type, replacing the empty bodies in `Notification Creation on Events`.
- `express-api/tests/utils/roadmap-notify.test.js` — a default-preference subscriber receives an in-app notification. Fails today.

### Green

- Add the `inApp` branch to `dispatchNotificationInline` writing the schema at `suggestions.js:1422`.
- Emit notifications at each status-change site and in the comment route.
- Delete/replace `notification-channels.test.js:368`, which asserts the defect as intended behaviour.

### Mutation proof

- Remove the `inApp` branch → the new dispatcher test must fail on the doc write, not merely on the result object.
- Flip the comment-author exclusion → the self-notification test must fail.
- Change a recipient set from submitter-only to all-subscribers on rejection → the privacy test must fail.

## Out of Scope

- The reverse mismatch (`suggestion_submitted` and `dispute_resolved` are emitted but not parsed by clients) — recorded here, fixed under its own story so this one stays reviewable.
- Any change to push/email transport, templates or the unsubscribe flow.
- Notification retention/pruning policy.

## Dependencies

- None blocking. Touches `express-api/src/utils/notification-channels.js`, `src/routes/suggestions.js`, `src/utils/roadmap-notify.js`.
- Shares files with SHY-0245 (in flight on `story/SHY-0245-eradicate-test-sleeps`); sequenced after it to avoid conflicts.

## Risks & Mitigations

- **Risk:** notification volume spikes on a bulk status change. **Mitigation:** batched writes, and the fan-out stays fire-and-forget so it cannot slow the status change.
- **Risk:** duplicate notifications when submitter and subscriber are the same person. **Mitigation:** recipients de-duplicated by uid before writing; covered by an explicit edge-case test.
- **Risk:** re-introducing the silent no-op for a future channel. **Mitigation:** the dispatch result object gains `inApp`, and the observability AC requires every channel to appear in the structured log.

## Definition of Done

- All AC boxes ticked; every BDD scenario has a named test.
- The 24 empty tests in `suggestions-notifications.test.js` are real or honestly parked.
- `notification-channels.test.js:368` no longer asserts the defect.
- Express suite green via canonical `npm test`; mutation proofs recorded in Notes.
- Reviewer 100% clean; CI green by name; journey matrix per the pre-merge protocol.

## Notes (running log)

- **2026-07-28** — Filed from SHY-0245 de-sleeping. Root evidence: only three notification-creating
  sites exist server-side (`suggestions.js:508/1422/1551`); `dispatchNotificationInline` ignores
  `inApp` despite its JSDoc; the shipped default roadmap preference is in-app only, so the default
  configuration is a guaranteed silent no-op. Operator direction (2026-07-28): implement the
  features rather than park the tests — "fix forward".
