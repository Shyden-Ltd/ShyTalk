---
id: SHY-0453
status: Draft
owner: unassigned
created: 2026-08-25
priority: P3
effort: M
type: feature
roadmap_ids: []
mvp: false
---

# SHY-0453: A status page the app can point at

## User Story

As **somebody who cannot get into ShyTalk**, I want somewhere to check whether
it is just me, so that I stop restarting my phone over an outage I cannot fix.

## Why

Operator, 2026-08-25, while removing the last screen that admitted an outage:

> "This can be useful for a future ticket: a status page. So in future we can
> say: *if this problem persists, check the status* where we can report any
> known outages, etc. Not MVP though."

The app no longer tells anybody it is our end, and that is right — almost every
real instance is a device-side network problem, and announcing an outage to the
public is a business decision rather than a technical one (SHY-0454).

But it leaves one honest case unserved. When it IS us, the connection screen
sends somebody to check their VPN and restart their phone, and none of it will
work. A status page is how that case gets an answer without the app itself
publishing our uptime: the app points at a page, and what that page says is a
decision made per incident rather than baked into a build.

## Acceptance Criteria

### Happy path

- [ ] The connection screen offers a way to check status, alongside the tips.
- [ ] It opens a page that states plainly whether anything is known to be wrong.
- [ ] With nothing wrong, the page says so — silence must not read as an outage.

### Error paths

- [ ] The status page is reachable when ShyTalk itself is not. Hosting it on the
      same infrastructure would make it unavailable exactly when it is needed.
- [ ] If the status page cannot be reached either, the app says nothing new
      rather than guessing.

### Edge cases

- [ ] A person on a device-side problem sees the same tips as today; the status
      link is an addition, not a replacement.
- [ ] The link is safe to show to a minor — no external content beyond the page.

### Performance

- [ ] The connection screen does not wait on the status page to render.

### Security

- [ ] The page carries no account data and needs no sign-in.
- [ ] Publishing an incident is a deliberate act, never automatic from a health
      check — a false positive would tell the world we are down when we are not.

### UX

- [ ] The wording stays out of blame: "check the status", not "we are having
      problems".

### i18n

- [ ] The link text is translated for all locales.
- [ ] Whether the page ITSELF is translated is part of the design, not assumed.

### Observability

- [ ] Taps on the status link are counted, so it is possible to tell whether it
      is being used or ignored.

## BDD Scenarios

**Scenario: Somebody checks whether it is them**

- **Given** somebody who cannot connect after trying the tips
- **When** they choose to check the status
- **Then** they are told whether anything is known to be wrong

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The link is present, and its copy takes no blame. |
| Device | The link opens the page from the connection screen on both platforms. |
| Manual | With the page reporting an incident, the wording reads correctly. |

## Out of Scope

- Automatic incident detection. Publishing is deliberate — see Security.
- Any in-app rendering of the status page.

## Dependencies

- **SHY-0454** removed the screen that used to admit an outage. This is the
  replacement for the one case that screen served honestly.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The status page is hosted where ShyTalk is, and dies with it | An explicit AC; it must be independently reachable. |
| A stale page says "all fine" during an outage | Publishing is deliberate, so staleness is a process problem — the page shows when it was last updated. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Journey-walked on both devices.

## Notes

- Filed 2026-08-25 from the operator's own suggestion. Explicitly **not MVP**.
