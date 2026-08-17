/**
 * App Check verification as a pure predicate (SHY-0300).
 *
 * `admin.appCheck().verifyToken()` is a signature check against Google's
 * public keys for a real Firebase project, and a VALID token can only be
 * minted by a genuine app install attested by Play Integrity or App Attest.
 * That is not inducible from a test at any layer — it is the documented
 * escape hatch, and it is why this file is a `*.unit.test.js`: the repo's
 * convention allows a double ONLY in a unit-test location, and this is the
 * one collaborator that qualifies.
 *
 * Everything else is real. The mode logic, the outcome classification, the
 * status codes and the counters are the actual module, and the composed
 * behaviour through the real gate is pinned next door in
 * `auth-skip-composition.test.js` against the real route and the real
 * emulator.
 *
 * The shape being defended: an attestation failure must never be conflated
 * with an auth failure, and a BROKEN VERIFIER must never become an outage.
 * Those pull in opposite directions — one wants to refuse, the other wants to
 * pass — so the classification between them is the whole design.
 */

const APP_CHECK_HEADER = 'x-firebase-appcheck';

/** A minimal live-shaped request. `headers` is a real own object here because
 * these tests call the predicate directly rather than through Express; the
 * composed tests use a real `http.IncomingMessage`, which is where the
 * prototype-accessor hazard actually bites. */
const reqWith = (token, extra = {}) => ({
  method: 'GET',
  path: '/ban-status',
  headers: token === undefined ? {} : { [APP_CHECK_HEADER]: token },
  ...extra,
});

describe('classifying an App Check token', () => {
  let verifyAppCheckToken;
  let setVerifier;

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../../src/middleware/app-check');
    verifyAppCheckToken = mod.verifyAppCheckToken;
    setVerifier = mod.__setVerifierForTests;
  });

  test('a token the SDK accepts is "verified"', async () => {
    setVerifier(async () => ({ appId: '1:123:android:abc' }));
    await expect(verifyAppCheckToken(reqWith('a-good-token'))).resolves.toEqual({
      outcome: 'verified',
      appId: '1:123:android:abc',
    });
  });

  test('no header at all is "missing", and the SDK is never called', async () => {
    // Distinct from "invalid" because the ROLLOUT depends on telling them
    // apart: during monitor mode, `missing` counts clients that have not
    // updated yet, while `invalid` is a client sending something wrong. Fold
    // them together and the enforcement flip is taken on a number that
    // cannot answer "is it safe yet".
    let called = false;
    setVerifier(async () => {
      called = true;
      return {};
    });
    await expect(verifyAppCheckToken(reqWith(undefined))).resolves.toEqual({ outcome: 'missing' });
    expect(called).toBe(false);
  });

  test.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('%s is "missing", not "invalid" — there is nothing to verify', async (_label, token) => {
    setVerifier(async () => {
      throw new Error('should not be called');
    });
    await expect(verifyAppCheckToken(reqWith(token))).resolves.toEqual({ outcome: 'missing' });
  });

  test('a token the SDK REJECTS is "invalid"', async () => {
    // The SDK throws for both a malformed token and a well-formed one from
    // another project. Both are a caller presenting bad attestation, which is
    // the case enforcement exists to refuse.
    const err = new Error('Decoding App Check token failed');
    err.code = 'app-check/invalid-argument';
    setVerifier(async () => {
      throw err;
    });
    const res = await verifyAppCheckToken(reqWith('not-a-real-token'));
    expect(res.outcome).toBe('invalid');
  });

  test('an INFRASTRUCTURE failure is "error", not "invalid"', async () => {
    // A fetch failure reaching Google's key endpoint is not evidence that the
    // caller is illegitimate. Classifying it as `invalid` would turn a Google
    // outage into a total lockout of every user — strictly worse than the
    // abuse attestation prevents.
    const err = new Error('getaddrinfo ENOTFOUND firebaseappcheck.googleapis.com');
    err.code = 'app-check/unknown-error';
    setVerifier(async () => {
      throw err;
    });
    const res = await verifyAppCheckToken(reqWith('a-token'));
    expect(res.outcome).toBe('error');
  });

  test('a verifier that resolves without an appId is "invalid", not "verified"', async () => {
    // Fails CLOSED on a shape it does not recognise. A future SDK returning
    // something unexpected must not be read as a pass.
    setVerifier(async () => ({}));
    const res = await verifyAppCheckToken(reqWith('a-token'));
    expect(res.outcome).toBe('invalid');
  });
});

describe('what each mode DOES with an outcome', () => {
  let appCheckMiddleware;
  let setVerifier;
  let counters;

  const runGate = async (mode, token) => {
    process.env.APP_CHECK_MODE = mode;
    jest.resetModules();
    const mod = require('../../src/middleware/app-check');
    appCheckMiddleware = mod.appCheckMiddleware;
    setVerifier = mod.__setVerifierForTests;
    counters = mod.appCheckCounters;
    if (token.verifier) setVerifier(token.verifier);

    const req = reqWith(token.header);
    let nexted = false;
    let status = null;
    let body = null;
    const res = {
      status(s) {
        status = s;
        return this;
      },
      json(b) {
        body = b;
        return this;
      },
    };
    await appCheckMiddleware(req, res, () => {
      nexted = true;
    });
    return { nexted, status, body, req, counters: counters() };
  };

  const ok = { verifier: async () => ({ appId: '1:1:android:x' }), header: 'good' };
  const bad = {
    verifier: async () => {
      const e = new Error('bad');
      e.code = 'app-check/invalid-argument';
      throw e;
    },
    header: 'bad',
  };
  const broken = {
    verifier: async () => {
      const e = new Error('down');
      e.code = 'app-check/unknown-error';
      throw e;
    },
    header: 'any',
  };
  const none = { verifier: async () => ({}), header: undefined };

  afterEach(() => {
    delete process.env.APP_CHECK_MODE;
  });

  describe('monitor — refuses nobody, counts everybody', () => {
    test.each([
      ['a verified token', ok],
      ['an invalid token', bad],
      ['no token', none],
      ['a broken verifier', broken],
    ])('%s is served', async (_l, t) => {
      const { nexted, status } = await runGate('monitor', t);
      expect({ nexted, status }).toEqual({ nexted: true, status: null });
    });

    test('the outcome is still recorded, which is the entire point of the mode', async () => {
      const { req, counters } = await runGate('monitor', none);
      expect(req.appCheck).toEqual({ outcome: 'missing' });
      expect(counters.missing).toBe(1);
      expect(counters.refused).toBe(0);
    });
  });

  describe('enforce — refuses exactly missing and invalid', () => {
    test('a verified token passes', async () => {
      const { nexted, status } = await runGate('enforce', ok);
      expect({ nexted, status }).toEqual({ nexted: true, status: null });
    });

    test('no token is 401 with a code of its OWN, never an auth code', async () => {
      const { nexted, status, body } = await runGate('enforce', none);
      expect(nexted).toBe(false);
      expect(status).toBe(401);
      expect(body.code).toBe('app-check-required');
      // Conflating it with an auth failure would send the client into a
      // sign-in flow that cannot fix an attestation problem.
      expect(JSON.stringify(body)).not.toMatch(/unauthenticated|invalid-token|auth\//i);
    });

    test('an invalid token is 401 with the same code', async () => {
      const { nexted, status, body } = await runGate('enforce', bad);
      expect({ nexted, status, code: body.code }).toEqual({
        nexted: false,
        status: 401,
        code: 'app-check-required',
      });
    });

    test('a BROKEN VERIFIER passes — a dead verifier must not be an outage', async () => {
      // The single most important row in this file. If this ever flips to a
      // refusal, a Google-side incident locks every user out of an app that
      // was working a minute earlier.
      const { nexted, status } = await runGate('enforce', broken);
      expect({ nexted, status }).toEqual({ nexted: true, status: null });
    });

    test('refusals are counted so a botched flip is visible without log diving', async () => {
      const { counters } = await runGate('enforce', none);
      expect(counters.refused).toBe(1);
    });
  });

  describe('off — the escape hatch', () => {
    test('nothing is verified and nothing is refused', async () => {
      const { nexted, status, req } = await runGate('off', bad);
      expect({ nexted, status }).toEqual({ nexted: true, status: null });
      expect(req.appCheck).toEqual({ outcome: 'off' });
    });
  });

  describe('the mode itself', () => {
    test('an UNSET mode defaults to monitor, never to enforce', async () => {
      // Defaulting to enforce would mean a deploy that forgot the variable
      // locks out every client that has not shipped attestation yet. The
      // rollout AC requires monitor first, so the default has to be the safe
      // one.
      delete process.env.APP_CHECK_MODE;
      jest.resetModules();
      const mod = require('../../src/middleware/app-check');
      expect(mod.appCheckMode()).toBe('monitor');
    });

    test('an UNRECOGNISED mode falls back to monitor and says so', async () => {
      process.env.APP_CHECK_MODE = 'enfroce'; // a real typo shape
      jest.resetModules();
      const mod = require('../../src/middleware/app-check');
      // Fails to the safe mode rather than guessing at the intent, and never
      // silently: a typo'd flip that quietly did nothing would look exactly
      // like a successful one.
      expect(mod.appCheckMode()).toBe('monitor');
    });

    test.each(['off', 'monitor', 'enforce'])('%s is honoured verbatim', async (mode) => {
      process.env.APP_CHECK_MODE = mode;
      jest.resetModules();
      expect(require('../../src/middleware/app-check').appCheckMode()).toBe(mode);
    });
  });
});
