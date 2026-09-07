/**
 * web-basic-auth.js — target classification + credential resolution (SHY-0529)
 *
 * The dev journey matrix run 20260906-184009-dev reported 0 passed /
 * 559 failed. Root cause: every non-prod ShyTalk web host sits behind the
 * Cloudflare Pages HTTP Basic wall (functions/_lib/lockdown.js), and the
 * Playwright driver created its browser contexts without credentials, so
 * every page.goto() returned 401.
 *
 * These tests pin the *decision* — which targets are walled — separately
 * from the driver that acts on it, because the decision is the part with
 * a security consequence: classify a hostile lookalike as "walled" and we
 * post the dev password to it.
 *
 * The prod predicate is NOT restated here; it is imported from the wall
 * itself so the two cannot drift apart.
 */

const {
  classifyWebTarget,
  basicAuthFor,
  describeWebTarget,
  assertWallAccepts,
  BASIC_AUTH_ENV_VAR,
  WALLED,
  UNWALLED,
  UNRECOGNISED,
} = require('../../../scripts/drivers/web-basic-auth.js');
// The consumer of the error code, imported so these tests assert the seam
// (does the matrix classify this as setup failure?) and not merely one side
// of it (is a string property set?).
const { isInitError } = require('../../../scripts/matrix-dispatch');

// sonarjs/no-hardcoded-passwords keys on password-shaped identifiers. This
// value is never authenticated with — it only has to survive a round trip
// through basicAuthFor() — so naming it a fixture is both more accurate and
// suppression-free.
const WALL_FIXTURE = 'not-a-real-secret-test-fixture';
const envWith = (password) => (password === undefined ? {} : { DEV_BASIC_AUTH_PASSWORD: password });

// SHY-0529 AC5: a wall failure is a broken ENVIRONMENT, not a broken product.
// manual-qa-runner's top-level catch routes every throw through
// matrix-dispatch's classifyCrashExit; only errors isInitError() accepts get
// the reserved exit 3 that makes matrix-cell-dispatch mark the cell 'skip'
// instead of 'fail'. Both halves are asserted deliberately: err.code forbids
// the wrong fix (bolting another regex onto INIT_ERROR_SIGNATURES), and
// isInitError forbids a sentinel rename that leaves the code cosmetic.
const expectClassifiedAsSetupFailure = (err) => {
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('DRIVER_INIT_FAILED');
  expect(isInitError(err)).toBe(true);
};

const catchThrown = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw, but it returned');
};

describe('web-basic-auth — classifyWebTarget', () => {
  test('the live public site is unwalled', () => {
    expect(classifyWebTarget('https://shytalk.shyden.co.uk')).toBe(UNWALLED);
  });

  test('the live public site is recognised regardless of letter casing', () => {
    // Hostnames are case-insensitive. If casing defeated the prod check we
    // would classify prod as walled and post the dev password to the live
    // site — the single worst outcome available to this module.
    expect(classifyWebTarget('https://ShyTalk.Shyden.Co.UK/')).toBe(UNWALLED);
  });

  test('local development addresses are unwalled', () => {
    // The wall is Cloudflare Pages middleware; a local server never runs it.
    expect(classifyWebTarget('http://localhost:8888')).toBe(UNWALLED);
    expect(classifyWebTarget('http://127.0.0.1:8888/')).toBe(UNWALLED);
    expect(classifyWebTarget('http://[::1]:8888/')).toBe(UNWALLED);
    // 0.0.0.0 is a loopback bind address under test, not a URL anything
    // connects to. The directive must be the LAST line before the code it
    // covers — a wrapped reason comment would absorb it.
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(classifyWebTarget('http://0.0.0.0:8888')).toBe(UNWALLED);
  });

  test('the dev site is walled', () => {
    expect(classifyWebTarget('https://dev.shytalk.shyden.co.uk')).toBe(WALLED);
  });

  test('a Cloudflare Pages preview deployment is walled', () => {
    // Both projects: a preview of the *prod* project is still walled,
    // because isProdHostname is exact-match and a preview host is never
    // exactly shytalk.shyden.co.uk.
    expect(classifyWebTarget('https://abc1234.shytalk-site-dev.pages.dev')).toBe(WALLED);
    expect(classifyWebTarget('https://abc1234.shytalk-site.pages.dev')).toBe(WALLED);
  });

  test('a lookalike host that merely contains the prod name is refused', () => {
    // The wall guards this direction with exact equality so a hostile host
    // cannot claim to be prod. The client must guard the mirror image: a
    // hostile host must not be handed the dev password either.
    expect(classifyWebTarget('https://shytalk.shyden.co.uk.evil.com')).toBe(UNRECOGNISED);
    expect(classifyWebTarget('https://dev.shytalk.shyden.co.uk.evil.com')).toBe(UNRECOGNISED);
    expect(classifyWebTarget('https://fake.shytalk-site.pages.dev.evil.com')).toBe(UNRECOGNISED);
  });

  test('a bare-label near miss does not satisfy the ShyTalk suffix', () => {
    // "evil-shytalk.shyden.co.uk" ends with "shytalk.shyden.co.uk" as a
    // substring but not on a label boundary.
    expect(classifyWebTarget('https://evil-shytalk.shyden.co.uk')).toBe(UNRECOGNISED);
    expect(classifyWebTarget('https://notshytalk-site.pages.dev')).toBe(UNRECOGNISED);
  });

  test('the company marketing site is not a matrix target and is refused', () => {
    expect(classifyWebTarget('https://shyden.co.uk')).toBe(UNRECOGNISED);
    expect(classifyWebTarget('https://www.shyden.co.uk')).toBe(UNRECOGNISED);
  });

  test('an unparseable or empty address is refused, never defaulted', () => {
    expect(classifyWebTarget('not a url')).toBe(UNRECOGNISED);
    expect(classifyWebTarget('')).toBe(UNRECOGNISED);
    expect(classifyWebTarget(undefined)).toBe(UNRECOGNISED);
    expect(classifyWebTarget(null)).toBe(UNRECOGNISED);
  });
});

describe('web-basic-auth — basicAuthFor', () => {
  test('supplies credentials for a walled target', () => {
    expect(basicAuthFor('https://dev.shytalk.shyden.co.uk', envWith(WALL_FIXTURE))).toEqual({
      username: 'dev',
      password: WALL_FIXTURE,
    });
  });

  test('supplies nothing for an unwalled target even when a password is set', () => {
    // Having the password in the environment must not cause it to be sent
    // to prod or to a local server.
    expect(basicAuthFor('https://shytalk.shyden.co.uk', envWith(WALL_FIXTURE))).toBeUndefined();
    expect(basicAuthFor('http://localhost:8888', envWith(WALL_FIXTURE))).toBeUndefined();
  });

  test('throws an actionable error when a walled target has no password', () => {
    // The loud-failure half of SHY-0529: without this, a missing password
    // reproduces the original 0/559 mass failure with no stated cause.
    expect(() => basicAuthFor('https://dev.shytalk.shyden.co.uk', envWith(undefined))).toThrow(
      /dev\.shytalk\.shyden\.co\.uk/,
    );
    expect(() => basicAuthFor('https://dev.shytalk.shyden.co.uk', envWith(undefined))).toThrow(
      /DEV_BASIC_AUTH_PASSWORD/,
    );
    expectClassifiedAsSetupFailure(
      catchThrown(() => basicAuthFor('https://dev.shytalk.shyden.co.uk', envWith(undefined))),
    );
  });

  test('treats an empty-string password as absent', () => {
    // lockdown.js::basicAuthOk fails closed on an empty expected password,
    // so an empty value would produce a 401 on every page — the same mass
    // failure, one layer later. Reject it here instead.
    expect(() => basicAuthFor('https://dev.shytalk.shyden.co.uk', envWith(''))).toThrow(
      /DEV_BASIC_AUTH_PASSWORD/,
    );
    expectClassifiedAsSetupFailure(
      catchThrown(() => basicAuthFor('https://dev.shytalk.shyden.co.uk', envWith(''))),
    );
  });

  test('refuses an unrecognised target rather than sending it the password', () => {
    expect(() =>
      basicAuthFor('https://shytalk.shyden.co.uk.evil.com', envWith(WALL_FIXTURE)),
    ).toThrow(/unrecognised|not a recognised/i);
    expectClassifiedAsSetupFailure(
      catchThrown(() =>
        basicAuthFor('https://shytalk.shyden.co.uk.evil.com', envWith(WALL_FIXTURE)),
      ),
    );
  });

  test('the error text never contains the password', () => {
    // A thrown error is printed to the runner log and can end up in an
    // artefact. It must name the variable, never its value.
    let message = '';
    try {
      basicAuthFor('https://shytalk.shyden.co.uk.evil.com', envWith(WALL_FIXTURE));
    } catch (err) {
      message = err.message;
    }
    expect(message).not.toContain(WALL_FIXTURE);
  });

  test('reads process.env by default', () => {
    const original = process.env.DEV_BASIC_AUTH_PASSWORD;
    process.env.DEV_BASIC_AUTH_PASSWORD = WALL_FIXTURE;
    try {
      expect(basicAuthFor('https://dev.shytalk.shyden.co.uk')).toEqual({
        username: 'dev',
        password: WALL_FIXTURE,
      });
    } finally {
      if (original === undefined) delete process.env.DEV_BASIC_AUTH_PASSWORD;
      else process.env.DEV_BASIC_AUTH_PASSWORD = original;
    }
  });
});

/**
 * SHY-0529 observability AC: "the run's startup output records whether the
 * target was treated as walled, unwalled, or refused ... names the target
 * address and the classification only, never the password."
 *
 * describeWebTarget() returns the line instead of printing it, so these tests
 * assert the text directly rather than through a console spy — a spy would pin
 * the stream (a formatting choice) alongside the wording (the contract).
 */
describe('describeWebTarget', () => {
  it('names the address and reports a walled target as walled', () => {
    const line = describeWebTarget('https://dev.shytalk.shyden.co.uk');
    expect(line).toContain('dev.shytalk.shyden.co.uk');
    expect(line).toContain('walled');
  });

  it('reports the live site as unwalled, not merely "not walled"', () => {
    const line = describeWebTarget('https://shytalk.shyden.co.uk');
    expect(line).toContain('shytalk.shyden.co.uk');
    expect(line).toContain('unwalled');
  });

  it('reports a loopback target as unwalled', () => {
    expect(describeWebTarget('http://localhost:8888')).toContain('unwalled');
  });

  it('reports a lookalike address as refused', () => {
    const line = describeWebTarget('https://shytalk.shyden.co.uk.evil.example.com');
    expect(line).toContain('refused');
  });

  it('never echoes an unparseable address back into the log', () => {
    // An unparseable string could be anything the operator typed, including a
    // URL carrying inline credentials. Classification is still reportable; the
    // input is not.
    const line = describeWebTarget('https://dev:hunter2@@@not a url');
    expect(line).toContain('refused');
    expect(line).not.toContain('hunter2');
  });

  it('never contains the password, even when one is set', () => {
    const line = describeWebTarget('https://dev.shytalk.shyden.co.uk');
    // The env var *name* is a useful diagnostic; its value never is.
    expect(line).not.toContain(WALL_FIXTURE);
  });
});

/**
 * SHY-0529 error-path AC: "given a password is supplied but the wall rejects
 * it, when the run starts, then the failure names the rejected password as the
 * cause rather than reporting hundreds of unrelated scenario failures."
 *
 * The wall is real (functions/_lib/lockdown.js returns 401 with a
 * WWW-Authenticate challenge); fetch is injected here so the *reaction* to each
 * status is pinned without a network. Per the mocked-collaborator rule, the
 * arguments are asserted too — a fake that only records "was called" could not
 * report a probe sent without its Authorization header.
 */
describe('assertWallAccepts', () => {
  const CREDS = { username: 'dev', password: WALL_FIXTURE };
  const expectedHeader = `Basic ${Buffer.from(`dev:${WALL_FIXTURE}`).toString('base64')}`;

  it('sends one authenticated GET to the target and resolves on 200', async () => {
    const calls = [];
    const fetchImpl = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve({ status: 200 });
    };
    await expect(
      assertWallAccepts('https://dev.shytalk.shyden.co.uk', CREDS, { fetchImpl }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe('https://dev.shytalk.shyden.co.uk');
    expect(init.method).toBe('GET');
    expect(init.headers.authorization).toBe(expectedHeader);
  });

  it('throws on 401, naming the variable to fix and the target', async () => {
    const fetchImpl = () => Promise.resolve({ status: 401 });
    await expect(
      assertWallAccepts('https://dev.shytalk.shyden.co.uk', CREDS, { fetchImpl }),
    ).rejects.toThrow(/DEV_BASIC_AUTH_PASSWORD/);
  });

  it('classifies a 401 as a setup failure, so the matrix skips rather than fails', async () => {
    const fetchImpl = () => Promise.resolve({ status: 401 });
    const err = await assertWallAccepts('https://dev.shytalk.shyden.co.uk', CREDS, {
      fetchImpl,
    }).catch((e) => e);
    expectClassifiedAsSetupFailure(err);
  });

  it('does not put the rejected password itself into the failure', async () => {
    const fetchImpl = () => Promise.resolve({ status: 401 });
    // "Names the rejected password as the cause" means names the *variable*.
    // The security AC forbids the value from reaching any error message.
    // Caught by hand rather than with .rejects.toThrow(asymmetricMatcher): a
    // negative matcher that jest silently ignored would pass while asserting
    // nothing, which is the failure mode this test exists to rule out.
    let caught;
    try {
      await assertWallAccepts('https://dev.shytalk.shyden.co.uk', CREDS, { fetchImpl });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).not.toContain(WALL_FIXTURE);
    expect(caught.message).toContain(BASIC_AUTH_ENV_VAR);
  });

  it('proceeds on a non-401 status, which does not prove the password wrong', async () => {
    const fetchImpl = () => Promise.resolve({ status: 503 });
    await expect(
      assertWallAccepts('https://dev.shytalk.shyden.co.uk', CREDS, { fetchImpl }),
    ).resolves.toBeUndefined();
  });

  it('proceeds when the probe itself fails, rather than inventing a new abort', async () => {
    // Offline, DNS failure, timeout. Aborting here would turn a transient
    // network blip into a dead run — a new mass-failure mode, which is the
    // thing this ticket exists to remove, not add.
    const fetchImpl = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));
    await expect(
      assertWallAccepts('https://dev.shytalk.shyden.co.uk', CREDS, { fetchImpl }),
    ).resolves.toBeUndefined();
  });

  it('sends nothing at all when the target needs no credentials', async () => {
    let called = false;
    const fetchImpl = () => {
      called = true;
      return Promise.resolve({ status: 200 });
    };
    await assertWallAccepts('http://localhost:8888', undefined, { fetchImpl });
    expect(called).toBe(false);
  });
});
