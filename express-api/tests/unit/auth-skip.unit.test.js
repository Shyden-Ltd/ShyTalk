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

const { skipsAuth } = require('../../src/middleware/auth-skip');

const get = (path) => skipsAuth({ method: 'GET', path });
const post = (path) => skipsAuth({ method: 'POST', path });

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
