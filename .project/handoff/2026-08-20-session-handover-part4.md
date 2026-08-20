# Session handover — 2026-08-20 (part 4, overnight)

Everything below happened while the operator slept, under the standing
authorities (merge on green, deploy dev after every merge, attempt device work).

## ⚠️ READ FIRST — dev was DOWN, fix is in flight

**Dev API returned 502 on every endpoint.** Root cause found and fixed in
**#1880 (SHY-0369, P0)**; it needs to merge and deploy.

`express-api/src/utils/mfa-remember.js` (added by SHY-0147, #1853) threw **at
module load** when `MFA_REMEMBER_SECRET` was unset under `NODE_ENV=production`.
The chain `index.js:14 → routes/portal.js:16 → mfa-remember.js` means that throw
happened **during server startup** — the process exited, pm2 crash-looped, every
endpoint 502'd.

The guard is right; its **blast radius** was wrong. The fix makes the secret
resolve lazily, so production still refuses the dev fallback but the failure is
scoped to the MFA-remember calls instead of the whole API.

**The firebase-admin 13→14 bump was the first suspect and was cleared** —
`package.json` and the lockfile agree at 14.x, and no removed namespace API
remains anywhere.

### ⚠️ OPERATOR ACTION STILL NEEDED

**`MFA_REMEMBER_SECRET` is not set in CI or on the dev VM.** It appears in no
workflow. Until it is provisioned, "remember this browser" fails closed in
production and uses the development secret on dev. #1880 stops that being an
outage; it does **not** supply the secret.

## Merged overnight (5, total 14 for the session)

| PR | Story |
| --- | --- |
| #1846 | SHY-0144 — retire the FunFact splash (unblocked SHY-0145) |
| #1582 | **SHY-0151 — iOS device checks, DEVICE-PROVEN on the real iPhone** |
| #1853 | SHY-0147 — portal MFA-remember (your CodeQL dismissal unblocked it) |
| #1520 | firebase-admin 13→14, including the `local/seed.js` migration CI proved |
| #1877 | SHY-0368 — oversized uploads returned 500 HTML instead of 413 |
| #1873 | files SHY-0367 |

## Open PRs

| PR | State |
| --- | --- |
| **#1880** | **SHY-0369 P0** — the outage fix. Merge and deploy first. |
| **#1878** | SHY-0145 — fun-facts pipeline decommissioned. In CI. |
| #1527 | Triaged with a decision-ready comment: most of it is now merged or superseded; the only unique content left is a shared `upload.js` helper + a `files: 1` bound. **Close or land that slice — your call.** |
| #1519 | **Do not merge.** develop deliberately pins firebase-bom at 34.14.1 until SHY-0244; 34.15.0 pulls a push-architecture migration and fails under `-Werror`. Commented in full; left open because the pin's own note says dependabot was deliberately not set to ignore it. |

## SHY-0146 — started, NOT finished

The last EPIC-0004 child. Branch `story/SHY-0146-ios-integrity-detection`,
**not pushed**. What exists:

- `DeviceIntegrity.kt` (commonMain) — the pure decision: jailbreak paths,
  sandbox-escape probe, Simulator env keys, and the gate. **12 unit tests, all
  passing on the JVM**, because a jailbroken iPhone is a device nobody has.
- `IosDeviceSecurityChecker.kt` (iosMain) — the real probes, every one lenient
  on error so a transient filesystem failure never blocks a legitimate device.
- `bypassIntegrityGate` threaded Swift → Koin → `BuildVariant`, with **5 new
  BuildVariant tests** and **4 new AppEnvironment tests**.
- Gate wired into `IosApp()` above every other branch.
- iOS + Android compile clean under `-Werror`; ktlint clean.

**Why a separate flag from `bypassDeviceChecks`:** they differ on `.dev`, which
ENFORCES the auth checks but must BYPASS the integrity gate so QA can use the
Simulator. And it cannot be derived from `environment` — **`.release` resolves
`environment == "dev"`**, so an `environment != "prod"` shortcut would have
silently disabled the gate on the only variant that ships.

**Remaining:** a Release-configuration simulator build to prove the gate blocks
the Simulator (running when this was written), then story/PR.

**Also:** SHY-0146's Why and AC are partly stale — they ask this story to replace
the hard-coded `bypassDeviceChecks`, which **SHY-0151 already did**. Rewrite that
before finishing.

## Other findings

- **`SHY-INDEX.md` is 31 stories behind**; operator chose to generate it as part
  of SHY-0360.
- **The pre-merge gate cannot merge a note added to a Draft story** (the Draft
  exemption is add-only). Findings for Draft stories must go in the EPIC table or
  a handover. #1874 and #1876 were closed for this rather than faking a status.
- **The apt-mirror outage** failed three gates including a re-run; SHY-0367
  (#1873) is filed, with a comment weighing caching vs a Playwright container.
- **develop's Android app was smoke-tested on the OnePlus** after the merges:
  builds, launches, legal gate, routes to sign-in, no crashes, correct dev API.
- **Fun-facts export**: dev's collection is **empty**, verified via two different
  query shapes. Sidecar README at `~/.shytalk/`. **Production deliberately not
  touched.**
