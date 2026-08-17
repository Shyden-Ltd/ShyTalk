'use strict';

/**
 * web-sign-in.unit.test.js — SHY-0328
 *
 * **Why this file exists.** `makeWebSignInViaWebDriver` backs THREE drivers —
 * firefox-on-Android, WebKit-iOS and Safari-iOS, i.e. the entire iOS web
 * surface — and had ZERO tests. Only the Playwright variant (`makeWebSignIn`)
 * was covered, in `web-playwright-driver.test.js`. Half the module's transports
 * were shipping unexercised, including an embedded script with two nested
 * polling loops and a deadline.
 *
 * **Why a `.unit.test.js` location is honest here, not a loophole.**
 * `makeWebSignInViaWebDriver` is a PURE FACTORY: its whole contract is "given a
 * `navigateTo` and an `executeAsync`, produce a `webSignIn`". Passing plain
 * recording functions is dependency injection into pure logic, not a double
 * standing in for a real collaborator — the REST transport itself is a real
 * geckodriver/Appium socket, proven by the journey matrix, and is not what this
 * file claims to test. `buildPersonaIndex` is likewise pure: an array in, a Map
 * out, no collaborator at all.
 */

const {
  makeWebSignInViaWebDriver,
  buildPersonaIndex,
  resolvePersona,
} = require('../../../scripts/drivers/web-sign-in');

const SECRET = 'unit-test-credential';

/** Records every call; returns whatever the test queued. Not a stand-in for a
 *  collaborator — it IS the injected parameter the factory is documented to take. */
function recorder(impl) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  return fn;
}

function makeSignIn({ navigateTo, executeAsync, baseURL = 'http://localhost:8888' } = {}) {
  return makeWebSignInViaWebDriver({
    navigateTo: navigateTo || recorder(),
    executeAsync: executeAsync || recorder(async () => ({ ok: true })),
    baseURL,
    label: 'unit',
  });
}

describe('buildPersonaIndex — the first-name lookup key', () => {
  test('indexes each persona under BOTH its first name and its P-id', () => {
    const index = buildPersonaIndex([
      { id: 'P-01', displayName: 'Alice Anderson', email: 'a@x.dev' },
      { id: 'P-02', displayName: 'Bob Brown', email: 'b@x.dev' },
    ]);

    expect(index.get('Alice').email).toBe('a@x.dev');
    expect(index.get('P-01').email).toBe('a@x.dev');
    expect(index.get('Bob').email).toBe('b@x.dev');
    expect(index.get('P-02').email).toBe('b@x.dev');
  });

  test('REFUSES a duplicate first name instead of silently binding the last one', () => {
    // The registry has 17 personas and no collision TODAY. A future
    // "Alice Chen" beside "Alice Anderson" would, with a plain Map.set, make
    // every `Alice` journey sign in as whoever was registered last — the
    // journey would pass while asserting against the wrong account, which is
    // the most expensive shape of wrong there is.
    expect(() =>
      buildPersonaIndex([
        { id: 'P-01', displayName: 'Alice Anderson', email: 'a@x.dev' },
        { id: 'P-09', displayName: 'Alice Chen', email: 'c@x.dev' },
      ]),
    ).toThrow(/Alice/);
  });

  test('REFUSES a P-id that collides with another persona’s first name', () => {
    expect(() =>
      buildPersonaIndex([
        { id: 'P-01', displayName: 'Alice Anderson', email: 'a@x.dev' },
        { id: 'Alice', displayName: 'Bob Brown', email: 'b@x.dev' },
      ]),
    ).toThrow(/Alice/);
  });

  test('names the colliding personas, so the fix is obvious from the message alone', () => {
    expect(() =>
      buildPersonaIndex([
        { id: 'P-01', displayName: 'Alice Anderson', email: 'a@x.dev' },
        { id: 'P-09', displayName: 'Alice Chen', email: 'c@x.dev' },
      ]),
    ).toThrow(/P-01[\s\S]*P-09|P-09[\s\S]*P-01/);
  });

  test('the REAL registry is collision-free — this is the guard firing on live data', () => {
    const { personas } = require('../../../scripts/provision-test-personas');
    expect(() => buildPersonaIndex(personas)).not.toThrow();
    expect(resolvePersona('P-02').email).toBe('adult-power@shytalk.dev');
  });
});

describe('makeWebSignInViaWebDriver — the REST transport (firefox-Android, WebKit-iOS, Safari-iOS)', () => {
  const SAVED_PW = process.env.PERSONAS_PASSWORD;
  beforeEach(() => {
    process.env.PERSONAS_PASSWORD = SECRET;
  });
  afterEach(() => {
    if (SAVED_PW === undefined) delete process.env.PERSONAS_PASSWORD;
    else process.env.PERSONAS_PASSWORD = SAVED_PW;
  });

  test('signs the persona in and reports true', async () => {
    const navigateTo = recorder();
    const executeAsync = recorder(async () => ({ ok: true }));

    expect(await makeSignIn({ navigateTo, executeAsync })('Alice')).toBe(true);

    expect(navigateTo.calls[0][0]).toBe('http://localhost:8888/roadmap.html');
    // The persona's REAL email out of the registry, not the label it was called with.
    expect(executeAsync.calls[0][1]).toEqual(['adult-power@shytalk.dev', SECRET]);
  });

  test('resolves a persona by P-id as well as by first name', async () => {
    const executeAsync = recorder(async () => ({ ok: true }));
    expect(await makeSignIn({ executeAsync })('P-02')).toBe(true);
    expect(executeAsync.calls[0][1][0]).toBe('adult-power@shytalk.dev');
  });

  test('the credential travels in args and NEVER inside the script source', async () => {
    // WebDriver error responses echo the script back (see the geckodriver and
    // Appium /execute/async throw sites, which slice the response body into the
    // Error). A template-interpolated secret would land in the run log on every
    // script failure. This pins the secret to the args array.
    const executeAsync = recorder(async () => ({ ok: true }));
    await makeSignIn({ executeAsync })('Alice');

    const [script, args] = executeAsync.calls[0];
    expect(script).not.toContain(SECRET);
    expect(script).not.toContain('adult-power@shytalk.dev');
    expect(args).toContain(SECRET);
  });

  test('waits for a real currentUser, not merely for sign-in to resolve', async () => {
    const executeAsync = recorder(async () => ({ ok: true }));
    await makeSignIn({ executeAsync })('Alice');

    const script = executeAsync.calls[0][0];
    expect(script).toContain('signInWithEmail');
    expect(script).toContain('currentUser');
  });

  test('normalises a baseURL with a trailing slash rather than requesting //roadmap.html', async () => {
    const navigateTo = recorder();
    await makeSignIn({ navigateTo, baseURL: 'http://localhost:8888/' })('Alice');
    expect(navigateTo.calls[0][0]).toBe('http://localhost:8888/roadmap.html');
  });

  test('returns FALSE for a persona not in the registry, without touching the browser', async () => {
    const navigateTo = recorder();
    expect(await makeSignIn({ navigateTo })('Nobody')).toBe(false);
    expect(navigateTo.calls).toHaveLength(0);
  });

  test('returns FALSE when PERSONAS_PASSWORD is unset, rather than signing in blank', async () => {
    delete process.env.PERSONAS_PASSWORD;
    const navigateTo = recorder();
    expect(await makeSignIn({ navigateTo })('Alice')).toBe(false);
    expect(navigateTo.calls).toHaveLength(0);
  });

  test('returns FALSE when the page reports the sign-in failed', async () => {
    const executeAsync = recorder(async () => ({ ok: false, error: 'INVALID_PASSWORD' }));
    expect(await makeSignIn({ executeAsync })('Alice')).toBe(false);
  });

  test('returns FALSE when the script returns nothing at all', async () => {
    // A driver whose /execute/async yields no value must not read as success.
    const executeAsync = recorder(async () => undefined);
    expect(await makeSignIn({ executeAsync })('Alice')).toBe(false);
  });

  test('returns FALSE when the transport throws, rather than propagating', async () => {
    const executeAsync = async () => {
      throw new Error('geckodriver /execute/async failed (500)');
    };
    expect(await makeSignIn({ executeAsync })('Alice')).toBe(false);
  });

  test('returns FALSE when navigation itself throws', async () => {
    const navigateTo = async () => {
      throw new Error('no session');
    };
    expect(await makeSignIn({ navigateTo })('Alice')).toBe(false);
  });
});
