---
id: SHY-0444
status: In Review
owner: claude
created: 2026-08-23
priority: P2
effort: M
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0444: An image that fails to load shows a broken picture

## User Story

As **somebody on a patchy connection**, I want a picture that will not load to
leave something sensible in its place, so that the app looks like it is waiting
rather than like it is broken.

## Why

Raised by the operator on 2026-08-22 as issue 6 of six, from the Android device
runs: **Gift Wall artwork renders as broken-image fallbacks.**

Triaged, and it is a product defect rather than test data.

`GiftWallScreen` already knows how to degrade well. When a gift's `iconUrl` is
**blank** it draws a tinted circle with the gift's initials — considered,
on-brand, and exactly right. But when the URL is PRESENT and the load FAILS, it
falls through to Coil's own failure state instead, because the `AsyncImage`
call passes no `error` slot.

So the app has a good answer for "there is no picture" and no answer at all for
"the picture did not arrive" — two situations that look identical to the person
holding the phone and should look identical on screen.

### It is the whole app, not one screen

`AsyncImage` is used at **66 places** in `commonMain`. **None** of them passes
`error`, `fallback`, or `placeholder`. Every remote image in ShyTalk — avatars,
gift art, room covers, message attachments, banners — renders a failure state
nobody designed, on any of:

- a dead or rotated URL,
- an R2/CDN outage,
- a local stack without object storage running,
- **any** patchy connection, which is the normal condition on mobile.

That last one is the point. This is not an edge case on a developer's desk; it
is what a real person on a train sees.

### What it is NOT

- Not seed data. Checked: the `banners` collection in the exact Firestore
  partition the app reads holds zero documents, so the separate "600 × 200"
  placeholder the operator saw on Rooms was transient local data and is gone.
  The Gift Wall behaviour is in the code and reproduces from it.
- Not Coil misbehaving. Coil does what it is asked; nothing asks it for a
  failure state.

## Acceptance Criteria

### Happy path

- [x] An image that loads renders exactly as it does today.

### Error paths

- [x] An image that FAILS to load renders the same considered placeholder as an
      image that was never there.
- [x] A gift whose icon fails to load shows its initials circle, identical to a
      gift with no icon at all.
- [x] No screen shows a broken-picture glyph, an empty gap where art belongs,
      or a stretched default.

### Edge cases

- [ ] Holds while offline from launch.
- [ ] Holds when the connection drops mid-load.
- [ ] Holds for a URL that returns 404, and one that returns HTML instead of an
      image.
- [ ] Holds when object storage is down but the API is up — the local stack's
      normal half-configured state, and a real production partial outage.
- [x] A slow load shows the placeholder rather than a blank box, and swaps to
      the image when it arrives.

### Performance

- [x] No extra network work. The placeholder is drawn, not fetched.

### Security

- [x] No change.

### UX

- [x] Placeholders are on-brand and consistent, not a per-screen invention. A
      person should not be able to tell which engineer wrote which screen.
- [x] The placeholder carries the same `contentDescription` as the image it
      stands in for, so a screen reader is not left with nothing.

### i18n

- [x] Any placeholder that carries text uses translated copy in all five MVP
      locales.

### Observability

- [ ] Image load failures are counted, so we learn whether real people hit this
      and on which surfaces. We currently cannot tell. **NOT met — moved to
      SHY-0498.** The mobile clients have no path to the server at all:
      `logW`/`logE` reach logcat and NSLog, and `POST /api/logs` is used only
      by the web client. Meeting this means building that pipeline, with a cap
      so an outage cannot spend the day's log quota on image failures.

## BDD Scenarios

**Scenario: A picture that will not arrive**

- **Given** somebody looking at their gift wall on a bad connection
- **When** a gift's artwork cannot be fetched
- **Then** they see the gift's own placeholder, not a broken picture

**Scenario: A picture that arrives**

- **Given** somebody with a working connection
- **When** the artwork loads
- **Then** they see it exactly as before

## Test Plan

| Layer | What it proves |
| --- | --- |
| Guard | No `AsyncImage` in `commonMain` is constructed without a failure state. This is the ratchet — it is what stops the 67th call site reintroducing it. |
| Unit | The shared image composable renders the placeholder on error and the image on success. |
| Mutation | Removing the error slot from the shared composable reddens the guard and the unit tests. |
| Device | With object storage stopped, the gift wall renders initials circles and no broken glyphs, on both phones. |
| Device | With storage up, the artwork renders unchanged. |

## Out of Scope

- Redesigning what the placeholders look like. The Gift Wall's initials circle
  is the pattern to generalise, not to replace.
- `BannerRepositoryImpl` reading Firestore directly instead of calling
  `GET /api/banners/active`. Found while triaging this, and real — but it
  belongs to the existing direct-backend-access audit, which already owns that
  class of finding across nine repositories.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| 66 call sites is a wide change to land at once | A shared composable first, with the guard failing on any call site not yet migrated, so the migration cannot be left half-done and forgotten. |
| A placeholder hides a genuinely broken URL from us | The Observability AC: count the failures. Looking fine to the user and being fine are different, and we need to be able to tell. |
| Each screen invents its own placeholder | One composable, one look; the guard bans the raw call. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The guard fails on a raw `AsyncImage` anywhere in `commonMain`.
- [ ] Device-proven with object storage stopped, on both real phones.

## Notes

- Raised by the operator on 2026-08-22 as "Gift Wall artwork renders as
  broken-image fallbacks (Android)", together with a "600 × 200" placeholder
  banner on Rooms. The banner was transient local data; this is not.
- Deliberately its own story rather than folded into the six-issue sweep: 66
  call sites is a real piece of work, and landing it unreviewed beside five
  unrelated fixes, immediately before a device run, would make both harder to
  judge.
## Notes (running log)

- **2026-09-01** — Fixed as a class, not a screen.

  The 41 call sites turned out to be remarkably uniform — `model`,
  `contentDescription`, `modifier`, `contentScale`, and one `alpha`. Nothing
  passed `error`, `placeholder` or `fallback`. That made a drop-in wrapper
  possible, so the migration is a rename rather than 41 bespoke edits: **25
  files, every call site**.

  `RemoteImage` defaults to a quiet surface tint filling the image bounds —
  deliberately reading as "nothing here yet" rather than as an error, and the
  same painter for loading and failure, because a distinct loading treatment
  that flashes on every fast load is worse than none. A caller with something
  better passes `error`.

  A guard keeps call site 42 from going back to the raw one, and it anchors its
  own exemption: if `RemoteImage.kt` is renamed or stops calling `AsyncImage`,
  the guard fails rather than silently protecting nothing.

  **Still owed:** passing the gift wall's initials circle as `error`, so its
  failed-load and blank-URL states match exactly — the specific thing the
  operator saw. The generic quiet state is already a large improvement on a
  broken-image glyph, but it is not yet the designed one for that screen.
- 2026-09-01 — **The other half.** The first PR (#2122) shipped `RemoteImage` and stopped every screen falling through to Coil's broken-image state. It did **not** do what three documents said it did: `RemoteImage`'s KDoc, `UserAvatar`'s KDoc and `RemoteImageGuardTest`'s own failure message all stated the gift wall passed its initials circle as `error`. None was true. Three documents asserting a behaviour is not a test of it.
- 2026-09-01 — **Twelve screens** answered "there is no picture" with something considered and left "the picture did not arrive" to the generic tint. `RemoteImageWithFallback` composes the screen's own fallback UNDERNEATH and makes the image transparent whenever it has nothing to show, so empty URL, dead URL, outage and slow connection reveal the same thing and cannot drift — there is only one of them. Swept: UserAvatar, GiftWallScreen, GiftPreviewPopup, ProfileScreen (x2), BackpackSheet (x2), MessageBubble (x2), LuckySpinOverlay (x2), LuckySpinSummaryPopup, RoomListItem, SeatItem.
- 2026-09-01 — **The guard found more than the sweep did.** By hand: seven. By shape: twelve. And a mutation — reverting `UserAvatar` — showed the first guard was green while covering only one of the three shapes in use; it now covers if/else, else-first and the guard-clause form, each pinned literally. Two look-alikes are excluded and also pinned: a branch deciding whether a cover is *tappable*, and `PrivateMessageBubble`'s sticker branch, which has no alternative at all.
- 2026-09-01 — **Observability is NOT met and is not ticked.** Filed as SHY-0498. The mobile clients have no route to the server: `logW`/`logE` write to logcat and NSLog, and `POST /api/logs` is used only by `public/js/logger.js`. It also carries a real trap — an outage would spend the client's daily log quota on image failures — so it needs designing, not appending.
- 2026-09-01 — **Device verification deferred**, and the four runtime edge criteria stay unticked accordingly: offline from launch, connection dropping mid-load, a 404 or an HTML response, and object storage down. The iPhone leg is blocked on a Settings toggle no CLI can set.
- 2026-09-01 — Gate: `:app:testDevDebugUnitTest` 2271/0, `:shared:jvmTest` 1744/0, `:app:compileDevDebugAndroidTestKotlin` green, `:shared:compileKotlinIosArm64` green, `detekt` + `ktlintCheck` clean.

Reviewed-up-to: f9ae093de88
