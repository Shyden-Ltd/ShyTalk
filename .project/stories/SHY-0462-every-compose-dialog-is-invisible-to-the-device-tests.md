---
id: SHY-0462
status: Draft
owner: unassigned
created: 2026-08-25
priority: P2
effort: M
type: bug
roadmap_ids: []
mvp: false
---

# SHY-0462: Every Compose dialog is invisible to the device tests

## User Story

As **whoever writes a device journey**, I want a testTag inside a dialog to
reach uiautomator like every other tag, so that a screen behind a dialog is not
silently untestable.

## Why

A Compose `Dialog`, `AlertDialog`, `ModalBottomSheet` or `DropdownMenu` renders
in its **own window**, which does not inherit the
`Modifier.semantics { testTagsAsResourceId = true }` set on MainActivity's root.
Every testTag inside one stays internal, and the uiautomator dump shows:

```
resource-id="android:id/content"
```

...and nothing else. The controls are visibly on screen; the tree says the
window is empty.

The codebase already knows. `TestTagsExposed.kt` documents it from SHY-0096 and
provides `Modifier.exposeTestTagsToPlatformDumps()`, whose docstring says:
**"Apply once per Compose window (every Popup / Dialog / BottomSheet)."** It was
simply never applied beyond the two places SHY-0096 touched.

It cost four separate stalls in one day's work (2026-08-25), each looking like a
different bug:

| Surface | Symptom |
| --- | --- |
| `CreateRoomDialog` | J09 could not type a room name |
| `RoomSettingsSheet` | J09 could not close the room |
| `DropdownMenu` (PrivateMessageBubble) | J11 could not reach "Report" |
| `ReportMessageDialog` | J11 could not submit the report |

Each was diagnosed from scratch because nothing connects them. **17 more files**
contain dialogs or sheets with testTags and no exposure — `SupportPage.kt` (20
tags), `ProfileScreen.kt` (7), `SecuritySettingsScreen.kt` (5),
`ReportMessageDialog.kt`, `PrivateChatScreen.kt` (5), `AgeRestrictionDialog.kt`
(4), `WalletScreen.kt`, `RequiredDOBScreen.kt`, `ReportReviewScreen.kt`,
`ProfileSetupScreen.kt`, `PinSetupScreen.kt`, `HomeScreen.kt`,
`DailyRewardDialog.kt`, `SharedNavGraph.kt` and others.

Every one is a journey that cannot be written until somebody rediscovers this.

## Acceptance Criteria

### Happy path

- [ ] Every testTag inside a dialog, sheet or popup reaches uiautomator.
- [ ] The 17 remaining files are swept.

### Error paths

- [ ] A NEW dialog that tags a control without exposing it is caught before
      merge. Fixing 17 files without that guard just resets the clock.

### Edge cases

- [ ] Nested windows — a dialog opened from a sheet — work too.
- [ ] iOS is unaffected: the helper is a no-op there, because XCUITest reads
      accessibility identifiers.

### Performance

- [ ] A semantics modifier per window. No measurable cost.

### Security

- [ ] None. testTags are inert identifiers.

### UX

- [ ] No user-visible change.

### i18n

- [ ] None — this is what stops journeys having to match localised labels.

### Observability

- [ ] The guard names the file and the tag when it fails.

## BDD Scenarios

**Scenario: A journey drives a control inside a dialog**

- **Given** a dialog with a tagged control
- **When** a journey looks for that control
- **Then** it finds it

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | A composable containing a Dialog/Sheet/Popup and a testTag must also call exposeTestTagsToPlatformDumps. |
| Guard | A planted violation fails; a clean fixture passes. |
| Device | A journey drives a control inside a swept dialog. |

## Out of Scope

- Writing journeys for all 17 surfaces. This makes them *possible*.

## Dependencies

- [[SHY-0096]] — found it, documented it, fixed two places.
- [[SHY-0457]] — met it four more times.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A blanket sweep changes semantics somewhere subtle | The helper only sets testTagsAsResourceId; it alters no behaviour a user can see. |
| It recurs a sixth time | The guard is the actual deliverable; the 17 files are the backlog it protects. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Guard in CI, with its own tests.
- [ ] All 17 files swept.

## Notes

- Filed 2026-08-25 after the fourth occurrence in a single day. The pattern was
  documented in July and applied twice.
