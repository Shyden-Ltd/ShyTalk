---
id: SHY-0400
status: Draft
owner: unassigned
created: 2026-08-21
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0400: Report evidence was built for video and can only ever be an image

## User Story

As **somebody reporting what another person did to me**, I want to attach the
video that shows it, so that a moderator can see the thing I am describing.

## Why

**Operator, 2026-08-21:** reporting was supposed to support video uploads.

It was built for video everywhere except the one place that decides:

| Layer | State |
| --- | --- |
| Admin panel | **complete video path** — `isVideoUrl()` matching `mp4\|mov\|webm\|avi\|mkv\|3gp`, a `<video>` element, a play badge, a lightbox branch on `type: video` (`public/admin/js/tabs/users.js:64-84`) |
| Size bound | `EVIDENCE_MAX_SIZE_BYTES = 20 MB` (`Constants.kt:60`) |
| Android picker | `ActivityResultContracts.PickVisualMedia.**ImageOnly**` |
| iOS picker | `PHPickerFilter.**imagesFilter**` |
| Content type sent | `RoomScreen.kt:227` — `reportEvidenceList.add(bytes to "image/jpeg")`, hardcoded regardless of what was picked |

**Nobody caps screenshots at 20 MB.** That bound, and the moderator's video
player, are both evidence of the intent. The pickers and one hardcoded string are
what stop it.

### Why it matters more than a missing convenience

Reporting is a moderation surface with a minor cohort present. A large share of
what people need to report **is** video — a clip somebody sent them, a screen
recording of what happened in a room. Today they can describe it in words and
attach a still, or give up. A misfiled or abandoned report is a safeguarding
failure, not a UI gap.

### Why no test caught it

Worth writing down, because the answer is structural rather than an oversight:

1. **`renderEvidence` and `isVideoUrl` have no tests at all.**
2. **`public/admin/js/` is outside the coverage measurement.** `jest.config.js`
   sets `collectCoverageFrom: ['src/**/*.js', '!src/__tests__/**']`, so the admin
   panel's 17 tab modules are not in the denominator. Coverage can read healthy
   while that surface is entirely unmeasured — a lying metric.
3. **A test would have passed anyway.** Handing `isVideoUrl()` a `.mp4` URL and
   asserting a `<video>` element proves the renderer works; it says nothing about
   whether anything upstream can produce such a URL. This is the same shape as
   [[SHY-0385]]'s wiring defect found the same day — a green test certifying a
   path production never takes.

Point 3 is the one to design the tests around.

## Acceptance Criteria

### Happy path

- [ ] Somebody reporting can pick a video as well as a screenshot.
- [ ] The content type sent matches what they actually picked, on both platforms.
- [ ] A moderator sees the video and can play it.

### Error paths

- [ ] A video over the size bound is refused **before** upload, with a reason —
      not failed mid-transfer.
- [ ] A file of a type the server will not accept is refused at the picker, not
      after upload.
- [ ] A failed evidence upload leaves the rest of the report sendable.

### Edge cases

- [ ] A mixed selection of images and videos all arrive with correct types.
- [ ] A video with no extension in its key is still recognised as video by the
      admin panel — `isVideoUrl` currently infers from the URL, which is a guess.
- [ ] Works on Android and iOS.

### Performance

- [ ] Video is not decoded into memory whole where the platform allows streaming.

### Security

- [ ] Type is validated **server-side**; the client-declared content type is not
      trusted.
- [ ] Evidence stays admin-only.

### UX

- [ ] The control says what can be attached, and that matches what the picker
      offers. Today the picker offers less than the system was built for.

### i18n

- [ ] Any new copy across all 21 locale files.

### Observability

- [ ] Evidence type is recorded, so "how much evidence is video" is answerable
      rather than assumed.

## BDD Scenarios

**Scenario: Reporting with a video**

- **Given** somebody reporting another person
- **When** they attach a video
- **Then** it is sent with the report

**Scenario: A moderator can watch it**

- **Given** a report with a video attached
- **When** a moderator opens it
- **Then** they can play the video

**Scenario: An oversized video is refused early**

- **Given** a video larger than the limit
- **When** somebody tries to attach it
- **Then** they are told before anything uploads

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Seam** | The decisive one: what the client SENDS is asserted against what the admin panel can RENDER. A video picked on device produces a stored item that `isVideoUrl()` classifies as video. Neither half alone would have caught this. |
| Client | The content type sent matches the file picked, per platform, rather than a hardcoded constant. |
| Admin | `renderEvidence` / `isVideoUrl` get their first tests, including a video key with no extension. |
| Coverage | `public/admin/js/` is brought into `collectCoverageFrom`, so this surface stops being invisible to the metric. |
| Journey | Report with a video, walked on a real Android device and a real iPhone, and viewed in the admin panel. |

## Out of Scope

- Support-ticket attachments — [[SHY-0387]] builds those, and should share
  whatever picker this story produces rather than growing a second one.

## Dependencies

- Pairs with [[SHY-0387]]: both need a picker that returns bytes **and** the
  real content type. Build it once, in `core/platform`, and use it from both.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The video path is fixed on one platform and assumed on the other | Every assertion iterates both platforms and names the failing one, as `AppCheckWiringPinTest` does. |
| A test is added that would have passed against the bug | The seam test asserts client output against admin input; a renderer-only test is explicitly not sufficient. |
| Bringing admin JS into coverage floods the gate with pre-existing gaps | Land the coverage change with a floor at the current real number and ratchet up, rather than blocking on a number nobody has measured yet. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A video report raised on a real Android device and a real iPhone, and
      played back in the admin panel.

## The failing test already exists

Written 2026-08-21 and confirmed RED — **3 of 4 fail** against the code as it
stands, and the 4th passes deliberately, to prove the scan is not vacuous:

| Assertion | Now |
| --- | --- |
| the admin panel really does have a video branch | **passes** — the pin can see |
| the Android picker can offer video | fails — `PickVisualMedia.ImageOnly` |
| the iOS picker can offer video | fails — `PHPickerFilter.imagesFilter` |
| the content type sent is the file picked | fails — hardcoded `"image/jpeg"` |

It compares the producer's possible outputs with the consumer's handled inputs,
which is the shape that catches this whole family without needing a device. It is
held out of the SHY-0387 branch precisely because it is red; land it as the first
commit of this story's branch, watch it fail, then fix.

## Notes

- Found 2026-08-21 when the operator asked why SHY-0387 needed new video work
  when "reports should already support video uploads too" — and then asked why no
  test caught it. Both questions were right.
