# Session handoff — 2026-08-19 (part 3, final)

Continues `-part2.md`. Durable state; do not rely on scrollback.

## Merged to develop today (12)

#1803 SHY-0346 · #1810 SHY-0349 · #1809 SHY-0342 · #1815 SHY-0352 ·
#1816 SHY-0353 · #1819 SHY-0354 · #1808 SHY-0348 · #1807 SHY-0350 ·
#1823 SHY-0355 · #1416 SHY-0092 · #1812 SHY-0351 · **#1780 SHY-0310 (SDUI)**

## Done this stretch, as instructed

- **#1673 REBUILT → #1826**, and #1673 **closed** with the reason on the PR.
  The rebuild works because it was measured, not assumed: the original's **107
  Playwright spec files apply to current develop with `git apply --check`
  returning 0**. Only `manual-qa-runner.js` was contested (47 *semantic*
  conflicts against SHY-0330's `!== true` guard), and the runner is not where
  the sleeps were. **228 → 119 `waitForTimeout`, SHY-0330 untouched.**
  Landed as a **ratchet, not a strict gate** — 209 waits across 37 files remain
  (93 in `tests/web/suggestions-board.spec.ts`), and their shape is
  `click(); sleep(500); await x.count()`, so replacing them blind trades a sleep
  for a flake. New sleeps now fail immediately; the debt may only shrink.
  Story is **In Progress**, not In Review — its AC asks for zero.
- **#1696** — fixed the real failure behind it: develop's SHY-0348 added a
  string to every locale, so SHY-0271's deliberate count pin (838) went stale
  and failed both `test-backend` and SonarCloud on a PR that had been green.
  Bumped to 839 with the reason inline. Backend suite **14311 passing**;
  `compileKotlinIosArm64`, `jvmTest`, `ktlint`, `detekt` all exit 0.

## Open PRs — exact state and next action

| PR | State | Next action |
| --- | --- | --- |
| **#1800** SHY-0338 | reviewed, device-proven both platforms, marker current | CI re-running after the marker bump. Gate from the **main** worktree, then merge. |
| **#1651** SHY-0226 | reviewed + marker recorded | CI re-running. Gate from `ShyTalk-cifix`, then merge. |
| **#1582** SHY-0151 | conflicts resolved + verified, marker current | CI re-running. Gate from `ShyTalk-shy0151-wt`, then merge. Its edit to the **Done** story SHY-0170 was dropped deliberately — the gate refuses terminal stories, and the information already lives in SHY-0151. |
| **#1696** SHY-0275 bundle | locale pin fixed | Playwright failed on `Install system dependencies` (the package mirror). **Re-run it.** Operator has approved merging despite three unchecked device DoD items. |
| **#1826** SHY-0245 | new, CI running | The rebuild. Review + merge. |
| **#1527** SHY-0152/0142 | conflicts resolved | CI. Watch for `PR Gate=fail` that is really a stale Sonar/apt run. |
| **#1520** firebase-admin 14 | **migration complete, suite green** | Needs an operator eye: a major SDK bump. Lock resolves to **14.2.0**, not the 14.1.0 in the title. |
| **#1519** firebase-bom | DIRTY | Dependabot never answered `@dependabot rebase`. Needs the same manual treatment as #1520. |

## What #1520 actually required (do not re-derive)

firebase-admin 14 removes the **whole namespaced surface**. The bump alone took
the suite from green to **41 failed suites**. Three removals, each only visible
after fixing the one before:

```
admin.apps                 -> getApps()      from firebase-admin/app
admin.firestore()          -> getFirestore() from firebase-admin/firestore
admin.auth()               -> getAuth()      from firebase-admin/auth
admin.database()           -> getDatabase()  from firebase-admin/database
admin.messaging()          -> getMessaging() from firebase-admin/messaging
admin.firestore.FieldValue -> FieldValue     from firebase-admin/firestore
```

Eight production sites across five files, two more in `manual-qa-runner.js` that
only surfaced later, and **two unit tests whose mocks asserted the shape the SDK
no longer has** — they would have stayed green while production threw. Now
**14239 passing**.

## Traps that recur (each cost time today)

- **`Reviewed-up-to`**: the gate reads the **FIRST** marker in a story, so two
  markers means it measures against the older. Merging develop into a branch
  invalidates every marker on it; bundles have one per story.
- **Run the gate from the PR's OWN worktree** or it reads another branch entirely.
- **`Install system dependencies`** fails on the package mirror roughly every
  other Playwright run. Re-run manually; **never** add an auto-retry.
- **Unquoted heredocs execute backticks** — one ran a real `git merge` from
  inside prose today. Always `<<'EOF'`.
- **`git checkout --` reverts to HEAD**, so it discards an applied-but-uncommitted
  patch along with whatever you meant to undo. Revert probes by text edit.
- **The gauntlet cannot run from a worktree** (`lib.sh` tests `-d "$REPO/.git"`,
  a FILE in a worktree). Ten `50-matrix` tests fail from any worktree and pass
  from the main clone — not real failures.
