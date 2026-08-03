/**
 * SHY-0268 gap hunt — a journey may only call API endpoints that exist.
 *
 * Same failure shape as the phantom-collection audit, one layer up: a
 * scenario that POSTs to a route Express never registered gets a 404 from the
 * router, which can look indistinguishable from the refusal the scenario
 * meant to prove. `POST /api/users/follow` asserted a 404 for a cross-cohort
 * follow — and would have "passed" for the wrong reason, because the real
 * route is `POST /api/users/:uniqueId/follow` and the tested one does not
 * exist at all. A guard that can be satisfied by its own absence is not a
 * guard.
 *
 * Ground truth is the router table itself: every `router.<verb>('<path>')` in
 * express-api/src/routes. Paths are compared with parameters normalised, and
 * with the `/api` mount prefix allowed either way, since the corpus writes
 * the externally-visible URL.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ROUTES_DIR = path.join(REPO_ROOT, 'express-api', 'src', 'routes');
const CORPUS_DIR = path.join(REPO_ROOT, 'journey-tests');

/**
 * Endpoints a journey asserts against deliberately because they must NOT
 * exist — the absence IS the behaviour being proven. Each needs the scenario
 * to assert 404, which is what Express returns for an unrouted path.
 */
const INTENTIONALLY_ABSENT = ['PATCH /api/admin/audit/:p', 'DELETE /api/admin/audit/:p'];

function normalise(p) {
  // Placeholder braces are stripped by splitting rather than by a `\{[^}]*\}`
  // regex, which linted as super-linear.
  const noQuery = p.split('?')[0];
  const debraced = noQuery
    .split('/')
    .map((seg) => (seg.startsWith('{') && seg.endsWith('}') ? ':p' : seg))
    .join('/');
  return debraced
    .replace(/:[A-Za-z0-9_]+/g, ':p')
    .replace(/\/\d+/g, '/:p')
    .replace(/\/$/, '');
}

/** Every route Express registers, with and without the /api mount prefix. */
function realRoutes() {
  const out = new Set();
  for (const file of fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    for (const m of text.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      const verb = m[1].toUpperCase();
      const p = normalise(m[2]);
      out.add(`${verb} ${p}`);
      out.add(`${verb} ${normalise(`/api${m[2]}`)}`);
    }
  }
  return out;
}

/** Every API call the corpus makes, with the file:line that makes it. */
function corpusCalls() {
  const found = new Map();
  for (const file of fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.feature'))) {
    const lines = fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(
        /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[A-Za-z0-9/_:{}?=&.-]+)/g,
      )) {
        const key = `${m[1]} ${normalise(m[2])}`;
        if (!found.has(key)) found.set(key, []);
        found.get(key).push(`${file}:${i + 1}`);
      }
    });
  }
  return found;
}

/**
 * Structural match: a real route's `:p` segment matches ANY corpus segment.
 * String equality is not enough because the corpus writes concrete ids —
 * `/api/conversations/c1/messages` against `/api/conversations/:p/messages` —
 * and only NUMERIC ids normalise away.
 */
function routeExists(call, real) {
  if (real.has(call)) return true;
  const [verb, p] = call.split(' ');
  const want = p.split('/');
  for (const candidate of real) {
    const [rVerb, rPath] = candidate.split(' ');
    if (rVerb !== verb) continue;
    const got = rPath.split('/');
    if (got.length !== want.length) continue;
    if (got.every((seg, i) => seg === ':p' || seg === want[i])) return true;
  }
  return false;
}

describe('journey corpus calls only endpoints Express registers', () => {
  const real = realRoutes();

  test('the router table was actually read (guard against a vacuous pass)', () => {
    expect(real.size).toBeGreaterThan(200);
    expect(real.has('POST /api/users/:p/follow')).toBe(true);
  });

  test('the corpus scan finds API calls (guard against a vacuous pass)', () => {
    expect(corpusCalls().size).toBeGreaterThan(5);
  });

  test('no journey calls an endpoint that does not exist', () => {
    const missing = [];
    for (const [call, sites] of corpusCalls()) {
      if (INTENTIONALLY_ABSENT.includes(call)) continue;
      if (!routeExists(call, real)) missing.push(`${call} (e.g. ${sites[0]})`);
    }
    expect(missing.sort()).toEqual([]);
  });

  test('an intentionally-absent endpoint is still absent, and still asserted as 404', () => {
    // If one of these ever gains a real handler, the scenario asserting 404
    // becomes wrong — and would keep passing only until the handler starts
    // answering. Fail here instead, at the point the route appears.
    const nowReal = INTENTIONALLY_ABSENT.filter((c) => routeExists(c, real));
    expect(nowReal).toEqual([]);

    const calls = corpusCalls();
    const orphaned = INTENTIONALLY_ABSENT.filter((c) => !calls.has(c));
    expect(orphaned).toEqual([]);
  });
});
