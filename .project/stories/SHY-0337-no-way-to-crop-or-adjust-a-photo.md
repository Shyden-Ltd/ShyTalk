---
id: SHY-0337
status: Draft
owner: claude
created: 2026-08-18
priority: P1
effort: L
type: feature
roadmap_ids: []
mvp: true
---

# SHY-0337: A chosen photo cannot be cropped or adjusted, and nobody knows what shape it should be

## User Story

As **someone setting a profile or cover photo**, I want to zoom, move and crop
the picture before it is saved, so that my photo looks the way I intended
instead of however the app happened to cut it.

## Why

**P1, MVP-blocking.** Operator-reported 2026-08-18: selecting a profile or cover
photo offers no way to crop or edit it, and nothing indicates what size or shape
is expected.

Two harms, and the second is the worse one:

1. **The result is arbitrary.** A photo whose subject is off-centre — which is
   most photos — gets cut wherever the app decides. A cover photo is a wide
   strip; almost no photo in a camera roll is that shape, so the app is choosing
   which part of the picture to discard on the user's behalf.
2. **The user cannot tell what is expected before choosing.** They pick, see a
   bad result, and have no lever to fix it. The only recourse is to open a photo
   editor outside the app, guess the aspect ratio, and come back — which most
   people will not do. They will keep a bad photo, or none.

A profile photo is the single most personal thing a user puts into a social
product. Getting it visibly wrong at first use sets the tone for everything else.

## Acceptance Criteria

### Happy path

- [ ] After choosing an image, the user gets an adjust step before it is saved: pinch/scroll to zoom, drag to reposition, and a crop bounded to the target shape.
- [ ] The crop frame SHOWS the target shape — circular for profile, the true wide strip for cover — so the expected result is obvious before confirming.
- [ ] What the user sees in the frame is exactly what is saved and exactly what others see.

### Error paths

- [ ] An image too small for the target is refused with a clear reason, not silently upscaled into a blurry result.
- [ ] A corrupt or unreadable file is reported plainly; the previous photo is retained.
- [ ] If the upload fails, the user returns to the adjust step with their crop intact, not back to the start.

### Edge cases

- [ ] Extreme aspect ratios (panorama, very tall) can still be positioned sensibly.
- [ ] Rotated images (EXIF orientation) appear the right way up in the editor and in the saved result.
- [ ] Zoom is bounded so the user cannot zoom past the image's real resolution into a blur.
- [ ] Cancelling leaves the existing photo untouched.

### Performance

- [ ] The editor is responsive on the oldest supported device — dragging and zooming keep up with the finger.
- [ ] A large photo does not have to fully decode before the editor is usable.

### Security

- [ ] The crop is applied before upload, so discarded parts of the image are never transmitted or stored.
- [ ] EXIF metadata (notably GPS location) is stripped from the saved image — a profile photo must not carry the user's home coordinates.

### UX

- [ ] Verified with real photos on real devices, at the smallest supported resolution, in both orientations.
- [ ] The control layout does not depend on fixed sizing (low-resolution support).

### i18n

- [ ] Every new string ships in all 20 locale files, including the size-requirement and refusal messages.

### Observability

- [ ] A failed upload is logged distinguishably from a failed crop, so the two are not confused later.

## BDD Scenarios

**Scenario: A photo can be adjusted before it is saved**

- **Given** someone choosing a new profile photo
- **When** they pick a picture from their device
- **Then** they can zoom and move it inside a frame showing the final shape, and save what they see

**Scenario: A picture that is too small is refused clearly**

- **Given** someone choosing a photo much smaller than required
- **When** they pick it
- **Then** they are told it is too small and what is needed, and their existing photo is kept

**Scenario: Location data does not travel with the photo**

- **Given** a photo taken with location recorded
- **When** it is saved as a profile photo
- **Then** the saved photo carries no location information

## Test Plan

### Kotlin unit — `shared/src/commonTest/.../profile/`

- `the crop rectangle maps to the saved image exactly — WYSIWYG`
- `zoom is bounded by the source image's real resolution`
- `EXIF orientation is honoured in both the editor and the output`
- `EXIF GPS is stripped from the saved image`
- `an image below the minimum is refused, with the reason naming the requirement`
- `cancelling leaves the previous photo unchanged`

### Express/Jest — `express-api/tests/routes/`

- the API rejects an image that does not meet the declared minimum, so the rule is not client-only

### Playwright — `public/` profile pages

- the web surface offers the same adjust step and the same shape guidance

### Journey tests (REQUIRED — real devices)

- `journey-tests/` scenario: a persona sets a profile photo from a real image,
  adjusts it, saves it, and **another persona sees the adjusted result** — the
  assertion is on the viewer, not the uploader.
- Repeated for the cover photo with its own shape.
- Walked on real Android + real iPhone, local THEN dev.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the crop is applied to the preview but not the upload | `the crop rectangle maps to the saved image exactly` and the viewer-side journey assertion |
| EXIF stripping removed | `EXIF GPS is stripped` |
| the minimum-size rule enforced client-side only | the Express rejection test |

## Out of Scope

- Filters, colour adjustment, stickers, or any editing beyond zoom/move/crop.
- Changing where images are stored or how they are served.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The preview and the saved image disagree | Asserted as WYSIWYG in unit tests AND from the viewer's side in the journey. |
| Fixed on one platform only | Journey walked on real Android AND real iPhone; Playwright covers web. |
| GPS leaks in profile photos | Explicit security AC, its own test, and a mutation that must kill it. |

## Definition of Done

- [ ] Every AC met; every named test written RED first and now green.
- [ ] Every mutation killed its named test, reverted with a git-verified clean tree.
- [ ] Journey walked on real Android + real iPhone, local THEN dev, asserting from the VIEWER's side.
- [ ] Strings present in all 20 locales.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: Detect Changes, Analyze JavaScript, PR Gate.
- [ ] Status In Review before merge; Done on release cut with `released_in:`.

## Notes (running log)

- **2026-08-18** — Reported by the operator as an MVP blocker, verbatim: "when
  selecting a photo for the profile photo or cover photo, there's no way to crop
  or edit it... allow zoom,unzoom,crop etc."
- **2026-08-18** — EXIF GPS stripping added to scope on review of the security
  dimension: it was not in the report, but shipping a crop feature without it
  would mean profile photos carrying home coordinates.
