---
id: SHY-0368
status: Done
owner: unassigned
created: 2026-08-20
priority: P1
effort: XS
type: bug
roadmap_ids: []
mvp: true
released_in: v0.99.0
---

# SHY-0368: Uploading a file over 10 MB returns a 500 HTML page instead of "too large"

## User Story

As **someone uploading a photo that turns out to be too big**, I want to be told
it is too big, so that I can pick a smaller one instead of seeing a server error
that looks like the app is broken.

## Why

`express-api/src/routes/storage.js` mounted multer as **bare middleware**:

```js
router.post('/storage/upload', upload.single('file'), async (req, res) => {
```

Multer is configured with `limits: { fileSize: 10 * 1024 * 1024 }`, but nothing
handles the error it raises. `LIMIT_FILE_SIZE` therefore propagates to Express's
**default** error handler, which answers **500 with an HTML body** — to an API
client that asked for JSON.

So the user-visible outcome of the entirely expected "your file is too big" is a
server error. The same is true of every other multer error, e.g. an unexpected
field name.

**`banners.js` already got this right** (line ~232): it wraps
`upload.single('file')` and maps `LIMIT_FILE_SIZE` → **413** and anything else →
**400**. `storage.js` — the route real users hit for profile photos, covers,
messages and evidence — did not. The two sibling routes disagreed.

Measured on `develop` before the fix:

| Case | Expected | Actual |
| --- | --- | --- |
| file > 10 MB | 413 JSON | **500** |
| unexpected field name | 400 JSON | **500** |

This fix has sat unmerged for **seven weeks** inside the stale PR **#1527**
(opened 2026-07-01, 21 commits behind). Extracted here for the same reason
SHY-0365 was: a live user-facing defect should not wait on a 449-line PR being
revalidated.

## Acceptance Criteria

### Happy path

- [ ] A file over 10 MB returns **413** with a JSON body a client can read.
- [ ] A normal upload is unaffected.

### Error paths

- [ ] Any other multer error returns **400 JSON**, never a 500 — the route
      answers, rather than falling through to Express's default handler.
- [ ] `Content-Type` is `application/json` in both cases, not `text/html`.
- [ ] Nothing is written to R2 when the upload is rejected.

### Edge cases

- [ ] **No other route has the same defect.** The whole codebase is swept, not
      just this file — there are exactly two multer mounts and both must wrap.
- [ ] The size limit itself is unchanged at 10 MB; this story fixes the
      *response*, not the policy.
- [ ] The existing image-**dimension** policy path (`ImagePolicyError` → 400) is
      untouched — it is a different "oversized" and already covered.

### Performance

- [ ] N/A — an error-handling wrapper.

### Security

- [ ] The 10 MB bound still applies and still rejects before the body is stored.
- [ ] The 400 path returns multer's own message, which describes the upload
      problem and leaks no internal detail.

### UX

- [ ] The message names the actual limit ("max 10 MB") so the user knows what
      would work, rather than just being told "no".

### i18n

- [ ] N/A — API error payload; the client renders user-facing copy.

### Observability

- [ ] N/A — the rejection is now an ordinary 4xx rather than an unhandled 500,
      which is itself the improvement in the logs.

## BDD Scenarios

**Scenario: A photo that is too big is explained, not an error**

- **Given** someone chooses a photo larger than the upload limit
- **When** they try to upload it
- **Then** they are told the file is too large rather than shown a server error

## Test Plan

**RED first, measured.** Both new tests fail on `develop` with **500**, against
real multer and real supertest — no mock decides the outcome.

1. Attach an 11 MB buffer → assert 413, JSON content-type, message names the
   limit, and R2 was never called.
2. Attach under an unexpected field name → assert 400 and JSON content-type.
3. Sweep the codebase for every multer mount and confirm each wraps its errors.

## Out of Scope

- **PR #1527**, which contains this fix among 449 lines. Its remaining content is
  a Sonar-appeasement refactor of `log.js` (behaviour-preserving; the original
  `.catch()` already handled async rejection) and a CI pin-sync that SHY-0226
  has since superseded. Its fate is a separate decision.
- Raising or lowering the 10 MB limit.
- The image-dimension policy path.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The wrapper swallows an error the route should see | Only multer's own errors are handled; everything else calls `next()` unchanged. |
| The two routes drift apart again | Both mounts are now identical in shape, and the sweep AC requires checking every mount rather than just this one. |
| A client depended on the 500 | A 500 for an oversized upload is not a contract anyone can have relied on deliberately; the JSON 413 is strictly more usable. |

## Definition of Done

- [ ] 413/400 JSON in place; no bare multer mount anywhere.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

Reviewed-up-to: acadcecf8f7bea3daea78d633323ef75b75fe761

- **2026-08-20** — Found while triaging the stale #1527 overnight. The sweep
  found exactly two multer mounts in the codebase; `banners.js` was already
  correct, so this was an inconsistency between siblings rather than a
  systemic gap.
