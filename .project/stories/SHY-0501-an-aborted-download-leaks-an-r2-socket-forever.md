---
id: SHY-0501
status: Draft
owner: claude
created: 2026-09-01
priority: P1
effort: M
type: bug
roadmap_ids: []
mvp: true
epic: EPIC-0003
---

# SHY-0501: An abandoned download leaks a connection until nothing can reach storage

## User Story

As **anybody who needs a picture, a video, a backup or a data export**, I want
storage to keep working after somebody closes a download half way, so that one
abandoned request does not take object storage down for everyone until a
restart.

## Why

Found by diagnosing two Playwright specs that had been failing on `develop`.
`GET /api/admin/backups` never responded — no error, no timeout, just nothing.
Every other admin route answered in under 50ms with the same token, and the
route's own R2 work completed in **43ms** when run standalone against the same
endpoint with the same credentials.

The running server told the real story:

```
$ lsof -p <express> -a -i TCP -P | grep :9002 | awk '{print $NF}' | sort | uniq -c
      50 (CLOSE_WAIT)
```

**Exactly 50** — the AWS SDK v3 default `maxSockets`. Every connection in the
pool was half-closed and never reclaimed, so each new S3 request queued behind a
socket that would never free. The process had been up **3 days 21 hours**. It
was not a slow request; it was a request that could never start.

CLOSE_WAIT means the far end hung up and this process never closed its side.
Four routes stream an R2 body straight to the client:

| Route | Line |
|---|---|
| `support-tickets.js` — ticket attachments | `object.Body.pipe(res)` |
| `data-export.js` — the GDPR export zip | `r2Obj.Body.pipe(res)` |
| `admin-backup.js` — one collection's backup | `obj.Body.pipe(res)` |
| `admin-backup.js` — a full backup file | `obj.Body.pipe(res)` |

When the client goes away mid-stream — a moderator scrubbing a reported video,
a browser cancelling a large zip, a phone losing signal — the response ends and
the S3 stream is simply dropped. Nothing destroys it, so the socket sits in
CLOSE_WAIT forever.

Attachments are the worst of the four: they are photographs and video, reviewed
by moderators who scrub and close, and video elements routinely abandon
requests. Fifty of those is not an unusual day.

**This is not a local-environment problem.** The same code runs in production
against Cloudflare R2 with the same default pool and the same absence of a
timeout. The observable symptom there is that attachments, exports and backups
all stop working at once, with no error in the logs, until somebody restarts the
API — and a restart looks like it fixed a mystery rather than a leak.

Two independent faults, and either alone would have been survivable:

1. Nothing destroys an abandoned stream, so sockets leak.
2. The S3 client sets **no timeouts at all**, so an exhausted pool waits
   forever instead of failing. That is what turned a leak into a silent hang.

## Acceptance Criteria

### Happy path

- [ ] A download that completes normally still works, byte for byte.
- [ ] Repeatedly starting and abandoning a download leaves the connection pool
      no more used than when it started.

### Error paths

- [ ] When the pool cannot serve a request, the caller gets a clear failure in
      bounded time. It never hangs indefinitely.
- [ ] A failure to reach storage is logged with enough to identify it, and
      returns an error status rather than nothing.

### Edge cases

- [ ] A client that disconnects BEFORE the first byte is handled the same as one
      that disconnects half way.
- [ ] A stream that ends normally is not destroyed twice.
- [ ] An object that does not exist still returns 404, not a hang.

### Performance

- [ ] No measurable change to a normal download.

### Security

- [ ] No change to who may download what. The guards are untouched.

### UX

- [ ] A moderator who closes a video and opens another sees the second one.

### i18n

- [ ] N/A.

### Observability

- [ ] Storage-pool exhaustion is visible in the logs as itself, rather than as
      an absence of any log line at all.

## BDD Scenarios

**Scenario: A moderator closes a video and carries on working**

- **Given** a moderator reviewing a reported video
- **When** they close it before it finishes and open another
- **Then** the second video plays

**Scenario: Storage stays usable after many abandoned downloads**

- **Given** many downloads that were started and abandoned
- **When** somebody asks for a picture afterwards
- **Then** it arrives

## Test Plan

- Unit: an abandoned stream destroys the underlying body exactly once, and a
  completed one is not destroyed twice.
- Integration: against the real MinIO, start and abandon more downloads than the
  pool has sockets, then assert a subsequent request still succeeds — this is
  the test that would have caught it, and it fails on today's code.
- Boundary: exactly `maxSockets` abandoned downloads, then one more.

## Out of Scope

- Moving attachment delivery to signed URLs so the API never proxies bytes.
  That is the better long-term shape and is a separate decision.

## Dependencies

- None.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Destroying a stream too eagerly truncates a good download | Destroy only on client disconnect, and only if the stream has not already ended. Asserted both ways. |
| A timeout that is too tight fails large legitimate downloads | The timeout bounds establishing and idling, not total transfer time. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] The two Playwright specs that exposed this pass without a server restart.

## Notes

- Found 2026-09-01 while investigating `admin-backups` and `admin-banners`
  failing on `develop`. The operator asked for the local stack to be fixed; the
  local stack was fine, and the defect it exposed is in shipped code.
