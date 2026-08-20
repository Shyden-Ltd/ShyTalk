---
id: SHY-0383
status: Draft
owner: unassigned
created: 2026-08-20
priority: P3
effort: XS
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0383: The local build still defaults to the retired emulator's address

## User Story

As **someone testing a local build on a real phone**, I want the default build to
reach my machine, so that I do not lose ten minutes to a silent connection
failure before discovering an undocumented flag.

## Why

`app/build.gradle.kts:155`:

```kotlin
val localHostAlias = (project.findProperty("localHost") as String?) ?: "10.0.2.2"
```

`10.0.2.2` is the **Android emulator's** alias for the host machine's loopback.
On a real device it addresses nothing. Emulators were **retired on 2026-07-15**
(AVD and emulator package deleted from the machine; real devices over USB are the
only target), so the default now points at a target that no longer exists.

The symptom is not an error. The app boots, hangs on its start-up checks, and
eventually logs:

```
DeviceRepository: Ban check failed, allowing through:
  failed to connect to /10.0.2.2 (port 3000) from /192.168.1.2 after 10000ms
```

The supported route is already documented in the comment directly above the
line — build with `-PlocalHost=localhost` and use `adb reverse` — so this is a
stale default, not a missing capability.

## Acceptance Criteria

### Happy path

- [ ] A default `installLocalDebug` on a real USB device reaches the local stack
      without extra flags.

### Error paths

- [ ] If the local stack is not running, the failure is reported promptly rather
      than after a ten-second timeout on an unreachable address.

### Edge cases

- [ ] `-PlocalHost=<something>` still overrides, for anyone who needs it.
- [ ] The change does not affect the `dev` or `prod` flavours.

### Performance

- [ ] Start-up no longer waits on a connection that cannot succeed.

### Security

- [ ] `network_security_config.xml` still permits cleartext only for local hosts,
      and no more.

### UX

- [ ] Not user-facing.

### i18n

- [ ] No copy changes.

### Observability

- [ ] The resolved host is visible in the preview watermark or the log, so the
      target is never in doubt.

## BDD Scenarios

**Scenario: A local build reaches the local stack by default**

- **Given** a real phone connected by USB with the local stack running
- **When** a local build is installed and opened
- **Then** it reaches the local stack without extra flags

## Test Plan

| Layer | What it proves |
| --- | --- |
| Build config test | The default host is no longer the emulator alias, and the override still works. |
| Device | Default local build on a real phone reaches the stack, proven by the watermark's API indicator. |

## Out of Scope

- Removing the emulator alias from `network_security_config.xml`, which is
  harmless and may still help someone.
- The wider emulator-retirement sweep.

## Dependencies

- Requires `adb reverse` for the relevant ports, which the existing comment
  documents.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Someone still uses an emulator | Emulators were retired 2026-07-15 and the packages deleted; the `-PlocalHost` override remains for any exception. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Default local build proven on a real device.

## Notes

- Cost ten minutes to rediscover while walking SHY-0372.
