'use strict';

/**
 * SHY-0500 — the Appium the gauntlet starts must serve the Android driver.
 *
 * `40-ios.sh` starts the one Appium server both phones share. Started from a
 * shell without ANDROID_HOME, every UiAutomator2 session was refused with
 * "Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was
 * exported", and the journey runner fell back to `uiautomator dump` — 2.3s a
 * read instead of 65ms, 85% of a run, and too coarse to see what a cold start
 * drew first (2026-09-04, run 2). The iOS prep script is where the server is
 * born, so it is where the Android SDK must be named.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'gauntlet', '40-ios.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
const code = SRC.split('\n').filter((l) => !/^\s*#/.test(l));

describe('40-ios.sh starts Appium with the Android SDK named', () => {
  test('the script still starts Appium, so the pin is reading the right file', () => {
    expect(code.some((l) => /nohup appium --port/.test(l))).toBe(true);
  });

  test('ANDROID_HOME is exported before Appium starts, defaulting to the SDK Android Studio installs', () => {
    const exportAt = code.findIndex((l) =>
      /export ANDROID_HOME="\$\{ANDROID_HOME:-\$HOME\/Library\/Android\/sdk\}"/.test(l),
    );
    const appiumAt = code.findIndex((l) => /nohup appium --port/.test(l));
    expect(exportAt).toBeGreaterThanOrEqual(0);
    expect(exportAt).toBeLessThan(appiumAt);
  });
});
