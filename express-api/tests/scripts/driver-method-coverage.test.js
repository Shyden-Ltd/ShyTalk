/**
 * SHY-0268 gap hunt — every driver method the runner CALLS must exist on a
 * driver for that platform.
 *
 * When it does not, the step does not crash: the handler's
 * `if (!ctx.uiDriver?.x) return { ok: false, error: '... not configured' }`
 * guard turns it into a per-step failure. Honest, but invisible in aggregate
 * — nothing counted how many steps could never run on a given platform, so
 * the number could grow indefinitely without any test noticing. A journey
 * that cannot execute on a platform is not covering that platform, however
 * green the corpus looks.
 *
 * `runner-driver-name-pin.test.js` pins the SHAPE of that error message; it
 * says nothing about whether the method exists. This file is the existence
 * half.
 *
 * Baselines below are measured, not aspirational. They may only shrink —
 * lower them as driver batches land (the SHY-0259 cluster is working through
 * exactly this list). NEVER raise one to make a build pass: that converts a
 * coverage regression into a silent policy change.
 *
 * No test doubles: the real driver modules are loaded through the same
 * surface-report tool operators use, so this measures shipped code.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXPRESS_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(EXPRESS_ROOT, 'scripts', 'manual-qa-runner.js');
const SURFACE_REPORT = path.join(EXPRESS_ROOT, 'scripts', 'driver-surface-report.js');

/**
 * Measured 2026-08-03. Android is the furthest along; web is the largest
 * shortfall because the Playwright driver carries assertion helpers for every
 * platform's admin flows.
 */
const MAX_MISSING = { android: 55, ios: 38, web: 90 };

function driverSurfaces() {
  const json = execFileSync(process.execPath, [SURFACE_REPORT, '--json'], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
  return JSON.parse(json);
}

/** Methods the runner invokes, split by the driver slot it invokes them on. */
function calledMethods() {
  const src = fs.readFileSync(RUNNER, 'utf8');
  const ui = new Set();
  const web = new Set();
  for (const m of src.matchAll(/ctx\.(uiDriver|webDriver)\??\.([A-Za-z0-9_]+)/g)) {
    (m[1] === 'uiDriver' ? ui : web).add(m[2]);
  }
  return { ui, web };
}

function missingByPlatform() {
  const surfaces = driverSurfaces();
  const named = (name) => new Set(surfaces.find((s) => s.name === name)?.methods || []);
  const union = (pred) => new Set(surfaces.filter((s) => pred(s.name)).flatMap((s) => s.methods));

  // A step can run on a platform if ANY driver for that platform implements
  // the method — iOS has appium (real device), devicectl and simctl variants.
  const androidDefined = named('android-adb-driver');
  const iosDefined = union((n) => n.startsWith('ios-'));
  const webDefined = union((n) => n.startsWith('web-'));

  const { ui, web } = calledMethods();
  const missing = (called, defined) => [...called].filter((m) => !defined.has(m)).sort();

  return {
    android: missing(
      [...ui].filter((m) => m.startsWith('android')),
      androidDefined,
    ),
    ios: missing(
      [...ui].filter((m) => m.startsWith('ios')),
      iosDefined,
    ),
    web: missing([...web], webDefined),
  };
}

describe('runner-called driver methods exist on a driver for that platform', () => {
  const missing = missingByPlatform();

  test('the surfaces and call sites were actually read (guard against a vacuous pass)', () => {
    const surfaces = driverSurfaces();
    expect(surfaces.length).toBeGreaterThan(8);
    expect(surfaces.some((s) => s.methods.length > 50)).toBe(true);
    const { ui, web } = calledMethods();
    expect(ui.size).toBeGreaterThan(50);
    expect(web.size).toBeGreaterThan(50);
  });

  test.each(Object.keys(MAX_MISSING))(
    '%s: unimplemented driver methods do not grow',
    (platform) => {
      expect(missing[platform].length).toBeLessThanOrEqual(MAX_MISSING[platform]);
    },
  );

  test('a method implemented on every platform is reported as missing on none', () => {
    // Anchors the comparison on a known-good method, so a bug that made the
    // "defined" set empty would fail here rather than quietly reporting the
    // whole surface as missing (and still passing the caps above).
    const all = missingByPlatform();
    expect(all.android).not.toContain('androidTapByTag');
    expect(all.ios).not.toContain('iosTapByTag');
    expect(all.web).not.toContain('webOpensTab');
  });
});
