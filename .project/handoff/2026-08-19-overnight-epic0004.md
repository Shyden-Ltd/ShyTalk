# Overnight session — 2026-08-19 into 2026-08-20

Durable state. Do not rely on scrollback.

## Operator instructions received this session (in order, later ones WIN)

1. **EPIC-0004 (boot/login) is the priority** — "the biggest win for the future tickets".
2. Ordering **corrected within the hour**: *"just do it first then rework the open PRs"*, and
   explicitly **not in parallel**. EPIC-0004 outranks the PR queue.
3. **Relationships feature removed from the roadmap entirely** — "I want to avoid this app
   from being used specifically for dating". Scope confirmed as **"1 and 3"**: the roadmap
   card AND a codebase sweep of anything already built.
4. Merge authority (AFK window only): merge everything **except SHY-0143**; #1520/#1519 may
   merge on green CI; fun-facts collection **export-then-delete authorised**;
   simulator permitted **only** for SHY-0146 integrity detection, Android too, shut it down after.

## Merged to develop (5 this session)

#1651 SHY-0226 · #1800 SHY-0338 · #1826 SHY-0245 · #1696 SHY-0275 · #1847 SHY-0148

Deploy-To-Dev dispatched after each merge batch.

## Open PRs — exact state and next action

| PR | State | Next action |
| --- | --- | --- |
| **#1846** SHY-0144 splash retirement | device-proven on real OnePlus; 3 ratchet baselines regenerated | CI re-running after the last baseline fix. Gate from `ShyTalk-0144`, then merge. |
| **#1853** SHY-0147 portal MFA-remember | complete, 14422 backend passing | CI running. Gate from `ShyTalk-0147`, then merge. **Deploy note: the CORS change and the portal client change must ship together.** |
| **#1854** SHY-0356 Playwright deps scoping | complete, mutation-proven | CI running. Gate from `ShyTalk-0356`, then merge. Fixes the mirror timeout that blocked 4 runs tonight. |
| **#1582** SHY-0151 | CI CLEAN but **self-held** | Operator approved: **device-prove increment 1 on the iPhone** (persona X binds the device → persona Y is device-locked; a banned persona sees the ban screen), then merge. NOT yet done. |
| **#1527** SHY-0152/0142 | stale | needs a look |
| **#1520** firebase-admin 14 | migration done | **merge on green CI** (operator-authorised) |
| **#1519** firebase-bom | DIRTY | same treatment as #1520 |

## EPIC-0004 — TRUE state (the epic file's "Status: Draft" list is STALE)

- **SHY-0143** — already **MERGED** as #1752 on 2026-08-16. The epic still lists it Draft.
- **SHY-0144** — done, PR #1846.
- **SHY-0145** — **NOT started.** Gated on #1846 merging (it removes the consumer first).
  Export-then-delete is authorised; export goes to `~/.shytalk/funfacts-export-<date>.json`,
  chmod 600, verify it round-trips BEFORE deleting.
- **SHY-0146** — **NOT started.** Needs an iOS Simulator runtime installed (they were deleted
  from this machine on 2026-07-15). Operator authorised the simulator FOR THIS STORY ONLY.
- **SHY-0147** — done, PR #1853.
- **SHY-0148** — done, MERGED as #1847.

**Update the epic's child-status table when picking this up** — it misled me for a while.

## Findings worth keeping

- **SHY-0147's premise was stale.** The portal already had a 24h MFA window via the Firebase
  custom claims `totpVerified`/`totpVerifiedAt`. The real defect was that those claims are
  **per-USER**, so verifying in one browser skipped the prompt everywhere.
- **SHY-0148's fix already existed, unused.** SHY-0279 added `authStateKnown` precisely to
  fix the flash; the shared header simply never read it.
- **#1826 was a stale-branch transplant.** The rebuild took 107 spec files wholesale from a
  months-old branch; 75 had never contained a sleep, and 8 more asserted product shapes that
  had since moved. Reduced to the ratchet + 16 verified conversions. The rest is SHY-0357.
- **The mirror timeout is now fixed** by #1854, not merely re-run.

## Traps hit tonight (all now in memory)

- A **partial local stack** produces false reds: empty `express-api/node_modules` (a merge
  deleted a `node_modules` **symlink**, and every POST 500'd), MinIO/Mailpit not running
  (3 admin specs failed), missing Playwright browser binaries (112 failures, then firefox
  and webkit all-red).
- **A fresh worktree has none of the gitignored prerequisites**: `local.properties`,
  `app/src/dev/google-services.json`, `public/admin/config.js`, `node_modules`, browsers.
- **Deleting code makes ratchet baselines STALE** — three separate ratchets refused on
  SHY-0144 (no-test-sleeps, no-stubs, no-direct-backend). Each has a `--generate-baseline`.
- **Inline suppression markers must share the line** — `// sleep-ok:` one line above
  suppresses nothing, silently.
- **Client and server changes must run together locally** — 8 portal tests failed purely
  because the running Express was the main clone's code without the CORS change.

## Not started

- **Relationships removal** (roadmap card at `public/roadmap-data.json` `phases[2].features[1]`,
  hand-curated array so a direct edit is safe, 20 locales inside the entry) **plus the
  codebase sweep** the operator asked for.
- **#1582 iOS device proof.**
- **SHY-0145**, **SHY-0146**.
- **SHY-0357** — the 312 remaining test sleeps and the vacuous-assertion problem in
  `suggestions-board.spec.ts` (142 tests, 163 assertions, **112 behind `if (…count() > 0)`
  guards**, some nested two deep). Story not yet filed.
