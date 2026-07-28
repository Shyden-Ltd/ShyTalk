---
id: SHY-0248
status: In Progress
owner: claude
created: 2026-07-29
priority: P1
effort: M
type: bug
roadmap_ids: []
epic: EPIC-0008
---

# SHY-0248: The roadmap subscribe modal tells you it saved, and saves nothing

## User Story

**As a** person following the ShyTalk roadmap
**I want** the notification choices I make to actually be remembered and acted on
**So that** turning on "email me when a suggestion I follow moves" does what it says,
rather than showing me a success message and quietly discarding it.

## Why

Found 2026-07-29 while de-guarding `tests/web/suggestions-subscribe.spec.ts` under
SHY-0245. Twenty-seven tests in that file were parked as `test.fixme` with the single
comment "requires logged-in state" — so nothing in the subscribe flow had ever been
exercised end-to-end. Signing in for real immediately exposed that the web client and
the API disagree about every field name in the contract:

| Operation | Client sends / reads | Server expects / returns | Result |
| --- | --- | --- | --- |
| Save prefs | `{ preferences, gdprEmailConsent }` | `{ channelPreferences, emailConsent }` | 200 OK, nothing stored |
| Load prefs | `prefs.preferences`, `prefs.watchList` | `channelPreferences`, `watchedSuggestions` | modal always shows defaults, watch list always empty |
| Watch a suggestion | `{ suggestionId }` | `{ type, id }` | 400 "Type and ID required" |

Verified against the running local stack, signed in as the seeded user:

```
PUT /api/subscriptions/me {"preferences":{...},"gdprEmailConsent":true}
  → 200 {"updatedAt":1785260158052}          # every toggle discarded
GET /api/subscriptions/me
  → 200 {"updatedAt":1785260158052}          # nothing persisted
POST /api/subscriptions/me/watch {"suggestionId":"..."}
  → 400 {"error":"Type and ID required"}
```

A 200 that stores nothing is the worst available failure shape: the UI shows
"Subscription preferences saved" and the person walks away believing it worked.

There is a fourth, deeper mismatch behind the field names. The client hardcodes its own
event vocabulary — `newSuggestion` / `statusChange` / `commentReply` / `watchedUpdate` —
which shares **not one key** with the server's `DEFAULT_PREFS`
(`roadmapUpdate`, `suggestionAccepted`, `suggestionPlanned`, `suggestionCompleted`,
`suggestionRejected`, `suggestionMerged`, `commentOnSuggestion`). Only
`channelPreferences.roadmapUpdate` is read by the dispatcher
(`utils/roadmap-notify.js:41`). So even with the field names corrected, the client would
persist preferences under keys nothing consults. Fixing the names alone would turn a
visible no-op into an invisible one — worse, not better.

The fix therefore drives the event list from what the server returns, so the two cannot
drift apart again.

## Acceptance Criteria

### Happy path

- [ ] Turning a channel on for an event, saving, closing and reopening the modal shows that channel still on.
- [ ] The modal lists exactly the events the server knows about, with its four channels each.
- [ ] Clicking the bell on a suggestion adds it to the watch list, and the list shows it by title.
- [ ] A watched suggestion can be un-watched from the modal, and stays un-watched after reopening.

### Error paths

- [ ] A save that the server rejects shows the failure and leaves the modal open with the user's choices intact — never a success toast.
- [ ] A watch that the server rejects (unknown suggestion) says so rather than silently doing nothing.
- [ ] A save is never reported as successful unless the server confirmed the stored state.

### Edge cases

- [ ] Saving without changing anything leaves the stored preferences exactly as they were.
- [ ] Enabling every channel for every event persists all of them.
- [ ] Disabling every channel persists as "notify me about nothing" rather than reverting to defaults.
- [ ] A person with no subscription document yet sees the server's defaults, not an all-off grid.
- [ ] Watching the same suggestion twice does not duplicate the entry.

### Performance

- [ ] Opening the modal costs one preferences request, not one per event row.
- [ ] Saving sends one request containing the whole grid.

### Security

- [ ] Preferences are always read and written for the authenticated user; no client-supplied user id is honoured.
- [ ] Enabling an email channel without consent is refused by the server, and the refusal is surfaced.

### UX

- [ ] The success message appears only after the server confirms, and says what was saved.
- [ ] The watch list distinguishes "nothing watched yet" from "failed to load".
- [ ] Works at the smallest supported viewport first, per the mobile-first rule.

### i18n

- [ ] Every event label ships in all four supported locales (en, zh, id, vi) per SHY-0194.
- [ ] Channel labels and the GDPR notice remain translated.

### Observability

- [ ] A rejected save logs the server's reason rather than a generic failure.

## BDD Scenarios

**Scenario: my choices survive closing the modal**
- **Given** I am signed in on the roadmap page
- **When** I turn on email for a status change, save, and reopen the subscribe modal
- **Then** email is still on for that event

**Scenario: a failed save does not claim success**
- **Given** the server will reject my save
- **When** I save my preferences
- **Then** I am told it failed
- **And** the modal stays open with my choices as I left them

**Scenario: watching a suggestion from its bell**
- **Given** I am signed in and looking at a suggestion
- **When** I click its bell
- **Then** it appears in my watch list by title

**Scenario: turning everything off means everything off**
- **Given** I have several channels enabled
- **When** I turn them all off and save
- **Then** reopening the modal shows them all off, not the defaults

## Test Plan

### Red (must fail first)

- `tests/web/suggestions-subscribe.spec.ts` — the 27 previously-parked tests, unparked and driven by a real sign-in.
- `express-api/tests/routes/subscriptions*.test.js` — pin the request/response contract the client depends on.

### Green

- `public/js/suggestions-board.js` — read `channelPreferences` / `watchedSuggestions`, send `channelPreferences` + `emailConsent`, send `{ type, id }` on watch, add un-watch.
- `public/js/suggestions-i18n.js` — labels for the server's event keys in en/zh/id/vi.

### Mutation proof

- Revert the save body to `{ preferences }` → the persistence test must fail.
- Revert the load to `prefs.preferences` → the reopen test must fail.
- Revert the watch body to `{ suggestionId }` → the watch test must fail.

## Out of Scope

- Adding new notification events to the server's vocabulary.
- The in-app notification inbox itself.
- Push-token registration on web.

## Dependencies

- None blocking. Shares `tests/web/suggestions-subscribe.spec.ts` with SHY-0245, so it is sequenced with it.

## Risks & Mitigations

- **Risk:** driving the event list from the server means an unlabelled key renders raw. **Mitigation:** fall back to a humanised key and cover every current key with a translation.
- **Risk:** people who "saved" preferences before this fix have nothing stored. **Mitigation:** nothing was ever stored, so there is no bad data to migrate — the first real save is authoritative.

## Definition of Done

- All AC boxes ticked; every BDD scenario has a named test.
- Every parked test in `suggestions-subscribe.spec.ts` is unparked and passing.
- Reviewer 100% clean; CI green by name; journey matrix per the pre-merge protocol.

## Notes (running log)

- **2026-07-29** — Filed from SHY-0245 de-guarding. Contract mismatch confirmed by
  direct calls against the local stack (see Why). Fixed forward on the SHY-0245 branch
  because the tests that expose it are the same tests SHY-0245 is unparking.
