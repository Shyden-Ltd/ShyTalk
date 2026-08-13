---
id: SHY-0295
status: Draft
owner: claude
created: 2026-08-13
priority: P1
effort: XS
type: infra
roadmap_ids: []
pr:
mvp: false
---

# SHY-0295: The develop ruleset has blocked the board sidecar for 19 days

## User Story

As the operator relying on the Projects v2 board as a true mirror,
I want the `board-items.json` sidecar commit-back to land on `develop`,
So that the board's duplicate-protection is not silently running on a
19-day-old id-map.

## Why

Every run of `Mirror stories to Issues` since 2026-07-25 has failed at its last
step:

```
{"data":{"createCommitOnBranch":null},"errors":[{"type":"FORBIDDEN",
 "path":["createCommitOnBranch"],
 "message":"Repository rule violations found\n\n3 of 3 required status checks are expected.\n\n"}]}
```

The step mints a Release App token and writes `.project/board-items.json` back
to `develop` via GraphQL `createCommitOnBranch`. Ruleset **19719048**
(`develop`) refuses it: the new commit carries none of the three required
status checks, and the App's bypass is not taking effect for this token.

**The correlation is exact.** The last sidecar commit that landed was
`7484b2dcb0a` at `2026-07-25 09:41:26 +07:00`. Ruleset 19719048 was created at
`2026-07-25 09:42:43 +07:00` — **71 seconds later**. Nothing has landed since.

SHY-0242 created the develop ruleset to mirror main's required checks. It
carries one bypass actor:

| Ruleset              | Bypass actors                                                |
| -------------------- | ------------------------------------------------------------ |
| `12613584` (main)    | Integration `29110` (always), Integration `3324562` (always) |
| `19719048` (develop) | Integration `29110` (always)                                 |

The same commit-back mechanism works against `main` and fails against
`develop`, and the only structural difference between the two rulesets'
bypass lists is Integration **`3324562`**. That is the strong hypothesis: the
identity actually minting the sidecar token is `3324562`, and develop's
ruleset was created with only one of main's two bypass entries.

CLAUDE.md documents the Release App as App ID 29110, so either that note is
stale or two apps are involved — confirming which is the first task here,
because the fix must add the _right_ actor rather than the one that makes the
error stop.

Why it matters beyond a red workflow: per the SHY-0082 v4 architecture the
sidecar "overlays a stale API read so an issue is never duplicated". A sidecar
frozen on 2026-07-25 means that protection has been degrading for every story
created since — including SHY-0293, SHY-0294 and this one.

It also means a failing workflow has been red for 19 days without anyone
reading it, which is its own finding.

## Acceptance Criteria

### Happy path

- [ ] `Mirror stories to Issues` completes green, and a new
      `chore(board): sync board-items.json id-map [skip ci]` commit lands on
      `develop`.
- [ ] `.project/board-items.json` contains entries for every story created
      since 2026-07-25.

### Error paths

- [ ] The fix adds a bypass actor; it does **not** remove or weaken
      `required_status_checks` on `develop`. Human pushes to develop stay
      gated exactly as they are today.
- [ ] If the App identity cannot be confirmed, the story stops and reports
      rather than adding `3324562` speculatively — a bypass actor is a
      permission grant, and granting the wrong one is worse than the bug.

### Edge cases

- [ ] The `non_fast_forward` ruleset `16058327` (target `~ALL`) is untouched.
- [ ] Verified against the actual API (`gh api repos/.../rules/branches/develop`)
      that only 19719048 and 16058327 govern `develop`, so no third ruleset is
      also contributing.

### Performance

- N/A — a ruleset configuration change; no CI step added or removed.

### Security

- [ ] The change grants a bypass to exactly one App identity on exactly one
      ruleset, matching a grant `main` already carries. No human actor, team,
      or role gains a bypass.
- [ ] **Operator authorisation is required before the ruleset is modified.**
      Branch-protection configuration is outward-facing and security-relevant;
      it is not changed autonomously.

### UX

- N/A — internal tooling.

### i18n

- N/A — no user-facing strings.

### Observability

- [ ] A workflow that has been failing for 19 days without notice is the
      second defect here. Decide whether `Mirror stories to Issues` failing
      should surface somewhere the operator actually reads — otherwise the
      next silent 19-day break is only a matter of time.

## BDD Scenarios

**Scenario: the sidecar lands after the bypass is corrected**

- **Given** ruleset 19719048 carries a bypass actor for the App that mints the
  sidecar token
- **When** `Mirror stories to Issues` runs on a push to `develop`
- **Then** `createCommitOnBranch` succeeds and the workflow exits 0

**Scenario: human pushes to develop remain gated**

- **Given** the corrected ruleset
- **When** a contributor opens a PR into `develop` with a failing check
- **Then** the PR is still blocked by `required_status_checks`

**Scenario: the identity is unconfirmed**

- **Given** the App ID minting the token cannot be established
- **When** the fix is attempted
- **Then** no ruleset change is made and the story reports the blocker

## Test Plan

**Red (observed):** run 31664191105, step `Commit board-items.json sidecar via
createCommitOnBranch` — two attempts, both `FORBIDDEN`, exit 1. Reproduces on
every run since 2026-07-25.

**Green:** after the ruleset change, the next push to `develop` produces a
board-sidecar commit. Verify with
`git log origin/develop -1 -- .project/board-items.json` showing a commit dated
after the fix.

**Identity confirmation, before any change:** establish which App ID
`secrets.RELEASE_APP_ID` corresponds to — via the App's settings page or by
minting a token and calling `GET /app`. Do not infer it from which bypass makes
the error disappear.

**Regression:** re-read `gh api repos/Shyden-Ltd/ShyTalk/rulesets/19719048`
and confirm `required_status_checks` still lists all three contexts.

**Classification:** ruleset configuration; no repository code changes. No
device/browser gauntlet surface.

## Out of Scope

- Any change to `main`'s ruleset `12613584`.
- The board's content itself, and any reconciliation of stories created during
  the 19-day window beyond what the next normal sync run does.
- Alerting on failed workflows generally — noted under Observability as a
  decision to make, not built here.

## Dependencies

- **Requires operator authorisation** to modify ruleset 19719048.
- Independent of PR #1652; `Mirror stories to Issues` is not a required check,
  so it does not block the promotion.

## Risks & Mitigations

- **Risk:** adding the wrong App as a bypass actor grants a permission that
  was never intended.
  **Mitigation:** confirm the identity from the App itself before changing
  anything; the AC makes stopping the correct outcome if it cannot be
  confirmed.
- **Risk:** the real cause is something other than the missing bypass actor,
  and adding it changes nothing.
  **Mitigation:** the 71-second correlation is strong but circumstantial. If
  the fix does not turn the workflow green, revert the grant rather than
  leaving a speculative bypass in place.
- **Risk:** the sidecar has drifted so far that the next sync creates duplicate
  issues.
  **Mitigation:** the sync's items-map query is the primary source and the
  sidecar only overlays a stale read; check the next run's output for
  unexpected creates before assuming it self-heals.

## Definition of Done

- [ ] App identity confirmed from the App, not inferred.
- [ ] Operator authorised the ruleset change.
- [ ] Ruleset 19719048 carries the correct bypass actor; the three required
      contexts are unchanged.
- [ ] `Mirror stories to Issues` green, sidecar commit landed on `develop`.
- [ ] Observability decision recorded in Notes.

## Notes

**2026-08-13** — Found while clearing blockers on PR #1652. The workflow shows
in the promotion PR's check rollup as a failure, which is how it surfaced at
all; it is not a required check, so it never blocked anything and nobody looked.

The diagnosis rests on a timestamp pair worth keeping:

```
last successful sidecar commit  7484b2dcb0a  2026-07-25 09:41:26 +07:00
develop ruleset 19719048 created              2026-07-25 09:42:43 +07:00
```

71 seconds. Every run since has failed the same way.

Deliberately **not** fixed autonomously: modifying a branch-protection ruleset
is an outward-facing permission change, and a bypass actor is a grant. The
diagnosis is complete enough that the fix should be one API call once the
operator confirms which App is which.
