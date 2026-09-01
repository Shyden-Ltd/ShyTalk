---
id: SHY-0498
status: Draft
owner: unassigned
created: 2026-09-01
priority: P2
effort: M
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0498: Nobody can tell how often an image fails to load

## User Story

As **whoever decides where to spend effort on image delivery**, I want to know
how often pictures fail to arrive and on which screens, so that the decision
rests on numbers rather than on whether somebody happened to notice.

## Why

SHY-0444 gave every remote image a chosen failure state, and then made a failed
load look identical to an absent one. That is right for the person holding the
phone and it is the reason this story exists: the two are now indistinguishable
on screen, so watching the app can no longer tell us how often delivery is
actually failing.

SHY-0444 carried an Observability criterion — *"Image load failures are counted,
so we learn whether real people hit this and on which surfaces. We currently
cannot tell."* — and it was **not** met. It is recorded here rather than ticked
there, because meeting it is not a detail of that change:

- The shared `logW`/`logE` functions write to logcat and to NSLog. **Nothing
  from the mobile clients reaches the server.** `POST /api/logs` exists and is
  used only by `public/js/logger.js` — the web client.
- So this needs the mobile log pipeline built, not a line added.

There is a trap in the obvious implementation. `/api/logs` enforces a daily
quota per client. A person on a train with a patchy connection, or one hitting a
CDN outage, generates a burst of image failures — exactly the case worth
measuring. Reporting each one uncapped would spend that person's whole log quota
on it and silence the crash and error reporting that quota exists for. A design
that measures the outage by blinding us to everything else is worse than not
measuring it.

## Acceptance Criteria

### Happy path

- [ ] A failed image load is recorded with enough detail to say WHICH surface it
      happened on, not merely that one happened somewhere.
- [ ] The counts are visible to an admin without anybody running a query by hand.

### Error paths

- [ ] An image that loads successfully records nothing at all.
- [ ] If reporting itself fails, the person sees no difference — the image
      fallback is unaffected and nothing is retried in a loop.

### Edge cases

- [ ] A burst of failures — offline, or a CDN outage — cannot exhaust the
      client's daily log quota. The burst is still visible as a burst.
- [ ] The same image failing repeatedly on one screen does not report once per
      recomposition.
- [ ] Reporting holds when the device is offline: nothing is lost silently and
      nothing queues without bound.

### Performance

- [ ] No measurable cost on the success path, which is the overwhelming majority.

### Security

- [ ] No signed URL, token or query string reaches the log. A media URL can
      carry credentials, and logs are read by admins.
- [ ] Nothing recorded identifies who was looking at the image.

### UX

- [ ] No change. Nobody sees this.

### i18n

- [ ] Not applicable — nothing user-facing.

### Observability

- [ ] The surface taxonomy is written down, so "which surfaces" has a fixed set
      of answers rather than whatever string each call site invented.

## BDD Scenarios

**Scenario: A picture that never arrives is counted**

- **Given** pictures are failing to arrive on the gift wall
- **When** somebody opens it
- **Then** the failures are counted against the gift wall
- **And** they see the same initials circles as always

**Scenario: A bad connection does not blind us to everything else**

- **Given** somebody whose pictures are all failing to arrive
- **When** the failures keep coming
- **Then** the day's reporting still has room for other problems

## Test Plan

- Unit: the cap and the de-duplication, including the boundary where the cap is
  reached exactly, and the case where every image on a screen fails at once.
- Integration: a failure reaches `POST /api/logs` in the shape the route accepts,
  against the real Express API rather than a double.
- Device: with object storage stopped, a real run on both phones produces counts
  an admin can see, and the app is visibly unaffected.

## Out of Scope

- Changing what a failed image looks like. SHY-0444 settled that.
- Adding an analytics SDK. The existing `/api/logs` pipeline is the sink; a new
  external service is a separate decision for the operator.
- Server-side alerting on the counts.

## Dependencies

- SHY-0444 (shipped the fallback this measures).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The quota trap above | The cap is an acceptance criterion, not an afterthought, and has its own boundary tests. |
| A per-call-site surface string drifts | The taxonomy is a fixed set, checked the way the other source guards are. |
| Signed URLs leak into admin-readable logs | Explicit security criterion; strip query strings before recording. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] An admin can answer "how often did images fail yesterday, and where" without
      being handed a query.

## Notes

- Filed 2026-09-01 while completing SHY-0444's fallback sweep, rather than
  ticking an Observability criterion that was not met. SHY-0444 stays In Review
  with that box unticked and pointing here.
