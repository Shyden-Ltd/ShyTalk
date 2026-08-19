/**
 * Which `/api` requests bypass authentication.
 *
 * SHY-0143 C-6. `/api/ban-status` exists to answer the cold-start ban check
 * with NO Firebase session, and the single line that makes that true lives in
 * `index.js`'s skip list. Nothing in the suite imported `index.js`, and
 * `tests/routes/ban-status.test.js` mounts the router bare with no auth
 * middleware in front — so its `answers with no Authorization header at all`
 * test passed identically whether the skip existed, was typo'd, or was scoped
 * to POST. It asserted a property of its own fixture.
 *
 * A pure predicate can be tested. These are the cases that decide whether a
 * banned, signed-out user sees the ban screen or the login screen.
 */

const http = require('node:http');
const { skipsAuth } = require('../../src/middleware/auth-skip');

/**
 * A REAL `IncomingMessage`, because the shape is the whole point.
 *
 * `headers` is an accessor on `IncomingMessage.prototype`, not an own key.
 * A version of this predicate did `req = { ...req, path }` to normalise the
 * trailing slash — and object spread copies only OWN enumerable keys, so the
 * copy had no `headers` and the `/translate` rule threw
 * `TypeError: Cannot read properties of undefined` INSIDE the auth
 * middleware. Every `POST /api/translate` 500'd, anonymous and authenticated.
 *
 * The plain-object helpers these tests used before could not see it: they
 * carried `headers` as an own key, which is exactly what a real request does
 * not do. Building the real type is the only shape that would have failed.
 */
function request(method, path, headers) {
  const req = new http.IncomingMessage(null);
  req.method = method;
  req.path = path;
  if (headers) req.headers = headers;
  return req;
}

// `headers` is required — the anonymous-translate rule reads
// `req.headers.authorization`, and the JSDoc used to omit it, so helpers built
// to the documented shape threw a TypeError instead of asserting. That is why
// the widest branch in this file had no unit coverage.
const get = (path, headers) => skipsAuth(request('GET', path, headers));
const post = (path, headers) => skipsAuth(request('POST', path, headers));

describe('the cold-start ban check (SHY-0143)', () => {
  test('GET /ban-status skips auth', () => {
    expect(get('/ban-status')).toBe(true);
  });

  test('a trailing slash still skips auth', () => {
    // Express's non-strict router matches `/api/ban-status/` to the route, so
    // if the predicate did not normalise, a trailing slash would 401 on a URL
    // the route itself serves.
    expect(get('/ban-status/')).toBe(true);
  });

  test('POST /ban-status does NOT skip auth', () => {
    // The route is GET-only. A future POST must not inherit the exemption.
    expect(post('/ban-status')).toBe(false);
  });

  test('a path merely starting with ban-status does not skip auth', () => {
    expect(get('/ban-statusX')).toBe(false);
    expect(get('/ban-status-admin')).toBe(false);
  });
});

describe('device-info stays authenticated', () => {
  test('POST /device-info does NOT skip auth', () => {
    // It upserts a device binding and runs a cap transaction. The whole reason
    // /ban-status exists is so this one never has to be opened up.
    expect(post('/device-info')).toBe(false);
  });

  test('GET /device-info does NOT skip auth either', () => {
    expect(get('/device-info')).toBe(false);
  });
});

describe('it reads the LIVE request, never a copy', () => {
  test('a real IncomingMessage does not throw on the header-reading rule', () => {
    // The regression this file exists to prevent. A copy loses `headers`,
    // and the failure lands inside the auth middleware as a 500.
    expect(() => post('/translate')).not.toThrow();
    expect(post('/translate')).toBe(true);
  });

  test('the header-reading rule still distinguishes an authenticated caller', () => {
    // Proves the rule is genuinely reading headers off the real request,
    // rather than merely not throwing.
    expect(post('/translate', { authorization: 'Bearer x' })).toBe(false);
  });

  test('every other prototype accessor survives too', () => {
    // `query`, `ip`, `get()`, `originalUrl` are accessors as well. A future
    // rule reading one must not silently see undefined inside an auth
    // decision, which is what the copy would have caused.
    const req = request('GET', '/health');
    expect(() => skipsAuth(req)).not.toThrow();
    expect(req.headers).toBeDefined();
  });
});

describe('the trailing-slash normalisation must not un-skip the prefix rules', () => {
  // Normalising the path before EVERY comparison silently broke the three
  // `startsWith('…/')` rules: '/auth/' became '/auth', which does not start
  // with '/auth/'. Those exact paths flipped from public to auth-required
  // inside a fix that only claimed to normalise '/ban-status/'.
  test.each([['/auth/'], ['/portal/totp-recovery/']])('%s still skips auth', (path) => {
    expect(get(path)).toBe(true);
  });

  test('/test/ still skips auth outside production', () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'local';
    try {
      expect(get('/test/')).toBe(true);
      expect(get('/test/seed')).toBe(true);
    } finally {
      process.env.NODE_ENV = prior;
    }
  });

  test('/test/ does NOT skip auth in production', () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(get('/test/seed')).toBe(false);
    } finally {
      process.env.NODE_ENV = prior;
    }
  });
});

describe('the anonymous-translate rule (needs headers)', () => {
  test('a header-less POST /translate skips auth', () => {
    expect(post('/translate')).toBe(true);
  });

  test('a POST /translate WITH a token does not skip', () => {
    // Callers presenting a token flow through authMiddleware and keep the
    // chat contract; only the public flow is anonymous.
    expect(post('/translate', { authorization: 'Bearer x' })).toBe(false);
  });

  test('GET /translate does not skip', () => {
    expect(get('/translate')).toBe(false);
  });
});

describe('the pre-existing exemptions are unchanged', () => {
  test.each([
    ['/health'],
    ['/log-config'],
    ['/logs'],
    ['/firebase-config'],
    ['/auth/signin'],
    ['/portal/totp-recovery/start'],
  ])('%s skips auth', (path) => {
    expect(get(path)).toBe(true);
  });

  test('GET /config/startingScreens skips auth but POST does not', () => {
    expect(get('/config/startingScreens')).toBe(true);
    expect(post('/config/startingScreens')).toBe(false);
  });

  test('an ordinary authenticated route does not skip', () => {
    expect(get('/users/10000005')).toBe(false);
    expect(post('/rooms')).toBe(false);
  });
});
