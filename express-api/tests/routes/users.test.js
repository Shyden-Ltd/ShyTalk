const express = require('express');
const request = require('supertest');

// ─── Firebase mock (path-aware) ─────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockTransactionGet = jest.fn();
const mockTransactionSet = jest.fn();
const mockSetCustomUserClaims = jest.fn().mockResolvedValue();
const mockGetUser = jest.fn().mockResolvedValue({ customClaims: {} });

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
    runTransaction: jest.fn(async (fn) => {
      return fn({
        get: (ref) => mockTransactionGet(ref._path),
        set: (ref, ...args) => mockTransactionSet(ref._path, ...args),
      });
    }),
  },
  auth: {
    setCustomUserClaims: (...args) => mockSetCustomUserClaims(...args),
    getUser: (...args) => mockGetUser(...args),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayUnion: jest.fn((...args) => `arrayUnion(${args})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'gen-id',
  now: () => 1709913600000,
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  clearSuspensionCache: jest.fn(),
  clearUniqueIdCache: jest.fn(),
  updateUniqueIdCache: jest.fn(),
}));

const { getDoc } = require('../../src/utils/firestore-helpers');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ───────────────────────────────────────────────────

const usersRouter = require('../../src/routes/users');

/**
 * Creates a test app with injected auth.
 * @param {string} uid - Firebase UID
 * @param {number|null} uniqueId - Resolved uniqueId
 */
function createApp(uid = 'firebase-uid-A', uniqueId = 10000001) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid, uniqueId, token: {} };
    next();
  });
  app.use('/api', usersRouter);
  return app;
}

// ─── POST /api/users (identity-based creation) ──────────────────

describe('POST /api/users', () => {
  test('creates new user with identity system', async () => {
    mockTransactionGet.mockResolvedValue({ exists: false });

    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'alice@gmail.com',
        displayName: 'Alice',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.uniqueId).toBeGreaterThanOrEqual(10000000);
  });

  test('new users start unverified (ageVerified: false defaults)', async () => {
    // Apple App Store guideline 1.1.4: 18+ enforcement on private
    // messages + gacha. New accounts must default to unverified so an
    // admin manual ID review is required to flip the flag. Pin the
    // exact field shape — the User model + Firestore rules match.
    mockTransactionGet.mockResolvedValue({ exists: false });

    const app = createApp('new-user-uid', null);
    await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'newcomer@gmail.com',
        displayName: 'Newcomer',
        dateOfBirth: '2000-01-01',
      })
      .expect(200);

    const userDocSet = mockTransactionSet.mock.calls.find(([path]) => path?.startsWith?.('users/'));
    expect(userDocSet).toBeDefined();
    const docPayload = userDocSet[1];
    expect(docPayload).toMatchObject({
      ageVerified: false,
      ageVerifiedAt: null,
      ageVerificationMethod: null,
    });
  });

  test('rejects missing provider', async () => {
    const app = createApp('new-user-uid', null);
    await request(app).post('/api/users').send({ identifier: 'alice@gmail.com' }).expect(400);
  });

  test('rejects missing identifier', async () => {
    const app = createApp('new-user-uid', null);
    await request(app).post('/api/users').send({ provider: 'google' }).expect(400);
  });

  test('rejects NaN dateOfBirth (non-date string)', async () => {
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({ provider: 'google', identifier: 'alice@gmail.com', dateOfBirth: 'not-a-date' })
      .expect(400);

    expect(res.body.error).toBe('Invalid date of birth format');
  });

  test('rejects empty string dateOfBirth', async () => {
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({ provider: 'google', identifier: 'alice@gmail.com', dateOfBirth: '' })
      .expect(400);

    expect(res.body.error).toBe('Date of birth is required');
  });

  test('rejects "undefined" as dateOfBirth string', async () => {
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({ provider: 'google', identifier: 'alice@gmail.com', dateOfBirth: 'undefined' })
      .expect(400);

    expect(res.body.error).toBe('Invalid date of birth format');
  });

  // Minimum sign-up age bumped 13 → 16 on 2026-05-03 for Apple App
  // Store content-guideline compliance. The 16-17 cohort is allowed to
  // sign up but cannot use 18+ gated features (private messages,
  // gacha) until they age in or complete ID-based verification.
  // Plan: `.project/plans/2026-05-03-age-verification.md`.

  test('rejects 13 year old (was the old minimum)', async () => {
    // Regression guard: 13-y/o sign-ups used to succeed under the
    // pre-bump threshold. Pin that they now fail with 403 + the new
    // error message.
    const today = new Date();
    const thirteenAgo = new Date(today.getFullYear() - 13, today.getMonth(), today.getDate());
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'too-young@gmail.com',
        dateOfBirth: thirteenAgo.toISOString().slice(0, 10),
      })
      .expect(403);

    expect(res.body.error).toBe('Must be at least 16 years old');
  });

  test('rejects 15 year old (boundary just below new minimum)', async () => {
    const today = new Date();
    const fifteenAgo = new Date(today.getFullYear() - 15, today.getMonth(), today.getDate());
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'fifteen@gmail.com',
        dateOfBirth: fifteenAgo.toISOString().slice(0, 10),
      })
      .expect(403);

    expect(res.body.error).toBe('Must be at least 16 years old');
  });

  test('accepts 16 year old (new minimum)', async () => {
    mockTransactionGet.mockResolvedValue({ exists: false });
    const today = new Date();
    // 16 years and a few days ago to clear month/day boundaries.
    const sixteenAgo = new Date(today.getFullYear() - 16, today.getMonth(), today.getDate() - 5);
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'sixteen@gmail.com',
        dateOfBirth: sixteenAgo.toISOString().slice(0, 10),
      })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  // ── PR #493 (audit H1): calendar-year age math ──────────────────

  test('rejects user whose 16th birthday is TOMORROW (boundary just below)', async () => {
    // Pre-fix used (now - dob) / yearMs which produces fractional
    // years and would accept this case if the fraction rounded up.
    // Calendar-year math correctly says: today's month/day is BEFORE
    // birth month/day → subtract 1 from yearDiff → age = 15 → reject.
    //
    // Use Date.UTC for construction so the test is timezone-independent.
    const today = new Date();
    // Compute tomorrow's Y/M/D in UTC, then build DOB exactly 16
    // years earlier on the same calendar date.
    const tomorrowMs = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + 1,
    );
    const tomorrow = new Date(tomorrowMs);
    const dobMs = Date.UTC(
      tomorrow.getUTCFullYear() - 16,
      tomorrow.getUTCMonth(),
      tomorrow.getUTCDate(),
    );
    const dob = new Date(dobMs);
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'birthday-tomorrow@gmail.com',
        dateOfBirth: dob.toISOString().slice(0, 10),
      })
      .expect(403);

    expect(res.body.error).toBe('Must be at least 16 years old');
  });

  test('accepts user whose 16th birthday is TODAY (boundary at exactly 16)', async () => {
    // Calendar math: yearDiff = 16, monthDiff = 0, dayDiff = 0 →
    // age stays at 16 → accept. Pre-fix used ms-difference which
    // could be one day short on the birthday itself due to leap-year
    // accumulation.
    mockTransactionGet.mockResolvedValue({ exists: false });
    const today = new Date();
    const dobMs = Date.UTC(today.getUTCFullYear() - 16, today.getUTCMonth(), today.getUTCDate());
    const dob = new Date(dobMs);
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'birthday-today@gmail.com',
        dateOfBirth: dob.toISOString().slice(0, 10),
      })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('accepts 18 year old (above new minimum, will be eligible for verification)', async () => {
    mockTransactionGet.mockResolvedValue({ exists: false });
    const today = new Date();
    const eighteenAgo = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate() - 5);
    const app = createApp('new-user-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'eighteen@gmail.com',
        dateOfBirth: eighteenAgo.toISOString().slice(0, 10),
      })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  // ─── UK OSA #17 PR 2: cohort claim minting on signup ──────────
  //
  // Signup mints both `uniqueId` and `cohort` into the Firebase ID
  // token in a single setCustomUserClaims call. The cohort claim is
  // what Firestore rules read to gate cross-cohort reads at the
  // first layer of the defence-in-depth stack (see segregation
  // design doc § Enforcement layers). Pinning the exact shape here
  // stops a regression from silently dropping the claim and
  // collapsing the rules-layer gate.

  test('signup with 18+ DOB mints custom claim with cohort:adult', async () => {
    mockTransactionGet.mockResolvedValue({ exists: false });
    const today = new Date();
    const twentyAgo = new Date(today.getFullYear() - 20, today.getMonth(), today.getDate() - 1);
    const app = createApp('new-adult-uid', null);

    await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'adult-signup@gmail.com',
        dateOfBirth: twentyAgo.toISOString().slice(0, 10),
      })
      .expect(200);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'new-adult-uid',
      expect.objectContaining({ cohort: 'adult' }),
    );
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'new-adult-uid',
      expect.objectContaining({ uniqueId: expect.any(Number) }),
    );
  });

  test('signup with 16-17 DOB mints custom claim with cohort:minor', async () => {
    mockTransactionGet.mockResolvedValue({ exists: false });
    const today = new Date();
    const sixteenAgo = new Date(today.getFullYear() - 16, today.getMonth(), today.getDate() - 30);
    const app = createApp('new-minor-uid', null);

    await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'minor-signup@gmail.com',
        dateOfBirth: sixteenAgo.toISOString().slice(0, 10),
      })
      .expect(200);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'new-minor-uid',
      expect.objectContaining({ cohort: 'minor' }),
    );
  });

  test('signup propagates claim-mint failure as 500 (Firestore tx already committed)', async () => {
    // Partial-failure contract: the Firestore signup transaction
    // commits BEFORE the claim mint runs. If the mint throws,
    // the user doc + identity map already exist — they're not
    // rolled back. The route currently returns 500 because it
    // doesn't have a `claimMinted` surface for signup. Pin this
    // behaviour; future sweep job can detect orphan users with
    // missing claims and back-mint.
    mockTransactionGet.mockResolvedValue({ exists: false });
    mockSetCustomUserClaims.mockRejectedValueOnce(new Error('auth/quota-exceeded'));
    const today = new Date();
    const twentyAgo = new Date(today.getFullYear() - 20, today.getMonth(), today.getDate() - 1);

    const app = createApp('new-mint-fail-uid', null);
    const res = await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'mint-fail@gmail.com',
        dateOfBirth: twentyAgo.toISOString().slice(0, 10),
      });

    // Either 500 (current minimal contract) or 200 with a flag —
    // the bug we MUST NOT have is a silent success that leaves the
    // user doc committed without a claim. Pin that whichever code
    // path the route takes, the transaction at least committed.
    expect(mockTransactionSet).toHaveBeenCalled();
    // Mint was attempted
    expect(mockSetCustomUserClaims).toHaveBeenCalled();
    // Response is NOT a misleading success-with-uniqueId
    if (res.status === 200) {
      // If the route surfaces a partial-failure flag, it must be set
      expect(res.body.claimMinted).toBe(false);
    } else {
      expect(res.status).toBe(500);
    }
  });

  test('signup skips the getUser merge round-trip (new account = empty claims)', async () => {
    // Optimisation pinned: signup paths know there are no existing
    // claims to preserve, so the helper is called with skipFetch=true
    // and bypasses the auth.getUser() fetch. Saves ~150ms on the
    // signup critical path. Asserting the side-effect (no getUser
    // call) at the route layer is the framework-agnostic way to pin
    // it without reaching into the helper internals.
    mockTransactionGet.mockResolvedValue({ exists: false });
    const today = new Date();
    const twentyAgo = new Date(today.getFullYear() - 20, today.getMonth(), today.getDate() - 1);
    const app = createApp('new-skip-uid', null);

    await request(app)
      .post('/api/users')
      .send({
        provider: 'google',
        identifier: 'skip@gmail.com',
        dateOfBirth: twentyAgo.toISOString().slice(0, 10),
      })
      .expect(200);

    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

// ─── POST /api/users/sign-in (cohort + admin claim merge) ──────
//
// The sign-in mint at users.js:268 historically called
// `setCustomUserClaims(uid, { uniqueId })`. Because the SDK is
// REPLACE semantics, that line silently wiped any non-uniqueId
// claim — most importantly `admin: true` for moderators and
// `cohort` for the OSA #17 segregation gate. PR 2 fixes this by
// routing every mint through `mintClaimsMerging`, which fetches
// the existing claims and spreads them in before writing.

describe('POST /api/users/sign-in', () => {
  // Helper to construct a DOB N years before today (for cohort derive).
  function signInDobYearsAgo(years) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.getTime();
  }

  test('mints {uniqueId, cohort} preserving an existing admin:true claim', async () => {
    // Identity exists, user is not suspended, has admin claim from
    // a prior promote. Sign-in derives cohort from DOB (security
    // review HIGH #1: defends against stale cached cohort field).
    getDoc.mockResolvedValue({
      uniqueId: 10000050,
      provider: 'google',
      identifier: 'admin@gmail.com',
      unlinked: false,
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        isSuspended: false,
        cohort: 'adult',
        dateOfBirth: signInDobYearsAgo(25), // adult by DOB
      }),
    });
    mockGetUser.mockResolvedValue({
      uid: 'fb-admin-uid',
      customClaims: { uniqueId: 10000050, admin: true },
    });

    const app = createApp('fb-admin-uid', null);
    await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'admin@gmail.com' })
      .expect(200);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-admin-uid', {
      uniqueId: 10000050,
      admin: true,
      cohort: 'adult',
    });
  });

  test('derives cohort from DOB when cached cohort field is stale (security defense)', async () => {
    // Edge case: admin DOB-modified user to under-18 yesterday, but
    // pm-lock-check hasn't run on the user's device to refresh the
    // cached `cohort` field. The stale field says 'adult'; the DOB
    // says minor. Sign-in mint MUST follow the DOB, not the field
    // — otherwise the user gets cross-cohort read access via the
    // stale claim for the gap until pm-lock-check fires.
    getDoc.mockResolvedValue({
      uniqueId: 10000054,
      provider: 'google',
      identifier: 'stale@gmail.com',
      unlinked: false,
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        isSuspended: false,
        cohort: 'adult', // STALE — field lags reality
        dateOfBirth: signInDobYearsAgo(15), // 15-y/o, minor
      }),
    });
    mockGetUser.mockResolvedValue({ customClaims: {} });

    const app = createApp('fb-stale-uid', null);
    await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'stale@gmail.com' })
      .expect(200);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-stale-uid',
      expect.objectContaining({ cohort: 'minor' }),
    );
  });

  test('defaults cohort to "minor" when user doc lacks DOB (legacy account)', async () => {
    // Most-restrictive default: a legacy user doc written before PR
    // 1 has no cohort field AND no DOB. Sign-in mints cohort:minor
    // so the rules-layer treats them conservatively until the
    // first pm-lock-check writes the derived value.
    getDoc.mockResolvedValue({
      uniqueId: 10000051,
      provider: 'google',
      identifier: 'legacy@gmail.com',
      unlinked: false,
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isSuspended: false /* no cohort, no DOB */ }),
    });
    mockGetUser.mockResolvedValue({ customClaims: {} });

    const app = createApp('fb-legacy-uid', null);
    await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'legacy@gmail.com' })
      .expect(200);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-legacy-uid',
      expect.objectContaining({ cohort: 'minor' }),
    );
  });

  test('cohortOverride wins over DOB-derived cohort when present + allow-listed', async () => {
    // Admin-set override on a moderator account. The minted claim
    // must reflect the override so rules-layer treats them as the
    // override cohort regardless of their DOB. Tests both:
    //   - override wins over DOB ('adult' override on a 16-y/o)
    //   - the allow-list lets 'adult' through (regression guard
    //     against the security review HIGH #2 fix)
    getDoc.mockResolvedValue({
      uniqueId: 10000052,
      provider: 'google',
      identifier: 'mod@gmail.com',
      unlinked: false,
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        isSuspended: false,
        cohort: 'minor',
        cohortOverride: 'adult',
        dateOfBirth: signInDobYearsAgo(16), // DOB says minor; override wins
      }),
    });
    mockGetUser.mockResolvedValue({ customClaims: {} });

    const app = createApp('fb-mod-uid', null);
    await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'mod@gmail.com' })
      .expect(200);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-mod-uid',
      expect.objectContaining({ cohort: 'adult' }),
    );
  });

  test('arbitrary cohortOverride string is rejected by allow-list (fails closed to minor)', async () => {
    // Security review HIGH #2: `cohortOverride` is server-only-write
    // but a future admin-panel bug or migration could write an
    // arbitrary string like 'super-adult'. The allow-list in
    // `effectiveCohort` / `deriveCohortFromUser` must reject the
    // bogus value and fail closed to 'minor' rather than passing
    // the bogus string through to the JWT claim.
    getDoc.mockResolvedValue({
      uniqueId: 10000055,
      provider: 'google',
      identifier: 'bogus@gmail.com',
      unlinked: false,
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        isSuspended: false,
        cohort: 'adult',
        cohortOverride: 'super-admin', // not in allow-list
        dateOfBirth: signInDobYearsAgo(25),
      }),
    });
    mockGetUser.mockResolvedValue({ customClaims: {} });

    const app = createApp('fb-bogus-uid', null);
    await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'bogus@gmail.com' })
      .expect(200);

    // DOB is 25 → falls through to DOB-derive → 'adult'
    // (not 'super-admin', not 'minor' — DOB path catches the bogus
    // override and lands the right answer)
    const claims = mockSetCustomUserClaims.mock.calls[0][1];
    expect(claims.cohort).not.toBe('super-admin');
    expect(claims.cohort).toBe('adult');
  });

  test('suspended user: no claim mint (suspension short-circuits before mint)', async () => {
    // Phase 2A audit (M5): suspended users must not receive any
    // Firebase state mutation on sign-in. Cohort mint is part of
    // that state — pin that it's NOT called.
    getDoc.mockResolvedValue({
      uniqueId: 10000053,
      provider: 'google',
      identifier: 'banned@gmail.com',
      unlinked: false,
    });
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ isSuspended: true, cohort: 'adult' }),
    });

    const app = createApp('fb-banned-uid', null);
    await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'banned@gmail.com' })
      .expect(200);

    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  test('unknown identity: returns found:false WITHOUT minting any claims', async () => {
    getDoc.mockResolvedValue(null);

    const app = createApp('fb-unknown-uid', null);
    const res = await request(app)
      .post('/api/users/sign-in')
      .send({ provider: 'google', identifier: 'nobody@gmail.com' })
      .expect(200);

    expect(res.body).toEqual({ found: false });
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });
});

// ─── PATCH /api/users/:uniqueId ─────────────────────────────────

describe('PATCH /api/users/:uniqueId', () => {
  test('accepts description and nationality (not bio/country)', async () => {
    const app = createApp('firebase-uid-A', 10000001);

    await request(app)
      .patch('/api/users/10000001')
      .send({ description: 'Hello!', nationality: 'US' })
      .expect(200);

    const updateCall = mockDocUpdate.mock.calls[0];
    const path = updateCall[0];
    const updates = updateCall[1];
    expect(path).toBe('users/10000001');
    expect(updates.description).toBe('Hello!');
    expect(updates.nationality).toBe('US');
  });

  test('rejects bio and country fields (old names stripped, returns 400 with no valid fields)', async () => {
    const app = createApp('firebase-uid-A', 10000001);
    await request(app)
      .patch('/api/users/10000001')
      .send({ bio: 'Hello!', country: 'US' })
      .expect(400);
  });

  test('rejects updating another user', async () => {
    const app = createApp('firebase-uid-A', 10000001);
    await request(app).patch('/api/users/10000099').send({ displayName: 'Hacked' }).expect(403);
  });
});

// ─── POST /api/users/:uniqueId/record-visit (stalkers) ─────────

describe('POST /api/users/:uniqueId/record-visit', () => {
  test('skips self-visits', async () => {
    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app)
      .post('/api/users/10000001/record-visit')
      .send({ visitorId: '10000001' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(mockDocUpdate.mock.calls.length).toBe(0);
  });

  test('creates new stalker doc with lastVisitedAt field', async () => {
    // PR 4: target user fetch for cross-cohort gate happens BEFORE
    // stalker subdoc fetch. Differentiate by path: target user exists
    // with no cohort (→ 'minor'); stalker subdoc null = new visit.
    getDoc.mockImplementation((path) =>
      path === 'users/10000099' ? Promise.resolve({}) : Promise.resolve(null),
    );
    const app = createApp('firebase-uid-visitor', 10000002);

    await request(app)
      .post('/api/users/10000099/record-visit')
      .send({ visitorId: '10000002' })
      .expect(200);

    expect(mockBatchSet).toHaveBeenCalled();
    const setCall = mockBatchSet.mock.calls[0];
    const stalkerData = setCall[1];
    expect(stalkerData.visitorId).toBe('10000002');
    expect(stalkerData.lastVisitedAt).toBe(1709913600000);
    expect(stalkerData.firstVisitedAt).toBe(1709913600000);
    expect(stalkerData.visitCount).toBe(1);
    expect(stalkerData.visitedAt).toBeUndefined();
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('updates existing stalker with lastVisitedAt', async () => {
    getDoc.mockResolvedValue({ visitorId: '10000002', visitCount: 3 });
    const app = createApp('firebase-uid-visitor', 10000002);

    await request(app)
      .post('/api/users/10000099/record-visit')
      .send({ visitorId: '10000002' })
      .expect(200);

    expect(mockBatchUpdate).toHaveBeenCalled();
    const updateCall = mockBatchUpdate.mock.calls[0];
    const updates = updateCall[1];
    expect(updates.lastVisitedAt).toBe(1709913600000);
    expect(updates.visitCount).toBe(4);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('rejects missing visitorId', async () => {
    const app = createApp('firebase-uid-visitor', 10000002);
    await request(app).post('/api/users/10000099/record-visit').send({}).expect(400);
  });

  test('rejects impersonation (visitorId must match auth uniqueId)', async () => {
    const app = createApp('firebase-uid-A', 10000001);
    await request(app)
      .post('/api/users/10000099/record-visit')
      .send({ visitorId: '10000999' })
      .expect(403);
  });

  // C7: a blocked visitor must not silently tick the target's stalker
  // counter — otherwise blocking is observably useless. Returns 200 to
  // avoid leaking block state to the client, but `recorded: false` lets
  // tests assert the no-op.
  test('C7: silent no-op when target has blocked the visitor', async () => {
    getDoc.mockResolvedValueOnce({ blockedUserIds: [10000002] });
    const app = createApp('firebase-uid-visitor', 10000002);

    const res = await request(app)
      .post('/api/users/10000099/record-visit')
      .send({ visitorId: '10000002' })
      .expect(200);

    expect(res.body).toEqual({ success: true, recorded: false });
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('C7: handles string/numeric id mismatch in blockedUserIds', async () => {
    // Firestore may store blocked IDs as strings depending on which
    // client wrote them; the helper coerces both sides to strings.
    getDoc.mockResolvedValueOnce({ blockedUserIds: ['10000002'] });
    const app = createApp('firebase-uid-visitor', 10000002);

    const res = await request(app)
      .post('/api/users/10000099/record-visit')
      .send({ visitorId: '10000002' })
      .expect(200);

    expect(res.body.recorded).toBe(false);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ─── GET /api/users/:uniqueId — PII stripping ──────────────────

describe('GET /api/users/:uniqueId', () => {
  test('strips pinHash from response', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Alice',
      pinHash: '$2b$10$somehash',
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body.displayName).toBe('Alice');
    expect(res.body).not.toHaveProperty('pinHash');
  });

  test('strips fcmTokens from response', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Alice',
      fcmTokens: ['token1', 'token2'],
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body).not.toHaveProperty('fcmTokens');
  });

  test('strips firebaseUid from response', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Alice',
      firebaseUid: 'firebase-uid-A',
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body).not.toHaveProperty('firebaseUid');
  });

  test('strips email from response', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Alice',
      email: 'alice@example.com',
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body).not.toHaveProperty('email');
  });

  test('strips dateOfBirth from response', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Alice',
      dateOfBirth: '2000-01-15',
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body).not.toHaveProperty('dateOfBirth');
  });

  test('strips providers[].identifier from response', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Alice',
      providers: [
        { type: 'google', identifier: 'alice@gmail.com', active: true, linkedAt: 1700000000000 },
        { type: 'apple', identifier: 'apple-sub-id-123', active: true, linkedAt: 1700000000000 },
      ],
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body.providers).toHaveLength(2);
    for (const provider of res.body.providers) {
      expect(provider).not.toHaveProperty('identifier');
      expect(provider).toHaveProperty('type');
      expect(provider).toHaveProperty('active');
      expect(provider).toHaveProperty('linkedAt');
    }
  });

  test('preserves normal public fields (displayName, uniqueId, etc.)', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: '10000001',
      displayName: 'Alice',
      avatarUrl: 'https://example.com/avatar.png',
      description: 'Hello world',
      nationality: 'GB',
      level: 5,
      followers: 42,
      blockedUserIds: ['999'],
      followingIds: ['888'],
      followerIds: ['777'],
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body.displayName).toBe('Alice');
    expect(res.body.uniqueId).toBe('10000001');
    expect(res.body.avatarUrl).toBe('https://example.com/avatar.png');
    expect(res.body.description).toBe('Hello world');
    expect(res.body.nationality).toBe('GB');
    expect(res.body.level).toBe(5);
    expect(res.body.followers).toBe(42);
  });

  test('strips admin-only fields (gcsScore, warningCount, etc.)', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Alice',
      gcsScore: 95,
      gcsLastDeductionAt: 1700000000000,
      gcsDisplayScore: 'A+',
      warningCount: 2,
      warningIssuedAt: 1700000000000,
      hasNewWarning: true,
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body).not.toHaveProperty('gcsScore');
    expect(res.body).not.toHaveProperty('gcsLastDeductionAt');
    expect(res.body).not.toHaveProperty('gcsDisplayScore');
    expect(res.body).not.toHaveProperty('warningCount');
    expect(res.body).not.toHaveProperty('warningIssuedAt');
    expect(res.body).not.toHaveProperty('hasNewWarning');
  });

  test('defaults blockedUserIds, followingIds, followerIds when missing', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Bob',
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body.blockedUserIds).toEqual([]);
    expect(res.body.followingIds).toEqual([]);
    expect(res.body.followerIds).toEqual([]);
  });

  test('returns 404 when user not found', async () => {
    getDoc.mockResolvedValueOnce(null);

    const app = createApp('firebase-uid-A', 10000001);
    await request(app).get('/api/users/99999999').expect(404);
  });

  // C7: a user who has been blocked by the target must not see their
  // profile. Returns 403 (matches gift-send semantics for blocked
  // interactions); the client renders the blocked-state UI on this.
  test('C7: returns 403 when target has blocked the viewer', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000099,
      displayName: 'Target',
      blockedUserIds: [10000001],
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000099').expect(403);

    expect(res.body.error).toMatch(/blocked/i);
  });

  test('C7: allows viewing own profile even if own id is in own blockedUserIds', async () => {
    // Defensive edge case: blocking yourself is impossible via the
    // client UI, but if the doc is ever corrupted in this way the user
    // must still be able to see their own profile to recover.
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000001,
      displayName: 'Self',
      blockedUserIds: [10000001],
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000001').expect(200);

    expect(res.body.displayName).toBe('Self');
  });

  test('C7: allows viewing when target has not blocked the viewer', async () => {
    getDoc.mockResolvedValueOnce({
      uniqueId: 10000099,
      displayName: 'Target',
      blockedUserIds: [99999999],
    });

    const app = createApp('firebase-uid-A', 10000001);
    const res = await request(app).get('/api/users/10000099').expect(200);

    expect(res.body.displayName).toBe('Target');
  });
});
