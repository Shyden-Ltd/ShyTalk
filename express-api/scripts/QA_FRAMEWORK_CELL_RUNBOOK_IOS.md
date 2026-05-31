# QA Framework — Web-Mobile iOS Cell Runbook

Per-cell setup + verification + common-failures guide for the 4
web-mobile iOS cells. Closes part of gap **F1**.

Covers: `mobile-safari-ios`, `mobile-chrome-ios`,
`mobile-firefox-ios`, `mobile-edge-ios`.

**ALL FOUR iOS cells use WebKit under the hood** — Apple's App Store
policy mandates iOS browsers use the system WebKit engine. Chrome/
Firefox/Edge on iOS are UI wrappers around WebKit. The driver
distinguishes them by bundle ID for icon/window detection but the
underlying rendering is identical.

This means iOS cells are largely SIBLING tests — they verify the
WebKit code path against different browser wrappers' Safari View
Controller integration. Operator typically smoke-tests mobile-safari
first; the other 3 are confirmation that the wrapper doesn't break.

---

## Shared prerequisites

| Requirement                             | Install command                                      | Verification                                                       |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| macOS 14+ (Sonoma)                      | Apple Silicon recommended                            | `sw_vers`                                                          |
| Xcode 16+                               | App Store                                            | `xcode-select -p`                                                  |
| `idb` (iOS Device Bridge)               | `brew tap facebook/fb && brew install idb-companion` | `idb list-devices` (real device) or `idb list-targets` (simulator) |
| Real iPhone (or iOS Simulator)          | iPhone 11+ via USB cable                             | `idevice_id -l` lists UDID                                         |
| WDA_TEAM_ID env var (real devices only) | From Apple Developer account                         | `echo $WDA_TEAM_ID` non-empty                                      |
| iOS dev profile + provisioning          | Free Apple ID + Xcode signing                        | Xcode → Signing & Capabilities                                     |

---

## Cell: `mobile-safari-ios`

The canonical iOS cell. Safari is the system browser; no install needed.

### Setup

#### Real iPhone

1. Connect iPhone via USB
2. Trust the laptop when prompted on the device
3. Verify: `idevice_id -l` → UDID printed
4. Enable Safari Web Inspector: Settings → Safari → Advanced → Web
   Inspector ON
5. Ensure WDA_TEAM_ID is set and Appium can sign WebDriverAgent —
   see [ios-appium-setup.md](./drivers/ios-appium-setup.md). The
   QA-runner uses Appium + WebDriverAgent over XCUITest, NOT Apple's
   built-in `safaridriver` (which is for desktop Safari).

#### iOS Simulator (fallback)

1. `xcrun simctl boot "iPhone 15"` (or any installed simulator)
2. `xcrun simctl io booted screenshot screenshot.png` to verify

### Verification

```bash
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target dev --filter mobile-safari-ios
# Expected: outcome=ok (real device or simulator)
```

### Common failures

| Symptom                                    | Root cause                         | Fix                                                                     |
| ------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------- |
| `no connected iPhone found`                | USB disconnected OR untrusted      | Re-plug + trust dialog; `idevice_id -l`                                 |
| `WDA_TEAM_ID env var is required`          | Real device requires Xcode signing | `export WDA_TEAM_ID=$(...)`; or use Simulator                           |
| `Appium /session failed (500): xcodebuild` | XCUITest harness build failed      | `xcodebuild clean -workspace iosApp/iosApp.xcworkspace`; re-pair device |
| `no WEBVIEW_ context`                      | Safari Web Inspector OFF           | Enable: Settings → Safari → Advanced → Web Inspector                    |
| Slow first-launch (>60s)                   | WDA app build cold                 | Acceptable on first run; subsequent runs cache the WDA app              |

---

## Cell: `mobile-chrome-ios`

iOS Chrome (UI wrapper around WebKit). Uses the SAME driver as
mobile-safari but with the Chrome bundle ID.

### Setup

1. Install Chrome on the device: App Store → "Google Chrome"
2. Verify the app is installed: `xcrun devicectl device info apps --device <UDID> | grep -i chrome` (Xcode 15+), or `idb list-apps | grep -i chrome` after `idb companion --udid <UDID>` is paired

### Verification

```bash
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target dev --filter mobile-chrome-ios
```

### Common failures

| Symptom                                  | Root cause                    | Fix                                                          |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| `browser "chrome" is not supported`      | iOS Chrome not installed      | Install via App Store                                        |
| Behaves identically to mobile-safari     | Expected — same WebKit engine | Not a bug; iOS browsers MUST use WebKit per App Store policy |
| Login flow fails differently from Safari | Chrome's URL scheme handling  | Verify Chrome can open URLs without prompting                |

---

## Cell: `mobile-firefox-ios`

iOS Firefox (UI wrapper around WebKit). Same engine as Safari/Chrome
on iOS — DIFFERENT from Firefox on Android (which uses Gecko).

### Setup

1. Install Firefox: App Store → "Firefox: Private, Safe Browser"
2. Verify: `xcrun devicectl device info apps --device <UDID> | grep -i firefox` (or `idb list-apps | grep firefox` after pairing)

### Verification

```bash
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target dev --filter mobile-firefox-ios
```

### Common failures

| Symptom                                | Root cause                         | Fix                          |
| -------------------------------------- | ---------------------------------- | ---------------------------- |
| `browser "firefox" is not supported`   | Firefox not installed              | Install via App Store        |
| Different rendering vs Firefox/Android | Expected — iOS Firefox uses WebKit | Not a bug                    |
| Slower than Safari                     | Firefox's iOS wrapper overhead     | Acceptable; not a regression |

---

## Cell: `mobile-edge-ios`

iOS Edge (UI wrapper around WebKit, again).

### Setup

1. Install Edge: App Store → "Microsoft Edge"
2. Verify: `xcrun devicectl device info apps --device <UDID> | grep -i emmx` (or `idb list-apps | grep emmx` after pairing)

### Verification

```bash
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target dev --filter mobile-edge-ios
```

### Common failures

Same patterns as mobile-chrome-ios / mobile-firefox-ios. Edge's iOS
wrapper is the thinnest of the three — typically the lowest-flake
non-Safari iOS cell.

---

## Cross-cell debugging

If ALL 4 mobile-ios cells fail:

1. **No device**: `idevice_id -l` → no output → reconnect USB + trust
2. **Xcode signing**: from repo root: `xcodebuild -list -workspace iosApp/iosApp.xcworkspace` → verify schemes
3. **WDA build cache stale**: `cd iosApp && xcodebuild clean -alltargets`
4. **idb daemon hang**: `brew services restart idb-companion`
5. **Web Inspector disabled**: Settings → Safari → Advanced → Web Inspector ON
6. **macOS upgrade broke harness**: Re-pair device + reinstall WDA app
7. **Simulator alternative**: When real device flaky, fall back to
   `xcrun simctl boot "iPhone 15"` and pass `--target local`

See [QA_FRAMEWORK_TROUBLESHOOTING.md](./QA_FRAMEWORK_TROUBLESHOOTING.md)
and `ios-appium-setup.md` for further iOS-specific guidance.
