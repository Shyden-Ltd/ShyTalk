---
id: SHY-0317
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: M
type: feature
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0317: Reach 5% before you reach everyone, and prove you can get back

## User Story

As the **operator**, I want a manifest change to reach a small share of users
first and to be reversible in one action, so that a mistake costs a fraction of
the userbase rather than all of it.

## Why

EPIC-0011 removes store review from the release path. Store review is slow, but
it is also the thing that currently prevents a bad change reaching 100% of users
instantly. Something has to take its place, and the honest replacements are
**staged rollout** and **rollback** — not care.

Rollout percentage is bucketed on a **stable hash of the user id combined with
the manifest version**. Both halves matter:

- Hashing the **user id** means a given user's assignment does not flip between
  launches. A user who oscillates between two manifests sees the app change
  under them repeatedly, which is worse than either version.
- Including the **manifest version** means a *new* rollout re-randomises, so the
  same unlucky 5% are not the guinea pigs every single time.

Rollback is `git revert` — the same mechanism as the publishing pipeline, not a
second one. Two rollback paths means one of them is untested.

And the requirement this story exists to enforce: **the rollback drill is
executed, not documented.** A rollback path nobody has run is a rollback path
that does not work. So the DoD includes deliberately publishing a bad manifest to
a 5% bucket, reverting it, and proving recovery — on real devices.

## Acceptance Criteria

### Happy path

- [ ] A manifest with `rollout.percent = 5` reaches approximately 5% of users, verified over a real distribution of 10,000 ids within ±1%.
- [ ] `rollout.percent = 100` reaches everyone.
- [ ] `rollout.cohorts` restricts a manifest to the named cohorts only.
- [ ] Reverting the publishing commit returns every user to the previous manifest.

### Error paths

- [ ] `rollout.percent` outside 0–100 fails publish validation, naming the value.
- [ ] A `rollout.cohorts` entry naming an unknown cohort fails publish validation.
- [ ] A user whose id is unavailable (pre-auth) is treated as outside every partial rollout — a partial manifest is never served anonymously.
- [ ] A revert while a rollout is in progress is applied to all buckets, not only the rolled-out ones.

### Edge cases

- [ ] `percent = 0` reaches nobody and is a legitimate state, not an error — it is how a manifest is staged before release.
- [ ] A user's bucket is identical across launches for the same manifest version, asserted by repeating the computation.
- [ ] A user's bucket is re-randomised for a different manifest version, asserted by comparing distributions across two versions.
- [ ] Bucketing is uniform — no id range is systematically favoured, asserted by a chi-squared check over 10,000 ids.
- [ ] A user in the rollout who then falls out of it (percentage reduced) returns to the previous manifest cleanly.

### Performance

- [ ] `bucketOf` is a pure function completing in under 1 µs, asserted over 10,000 calls.
- [ ] Bucketing adds no I/O and no per-request Firestore read.

### Security

- [ ] `bucketOf` never derives from a client-supplied value — only from the server-known `uniqueId` and `manifestVersion`.
- [ ] A client cannot opt itself into a rollout by manipulating a header, body or query parameter, asserted by attempting it.
- [ ] A rolled-out manifest is still subject to every publish validation rule — a rollout is not a way to ship an unvalidated document to a small group.

### UX

- [ ] A user moving between rollout buckets never sees a half-applied state; the manifest changes atomically.
- [ ] Rollback is not visible to a user beyond the app returning to its prior appearance.
- [ ] Screenshots of the rolled-out and reverted states on real Android and real iPhone, reviewed by eye.

### i18n

- [ ] N/A for new strings — this story adds no user-facing copy. Rollout and rollback are invisible to the user by design, and the manifests they carry are validated for all 20 locales by SHY-0316.

### Observability

- [ ] Every served manifest logs the caller's bucket, the rollout percentage, and the `manifestVersion` — so "why did this user get that manifest" is answerable.
- [ ] A revert logs the reverted `manifestVersion` and the one restored.
- [ ] The live distribution of served manifest versions is queryable, so a rollout that is not progressing as intended is visible.

## BDD Scenarios

**Scenario: A change reaches only a small share of users first**

- **Given** the operator publishes a change to five percent of users
- **When** a large number of users open the app
- **Then** about five in every hundred receive the change

**Scenario: The same user does not flip back and forth**

- **Given** a user who received a change
- **When** they close and reopen the app several times
- **Then** they receive the same version every time

**Scenario: A bad change can be taken back**

- **Given** a change that has reached five percent of users and is wrong
- **When** the operator reverts it
- **Then** those users return to the previous version

**Scenario: A staged change reaches nobody until released**

- **Given** the operator prepares a change set to reach nobody
- **When** users open the app
- **Then** none of them receive it

## Test Plan

**RED first.**

### Kotlin unit (`shared/src/commonTest/kotlin/.../manifest/RolloutBucketTest.kt`)

- `bucketOf is stable across repeated calls for the same id and version`
- `bucketOf differs across manifest versions for the same id`
- `bucketOf is uniform over 10000 ids` (chi-squared)
- `bucketOf returns a value in 0..99 for extreme ids` (0, 1, Long.MAX_VALUE)
- `bucketOf completes 10000 calls in under 10ms`

### Node / Jest (`express-api/tests/utils/rollout.test.js`)

- `serves the manifest to approximately 5 percent of 10000 ids within 1 percent`
- `serves to everyone at 100 percent`
- `serves to nobody at 0 percent`
- `restricts to named cohorts only`
- `rejects a percent outside 0 to 100 at publish validation`
- `rejects an unknown cohort at publish validation`
- `serves no partial manifest to an anonymous caller`
- `ignores a client-supplied bucket header, body field and query param`
- `logs bucket, percentage and manifestVersion on every response`

### Integration + rollback drill, REAL (this is the story's headline)

1. Publish a deliberately-bad manifest at `percent: 5` to the real local stack.
2. Confirm on a real device inside the bucket that it received it, and on a
   second real device outside the bucket that it did not.
3. Revert the publishing commit.
4. Confirm the first device returns to the previous manifest.

Executed and recorded in Notes with timestamps. A drill that was not run is not
a drill.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| `manifestVersion` dropped from the hash input | `bucketOf differs across manifest versions for the same id` |
| bucket derived from a request header | `ignores a client-supplied bucket header, body field and query param` |
| modulo replaced with a range comparison on raw id | `bucketOf is uniform over 10000 ids` |
| anonymous callers included in partial rollouts | `serves no partial manifest to an anonymous caller` |
| `percent = 0` treated as unset and served to all | `serves to nobody at 0 percent` |

### Backend change ⇒ FULL gauntlet

Touches `express-api/src/**`; the full device + all-browser matrix runs.

## Out of Scope

- Per-user targeting of named individuals — not in Phase 1.
- Automatic rollback on an error-rate signal — a good idea and a separate story;
  this one delivers the manual control that any automation would have to build on.
- A/B experiment analysis. Rollout buckets are a safety mechanism here, not an
  experimentation platform.

## Dependencies

- **SHY-0310** — the `rollout` section of the model.
- **SHY-0312** — the endpoint that applies bucketing.
- **SHY-0313** — client-side application of a changed manifest.
- **SHY-0318** — the git publishing pipeline that `git revert` operates on.
- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Rollback is documented but has never been executed, so it fails when first needed | The drill is in the DoD, run on real devices, recorded with timestamps. |
| Bucketing flips a user between manifests on successive launches | Hash includes the stable `uniqueId`; stability is asserted and destabilising it is in the mutation table. |
| The same 5% are always the guinea pigs | `manifestVersion` is part of the hash input; removing it is the first mutation. |
| A rollout is used to ship an unvalidated manifest to a small group | Explicit Security AC: every publish validation rule still applies. |
| Bucketing is non-uniform, so "5%" is not 5% | Chi-squared uniformity test over 10,000 ids. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] **The rollback drill has been executed on two real devices** — one inside the bucket, one outside — and the result recorded in Notes with timestamps.
- [ ] Bucket stability and uniformity both asserted, not assumed.
- [ ] Backend change ⇒ FULL gauntlet green, then DEV green.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §7. Staged rollout and rollback are the honest replacements for the store review this EPIC removes from the release path.
- **2026-08-17** — Both halves of the hash input are deliberate: the user id keeps a user's assignment stable across launches; the manifest version stops the same unlucky users being the guinea pigs on every rollout.
- **2026-08-17** — The drill is in the DoD rather than the Test Plan alone, because a rollback path nobody has run is a rollback path that does not work.
