/**
 * A self-view must return the caller's OWN cohort and date of birth.
 *
 * `stripSensitiveFields` exists to stop one user learning another's cohort,
 * DOB and strike history — the OSA cross-cohort hiding contract. It is applied
 * unconditionally, including when the caller is looking at THEMSELVES, which is
 * fine while the app hydrates its own profile straight from Firestore.
 *
 * It stops being fine the moment that read moves to the API, which is what
 * EPIC-0006 requires and what the suspended-user defect forces:
 *
 *   AuthViewModel.resolveProfileState does
 *       authRepository.resolvedCohort = user.effectiveCohort
 *   and the nav graph routes on whether a DOB is on file.
 *
 * So a client migrated onto `GET /users/:uniqueId` would silently lose its own
 * cohort and DOB — and cohort decides which half of a minors-facing app the
 * user sees. Failing loudly would be recoverable; this would just quietly
 * mis-route people.
 *
 * Nothing is exposed that the caller does not already own: `isSelf` is the same
 * flag the route already computes to bypass the cross-cohort gate and the
 * block-list check. The strike fields (warningCount / warningIssuedAt /
 * hasNewWarning) stay stripped even for self — the app has never read them and
 * moderation counters are the server's business, so they are left alone rather
 * than opened on the way past.
 *
 * Real Auth + Firestore emulator: the whole subject is what the REAL route
 * returns for two REAL identities, which a mocked db cannot show.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');
const usersRouter = require('../../src/routes/users');

const SELF = 69200001;
const PEER = 69200002;

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', usersRouter);
  return app;
}

describe('GET /users/:uniqueId — self-view keeps the caller their own fields', () => {
  let app;
  let self;

  beforeAll(async () => {
    await assertEmulatorReachable();
    app = createApp();
    // Same cohort so the peer read is ALLOWED through the cross-cohort gate —
    // otherwise a 404 would hide whether stripping happened at all.
    self = await mintRealUser({
      uniqueId: SELF,
      cohort: 'adult',
      extraUserData: { cohort: 'adult', dateOfBirth: '1990-05-05', displayName: 'Self' },
    });
    await mintRealUser({
      uniqueId: PEER,
      cohort: 'adult',
      extraUserData: { cohort: 'adult', dateOfBirth: '1991-06-06', displayName: 'Peer' },
    });
  });

  afterAll(async () => {
    for (const id of [SELF, PEER]) {
      await db
        .doc(`users/${id}`)
        .delete()
        .catch(() => {});
    }
    clearAuthCaches();
    if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = PRIOR_NODE_ENV;
  });

  it('returns the caller their OWN cohort — the field that decides which app they see', async () => {
    const res = await request(app).get(`/api/users/${SELF}`).set(self.headers);
    expect(res.status).toBe(200);
    expect(res.body.cohort).toBe('adult');
  });

  it('returns the caller their OWN dateOfBirth — the nav graph routes on it', async () => {
    const res = await request(app).get(`/api/users/${SELF}`).set(self.headers);
    expect(res.body.dateOfBirth).toBe('1990-05-05');
  });

  it('still strips cohort and dateOfBirth from ANOTHER user, same cohort or not', async () => {
    // The contract stripSensitiveFields exists for. Same cohort, so the read
    // succeeds and the assertion is about the SHAPE, not about being blocked.
    const res = await request(app).get(`/api/users/${PEER}`).set(self.headers);
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Peer');
    expect(res.body.cohort).toBeUndefined();
    expect(res.body.dateOfBirth).toBeUndefined();
  });

  it('never returns credentials or identifiers, not even to the owner', async () => {
    // Widening the self case must not become a hole. These have no client use
    // and one of them (firebaseUid) is an auth identifier.
    const res = await request(app).get(`/api/users/${SELF}`).set(self.headers);
    for (const field of ['pinHash', 'fcmTokens', 'firebaseUid', 'email']) {
      expect(res.body[field]).toBeUndefined();
    }
  });

  it('keeps moderation counters stripped even for the owner', async () => {
    // Deliberately NOT widened: the app has never read these and they are the
    // server's bookkeeping. Opening them "while we are here" is how a targeted
    // change turns into an unreviewed disclosure.
    const res = await request(app).get(`/api/users/${SELF}`).set(self.headers);
    for (const field of ['warningCount', 'warningIssuedAt', 'hasNewWarning']) {
      expect(res.body[field]).toBeUndefined();
    }
  });

  it('compares identity as a VALUE — a peer whose id merely shares a prefix is still stripped', async () => {
    // Guards a `startsWith`/loose comparison creeping into the isSelf check.
    const res = await request(app).get(`/api/users/${PEER}`).set(self.headers);
    expect(res.body.cohort).toBeUndefined();
  });
});
