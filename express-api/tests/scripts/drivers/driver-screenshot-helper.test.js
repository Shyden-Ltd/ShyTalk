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

const {
  takeScreenshotForPages,
  takeScreenshotViaAppium,
  safeFilenamePart,
  ensureDirSafe,
} = require(HELPER_PATH);

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

  test('returns [] when fs.mkdirSync throws (EACCES / EROFS / disk-full) — never throws (C1)', async () => {
    // Reviewer-flagged: mkdirSync was OUTSIDE the try/catch. JSDoc
    // promises best-effort semantics — function must NEVER throw.
    const originalMkdir = fs.mkdirSync;
    fs.mkdirSync = jest.fn(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    try {
      const r = await takeScreenshotForPages(
        new Map([['Alice', { screenshot: jest.fn() }]]),
        '/some/forbidden/dir',
        'chromium',
      );
      expect(r).toEqual([]);
    } finally {
      fs.mkdirSync = originalMkdir;
    }
  });

  test('sanitizes persona keys with path-traversal segments (P2)', async () => {
    // Defense-in-depth: persona key comes from driver-controlled
    // pages-Map. Path.join would resolve `..` segments and escape
    // outputDir. The helper strips to a conservative charset before
    // joining.
    const outDir = tmpDir('persona-sanitize');
    const screenshot = jest.fn(async ({ path: p }) => fs.writeFileSync(p, 'ok'));
    const pages = new Map([['../../etc/shadow', { screenshot }]]);
    try {
      const r = await takeScreenshotForPages(pages, outDir, 'chromium');
      expect(r).toHaveLength(1);
      // ../../etc/shadow → ___..etc.shadow → all non-[a-zA-Z0-9_-] become _
      expect(r[0]).toBe(path.join(outDir, 'screenshot-chromium-______etc_shadow.png'));
      // Verify the file is INSIDE outDir, not escaped
      expect(r[0].startsWith(outDir)).toBe(true);
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

  test('returns [] when r.json() throws — malformed response body (I3)', async () => {
    // Distinct from the fetchImpl-throw case: the HTTP layer succeeds
    // but the body is non-JSON (HTML error page, truncated stream,
    // protocol mismatch). Helper must swallow + return [].
    const outDir = tmpDir('appium-json-throw');
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
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

  test('returns [] when body.value is a non-string truthy value (I4)', async () => {
    // Buffer.from(42, 'base64') throws TypeError. The outer try/catch
    // catches it in production, but the explicit typeof guard short-
    // circuits without paying for the Buffer.from attempt and gives
    // a cleaner contract.
    const outDir = tmpDir('appium-non-string');
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ value: 42 }),
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

  test('returns [] when fs.mkdirSync throws — never throws (C1)', async () => {
    // Reviewer-flagged: parity with the Playwright-side mkdirSync
    // guard. Best-effort contract must hold for the Appium path too.
    const originalMkdir = fs.mkdirSync;
    fs.mkdirSync = jest.fn(() => {
      throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
    });
    try {
      const r = await takeScreenshotViaAppium({
        appiumBaseUrl: MOCK_APPIUM_BASE,
        sessionId: 'sid',
        fetchImpl: jest.fn(),
        outputDir: '/readonly/dir',
        slug: 'mobile-safari-ios',
      });
      expect(r).toEqual([]);
    } finally {
      fs.mkdirSync = originalMkdir;
    }
  });
});

// ── safeFilenamePart + ensureDirSafe (internals exposed for testing) ──

describe('safeFilenamePart — persona-key sanitizer', () => {
  test('strips path-traversal segments', () => {
    expect(safeFilenamePart('../../etc/shadow')).toBe('______etc_shadow');
  });

  test('strips backslashes (Windows path-traversal)', () => {
    expect(safeFilenamePart('..\\..\\Windows\\System32')).toBe('______Windows_System32');
  });

  test('preserves alphanumerics + underscore + hyphen', () => {
    expect(safeFilenamePart('Alice-1_admin')).toBe('Alice-1_admin');
  });

  test('coerces non-string inputs via String()', () => {
    expect(safeFilenamePart(42)).toBe('42');
    expect(safeFilenamePart(null)).toBe('null');
    expect(safeFilenamePart(undefined)).toBe('undefined');
  });

  test('strips embedded null bytes (defense against C-string truncation in downstream tools)', () => {
    expect(safeFilenamePart('Alice\0evil')).toBe('Alice_evil');
  });
});

describe('ensureDirSafe — never-throws mkdir wrapper', () => {
  test('returns true on success', () => {
    const dir = tmpDir('ensure-ok');
    try {
      expect(ensureDirSafe(dir)).toBe(true);
      expect(fs.existsSync(dir)).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test('returns false on mkdir failure (never throws)', () => {
    const originalMkdir = fs.mkdirSync;
    fs.mkdirSync = jest.fn(() => {
      throw new Error('EACCES');
    });
    try {
      expect(ensureDirSafe('/whatever')).toBe(false);
    } finally {
      fs.mkdirSync = originalMkdir;
    }
  });
});
