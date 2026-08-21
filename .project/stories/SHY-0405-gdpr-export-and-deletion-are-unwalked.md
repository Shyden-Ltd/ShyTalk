---
id: SHY-0405
status: Draft
owner: unassigned
created: 2026-08-21
priority: P0
effort: L
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0405: Nobody has ever exported their data or deleted their account

## User Story

As **somebody exercising a legal right over my own data**, I want the export and
deletion paths to have been walked, so that the answer to "where is my data" is
demonstrated rather than asserted.

## Why

These are **legal obligations**, not features:

- **GDPR Article 20** — data portability. `POST /users/:id/data-export`,
  `GET …/status`, `GET …/download` (HMAC token).
- **Right to erasure** — the daily deletion cron, with a grace period, batched
  hard delete, and a suggestions-footprint cascade so a deleted person is not
  still identifiable through `submitterUid` / `voterId` / `authorUid`.

A verified audit of **68 feature files, 471 scenarios** found:

| Path | Journey steps |
| --- | --- |
| Data export — request, poll, download | **0** |
| Account deletion — the journey itself | **0** |

`account_deletion_suggestions` contains `When I delete my account` four times,
but every assertion is about a *suggestion's* side-effects. Nothing walks the
person's own experience: requesting it, the grace period, cancelling it, the
data actually going, or being unable to sign in afterwards.

### Why this is P0 rather than tidy-up

**The export secret has already caused a production-shaped outage twice.** The
module header records it: a module-load-time secret check in this very file was
the second instance of the shape that took dev down on 2026-08-19 — pm2
crash-looping and **every endpoint** returning 502, including endpoints unrelated
to export. The blast radius was fixed. The path itself is still unwalked.

`EXPORT_DOWNLOAD_SECRET` was provisioned in **production** on 2026-08-20 and was
already set — meaning live download links exist, signed by a secret, on a path no
journey has ever exercised.

And a deletion that half-works is worse than one that fails: the person is told
they are gone while their footprint remains.

## Acceptance Criteria

### Happy path — export

- [ ] Somebody requests their data and is told it is being prepared.
- [ ] Polling reports progress and then completion.
- [ ] The download link works and yields a file.
- [ ] The file contains their data — asserted on **contents**, not on a 200.

### Happy path — deletion

- [ ] Somebody requests deletion and is told when it will happen.
- [ ] During the grace period they can still sign in and can cancel.
- [ ] After the cron runs, their account is gone and sign-in no longer works.
- [ ] Their footprint is gone from the suggestions corpus — no `submitterUid`,
      `voterId` or `authorUid` still identifies them.
- [ ] Content that legitimately survives shows as **Deleted User** rather than
      disappearing or showing a name.

### Error paths

- [ ] An export that fails to build says so; the person is not left polling.
- [ ] An expired download token is refused with a reason, not a stack trace.
- [ ] A tampered download token is refused.
- [ ] Requesting an export twice in quick succession is rate-limited with a
      readable message.
- [ ] The export secret being missing fails **only** export — every other
      endpoint keeps working. This is the 2026-08-19 outage shape; pin it.

### Edge cases

- [ ] Export for an account with a very large history completes.
- [ ] Export for a brand-new account with almost nothing produces a valid file.
- [ ] Deletion of an account that owns an open room closes the room.
- [ ] Deletion of an account mid-conversation leaves the other person's thread
      readable.
- [ ] Cancel, then re-request deletion.
- [ ] Cron run with more pending deletions than its per-run limit of 10 —
      the remainder are picked up next run, none are lost.
- [ ] Walked on real Android **and** real iPhone, plus Web.

### Performance

- [ ] The cron's batched delete stays within its documented batch size.

### Security

- [ ] One account cannot request another's export — its own scenario.
- [ ] One account cannot poll another's export status.
- [ ] A download token issued for one account does not work for another.
- [ ] A download token cannot be reused after expiry.
- [ ] One account cannot schedule another's deletion.

### UX

- [ ] The person is told plainly what deletion removes and what survives.

### i18n

- [ ] Export and deletion copy asserted on rendered text in a non-English locale.

### Observability

- [ ] Every export request and every deletion is auditable afterwards.

## BDD Scenarios

**Scenario: Getting my data**

- **Given** somebody who asks for a copy of their data
- **When** the export finishes
- **Then** they can download a file containing it

**Scenario: Somebody else's export stays theirs**

- **Given** an export belonging to another account
- **When** somebody who does not own it asks to download it
- **Then** they are refused

**Scenario: A download link stops working**

- **Given** a download link that has expired
- **When** somebody opens it
- **Then** they are told it has expired

**Scenario: Deleting an account really deletes it**

- **Given** somebody who asked to be deleted and the grace period has passed
- **When** the deletion runs
- **Then** they can no longer sign in

**Scenario: A deleted person is not still identifiable**

- **Given** somebody who had voted on and submitted suggestions before deletion
- **When** the deletion completes
- **Then** nothing in the suggestions corpus identifies them

**Scenario: Changing my mind**

- **Given** somebody inside their deletion grace period
- **When** they cancel the deletion
- **Then** their account continues normally

**Scenario: Losing the export secret does not take the app down**

- **Given** the export secret is not configured
- **When** somebody uses an unrelated part of the app
- **Then** it works normally

## Test Plan

| Layer | What it proves |
| --- | --- |
| **Journey, all three surfaces** | Request, poll, download, open — and separately request deletion, wait, sign-in refused. The far end is a real file and a real refused sign-in. |
| Contents | The exported file is opened and its contents asserted against what the account actually had — a 200 proves nothing about completeness. |
| Erasure cascade | After deletion, the suggestions corpus is queried for the person's identifiers and must return nothing. This is the gap the cron's own header says was originally missed. |
| Security | Cross-account export request, status poll, download, and deletion scheduling are FOUR separate refusals, each asserted. |
| Token | Expired and tampered download tokens each refused, against the real HMAC signer. |
| Outage shape | Secret absent → export fails, everything else keeps serving. The 2026-08-19 regression, pinned as behaviour. |
| Cron | More pending deletions than the per-run limit — none lost across runs. |

## Out of Scope

- Changing retention periods or what deletion removes. This is coverage for what
  exists, plus the decision record if a gap in the spec is found while walking it.

## Dependencies

- A test account that can be deleted for real, and a way to advance the cron
  without waiting a day.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The export journey asserts a 200 and stops | Contents asserted; the file is opened. |
| Deletion is walked on the happy path and the cascade is assumed | The suggestions-footprint query is its own required assertion. |
| Cross-account protection is tested once and generalised | Four separate refusals, one per endpoint. |
| A test account deletion damages shared fixtures | Deletion runs against an account created for the run, asserted unique. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] A real export downloaded and opened, and a real account deleted, on a real
      device and in a browser.

## Notes

- Found 2026-08-21 in the deeper journey audit.
- The related outage lesson is already recorded: config validated at MODULE LOAD
  kills the whole service. This story pins the *behaviour* that lesson describes.
