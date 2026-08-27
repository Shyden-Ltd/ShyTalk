---
id: SHY-0427
status: In Review
owner: claude
created: 2026-08-22
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0427: On iOS, choosing a photo or video does nothing

## User Story

As **somebody on an iPhone picking a photo or a video**, I want the app to
receive what I chose, so that setting an avatar or attaching evidence actually
works.

## Why

`PHPickerViewController.delegate` is a **weak** property — the picker does not
keep its delegate alive. Both iOS pickers tried to solve that from inside the
delegate:

```kotlin
// Strong reference to self to prevent GC before callback
private var selfRef: PickerDelegate? = this
```

That is a self-referential **cycle** with no external root. Kotlin/Native's GC
is a tracing collector, so an unreachable cycle is precisely what it reclaims.
The comment describes an intention the code cannot deliver.

Collected between presenting the picker and the person choosing, `delegate`
reads nil and `picker(_:didFinishPicking:)` never fires.

### What that looks like to a person

Observed on a real iPhone on 2026-08-22:

- the picker opens and is fully responsive — tabs switch, cells select, the
  "Show Selected (1)" counter tracks
- tapping **Done** does nothing: the sheet stays open, nothing is added, no
  upload is attempted
- tapping **Cancel** does nothing either
- swiping the sheet away works, so the app itself is not wedged
- **every retry stacks another picker**, so the person ends up having to
  force-quit

It depends on GC timing, which is why it has presented as flakiness rather than
as a feature that does not work.

### Scope — this one shipped

| File | Surface | State |
| --- | --- | --- |
| `IosImagePicker.kt` | avatar / profile photo | **on `develop` — shipped** |
| `IosMediaPicker.kt` | support attachments (SHY-0387) | unmerged |

So on iOS today, setting a profile photo can silently do nothing.

## Acceptance Criteria

### Happy path

- [ ] Choosing photos or videos on iOS delivers them to the app, every time.
- [ ] Cancelling the picker dismisses it and reports nothing chosen.

### Error paths

- [ ] A load failure for one item still returns the others rather than hanging
      the picker.

### Edge cases

- [ ] Opening the picker repeatedly never stacks sheets.
- [ ] Two pickers cannot be presented at once; the second is refused or replaces
      the first deliberately.
- [ ] The delegate is released after the callback, so one pick does not retain a
      delegate for the life of the process.

### Performance

- [ ] No change.

### Security

- [ ] No change to what is read from the library.

### UX

- [ ] Nothing user-visible beyond it working.

### i18n

- [ ] No new strings.

### Observability

- [ ] A picker that returns nothing is distinguishable in logs from one the
      person cancelled, because those need different answers.

## BDD Scenarios

**Scenario: What I chose reaches the app**

- **Given** somebody choosing a photo on an iPhone
- **When** they confirm their choice
- **Then** the app receives it

**Scenario: Changing my mind**

- **Given** somebody who opened the picker
- **When** they cancel
- **Then** the picker closes and nothing is attached

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | No picker delegate keeps itself alive with a self-reference, and each is held on the enclosing `object`, which is a GC root. |
| Journey | On a real iPhone: pick a photo for an avatar, and pick a video for a support ticket — both arrive. |
| Repeat | Opening and cancelling the picker several times in a row never stacks sheets. |

## Out of Scope

- The attachment limits themselves — [[SHY-0387]].
- Android, which uses a different picker and is unaffected.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The object-held delegate is never released | Cleared on every terminating path, asserted by the guard. |
| A future picker copies the old pattern | The guard covers the pattern across every picker file, not just these two. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Proven on a real iPhone: a photo and a video both reach the app, and
      repeated opens do not stack.

## Notes

- Found on 2026-08-22 while testing SHY-0387's attachment limits on a real
  iPhone. The limits themselves could not be tested at all until this was fixed,
  because nothing picked ever reached the app.
- The avatar picker fails identically with `selectionLimit = 1`, where the
  confirming action is a grid-cell tap rather than a Done button — which rules
  out "the automation could not press Done".
