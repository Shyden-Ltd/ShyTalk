/**
 * Tests for the admin age-verification routes (PR 4b/14):
 *   GET  /api/admin/age-verification/pending
 *   POST /api/admin/age-verification/:id/approve
 *   POST /api/admin/age-verification/:id/reject
 *   POST /api/admin/age-verification/:id/modify-dob
 *
 * Each decision endpoint is responsible for the contracted clean-up:
 *   - Update submission doc (status, decisionAt, decidedBy)
 *   - Mutate target user doc (ageVerified, ageVerifiedAt, method,
 *     dateOfBirth as relevant)
 *   - Delete the R2 image (privacy: spec says image is destroyed on
 *     admin decision)
 *   - Write a typed audit log entry via age-verification-audit
 *
 * Tests pin all four side effects so a future refactor that drops the
 * R2 deletion or the audit write can't ship silently.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock (path-aware) ─────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockTxGet = jest.fn();
const mockTxUpdate = jest.fn();
const mockCollectionGet = jest.fn();
const mockSetCustomUserClaims = jest.fn().mockResolvedValue();
const mockGetUser = jest.fn().mockResolvedValue({ customClaims: {} });
const mockRevokeRefreshTokens = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: () => mockDocGet(path),
      set: (...args) => mockDocSet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
    })),
    collection: jest.fn((name) => ({
      _name: name,
      where: () => ({
        orderBy: () => ({
          limit: () => ({
            get: () => mockCollectionGet(),
          }),
          get: () => mockCollectionGet(),
        }),
        get: () => mockCollectionGet(),
      }),
    })),
    runTransaction: jest.fn(async (fn) => {
      return fn({
        get: (ref) => mockTxGet(ref?._path),
        update: (ref, payload) => mockTxUpdate(ref?._path, payload),
        set: (ref, payload) => mockTxUpdate(ref?._path, payload),
      });
    }),
  },
  auth: {
    setCustomUserClaims: (...args) => mockSetCustomUserClaims(...args),
    getUser: (...args) => mockGetUser(...args),
    revokeRefreshTokens: (...args) => mockRevokeRefreshTokens(...args),
  },
}));

const mockDeleteObject = jest.fn().mockResolvedValue();
const mockGetSignedGetUrl = jest.fn();
jest.mock('../../src/utils/r2', () => ({
  deleteObject: (...args) => mockDeleteObject(...args),
  getSignedGetUrl: (...args) => mockGetSignedGetUrl(...args),
}));

const mockLogApproved = jest.fn().mockResolvedValue();
const mockLogRejected = jest.fn().mockResolvedValue();
const mockLogDobModified = jest.fn().mockResolvedValue();
// `requirePlausibleDob` is preserved (not mocked) — the route's
// pre-transaction bounds check needs real validation logic, not a
// no-op stub. The three log* helpers are mocked because tests assert
// on calls and we don't want real Firestore writes.
jest.mock('../../src/utils/age-verification-audit', () => {
  const actual = jest.requireActual('../../src/utils/age-verification-audit');
  return {
    requirePlausibleDob: actual.requirePlausibleDob,
    logVerificationApproved: (...args) => mockLogApproved(...args),
    logVerificationRejected: (...args) => mockLogRejected(...args),
    logVerificationDobModified: (...args) => mockLogDobModified(...args),
  };
});

const mockSendApprovedPm = jest.fn().mockResolvedValue();
const mockSendRejectedPm = jest.fn().mockResolvedValue();
const mockSendDobModifiedPm = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/age-verification-system-pm', () => ({
  sendAgeVerificationApprovedPm: (...args) => mockSendApprovedPm(...args),
  sendAgeVerificationRejectedPm: (...args) => mockSendRejectedPm(...args),
  sendAgeVerificationDobModifiedPm: (...args) => mockSendDobModifiedPm(...args),
}));

const mockSendApprovedPush = jest.fn().mockResolvedValue(true);
const mockSendRejectedPush = jest.fn().mockResolvedValue(true);
const mockSendDobModifiedPush = jest.fn().mockResolvedValue(true);
jest.mock('../../src/utils/age-verification-fcm', () => ({
  sendAgeVerificationApprovedPush: (...args) => mockSendApprovedPush(...args),
  sendAgeVerificationRejectedPush: (...args) => mockSendRejectedPush(...args),
  sendAgeVerificationDobModifiedPush: (...args) => mockSendDobModifiedPush(...args),
}));

jest.mock('../../src/utils/helpers', () => ({
  now: () => 1709913600000,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const adminAgeVerificationRouter = require('../../src/routes/admin-age-verification');

function createApp({ admin = true, uniqueId = 10000001 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-uid', uniqueId, token: { admin } };
    next();
  });
  app.use('/api', adminAgeVerificationRouter);
  return app;
}

function pendingSubmissionDoc(overrides = {}) {
  return {
    id: 'sub-1',
    userId: '10000050',
    idMethod: 'passport',
    r2Key: 'age-verification/10000050/abc.jpg',
    status: 'pending',
    submittedAt: 1709800000000,
    ...overrides,
  };
}

// ─── GET /pending ───────────────────────────────────────────────────

describe('GET /api/admin/age-verification/pending', () => {
  test('returns list of pending submissions for admin', async () => {
    mockCollectionGet.mockResolvedValue({
      docs: [
        { id: 'sub-1', data: () => pendingSubmissionDoc() },
        { id: 'sub-2', data: () => pendingSubmissionDoc({ userId: '10000060' }) },
      ],
    });

    const app = createApp();
    const res = await request(app).get('/api/admin/age-verification/pending').expect(200);

    expect(res.body.submissions).toHaveLength(2);
    expect(res.body.submissions[0]).toMatchObject({
      id: 'sub-1',
      userId: '10000050',
      idMethod: 'passport',
    });
  });

  test('rejects non-admin with 403', async () => {
    const app = createApp({ admin: false });
    await request(app).get('/api/admin/age-verification/pending').expect(403);
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });
});

// ─── GET /:id/image-url ─────────────────────────────────────────────

describe('GET /api/admin/age-verification/:id/image-url', () => {
  test('returns short-lived signed URL for admin', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => pendingSubmissionDoc(),
    });
    mockGetSignedGetUrl.mockResolvedValue('https://r2.example/age-verification/abc.jpg?sig=xyz');

    const app = createApp();
    const res = await request(app).get('/api/admin/age-verification/sub-1/image-url').expect(200);

    expect(res.body).toEqual({
      url: 'https://r2.example/age-verification/abc.jpg?sig=xyz',
      expiresInSec: 300,
    });
    expect(mockGetSignedGetUrl).toHaveBeenCalledWith('age-verification/10000050/abc.jpg', 300);
  });

  test('rejects non-admin with 403', async () => {
    const app = createApp({ admin: false });
    await request(app).get('/api/admin/age-verification/sub-1/image-url').expect(403);
    expect(mockGetSignedGetUrl).not.toHaveBeenCalled();
  });

  test('returns 404 when submission does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp();
    await request(app).get('/api/admin/age-verification/missing/image-url').expect(404);
    expect(mockGetSignedGetUrl).not.toHaveBeenCalled();
  });

  test('returns 404 when r2Key has been wiped (post-decision state)', async () => {
    // After a decision commits, r2Key is set to null in the same
    // transaction. Admin requesting the image after that point gets
    // a clean 404 rather than a confusing signed URL to a deleted obj.
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => pendingSubmissionDoc({ status: 'approved', r2Key: null }),
    });
    const app = createApp();
    await request(app).get('/api/admin/age-verification/sub-1/image-url').expect(404);
    expect(mockGetSignedGetUrl).not.toHaveBeenCalled();
  });
});

// ─── POST /:id/approve ──────────────────────────────────────────────

describe('POST /api/admin/age-verification/:id/approve', () => {
  beforeEach(() => {
    mockTxGet.mockImplementation((path) => {
      if (path === 'ageVerificationSubmissions/sub-1') {
        return Promise.resolve({ exists: true, data: () => pendingSubmissionDoc() });
      }
      if (path === 'users/10000050') {
        return Promise.resolve({
          exists: true,
          data: () => ({ dateOfBirth: 946684800000, ageVerified: false }),
        });
      }
      return Promise.resolve({ exists: false });
    });
  });

  test('flips ageVerified=true on user, marks submission approved, deletes image, writes audit, sends PM', async () => {
    const app = createApp();
    await request(app).post('/api/admin/age-verification/sub-1/approve').expect(200);

    // Submission doc updated
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'ageVerificationSubmissions/sub-1',
      expect.objectContaining({
        status: 'approved',
        decisionAt: 1709913600000,
        decidedBy: 10000001,
      }),
    );
    // User doc updated
    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({
        ageVerified: true,
        ageVerifiedAt: 1709913600000,
        ageVerificationMethod: 'passport',
      }),
    );
    // Image deleted (privacy contract)
    expect(mockDeleteObject).toHaveBeenCalledWith('age-verification/10000050/abc.jpg');
    // Audit entry written
    expect(mockLogApproved).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adminUid: 10000001,
        targetUserId: '10000050',
        method: 'passport',
      }),
    );
    // User notified via system PM
    expect(mockSendApprovedPm).toHaveBeenCalledWith('10000050', 'passport');
    // FCM push (PR 10) — separate from the system PM path
    expect(mockSendApprovedPush).toHaveBeenCalledWith('10000050');
  });

  test('rejects when submission is not pending (already decided)', async () => {
    mockTxGet.mockImplementation((path) => {
      if (path === 'ageVerificationSubmissions/sub-1') {
        return Promise.resolve({
          exists: true,
          data: () => pendingSubmissionDoc({ status: 'approved' }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const app = createApp();
    await request(app).post('/api/admin/age-verification/sub-1/approve').expect(409);

    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockLogApproved).not.toHaveBeenCalled();
  });

  test('rejects unknown submission (404)', async () => {
    mockTxGet.mockResolvedValue({ exists: false });
    const app = createApp();
    await request(app).post('/api/admin/age-verification/missing/approve').expect(404);
  });

  test('rejects non-admin with 403', async () => {
    const app = createApp({ admin: false });
    await request(app).post('/api/admin/age-verification/sub-1/approve').expect(403);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  test('approve does NOT require a reason — empty body succeeds', async () => {
    // 2026-05-04 spec follow-up: original spec only required reason
    // on outcomes the user needs explained (Reject / DOB-modified).
    // Approve is the "everything is fine" path. Pin that the route
    // accepts an empty body so a future regression that adds the
    // reason gate trips this test.
    const app = createApp();
    await request(app).post('/api/admin/age-verification/sub-1/approve').expect(200);
    expect(mockTxUpdate).toHaveBeenCalled();
  });

  test('approve does NOT persist decisionReason on the submission doc', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/approve')
      .send({ reason: 'ignored if sent' })
      .expect(200);
    // The submission update payload must NOT carry decisionReason.
    const submissionUpdateCall = mockTxUpdate.mock.calls.find(
      ([path]) => path === 'ageVerificationSubmissions/sub-1',
    );
    expect(submissionUpdateCall).toBeDefined();
    expect(submissionUpdateCall[1]).not.toHaveProperty('decisionReason');
  });

  test('returns auditWritten=false flag when audit-log write fails (decision still committed)', async () => {
    // Per partial-failure-contracts feedback rule: a failed audit
    // write must be surfaced as a flag, not masked as 500.
    mockLogApproved.mockRejectedValue(new Error('auditLog write rejected by rules'));
    const app = createApp();
    const res = await request(app).post('/api/admin/age-verification/sub-1/approve').expect(200);
    expect(res.body).toMatchObject({ ok: true, auditWritten: false });
  });

  test('returns imageDeleted=false flag when R2 delete fails (decision still committed)', async () => {
    mockDeleteObject.mockRejectedValue(new Error('R2 timeout'));
    const app = createApp();
    const res = await request(app).post('/api/admin/age-verification/sub-1/approve').expect(200);
    expect(res.body).toMatchObject({ ok: true, imageDeleted: false });
  });

  test('returns userNotified=false flag when system PM fails (decision still committed)', async () => {
    mockSendApprovedPm.mockRejectedValue(new Error('conversations write rejected'));
    const app = createApp();
    const res = await request(app).post('/api/admin/age-verification/sub-1/approve').expect(200);
    expect(res.body).toMatchObject({ ok: true, userNotified: false });
  });
});

// ─── POST /:id/reject ───────────────────────────────────────────────

describe('POST /api/admin/age-verification/:id/reject', () => {
  beforeEach(() => {
    mockTxGet.mockImplementation((path) => {
      if (path === 'ageVerificationSubmissions/sub-1') {
        return Promise.resolve({ exists: true, data: () => pendingSubmissionDoc() });
      }
      return Promise.resolve({ exists: false });
    });
  });

  test('marks submission rejected, deletes image, writes audit (user unchanged)', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/reject')
      .send({ reason: 'Image was unreadable' })
      .expect(200);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      'ageVerificationSubmissions/sub-1',
      expect.objectContaining({
        status: 'rejected',
        decisionAt: 1709913600000,
        decidedBy: 10000001,
        decisionReason: 'Image was unreadable',
      }),
    );
    // User doc NOT touched on reject — they stay unverified
    expect(mockTxUpdate).not.toHaveBeenCalledWith('users/10000050', expect.anything());
    expect(mockDeleteObject).toHaveBeenCalledWith('age-verification/10000050/abc.jpg');
    expect(mockLogRejected).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adminUid: 10000001,
        targetUserId: '10000050',
        reason: 'Image was unreadable',
      }),
    );
  });

  test('rejects empty reason (admin must justify)', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/reject')
      .send({ reason: '' })
      .expect(400);

    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  test('rejects non-pending submission with 409', async () => {
    mockTxGet.mockImplementation((path) => {
      if (path === 'ageVerificationSubmissions/sub-1') {
        return Promise.resolve({
          exists: true,
          data: () => pendingSubmissionDoc({ status: 'rejected' }),
        });
      }
      return Promise.resolve({ exists: false });
    });
    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/reject')
      .send({ reason: 'no good' })
      .expect(409);
  });
});

// ─── POST /:id/modify-dob ───────────────────────────────────────────

describe('POST /api/admin/age-verification/:id/modify-dob', () => {
  beforeEach(() => {
    mockTxGet.mockImplementation((path) => {
      if (path === 'ageVerificationSubmissions/sub-1') {
        return Promise.resolve({ exists: true, data: () => pendingSubmissionDoc() });
      }
      if (path === 'users/10000050') {
        return Promise.resolve({
          exists: true,
          data: () => ({
            dateOfBirth: 946684800000,
            ageVerified: false,
            // PR 2: route reads firebaseUid + cohort from the user
            // doc inside the transaction so the claim mint targets
            // the right Firebase Auth record and includes the new
            // cohort derived from `newDob`.
            firebaseUid: 'fb-target-uid',
            cohort: 'adult',
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });
  });

  test('updates user DOB and approves when new DOB is 18+', async () => {
    // User submitted with DOB on file = 2000-01-01 (which makes them
    // 25+ now). Admin sees the ID shows 1995-01-01 instead, modifies
    // DOB to 1995, still >= 18 so account gets approved.
    const dob1995 = new Date('1995-01-01T00:00:00Z').getTime();
    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: dob1995, reason: 'ID showed different DOB' })
      .expect(200);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({
        dateOfBirth: dob1995,
        ageVerified: true,
        ageVerifiedAt: 1709913600000,
        ageVerificationMethod: 'passport',
        // PR 11: ≥18 ⇒ unlock. Defends against the modify-DOB path
        // leaving a now-aged-up user permanently locked.
        pmLocked: false,
      }),
    );
    expect(mockDeleteObject).toHaveBeenCalled();
    expect(mockLogDobModified).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        adminUid: 10000001,
        targetUserId: '10000050',
        oldDob: 946684800000,
        newDob: dob1995,
        reason: 'ID showed different DOB',
      }),
    );
  });

  test('reverts to unverified when new DOB makes user <18', async () => {
    // ID showed user is 16; admin sets DOB accordingly. ageVerified
    // must NOT flip to true; the user is too young for full access.
    const sixteenYearsAgo = new Date();
    sixteenYearsAgo.setUTCFullYear(sixteenYearsAgo.getUTCFullYear() - 16);
    const newDob = sixteenYearsAgo.getTime();

    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob, reason: 'ID confirms <18' })
      .expect(200);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({
        dateOfBirth: newDob,
        ageVerified: false,
        ageVerifiedAt: null,
        ageVerificationMethod: null,
        // PR 11: <18 ⇒ lock. The modify-DOB path is the primary
        // entry point for retroactively age-gating a user whose ID
        // contradicted their self-reported DOB.
        pmLocked: true,
      }),
    );
  });

  test('rejects empty reason', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: 946684800000, reason: '' })
      .expect(400);
  });

  test('rejects missing newDob', async () => {
    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ reason: 'forgot dob' })
      .expect(400);
  });

  test('rejects implausible newDob (pre-1900 / far-future) BEFORE the transaction commits', async () => {
    // Validation must happen pre-transaction; otherwise the user doc
    // is mutated with a bogus DOB and the audit write throws after.
    // -1e15 ms is ~year -29688 (well pre-1900); 99999999999999 ms is
    // ~year 5138 (far future). Both must be rejected.
    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: -1e15, reason: 'pre-1900 fail' })
      .expect(400);
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: 99999999999999, reason: 'far-future fail' })
      .expect(400);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  // ── UK OSA #17 PR 2: cohort + claim mint on DOB modify ─────────
  //
  // Admin DOB-modify is the only non-DOB-derived path that can move
  // a user across cohorts in a single transaction. It must:
  //   1. Write the new derived cohort to the user doc in the same
  //      transaction as the DOB + pmLocked + ageVerified updates.
  //   2. Mint a fresh custom claim with the new cohort, merging
  //      with the user's existing claims (admin must survive).
  // No `forceTokenRefresh` round-trip — the next sign-in's
  // pm-lock-check will surface the fresh claim. (Spec § Edge cases.)

  test('modify DOB to <18: writes cohort:minor + mints claim with cohort:minor', async () => {
    const sixteenYearsAgo = new Date();
    sixteenYearsAgo.setUTCFullYear(sixteenYearsAgo.getUTCFullYear() - 16);
    const newDob = sixteenYearsAgo.getTime();

    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob, reason: 'ID confirms minor' })
      .expect(200);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({
        dateOfBirth: newDob,
        cohort: 'minor',
        pmLocked: true,
      }),
    );
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-target-uid',
      expect.objectContaining({ cohort: 'minor' }),
    );
  });

  test('modify DOB to 18+: writes cohort:adult + mints claim with cohort:adult', async () => {
    const dob1995 = new Date('1995-01-01T00:00:00Z').getTime();

    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: dob1995, reason: 'aged-in adult' })
      .expect(200);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({
        dateOfBirth: dob1995,
        cohort: 'adult',
        pmLocked: false,
      }),
    );
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-target-uid',
      expect.objectContaining({ cohort: 'adult' }),
    );
  });

  test('claim mint preserves an existing admin:true on the target user', async () => {
    // Admin demoting another admin's DOB to minor. The target
    // user's admin grant must survive the cohort claim refresh —
    // demotion is a separate workflow.
    mockGetUser.mockResolvedValue({
      uid: 'fb-target-uid',
      customClaims: { uniqueId: 10000050, admin: true },
    });
    const sixteenYearsAgo = new Date();
    sixteenYearsAgo.setUTCFullYear(sixteenYearsAgo.getUTCFullYear() - 16);

    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: sixteenYearsAgo.getTime(), reason: 'preserve admin' })
      .expect(200);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-target-uid', {
      uniqueId: 10000050,
      admin: true,
      cohort: 'minor',
    });
  });

  test('mint failure does NOT roll back the Firestore DOB write (logged + flagged)', async () => {
    // Partial-failure contract per `feedback-partial-failure-contracts`.
    // The DOB modification is admin-attested and must commit;
    // mint failure surfaces via a per-action flag so the admin UI
    // can flag "decision committed, claim refresh deferred".
    mockSetCustomUserClaims.mockRejectedValueOnce(new Error('auth/quota-exceeded'));
    const dob1995 = new Date('1995-01-01T00:00:00Z').getTime();

    const app = createApp();
    const res = await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: dob1995, reason: 'mint fail check' })
      .expect(200);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      'users/10000050',
      expect.objectContaining({ dateOfBirth: dob1995 }),
    );
    expect(res.body.claimMinted).toBe(false);
  });

  test('mint failure on minor-down triggers revokeRefreshTokens (security defense)', async () => {
    // Security review MEDIUM #3: if mint fails after the admin
    // demotes a user to under-18, the target's JWT keeps the old
    // 'adult' cohort claim for up to ~1h. Revoking refresh tokens
    // forces the client to re-authenticate on the next ID-token
    // request; sign-in then runs through the fresh-mint path,
    // closing the stale-claim window.
    mockSetCustomUserClaims.mockRejectedValueOnce(new Error('auth/quota-exceeded'));
    const sixteenYearsAgo = new Date();
    sixteenYearsAgo.setUTCFullYear(sixteenYearsAgo.getUTCFullYear() - 16);

    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: sixteenYearsAgo.getTime(), reason: 'mint fail revoke check' })
      .expect(200);

    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('fb-target-uid');
  });

  test('successful mint does NOT revoke refresh tokens (no spurious force re-auth)', async () => {
    // Inverse defense: only revoke on FAILURE — a successful mint
    // already rotated the claim server-side; forcing re-auth would
    // be a UX regression for the happy path.
    const sixteenYearsAgo = new Date();
    sixteenYearsAgo.setUTCFullYear(sixteenYearsAgo.getUTCFullYear() - 16);

    const app = createApp();
    await request(app)
      .post('/api/admin/age-verification/sub-1/modify-dob')
      .send({ newDob: sixteenYearsAgo.getTime(), reason: 'happy path' })
      .expect(200);

    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });
});
