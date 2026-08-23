---
id: SHY-0450
status: Draft
owner: unassigned
created: 2026-08-24
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0450: A failed screenshot loses the whole report

## User Story

As **somebody reporting another person with a screenshot**, I want the report to
reach moderation even if the picture will not upload, so that the thing I was
actually trying to do still happens.

## Why

`submitUserReport` uploads each evidence image first, and returns on the first
failure:

```kotlin
is Resource.Error -> return UserReportOutcome.EvidenceUploadFailed
```

`reportRepository.reportUser(...)` is never reached. **No report is filed at
all** — not a report without its picture, nothing.

So an upload failure of any kind — a flaky connection, a file the compressor
refuses, a scanner refusal (SHY-0420), an image over the size bound — silently
converts "I am reporting this person for harassment" into nothing having
happened. The person is told the evidence failed; there is no reason for them to
understand that the report went with it.

This was found alongside a defect that made it certain rather than occasional:
the client uploaded evidence to `path = "report_evidence"`, which the storage
route's allowlist did not contain, so **every** report with a screenshot was
refused. That half is fixed. This half is a decision.

## The decision, for Shyden

| Option | What somebody gets |
| --- | --- |
| **A — file it anyway** (recommended) | The report reaches moderation with whatever evidence uploaded, and they are told plainly which images did not attach and that they can add them by replying |
| B — keep today's behaviour, but say so | Nothing is filed, and the message says clearly that the report was NOT sent and they must try again |

**Recommendation: A.** The report is the thing that matters. A moderator reading
"they keep sending me this" with one image instead of two can still act; a
moderator who never receives the report cannot. Option B is only defensible if
we think a report without its evidence is worse than no report, and for
harassment and safety it plainly is not.

Whichever is chosen, the current behaviour — the report vanishing while the
message talks only about the picture — is not one of the options.

## Acceptance Criteria

### Happy path

- [ ] With every image uploaded, nothing changes.
- [ ] With one image failing, the report is still filed (option A) and names
      which images are missing.

### Error paths

- [ ] With EVERY image failing, the report is still filed with none attached.
- [ ] The person is told what did not attach, in their own language.
- [ ] A failure to file the report itself is still reported as a failure — this
      must not turn into "it always says it worked".

### Edge cases

- [ ] A report with no images at all behaves exactly as it does today.
- [ ] Ten images with the fifth failing files the other nine.
- [ ] A scanner refusal (SHY-0420) is treated as a failed image, not a failed
      report.

### Performance

- [ ] No change.

### Security

- [ ] No change. A refused file is still refused; it simply no longer takes the
      report with it.

### UX

- [ ] The message distinguishes "sent, without some pictures" from "not sent".
      Today they are the same message.

### i18n

- [ ] Every new string is translated for all locales.

### Observability

- [ ] Reports filed with evidence missing are distinguishable, so a rise in
      upload failures is visible rather than being read as fewer reports.

## BDD Scenarios

**Scenario: The picture will not upload**

- **Given** somebody reporting another person with a screenshot that fails to upload
- **When** they submit the report
- **Then** the report reaches moderation and they are told the picture did not attach

**Scenario: Nothing was wrong**

- **Given** somebody reporting another person with a screenshot that uploads
- **When** they submit the report
- **Then** it behaves exactly as it does today

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | With the storage double failing, `reportUser` is still called. This is the mutation that matters: today it is not. |
| Unit | The outcome distinguishes "filed without evidence" from "not filed". |
| Device | A report submitted with a deliberately failing upload appears in the moderation queue. |

## Out of Scope

- The storage path allowlist, fixed already.
- Retrying failed uploads.

## Dependencies

- None. The allowlist fix removes the common cause; this removes the class.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A moderator acts on a report whose evidence is missing without realising | The report records which evidence failed, so the queue can show it. |
| "Filed without evidence" is read as success and nobody chases the upload bug | Made observable, per the AC above. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Mutation-proven: with the upload failing, a report is still filed.

## Notes

- Found on 2026-08-24 while finishing SHY-0420's remaining scope. Every existing
  test of this flow mocks `StorageRepository` with a double that always
  succeeds, so the branch has never been exercised.
