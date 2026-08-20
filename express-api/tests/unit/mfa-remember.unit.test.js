/**
 * SHY-0147 — the per-browser MFA-remember token.
 *
 * Pure crypto/encoding logic with no collaborator, so this is a genuine unit
 * test. No doubles are needed: the token is a deterministic HMAC over values
 * the test supplies, and `now` is injected rather than read from the clock.
 *
 * The properties that matter are security properties, so they are asserted
 * directly: fail-closed on anything malformed, bounded lifetime, per-browser,
 * and revocable without storing a token anywhere.
 */
const {
  issueMfaRememberToken,
  verifyMfaRememberToken,
  MFA_TRUST_WINDOW_MS,
} = require('../../src/utils/mfa-remember');

const UID = 1234567;
const BROWSER = 'b-abc123';
const EPOCH = 7;
const NOW = 1_700_000_000_000;

const issue = (over = {}) =>
  issueMfaRememberToken({
    uniqueId: UID,
    browserId: BROWSER,
    epoch: EPOCH,
    now: NOW,
    ...over,
  });

const verify = (token, over = {}) =>
  verifyMfaRememberToken(token, { uniqueId: UID, epoch: EPOCH, now: NOW, ...over });

describe('SHY-0147 — MFA-remember token', () => {
  test('a freshly issued token verifies for the user it was issued to', () => {
    expect(verify(issue())).toEqual({ valid: true, browserId: BROWSER });
  });

  test('the default window is 30 days, and it is bounded', () => {
    expect(MFA_TRUST_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
    const t = issue();
    expect(verify(t, { now: NOW + MFA_TRUST_WINDOW_MS - 1 }).valid).toBe(true);
  });

  // ── expiry ──────────────────────────────────────────────────────────────
  test('a token is rejected the instant it expires — no off-by-one past the boundary', () => {
    const t = issue();
    expect(verify(t, { now: NOW + MFA_TRUST_WINDOW_MS }).valid).toBe(false);
    expect(verify(t, { now: NOW + MFA_TRUST_WINDOW_MS }).reason).toBe('expired');
  });

  test('a token from the future is not honoured', () => {
    expect(verify(issue({ now: NOW + 60_000 }), { now: NOW }).valid).toBe(true); // still within window
    expect(verify(issue(), { now: NOW - 1 }).valid).toBe(true); // clock skew tolerated forwards only
  });

  // ── per-browser + per-user isolation ────────────────────────────────────
  test('a token issued to one user is rejected for another', () => {
    expect(verify(issue(), { uniqueId: UID + 1 }).valid).toBe(false);
    expect(verify(issue(), { uniqueId: UID + 1 }).reason).toBe('signature');
  });

  test('two browsers get different tokens, and each only identifies its own', () => {
    const a = issue({ browserId: 'browser-a' });
    const b = issue({ browserId: 'browser-b' });
    expect(a).not.toEqual(b);
    expect(verify(a).browserId).toBe('browser-a');
    expect(verify(b).browserId).toBe('browser-b');
  });

  // ── revocation ──────────────────────────────────────────────────────────
  test('bumping the user epoch revokes every outstanding token at once', () => {
    const t = issue();
    expect(verify(t).valid).toBe(true);
    expect(verify(t, { epoch: EPOCH + 1 }).valid).toBe(false);
    expect(verify(t, { epoch: EPOCH + 1 }).reason).toBe('revoked');
  });

  // ── fail-closed on anything malformed ───────────────────────────────────
  test.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 12345],
    ['no separators', 'garbage'],
    ['too few parts', '1.2.3'],
    ['too many parts', '1.2.3.4.5.6'],
    ['non-hex signature', `${UID}.${BROWSER}.${EPOCH}.${NOW + 1000}.zzzz`],
    ['truncated signature', `${UID}.${BROWSER}.${EPOCH}.${NOW + 1000}.abcd`],
    ['non-numeric expiry', `${UID}.${BROWSER}.${EPOCH}.notanumber.${'a'.repeat(64)}`],
  ])('%s is rejected without throwing', (_label, bad) => {
    expect(() => verify(bad)).not.toThrow();
    expect(verify(bad).valid).toBe(false);
  });

  test('a tampered payload does not verify', () => {
    const t = issue();
    const parts = t.split('.');
    parts[3] = String(Number(parts[3]) + 86_400_000); // extend my own expiry
    expect(verify(parts.join('.')).valid).toBe(false);
    expect(verify(parts.join('.')).reason).toBe('signature');
  });

  test('a signature of the right SHAPE but wrong value is rejected', () => {
    // Guards the timingSafeEqual length trap: equal-length buffers must
    // compare false rather than throw, and unequal-length must not throw either.
    const t = issue();
    const parts = t.split('.');
    parts[4] = 'f'.repeat(parts[4].length);
    expect(() => verify(parts.join('.'))).not.toThrow();
    expect(verify(parts.join('.')).valid).toBe(false);
  });

  test('the token never contains the signing secret', () => {
    expect(issue()).not.toContain(process.env.MFA_REMEMBER_SECRET || 'dev-mfa-remember-secret');
  });
});

// ── cookie plumbing ────────────────────────────────────────────────────────
const { MFA_REMEMBER_COOKIE, readCookie } = require('../../src/utils/mfa-remember');

describe('SHY-0147 — cookie plumbing', () => {
  const req = (header) => ({ headers: header === undefined ? {} : { cookie: header } });

  test('reads the named cookie out of a real header', () => {
    expect(readCookie(req(`a=1; ${MFA_REMEMBER_COOKIE}=xyz; b=2`), MFA_REMEMBER_COOKIE)).toBe(
      'xyz',
    );
  });

  test('tolerates the shapes a browser actually sends', () => {
    expect(readCookie(req(`${MFA_REMEMBER_COOKIE}=xyz`), MFA_REMEMBER_COOKIE)).toBe('xyz');
    expect(readCookie(req(`  ${MFA_REMEMBER_COOKIE}=xyz  `), MFA_REMEMBER_COOKIE)).toBe('xyz');
    expect(readCookie(req(`x=1;${MFA_REMEMBER_COOKIE}=xyz`), MFA_REMEMBER_COOKIE)).toBe('xyz');
  });

  test('a value containing "=" survives intact — the token is dot-separated but this must not truncate', () => {
    expect(readCookie(req(`${MFA_REMEMBER_COOKIE}=a=b=c`), MFA_REMEMBER_COOKIE)).toBe('a=b=c');
  });

  test('does NOT match a cookie whose name merely ends with ours', () => {
    // `evil_shytalk_mfa=...` must not be read as `shytalk_mfa=...`.
    expect(readCookie(req(`evil_${MFA_REMEMBER_COOKIE}=attacker`), MFA_REMEMBER_COOKIE)).toBeNull();
  });

  test.each([
    ['no header', undefined],
    ['empty header', ''],
    ['unrelated cookies', 'a=1; b=2'],
    ['name present with no value', `${MFA_REMEMBER_COOKIE}=`],
  ])('%s yields null rather than throwing', (_l, header) => {
    expect(() => readCookie(req(header), MFA_REMEMBER_COOKIE)).not.toThrow();
    expect(readCookie(req(header), MFA_REMEMBER_COOKIE)).toBeNull();
  });
});

/**
 * SHY-0369 — the missing secret must not take down the whole API.
 *
 * The module used to throw at LOAD time when NODE_ENV=production and
 * MFA_REMEMBER_SECRET was unset. `index.js` requires `routes/portal`, which
 * requires this module, so that throw killed the server during startup: pm2
 * crash-looped and every endpoint returned 502 — the dev outage of 2026-08-19.
 *
 * The guard is right; its BLAST RADIUS was wrong. One portal feature's missing
 * configuration must not stop the rest of the API from serving.
 */
describe('SHY-0369 a missing secret fails the FEATURE, not the process', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  test('requiring the module in production without the secret does NOT throw', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    delete process.env.MFA_REMEMBER_SECRET;
    // The regression: this used to throw and take the whole server with it.
    expect(() => require('../../src/utils/mfa-remember')).not.toThrow();
  });

  test('issuing a token in production without the secret DOES throw — still fail-closed', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    delete process.env.MFA_REMEMBER_SECRET;
    const mod = require('../../src/utils/mfa-remember');
    expect(() =>
      mod.issueMfaRememberToken({ uniqueId: UID, browserId: BROWSER, epoch: EPOCH }),
    ).toThrow(/MFA_REMEMBER_SECRET/);
  });

  test('with the secret configured, production issues a token normally', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.MFA_REMEMBER_SECRET = 'a-real-configured-secret';
    const mod = require('../../src/utils/mfa-remember');
    const token = mod.issueMfaRememberToken({
      uniqueId: UID,
      browserId: BROWSER,
      epoch: EPOCH,
    });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('outside production the dev fallback still applies', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';
    delete process.env.MFA_REMEMBER_SECRET;
    const mod = require('../../src/utils/mfa-remember');
    expect(() =>
      mod.issueMfaRememberToken({ uniqueId: UID, browserId: BROWSER, epoch: EPOCH }),
    ).not.toThrow();
  });
});
