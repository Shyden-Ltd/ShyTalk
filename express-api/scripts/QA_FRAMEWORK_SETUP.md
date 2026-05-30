# QA framework — operator one-time setup

This is the consolidated setup guide for running journey tests across the full local matrix (12 browser × device cells). Every section below is a one-time install; once done, the operator just runs:

```bash
cd express-api

# Source the persona env file (chmod-600 secrets — never inlined here).
set -a && source ~/.shytalk/dev-personas.env && set +a

# WDA_TEAM_ID is your Apple Developer team ID; see section 6 below.
export WDA_TEAM_ID=...

node scripts/manual-qa-runner.js \
  --target local \
  --plan-dir ../journey-tests \
  --journey j09-voice-room-host.feature \
  --driver all \
  --matrix
```

The runner spawns a subprocess per matrix cell, aggregates pass/fail/skip outcomes, and prints a summary table at the end. A cell that can't bootstrap (device offline, browser app missing, etc.) is recorded as **skip** — the matrix continues to the next cell rather than aborting.

---

## The 12-cell matrix

| platform       | browser          | driver module                             | local-only?        |
| -------------- | ---------------- | ----------------------------------------- | ------------------ |
| Mac desktop    | chromium         | `web-playwright-driver`                   | no (also dev/prod) |
| Mac desktop    | firefox          | `web-playwright-driver`                   | yes                |
| Mac desktop    | webkit           | `web-playwright-driver`                   | yes                |
| Mac desktop    | edge             | `web-playwright-driver` (channel: msedge) | yes                |
| Android device | Mobile Chrome    | `web-mobile-chrome-android-driver`        | no (also dev)      |
| Android device | Samsung Internet | `web-mobile-samsung-android-driver`       | yes                |
| Android device | Mobile Edge      | `web-mobile-edge-android-driver`          | yes                |
| Android device | Mobile Firefox   | `web-mobile-firefox-android-driver`       | yes                |
| iPhone         | Mobile Safari    | `web-mobile-safari-ios-driver`            | yes                |
| iPhone         | Chrome iOS       | `web-mobile-webkit-ios-driver` (chrome)   | yes                |
| iPhone         | Firefox iOS      | `web-mobile-webkit-ios-driver` (firefox)  | yes                |
| iPhone         | Edge iOS         | `web-mobile-webkit-ios-driver` (edge)     | yes                |

**Dev allowlist** (operator policy 2026-05-30): `chromium` on Mac + `mobile-chrome-android` only. The other 10 cells are local-only.

---

## 1. Local stack (Docker + Firebase Emulators + LiveKit)

Required for **all matrix cells** — the runner targets `http://localhost:8888` for the web base + Firebase Emulator suite at `localhost:4000-9000`.

```bash
# One-time install:
brew install --cask docker
npm install -g firebase-tools

# Per-session boot:
( nohup bash local/start.sh >/tmp/shytalk-stack.log 2>&1 </dev/null & )
# Tail the log until "All services ready" appears.
tail -f /tmp/shytalk-stack.log
```

Then in a second shell:

```bash
cd express-api && npm run local
```

Verify: open `http://localhost:8888` in any browser. The ShyTalk homepage should render.

---

## 2. Personas (Firebase Auth seed data)

The runner uses 17 seeded personas (P-02 … P-19) for in-screen sign-in. The persona password lives at `~/.shytalk/dev-personas.env` (chmod 600).

If the file doesn't exist locally:

```bash
node express-api/scripts/provision-test-personas.js --target local
```

Verify via `firebase emulators:start` UI → Auth tab → 17 users present.

---

## 3. Mac desktop — Playwright (chromium / firefox / webkit / edge)

```bash
# Browsers + system deps:
cd express-api
npx playwright install chromium firefox webkit
# Edge uses the system installation — install via:
brew install --cask microsoft-edge
```

No further setup. Pass `--browser chromium|firefox|webkit|edge`.

---

## 4. Android device — Mobile Chrome / Samsung / Edge

### One-time device setup

1. Enable **Developer Options** (Settings → About → tap Build Number 7×).
2. Enable **USB debugging**.
3. Plug the device into the Mac via USB.
4. The first time, the device prompts to authorise the host RSA key — tap **Allow**.

### One-time host setup

```bash
brew install --cask android-platform-tools
adb devices   # should list your device as "device", not "unauthorized"
```

### Per-browser enabling

**Mobile Chrome**:

- Open Chrome on the device → `chrome://flags` → search "Enable command line on non-rooted devices" → **Enabled**, restart Chrome.
- Alternative: Chrome → Settings → Developer Options → enable "USB Web debugging".

**Samsung Internet**:

- Open Samsung Internet → ☰ → Settings → "Useful features" → "Web Browser Developer Settings" → enable **USB Debugging of WebViews**.

**Mobile Edge**:

- Open Edge → Settings → About Microsoft Edge → tap the version 5× to surface developer mode → enable **USB Web Debugging**.

Pass `--browser mobile-chrome-android|mobile-samsung-android|mobile-edge-android`. The driver handles `adb forward` automatically.

---

## 5. Android device — Mobile Firefox (Marionette/Geckodriver)

### Geckodriver

```bash
brew install geckodriver
which geckodriver   # should resolve to /opt/homebrew/bin/geckodriver (Apple Silicon)
```

### Firefox on Android

1. Install **Firefox** from the Play Store (release channel; v113+).
2. Enable USB debugging (step 4 above).
3. In Firefox, open `about:config` → search `marionette.enabled` → set to **true** (one-time per install).

Pass `--browser mobile-firefox-android`. The driver spawns geckodriver locally; geckodriver handles the adb-side launch via `androidPackage` capability.

---

## 6. iPhone — Mobile Safari (Appium safari context)

### Appium + WebDriverAgent

```bash
npm install -g appium
appium driver install xcuitest
appium --version   # 2.x
```

### Apple Developer team ID

```bash
security find-identity -v -p codesigning | grep "Apple Development"
# Output ends with (TEAM_ID) — that's your WDA_TEAM_ID.
```

Export it in your shell rc:

```bash
export WDA_TEAM_ID=<your-team-id>
```

### iPhone pairing

1. Connect iPhone via USB once for trust + pairing.
2. Xcode → Window → Devices and Simulators → select iPhone → check **Connect via network**.
3. First Appium session installs WDA (~30-60s). The iPhone will prompt to trust the developer cert: Settings → General → VPN & Device Management → trust.

### Web Inspector

iPhone Settings → Safari → Advanced → enable **Web Inspector**. (Required for Mobile Safari + all WebKit-wrapper iOS browsers.)

### Run the Appium server

```bash
appium server -p 4723
```

Leave running. Verify:

```bash
curl -s http://localhost:4723/status | jq .
# Expected: { "value": { "ready": true, ... } }
```

Pass `--browser mobile-safari-ios`.

---

## 7. iPhone — Chrome iOS / Firefox iOS / Edge iOS (WebKit wrappers)

App Store policy requires every iOS browser to use WebKit, so these three browsers reuse the Mobile Safari Appium transport with different app bundles.

### Prerequisite

Steps 6.1-6.5 above (Appium + WDA_TEAM_ID + iPhone pairing + Web Inspector + Appium server). One-time setup.

### Per-browser

| browser     | App Store app  | bundle ID (auto-picked by the driver) |
| ----------- | -------------- | ------------------------------------- |
| Chrome iOS  | Chrome         | `com.google.chrome.ios`               |
| Firefox iOS | Firefox        | `org.mozilla.ios.Firefox`             |
| Edge iOS    | Microsoft Edge | `com.microsoft.msedge.ios`            |

Install each from the App Store; no further per-app setup. Pass `--browser mobile-chrome-ios|mobile-firefox-ios|mobile-edge-ios`.

---

## 8. Native-app drivers (Android + iOS) for end-to-end scenarios

Some journey scenarios need to drive the ShyTalk native app (sign-in via persona picker, voice room actions, etc.) in addition to the web UI.

### Android native (`--driver adb`)

Uses `android-adb-driver.js`. Prerequisites are the same as Mobile Chrome/Samsung/Edge above (USB debugging + adb on PATH). The ShyTalk app must be installed on the device:

```bash
./gradlew installLocalDebug -PlocalHost=localhost
adb reverse tcp:3000 tcp:3000   # for the local stack
```

### iOS native (`--driver appium`)

Uses `ios-appium-driver.js`. Reuses the Appium server from §6. Install the ShyTalk iOS app on the iPhone via Xcode (`Build for testing` against the `Local` scheme).

---

## 9. Running the full matrix

```bash
cd express-api
PERSONAS_PASSWORD=... \
WDA_TEAM_ID=... \
  node scripts/manual-qa-runner.js \
    --target local \
    --plan-dir ../journey-tests \
    --journey j09-voice-room-host.feature \
    --driver all \
    --matrix
```

Sample output:

```
[matrix] → dispatching chromium
[matrix] ← chromium: pass (842ms)
[matrix] → dispatching firefox
...

--------------------------+--------+----------
browser                    | outcome | ms
--------------------------+--------+----------
chromium                   | pass    |     842
firefox                    | pass    |     911
webkit                     | pass    |     995
edge                       | pass    |    1023
mobile-chrome-android      | pass    |    3201
mobile-samsung-android     | pass    |    3344
mobile-edge-android        | skip    |       0
mobile-firefox-android     | pass    |    4102
mobile-safari-ios          | pass    |    8211
mobile-chrome-ios          | pass    |    8889
mobile-firefox-ios         | pass    |    9015
mobile-edge-ios            | pass    |    9098
--------------------------+--------+----------
Matrix: 11 pass / 0 fail / 1 skip
```

A **skip** outcome means the driver couldn't bootstrap — typically the device or browser app isn't connected/installed. The matrix continues to exercise the other cells rather than aborting.

Use `--fail-fast` to abort on first **fail** (skips still continue).

---

## Troubleshooting

| symptom                                               | likely cause                                             | fix                                                               |
| ----------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `MISSING_ENV: PERSONAS_PASSWORD`                      | env var unset                                            | `source ~/.shytalk/dev-personas.env`                              |
| `--browser X not allowed for --target local`          | typo in browser slug                                     | check the matrix table above                                      |
| `no Android device attached`                          | USB cable unplugged or USB debugging not authorised      | `adb devices` to verify; replug if needed                         |
| `Android device is unauthorised`                      | RSA prompt not accepted on device                        | unlock device, replug, tap **Allow**                              |
| `no connected iPhone found via xcrun devicectl`       | iPhone not paired with Xcode                             | Xcode → Devices and Simulators → re-pair                          |
| `WDA_TEAM_ID env var is required`                     | iOS-related env var unset                                | `export WDA_TEAM_ID=<team-id>`                                    |
| `Appium /session failed (500)` with WDA install error | dev cert not trusted on iPhone                           | Settings → General → VPN & Device Management → trust              |
| `geckodriver did not become ready`                    | geckodriver not on PATH or Firefox not installed         | `brew install geckodriver`, install Firefox from Play Store       |
| `connectOverCDP failed` on Mobile Chrome              | Chrome not open on device, or USB Web debugging disabled | open Chrome, enable chrome://flags toggle                         |
| One cell perpetually skips                            | device disconnected mid-run                              | replug + re-run that cell with `--browser <slug>` (no `--matrix`) |

---

## Per-driver setup docs

Each driver also has a focused setup note. For deeper details:

- `scripts/drivers/ios-appium-setup.md` — Appium + WDA + iPhone pairing
- inline JSDoc on each driver module — failure modes + injectable deps
