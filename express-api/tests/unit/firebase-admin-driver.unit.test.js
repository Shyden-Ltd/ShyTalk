/**
 * Firebase Auth revocation checks, SHY-0259.
 *
 * These two assertions are the harness's only view of a SECURITY control:
 * when a user is suspended (j11) or their DOB is corrected down into the
 * minor cohort (j04), their existing sessions must stop working. A stale
 * refresh token that still mints ID tokens is the difference between
 * "suspended" and "suspended on the screen only".
 *
 * The dangerous implementation is the obvious one — treat the presence of
 * `tokensValidAfterTime` as revocation. EVERY Firebase user has that field,
 * so that check passes for every account in the project and the assertion
 * becomes unconditionally green. The tests below exist mostly to rule that
 * out.
 *
 * `auth` here is a captured-shape fixture, not a mock collaborator: it
 * returns the exact `getUser` payload the Admin SDK returns, and the logic
 * under test is pure comparison. The real SDK is exercised end to end by the
 * journey corpus against the emulator.
 */
const { createFirebaseAdminDriver } = require('../../scripts/drivers/firebase-admin-driver');

const SIGNED_IN_AT = Date.parse('2026-08-01T10:00:00.000Z');
const AFTER = new Date(SIGNED_IN_AT + 60_000).toISOString();
const BEFORE = new Date(SIGNED_IN_AT - 60_000).toISOString();

/** Auth whose getUser returns a fixed tokensValidAfterTime. */
const authReturning = (tokensValidAfterTime) => ({
  getUser: async () => ({ uid: 'u1', tokensValidAfterTime }),
});

const sessionsWith = (extra = {}) =>
  new Map([['Raul', { localId: 'u1', signedInAt: SIGNED_IN_AT, ...extra }]]);

describe('construction refuses to be half-configured', () => {
  it('requires an auth instance', () => {
    expect(() => createFirebaseAdminDriver({ sessions: new Map() })).toThrow(/auth is required/);
  });

  it('requires a sessions map', () => {
    expect(() => createFirebaseAdminDriver({ auth: authReturning(AFTER) })).toThrow(
      /sessions map is required/,
    );
  });
});

describe('tokensAreRevoked', () => {
  it('is true when the revocation instant is AFTER the session began', () => {
    const d = createFirebaseAdminDriver({ auth: authReturning(AFTER), sessions: sessionsWith() });
    return expect(d.tokensAreRevoked('Raul')).resolves.toBe(true);
  });

  it('is FALSE when the revocation predates the session', async () => {
    // The critical negative. A user revoked last week then signed in today
    // holds a perfectly valid token — reporting them as revoked would let a
    // suspension scenario pass without the product having done anything.
    const d = createFirebaseAdminDriver({ auth: authReturning(BEFORE), sessions: sessionsWith() });
    await expect(d.tokensAreRevoked('Raul')).resolves.toBe(false);
  });

  it('is false when Auth has never set the field', async () => {
    const d = createFirebaseAdminDriver({
      auth: authReturning(undefined),
      sessions: sessionsWith(),
    });
    await expect(d.tokensAreRevoked('Raul')).resolves.toBe(false);
  });

  it('is false at the exact instant of sign-in — strictly after, not at-or-after', async () => {
    // A token minted at the same millisecond is still valid; `>=` would
    // report every freshly signed-in user as revoked.
    const sameMs = new Date(SIGNED_IN_AT).toISOString();
    const d = createFirebaseAdminDriver({ auth: authReturning(sameMs), sessions: sessionsWith() });
    await expect(d.tokensAreRevoked('Raul')).resolves.toBe(false);
  });

  it('does not treat an unparseable timestamp as a revocation', async () => {
    const d = createFirebaseAdminDriver({
      auth: authReturning('not a date'),
      sessions: sessionsWith(),
    });
    await expect(d.tokensAreRevoked('Raul')).resolves.toBe(false);
  });
});

describe('revokeTimestampIsUpdated', () => {
  it('is true when the timestamp moved after the session began', async () => {
    const d = createFirebaseAdminDriver({ auth: authReturning(AFTER), sessions: sessionsWith() });
    await expect(d.revokeTimestampIsUpdated('Raul')).resolves.toBe(true);
  });

  it('is false for a revocation that happened before this scenario', async () => {
    const d = createFirebaseAdminDriver({ auth: authReturning(BEFORE), sessions: sessionsWith() });
    await expect(d.revokeTimestampIsUpdated('Raul')).resolves.toBe(false);
  });

  it('anchors on signedInAt, not on a baseline read at assertion time', async () => {
    // The bug this rules out: capturing the baseline lazily, on the FIRST
    // assertion, reads it AFTER the revocation the scenario just performed.
    // Before and after are then equal, a genuine revocation reports "not
    // updated", and the failure looks like a product bug in the revocation
    // path — the most misleading possible answer for a security control.
    let reads = 0;
    const auth = {
      getUser: async () => {
        reads += 1;
        return { uid: 'u1', tokensValidAfterTime: AFTER };
      },
    };
    const d = createFirebaseAdminDriver({ auth, sessions: sessionsWith() });
    await expect(d.revokeTimestampIsUpdated('Raul')).resolves.toBe(true);
    // One read, and the answer came from signedInAt — not from a second
    // observation that would have been taken too late to mean anything.
    expect(reads).toBe(1);
  });
});

describe('a missing session is a named refusal, not an answer', () => {
  it('throws for a persona who never signed in', async () => {
    // Returning false would be indistinguishable from "checked, not revoked",
    // and the scenario would report the product failing to revoke a session
    // that was never created.
    const d = createFirebaseAdminDriver({ auth: authReturning(AFTER), sessions: new Map() });
    await expect(d.tokensAreRevoked('Ghost')).rejects.toThrow(/no signed-in session for "Ghost"/);
  });

  it('throws when the session carries no Firebase uid', async () => {
    const d = createFirebaseAdminDriver({
      auth: authReturning(AFTER),
      sessions: new Map([['Raul', { signedInAt: SIGNED_IN_AT }]]),
    });
    await expect(d.tokensAreRevoked('Raul')).rejects.toThrow(/carries no Firebase uid/);
  });

  it('reads sessions LIVE, so a sign-in during the scenario is seen', async () => {
    // ctx.sessions is empty when the driver is constructed — sign-in Givens
    // populate it as the scenario runs. A snapshot taken at construction
    // would make every revocation assertion throw "no signed-in session".
    const sessions = new Map();
    const d = createFirebaseAdminDriver({ auth: authReturning(AFTER), sessions });
    await expect(d.tokensAreRevoked('Raul')).rejects.toThrow(/no signed-in session/);
    sessions.set('Raul', { localId: 'u1', signedInAt: SIGNED_IN_AT });
    await expect(d.tokensAreRevoked('Raul')).resolves.toBe(true);
  });
});

describe('falling back when a session predates the signedInAt stamp', () => {
  it('uses an explicitly captured baseline', async () => {
    // A persona signed in by a path that does not stamp signedInAt still gets
    // a correct answer, provided the baseline was captured before the
    // revocation.
    let current = BEFORE;
    const auth = { getUser: async () => ({ uid: 'u1', tokensValidAfterTime: current }) };
    const sessions = new Map([['Raul', { localId: 'u1' }]]);
    const d = createFirebaseAdminDriver({ auth, sessions });
    await d.captureBaseline('Raul');
    await expect(d.tokensAreRevoked('Raul')).resolves.toBe(false);
    current = AFTER;
    await expect(d.tokensAreRevoked('Raul')).resolves.toBe(true);
  });

  it('captureBaseline keeps the FIRST observation', async () => {
    let current = BEFORE;
    const auth = { getUser: async () => ({ uid: 'u1', tokensValidAfterTime: current }) };
    const d = createFirebaseAdminDriver({ auth, sessions: new Map([['Raul', { localId: 'u1' }]]) });
    const first = await d.captureBaseline('Raul');
    current = AFTER;
    await expect(d.captureBaseline('Raul')).resolves.toBe(first);
  });
});

describe('diagnostics', () => {
  it('exposes the raw instant so a failure message can name it', async () => {
    const d = createFirebaseAdminDriver({ auth: authReturning(AFTER), sessions: sessionsWith() });
    await expect(d.tokensValidAfter('Raul')).resolves.toBe(Date.parse(AFTER));
  });

  it('closes without error', async () => {
    const d = createFirebaseAdminDriver({ auth: authReturning(AFTER), sessions: sessionsWith() });
    await expect(d.close()).resolves.toBeUndefined();
  });
});
