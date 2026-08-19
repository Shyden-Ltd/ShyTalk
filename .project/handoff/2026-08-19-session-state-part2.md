# Session handoff — 2026-08-19 (part 2)

Continues `2026-08-19-session-state.md`. Durable state; do not rely on scrollback.

## Merged to develop today (11)

#1803 SHY-0346 · #1810 SHY-0349 · #1809 SHY-0342 · #1815 SHY-0352 ·
#1816 SHY-0353 · #1819 SHY-0354 · #1808 SHY-0348 · #1807 SHY-0350 ·
#1823 SHY-0355 · #1416 SHY-0092 · #1812 SHY-0351

## Open PRs — exact state

| PR | State | What is left |
| --- | --- | --- |
| **#1800** SHY-0338 | reviewed, device-proven both platforms, marker current | waiting on CI only. Gate then merge. |
| **#1527** SHY-0152/0142 | conflicts RESOLVED + pushed | develop's version-agnostic pin-tests were taken over this branch's frozen-SHA ones (SHY-0162 fixed that deliberately); index rows added. Waiting on CI. |
| **#1651** SHY-0226 | develop merged + `harden-apt` added to dependabot.yml | develop had added `.github/actions/harden-apt` without listing it, and THIS story's own exhaustiveness test caught it. Waiting on CI. |
| **#1582** SHY-0151 | 4 conflicts RESOLVED + pushed | all additive (bypassDeviceChecks vs the SHY-0205 build-identity fields). Verified: iosArm64 compile, jvmTest, ktlint, detekt all exit 0. |
| **#1780** SHY-0310 SDUI | conflicts resolved, marked READY | 22 files, all under `.project/` — pure docs. Waiting on CI. |
| **#1696** SHY-0275 bundle | CI green, markers fixed | **NOT merged deliberately** — see below. |
| **#1520** firebase-admin 14 | **migration done, suite green** | see below. |
| **#1519** firebase-bom | DIRTY | Dependabot did not answer `@dependabot rebase`; needs the same manual treatment as #1520. |
| **#1673** SHY-0245 | **recommend REBUILD, not merge** | see below. |

## The three that need an operator decision

1. **#1696 (SHY-0275 bundle)** — CI is green and all four story markers are
   current, but **three of its four stories have UNCHECKED device DoD items**,
   including SHY-0272's mic-mute walk, which is a P0 safety control with a
   backend change (`room-mutations.js`). A dev deploy of that branch was
   dispatched (run `32231927204`) so the walks are possible. **Not merged on
   green CI alone.**

2. **#1673 (SHY-0245, eradicate test sleeps)** — 217 ahead / 38 behind; merging
   gives 17 conflicted files, **47 of them in `manual-qa-runner.js` alone**, and
   they are *semantic*: this branch refactored the runner's call sites behind an
   `appMethod` indirection while develop landed SHY-0330's `!== true` guard at
   the same sites. Taking this branch's side silently reintroduces the SHY-0330
   bug; taking develop's discards the refactor. **Recommendation recorded on the
   story: rebuild onto current develop rather than merge.**

3. **#1520 firebase-admin 13 → 14** — the bump alone breaks the backend
   (41 failed suites). firebase-admin 14 removes the whole namespaced surface.
   **Migrated and now green (14239 passing)**: `admin.apps` → `getApps()`,
   `admin.firestore()/auth()/database()/messaging()` → the modular `getX()`,
   `admin.firestore.FieldValue` → `FieldValue` from `firebase-admin/firestore`.
   Eight production sites across five files, plus two in `manual-qa-runner.js`
   that only surfaced after the earlier fixes, plus two unit tests whose mocks
   asserted the shape the SDK no longer has. **Worth an operator eye because a
   major SDK bump is not a routine merge**, and because the lock resolves to
   **14.2.0**, not the 14.1.0 in the PR title.

## Recurring traps (all cost real time today)

- **`Reviewed-up-to` markers**: the gate reads the **FIRST** marker in a story, so
  a story with two is measured against the older one. Merging develop into a
  branch invalidates every marker on it — bundles have one per story.
- **The pre-merge gate is worktree-sensitive**: run it from the PR's OWN worktree
  or it reads the wrong branch's stories entirely.
- **SonarCloud** was cancelling at exactly 15 minutes and failing PR Gate on a
  green board. Fixed by SHY-0355 (budget now 30, pinned by a test).
- **`Install system dependencies`** fails on the package mirror every other
  Playwright run. Re-run manually; do NOT add an auto-retry.
- **Unquoted heredocs execute backticks** — one ran a real `git merge` from
  inside prose today. Always `<<'EOF'`.
- **The gauntlet cannot run from a worktree** (`lib.sh` tests `-d "$REPO/.git"`,
  which is a FILE in a worktree). Ten `50-matrix` tests fail from any worktree
  and pass from the main clone — they are not real failures.

## Nothing is stranded on this machine

Checked every worktree for unpushed commits and uncommitted changes:

- **Preserved:** `story/SHY-0227-heal-stale-rules-contract-specs` held **one
  unpushed commit dated 2026-07-21** — a month old and existing nowhere but this
  laptop (Firestore-rules contract specs + a tautological-assertion removal, 250
  lines). **Pushed to origin** so it survives. It has no open PR; it is a
  candidate for the queue once the current one clears.
- **Superseded, left alone:** `tmp/verify-0348-0350` carries 7 unpushed commits
  that are SHY-0350's work, now merged properly via #1807. `tmp/walk-0338…` has
  one dirty `users.js` that *reverses* SHY-0338 while adding SHY-0350 — a stale
  cross-branch experiment, both halves since merged correctly. Neither was
  discarded; both are simply not needed.
- Every branch carrying today's work is pushed and clean.
