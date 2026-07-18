# ShyTalk Gauntlet Scripts

One command from a **freshly switched-on machine** to a fully running local
stack with the journey matrix dispatched — plus modular scripts for each
phase so you can run any step on its own.

```
express-api/scripts/gauntlet/
├── gauntlet.sh      ← the ONE command (orchestrates everything below)
├── 00-prereqs.sh    read-only audit: tools, secrets, devices (changes nothing)
├── 10-services.sh   Docker Desktop → port sweep → local stack → health checks
├── 20-reseed.sh     (re)seed emulator data + personas, PROVE sign-in works
├── 30-android.sh    pick device (wireless first), tunnels, wake, install/reset
├── 40-ios.sh        iPhone probe + Appium server (never touches WDA signing)
├── 50-matrix.sh     detached journey-matrix launch / status / stop / results
├── 90-stop.sh       full teardown, kill-by-port, verify everything freed
└── lib.sh           shared helpers (sourced by all of the above)
```

## Quick start (cold boot)

```bash
# Machine just switched on, nothing running:
bash express-api/scripts/gauntlet/gauntlet.sh
```

That runs: prereqs audit → Docker Desktop + full local stack (emulators,
LiveKit, MinIO, Mailpit, Express API, static web on :8888) → seed + verify →
Android device prep (best-effort) → dispatches the journey matrix detached.

Long unattended run? Detach the whole thing (survives closing the terminal,
keeps the Mac awake via `caffeinate`):

```bash
bash express-api/scripts/gauntlet/gauntlet.sh --detach --frameworks --ios
tail -f /tmp/shytalk-gauntlet/latest/gauntlet.log
```

## Common invocations

| Goal                                          | Command                                                         |
| --------------------------------------------- | --------------------------------------------------------------- |
| Full cold-boot + matrix (web + Android cells) | `gauntlet.sh`                                                   |
| Everything incl. iOS cells + framework suites | `gauntlet.sh --detach --frameworks --ios`                       |
| Bring services up, no tests                   | `gauntlet.sh --no-matrix`                                       |
| Nuke and restart a wedged stack               | `gauntlet.sh --fresh --no-matrix`                               |
| Fresh app state on the phone                  | `gauntlet.sh --install-apk --reset-app`                         |
| Full pre-merge protocol locally               | `gauntlet.sh --detach --fresh --frameworks --ios --android-bdd` |
| Just reseed after a Jest run                  | `bash 20-reseed.sh`                                             |
| Just check what's missing on this machine     | `bash 00-prereqs.sh`                                            |
| Tear everything down                          | `bash 90-stop.sh`                                               |

`gauntlet.sh --help` prints every flag.

## The matrix run (50-matrix.sh)

The journey matrix is launched **fully detached** (`nohup` + `disown` +
DONE/FAIL sentinel files) so nothing depends on your terminal staying open:

```bash
bash 50-matrix.sh launch local          # or: launch dev
bash 50-matrix.sh status                # PID, sentinel, log tail
bash 50-matrix.sh results               # matrix-report.json summary
bash 50-matrix.sh stop                  # SIGTERM (SIGKILL after 5s)
bash 50-matrix.sh list                  # all runs
```

Runs live under `/tmp/shytalk-gauntlet/matrix-<runId>/` with `log`, `pid`,
`report/`, and exactly one of `DONE`/`FAIL` when finished.
`launch` aborts early (instead of burning hours of cell timeouts) when the
stack is down, seeding fails, or no physical iPhone is visible to
`xcrun devicectl` — pass `--skip-ios-check` for a deliberately iOS-less run.

## Prerequisites (checked by 00-prereqs.sh)

- **Tools:** node (CI-pinned major), Java 21+, Docker Desktop, `firebase-tools`,
  `adb`, and for iOS cells: `appium`, `libimobiledevice`, Xcode CLTs.
- **Secrets:** `~/.shytalk/dev-personas.env` (PERSONAS_PASSWORD +
  `FIREBASE_LOCAL_API_KEY`/`FIREBASE_DEV_API_KEY`); for `--target dev` also
  `~/.shytalk/firebase-admin-dev.json`.
- **Devices:** a real Android phone (wireless adb preferred; accept the RSA
  prompt if `adb devices` says `unauthorized`) and, for iOS cells, a real
  iPhone visible to `xcrun devicectl list devices`.

## Ordering rules the scripts enforce (do not bypass)

1. **Jest and Playwright never share an emulator state:** the express Jest
   suite wipes emulator users/Auth, so `--frameworks` reseeds between Jest
   and every web suite, and `50-matrix.sh launch` reseeds before dispatch.
2. **Personas are seeded with the `localdev123` password** (forced) — the
   `.local` app flavour bakes that password into its persona picker. If
   `20-reseed.sh` dies with INVALID_PASSWORD, a stray dev `PERSONAS_PASSWORD`
   export leaked into the seed; the script guards against this itself.
3. **Kill by port, never `pkill -f`** — `pkill -f` has killed the caller's
   own waiters before. `lib.sh kill_port` kills listeners by port + verifies.
4. **WDA signing is never touched.** If an iOS run fails with
   "Timed out enabling automation mode" (code 65) while automation is already
   on, that's the stale-WDA jam. The deliberate manual fix:
   `xcrun devicectl device uninstall app --device <UDID> com.shyden.WebDriverAgentRunner.xctrunner`,
   restart Appium, and re-run with `IOS_FORCE_NEW_WDA=true`.
5. **The Mac must not sleep mid-run** — sleep kills the static-web server and
   the tail of the run drowns in phantom `CONNECTION_REFUSED` failures.
   `gauntlet.sh` holds `caffeinate` for its whole lifetime (attached and
   detached); standalone long commands should be wrapped the same way.

## Troubleshooting

| Symptom                                       | Cause → fix                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docker compose up` bind failure on UDP 52xxx | Random app squatting LiveKit's RTC range → `10-services.sh` sweeps it automatically                                   |
| start.sh aborts on occupied ports             | Orphans from a crashed run → `10-services.sh` sweeps, or `90-stop.sh` first                                           |
| Every persona sign-in 400 INVALID_PASSWORD    | Wrong seeded password → `bash 20-reseed.sh` (it forces + verifies `localdev123`)                                      |
| Mass `CONNECTION_REFUSED` late in a run       | :8888 server died (fd limit or sleep) → check `10-services.sh` brought it up; never run unattended without caffeinate |
| `adb devices` shows `unauthorized`            | Accept the RSA prompt on the phone screen                                                                             |
| Android journeys see the clock/keyguard       | Phone locked → `30-android.sh` wakes + stay-on; disable any secure lock for runs                                      |
| iOS cells all fail to attach                  | iPhone not visible to devicectl (cable/unlock/Developer Mode), or the WDA jam above                                   |

## Environment knobs

| Variable       | Default                            | Meaning                                 |
| -------------- | ---------------------------------- | --------------------------------------- |
| `SHYTALK_REPO` | auto-detected from script location | repo checkout the scripts operate on    |
| `GAUNTLET_TMP` | `/tmp/shytalk-gauntlet`            | where run artifacts/logs/sentinels live |
