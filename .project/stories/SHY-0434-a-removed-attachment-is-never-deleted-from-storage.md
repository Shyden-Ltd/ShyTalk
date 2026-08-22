---
id: SHY-0434
status: In Review
owner: claude
created: 2026-08-22
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: true
---

# SHY-0434: A file you remove is kept for ever

## User Story

As **somebody who attached the wrong file and took it off before sending**, I
want it deleted, so that a file I decided not to share is not kept anyway.

## Why

The bytes are uploaded the **moment a file is picked**, before anybody presses
Send — that is what makes the size and duration refusals possible "before any
bytes leave the device" for the files that are *refused*. A file that is
ACCEPTED is already in the object store.

`removeAttachment` then did this, and only this:

```kotlin
fun removeAttachment(r2Key: String) {
    _uiState.update { it.copy(attachments = it.attachments.filterNot { a -> a.r2Key == r2Key }) }
}
```

It removed the row from the screen. There was **no DELETE route on the API at
all** — the support router exposed upload-url, create, mine/open, messages,
attachments, list and patch, and nothing else. So the object stayed in storage,
and once the form dropped the key **nothing in the system referenced it**: no
ticket carried it, so no retention rule and no erasure request could ever reach
it. It was unreachable and permanent.

### Why this is P1 and not tidying

This is the support queue. People attach:

- screenshots of private conversations,
- photographs and video **of other people**, in safety and harassment reports,
- account and payment details they have been asked to evidence.

Keeping an orphaned copy of that indefinitely, with no purpose and no link to
any request, is precisely what data minimisation and storage limitation forbid.
It is also undiscoverable: a subject-access or erasure request works from the
tickets a person raised, and these files belong to none.

And the moment somebody removes a file before sending is the moment they most
reasonably believe it is gone.

### What proved it

There was no test either way. The nearest existing test asserted the surviving
SET of attachments after a removal — a claim that a form showing two rows while
still counting three would satisfy.

## Acceptance Criteria

### Happy path

- [ ] Removing an attachment deletes the uploaded object from storage.
- [ ] Removing an attachment reduces the count: three attached, remove one,
      two attached.
- [ ] The freed slot is usable — at ten attached, removing one lets another be
      added.

### Error paths

- [ ] A storage failure is reported by the API as a failure, never as success.
- [ ] A failed delete still removes the file from the form: somebody who has
      decided against a file must not be stuck unable to send.
- [ ] A failed delete is logged, so orphans remain discoverable.

### Edge cases

- [ ] A key under another account's prefix is refused and nothing is deleted.
- [ ] A key containing `..` or `//` is refused and nothing is deleted.
- [ ] A missing, empty or non-string key is refused.
- [ ] A caller with no resolved identity is refused (403, `no_identity`).
- [ ] Removing the same key twice does not error.

### Performance

- [ ] One delete per removal; removing ten files makes ten deletes, not a scan.

### Security

- [ ] The endpoint can only delete under the caller's own prefix — the key comes
      from the client, so every one is a candidate route into somebody else's
      folder.
- [ ] Deleting is rate-limited like the other write routes.

### UX

- [ ] Removal feels immediate: the form lets go first, and does not wait on the
      network to redraw.

### i18n

- [ ] No user-facing copy changes.

### Observability

- [ ] A removal is logged with the account, and a failed delete is logged with
      the reason.

## BDD Scenarios

**Scenario: Taking a file back**

- **Given** somebody who attached the wrong screenshot to a support request
- **When** they remove it before sending
- **Then** it is gone from their request and from our storage

**Scenario: Making room**

- **Given** somebody who has attached the maximum ten files
- **When** they remove one
- **Then** they can attach another in its place

## Test Plan

| Layer | What it proves |
| --- | --- |
| ViewModel | Removing decreases the count, frees the slot, calls the delete, and still removes the file when the server refuses. |
| Route | The object is deleted; another account's prefix, a traversal key, a bad key and a caller with no identity are each refused and delete nothing; a storage failure answers 500. |
| Device | On both phones: attach, remove, and the object is gone from the store. |

## Out of Scope

- Files left behind by ABANDONING the form without sending. Same root cause,
  different lifecycle, and it needs a server-side sweep rather than a client
  call — tracked separately.
- Deleting attachments on a ticket that has already been sent. Those are
  referenced by a ticket and covered by ticket retention.

## Dependencies

- SHY-0387 (attachments).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A delete endpoint becomes a way to delete other people's files | The key is validated against the caller's own prefix with the same three defences the upload path uses, asserted by test. |
| Awaiting the delete makes removal feel slow | The form lets go first and deletes in the background. |
| A failed delete strands a file on the form | The form has already let go; the failure is logged, not surfaced. |
| Orphans created BEFORE this fix stay for ever | Out of scope here, but they exist — a one-off sweep is needed and should be tracked. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Proven on a real device: attach a file, remove it, and confirm the object
      is no longer in the store.

## Notes

- Operator, 2026-08-22: *"there is no test to prove that the user can remove an
  uploaded attachment and to prove that the file is deleted from the server once
  removed (we must not keep files we don't need - GDPR risk)"* and *"you also
  need a test to prove that removing an attachment decreases the number of
  attachments... prove it functionally not just visually"*.
- Implemented as `DELETE /api/support-tickets/attachments` taking `{ r2Key }`,
  reusing the existing `validateAttachments` prefix/traversal checks and
  `deleteObject`.
- **Known gap this does not close:** files uploaded and then abandoned without
  sending are still orphaned. The existing test `leaving without sending keeps
  the attachments too` documents that the form keeps them; nothing deletes them
  if the person simply leaves.
