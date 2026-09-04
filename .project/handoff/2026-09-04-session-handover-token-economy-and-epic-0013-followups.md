# Session handover — 2026-09-04 evening (WIB)

**Operator directive this session, permanent and global:** cheaper models for
sub-agents, and compact/clear sessions more often. Applied in
`~/.claude/settings.json` (`CLAUDE_CODE_SUBAGENT_MODEL=sonnet`,
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, `autoCompactWindow: 200000`,
`showClearContextOnPlanAccept: true`), in `~/.claude/CLAUDE.md` § Token
Economy, and in memory (`feedback-subagents-forced-to-sonnet-and-autocompact-at-200k`).
Both env keys take effect from the next session start; `/autocompact` shows
the window in effect.

## Done this session

| What | Identifier | Result |
| --- | --- | --- |
| EPIC-0013 dev deploy verified | run 33852134253 on develop `90f918978cd` | all 9 jobs success; iOS TestFlight 48m44s |
| Story sync verified | run 33852049888 | success (SHY-0503..0518 cards) |
| Roadmap gap confirmed | dev `roadmap-data.json` `_meta.epicCount` 12, develop has 14 | **SHY-0519** filed (PR #2154) |
| Dependabot #2134 (fast-uri 3.1.5→3.1.7, four high alerts) | retargeted main→develop, closed + reopened, auto-merged 13:12 UTC as `01e43c5ec7d` | **SHY-0520** filed (PR #2154) to automate the class |
| Dev deploy owed by #2134 | run 33880074407 | success; every deploy leg skipped by scope detection (root lockfile only); sanity check passed |
| **SHY-0521** qs 6.15.2→6.16.0 + advisory-range test | branch `story/SHY-0521-lockfiles-outside-every-open-advisory-range`, PR #2155 | pushed at `7074a103593`; jest 530 suites / 15,315 tests green (347 s); pre-push chromium gate 1425 passed, 1 flaky (`admin-users-profile` seeded-data assertion, passed on retry), 37 skipped, 16.9 min; CI pending at handover |
| #2136 (handover of 2026-09-03) | merge attempted | **denied by the auto-mode classifier** — operator merges |

## Open, in this order

1. **Merge #2154** (docs: SHY-0519, SHY-0520, this file) — CLEAN, all checks green.
   `gh pr merge 2154 --repo Shyden-Ltd/ShyTalk --squash --delete-branch`
2. **Merge PR #2155 (SHY-0521)** once green, then deploy develop with
   notes naming it:
   `gh workflow run deploy-dev.yml --ref develop -f release-notes="Deploy from develop: SHY-0521 express-api qs 6.16.0 (GHSA-x5fp-wj9c-mxmx) + advisory-range test; last app change SHY-0289 (#2131)."`
   Scope detection will deploy the backend only.
3. **Merge #2136** (2026-09-03 handover) — CLEAN, docs only.
4. **SHY-0500 / PR #2129** — unchanged and next to pick up: evidence page
   sign-off, iPhone proof, J40 on both phones at head `d99bc187d3b`; merge
   develop in first (do NOT rebase, the branch is pushed).
5. **SHY-0520** (P1, S) then **SHY-0519** (P2, XS) — both fully refined,
   re-prove at pickup.
6. Branch cleanup one-liner (operator) — the 4 old worktrees, 2 tmp branches,
   11 remote branches from the 2026-09-04 morning list.
7. SHY-0417 `epic:` field and SHY-0376 reproduction note — blocked until
   SHY-0518 lands.

## Traps confirmed this session

- **express-api `npm test` needs the local stack UP.** With ports 9099/8080
  free the run does not fail fast: 40 minutes, 0 PASS, one suite at 1850 s,
  `MetadataLookupWarning` noise. Start `local/start.sh` detached
  (`( nohup bash local/start.sh > log 2>&1 </dev/null & )`), wait for
  `Local environment ready` (~90 s), then run the suite. The metadata warning
  also appears with the stack up and is benign.
- **Dependabot ignores `@dependabot rebase`** when the base commit has not
  changed, and a retarget alone fires no `pull_request` event. Close + reopen
  (by a user) started `PR Checks`, `Branch discipline check` and
  `Dependabot Auto-merge` within a minute.
- **Dependabot alerts are evaluated on `main`.** #74/#75/#77/#78 (fast-uri)
  and #76 (qs) stay `open` on develop until the next promotion; that is not a
  failed fix.
- **lint-staged runs `prettier --check` on every staged express-api js file**
  at commit; run `npx prettier --write` first or the commit is reverted.
- **`gh pr merge` was denied by the auto-mode classifier** in this session.
  The operator merges, or adds a `Bash(gh pr merge *)` allow rule.
- A root-lockfile-only merge makes `deploy-dev` skip every deploy leg; that is
  scope detection working, not a broken deploy.

## Not proven

- SHY-0521 on dev — it merges first, then the deploy in step 2.
- SHY-0520's reopen-by-App-token path — only the by-hand reopen is proven.

## Observed, not fixed

- Pre-push chromium gate on #2155: `tests/web/admin-users-profile.spec.ts` "shows correct seeded user data" failed once on `expect(locator).toHaveValue` and passed on retry (reported flaky). Unrelated to SHY-0521 (lockfile + jest test only). Worth a defect story if it recurs; screenshots are in `express-api/test-results/admin-users-profile-Admin--cf390-…`.
