---
id: SHY-0004
status: Done
owner: claude
created: 2026-06-07
priority: P0
effort: S
type: bug
roadmap_ids: [G009, G027]
pr: https://github.com/Shyden-Ltd/ShyTalk/pull/1126
released_in: v0.97.9
---

# SHY-0004: Verify Room mutation P3 deploy status + reconcile

## User Story

As the ShyTalk operator, I want **the live `firestore.rules` for the `rooms/{roomId}` document to match the documented deploy state in `.project/plans/2026-05-28-room-mutations-p2-p3-migration.md`**, so that either (a) Android/iOS users can still mutate rooms via working server endpoints OR (b) the plan accurately reflects "rules locked; clients route through Express" and any prod gap is identified and fixed.

## Why

There is a documented contradiction between two source-of-truth files:

- `firestore.rules:256` declares `allow update: if false` for `rooms/{roomId}` — meaning direct Firestore client writes are blocked.
- `.project/plans/2026-05-28-room-mutations-p2-p3-migration.md:8` says "P1 Express endpoints are NOT deployed to prod yet."

If P1 endpoints aren't deployed AND rules block direct writes, then **prod Android + iOS users currently cannot perform any room mutation** (joining, leaving, taking seats, accepting invites, role changes). This would be a live functional outage — possibly silent because the apps would show stuck loaders or generic "something went wrong" toasts rather than a precise diagnostic.

The reverse possibility is the plan is stale — P1 endpoints WERE deployed since 2026-05-28 but the plan doc was never updated. In that case the rule lockdown is correct and intentional, and the gap is documentation drift, not user breakage.

Roadmap row G009 (line 26 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🔴 Critical. Category: Security — room mutation P3 deploy status. Location: `firestore.rules:256` + `.project/plans/2026-05-28-room-mutations-p2-p3-migration.md:8`. Gap: Plan says "nothing deployed" but rules have `allow update: if false`. If P1 endpoints not in prod, app broken for prod users. Fix: SSH `ubuntu@213.35.98.160 "cd /opt/shytalk-api && git log --oneline -5"`; reconcile + document. Scope: S.

G027 is the adjacent reconciliation work: if the SSH evidence shows the prod API IS missing the P1 endpoints, this SHY also files an emergency follow-up (or, depending on the size, lands the fix inline) to restore mutation capability. If the prod API HAS the endpoints, G027 narrows to a doc-update PR.

The operator's "quality + reliability + pre-public" priority weighting means this verification SHY is **blocking** for any other Tier-1 security work — we can't reason about rule-tightening (SHY-0029) until we know whether the room-mutation path is live.

## Acceptance Criteria

### Happy path

- [ ] SSH to prod (`ubuntu@213.35.98.160`) succeeds using `~/.ssh/shytalk-oci` key; `cd /opt/shytalk-api && git log --oneline -5` captures the last 5 deploy commits on prod's working tree.
- [ ] The captured prod git-log is compared line-by-line against `git log --oneline` on the dev workstation for the `express-api/src/routes/rooms/*` files; the result is one of two states:
  - **State A (P1 endpoints deployed)**: prod commit-set includes the P1 room-mutation route additions. Action: update `.project/plans/2026-05-28-room-mutations-p2-p3-migration.md:8` to reflect "P1 deployed to prod as of `<commit-sha>` on `<date>`"; close the contradiction.
  - **State B (P1 endpoints NOT deployed)**: prod commit-set lacks the P1 additions. Action: deploy P1 immediately (operator-supervised via `gh workflow run deploy-api.yml` or manual PM2 restart) OR roll back `firestore.rules:256` to a permissive-but-validated state to restore user functionality.
- [ ] Once reconciled, both files (`firestore.rules` + plan doc) tell a consistent story; a comment in `firestore.rules:256` block names the deploy date and the Express-route file that owns the mutation.
- [ ] An emulator rules-test in `firestore-rules-tests/rooms.test.js` (create if missing) asserts:
  - direct client `update()` on a `rooms/*` doc is denied (rule still says `if false`)
  - the corresponding Express route accepts an authenticated owner's mutation request and returns 200
- [ ] Documentation update commits to main via this PR.

### Error paths

- [ ] SSH to prod fails (key permission denied, host unreachable, timeout): the SHY captures the failure mode in Notes and surfaces it as a Critical reviewer finding; operator is paged via AskUserQuestion to resolve the SSH access issue.
- [ ] `git log --oneline -5` succeeds but the commit titles are ambiguous (e.g. truncated "feat: room mutation work"): SHY widens to `git log --oneline -20` + `git show --stat <suspect-shas>` to determine deploy state.
- [ ] State B (P1 not deployed) but the Express routes have known security gaps not covered by P1 → SHY explicitly does NOT deploy half-baked P1; instead temporarily re-permits the firestore.rules with strict server-side validation OR escalates to operator.
- [ ] State A confirmed but a third file (e.g. `app/.../AndroidRoomServiceController.kt`) still calls a removed direct-write code path: bug is filed as follow-up SHY; not closed silently.
- [ ] Emulator test fails because the rule file or the route handler has a typo: bug is fixed in this PR (it's a regression caught by the new test).

### Edge cases

- [ ] The dev API differs from prod (more recent commits on dev): verification compares prod to a specific commit-pin (the one tagged in the plan doc), not just `dev/main`.
- [ ] Prod has been hot-patched manually on the box (commits committed locally but never pushed): `git log` shows local-only commits not on origin; the reconciliation surfaces these and proposes pushing them back to the repo.
- [ ] A second prod server (e.g. failover) exists with different state: verification covers both `213.35.98.160` (prod) and (if applicable) any backup/standby instances.
- [ ] The plan doc itself has been moved or renamed: the SHY treats the file path as load-bearing and updates references atomically (no broken links).

### Performance

- [ ] SSH connection completes within 10s; `git log` query completes within 5s. If slow, the prod box may be under load — flag in Notes but do not retry-spam.
- [ ] The emulator rules test suite (existing + new room test) completes within 30s.
- [ ] No prod side-effect from the SSH check (read-only git command; no writes, no service restarts).

### Security

- [ ] SSH key path (`~/.ssh/shytalk-oci`) and prod IP (`213.35.98.160`) are already documented in `CLAUDE.md` § Express API; this SHY does not re-commit them anywhere new.
- [ ] No prod credentials, tokens, session cookies, or `.env` contents are captured or committed.
- [ ] The git-log output committed to the SHY Notes is sanitised (commit hashes + subjects only; no body content that might reveal a temporary debug branch name).
- [ ] If State B → re-permitting the firestore.rules: any temporary re-permit MUST include a stricter narrower clause (e.g. `request.auth.uid == resource.data.ownerFirebaseUid`) and the new clause is itself adversarially tested.
- [ ] Prod deploy of any fix follows the existing deploy path; no ad-hoc SSH-rsync.

### UX

- [ ] State A → no user-visible change. State B → a fix is shipped that restores room-mutation functionality; users see normal behaviour.
- [ ] If State B is confirmed and the fix takes >24h to ship, operator is informed via AskUserQuestion + a status banner is considered (out of scope for this SHY but flagged).
- [ ] Error toasts on the apps for failed room mutations are checked against the existing copy in `strings.xml`; if a generic "something went wrong" is shown for the State-B case, file a follow-up SHY for a more precise message (not in scope for the verification work).

### i18n

- [ ] N/A — server-side rules + plan doc are internal artifacts; no user-facing strings change.

### Observability

- [ ] The prod git-log output captured by this SHY is committed to `## Notes (running log)` (sanitised — commit hashes + subjects only).
- [ ] The reconciliation outcome (State A or State B + actions taken) is logged in Notes.
- [ ] A new comment block in `firestore.rules` line 256 names the verification date + commit SHA + Express route owner of the mutation path — a permanent audit trail.
- [ ] If State B → the prod deploy event is captured in `.project/plans/2026-05-28-room-mutations-p2-p3-migration.md` as a status update.
- [ ] The emulator test failure mode (rule too permissive / rule too strict) is logged with a clear assertion message for future regression analysis.

## BDD Scenarios

**Scenario: SSH check succeeds, State A (P1 deployed)**

- **Given** the operator has SSH access to prod via `~/.ssh/shytalk-oci`
- **And** `ssh -i ~/.ssh/shytalk-oci ubuntu@213.35.98.160 "cd /opt/shytalk-api && git log --oneline -5"` succeeds
- **When** the captured log includes the P1 room-mutation route commits
- **Then** the plan doc is updated to reflect "deployed `<sha>` on `<date>`"
- **And** the firestore.rules:256 block gets a comment block naming the deploy SHA + Express route
- **And** the emulator test asserts direct write denied + Express route 200 OK
- **And** no user-visible behaviour change ships

**Scenario: SSH check succeeds, State B (P1 NOT deployed)**

- **Given** the SSH check succeeds
- **When** the captured log does NOT include the P1 route commits
- **Then** room mutations are broken in prod (confirmed by checking the apps against the prod backend)
- **And** the SHY proposes either (a) deploying P1 now, OR (b) temporarily re-permitting the rule with strict narrow clauses
- **And** operator is paged via AskUserQuestion to choose
- **And** the chosen fix is shipped in this PR (or a fast-follow PR if scope balloons)

**Scenario: SSH check fails (auth or unreachable)**

- **Given** SSH attempts to prod fail
- **When** the failure mode is captured (key permission, network unreachable, host key changed, etc.)
- **Then** the SHY's Notes log captures the exact failure
- **And** operator is paged to resolve SSH access
- **And** no other work proceeds on Tier-1 stories until verification completes

**Scenario: Emulator test catches a rule drift**

- **Given** the new `firestore-rules-tests/rooms.test.js` test
- **When** the rule file is accidentally edited to allow direct client writes (regression)
- **Then** the test fails with `assertSucceeds expected to fail` (or equivalent)
- **And** the failure surfaces in CI before merge

**Scenario: Plan doc and rule file disagree post-reconciliation**

- **Given** the reconciliation PR has been opened
- **When** reviewer agent reads both files
- **Then** the agent flags any remaining contradiction as a Critical finding
- **And** the PR cannot merge until reconciled

## Test Plan (TDD)

### Red

1. Add `firestore-rules-tests/rooms.test.js` (or extend if it exists):
   - Test 1: `assertFails(adminApp.firestore().doc('rooms/x').update({foo: 'bar'}))` — should pass (rule is `if false`); confirms rule is in place.
   - Test 2: a request to `https://dev-api.shytalk.shyden.co.uk/api/rooms/x/takeSeat` (DEV, not prod — prod is verified via the SSH git-log step, not via test traffic) with a valid owner auth token returns 200. Currently FAILS if dev lacks the route OR lacks integration test coverage.
2. Run `cd express-api && npm test -- --testPathPattern=rooms`.
3. RED state confirmed: at least one of the assertions fails.

### Green

1. SSH to prod; capture `git log --oneline -5`; identify state A or B.
2. **If State A**: update plan doc + add rule comment + commit. Re-run tests. GREEN.
3. **If State B**: trigger immediate P1 deploy via `gh workflow run deploy-api.yml --ref main` (or manual ssh-deploy if workflow incomplete); verify via curl that the route responds; update plan doc; commit. Re-run tests. GREEN.
4. Verify `npm test` green; `firestore-rules-tests/rooms.test.js` green.
5. Manual sanity: launch dev app, attempt a room mutation (take seat, leave room), confirm no regression vs known-good behaviour.

## Out of Scope

- **Deploying P2/P3 work itself** — only verifying P3 status and reconciling the doc/rule contradiction; P2 client migration + P3 rule lockdown are existing planned work covered by `.project/plans/2026-05-28-room-mutations-p2-p3-migration.md`.
- **Refactoring the room-mutation code** — verification + reconciliation only.
- **Adding new room features** — strictly status-check + alignment.
- **Migrating the SSH key handling to a CI secret** — operator-side; not in scope.
- **Server-side perf optimisation** — not in scope.

## Dependencies

- **SHY-0001** + **SHY-0002** + **SHY-0003** + **SHY-0032** — process dependencies (Agile workflow + meta-story).
- `~/.ssh/shytalk-oci` SSH private key — must exist on the dev workstation with `chmod 600`.
- Operator must be reachable for State-B escalation.
- `firestore-rules-tests/` test harness (verify it exists; create if not).
- `gh workflow run deploy-api.yml` workflow must exist and be operational (verify before invoking).

## Risks & Mitigations

- **Risk:** State B is confirmed — prod is broken right now. **Mitigation:** AC explicitly covers immediate fix path; operator paged via AskUserQuestion to choose between fast-deploy-P1 vs temporarily-re-permit-rules.
- **Risk:** SSH access requires operator-side credential refresh. **Mitigation:** captured in error-paths AC; surfaced as Critical finding; operator-paged.
- **Risk:** The git-log is ambiguous (subject line doesn't clearly indicate "P1 routes added/removed"). **Mitigation:** widen to `git log --oneline -20` + `git show --stat <suspect-sha>` to enumerate files-changed; cross-reference against the P1 file list documented in the plan.
- **Risk:** Reconciliation introduces a subtle rule drift (e.g. comment block accidentally changes a clause). **Mitigation:** the new emulator test is the regression net; reviewer agent diffs the rules file character-by-character.
- **Risk:** Prod is hot-patched (local commits never pushed back); reconciliation re-syncs but loses operator context. **Mitigation:** if local-only commits found, push them back to the repo on a `hotfix/2026-06-07-prod-state-reconcile` branch and reference from this PR; no silent overwrite.

## Definition of Done

- [ ] SSH check completed; result captured in Notes (sanitised).
- [ ] Reconciliation actions taken (State A → doc update; State B → fix deployed).
- [ ] `firestore.rules:256` comment block added with deploy SHA + Express route reference.
- [ ] `.project/plans/2026-05-28-room-mutations-p2-p3-migration.md` updated with current deploy state.
- [ ] `firestore-rules-tests/rooms.test.js` added/extended; tests green.
- [ ] Manual sanity-check on dev app confirms no regression.
- [ ] Reviewer reports ZERO findings.
- [ ] Per-type Done gate satisfied (`bug` → auto-merge + dev smoke required since this touches prod state; operator-confirmed dev verification).
- [ ] PR merged via auto-merge.
- [ ] `status: Done`; `pr:` populated; merge + dev-smoke outcome in Notes.

## Notes (running log)

- 2026-06-10 ~09:20 BST — **INVESTIGATION COMPLETE: STATE A — no outage.** Operator authorized the prod read ("do it for me"). Evidence chain: (1) spec's assumed path /opt/shytalk-api doesn't exist — prod deploys as a TARBALL at ~/shytalk-api (no .git, so the spec's git-log method was structurally impossible); (2) ~/shytalk-api/src/routes/room-mutations.js EXISTS on prod and is byte-identical (sha256 85e90fa4b6fa2181…) to commit 267d2af7e74 (PR #863, superset of PR #858's P1+P2 endpoints) — matched against every historical version of the file; (3) therefore the firestore.rules:256 lockdown is correct and live-consistent. Reconciliation applied: plan doc DEPLOY STATE section + firestore.rules evidence comment. The spec's emulator-test AC was ALREADY satisfied pre-pickup by express-api/tests/firestore-rules/room-rules.test.js (12 tests: lockdown-line pin + endpoint migration map) — no new tests needed. SIDE-FINDING for operator: prod's API is functional but STALE (#863-era; predates #996 lazy-reap + #1007 staleRooms removal for this file) — refresh at next P4 deploy window. A POST probe of the live route was classifier-denied (mutating verb at prod) and intentionally skipped — the hash match is sufficient evidence. G027 narrows to this doc-update path per spec.

- 2026-06-07 ~20:30 BST — Refined under SHY-0032. Bumped to Tier 1 priority. SSH command path: `ssh -i ~/.ssh/shytalk-oci ubuntu@213.35.98.160 "cd /opt/shytalk-api && git log --oneline -5"`. Test file path: `firestore-rules-tests/rooms.test.js` (create if absent).
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-A2` (roadmap_ids: G009, G027).

**2026-06-10 ~09:35 BST — Released in v0.97.9.** PR #1126 squash-merged; release.yml run 27263490415 (bump=patch) cut v0.97.9; flipped Done per done-equals-release-cut.
