---
id: SHY-0420
status: Draft
owner: unassigned
created: 2026-08-22
priority: P1
effort: L
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0420: Attachments — bounded, virus-scanned, and never downloadable by an admin

## User Story

As **somebody reporting a problem or a person**, I want to attach the evidence I
have, so that the thing I am describing can actually be seen — and as **Shyden
Ltd**, we must not be handling other people's files unsafely while we do it.

## Why

Operator, 2026-08-22. Attachments already exist on support tickets (SHY-0387) but
the rules around them were never set, and they apply to more than one surface.

Three separate problems:

1. **The limits are wrong or missing.** The client currently bounds an attachment
   at `MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024` — one flat 25 MB byte cap for
   both images and video. A video needs bounding by **duration**, not bytes; a
   screenshot needs a smaller cap than 25 MB.
2. **Nothing is scanned.** Files uploaded by strangers are opened by staff. That
   is a malware delivery path straight into the company, and there is no scanning
   anywhere in the pipeline today.
3. **Admins can download them.** The admin attachment route mints a signed GET
   URL, so a moderator can pull an arbitrary stranger's file onto their machine.
   It should be viewable and not retrievable.

### Where it applies

**Support tickets, reports, and appeals** — the same rules on all three. They are
the three places a person hands us a file, and there is no reason for them to
differ.

### Why it is MVP and P1

A minor cohort is present, and the files people attach to safety reports can
include images of real people and of abuse. Handling those without scanning, and
letting them be copied onto staff machines, is a safeguarding and data-protection
exposure — not a feature gap.

## Acceptance Criteria

### Happy path

- [ ] Up to **10** files per submission, on support tickets, reports and appeals
      alike.
- [ ] An image up to **10 MB** is accepted.
- [ ] A video up to **30 seconds** is accepted, bounded by DURATION, not only by
      byte size.
- [ ] The person is told the limits BEFORE they choose a file, not after.

### Error paths

- [ ] An 11th file is refused with a message saying how many are allowed.
- [ ] An oversized image is refused, saying the limit in plain language.
- [ ] A video over 30 seconds is refused, saying the limit — and the refusal is
      by duration, so a short high-bitrate clip is not refused for its size
      alone, nor a long low-bitrate one accepted.
- [ ] A file that fails the virus scan is refused, the submission still goes
      through without it, and the person is told the file could not be accepted.
      Their words must never be lost because of a bad attachment.
- [ ] A scan that cannot complete FAILS CLOSED — the file is withheld, never
      served on the assumption it is probably fine.

### Edge cases

- [ ] A file whose declared content type does not match its actual bytes is
      refused. Extension and MIME are caller-supplied and must not be trusted.
- [ ] A zero-byte file is refused.
- [ ] Ten files at the maximum size do not time out the submission.
- [ ] An upload abandoned halfway leaves nothing readable behind.
- [ ] A file uploaded before scanning completes is not viewable until it passes.

### Performance

- [ ] Scanning does not block the person's submission: the ticket is raised, and
      the attachment becomes viewable when it clears.
- [ ] Ten maximum-size uploads on a mobile connection remain workable — bounded,
      resumable or clearly progress-reported.

### Security

- [ ] **Every** file is virus-scanned before it can be viewed by anybody.
- [ ] **An admin cannot download an attachment.** No signed GET URL that a
      browser will save, no direct object URL, no "open in new tab" that yields
      the raw file. Viewing happens in a **protected, read-only sandbox view**.
- [ ] The sandbox view cannot be trivially defeated — right-click save, devtools
      network tab, and direct URL access are all considered, and what is and is
      not achievable is stated honestly in the story rather than overclaimed.
- [ ] Attachment keys stay namespaced per account, so one person cannot reference
      another's upload. (Already true for support tickets — must hold for reports
      and appeals too.)
- [ ] Proven by mutation: removing the scan gate, or reinstating a downloadable
      URL, must redden a test.

### UX

- [ ] The limits are stated before choosing, in the reader's language.
- [ ] A refused file names WHICH file and WHY, when several were chosen at once.
- [ ] A file still being scanned shows as pending rather than as broken.

### i18n

- [ ] Every limit and refusal message is localised and asserted on rendered text
      per locale — including the numbers, which differ in format by locale.

### Observability

- [ ] Scan outcomes are logged (clean / infected / failed) with the ticket id,
      never the file contents.
- [ ] A rising rate of infected uploads is visible, because that is an attack in
      progress.

## BDD Scenarios

**Scenario: somebody attaches evidence to a report**

- **Given** somebody is reporting another person
- **When** they attach a screenshot and a short clip
- **Then** both are accepted and reach the moderator

**Scenario: a dangerous file never reaches a moderator**

- **Given** somebody attaches an infected file
- **When** a moderator opens the report
- **Then** the file is not there and the report still is

**Scenario: a moderator cannot take the file away**

- **Given** a moderator is viewing an attachment
- **When** they try to save it
- **Then** they cannot, and they can still see it

## Test Plan

| Layer | What it proves |
| --- | --- |
| API contract | 10-file cap, 10 MB image cap, 30-second video cap, on all three surfaces. |
| Real-services integration | An EICAR test file is refused and never becomes viewable; the submission still succeeds without it. |
| Fail-closed | With the scanner unavailable, files are withheld rather than served. |
| Security | No response on any admin path yields a URL that downloads the raw object. Proven by mutation, not inspection. |
| Journey | Attach on a real device on each of the three surfaces, and view as an admin in the sandbox. |
| i18n | Limits and refusals render localised, asserted on text. |

## Out of Scope

- Changing what file TYPES are allowed beyond the existing image/video set.
- Retention and deletion policy for attachments — related, but its own decision.

## Dependencies

- A virus-scanning capability. None exists in the stack today; choosing it is
  part of this story and the choice should be recorded with its trade-offs
  (self-hosted ClamAV vs a hosted scanning API — cost, latency, and whether
  files leave our infrastructure).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| "Not downloadable" is claimed but trivially defeated | The Security AC requires an honest statement of what the sandbox does and does not prevent; a determined viewer with devtools is a different threat from an accidental save, and the story must say which is being stopped. |
| Scanning adds latency to the person's submission | The ticket is raised immediately; the attachment clears asynchronously and shows as pending. |
| A scanner outage silently lets files through | Explicit fail-closed AC plus a test with the scanner unavailable. |
| The rules drift apart across the three surfaces | Shared validation, and the contract test runs against all three. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Walked on a real device for all three surfaces.
- [ ] EICAR refused, end to end, in a real environment.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded.

## Notes

- Existing state at filing: `MAX_ATTACHMENTS = 10` already holds for support
  tickets; `MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024` is a single flat byte cap in
  `SupportFormViewModel` covering both images and video; `GET
  /support-tickets/:id/attachments` mints signed GET URLs with a 300-second TTL,
  which is exactly the downloadable path this story removes. Reports and appeals
  have not been checked for attachment support at all yet — that survey is the
  first job.
