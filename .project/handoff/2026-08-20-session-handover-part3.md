# Session handover — 2026-08-20 (part 3)

Continues part 2. Written while the operator sleeps; work continued autonomously
under the standing authorities (merge on green, deploy dev after every merge).

## Merged to develop this session (9)

| PR | Story |
| --- | --- |
| #1856 | SHY-0358 — remove CLAUDE.md (+ the two dangling reads the audit missed) |
| #1859 | files SHY-0360, SHY-0361 |
| #1860 | **SHY-0362 — `develop` itself was failing ktlint**, blocking every app-touching PR |
| #1861 | SHY-0363 — last Gradle 10 deprecation removed |
| #1865 | files SHY-0364 + handover part 2 |
| #1868 | SHY-0365 — a test that asserted nothing, + a mutation-proven guard |
| #1869 | SHY-0366 — EPIC-0004's status table |
| #1858 | **SHY-0359 — the Relationships feature is gone** |
| #1873 | files SHY-0367 |

## SHY-0151 — increment 1 is DEVICE-PROVEN (the headline)

Walked on Sean's iPhone Air (iOS 27.0) against **dev**, with a `Debug-Dev` build
of the branch. Full detail is in the story's Notes; the short version:

- **Device-lock blocks a second persona.** Bound to UID `10000013`, P-02
  (`50000010`) was refused — *"Account Restricted"*, control tagged
  `signIn_deviceLockedOk`, overlay still `UID: —`.
- **The controlled comparison:** after clearing bindings, the **same** persona
  signed in cleanly. Only the binding changed, so the block was the device-lock.
- **Ban screen:** suspending P-02 **auto-cascaded into a device ban**; relaunch
  showed `ban_device` — *"Auto-applied: user suspended"*. That is the SHY-0149
  ban-application path working on iOS.
- **All reversed.** Unsuspended, ban lifted, app reaches `sign_in`, bindings
  cleared, `GET /api/ban-status/50000010` → "Not found".

**#1582 is ready to merge once CI greens.** The story carries the proof.

## Open PRs — exact next action

| PR | State | Next action |
| --- | --- | --- |
| **#1582** SHY-0151 | device-proven, CI green-pending | Gate from `ShyTalk-shy0151-wt`, merge. |
| **#1853** SHY-0147 | CodeQL alert 55 **dismissed by the operator**; CodeQL now passes | Gate from `ShyTalk-0147`, merge. |
| **#1520** firebase-admin 14 | `local/seed.js` migration fixed (see below) | Gate, merge on green (authorised). |
| **#1846** SHY-0144 | **BLOCKED BY INFRASTRUCTURE, not by the change** — see below | Re-run when the apt mirror recovers. |
| **#1519** firebase-bom | **127 commits behind**; dependabot refuses to rebase ("edited by someone other than Dependabot") | Merge develop in by hand. develop is still on 34.14.1, so the bump is still valid. |
| #1527 | 7 weeks stale, 21 behind, 449 insertions | Its most valuable line (the un-awaited assertion) was extracted as SHY-0365 and merged. Decide: revalidate or close. |

## The apt-mirror outage — do not mistake it for a test failure

The Azure apt mirror was degraded all evening at roughly **40 KB/s**. It failed
**three** gates:

- `Dev Sanity Check` (deploy `32289832760`) — timed out at 6 min
- `playwright-web / Playwright (chromium)` on #1846 — timed out at 15 min
- the **same job re-run on a fresh runner** — timed out at 15 min again

A re-run does **not** clear it. #1846 is a splash retirement with no relation to
browser setup and simply cannot go green while the mirror is down. **SHY-0367**
(#1873) is filed for the missing third leg: SHY-0334 bounded stalls, SHY-0356
scoped the package set, but every run still re-fetches unchanging packages.

## Findings worth keeping

- **`develop` was red and nobody knew.** Two unused `FieldPath` imports from
  SHY-0338. The lint job is gated on `app_changed` and merged branches do not
  re-run PR checks, so it surfaced on the *next* PR — #1853, which contains no
  Kotlin at all. **A failure the diff cannot explain means checking the base.**
- **Renaming does NOT clear CodeQL alert 55.** Three names flagged identically;
  the second rename was made this session, disproved, and reverted. The
  declaration carries a `DO NOT RENAME THIS TO CHASE THE CODEQL ALERT` block.
  The operator dismissed the alert; CodeQL now passes on #1853.
- **The firebase-admin 14 migration missed one file.** `local/seed.js` — the one
  file *outside* `express-api/` importing the same package, so a sweep scoped to
  the dependency's directory never saw it. Fixing the reported line alone would
  not have been enough: on 14.2.0 `admin.apps`, `admin.firestore`, `admin.auth`,
  `admin.database` and `admin.messaging` are **all** `undefined`; only
  `initializeApp` survives. Verified by running the seeder the way CI does.
- **The iOS persona picker fails closed, invisibly.** Without
  `DEV_QA_PERSONAS_PASSWORD` passed to `xcodebuild`, the button renders and taps
  do nothing. Correct security behaviour, no feedback. Pass it and verify with
  `plutil -extract DevQaPersonasPassword raw <app>/Info.plist`.
- **SHY-0146 is NOT blocked.** The iOS 27.0 simulator runtime is installed
  (7.8 GB, Ready); only simulator *devices* are missing and `xcrun simctl create`
  makes one in seconds.

## Operator decisions recorded this session

- New standing rules in `~/.claude/CLAUDE.md`: learn from everything (especially
  negative), industry standards + fix dirty code on sight, never merge to `main`
  directly, deploy dev after every merge, tester build notes must name the last
  ticket, board changes must reach both roadmap pages autonomously.
- Anti-dating guardrail in the project `CLAUDE.md`.
- Slogan copy chosen: **"Learn languages. Share cultures."** (SHY-0364), gated
  behind **SHY-0289** (retire the 15 non-MVP locales) — which is still `Draft`
  and never started. 21 locale directories still exist.
- `SHY-INDEX.md` to be **generated**, not backfilled — folded into SHY-0360.

## State of the phone

Sean's iPhone is running the **`Debug-Dev`** build (1.0/1), not TestFlight.
Reinstallable from TestFlight whenever wanted. No ban, no device binding.
