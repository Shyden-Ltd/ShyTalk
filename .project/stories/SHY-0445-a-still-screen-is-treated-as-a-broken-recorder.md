---
id: SHY-0445
status: In Review
owner: claude
created: 2026-08-23
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0445: A phone sitting still is treated as a broken recorder

## User Story

As **whoever asked for recordings of the device walks**, I want the recorder to
start on a phone that is simply sitting there, so that a run is not abandoned
before it begins.

## Why

The Android walk aborted on 2026-08-23 with:

> FATAL: Screen recording failed to start: no growing video … within 20000ms

against a recorder that was working perfectly.

Android's screen encoder emits frames only when the display **changes**.
Measured on the real OnePlus: on a settled screen the mp4 sat at exactly **48
bytes for ten seconds**, and a Matroska recording was never even created. So
the start gate — *did the file GROW within twenty seconds* — is false for a
phone that is doing nothing, which is the state every walk **begins** in.

It passed the night before only because that run happened to start mid-walk.

### This is a class, and half of it was already fixed

The identical defect was found and fixed on the **iOS** path earlier in the
same session, where x264's frame lookahead hoarded output and `-tune
zerolatency` released it. The comment above `waitForFfmpegFrames` diagnoses the
mechanism in full — and then says, in writing:

> scrcpy has no equivalent channel, so it keeps `waitForGrowth`.

The cause was understood, one instance was fixed, and the other was left with
the broken proxy and a note explaining why it was fine. It was not fine.

## Acceptance Criteria

### Happy path

- [ ] A walk starts on a settled screen.
- [ ] The recording still covers the walk from its first step.

### Error paths

- [ ] A recorder that genuinely fails to start still fails the run, naming why.
- [ ] A recording that will not play fails the run rather than being linked
      from the report.

### Edge cases

- [ ] A recorder killed rather than asked to stop is caught.
- [ ] A recording that captured nothing at all is caught.
- [ ] Holds on both platforms.

### Performance

- [ ] No added wait on a healthy start.

### Security

- [ ] No change.

### UX

- [ ] No product change; test infrastructure.

### i18n

- [ ] No change.

### Observability

- [ ] A failed recording says which of the two things went wrong: the session
      never came up, or the file it produced is unusable.

## BDD Scenarios

**Scenario: Starting a walk on a phone at rest**

- **Given** a phone showing a screen that is not moving
- **When** a walk begins
- **Then** it records, and the video covers the walk

## Test Plan

| Layer | What it proves |
| --- | --- |
| Regression | A file that never grows still satisfies the start gate. Restore the old gate and it hangs to its timeout — which is what the phone did. |
| Unit | A real one-second encode passes; a 48-byte header, a truncated file, and an audio-only file are all refused. |
| Device | Both phones record a full walk from a settled start. |

## Out of Scope

- Making Android emit frames on a static screen. It is the platform's
  behaviour and there is nothing to fix there.

## Dependencies

- None.

## How it was built

Growth was always a proxy. The start gate now proves the **container was
opened** — scrcpy opens its muxer only after negotiating the video stream with
the device, so a header on disk means the capture session is up, which is what
the wait exists for. Its stdout is no help: scrcpy block-buffers INFO lines
through a pipe and flushes the whole block at exit, nine seconds after
recording began when measured on 4.1.

The frames claim moved to **stop**, where the artefact itself can answer it.
`assertPlayable` runs ffprobe and requires a video stream and a positive
duration. That is strictly stronger than the `size !== 0` it replaces, and
catches two files that check called a pass:

- the 48-byte header a recorder that captured nothing leaves behind;
- a truncated mp4 whose `moov` atom was never written — what a SIGKILLed
  recorder leaves: twenty good megabytes and unplayable.

Tested against **real encodes**. ffmpeg makes a genuine one-second mp4 and the
corruption cases damage that real file; a hand-written byte blob would only
prove ffprobe rejects hand-written byte blobs.

### Device evidence

Both phones recorded the full thirteen-journey set from a settled start, and
both files were then verified by `assertPlayable` itself: Android 1019.2s /
70.8MB, iOS 713.5s / 20.8MB.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The start gate is now weaker | It is weaker where it was WRONG and the strong claim moved to where it can be checked properly. The pair is stronger than the single check was. |
| ffprobe missing on a machine | `resolveBinary` fails with the install command, the same way the recorder already handles a missing ffmpeg. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [x] Regression-tested: the settled-screen case, which reddens if the old gate returns.
- [x] Both phones record a full walk from a settled start.

## Notes

- Found on 2026-08-23 when the Android walk refused to start while the phone
  sat at Rooms.
