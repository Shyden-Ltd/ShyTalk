/**
 * SHY-0092 — driver docstring-honesty guard.
 *
 * Two driver headers historically claimed "STUB FOR EVERY METHOD" /
 * "the current implementation is a SCAFFOLD" over code that is in fact
 * fully implemented — the inverse No-Stubs hazard (a comment lying that
 * real code is a placeholder, which misleads a pickup session into
 * "rebuilding" working drivers). Two others (devicectl/simctl) are
 * genuinely NON-CANONICAL alternatives — the canonical real-iPhone
 * native path is ios-appium-driver.js per EPIC-0003 (2026-06-13) — and
 * their headers must say so, so nobody "completes" them under No-Stubs.
 *
 * Each driver's check pairs a header-text assertion (the literal
 * artifact being corrected) with a behavioural anchor (the driver loads
 * and still registers its real method surface), so the guard cannot be
 * satisfied by gutting either the file or its header.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../../scripts/drivers');

/** Leading block comment + registry intro (first 90 lines is ample). */
function headerOf(file) {
  return fs.readFileSync(path.join(SRC, file), 'utf8').split('\n').slice(0, 90).join('\n');
}
function load(file) {
  return require(path.join(SRC, file));
}

describe('SHY-0092 driver docstring honesty', () => {
  describe('web-playwright-driver.js — real overrides, not a blanket stub', () => {
    const header = headerOf('web-playwright-driver.js');
    it('header does not falsely claim a blanket "STUB FOR EVERY METHOD"', () => {
      expect(header).not.toMatch(/STUB FOR EVERY METHOD/i);
    });
    it('header does not falsely claim methods "all return false (not implemented)"', () => {
      expect(header).not.toMatch(/all return false \(not implemented\)/i);
    });
    it('header describes the real stub-registration + override pattern', () => {
      expect(header).toMatch(/override/i);
    });
    it('behavioural anchor: still registers its real method surface', () => {
      const drv = load('web-playwright-driver.js');
      expect(typeof drv.listMethods).toBe('function');
      expect(drv.listMethods().length).toBeGreaterThan(0);
    });
  });

  describe('android-adb-driver.js — real ADB/UIAutomator driver, not a scaffold', () => {
    const header = headerOf('android-adb-driver.js');
    it('header does not falsely claim "the current implementation is a SCAFFOLD"', () => {
      expect(header).not.toMatch(/is a SCAFFOLD/i);
    });
    it('header does not falsely claim "real implementations replace stubs incrementally"', () => {
      expect(header).not.toMatch(/real implementations replace stubs incrementally/i);
    });
    it('header states it is a real / fully-implemented driver', () => {
      expect(header).toMatch(/real|fully[- ]implemented/i);
    });
    it('behavioural anchor: still registers its real method surface', () => {
      const drv = load('android-adb-driver.js');
      expect(typeof drv.listMethods).toBe('function');
      expect(drv.listMethods().length).toBeGreaterThan(0);
    });
  });

  describe('ios-devicectl-driver.js — documented non-canonical alternative', () => {
    const header = headerOf('ios-devicectl-driver.js');
    it('header marks it NON-CANONICAL', () => {
      expect(header).toMatch(/non-canonical/i);
    });
    it('header names ios-appium-driver as the canonical real-iPhone native path', () => {
      expect(header).toMatch(/ios-appium-driver/);
    });
    it('behavioural anchor: still loads + registers its method surface', () => {
      expect(load('ios-devicectl-driver.js').listMethods().length).toBeGreaterThan(0);
    });
  });

  describe('ios-simctl-driver.js — documented non-canonical alternative', () => {
    const header = headerOf('ios-simctl-driver.js');
    it('header marks it NON-CANONICAL', () => {
      expect(header).toMatch(/non-canonical/i);
    });
    it('header names ios-appium-driver as the canonical real-iPhone native path', () => {
      expect(header).toMatch(/ios-appium-driver/);
    });
    it('behavioural anchor: still loads + registers its method surface', () => {
      expect(load('ios-simctl-driver.js').listMethods().length).toBeGreaterThan(0);
    });
  });
});
