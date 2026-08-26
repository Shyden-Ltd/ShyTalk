---
id: SHY-0471
status: Draft
owner: unassigned
created: 2026-08-27
priority: P2
effort: L
type: chore
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0471: Push registration must move to FIDs before Firebase can be updated

## User Story

As **whoever updates dependencies**, I want the Firebase BOM to be updatable,
so that the Android SDKs stop being pinned two months behind by a migration
nobody has scoped.

## Why

`firebase-bom` is pinned at **34.14.1**. Every release from **34.15.0** onward
fails the build, and the repo compiles with `-Werror`:

```
e: ShyTalkMessagingService.kt:25  'fun onNewToken(p0: String): Unit' is deprecated
e: AndroidPlatformNavCallbacks.kt:38  'val token: Task<String!>' is deprecated
```

Dependabot's PR #1519 (34.15.0) has sat failing since **2026-06-29** for
exactly this. Bumping is not the fix, and suppressing the warnings would be
worse: it would hide a deprecation that is going to become a removal.

### It is not a mechanical migration

The replacements change what push is ADDRESSED BY, not just which method is
called:

| Deprecated | Replacement | What changes |
| --- | --- | --- |
| `FirebaseMessaging.getToken(): Task<String>` | `register(): Task<Void>` | No longer returns anything. Registration completes, and the value arrives by callback. |
| `FirebaseMessagingService.onNewToken(String)` | `onRegistered(String)` | The string is a **Firebase Installation ID**, not an FCM token. |

And the two cannot coexist. `register()` requires
`firebase_messaging_installation_id_enabled` in the manifest, and with that
flag set `getToken()` **throws** `IllegalStateException`. It is one or the
other, app-wide.

So the change reaches four places, not one:

1. The client stops asking for a token and registers instead.
2. What is stored per user changes from an FCM token to an FID.
3. The server's send path — `sendFcmToTokens` and `cleanupInvalidTokens` in
   `express-api/src/utils/fcm.js` — must target FIDs.
4. Existing stored tokens have to be migrated or allowed to expire, and until
   they are, some devices are addressed the old way and some the new.

That is a data migration on live user documents, and it decides whether push
keeps working for people who do not reopen the app during the changeover.

## Acceptance Criteria

### Happy path

- [ ] A notification sent from the server arrives on a real Android device
      registered the new way.
- [ ] The Firebase BOM is on the current release with no `-Werror` failures and
      no suppressions.

### Error paths

- [ ] A device that fails to register is logged and retried on next launch, as
      the token path is today — not left silently unreachable.
- [ ] A send to a stale identifier is cleaned up, the way
      `cleanupInvalidTokens` handles a dead token now.

### Edge cases

- [ ] A user whose stored value is still an old FCM token keeps receiving
      notifications until they are migrated. **Nobody goes dark in the
      changeover.**
- [ ] Sign-out removes the right identifier, and sign-in on a second device
      does not evict the first.
- [ ] iOS is unaffected or migrated in step — whichever, it is stated rather
      than discovered.

### Performance

- [ ] Registration happens once per launch at most, as the token fetch does.

### Security

- [ ] An FID identifies an app instance. Whatever addresses a device must stay
      as guarded as the token it replaces — no broadening of who can send to
      whom.

### UX

- [ ] Invisible when it works. A person who never reopens the app during the
      changeover still gets notifications.

### i18n

- [ ] None: no user-facing copy.

### Observability

- [ ] Logs distinguish "registered", "still on a legacy token" and "failed",
      so the changeover can be watched rather than assumed.

## BDD Scenarios

**Scenario: Somebody is sent a notification after the change**

- **Given** a person whose device registered for push the new way
- **When** somebody sends them a message
- **Then** the notification arrives on their phone

**Scenario: Somebody has not opened the app since the change**

- **Given** a person whose device registered the old way
- **When** somebody sends them a message
- **Then** the notification still arrives

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Registration failure retries; sign-out removes the right identifier. |
| Express | The send path addresses the new identifier, and cleans up a stale one. Real emulator, no doubles. |
| Device (real) | A notification sent from dev arrives on the OnePlus. Push has to be proven on hardware — an emulator has never been evidence for it. |
| Device (real) | A device still holding a legacy token receives one too, during the changeover. |
| Build | The current BOM compiles with `-Werror` and no suppressions. |

## Out of Scope

- Any other dependency bump. This one blocks Firebase specifically.
- Changing what notifications SAY or when they fire.

## Dependencies

- Blocks Dependabot PR #1519 and every Firebase BOM bump after it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Push silently breaks for everyone | Real-device proof is in the Definition of Done, and the dual-read AC keeps legacy tokens working during the changeover. |
| Half-migrated user documents | The server reads both shapes until the old one is gone, which is what makes it safe to do gradually. |
| The manifest flag is all-or-nothing | True, and it is why this cannot be done incrementally in the CLIENT — the server has to be ready first. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A notification proven arriving on a real Android device from dev.
- [ ] The BOM on the current release, `-Werror` clean.
- [ ] PR #1519 closed as superseded.

## Notes

- Filed 2026-08-27 while attempting the bump. Versions 34.15.0, 34.16.0 and
  34.17.0 were each tried and each fails the same way, so this is not specific
  to the version Dependabot picked.
- The resolved-graph diff for 34.14.1 → 34.18.0 is otherwise clean: 9 artefacts
  bumped, **0 removed, 0 added**. The blocker is the deprecation, not a
  vanished API.
- Deliberately not attempted unattended: it changes what is stored on live user
  documents, and push working is not something to discover is broken later.
