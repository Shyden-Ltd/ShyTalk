---
id: SHY-0433
status: Draft
owner: claude
created: 2026-08-22
priority: P2
effort: M
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0433: See what you attached before you send it

## User Story

As **somebody attaching a screenshot or a video to a support request**, I want to
see what I picked and be able to open it, so that I can be sure I am sending the
right thing before I send it.

## Why

Today an attachment is a **filename**:

```
b93089b9-76dc-4369-b53f-387a7f177824-1_all_81669.jpg      ✕
1000051891.mp4                                            ✕
```

Nobody can tell from that what they attached. Camera-roll names are opaque
strings from the device, not anything a person chose or recognises.

That matters more here than on most screens, because of what people attach to
support requests:

- **A screenshot of the thing that went wrong.** Picking the adjacent shot by
  mistake is easy, and the request then shows an admin the wrong screen — the
  ticket looks answered when it is not.
- **Evidence in a safety or harassment report.** Attaching the wrong image is a
  privacy incident, not a typo: it sends something private to a stranger, and it
  cannot be recalled once sent.
- **A video whose usefulness depends on WHICH clip it is.** Two recordings made
  seconds apart are indistinguishable by filename.

The person is being asked to commit to something they cannot see. The
information to prevent the mistake is one thumbnail away.

### What is already true

The limits are stated (`Up to 10 files. Images up to 5 MB, videos up to 30
seconds.`), refusals are friendly and specific, and removing an attachment
works. The gap is purely that the attachment is never SHOWN.

## Acceptance Criteria

### Happy path

- [ ] Each attached file shows a thumbnail of its own content.
- [ ] A video thumbnail is distinguishable from an image at a glance, and states
      its duration.
- [ ] Tapping a thumbnail opens the file full-screen: an image to view, a video
      to play with sound.
- [ ] Closing the preview returns to the form with everything typed and every
      attachment still there.
- [ ] Removing an attachment still works, and cannot be triggered by the tap that
      opens the preview.

### Error paths

- [ ] A file whose thumbnail cannot be generated still appears, still names
      itself, and can still be removed — it never blocks sending.
- [ ] A file that becomes unreadable between picking and sending says so, rather
      than failing silently at send.

### Edge cases

- [ ] Ten attachments — the maximum — remain usable, and the form still scrolls
      to Send.
- [ ] Holds with the keyboard open, where the form is already tight (SHY-0419).
- [ ] A very tall or very wide image is thumbnailed without distortion.
- [ ] A video with no audio track plays without implying the sound is broken.
- [ ] Opening a preview and returning does not re-upload or duplicate anything.

### Performance

- [ ] Thumbnails are generated from a downscaled copy, never by decoding a 5 MB
      image at full size per row.
- [ ] Ten thumbnails do not make the form janky on the slowest supported device.
- [ ] Nothing about the preview uploads bytes; it reads what is already local.

### Security

- [ ] The preview reads only the files the person picked in this session.
- [ ] No thumbnail or preview is written anywhere it could outlive the request.

### UX

- [ ] Attachments read as "the things I chose", not as a list of file paths.
- [ ] A thumbnail is obviously tappable, and obviously separate from its remove
      control.
- [ ] The preview is dismissible the way people expect on each platform.

### i18n

- [ ] Duration and size labels follow the person's locale.
- [ ] The layout holds under right-to-left, where the thumbnail and the remove
      control swap sides.
- [ ] Every new string is translated for all five MVP locales.

### Observability

- [ ] A thumbnail that fails to generate is logged with the reason, so a format
      we cannot preview is discoverable rather than invisible.

## BDD Scenarios

**Scenario: Checking what I picked**

- **Given** somebody who has attached a screenshot to a support request
- **When** they look at the form
- **Then** they see a small picture of that screenshot, not a file name

**Scenario: Making sure before sending**

- **Given** somebody who has attached a video
- **When** they tap it
- **Then** it plays, with sound, and they can close it and carry on

**Scenario: Catching the wrong file**

- **Given** somebody who attached the wrong screenshot by mistake
- **When** they see it on the form
- **Then** they can tell it is wrong and remove it before anyone else sees it

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Each attachment carries a thumbnail source and a preview target; removal is bound to the remove control, not to the thumbnail. |
| Device | On both phones: attach an image and a video, see both thumbnails, open each, play the video with sound, return with the form intact. |
| Boundary | Ten attachments remain usable and Send is still reachable with the keyboard up. |
| Failure | A file whose thumbnail cannot be built still lists and still sends. |
| Journey | The scripted walk asserts a thumbnail exists per attachment, not merely a row. |

## Out of Scope

- Editing, cropping or annotating an attachment.
- Previewing attachments on the ADMIN side — that already works and is covered
  by the admin browser tests.
- Changing the limits, the picker, or what file types are allowed.

## Dependencies

- Builds on SHY-0387 (attachments) and its limits.
- SHY-0427 must stay fixed — on iOS nothing reaches the app at all if the picker
  delegate is collected.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Decoding full-size images per row makes the form janky | Thumbnail from a downscaled decode, sized to the row. |
| The tap target for "preview" and "remove" overlap, so people delete what they meant to inspect | They are separate controls with separate hit areas, asserted by test. |
| A preview sheet over a form with the keyboard up recreates the geometry that made Send unreachable (SHY-0419) | The preview replaces or fully covers the form rather than floating over it, as the duplicate-choice screen already does. |
| Video preview differs per platform and one silently does nothing | Proven on BOTH real devices, not on one plus an assumption. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Proven on the real OnePlus and the real iPhone: thumbnails visible, image
      opens, video plays with sound, form intact on return.
- [ ] Screenshots in the evidence page show thumbnails rather than filenames.

## Notes

- Operator, 2026-08-22: *"the attached files should show their thumbnails so it's
  easy to see what was uploaded, tapping the thumbnail should also open the file
  so the user can view the screenshot or play the video to confirm before
  deciding to submit"*.
- Found while reviewing the SHY-0387 evidence: `at06-valid-attached.png` shows
  the current state — two rows of raw camera-roll filenames.
- The admin side already does exactly this (thumbnail grid, click to open a
  lightbox that plays video unmuted). The person raising the request deserves at
  least what the person reading it gets.
