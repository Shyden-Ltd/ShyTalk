# iOS Appium driver — operator one-time setup

The `ios-appium-driver.js` talks to a locally-running Appium server which manages WebDriverAgent (WDA) on the physical iPhone. This doc captures the one-time setup the operator needs before `--driver appium` (or `--driver all` with `WDA_TEAM_ID` set) works.

## 1. Install Appium

```bash
npm install -g appium
appium driver install xcuitest
```

Verify:

```bash
appium --version          # 2.x
appium driver list        # xcuitest should show as installed
```

## 2. Find your Apple Developer team ID

WDA is a per-Apple-Developer-team signed binary. Appium needs your team ID at session-bootstrap so it can re-sign WDA for your iPhone.

```bash
security find-identity -v -p codesigning | grep "Apple Development"
```

Output shape:

```
  1) ABC1234567 "Apple Development: yourname@example.com (TEAM_ID_HERE)"
```

The `TEAM_ID_HERE` (10-char alphanumeric, typically inside parens) is your team ID.

Alternative: Xcode → Settings → Accounts → your Apple ID → "Manage Certificates…" → the team ID is shown in the dialog header.

Set it in your shell rc:

```bash
export WDA_TEAM_ID=YOUR_TEAM_ID
```

## 3. Pair the iPhone

Connect the iPhone via USB once for trust + pairing. After that, wireless adb-style works (Xcode handles the network bridge).

In Xcode: Window → Devices and Simulators → select your iPhone → check "Connect via network".

## 4. Trust the developer cert on the iPhone

First WDA install: iPhone → Settings → General → VPN & Device Management → trust the developer cert.

## 5. Start the Appium server

```bash
appium server -p 4723
```

Leave this running while the runner dispatches. The runner connects to `http://localhost:4723` by default; override via `APPIUM_BASE_URL` env if you run it elsewhere.

## 6. Verify

```bash
# In a separate shell while appium server is running
curl -s http://localhost:4723/status | jq .
# Expected: { "value": { "ready": true, ... } }
```

Then a runner dispatch:

```bash
cd express-api
WDA_TEAM_ID=YOUR_TEAM_ID \
  node scripts/manual-qa-runner.js \
    --target local \
    --plan-dir ../journey-tests \
    --journey j09-voice-room-host.feature \
    --driver appium
```

First dispatch will install WDA on the iPhone (~30-60s). Subsequent dispatches reuse the installed WDA bundle.

## Troubleshooting

**"WDA_TEAM_ID env var is required"** — set the env var (step 2).

**"Appium /session failed (500)" with "WDA install failed: signing identity not found"** — the `WDA_TEAM_ID` doesn't match an installed signing identity on your Mac. Re-check step 2.

**"Appium /session failed (500)" with "Unable to launch WebDriverAgent"** — the iPhone's developer cert isn't trusted. Re-do step 4.

**Session bootstrap hangs forever** — Appium installs WDA on first session (~30-60s). If it really hangs >2min, check the Appium server log for build errors.

**iPhone goes to sleep mid-test** — Xcode → Window → Devices and Simulators → uncheck/recheck "Connect via network" once to re-establish the bridge.
