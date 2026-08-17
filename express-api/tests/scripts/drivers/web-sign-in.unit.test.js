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
  WEBDRIVER_SIGN_IN_SCRIPT,
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

  test('is re-entrant — signing the SAME persona in twice both succeed', async () => {
    // Drivers cache one page per persona name and Firebase persists the
    // session per origin, so the second call runs against an already-signed-in
    // page. It must resolve cleanly rather than hang on the stale currentUser
    // left by the first.
    const executeAsync = recorder(async () => ({ ok: true }));
    const signIn = makeSignIn({ executeAsync });

    expect(await signIn('Alice')).toBe(true);
    expect(await signIn('Alice')).toBe(true);
    expect(executeAsync.calls).toHaveLength(2);
  });

  test('switching persona A→B sends B’s credentials, not A’s', async () => {
    // A stale closure or a memoised persona would silently re-authenticate as
    // the first persona — the journey would pass while acting as the wrong user.
    const executeAsync = recorder(async () => ({ ok: true }));
    const signIn = makeSignIn({ executeAsync });

    await signIn('Alice');
    await signIn('Marcus');

    expect(executeAsync.calls[0][1][0]).toBe('adult-power@shytalk.dev');
    expect(executeAsync.calls[1][1][0]).toBe('minor-power@shytalk.dev');
  });
});

describe('WEBDRIVER_SIGN_IN_SCRIPT — the browser-side state machine', () => {
  // Executed for real via node:vm with a virtual clock. No browser, no sleeps,
  // no faked service: its only collaborators are window.shytalkAuth, Date.now
  // and setTimeout, all supplied here. Same class of injection the factory
  // tests already use for navigateTo/executeAsync.
  //
  // The property under test is `done()` fires EXACTLY ONCE on every path.
  // Firing twice, or firing before auth settles, is a FALSE SUCCESS — a
  // browser recorded as signed in that is not — which is the failure class
  // this whole module exists to remove.

  const vm = require('vm');

  /**
   * Run the script with a virtual clock.
   * @param {object} opts
   * @param {(tick: number) => object|undefined} opts.authAt  window.shytalkAuth as of tick N
   * @param {number} opts.maxTicks  give up after this many 100ms ticks
   * @returns {{calls: object[], elapsedMs: number}}
   */
  function runScript({ authAt, maxTicks = 400 }) {
    const calls = [];
    let now = 1_000_000;
    let tick = 0;
    let queue = [];

    const sandbox = {
      window: {},
      setTimeout: (fn, ms) => queue.push({ fn, ms }),
      Date: { now: () => now },
    };
    // Refresh window.shytalkAuth before each turn so a test can make it appear
    // (or a currentUser materialise) after N ticks, exactly as a real page does.
    const refreshAuth = () => {
      sandbox.window.shytalkAuth = authAt(tick);
    };

    refreshAuth();
    const context = vm.createContext(sandbox);
    const fn = vm.runInContext(`(function () {${WEBDRIVER_SIGN_IN_SCRIPT}})`, context);
    fn('adult-power@shytalk.dev', SECRET, (r) => calls.push(r));

    // Drain. Each turn: let pending PROMISE jobs land, then run whatever timers
    // they scheduled, advancing the virtual clock by each timer's own delay.
    //
    // Flushing promises first is essential, not cosmetic: the script calls
    // signInWithEmail() and RETURNS without scheduling anything, so the timer
    // queue is momentarily empty and a queue-length-driven loop would exit
    // before .then() ever got to schedule the next poll — reporting "done was
    // never called" for a script that works. setImmediate yields the macrotask
    // turn that lets those jobs run; it is a yield, not a sleep.
    const drain = async () => {
      for (let i = 0; i < maxTicks && calls.length === 0; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        const batch = queue;
        queue = [];
        for (const { fn: cb, ms } of batch) {
          now += ms;
          tick += 1;
          refreshAuth();
          cb();
        }
      }
    };
    return { calls, drain: drain(), elapsed: () => now - 1_000_000 };
  }

  const signedInAuth = () => ({
    signInWithEmail: async () => {},
    currentUser: { uid: 'u1' },
  });

  test('happy path — done() fires exactly once with ok:true', async () => {
    const r = runScript({ authAt: () => signedInAuth() });
    await r.drain;
    expect(r.calls).toEqual([{ ok: true }]);
  });

  test('waits for shytalkAuth to APPEAR, then still succeeds exactly once', async () => {
    // The SDK loads asynchronously; the script must poll rather than give up.
    const r = runScript({ authAt: (t) => (t >= 3 ? signedInAuth() : undefined) });
    await r.drain;
    expect(r.calls).toEqual([{ ok: true }]);
  });

  test('waits for currentUser to MATERIALISE — never reports success early', async () => {
    // This is the false-success guard: signInWithEmail RESOLVING is not the
    // same as the page having an authenticated user.
    //
    // Asserting only `[{ok:true}]` is not enough and I proved it — mutating the
    // script to `if (window.shytalkAuth) return done({ok:true})`, i.e. dropping
    // the currentUser check entirely, still yields {ok:true} and such a test
    // stays green. So this also pins WHEN success was reported: the virtual
    // clock must have advanced past the tick where currentUser appeared.
    const r = runScript({
      authAt: (t) => ({
        signInWithEmail: async () => {},
        currentUser: t >= 4 ? { uid: 'u1' } : undefined,
      }),
    });
    await r.drain;
    expect(r.calls).toEqual([{ ok: true }]);
    // 4 polls at 100ms each had to elapse before the user existed.
    expect(r.elapsed()).toBeGreaterThanOrEqual(400);
  });

  test('rejected sign-in — done() fires exactly once carrying the reason', async () => {
    const r = runScript({
      authAt: () => ({
        signInWithEmail: async () => {
          throw new Error('INVALID_PASSWORD');
        },
        currentUser: undefined,
      }),
    });
    await r.drain;
    expect(r.calls).toEqual([{ ok: false, error: 'INVALID_PASSWORD' }]);
  });

  test('shytalkAuth never appears — gives up ONCE at the deadline, not forever', async () => {
    const r = runScript({ authAt: () => undefined });
    await r.drain;
    expect(r.calls).toEqual([{ ok: false, error: 'shytalkAuth never appeared' }]);
    // Bounded by the script's own 20s budget rather than spinning.
    expect(r.elapsed()).toBeGreaterThan(20000);
  });

  test('currentUser never materialises — gives up ONCE, distinctly from the above', async () => {
    const r = runScript({
      authAt: () => ({ signInWithEmail: async () => {}, currentUser: undefined }),
    });
    await r.drain;
    expect(r.calls).toEqual([{ ok: false, error: 'no currentUser after sign-in' }]);
  });

  test('the script names no credential — the secret arrives only as an argument', () => {
    expect(WEBDRIVER_SIGN_IN_SCRIPT).not.toContain(SECRET);
    expect(WEBDRIVER_SIGN_IN_SCRIPT).toContain('arguments[1]');
  });
});
