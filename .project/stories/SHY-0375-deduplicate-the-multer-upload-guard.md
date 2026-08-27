---
id: SHY-0375
status: Draft
owner: unassigned
created: 2026-08-20
priority: P3
effort: XS
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0375: Deduplicate the multer upload guard

## User Story

As **someone maintaining the upload routes**, I want the multer error-to-JSON
translation in one place, so that a fix to the upload contract cannot land in one
route and silently miss the other.

## Why

`storage.js` and `banners.js` each carry a byte-identical block translating
multer failures into JSON:

```js
upload.single('file')(req, res, (err) => {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large (max 10 MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  next();
});
```

`express-api/src/routes/storage.js:38-48` and
`express-api/src/routes/banners.js:232-241`.

**The duplication was created deliberately and recently.** SHY-0368 (#1877) fixed
storage.js returning a 500 HTML page for an oversized upload by copying the block
out of banners.js. That was the right call under a P0, and it left a second copy
behind. The behaviour is now correct in both; only the duplication remains.

This work already existed on **PR #1527**, which is being closed (operator
decision, 2026-08-20): the PR was seven weeks old, most of its content had been
superseded, and its stale CI told us nothing. This story re-files the part still
worth having, on top of current develop.

## Acceptance Criteria

### Happy path

- [ ] Both routes use a single shared helper; the duplicated block is gone.
- [ ] An oversized upload still returns **413** with a JSON body on both routes.
- [ ] A valid upload is unaffected on both routes.

### Error paths

- [ ] Any other multer failure still returns **400** with a JSON body, never
      Express's default HTML 500. This includes a `fileFilter` rejection, which
      multer forwards as a plain `Error` with no `.code` — the helper must not
      assume `MulterError`.
- [ ] `banners.js`'s unsupported-file-type rejection keeps its current message.

### Edge cases

- [ ] `storage.js` gains an explicit `limits: { files: 1 }`, matching the single
      file its handler accepts, so a multi-part flood is refused by the parser
      rather than after buffering.
- [ ] The helper is used at **every** multer mount point — verified by a check
      that no `upload.single(` remains outside it, so the next route added
      cannot quietly reintroduce a bare mount.

### Performance

- [ ] None. Same middleware, one definition.

### Security

- [ ] The 10 MB cap and the allowed-MIME filter are unchanged.
- [ ] No upload path is left mounted bare, which is what produced HTML 500s.

### UX

- [ ] Unchanged — clients already receive these responses.

### i18n

- [ ] N/A — API error strings, not user-facing copy.

### Observability

- [ ] Unchanged.

## BDD Scenarios

**Scenario: An oversized image is refused cleanly**

- **Given** someone picks an image larger than the limit
- **When** they upload it
- **Then** they are told the file is too large

## Test Plan

1. Existing `storage.test.js` and `banners.test.js` oversized-upload cases must
   stay green through the refactor — they are the behavioural contract.
2. Add a `fileFilter`-rejection case (no `.code` on the error) to prove the
   second branch, which is the one a `MulterError`-only helper would break.
3. Add the "no bare `upload.single(` outside the helper" check, and validate it
   against the pre-refactor code so a clean result means "none present" rather
   than "detector broken".
4. `npm test` for the full express suite.

## Out of Scope

- **`log.js`'s promise-in-try restructure**, also carried by #1527. It is
  behaviour-neutral and exists only to satisfy a Sonar flag; file separately if
  Sonar still reports it.
- Any change to upload limits or accepted types.

## Dependencies

- Supersedes the code portion of **#1527** (closed).
- Related: SHY-0368 (#1877), which created the second copy.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The helper narrows to `MulterError` and drops `fileFilter` rejections | An explicit AC and a dedicated test for the no-`.code` path. |
| A future route mounts multer bare again | The repo check in AC "edge cases" fails the build if it does. |

## Definition of Done

- [ ] Both routes on the shared helper; suite green; CI green by name.
- [ ] Story `In Review` before merge; merged to develop; dev deploy dispatched
      and its health gate observed passing.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — re-filed from #1527 per the operator's decision to close that
  PR rather than rebase seven weeks of drift for ~50 lines of value. The helper
  as written on that branch is a good starting point
  (`express-api/src/utils/upload.js`, `singleFileUpload(upload, field)`).
