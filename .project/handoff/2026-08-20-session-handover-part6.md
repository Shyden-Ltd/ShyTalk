# Session handover — 2026-08-20 (part 6)

Supersedes part 5. **Read the first two sections before doing anything** — part 5
carried a wrong diagnosis and would have sent you down the wrong path.

## ✅ Dev is UP. The P0 is closed.

| Signal | Before | After |
| --- | --- | --- |
| `/api/health` | 502 on every endpoint | **200** `{"status":"ok"}` |
| Serving SHA | `51717d167c0` | **`487ef30e636`** (the fix) |
| pm2 uptime | 1s | climbing normally |
| pm2 restarts | 42,508 and rising ~6/sec | **frozen at 42,897** |

Health gate observed passing, not assumed. `/health` 404s — the real path is
**`/api/health`**.

## 🔴 Correction: part 5's diagnosis was wrong

Part 5 said "the fix is PR #1882 (SHY-0370). Merge it, then deploy." **That would
not have restored dev.** Neither SHY-0369 (#1880) nor SHY-0370 (#1882) could ever
have caused this outage:

- Both throws are gated on `NODE_ENV === 'production'`. The dev VM has run
  `NODE_ENV=development` since **2026-05-16** (`pm2 env 0`, and `.env` mtime).
- `index.js:7` requires `middleware/auth` → `utils/firebase` → **crash**.
  SHY-0369's throw sits behind `index.js:14`, SHY-0370's later still. Never
  reached.
- The VM was already running #1880 and still crash-looping. That was the proof.

**The real cause — SHY-0371 (#1883), now merged.** firebase-admin 14 deleted the
entire namespaced root surface. The 13→14 bump (#1520) migrated `admin.apps` and
`admin.firestore` and left five more live, the first of which crashed startup:

```
TypeError: Cannot read properties of undefined (reading 'cert')
    at src/utils/firebase.js:71:49      <- admin.credential.cert(...)
```

`admin.appCheck()` in `middleware/app-check.js` was also live — a broken call on
a **security-enforcement path with zero test coverage**, because every app-check
test swaps in `__setVerifierForTests` and never runs the real body.

**Why CI was green:** the crashing line sits inside `if (serviceAccountPath)`,
and `FIREBASE_SERVICE_ACCOUNT_PATH` is set on the VM but unset in CI — dead code
in every test environment. Local `node_modules` also held firebase-admin
**13.10.0** against a lockfile saying **14.2.0**, so local runs exercised an API
production does not have.

**The lesson, now in memory:** read the server first. `pm2 logs --err` named the
cause in seconds. A fix that does not change the observed symptom means the
diagnosis is wrong — after #1880 deployed and dev stayed 502, that was the signal
to re-read the log, not to hunt for a second instance of the same theory.

## Merged / closed today

| PR | What |
| --- | --- |
| **#1883** | **SHY-0371 — the outage fix.** 6 v14 call sites, 2 mutation-proven guard tests, a path-leak fix in `admin-migrate.js` |
| #1882 | SHY-0370 — `EXPORT_DOWNLOAD_SECRET` lazy resolution (correct, but not the outage) |
| #1886 | SHY-0372..0375 filed; SHY-0142/0152 rescued |
| #1527 | **Closed** — superseded; value re-filed as SHY-0375 |

## 🎯 Work order — operator-chosen, 2026-08-20

1. **SHY-0372** — Lucky Spin latch (P1, fully root-caused)
2. **Story A** — one connection screen
3. **Story B** — non-blocking update check
4. **Story C0** — iOS real version + update gate
5. **Story C1** — admin "App Release" tab
6. **SHY-0376 / SHY-0377** — dev-link access + unreadable challenge
7. **EPIC-0004** — boot/login

Stories A and B both touch `MainActivity`'s startup block — do them
**sequentially**, not in parallel.

## Approved designs (operator-decided this session — do not relitigate)

### Story A — one connection screen · APPROVED "full"

- **Delete** `DegradedModeScreen.kt`, `degraded_mode.feature`, its step in
  `SystemScreenSteps.kt`, and `backendDegraded` / `degradedAcknowledged` in
  `MainActivity`. Keep `checkBackendHealth()` — `PreviewWatermark` uses it.
- **Extract** the Cannot Connect UI out of `SignInScreen` into a shared
  composable, used by sign-in **and** the restored-session cold start. This is
  the point: a restored session skips sign-in, so today it shows *nothing* on a
  network failure.
- **Copy:** "ShyTalk can't reach our servers. Please check your internet
  connection, and turn off any VPN you're using, then try again."
- **Degraded-but-reachable → let them straight in.** No screen. The concept is
  dropped; only "cannot reach" shows anything.
- **5 MVP locales only** (en zh id vi th). The 21 `values-*` dirs on disk are the
  retired set, not the work list.

### Story B — non-blocking update check · APPROVED "full"

- Version check becomes **fire-and-forget**; it must not gate `checkComplete`.
- **Mandatory** → non-dismissible dialog **over a blurred/dimmed app**
  (operator's choice over a full-screen wall). `DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false)`,
  no dismiss button. Delete `ForceUpdateScreen`.
- **Optional** → unchanged, keeps "Later".
- **Fix while there:** the soft dialog hardcodes an Android `Intent` + Play Store
  URL; `ForceUpdateScreen` correctly uses `platformSettings.openPlayStore(APP_BUNDLE_ID)`
  with a no-store fallback. Use the latter.

### Story C — version gating · APPROVED "C0 then C1"

**C0 must land first, or C1 is a loaded gun.**

- `IosServices.kt:40` has `override val currentVersionCode: Int = 1` — hardcoded.
  iOS also **never runs the update check at all** (`ForceUpdateScreen` and
  `updateRequired` are referenced only from Android's `MainActivity`). So
  "mandatory on Android but not iOS" is not a risk — it is today's behaviour, for
  every release.
- **C0:** iOS reports `CFBundleShortVersionString`; iOS gets the update gate;
  **gate on the semantic version, not the build code** (one shared value, so no
  platform discrepancy is possible — build numbers never need to match); CI
  asserts Android `versionName` == iOS version.
- **C1:** admin "App Release" tab following the `economy-config.js` pattern.
  Backend already supports it — `PUT /api/config/app` is admin-gated and
  `CONFIG_ALLOWED_FIELDS.app` already allows `minVersionCode`,
  `latestVersionCode`, `latestVersionName`.
  **Must refuse a minimum above what is live on both stores** (App Store review
  latency means you cannot ship simultaneously — force-updating to a build Apple
  has not approved bricks iOS with nothing to install), and **must audit-log**:
  `PUT /config/:key` currently writes no audit entry.

## Filed but not started

| Story | Pri | What |
| --- | --- | --- |
| SHY-0372 | P1 | Lucky Spin latches after **any** refused pull. `LuckySpinOverlay:631/:708` set `phase = ANIMATING` optimistically; recovery is keyed on `isPulling`, which the refusal path never changes. Insufficient-coins latches identically — fix the class. |
| SHY-0373 | P2 | Chat composer bar. Much exists already (`adjustResize`, `imePadding` at `RoomScreen:645`, icon send). Real work: extract a stable component. **Open question in the story:** DMs duplicate the whole composer (`PrivateChatScreen:897/:930`) — share it now or not? |
| SHY-0374 | P2 | `no-funfacts-backend-admin-surface.test.js` walks the working tree and scans gitignored `coverage/`. Red locally, green in CI. |
| SHY-0375 | P3 | Deduplicate the multer guard — SHY-0368 copied the block rather than extracting it, so it now exists twice. |
| SHY-0376 | P1 | The app cannot open its own environment's website. Root-caused below. |
| SHY-0377 | P3 | The 401 challenge body is `text/plain` → black on black in a dark WebView. |
| SHY-0142 | P1 | Rescued from #1527. Existed on no other ref. |
| SHY-0152 | P1 | Rescued from #1527. |

### SHY-0376 root cause (reported today)

Non-prod hostnames sit behind Basic auth (`functions/_lib/lockdown.js`). A
browser answers `WWW-Authenticate` with a native prompt; **an in-app WebView does
not** (Android needs `onReceivedHttpAuthRequest`, which we do not implement). So
the dev app is refused with no route forward. Operator's rule: **dev app → dev
site works, local → local, prod → prod, and nothing else changes.**

The operator's "black text on black background" is **not** a bug in
`cyber-bullying.html` — that page defines its own dark theme inline and is fine.
It is the unstyled `text/plain` 401 body (SHY-0377).

## ⚠️ Outstanding operator actions

1. **Two secrets are still unset on the VM** — `MFA_REMEMBER_SECRET` and
   `EXPORT_DOWNLOAD_SECRET`. Neither is an outage (dev is not production) but
   both are needed before prod. The deploy excludes `.env`, so this is an
   SSH-side edit, not a `gh secret set`.
2. **`FIREBASE_WEB_API_KEY` appears twice** in the VM's `.env`. Harmless
   last-wins today; worth tidying.
3. **#1519 — do NOT merge.** develop deliberately pins firebase-bom at 34.14.1
   until SHY-0244.

## Environment state

- **17 worktrees removed** (operator-approved). Remaining: main repo,
  `ShyTalk-0146` (unfinished iOS integrity work, pushed, no PR), and three
  no-PR scratch trees (`shy0227`, `verify`, `walk`).
- **The local stack now runs from the main repo.** It had been serving
  `ShyTalk-0147` since the previous night — 1,456 Playwright tests had been
  running against a merged, 9-hour-stale worktree. Check
  `lsof -a -p $(lsof -ti tcp:8888) -d cwd` before trusting any local result.
- **Root `node_modules` was missing entirely**, which made the pre-push hook
  report "Playwright tests FAILED" when in fact **zero tests ran**. Restored via
  `npm ci` at the repo root.
- `express-api/coverage/` (stale, from April) was moved to the session scratchpad
  because it makes SHY-0374's guard fail locally.

## Known trap in the pre-push hook

`.husky/pre-push:46` computes `CHANGED` as `git diff --name-only origin/main...HEAD`
— against **main**, not the branch's actual base. Any branch cut from develop
therefore inherits the whole unreleased backlog, so the web Playwright gate fires
even for a docs-only change. Costs ~20 minutes per push. Not yet ticketed.

## Lessons recorded to memory this session

- Clearing a dependency upgrade needs an **allowlist diff**, never a blocklist
  grep — "no removed API remains anywhere" was recorded while five call sites
  were live.
- **Stale `node_modules` lies** about the API surface; check disk vs lockfile
  before trusting a green suite or a local probe.
- **A major dep bump must boot the app** before merge; green CI does not clear it.
  Read the server first when a deployed service misbehaves.
- **The local stack can serve a different worktree** — a green gate that proves
  nothing.
- **Locale scope is 5, always.** Never derive it by counting `values-*` on disk;
  those are the retired set awaiting SHY-0194.
