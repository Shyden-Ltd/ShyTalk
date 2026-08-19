---
id: SHY-0361
status: Draft
owner: unassigned
created: 2026-08-20
priority: P2
effort: S
type: infra
roadmap_ids: []
mvp: false
---

# SHY-0361: Tester build notes do not say what changed

## User Story

As **a tester picking up a new ShyTalk build**, I want the build notes to tell me
which ticket the build contains, so that I know what to test without asking
anyone or reading the commit history.

## Why

**Operator, 2026-08-20:** *"in the app tester app build notes, it should have the
information about the last ticket, even if it's a deploy from develop (but still
says it's a deploy from develop)."*

Today `deploy-dev.yml:556` builds the Firebase App Distribution notes as:

```
releaseNotes: ${{ inputs.release-notes != '' && inputs.release-notes
  || format('Dev build from {0} ({1})', ref, sha) }}
```

So the default note is literally **`Dev build from develop (432626879b7)`**. It
gets the provenance half right — it does say it is a deploy from `develop` — and
carries **no ticket information at all**. A tester receives a build and a commit
hash, and has no way to know what to look at.

The `release-notes` input exists, so a human who remembers can pass good notes by
hand. That is the defect: it depends on remembering. This story makes the default
carry the ticket.

## Acceptance Criteria

### Happy path

- [ ] A dev build's notes name the most recent ticket: its id, its title, and a
      one-line summary of what changed.
- [ ] The notes **still state** that the build is a deploy from `develop`.
- [ ] This happens with no `release-notes` input supplied.

### Error paths

- [ ] If the last ticket cannot be determined, the notes say so plainly and still
      give branch and sha — never a blank or misleading note.
- [ ] A malformed story file does not fail the deploy; the notes degrade.

### Edge cases

- [ ] A deploy carrying **several** merged tickets lists them, newest first,
      rather than naming only one and implying it is the whole build.
- [ ] A deploy with no ticket-bearing commits (a config-only deploy) says that,
      rather than naming a stale earlier ticket.
- [ ] An explicit `release-notes` input still wins — the hand-written path is not
      removed.
- [ ] Notes stay within Firebase App Distribution's length limit; long titles are
      truncated with the id intact, since the id is the useful half.

### Performance

- [ ] Note generation adds no meaningful time to a deploy.

### Security

- [ ] Nothing internal leaks to testers — no PR-internal links, no file paths, no
      personal data.

### UX

- [ ] Read on a real device in the tester app, the note answers "what do I test?"
      in its first line. Verified by looking at it, not by asserting the string.
- [ ] The same treatment applies to the iOS TestFlight "what to test" text, so a
      tester gets the same information on both platforms.

### i18n

- [ ] N/A — tester-facing English, consistent with existing tester tooling.

### Observability

- [ ] The generated note is echoed in the deploy log, so a failed distribution
      can still be diagnosed from the run.

## BDD Scenarios

**Scenario: A tester can see what a new build contains**

- **Given** a new build has been shared with testers
- **When** the tester reads the build notes
- **Then** they see which ticket it contains and where it was built from

**Scenario: A build with nothing to report still explains itself**

- **Given** a build contains no ticket changes
- **When** the tester reads the build notes
- **Then** the notes say so rather than naming an unrelated ticket

## Test Plan

**RED first.** Today's default note contains no ticket id — a test asserting one
fails against the current workflow.

1. A workflow test on the notes expression: ticket present, ticket absent,
   multiple tickets, explicit input overrides.
2. A truncation test at the length limit that keeps the id.
3. A real dev deploy, read on a real device in the tester app and on TestFlight.

## Out of Scope

- Changing what is deployed, or when.
- Release notes for **production** store listings — different audience, different
  review path.
- Localising tester notes.

## Dependencies

- `.github/workflows/deploy-dev.yml` (Android App Distribution + iOS TestFlight
  legs).
- Benefits from SHY-0360's story/board plumbing but does not require it.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Notes generation breaks a deploy | Generation is best-effort with a documented fallback; the deploy never fails on notes. |
| Internal detail leaks to testers | Notes are built from story title + summary only, never PR bodies or paths; asserted in test. |
| A stale ticket is named on a config-only deploy | The no-ticket case is an explicit tested branch. |

## Definition of Done

- [ ] Default dev-build notes name the ticket **and** the source branch, on both
      Android and iOS.
- [ ] Story `In Review` before merge.
- [ ] CI green by name; merged to develop; dev deploy dispatched and the note
      read on a real device.
- [ ] `released_in:` set on the next release cut.

## Notes (running log)

- **2026-08-20** — Filed from the operator's instruction. Confirmed against
  `deploy-dev.yml:556`: the default note is `Dev build from {ref} ({sha})` with
  no ticket. As an interim measure the SHY-0358 dev deploy (run 32289832760) was
  dispatched with hand-written notes naming the ticket, proving the shape the
  default should produce.
