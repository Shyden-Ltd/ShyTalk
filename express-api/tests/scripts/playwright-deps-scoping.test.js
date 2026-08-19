/**
 * SHY-0356 — a browser shard must not install every other browser's deps.
 *
 * `npx playwright install-deps` with NO browser argument installs the union for
 * every browser. On `ubuntu24.04` that is chromium 21 packages, firefox 25, and
 * webkit 52 — and WebKit's half is the expensive half (the GStreamer/ffmpeg
 * stack: libflite1 at 13.6 MB, libavcodec60, libass9, libbluray2). A chromium
 * shard was downloading all of it, and a slow mirror then blew the step budget.
 *
 * Structural test: it reads the workflow, so it cannot pass by accident on a
 * machine that happens to have the packages.
 */
const fs = require('fs');
const path = require('path');

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/playwright-tests.yml');

const src = fs.readFileSync(WORKFLOW, 'utf8');

/** Every entry of the WEB_ALL catalog the matrix is filtered from. */
function webCatalogEntries() {
  const block = src.match(/const WEB_ALL = \[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/\{([^}]*)\}/g)].map((m) => {
    const fields = {};
    for (const f of m[1].matchAll(/(\w+):\s*'([^']*)'/g)) fields[f[1]] = f[2];
    return fields;
  });
}

/** The browser names `playwright install-deps` actually understands. */
const KNOWN_BROWSERS = new Set(['chromium', 'firefox', 'webkit', 'chromium-headless-shell']);

describe('SHY-0356 — Playwright deps are scoped to the shard browser', () => {
  test('the catalog is non-empty — the guard is not vacuous', () => {
    // Without this, emptying WEB_ALL would make every assertion below pass by
    // iterating nothing at all.
    expect(webCatalogEntries().length).toBeGreaterThanOrEqual(5);
  });

  test('install-deps is invoked WITH a browser argument', () => {
    const bare = /npx playwright install-deps\s*$/m.test(src);
    expect(bare).toBe(false);
  });

  test('the install-deps invocation uses a matrix-derived value', () => {
    // Capture to end of line: the value is `${{ matrix.deps }}`, which
    // contains spaces, so a \S+ capture would stop at `${{` and pass or fail
    // for the wrong reason.
    const line = src.match(/run:\s*npx playwright install-deps\s+(.+)$/m);
    expect(line).not.toBeNull();
    expect(line[1].trim()).toMatch(/^\$\{\{\s*matrix\.\w+\s*\}\}$/);
  });

  test.each(webCatalogEntries().map((e) => [e.project, e]))(
    'project %s declares a deps browser Playwright understands',
    (project, entry) => {
      expect(entry.deps).toBeDefined();
      expect(KNOWN_BROWSERS.has(entry.deps)).toBe(true);
    },
  );

  test('the mobile projects map to their real engines, not to their own names', () => {
    const by = Object.fromEntries(webCatalogEntries().map((e) => [e.project, e.deps]));
    // These are Playwright PROJECTS, not browsers — `install-deps mobile-safari`
    // is not a thing, and getting this wrong is the obvious way to break it.
    expect(by['mobile-chrome']).toBe('chromium');
    expect(by['mobile-safari']).toBe('webkit');
    expect(by.chromium).toBe('chromium');
    expect(by.firefox).toBe('firefox');
    expect(by.webkit).toBe('webkit');
  });

  test('every catalog entry keeps the fields the matrix already consumes', () => {
    // Adding `deps` must not have dropped anything the workflow reads.
    for (const e of webCatalogEntries()) {
      expect(e.project).toBeTruthy();
      expect(e.browser).toBeTruthy();
      expect(e.viewport).toMatch(/^\d+x\d+$/);
    }
  });
});
