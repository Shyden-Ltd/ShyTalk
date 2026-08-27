---
id: SHY-0390
status: Draft
owner: unassigned
created: 2026-08-21
priority: P2
effort: XS
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0390: Message-report reasons show in English to everyone

## User Story

As **somebody reporting a message in my own language**, I want the reasons to be
in that language, so that I can tell which one I am choosing.

## Why

Found while looking at reporting as the model for the support page.

`ReportMessageDialog.kt` defines its reasons as raw English strings and renders
them directly:

```kotlin
internal val reportMessageReasons = listOf("Spam", "Harassment", "Inappropriate Content", "Other")
...
Text(text = reason, style = MaterialTheme.typography.bodyMedium)
```

So a Thai, Vietnamese, Indonesian or Chinese user reporting a message picks from
four English phrases.

**The sibling dialog does it correctly.** `ReportUserDialog.kt` keeps the same
list as *keys* and maps them through a `reportReasonLabel()` composable to
`Res.string.report_reason_spam` and friends. The strings already exist in every
locale — this surface simply never used them.

That is what makes this small and worth doing now: the translations are already
there.

### Why it matters more than a cosmetic slip

Reporting is a moderation surface with a minor cohort present. Somebody who
cannot read the options may pick the wrong one or give up, and a misfiled report
is a moderation failure, not a UI blemish.

## Acceptance Criteria

### Happy path

- [ ] The four message-report reasons render in the reader's language.
- [ ] The value SENT to the server is unchanged, so existing reports and admin
      filters still work.

### Error paths

- [ ] An unrecognised reason falls back to its key rather than rendering blank.

### Edge cases

- [ ] Both report surfaces show the same four reasons in the same order, so
      somebody who uses one and then the other sees no difference.

### Performance

- [ ] No change.

### Security

- [ ] No change to what is reported or to whom.

### UX

- [ ] Nothing user-facing renders a hardcoded English string.

### i18n

- [ ] Asserted on **rendered text** per locale, not on the presence of a key.

### Observability

- [ ] Stored report reasons are unchanged, so historical data stays comparable.

## BDD Scenarios

**Scenario: Reasons are readable in the reader's language**

- **Given** somebody using ShyTalk in Thai
- **When** they report a message
- **Then** the reasons are in Thai

**Scenario: What we store does not change**

- **Given** somebody reports a message
- **When** an admin looks at it
- **Then** the reason is recorded exactly as it is today

## Test Plan

| Layer | What it proves |
| --- | --- |
| Copy tests | Each reason renders localised in every locale, asserted on rendered text. |
| Contract | The value sent to the server is the unchanged key, so existing reports remain comparable. |
| Guard | No user-facing Compose surface renders a hardcoded reason list — the check that stops the third one appearing. |

## Out of Scope

- Changing the reason list itself.
- `ReportUserDialog`, which is already correct.

## Dependencies

- None. The `Res.string.report_reason_*` entries already exist in every locale.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Localising the label accidentally changes the stored value | Keys stay the wire value; only the label is translated, with a contract test. |
| The two dialogs drift apart again | A test asserts both surfaces offer the same reasons in the same order. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Seen in a non-English locale on a real device.

## Notes

- The fix is to reuse `ReportUserDialog`'s `reportReasonLabel()` rather than
  write a second mapping. Two mappings would drift.
