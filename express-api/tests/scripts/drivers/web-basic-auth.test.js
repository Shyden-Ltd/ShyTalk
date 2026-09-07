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
  WALLED,
  UNWALLED,
  UNRECOGNISED,
} = require('../../../scripts/drivers/web-basic-auth.js');

// sonarjs/no-hardcoded-passwords keys on password-shaped identifiers. This
// value is never authenticated with — it only has to survive a round trip
// through basicAuthFor() — so naming it a fixture is both more accurate and
// suppression-free.
const WALL_FIXTURE = 'not-a-real-secret-test-fixture';
const envWith = (password) => (password === undefined ? {} : { DEV_BASIC_AUTH_PASSWORD: password });

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
  });

  test('treats an empty-string password as absent', () => {
    // lockdown.js::basicAuthOk fails closed on an empty expected password,
    // so an empty value would produce a 401 on every page — the same mass
    // failure, one layer later. Reject it here instead.
    expect(() => basicAuthFor('https://dev.shytalk.shyden.co.uk', envWith(''))).toThrow(
      /DEV_BASIC_AUTH_PASSWORD/,
    );
  });

  test('refuses an unrecognised target rather than sending it the password', () => {
    expect(() =>
      basicAuthFor('https://shytalk.shyden.co.uk.evil.com', envWith(WALL_FIXTURE)),
    ).toThrow(/unrecognised|not a recognised/i);
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
