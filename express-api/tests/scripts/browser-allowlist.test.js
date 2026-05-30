/**
 * browser-allowlist.test.js
 *
 * Pins the per-target browser matrix established by the operator
 * directive 2026-05-30: local = full coverage; dev = chromium +
 * mobile-chrome-android; prod = chromium-only. The runner imports this
 * module to enforce the matrix at CLI parse time; these tests catch any
 * regression where someone adds a browser to dev/prod without operator
 * sign-off.
 *
 * Tests cover:
 *   - DESKTOP_BROWSERS / MOBILE_BROWSERS / SUPPORTED_BROWSERS shape
 *   - TARGET_BROWSER_ALLOWLIST per-target contents (local/dev/prod)
 *   - allowedBrowsersFor known + unknown targets
 *   - isMobileBrowser positive + negative
 */

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const {
  DESKTOP_BROWSERS,
  MOBILE_BROWSERS,
  SUPPORTED_BROWSERS,
  TARGET_BROWSER_ALLOWLIST,
  allowedBrowsersFor,
  isMobileBrowser,
} = require(path.join(REPO_ROOT, 'express-api/scripts/browser-allowlist'));

describe('browser-allowlist — DESKTOP_BROWSERS', () => {
  test('includes the four Playwright desktop targets', () => {
    expect(DESKTOP_BROWSERS).toEqual(
      expect.arrayContaining(['chromium', 'firefox', 'webkit', 'edge']),
    );
  });

  test('chromium is first (default browser when --browser flag omitted)', () => {
    expect(DESKTOP_BROWSERS[0]).toBe('chromium');
  });

  test('does NOT include any mobile-* slug', () => {
    for (const b of DESKTOP_BROWSERS) {
      expect(b).not.toMatch(/^mobile-/);
    }
  });
});

describe('browser-allowlist — MOBILE_BROWSERS', () => {
  test('includes mobile-chrome-android (PR C)', () => {
    expect(MOBILE_BROWSERS).toContain('mobile-chrome-android');
  });

  test('every entry is a mobile-* slug', () => {
    for (const b of MOBILE_BROWSERS) {
      expect(b).toMatch(/^mobile-/);
    }
  });
});

describe('browser-allowlist — SUPPORTED_BROWSERS', () => {
  test('is desktop ∪ mobile', () => {
    expect(SUPPORTED_BROWSERS).toEqual([...DESKTOP_BROWSERS, ...MOBILE_BROWSERS]);
  });

  test('contains no duplicates', () => {
    expect(new Set(SUPPORTED_BROWSERS).size).toBe(SUPPORTED_BROWSERS.length);
  });
});

describe('browser-allowlist — TARGET_BROWSER_ALLOWLIST', () => {
  test('local accepts the full desktop matrix', () => {
    for (const b of DESKTOP_BROWSERS) {
      expect(TARGET_BROWSER_ALLOWLIST.local).toContain(b);
    }
  });

  test('local accepts every mobile browser', () => {
    for (const b of MOBILE_BROWSERS) {
      expect(TARGET_BROWSER_ALLOWLIST.local).toContain(b);
    }
  });

  test('dev accepts chromium + mobile-chrome-android only (operator policy 2026-05-30)', () => {
    expect(TARGET_BROWSER_ALLOWLIST.dev).toEqual(['chromium', 'mobile-chrome-android']);
  });

  test('dev REJECTS firefox / webkit / edge (no full matrix on dev)', () => {
    expect(TARGET_BROWSER_ALLOWLIST.dev).not.toContain('firefox');
    expect(TARGET_BROWSER_ALLOWLIST.dev).not.toContain('webkit');
    expect(TARGET_BROWSER_ALLOWLIST.dev).not.toContain('edge');
  });

  test('prod accepts chromium ONLY (read-only verification gate)', () => {
    expect(TARGET_BROWSER_ALLOWLIST.prod).toEqual(['chromium']);
  });

  test('prod REJECTS every mobile browser (no mobile matrix on prod)', () => {
    for (const b of MOBILE_BROWSERS) {
      expect(TARGET_BROWSER_ALLOWLIST.prod).not.toContain(b);
    }
  });

  test('exactly three targets are defined (local / dev / prod)', () => {
    expect(Object.keys(TARGET_BROWSER_ALLOWLIST).sort()).toEqual(['dev', 'local', 'prod']);
  });
});

describe('browser-allowlist — allowedBrowsersFor', () => {
  test('returns the dev allowlist for target=dev', () => {
    expect(allowedBrowsersFor('dev')).toEqual(TARGET_BROWSER_ALLOWLIST.dev);
  });

  test('returns the local allowlist for target=local', () => {
    expect(allowedBrowsersFor('local')).toEqual(TARGET_BROWSER_ALLOWLIST.local);
  });

  test('returns the prod allowlist for target=prod', () => {
    expect(allowedBrowsersFor('prod')).toEqual(TARGET_BROWSER_ALLOWLIST.prod);
  });

  test('returns an empty array for unknown target (no crash, allowlist denies all)', () => {
    expect(allowedBrowsersFor('staging')).toEqual([]);
  });

  test('returns an empty array for null/undefined target', () => {
    expect(allowedBrowsersFor(null)).toEqual([]);
    expect(allowedBrowsersFor(undefined)).toEqual([]);
  });
});

describe('browser-allowlist — isMobileBrowser', () => {
  test.each(MOBILE_BROWSERS)('returns true for mobile %s', (b) => {
    expect(isMobileBrowser(b)).toBe(true);
  });

  test.each(DESKTOP_BROWSERS)('returns false for desktop %s', (b) => {
    expect(isMobileBrowser(b)).toBe(false);
  });

  test('returns false for unknown slug', () => {
    expect(isMobileBrowser('safari-ios')).toBe(false);
    expect(isMobileBrowser('')).toBe(false);
    expect(isMobileBrowser(null)).toBe(false);
    expect(isMobileBrowser(undefined)).toBe(false);
  });
});
