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

# SHY-0295: The board sync is broken two ways — a blocked sidecar, and a Type field it cannot create

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

## Second finding: the sync tries to create a `Type` field that cannot exist

Folded in on operator instruction (2026-08-14). Separate cause, same workflow,
and it fires on EVERY run — visible in run 31739175485:

```
[gh-error] createProjectV2Field Type (exit 1):
  gh: Name cannot have a reserved value, Name has already been taken
```

Two refusals in one message, and they say different things:

- **"already been taken"** — a `Type` field exists on the board.
- **"cannot have a reserved value"** — GitHub now RESERVES the name `Type` for
  the native issue-type field, so a custom one can never be created under that
  name again.

The script cannot see the existing field because its detection is narrower
than reality. `load_project_cache` builds its field map from
`select(.dataType == "SINGLE_SELECT")` and then reads `.["Type"]`
(sync-stories-to-issues.sh:418-425) — a native issue-type field is not a
single-select, so the lookup returns empty, the script concludes the field is
absent, and `ensure_project_type_field` attempts a creation that GitHub
refuses on two independent grounds.

The auto-create dates from SHY-0067 (Defect E), when `Type` really was a
custom single-select the script had to provision. SHY-0082 v4 replaced that
with GitHub's native issue types — CLAUDE.md: _"The native issue TYPE replaces
the old `type:` label"_ — which makes this code path vestigial. It is not
failing because something is wrong with the board; it is failing because it is
solving a problem v4 removed.

It is non-fatal (the run continues and `emit`s a config-gap warning rather
than exiting), which is exactly why it has gone unread. A permanent error on
every run trains the reader to ignore the log.

**Open question this story must answer before changing code:** whether the
board still wants a `Type` COLUMN at all. CLAUDE.md lists Type among the board
columns ("Status / Pri / Effort / Type / Roadmap IDs") while also saying the
native type replaces the label. If the native field satisfies the column, the
fix is to delete the auto-create path. If a distinct column is still wanted,
it needs a name that is not reserved. Deciding that is the work; silencing the
error is not.

## Acceptance Criteria

### Happy path

- [ ] `Mirror stories to Issues` completes green, and a new
      `chore(board): sync board-items.json id-map [skip ci]` commit lands on
      `develop`.
- [ ] `.project/board-items.json` contains entries for every story created
      since 2026-07-25.
- [ ] A full sync run emits **no** `[gh-error] createProjectV2Field Type`
      line — the run is clean, not merely non-fatal.

### Error paths

- [ ] The fix adds a bypass actor; it does **not** remove or weaken
      `required_status_checks` on `develop`. Human pushes to develop stay
      gated exactly as they are today.
- [ ] If the App identity cannot be confirmed, the story stops and reports
      rather than adding `3324562` speculatively — a bypass actor is a
      permission grant, and granting the wrong one is worse than the bug.
- [ ] The `Type` error is fixed by making the script agree with reality, not
      by suppressing the message. Redirecting or swallowing the `[gh-error]`
      line fails this AC: a silenced error is the state that let it run
      unread for months.
- [ ] Board issues keep carrying their native issue type (`Bug`/`Feature`/
      `Task`). Whatever happens to the auto-create path, typing must not
      regress — that is the whole point of the v4 architecture.

### Edge cases

- [ ] The `non_fast_forward` ruleset `16058327` (target `~ALL`) is untouched.
- [ ] `load_project_cache`'s field map no longer assumes every board field is
      a `SINGLE_SELECT`; a native issue-type field is recognised for what it
      is rather than read as absent.
- [ ] `--dry-run` reports the same conclusion as a real run. Today it prints
      "would CREATE Project v2 Type field" unconditionally, which would lie
      about a board that already has one.
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

**Scenario: a clean sync run**

- **Given** a board whose `Type` is GitHub's native issue-type field
- **When** `Mirror stories to Issues` runs
- **Then** it does not attempt `createProjectV2Field` for `Type`, and no
  `[gh-error]` line appears

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

**Second finding — red, observed:** run 31739175485 emits
`[gh-error] createProjectV2Field Type (exit 1): gh: Name cannot have a
reserved value, Name has already been taken`. Reproduces every run.

**Green:** a full sync run with no `createProjectV2Field` line at all, and
board issues still carrying their native types. Verified by reading the run
log rather than by exit code — this error never changed the exit code, which
is precisely how it survived.

`express-api/tests/scripts/sync-stories-to-issues.test.js` is the home for a
structural test: the script must not attempt to create a field whose name
GitHub reserves.

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
- [ ] The `Type` auto-create path is resolved — deleted if the native field
      satisfies the column, renamed if a distinct column is still wanted — and
      the decision is written down in Notes with its reasoning.
- [ ] A sync run's log is read end to end and confirmed free of `[gh-error]`,
      not just exit-0.

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
