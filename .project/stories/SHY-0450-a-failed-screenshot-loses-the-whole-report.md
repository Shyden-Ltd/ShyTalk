---
id: SHY-0450
status: In Review
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

## The decision — RESOLVED 2026-08-24, and neither of the options offered

The story asked Shyden to choose between filing the report anyway and failing it
loudly. The operator's answer named a third thing, and it is better than both:

> "The upload happens at the moment of attaching, not at the moment of sending,
> so the user will know immediately if a file fails to attach and can retry to
> attach it."

That is not how the REPORT flow works. It is exactly how the SUPPORT flow
already works, twenty files away:

| Flow | Uploads | When it fails |
| --- | --- | --- |
| `SupportFormViewModel.attach` (SHY-0387) | at ATTACH, with an `isAttaching` state | error shown, file NOT added to the list, person retries the file |
| `submitUserReport` | at SEND, from raw `ByteArray` | `EvidenceUploadFailed`, and no report is filed |

So the real defect is not the failure policy. It is that one app has **two
attachment designs**, and the report flow got the worse one. The failure policy
question only exists because the upload was deferred to send; move it to attach
and it stops being a question, because by the time Send is pressed the evidence
is already on the server and there is nothing left to fail.

**Resolution: make the report flow work the way the support flow already does.**
Upload on attach, show the failure against the file it belongs to, keep the
file out of the list until it is really uploaded, and let Send carry keys rather
than bytes.

This also removes the compressor/scanner/size failures from the send path
entirely — every one of them becomes a message about the picture the person is
attaching, at the moment they attach it, which is the only moment they can do
anything about it.

## Acceptance Criteria

### Happy path

- [ ] Attaching a picture to a report uploads it there and then, with a visible
      "attaching" state, exactly as the support form does.
- [ ] A picture that uploads appears in the list; pressing Send files the report
      with it and nothing is uploaded at send time.

### Error paths

- [ ] A picture that fails to upload says so AGAINST THAT PICTURE, is not added
      to the list, and can be attached again without losing anything else.
- [ ] The report itself is never lost to a picture. There is no path where
      pressing Send files nothing because of an image.
- [ ] A failure to file the report itself is still reported as a failure — this
      must not become "it always says it worked".

### Edge cases

- [ ] A report with no pictures at all behaves exactly as it does today.
- [ ] Ten pictures with the fifth failing leaves the other nine attached and the
      fifth retryable.
- [ ] A scanner refusal (SHY-0420) and an over-size refusal both surface at
      attach time, naming the actual limit.
- [ ] Attaching, then removing, then sending leaves nothing orphaned in storage
      (the SHY-0434 guarantee, which the support flow already carries).

### Performance

- [ ] Sending is FASTER, because the bytes have already gone. The send request
      carries keys, not images.

### Security

- [ ] No change to what is refused. A refused file is still refused; it simply
      no longer takes the report with it.

### UX

- [ ] The person never sees a message about a picture that silently also means
      "your report was not sent". That state stops existing.
- [ ] The report screen and the support form behave the same way when a file
      fails, because they are the same act.

### i18n

- [ ] Every new string is translated for all locales. Where the support form
      already has the equivalent string, it is reused rather than re-authored.

### Observability

- [ ] Attachment upload failures are distinguishable from report failures, so a
      rise in one is not read as the other.

## BDD Scenarios

**Scenario: The picture will not upload**

- **Given** somebody adding a screenshot to a report
- **When** the picture fails to upload
- **Then** they are told about that picture and can try it again

**Scenario: The report is never lost to a picture**

- **Given** somebody who could not attach their screenshot
- **When** they send the report anyway
- **Then** the report reaches moderation

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

## Notes (running log)

- **2026-09-01** — The safeguarding half is fixed; the attach-time upload
  redesign is not, and is called out below rather than implied.

  `submitUserReport` returned on the first failed upload, so
  `reportRepository.reportUser(...)` was never reached and **no report was
  filed at all**. It now counts failures, still attempts every remaining image,
  and files the report either way — returning
  `SuccessWithEvidenceMissing(n)` so the caller can say both things.

  Both view models set `reportSubmitted = true` AND surface the
  evidence-failure message. Reusing the existing string keeps that honest in
  **all 21 locales** without machine-translating safeguarding copy.

  **Two tests pinned the defect** and had to be rewritten, not just the code:
  `evidence upload Error on first image short-circuits` and its sibling
  asserted that `reportUser` is never called. A third, in RoomViewModelTest,
  passed while the report was being discarded — and its fake had to be told to
  succeed, because under the old behaviour `reportUser` was never reached, so
  nobody noticed it returned an error by default.

  **Still owed** (the attach-time redesign): uploading each picture when it is
  attached, with a per-picture failure state and retry, so the send request
  carries keys rather than bytes. The ACs covering ttaching\ states,
  per-picture retry and the SHY-0434 orphan guarantee are untouched by this
  change.
