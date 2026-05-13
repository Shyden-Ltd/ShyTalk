/**
 * Tests for the PM-lock first-of-day auto-unlock endpoint.
 *
 *   POST /api/users/:uniqueId/pm-lock-check
 *
 * Called by the client AFTER successful sign-in. Server-side because
 * Firestore rules deny client writes to `pmLocked` / `lastPmLockCheck`
 * (PR 11 spec — those are server-only). The endpoint reads the user
 * doc, decides whether the lock should lift (user has aged in to 18+
 * since the lock was applied), and writes the unlock atomically.
 *
 * Throttling: skips the calendar age recompute when
 * `lastPmLockCheck` is in the same UTC day as `now()`. Saves the
 * Firestore quota on active users without taking a daily-cron hit
 * for dormant accounts (per the user's "minimize Firestore ops" rule
 * and the 2026-05-04 spec answer #4).
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ─────────────────────────────────────────────────

const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();
const mockSetCustomUserClaims = jest.fn().mockResolvedValue();
const mockGetUser = jest.fn().mockResolvedValue({ customClaims: {} });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({ _path: path })),
    runTransaction: jest.fn(async (fn) => {
      return fn({
        get: (ref) => mockTxGet(ref?._path),
        update: (ref, payload) => mockTxUpdate(ref?._path, payload),
      });
    }),
  },
  auth: {
    setCustomUserClaims: (...args) => mockSetCustomUserClaims(...args),
    getUser: (...args) => mockGetUser(...args),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  // Pinned to a fixed timestamp so the day-bucket calculation is
  // deterministic across runs. 2026-05-04T12:00:00Z = 1777896000000.
  now: () => 1777896000000,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const pmLockRouter = require('../../src/routes/pm-lock-check');

function createApp({ uniqueId = 10000050 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'fb-uid', uniqueId, token: {} };
    next();
  });
  app.use('/api', pmLockRouter);
  return app;
}

const TODAY_UTC_START = Date.UTC(2026, 4, 4); // 2026-05-04 00:00:00 UTC
const YESTERDAY_UTC_START = TODAY_UTC_START - 86_400_000;

function dobYearsAgo(years) {
  const d = new Date('2026-05-04T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.getTime();
}

// ── Happy path: aged-in user gets unlocked ──────────────────────

describe('POST /api/users/:uniqueId/pm-lock-check', () => {
  test('unlocks pmLocked=true user who is now 18+ and has not been checked today', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(18), // just turned 18
        pmLocked: true,
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({ pmLocked: false, unlocked: true });
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ pmLocked: false, lastPmLockCheck: 1777896000000 }),
    );
  });

  test('keeps lock for sub-18 user but updates lastPmLockCheck (throttle)', async () => {
    // 16-y/o user: still locked but the day-bucket bump means we don't
    // re-scan again until tomorrow. Pin the no-unlock + throttle bump.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(16),
        pmLocked: true,
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({ pmLocked: true, unlocked: false });
    // The doc is still updated — but only the throttle stamp, not the lock state
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ lastPmLockCheck: 1777896000000 }),
    );
    // Verify pmLocked was NOT downgraded
    const updateArgs = mockTxUpdate.mock.calls[0][1];
    expect(updateArgs.pmLocked).not.toBe(false);
  });

  test('skips Firestore write when already checked today (idempotent + cheap)', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(20),
        pmLocked: true,
        lastPmLockCheck: TODAY_UTC_START + 100, // earlier today
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({ pmLocked: true, unlocked: false, alreadyCheckedToday: true });
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('no-op for users who are not pmLocked AND already cohort=adult (hot path)', async () => {
    // The hot-path no-op now also requires `cohort: 'adult'` — a
    // legacy adult-user doc that predates UK OSA #17 (cohort field
    // absent) falls through to the write branch to backfill cohort.
    // See sibling test 'cohort backfilled from absent field ...' for
    // that case; this test pins the all-correct-state no-op.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(25),
        pmLocked: false,
        cohort: 'adult',
        lastPmLockCheck: null,
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({ pmLocked: false, unlocked: false });
    // No Firestore write at all — already-correct state means no
    // throttle bump either, dormant adult accounts pay zero quota.
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('rejects request from a different user (uniqueId mismatch)', async () => {
    // /api/users/10000050/pm-lock-check called by user 10000099 →
    // 403. Defends against a malicious client unlocking another
    // user's PMs (would be moot since rules deny client writes
    // anyway, but gate at the route layer too — defence in depth).
    const app = createApp({ uniqueId: 10000099 });
    await request(app).post('/api/users/10000050/pm-lock-check').expect(403);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('returns 404 for missing user doc', async () => {
    mockTxGet.mockResolvedValue({ exists: false });
    const app = createApp();
    await request(app).post('/api/users/10000050/pm-lock-check').expect(404);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('null DOB → no unlock, throttle bumped', async () => {
    // Null DOB users are routed to RequiredDOBScreen / blocked at
    // sign-in (PR 5b). If somehow they reach this endpoint, just
    // bump the throttle stamp and don't touch lock state.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({ dateOfBirth: null, pmLocked: true, lastPmLockCheck: null }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);
    expect(res.body).toMatchObject({ pmLocked: true, unlocked: false });
  });

  // ── Segregation cohort (UK OSA #17, PR 1) ──────────────────────
  // Same first-of-day check that flips pmLocked also writes
  // `cohort` ("minor" | "adult") derived from `>=18y`. Re-uses
  // `lastPmLockCheck` throttle stamp. Spec:
  // `.project/plans/2026-05-13-age-segregation-design.md`.

  test('cohort flips minor→adult when sub-18 user has aged in', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(18),
        pmLocked: true,
        cohort: 'minor',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      pmLocked: false,
      unlocked: true,
      cohort: 'adult',
      cohortChanged: true,
    });
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({
        pmLocked: false,
        cohort: 'adult',
        lastPmLockCheck: 1777896000000,
      }),
    );
  });

  test('cohort flips adult→minor when admin DOB-modify drops user under 18', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(17),
        pmLocked: true,
        cohort: 'adult',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      pmLocked: true,
      unlocked: false,
      cohort: 'minor',
      cohortChanged: true,
    });
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({
        cohort: 'minor',
        lastPmLockCheck: 1777896000000,
      }),
    );
  });

  test('cohort write skipped when minor user is still minor (no-op write branch)', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(16),
        pmLocked: true,
        cohort: 'minor',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      pmLocked: true,
      unlocked: false,
      cohort: 'minor',
      cohortChanged: false,
    });
    const updateArgs = mockTxUpdate.mock.calls[0][1];
    expect(updateArgs.lastPmLockCheck).toBe(1777896000000);
    expect(updateArgs).not.toHaveProperty('pmLocked');
    expect(updateArgs).not.toHaveProperty('cohort');
  });

  test('cohort backfilled from absent field when adult user first hits the check', async () => {
    // Legacy 19-y/o user whose doc predates UK OSA #17 — `cohort` is
    // missing entirely. Must backfill to adult.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(19),
        pmLocked: false,
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      pmLocked: false,
      unlocked: false,
      cohort: 'adult',
      cohortChanged: true,
    });
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ cohort: 'adult', lastPmLockCheck: 1777896000000 }),
    );
  });

  test('already-adult unlocked user is full no-op (no write, no throttle bump)', async () => {
    // Hot path: 25-y/o user, pmLocked=false, cohort=adult.
    // No work needed — no doc write, no throttle bump.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(25),
        pmLocked: false,
        cohort: 'adult',
        lastPmLockCheck: null,
      }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      pmLocked: false,
      unlocked: false,
      cohort: 'adult',
      cohortChanged: false,
    });
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('same-day throttle preserves cohort field in response', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(20),
        pmLocked: true,
        cohort: 'adult',
        lastPmLockCheck: TODAY_UTC_START + 100,
      }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      pmLocked: true,
      unlocked: false,
      alreadyCheckedToday: true,
      cohort: 'adult',
      cohortChanged: false,
    });
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('null DOB defaults cohort to minor (most-restrictive)', async () => {
    // Spec § Edge cases: "User signs up with DOB unset → Treated as
    // cohort = 'minor' — most-restrictive default."
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: null,
        pmLocked: true,
        cohort: 'adult',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body.cohort).toBe('minor');
    expect(res.body.cohortChanged).toBe(true);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ cohort: 'minor', lastPmLockCheck: 1777896000000 }),
    );
  });

  test('epoch-zero DOB (1970-01-01) computes as adult — integer-boundary sanity', async () => {
    // Lower-edge integer DOB. 1970-01-01 epoch zero is ~56 years
    // before the pinned `now()` → adult. Guards against any signed/
    // unsigned arithmetic mishap in isAtLeast18FromDob's UTC age
    // math that might mis-handle the zero / pre-epoch boundary.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: 0,
        pmLocked: true,
        cohort: 'minor',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      pmLocked: false,
      unlocked: true,
      cohort: 'adult',
      cohortChanged: true,
    });
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ pmLocked: false, cohort: 'adult' }),
    );
  });

  // ── Custom claim mint + forceTokenRefresh (UK OSA #17, PR 2) ─────
  //
  // The cohort field write (covered above in PR 1 tests) is only HALF
  // the gate. The Firestore rules-layer reads `request.auth.token.cohort`
  // — the custom claim — not the field. PR 2 wires the mint so the
  // claim follows the field, AND surfaces `forceTokenRefresh: true`
  // in the response so the client rotates its JWT before the next
  // Firestore read. Without that round-trip the rules-layer remains
  // stale until the 1-hour JWT auto-refresh, opening a cross-cohort
  // read window — see segregation design doc § Edge cases.

  test('mints merged cohort claim on minor→adult flip + returns forceTokenRefresh:true', async () => {
    // 17-y/o admin moderator who has just aged in. The claim merge
    // must preserve admin:true AND set cohort:adult. The response
    // tells the client to drop its cached JWT and rotate.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(18),
        pmLocked: true,
        cohort: 'minor',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    mockGetUser.mockResolvedValue({
      uid: 'fb-uid',
      customClaims: { uniqueId: 10000050, admin: true },
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      cohort: 'adult',
      cohortChanged: true,
      forceTokenRefresh: true,
    });
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid', {
      uniqueId: 10000050,
      admin: true,
      cohort: 'adult',
    });
  });

  test('mints merged cohort claim on adult→minor flip + returns forceTokenRefresh:true', async () => {
    // Edge case: admin DOB-modify dropped the user under 18 since
    // the last check. Reverse flip path — claim and field both
    // need to march to minor.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(17),
        pmLocked: true,
        cohort: 'adult',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    mockGetUser.mockResolvedValue({
      uid: 'fb-uid',
      customClaims: { uniqueId: 10000050 },
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body).toMatchObject({
      cohort: 'minor',
      cohortChanged: true,
      forceTokenRefresh: true,
    });
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-uid',
      expect.objectContaining({ cohort: 'minor' }),
    );
  });

  test('no claim mint when cohort unchanged in write branch (pmLocked-only flip)', async () => {
    // Sub-18 user who is still minor; the write branch fires (cohort
    // backfill or pmLocked correction) but cohort doesn't change.
    // Minting a fresh claim here wastes Firebase quota.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(16),
        pmLocked: true,
        cohort: 'minor',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body.cohortChanged).toBe(false);
    expect(res.body.forceTokenRefresh ?? false).toBe(false);
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  test('no claim mint on same-day throttle (idempotent skip)', async () => {
    // Already checked today: the route returns early, no Firestore
    // write AND no claim mint. Stops a flapping client from DOSing
    // Firebase's claim-mint quota.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(20),
        pmLocked: false,
        cohort: 'adult',
        lastPmLockCheck: TODAY_UTC_START + 100,
      }),
    });

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(res.body.alreadyCheckedToday).toBe(true);
    expect(res.body.forceTokenRefresh ?? false).toBe(false);
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  test('no claim mint on hot-path no-op (adult + unlocked, no state drift)', async () => {
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(25),
        pmLocked: false,
        cohort: 'adult',
        lastPmLockCheck: null,
      }),
    });

    const app = createApp();
    await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  test('mint failure does NOT roll back the Firestore cohort write (logged, surfaced)', async () => {
    // Partial-failure contract: the Firestore field IS the source of
    // truth. A mint failure leaves the JWT stale (rules layer lags
    // up to the 1-hour Firebase JWT auto-refresh) but Express + KMP
    // read the fresh field. Per `feedback-partial-failure-contracts`,
    // surface the failure via a per-action flag instead of a 500.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(18),
        pmLocked: true,
        cohort: 'minor',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    mockGetUser.mockResolvedValue({ customClaims: {} });
    mockSetCustomUserClaims.mockRejectedValueOnce(new Error('auth/quota-exceeded'));

    const app = createApp();
    const res = await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    // Field write committed regardless of mint failure
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ cohort: 'adult' }),
    );
    // Cohort field changed but client should NOT be told to refresh
    // (the stale claim would refresh to the same stale value — the
    // server-side mint failed before Firebase Auth's store updated)
    expect(res.body.cohortChanged).toBe(true);
    expect(res.body.forceTokenRefresh).toBe(false);
    expect(res.body.claimMintFailed).toBe(true);
  });

  test('cohortOverride wins: claim minted with override even when DOB-derived cohort differs', async () => {
    // Admin-set override on a moderator account. Even though the DOB
    // would derive minor, the override pins them to adult; the claim
    // must follow the effective (override) cohort. Setup is a
    // 16-y/o with stored cohort='minor' but override='adult'. The
    // cohort FIELD stays 'minor' (PR 1: cohort is DOB-derived) so
    // cohortChanged=false on the throttle-bump path doesn't apply.
    // We need a state where cohortChanged=true so the mint fires;
    // give the user yesterday's last-check and a cohort='adult'
    // stored value that doesn't match desiredCohort='minor' — the
    // route writes minor + mints. The OVERRIDE pulls the minted
    // claim back up to adult.
    mockTxGet.mockResolvedValue({
      exists: true,
      data: () => ({
        dateOfBirth: dobYearsAgo(16),
        pmLocked: false,
        cohort: 'adult',
        cohortOverride: 'adult',
        lastPmLockCheck: YESTERDAY_UTC_START,
      }),
    });
    mockGetUser.mockResolvedValue({ customClaims: { uniqueId: 10000050 } });

    const app = createApp();
    await request(app).post('/api/users/10000050/pm-lock-check').expect(200);

    // Unconditional assertion: the mint MUST fire, and the cohort
    // MUST be the override. A conditional guard here would silently
    // pass when the mint is broken — defeating the test's purpose.
    expect(mockSetCustomUserClaims).toHaveBeenCalledTimes(1);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-uid',
      expect.objectContaining({ cohort: 'adult' }),
    );
  });
});
