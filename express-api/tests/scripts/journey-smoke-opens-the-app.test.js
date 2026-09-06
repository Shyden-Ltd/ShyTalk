'use strict';

/**
 * SHY-0500 — the smoke journey opens the app, and that has to count.
 *
 * On the iPhone the smoke journey performs no reinstall (the app is installed
 * and pointed at this Mac by ios-local-install.sh), so its only actions are a
 * launch and a look at the sign-in screen. SHY-0457's honesty guard counted
 * neither, and failed the journey as "never touched the device" while it had
 * done exactly what a person does first: opened the app (2026-09-04). The
 * cold-start journey settled this for launches: opening the app IS using it,
 * so it is credited through `openApp`, and the smoke journey now launches the
 * same way.
 */

const fs = require('node:fs');
const path = require('node:path');

const RUNNER = path.join(__dirname, '..', '..', 'scripts', 'device-journey-runner.js');
const SRC = fs.readFileSync(RUNNER, 'utf8');

const smokeBlock = () => {
  const start = SRC.indexOf("id: 'J-SMOKE'");
  const end = SRC.indexOf('personaJourney(', start);
  if (start < 0 || end < 0) throw new Error('the smoke journey has moved — update this pin');
  return SRC.slice(start, end);
};

describe('J-SMOKE launches through openApp', () => {
  test('the pin is reading the smoke journey', () => {
    expect(smokeBlock()).toMatch(/Launch app/);
  });
  test('its launch is credited as using the product', () => {
    const block = smokeBlock();
    expect(block).toMatch(/await openApp\(device, ctx\.pkg\)/);
    expect(block).not.toMatch(/device\.launch\(ctx\.pkg\)/);
  });
});
