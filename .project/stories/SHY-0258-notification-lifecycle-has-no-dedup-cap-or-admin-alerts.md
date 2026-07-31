---
id: SHY-0258
status: In Progress
owner: claude
created: 2026-07-30
priority: P2
effort: M
type: feature
roadmap_ids: []
---

# SHY-0258: Notifications have no deduplication, no retention limit, and never reach admins

## User Story

**As a** user who follows a suggestion, and as a moderator watching the queue
**I want** notifications that do not repeat themselves, do not grow forever, and tell an admin when something needs attention
**So that** the inbox stays useful and the free-tier quota is not spent storing an unbounded log nobody reads.

## Why

Surfaced 2026-07-30 while driving the SHY-0256 defect list down.

Twelve tests in `tests/routes/suggestions-notifications.test.js` were
`test.skip(...)` — parked — *and* had bodies containing no assertion at all.
Un-skipping all twelve turns the suite green precisely because they assert
nothing: they were hidden twice over, and neither layer would ever have
reported the gap.

`routes/suggestions-notifications.js` exposes three routes — list, mark one
read, mark all read. Nothing else exists:

- **No deduplication.** The same event fired twice writes two notifications.
  A roadmap feature edited twice in a minute notifies twice. A user subscribed
  both to "all updates" and to a specific feature is notified twice for one
  event.
- **No retention limit.** Notifications accumulate without bound — no per-user
  cap, no eviction of the oldest, no age-based cleanup. On a $0 Firestore
  budget that is a cost that only ever grows, on a collection whose old rows
  nobody reads.
- **No admin alerting.** A newly submitted suggestion notifies nobody with the
  power to triage it; the moderation queue has to be checked by hand.

## Acceptance Criteria

### Happy path

- [ ] The same event delivered twice creates ONE notification, not two.
- [ ] A user subscribed both to "all updates" and to a specific feature receives one notification per event.
- [ ] A new suggestion creates a notification for admins.
- [ ] The admin listing reports the pending-suggestion count alongside the rows.

### Error paths

- [ ] A deduplication lookup that fails delivers the notification rather than dropping it — losing a notification is worse than repeating one.
- [ ] Eviction failure never fails the write that triggered it.

### Edge cases

- [ ] Two genuinely distinct events close together (approve, then overturn) produce TWO notifications — dedup must not swallow a real second event.
- [ ] A roadmap feature updated twice inside the debounce window produces one notification.
- [ ] At the per-user cap (200), storing the 201st evicts the oldest, leaving exactly 200.
- [ ] Notifications older than 90 days are cleaned up.
- [ ] Deleting notifications never alters the user's subscription preferences.
- [ ] Watching a suggestion that is later MERGED transfers the watch to the target — today the merge routes move votes and mark the duplicate, but nothing moves watchers, so the watcher silently stops hearing about it.

### Performance

- [ ] Deduplication costs at most one indexed read per delivery; it must not scan the user's notification history.
- [ ] Cleanup is event-driven or lazy-on-access, never a scheduled cron — crons cost free-tier quota (see the cron-elimination architecture in CLAUDE.md).

### Security

- [ ] Admin notifications are readable only by admins.
- [ ] An admin notification carries a submitter identity SUMMARY, never the submitter's raw contact details.
- [ ] Eviction can only ever delete the owning user's own rows.

### UX

- [ ] The inbox never shows the same event twice in a row.
- [ ] Hitting the cap is invisible to the user — no error, no gap in recent items.

### i18n

- [ ] N/A — reuses the existing localised subjects from `utils/suggestion-email-templates.js`; no new strings.

### Observability

- [ ] Each suppressed duplicate is logged at debug with the dedup key, so "why did I not get a notification" is answerable.
- [ ] Each eviction is logged with the user and the number removed.

## BDD Scenarios

**Scenario: one event, one notification**
- **Given** a user following a suggestion
- **When** the same status change is delivered twice
- **Then** their inbox shows it once

**Scenario: two real events stay two**
- **Given** an admin who approves a suggestion and then immediately overturns it
- **When** both events are delivered
- **Then** the user sees both, because they are different events

**Scenario: the inbox does not grow forever**
- **Given** a user already holding 200 notifications
- **When** a new one arrives
- **Then** the oldest is removed and they still hold 200

**Scenario: someone is told there is work to do**
- **Given** a user submitting a new suggestion
- **When** the submission succeeds
- **Then** a notification is created for admins

**Scenario: a watch survives a merge**
- **Given** a user watching a suggestion that an admin then merges into another
- **When** the target suggestion is updated
- **Then** the user is still notified, because their watch moved with it

**Scenario: clearing the inbox is not unsubscribing**
- **Given** a user with notification preferences set
- **When** their notifications are deleted
- **Then** their preferences are unchanged

## Test Plan

**RED first** — the twelve `test.todo` entries now in
`tests/routes/suggestions-notifications.test.js` are the specification. Each
becomes a real test against the real emulator:

- dedup: `same event fired twice`, `roadmap feature updated twice in 1 minute`,
  `subscribed to both all-updates and a specific feature`,
  `approve then overturn produces two`
- watch transfer: `user watches suggestion that gets merged: watch transferred to original` (tests/routes/subscriptions.test.js)
- retention: `max 200 per user`, `201st evicts the oldest`,
  `older than 90 days cleaned up`, `deletion does not affect preferences`
- admin: `new suggestion creates an admin notification`,
  `suggestion count badge`, `pending count in the response`,
  `admin notification includes a submitter identity summary`

Plus error-path tests for a failing dedup lookup (delivers anyway) and a
failing eviction (does not fail the write).

**GREEN:** a dedup key on delivery, a cap-and-evict on write, lazy age-based
cleanup on access, and an admin notification on submission.

**Mutation checks:** removing the dedup key must fail the duplicate test while
LEAVING the approve-then-overturn test green; changing the cap to 201 must fail
the eviction test; removing the admin write must fail the admin test.

## Out of Scope

- Push/email delivery preferences — already implemented and covered.
- The notification inbox UI.
- Retention for any collection other than `notifications`.

## Dependencies

- None. All three build on the existing `notifications` collection and the
  delivery path in `routes/suggestions.js`.

## Risks & Mitigations

- **Risk:** dedup swallows a genuine second event.
  **Mitigation:** the key includes the event identity, not just the
  suggestion; the approve-then-overturn scenario is an explicit AC and a
  mutation check.
- **Risk:** eviction deletes rows another user owns.
  **Mitigation:** eviction is scoped to the owning uid, asserted in the AC.
- **Risk:** a cleanup cron reintroduces scheduled quota cost.
  **Mitigation:** the AC forbids a cron — lazy-on-access or event-driven only,
  matching the cron-elimination architecture already in place.

## Definition of Done

- [ ] All twelve `test.todo` entries are real, passing tests.
- [ ] Dedup, cap-and-evict and admin notification implemented.
- [ ] Mutations killed.
- [ ] `cd express-api && npm test` green.
- [ ] `code-reviewer` 100% clean.

## Notes

- 2026-07-30 — Filed from SHY-0256. The twelve specs were `test.skip` with
  assertion-free bodies: parked AND empty, so un-skipping them turns the suite
  green without a line of product code. Converted to `test.todo`, which the
  defect detector counts, so the gap stays visible rather than being relabelled
  away.

**2026-07-31 — DELIVERED (server side).**

Dedup, retention cap and TTL implemented in `src/utils/notification-retention.js`
and applied by the only writer of the in-app inbox
(`dispatchNotificationInline`). Cap/TTL are enforced LAZILY on write rather than
by a cron, matching the cron-elimination architecture — crons burn free-tier
quota, and the write is the only moment the work is needed.

Reads deliberately avoid `orderBy('createdAt')`: Firestore's orderBy silently
EXCLUDES documents missing the ordered field, which made undated rows immortal
(invisible to the reaper) AND invisible in the inbox. Same defect class as
SHY-0260.

**Admin alerts — operator decision 2026-07-31: "Both".** The blocker was that
admin status exists only as a Firebase Auth custom claim, granted outside the
API, so there was no queryable set of admins. Resolved by building the directory
FROM TRAFFIC (`src/utils/admin-directory.js`): the auth middleware records an
admin each time it verifies a live claim. No backfill script, nothing to run
against production. The directory is a CANDIDATE list — the live claim stays
authoritative — so a demoted admin stops receiving alerts, and a verification
outage EXCLUDES a candidate rather than widening the audience.
- PULL: `pendingCount` on the admin suggestions listing, admins only (a
  non-admin cannot even filter by `pending`, so its size is withheld too),
  counted with an aggregation query so the badge costs the same at any size.
- PUSH: `notifyAdminsOfNewSuggestion` fans out on submission, in-app only, with
  the submitter identified and the title capped.

**Two real bugs surfaced while un-parking the specs:**
1. `unread count: only counts notifications < 90 days old` ended on a COMMENT
   with no assertion for its own claim. Asserting it FAILED — the inbox counted
   expired notifications. Fixed in the route.
2. The shared notification fixture hardcoded `createdAt: 1709913600000`
   (8 March 2024). Recent when written, long past the 90-day TTL now, so every
   fixture notification had silently become "expired". Derived from now — a
   fixture that depends on the wall clock is a test with an expiry date.

All 15 SHY-0258 `test.todo` markers retired with real coverage (44 new
real-emulator tests). Mutation-verified: ignoring the recipient in the dedup
key, trimming newest instead of oldest, and treating undated rows as brand new
each fail tests.

**Owed:** client-side surfacing of `pendingCount` in the admin panel badge, and
the real-device gauntlet.

