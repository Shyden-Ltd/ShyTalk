# Session handover — 2026-08-20 (part 5) — READ THE FIRST SECTION

Written at session end so the session can be cleared. Parts 1–4 cover earlier
work; this is the live state.

## 🔴 DEV IS DOWN. One action clears it.

**`https://dev-api.shytalk.shyden.co.uk` returns 502 on every endpoint.** The
operator's Android dev build cannot reach the backend for this reason — the app
is fine, the API is not running.

**The fix is PR #1882 (SHY-0370).** Merge it, then deploy develop to dev and
**watch the health gate pass** — do not assume.

### What happened

Two modules validated configuration with a `throw` at **module scope**:

| Module | Variable | Fixed by |
| --- | --- | --- |
| `express-api/src/utils/mfa-remember.js` | `MFA_REMEMBER_SECRET` | SHY-0369, **merged** (#1880) |
| `express-api/src/routes/data-export.js` | `EXPORT_DOWNLOAD_SECRET` | **SHY-0370, PR #1882 — NOT yet merged** |

`index.js` requires both transitively, so each throw ran **during startup**:
process exits, pm2 crash-loops, everything 502s. **Both fixes are needed**;
SHY-0369 alone did not restore dev, which is how the second one was found.

The fix in each case makes the secret resolve **lazily**. Production still
refuses the known development secret — only the timing moves, from import to
use, so the failure is scoped to the feature instead of the whole API.

### The lesson worth carrying

SHY-0369 swept for other instances with a regex, reported **none**, and I trusted
it — while a live second instance existed. A brace-counting variant gave **30
false positives**. The reliable detector is the failure itself:

```
NODE_ENV=production node -e "require('./src/index.js')"    # with no secrets set
```

That is exactly what the VM does, so it cannot be wrong about what the VM will
do. It is now a mutation-proven test:
`express-api/tests/scripts/server-entry-loads-in-production.test.js`.

## ⚠️ Operator actions outstanding

1. **Merge #1882 and deploy** (above). CI was re-running at hand-off after a
   SonarCloud `new_coverage 77.8% < 80%` fix; there were no other failures.
2. **Provision two secrets.** Neither is set in CI or on the VM:
   - `MFA_REMEMBER_SECRET` — signs the staff-portal "remember this browser"
     cookie (TOTP 2FA on `public/portal`). Unset ⇒ staff re-prompted every visit
     in production; dev silently uses a hardcoded development key.
   - `EXPORT_DOWNLOAD_SECRET` — signs GDPR data-export download links.
3. **#1527 — decide.** Everything unique to it is now merged or superseded
   except a shared `upload.js` helper and a `files: 1` upload bound.
   Recommendation: **close it**, and file that helper as its own story. A
   decision-ready comment is on the PR.
4. **#1519 — do NOT merge.** develop deliberately pins firebase-bom at 34.14.1
   until SHY-0244; 34.15.0 pulls a push-architecture migration that fails under
   `-Werror`. Left open on purpose (the pin's own note says dependabot was
   deliberately not set to ignore it). Full explanation commented on the PR.

## SHY-0146 — implemented, blocked on its own AC

Branch `story/SHY-0146-ios-integrity-detection`, **pushed, no PR**. The operator
asked for it to be finished; it is not.

**Built and verified:** `DeviceIntegrity.kt` (commonMain) with 12 passing JVM
tests; `IosDeviceSecurityChecker.kt` (iosMain) with lenient probes;
`bypassIntegrityGate` threaded Swift → Koin → `BuildVariant` (4 new
AppEnvironment tests, 5 new BuildVariant tests, 102 total); gate wired into
`IosApp()` above every branch; iOS + Android compile clean under `-Werror`;
ktlint clean.

**Why a separate flag:** the two gates differ on `.dev` (it ENFORCES auth checks
but must BYPASS the integrity gate for Simulator QA), and it cannot be derived
from `environment` because **`.release` resolves `environment == "dev"`** — that
shortcut would silently disable the gate on the only shipping variant.

**Blocked on:** the AC requires "on the iOS Simulator with a prod build →
blocked". Two routes, both obstructed:
1. `:shared:iosSimulatorArm64Test` — **fails to link on clean develop too**
   (`ld: framework 'FirebaseCore' not found`). Pre-existing; the Gradle test
   binary has no CocoaPods framework search paths, and those only exist inside
   Xcode's derived data per configuration. Its own infra story.
2. A Release-configuration simulator build. Plain Release ran >1hr; a
   `-Onone` Release build then failed with `Cannot query the value of this
   provider because it has no value available` — a Gradle/Xcode interaction from
   combining Release with `KOTLIN_FRAMEWORK_BUILD_TYPE=debug`. **Next thing to
   try: `KOTLIN_FRAMEWORK_BUILD_TYPE=release` with `-Onone`.**

Also: SHY-0146's own Why and AC are **partly stale** — they ask it to replace the
hard-coded `bypassDeviceChecks`, which SHY-0151 already did and device-proved.
Rewrite those when finishing.

## Session totals

**20 PRs merged.** Highlights: SHY-0151 device-proven on the real iPhone (device
lock + ban screen, both legs, all reversed); SHY-0145 fun-facts pipeline
decommissioned (16 surfaces, not the 5 the AC named); SHY-0358 CLAUDE.md removed;
SHY-0362 `develop` was failing ktlint; SHY-0365 a test that asserted nothing;
SHY-0368 uploads returning 500 HTML; firebase-admin 13→14.

Tickets filed and not started: SHY-0360, 0361, 0364, 0367.
