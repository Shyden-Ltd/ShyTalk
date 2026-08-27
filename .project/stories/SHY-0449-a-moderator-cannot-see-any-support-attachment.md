---
id: SHY-0449
status: In Review
owner: claude
created: 2026-08-24
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0449: A moderator cannot see any support attachment

## User Story

As **an admin acting on a support ticket**, I want the screenshots and videos
somebody attached to actually appear, so that I am not deciding about evidence I
cannot see.

## Why

SHY-0420 moved support attachments off signed URLs and onto an authenticated
route that streams the file inline. That was right: a signed URL is a download
link, and these files are often photographs of real people.

But the renderer was left putting the path straight into markup:

```js
<img src="/api/support-tickets/{id}/attachments/0">
```

**An `<img>` cannot send a bearer token.** The route answers 401, the browser
draws a broken image, and nothing reports an error — a failed image fires no
event the page listens for. Every support attachment has been invisible to
moderators since SHY-0420 landed.

Verified 2026-08-24:

```
$ curl -s -o /dev/null -w '%{http_code}' \
    http://localhost:3000/api/support-tickets/x/attachments/0
401
```

`renderEvidence` was reused from the Reports and Appeals tabs, which was the
right instinct — but those pass **public CDN URLs**. The function was correct
for its callers and the contract changed underneath one of them.

### Why P1

It is the evidence half of a safety report. A moderator reading "they sent me
this" with a broken image beside it either acts without seeing it or does not
act at all, and neither is acceptable. It also silently defeats SHY-0438, which
carries those same attachments into a moderation report.

## Acceptance Criteria

### Happy path

- [ ] An attached image is displayed on the Support tab.
- [ ] An attached video is displayed with a play badge and plays with sound.
- [ ] Reports and Appeals, which pass CDN URLs, are unchanged.

### Error paths

- [ ] One unreadable attachment does not stop the others rendering.
- [ ] When none can be read, the tab says so rather than showing nothing.

### Edge cases

- [ ] A video is recognised as a video even though an object URL has no file
      extension.
- [ ] Leaving the tab and returning re-fetches rather than showing stale bytes.

### Performance

- [ ] Object URLs are revoked on reload and on leaving the tab, so a long
      session does not hold every attachment it has scrolled past.

### Security

- [ ] No signed URL is reintroduced. Every read still passes through a route
      that knows who is asking.
- [ ] Nothing is written to disk; `Content-Disposition: inline` still stands.

### UX

- [ ] No change beyond the attachments becoming visible.

### i18n

- [ ] No change.

### Observability

- [ ] A failed attachment fetch is visible to the admin rather than silent.

## BDD Scenarios

**Scenario: Seeing what was sent**

- **Given** a support ticket with a screenshot attached
- **When** an admin opens the Support tab
- **Then** the screenshot is shown

**Scenario: One file is gone**

- **Given** a ticket with two attachments, one no longer in storage
- **When** an admin opens it
- **Then** the other is still shown

## Test Plan

| Layer | What it proves |
| --- | --- |
| Browser | A real image and a real video, uploaded through the real signed-PUT path, both render and the video plays unmuted. |
| Contract | The attachment route still refuses an unauthenticated request. |
| Regression | Reports and Appeals still render their CDN evidence. |

## Out of Scope

- Changing what the attachment route returns.
- The person's own view of their attachments — SHY-0433.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Object URLs leak memory across a long session | Revoked on every reload and on leaving the tab; asserted by the code path, not by hope. |
| Widening `renderEvidence` breaks its other two callers | The object form is additive; a plain string behaves exactly as before, and the Reports/Appeals specs still pass. |

## Definition of Done

- [x] The browser suite for the Support tab passes, including both attachment
      tests that were failing.
- [ ] Merged to `develop`, all checks green.

## How it was built

`fetchObjectUrl(path)` in `public/js/core/api.js` — the same bearer token
`apiCall` uses, but it returns bytes rather than insisting on JSON, which
`apiCall` does and which is why it could never have carried this.

`renderEvidence` now accepts `{ url, contentType }` as well as a URL string. It
decided image-versus-video by reading the file extension out of the URL, and an
object URL (`blob:...`) has none — so without the declared type every video
rendered as a still image with no play badge.

## Notes

- Found on 2026-08-24 while adding SHY-0438's conversion control: two attachment
  tests in `tests/web/admin-support.spec.ts` were failing, and the first cause
  turned out to be an unrelated environment problem (a stale LAN address in
  `.env.local`, now synced by `scripts/dev/sync-local-lan-ip.sh`). Fixing that
  revealed this one underneath it.
