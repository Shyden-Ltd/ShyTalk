/**
 * Every destructive admin route sits behind an admin guard — enforced, not assumed.
 *
 * `routes/admin-cleanup.js` holds 26 endpoints that wipe entire collections:
 * all-coins, all-beans, all-transactions, all-backpacks, all-giftwalls,
 * all-reports, all-warnings, all-spin-history, all-supershy. They are gated by
 * PATH PREFIX — `router.use('/cleanup', adminGuard)` — and the file's own comment
 * explains why the prefix has to be exactly right: too broad and it intercepts
 * every sibling router's routes at the shared /api mount point, too narrow and it
 * covers nothing.
 *
 * Nothing enforced the pairing. A route added tomorrow at a path outside those
 * prefixes would be ungated, and no test would notice, because each half is fine
 * on its own: the guard works, and the route works. It is the SEAM between them
 * that carries the risk, and the blast radius is every balance in the product.
 *
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');

/** Route files whose every endpoint must be admin-gated. */
const ADMIN_ONLY_ROUTE_FILES = [
  'express-api/src/routes/admin-cleanup.js',
  'express-api/src/routes/admin-bans.js',
  'express-api/src/routes/admin-economy.js',
  'express-api/src/routes/admin-users.js',
  'express-api/src/routes/admin-backup.js',
];

const read = (rel) => {
  const p = path.join(repoRoot, rel);
  expect(fs.existsSync(p)).toBe(true);
  return fs.readFileSync(p, 'utf8');
};

/** Prefixes handed to router.use(...) — the gate's reach. */
const guardPrefixes = (src) =>
  [...src.matchAll(/router\.use\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

/** Every endpoint the file defines. */
const routes = (src) =>
  [...src.matchAll(/router\.(get|post|patch|put|delete)\(\s*['"]([^'"]+)['"]/g)].map((m) => ({
    verb: m[1].toUpperCase(),
    path: m[2],
  }));

/**
 * A route is gated if a guard prefix covers it, or if the route line itself
 * names a guard — some files gate per-route rather than by prefix.
 */
const coveredByPrefix = (routePath, prefixes) =>
  prefixes.some((g) => routePath === g || routePath.startsWith(`${g.replace(/\/$/, '')}/`));

describe.each(ADMIN_ONLY_ROUTE_FILES)('%s — every route is admin-gated', (rel) => {
  const src = read(rel);
  const defined = routes(src);
  const prefixes = guardPrefixes(src);

  test('the file really does define routes (the scan is not vacuous)', () => {
    expect(defined.length).toBeGreaterThan(0);
  });

  test('no endpoint escapes the admin gate', () => {
    const perRouteGuarded = /requireAdmin|adminGuard|requireSupportAgent/;

    const ungated = defined.filter(({ path: p }) => {
      if (coveredByPrefix(p, prefixes)) return false;
      // Per-route gating: the handler body must reach for an admin check.
      const at = src.indexOf(`'${p}'`);
      const body = src.slice(at, at + 900);
      return !perRouteGuarded.test(body);
    });

    // Jest's expect() takes exactly one argument, so the context travels INSIDE
    // the compared value — a bare `toEqual([])` failure would name the endpoints
    // but not the prefixes that were supposed to cover them.
    const described = ungated.map(
      (r) => `${r.verb} ${r.path} — not covered by guard prefixes ${JSON.stringify(prefixes)}`,
    );

    expect(described).toEqual([]);
  });
});
