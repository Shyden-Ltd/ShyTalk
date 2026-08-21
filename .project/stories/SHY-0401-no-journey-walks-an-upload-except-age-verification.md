---
id: SHY-0401
status: Draft
owner: unassigned
created: 2026-08-21
priority: P0
effort: L
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0401: Every file a person can send is unwalked, except an ID

## User Story

As **somebody who sends a photo through ShyTalk**, I want that path to have been
walked before it reached me, so that the feature I am relying on is known to work
rather than assumed to.

## Why

**Operator, 2026-08-21:** *"How are our customers supposed to have faith in the
product if we don't even test that it works."*

A journey audit of the whole corpus — **471 scenarios across 68 feature files** —
found that **exactly one** upload flow is walked end to end.

### What is walked

Age verification, and it is the model:

```gherkin
When Adam on Android selects test image "test-passport-adult.jpg" from the gallery
When Adam on Android submits a photo of his passport
Then Adam is told his ID is waiting to be reviewed
Then Greta's Web Admin UI shows the ID image
```

Plus the unhappy path — `picks a 15MB test image` → `"Image too large"`. It picks,
it sends, it fails properly, **and it crosses the seam into the admin panel.**

### What is not walked

| Flow | Journey steps |
| --- | --- |
| Report evidence | **none** — `attach` appears in 0 steps |
| Private-message image | **none** |
| Stickers | **none** — `sticker` in 0 feature files |
| Profile photo | **none** |
| Support attachments | **none** — new in [[SHY-0387]] |

Reporting is heavily journeyed — report, queue, warn, suspend, cascade — and not
one scenario ever attaches anything.

### What that cost

[[SHY-0400]]: the admin panel has a complete video-evidence path — `isVideoUrl()`,
a `<video>` element, a play badge, a lightbox — and the client can never produce
one, because both pickers are images-only and the content type is hardcoded
`image/jpeg`. Dead code on a moderation surface, with minors present.

Unit tests could not see it: feeding `isVideoUrl('x.mp4')` a URL proves the
renderer, not that anything upstream can make one. **The age-verification journey
would have caught the equivalent bug in its flow on day one, because it crosses
the seam.** No other upload flow has that.

## Acceptance Criteria

### Happy path

- [ ] Each upload flow below is walked end to end on a real device, and the
      result is confirmed **at the far end** — the admin panel, or the recipient —
      not merely "the UI accepted it".
- [ ] Report evidence: attach an image to a report; a moderator sees it.
- [ ] Report evidence: attach a **video**; a moderator can play it ([[SHY-0400]]).
- [ ] Private message: send an image; the recipient sees it.
- [ ] Sticker: send one; the recipient sees it.
- [ ] Profile photo: set one; it appears on the profile others see.
- [ ] Support ticket: attach a file; an admin sees it ([[SHY-0387]]).

### Error paths

- [ ] A file over the size bound is refused with a readable reason, before upload.
- [ ] An upload that fails mid-flight is reported, and what the person typed
      survives.
- [ ] Cancelling the picker leaves the form exactly as it was.
- [ ] Losing connectivity during an upload does not silently drop the file.

### Edge cases

- [ ] Attaching, removing and re-attaching leaves the right set.
- [ ] The maximum number of attachments is reached and refused cleanly.
- [ ] A file of an unsupported type is refused at the picker, not after upload.
- [ ] Every flow is walked on **both** a real Android device and a real iPhone —
      a walk on one platform proves nothing about the other.

### Performance

- [ ] A large-but-allowed file completes, and the UI stays responsive while it does.

### Security

- [ ] Uploaded media is readable only by whoever should see it — a report's
      evidence by moderators, a PM image by the conversation, a support
      attachment by admins.
- [ ] Asking for another account's uploaded object by key is refused. This gets
      its own scenario per flow; it is the one that matters most and the one
      least likely to be walked by accident.

### UX

- [ ] What the picker offers matches what the copy promises.

### i18n

- [ ] Refusal messages are asserted on rendered text, in a non-English locale.

### Observability

- [ ] A failed upload leaves evidence in the logs naming which flow it was.

## BDD Scenarios

**Scenario: A moderator sees the evidence that was attached**

- **Given** somebody reporting another person
- **When** they attach a screenshot and send the report
- **Then** a moderator opening that report can see the screenshot

**Scenario: An oversized file is refused before it uploads**

- **Given** somebody attaching a file larger than the limit
- **When** they choose it
- **Then** they are told why, and nothing is sent

**Scenario: Another account's upload stays private**

- **Given** a file uploaded by somebody else
- **When** an account that does not own it asks for it
- **Then** it is refused

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, both devices** | The decisive one. Each flow picked, sent, and confirmed at the FAR end, on real Android and real iPhone. Model it on `j21-age-gate-cta`, which already does this correctly for ID upload. |
| Seam | For each flow, what the client can emit is asserted against what the consumer can render — the check that would have caught [[SHY-0400]] without a device. |
| Unhappy path | Oversize, cancelled, mid-flight failure and unsupported type each get a scenario, not a single "error" case. |
| Security | Cross-account object access refused, per flow, as its own scenario. |

## Out of Scope

- Building the video picker itself — [[SHY-0400]].
- The support page — [[SHY-0387]].

This story is the **journeys**; those two are the features.

## Dependencies

- The journey driver needs a step for choosing a file from the gallery. It
  already exists for age verification (`selects test image "…" from the gallery`)
  — reuse it rather than inventing a second one.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Scenarios are written for the happy path only and the corpus looks complete | Error, edge and security cases are each required by AC and counted separately. |
| A flow is walked on Android and assumed on iOS | Both devices required per flow; the matrix names the platform that failed. |
| A journey stops at the UI and never checks the far end | Every happy-path AC states the far-end confirmation explicitly. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Every flow above walked on a real Android device **and** a real iPhone,
      with the far-end confirmation recorded.

## Notes

- Found 2026-08-21 during a whole-project journey audit the operator asked for
  after [[SHY-0400]]. The audit's method is worth repeating: list every surface,
  then grep the corpus for the *steps* that would have to exist, not for the
  surface's name. Name-matching said reporting was covered; step-matching showed
  the attach seam was never crossed.
