# QA Framework — Troubleshooting Guide

Symptom-first reference for common failure modes when running
`manual-qa-runner.js` across the 12-cell matrix. Companion to
[`QA_FRAMEWORK_SETUP.md`](./QA_FRAMEWORK_SETUP.md) (which covers initial
setup) — this doc is for "it was working yesterday" failures.

For the runner's flag surface use `--help`. For the matrix-cell list use
`--list`. For driver-bootstrap diagnostic use `--check-drivers`.

---

## Quick triage

When ANY cell fails or hangs, run these first:

```bash
# 1. Confirm the runner's diagnostic view of every driver
node express-api/scripts/manual-qa-runner.js --check-drivers --target local

# 2. Confirm the matrix policy for your target
node express-api/scripts/manual-qa-runner.js --list --target dev

# 3. If diagnostic shows a 'skip' you didn't expect — the cell's
#    toolchain prereq is missing; see the per-cell sections below.
# 4. If diagnostic shows a 'fail' — the driver crashed at bootstrap;
#    capture the message and search this doc.
```

---

## Cell hangs forever (any platform)

**Symptom:** matrix run sits at `[matrix] → dispatching <cell>` and
never produces `← <cell>: …`. SIGINT (`Ctrl+C`) sometimes doesn't kill
the child subprocess cleanly.

**Diagnosis:**

```bash
# Find the orphan child node process
ps aux | grep manual-qa-runner | grep -v grep
```

**Fix:**

1. Pass `--cell-timeout <seconds>` on the next run (e.g. `--cell-timeout 300`).
   Cells exceeding the limit are killed with SIGTERM and reported as
   `outcome=timeout` instead of hanging the whole matrix.
2. If the hang is reproducible for a specific cell, the underlying
   driver is the culprit — read its section below.

---

## Appium-driven cells (mobile-safari-ios, mobile-{chrome,edge,firefox}-ios)

### "Cannot connect to Appium server at http://127.0.0.1:4723"

The Appium server isn't running, OR is on a non-default port.

```bash
# Check whether anything is listening on the default port
lsof -iTCP:4723 -sTCP:LISTEN

# Start Appium fresh (kills any prior daemon)
pkill -f "appium" || true
appium --base-path /wd/hub &
```

If the runner is configured for a non-default port, export
`APPIUM_BASE_URL` before invoking the runner.

### "Session not created — could not find iOS device"

Appium can't find a paired iPhone/iPad.

```bash
# 1. Confirm the device is paired and trusted
xcrun devicectl list devices | grep iPhone

# 2. Confirm the UDID is visible to instruments
instruments -s devices | grep -i iPhone
```

If the device shows here but Appium still fails, the WebDriverAgent
build is likely stale. Rebuild via Appium Inspector or:

```bash
cd ~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent
xcodebuild -workspace WebDriverAgent.xcworkspace \
  -scheme WebDriverAgentRunner \
  -destination "id=<your-udid>" \
  build-for-testing
```

### "Appium hung — session active but unresponsive"

```bash
# Force-quit any orphan sessions
curl -X GET http://127.0.0.1:4723/wd/hub/sessions \
  | jq -r '.value[].id' \
  | xargs -I {} curl -X DELETE http://127.0.0.1:4723/wd/hub/session/{}

# Restart Appium
pkill -f "appium" && appium --base-path /wd/hub &
```

---

## Android driver cells (android-adb, mobile-{chrome,edge,firefox,samsung}-android)

### "adb: device offline" OR "device unauthorized"

```bash
# 1. Replug + check daemon
adb kill-server && adb start-server
adb devices  # confirm 'device' (not 'offline' or 'unauthorized')

# 2. If 'unauthorized' — tap the RSA-key dialog on the device
#    AND check the "always trust this computer" box. The dialog
#    only appears for ~30s; reconnect if you missed it.
```

### "adb forward: cannot bind to port 9222"

Another process holds the CDP port the driver tries to forward.

```bash
# Identify + free
lsof -iTCP:9222 -sTCP:LISTEN
adb forward --list
adb forward --remove tcp:9222
```

The runner's `web-mobile-chrome-android-driver` falls back to
`pickFreePort` when 9222 is taken; if the fallback path is broken
the driver throws `EADDRINUSE` and the cell reports `outcome=fail`.

### "geckodriver: command not found" (firefox-android cell only)

```bash
# Install geckodriver (Homebrew)
brew install geckodriver

# Confirm it resolves the way the driver expects
which geckodriver  # should be on PATH; the driver also looks in
                   # /opt/homebrew/bin/ and /usr/local/bin/
```

### "edge cdp socket not found" (edge-android cell only)

Edge for Android uses a distinct CDP socket name; if the device's
Edge build is too old, the driver can't connect.

```bash
# Confirm Edge version on device
adb shell dumpsys package com.microsoft.emmx | grep versionName
# Microsoft Edge Android requires >= 119.x for the CDP socket
# the driver expects (EDGE_CDP_SOCKET in web-mobile-edge-android-driver.js).
```

Update Edge on the device via Play Store; do not modify the driver's
socket constant unless the operator pins the device to an older build.

---

## iOS native cells (ios-simctl, ios-devicectl, ios-appium)

### ios-simctl: "no booted iOS device found"

```bash
# List runtimes + devices
xcrun simctl list devices booted

# Boot the device you want the runner to target
xcrun simctl boot "iPhone 16 Pro"  # or whatever's in your Xcode

# Optional: open Simulator.app so you can watch
open -a Simulator.app
```

If the runner's `selectUdid` still returns null, the simctl regex
expects `[0-9A-F-]{36}` — confirm `xcrun simctl list devices booted`
shows a UDID in that shape (uppercase hex with hyphens).

### ios-devicectl: "Xcode 18+ required"

Apple's `devicectl` is part of Xcode 18 / macOS 26 toolchains.

```bash
xcodebuild -version  # confirm >= Xcode 18

# If on older Xcode, switch using xcode-select
sudo xcode-select -s /Applications/Xcode-18.app/Contents/Developer
```

For older systems, prefer `ios-simctl` (simulator) or `ios-appium`
(real device via XCUI) — these don't require devicectl.

---

## Playwright cells (chromium, firefox, webkit, edge)

### "browserType.launch: Executable doesn't exist"

```bash
# Reinstall browsers (run from express-api/)
npx playwright install chromium firefox webkit
npx playwright install msedge  # edge channel uses Chromium engine
```

If the install hangs at a specific browser, it's likely a corporate
proxy. Set `HTTPS_PROXY` before re-running.

### "WebKit launches but immediately crashes (ubuntu)"

Headless WebKit needs system libs not in the base ubuntu-latest image.

```bash
# Local fix
npx playwright install --with-deps webkit

# In CI: ensure the `--with-deps` flag is on the install step
# (qa-runner-driver-checks.yml already uses --with-deps).
```

### "Edge channel: msedge not found"

```bash
# macOS: install Microsoft Edge stable
brew install --cask microsoft-edge

# Linux: install via Microsoft's apt repo
# (the --with-deps flag does NOT install Edge; it must be a separate step)
```

---

## Env / credential failures

### "MISSING_ENV: PERSONAS_PASSWORD"

The runner aborts without dispatching anything. Set the env var to the
operator's test-persona password (stored at `~/.shytalk/dev-personas.env`,
chmod 600):

```bash
set -a && source ~/.shytalk/dev-personas.env && set +a
node express-api/scripts/manual-qa-runner.js --target dev --driver playwright --browser chromium
```

Discovery flags like `--help`, `--version`, `--list`, `--check-drivers`
exit BEFORE the env check — they're safe to run with no credentials.

### "MISSING_ENV: FIREBASE_DEV_API_KEY for target=dev"

Find the value in your `google-services.json` (the runner errors with
this hint). Export it before re-running.

---

## When all else fails

1. Run `--check-drivers` and pipe to a file:
   `node express-api/scripts/manual-qa-runner.js --check-drivers --target local > diag.txt 2>&1`
2. Run a single-cell matrix invocation with capture:
   `node express-api/scripts/manual-qa-runner.js --matrix --target dev --browser chromium --report-dir ./run-logs --report-format junit --report-output run.junit.xml`
3. Inspect `./run-logs/<cell>.stdout.log` and `./run-logs/<cell>.stderr.log`
   for the actual driver-level error message.
4. If the error implicates a driver bug (not your environment), open an
   issue with the diagnostic output attached.
