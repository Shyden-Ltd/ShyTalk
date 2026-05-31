/**
 * driver-screenshot-helper.test.js
 *
 * Tests the shared screenshot helpers (gap C3 — per-cell screenshot
 * capture on failure). Covers:
 *   - takeScreenshotForPages — Playwright-based drivers
 *   - takeScreenshotViaAppium — Appium-based iOS drivers
 *   - Best-effort: falsy outputDir / sessionId returns []
 *   - One persona's failure doesn't block the others
 *   - File naming: `screenshot-<slug>-<persona>.png`
 *   - Directory creation (recursive mkdir)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HELPER_PATH = path.join(REPO_ROOT, 'scripts/drivers/driver-screenshot-helper.js');

const { takeScreenshotForPages, takeScreenshotViaAppium } = require(HELPER_PATH);

// Non-http scheme placeholder for tests — Appium's real base URL is
// http://localhost:4723 but linting flags clear-text protocols, and our
// fetchImpl is a jest.fn() that doesn't validate scheme. The endpoint
// assertion still pins the path shape via `${base}/session/<sid>/screenshot`.
const MOCK_APPIUM_BASE = 'mock://appium';

function tmpDir(suffix) {
  return path.join(os.tmpdir(), `qa-screenshot-${process.pid}-${Date.now()}-${suffix}`);
}

function cleanup(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ── takeScreenshotForPages ─────────────────────────────────────

describe('takeScreenshotForPages — Playwright pages map', () => {
  test('returns [] when outputDir is falsy (operator passed no --report-dir)', async () => {
    const pages = new Map([['default', { screenshot: jest.fn() }]]);
    expect(await takeScreenshotForPages(pages, null, 'chromium')).toEqual([]);
    expect(await takeScreenshotForPages(pages, '', 'chromium')).toEqual([]);
    expect(await takeScreenshotForPages(pages, undefined, 'chromium')).toEqual([]);
  });

  test('returns [] for empty pages map (driver had no persona tabs)', async () => {
    const outDir = tmpDir('empty');
    try {
      expect(await takeScreenshotForPages(new Map(), outDir, 'chromium')).toEqual([]);
    } finally {
      cleanup(outDir);
    }
  });

  test('writes one PNG per persona with naming "screenshot-<slug>-<persona>.png"', async () => {
    const outDir = tmpDir('multi');
    const screenshot = jest.fn(async ({ path: p }) => {
      fs.writeFileSync(p, Buffer.from('fake-png'));
    });
    const pages = new Map([
      ['Alice', { screenshot }],
      ['Bob', { screenshot }],
    ]);
    try {
      const saved = await takeScreenshotForPages(pages, outDir, 'chromium');
      expect(saved).toHaveLength(2);
      expect(saved).toContain(path.join(outDir, 'screenshot-chromium-Alice.png'));
      expect(saved).toContain(path.join(outDir, 'screenshot-chromium-Bob.png'));
      expect(fs.existsSync(saved[0])).toBe(true);
      expect(fs.existsSync(saved[1])).toBe(true);
    } finally {
      cleanup(outDir);
    }
  });

  test('one persona screenshot failure does NOT block the others', async () => {
    const outDir = tmpDir('partial');
    const goodScreenshot = jest.fn(async ({ path: p }) => fs.writeFileSync(p, 'ok'));
    const badScreenshot = jest.fn(async () => {
      throw new Error('page closed');
    });
    const pages = new Map([
      ['Alice', { screenshot: goodScreenshot }],
      ['Bob', { screenshot: badScreenshot }],
      ['Carol', { screenshot: goodScreenshot }],
    ]);
    try {
      const saved = await takeScreenshotForPages(pages, outDir, 'chromium');
      expect(saved).toHaveLength(2); // Alice + Carol; Bob swallowed
      expect(saved.some((p) => p.endsWith('Alice.png'))).toBe(true);
      expect(saved.some((p) => p.endsWith('Carol.png'))).toBe(true);
      expect(saved.some((p) => p.endsWith('Bob.png'))).toBe(false);
    } finally {
      cleanup(outDir);
    }
  });

  test('creates outputDir recursively if it does not exist', async () => {
    const nested = path.join(tmpDir('nested'), 'sub', 'dir');
    const screenshot = jest.fn(async ({ path: p }) => fs.writeFileSync(p, 'ok'));
    try {
      await takeScreenshotForPages(new Map([['a', { screenshot }]]), nested, 'chromium');
      expect(fs.existsSync(nested)).toBe(true);
    } finally {
      cleanup(nested.split('/sub')[0]);
    }
  });

  test('slug + persona appear in filename (no collisions across cells)', async () => {
    const outDir = tmpDir('slug');
    const screenshot = jest.fn(async ({ path: p }) => fs.writeFileSync(p, 'ok'));
    const pages = new Map([['default', { screenshot }]]);
    try {
      await takeScreenshotForPages(pages, outDir, 'mobile-chrome-android');
      const files = fs.readdirSync(outDir);
      expect(files).toContain('screenshot-mobile-chrome-android-default.png');
    } finally {
      cleanup(outDir);
    }
  });

  test('uses fullPage: true (capture below-fold content)', async () => {
    const outDir = tmpDir('fullpage');
    const screenshot = jest.fn(async ({ path: p }) => fs.writeFileSync(p, 'ok'));
    try {
      await takeScreenshotForPages(new Map([['a', { screenshot }]]), outDir, 'chromium');
      expect(screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true, path: expect.any(String) }),
      );
    } finally {
      cleanup(outDir);
    }
  });
});

// ── takeScreenshotViaAppium ────────────────────────────────────

describe('takeScreenshotViaAppium — Appium HTTP screenshot endpoint', () => {
  test('returns [] when outputDir falsy', async () => {
    const r = await takeScreenshotViaAppium({
      appiumBaseUrl: MOCK_APPIUM_BASE,
      sessionId: 'sid',
      fetchImpl: jest.fn(),
      outputDir: null,
      slug: 'mobile-safari-ios',
    });
    expect(r).toEqual([]);
  });

  test('returns [] when sessionId falsy (Appium session not established)', async () => {
    const outDir = tmpDir('no-sid');
    try {
      const r = await takeScreenshotViaAppium({
        appiumBaseUrl: MOCK_APPIUM_BASE,
        sessionId: null,
        fetchImpl: jest.fn(),
        outputDir: outDir,
        slug: 'mobile-safari-ios',
      });
      expect(r).toEqual([]);
    } finally {
      cleanup(outDir);
    }
  });

  test('decodes base64 PNG from Appium response + writes to file', async () => {
    const outDir = tmpDir('appium-ok');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
    const base64 = pngBytes.toString('base64');
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ value: base64 }),
    }));
    try {
      const r = await takeScreenshotViaAppium({
        appiumBaseUrl: MOCK_APPIUM_BASE,
        sessionId: 'sid-123',
        fetchImpl,
        outputDir: outDir,
        slug: 'mobile-safari-ios',
      });
      expect(r).toHaveLength(1);
      expect(r[0]).toBe(path.join(outDir, 'screenshot-mobile-safari-ios-default.png'));
      const written = fs.readFileSync(r[0]);
      expect(written).toEqual(pngBytes);
    } finally {
      cleanup(outDir);
    }
  });

  test('returns [] on non-ok HTTP response', async () => {
    const outDir = tmpDir('appium-fail');
    const fetchImpl = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    try {
      const r = await takeScreenshotViaAppium({
        appiumBaseUrl: MOCK_APPIUM_BASE,
        sessionId: 'sid',
        fetchImpl,
        outputDir: outDir,
        slug: 'mobile-safari-ios',
      });
      expect(r).toEqual([]);
    } finally {
      cleanup(outDir);
    }
  });

  test('returns [] on missing value field in Appium response', async () => {
    const outDir = tmpDir('appium-missing');
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        /* no value */
      }),
    }));
    try {
      const r = await takeScreenshotViaAppium({
        appiumBaseUrl: MOCK_APPIUM_BASE,
        sessionId: 'sid',
        fetchImpl,
        outputDir: outDir,
        slug: 'mobile-safari-ios',
      });
      expect(r).toEqual([]);
    } finally {
      cleanup(outDir);
    }
  });

  test('returns [] on fetchImpl throw (best-effort, never propagates)', async () => {
    const outDir = tmpDir('appium-throw');
    const fetchImpl = jest.fn(async () => {
      throw new Error('network down');
    });
    try {
      const r = await takeScreenshotViaAppium({
        appiumBaseUrl: MOCK_APPIUM_BASE,
        sessionId: 'sid',
        fetchImpl,
        outputDir: outDir,
        slug: 'mobile-safari-ios',
      });
      expect(r).toEqual([]);
    } finally {
      cleanup(outDir);
    }
  });

  test('slug appears in filename (per-cell uniqueness)', async () => {
    const outDir = tmpDir('appium-slug');
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ value: Buffer.from('x').toString('base64') }),
    }));
    try {
      await takeScreenshotViaAppium({
        appiumBaseUrl: MOCK_APPIUM_BASE,
        sessionId: 'sid',
        fetchImpl,
        outputDir: outDir,
        slug: 'mobile-chrome-ios',
      });
      const files = fs.readdirSync(outDir);
      expect(files).toContain('screenshot-mobile-chrome-ios-default.png');
    } finally {
      cleanup(outDir);
    }
  });

  test('hits Appium /session/<sid>/screenshot endpoint', async () => {
    const outDir = tmpDir('appium-endpoint');
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ value: Buffer.from('x').toString('base64') }),
    }));
    try {
      await takeScreenshotViaAppium({
        appiumBaseUrl: MOCK_APPIUM_BASE,
        sessionId: 'abc-123',
        fetchImpl,
        outputDir: outDir,
        slug: 'mobile-safari-ios',
      });
      expect(fetchImpl).toHaveBeenCalledWith(`${MOCK_APPIUM_BASE}/session/abc-123/screenshot`);
    } finally {
      cleanup(outDir);
    }
  });
});
