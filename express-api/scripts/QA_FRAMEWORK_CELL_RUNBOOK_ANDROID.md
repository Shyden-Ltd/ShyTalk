# QA Framework — Web-Mobile Android Cell Runbook

Per-cell setup + verification + common-failures guide for the 4
web-mobile Android cells. Closes part of gap **F1**.

Covers: `mobile-chrome-android`, `mobile-samsung-android`,
`mobile-edge-android`, `mobile-firefox-android`.

All 4 use real (or emulated) Android devices, NOT browser emulation.
Playwright connects to the real browser on the device via Chrome
DevTools Protocol (CDP) or geckodriver (Firefox).

---

## Shared prerequisites

| Requirement                      | Install command                                                                       | Verification                                           |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `adb`                            | macOS: `brew install android-platform-tools` <br> Ubuntu: `sudo apt install adb`      | `adb version` → 1.0.41+                                |
| Android device (or AVD emulator) | Physical device + USB cable, OR `~/Library/Android/sdk/emulator/emulator -avd <name>` | `adb devices -l` lists the device                      |
| USB Debugging enabled on device  | Settings → Developer Options → USB debugging                                          | `adb devices` shows `device` (not `unauthorized`)      |
| Browser app installed on device  | See per-cell sections                                                                 | `adb shell pm list packages <pkg>` returns the package |

---

## Cell: `mobile-chrome-android`

### Setup

```bash
# Install Chrome on the device (Play Store) OR use the pre-installed
# Chrome (most Android devices ship with it).
adb shell pm list packages com.android.chrome
# Expected: package:com.android.chrome
```

Enable remote debugging in Chrome on Android:

1. Open Chrome on device
2. chrome://flags → "Remote Debugging" → Enabled
3. Restart Chrome
4. Settings → Privacy → "Remote Debugging" → enabled

### Verification

```bash
# Tunnel device port 9222 to laptop
adb forward tcp:9222 localabstract:chrome_devtools_remote

# Run the smoke check
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target local --filter mobile-chrome-android
# Expected: outcome=ok
```

### Common failures

| Symptom                                          | Root cause                             | Fix                                                         |
| ------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------- |
| `connectOverCDP failed at http://localhost:9222` | Forward not set up                     | `adb forward tcp:9222 localabstract:chrome_devtools_remote` |
| `0 contexts` returned                            | Chrome not running on device           | Open Chrome on device manually first                        |
| `no Android device attached`                     | USB cable issue / unauthorized device  | `adb kill-server && adb start-server && adb devices`        |
| Auth UI doesn't load                             | Persona-picker route requires Firebase | Use `--target dev` (not local) unless emulators running     |

---

## Cell: `mobile-samsung-android`

Samsung Internet browser (Samsung Galaxy devices).

### Setup

Samsung Internet is pre-installed on Samsung Galaxy devices. For
other Android devices, install from the Play Store.

**Mandatory setup step (often missed):** In Samsung Internet itself,
enable "USB Debugging of WebViews":

1. Open Samsung Internet on the device
2. Menu → Settings → Useful features → Web Browser Developer Settings
3. Toggle "USB Debugging of WebViews" ON

Without this toggle, CDP returns 0 contexts even with the correct
abstract socket forward. This is the #1 cause of "0 contexts" errors
in this cell.

### Verification

```bash
adb forward tcp:9223 localabstract:com.sec.android.app.sbrowser_devtools_remote
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target local --filter mobile-samsung-android
```

### Common failures

| Symptom                          | Root cause                                             | Fix                                                                                  |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `connectOverCDP failed`          | Samsung Internet's DevTools port differs from Chrome's | Verify abstract socket name; may need `com.sec.android.app.sbrowser_devtools_remote` |
| Samsung Internet not installed   | Non-Samsung device                                     | Run only on Samsung Galaxy devices; skip cell otherwise                              |
| Auto-updates break compatibility | Samsung Internet updated to incompatible CDP version   | Pin Samsung Internet version; or skip cell when issue surfaces                       |

---

## Cell: `mobile-edge-android`

Microsoft Edge for Android (Chromium-based, similar to mobile-chrome).

### Setup

Install Edge from Play Store:

```bash
# Manual install via Play Store on device. Verify:
adb shell pm list packages com.microsoft.emmx
# Expected: package:com.microsoft.emmx
```

### Verification

```bash
adb forward tcp:9224 localabstract:com.microsoft.emmx_devtools_remote
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target local --filter mobile-edge-android
```

### Common failures

Same patterns as `mobile-chrome-android`. Edge's DevTools abstract
socket name is `com.microsoft.emmx_devtools_remote`.

---

## Cell: `mobile-firefox-android`

Firefox for Android (Gecko engine — different code path from CDP).

### Setup

**Important:** Stable Firefox from the Play Store
(`org.mozilla.firefox`) does NOT expose `about:config` to end users
and does NOT have Marionette enabled. The Marionette setup below
applies only to **Firefox Nightly** (`org.mozilla.fenix`) or
**Firefox Beta** (`org.mozilla.firefox_beta`).

Install Firefox Nightly from Play Store:

```bash
adb shell pm list packages org.mozilla.fenix
# Or Beta: org.mozilla.firefox_beta
```

Enable Marionette (Nightly/Beta only):

1. Open Firefox Nightly on device
2. about:config → `marionette.enabled` → true
3. Restart Firefox

### Verification

```bash
# Marionette uses port 2828 by default
adb forward tcp:2828 tcp:2828
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target local --filter mobile-firefox-android
```

### Common failures

| Symptom                                                 | Root cause                                   | Fix                                                     |
| ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------- |
| `geckodriver /session failed (500): Connection refused` | Marionette not enabled / Firefox not running | Enable marionette.enabled in about:config; open Firefox |
| `[mobile-firefox-android-driver] webUiDump failed`      | No device attached OR Firefox not installed  | `adb devices` + verify package                          |
| Marionette session timeout                              | Firefox version mismatch with geckodriver    | Update geckodriver: `brew upgrade geckodriver`          |

---

## Cross-cell debugging

If ALL 4 mobile-android cells fail:

1. **No device**: `adb devices -l` → no output → reconnect USB
2. **Unauthorized device**: `adb devices` shows `unauthorized` → tap "Allow" on device popup
3. **adb daemon hang**: `adb kill-server && adb start-server`
4. **Port collision**: `lsof -i :9222` → kill any zombie process
5. **Battery saver / Doze**: keep device awake (Settings → Stay awake while charging)

See [QA_FRAMEWORK_TROUBLESHOOTING.md](./QA_FRAMEWORK_TROUBLESHOOTING.md)
for more.
