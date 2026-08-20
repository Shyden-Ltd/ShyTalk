/**
 * Guard: every file in `src/routes/` is actually mounted in `src/index.js`.
 *
 * Found while adding SHY-0380's support-tickets router. A route file that is
 * never mounted defines endpoints that do not exist — and nothing notices,
 * because route tests mount the router directly rather than booting the app.
 * The router passes all its own tests and serves no traffic.
 *
 * The scan also turned up `routes/health.js`, which has never been mounted: the
 * live health endpoint is defined inline at `index.js`. That is almost certainly
 * why the 2026-08-20 handover recorded "`/health` 404s — the real path is
 * `/api/health`". It is allowlisted below rather than silently ignored, with a
 * story to remove it.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ROUTES_DIR = path.join(REPO_ROOT, 'express-api', 'src', 'routes');
const INDEX = path.join(REPO_ROOT, 'express-api', 'src', 'index.js');

/**
 * Route files deliberately not mounted. Each needs a reason and a ticket —
 * an allowlist without either is just a disabled test.
 */
const UNMOUNTED_ALLOWLIST = {
  // Dead: the live endpoint is defined inline in index.js. SHY-0386 removes it.
  health: 'SHY-0386 — dead file; live health endpoint is inline in index.js',
};

function routeModuleNames() {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.basename(f, '.js'));
}

describe('every route file is mounted', () => {
  const names = routeModuleNames();
  const index = fs.readFileSync(INDEX, 'utf-8');

  test('the scan finds route files, so this guard cannot pass vacuously', () => {
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain('support-tickets');
  });

  test('index.js requires every route module', () => {
    const unmounted = names
      .filter((n) => !index.includes(`routes/${n}'`))
      .filter((n) => !(n in UNMOUNTED_ALLOWLIST));
    expect(unmounted).toEqual([]);
  });

  test('the allowlist itself still describes reality', () => {
    // If an allowlisted file gets mounted, the entry must go — otherwise the
    // allowlist rots into a list of things nobody rechecks.
    const wronglyAllowlisted = Object.keys(UNMOUNTED_ALLOWLIST).filter((n) =>
      index.includes(`routes/${n}'`),
    );
    expect(wronglyAllowlisted).toEqual([]);

    // And every allowlisted file must still exist.
    const missing = Object.keys(UNMOUNTED_ALLOWLIST).filter((n) => !names.includes(n));
    expect(missing).toEqual([]);
  });
});
