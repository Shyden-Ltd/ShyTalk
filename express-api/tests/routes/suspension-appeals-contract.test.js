/**
 * The appeal a phone submits, and the appeal a moderator sees — REAL-services
 * integration test (SHY-0463, EPIC-0005).
 *
 * Two endpoints write to ONE `suspensionAppeals` collection. The app calls
 * `POST /api/users/:uniqueId/appeal` (UserRepositoryImpl.kt:89); the web and
 * the admin tooling use `POST /api/appeals`. They disagreed about both the
 * schema and the meaning of "already pending", and the disagreement cost a
 * suspended person their right to answer an accusation:
 *
 *   D1  `POST /users/:id/appeal` wrote `uniqueId` (a String from the route
 *       param) where everything else — the other endpoint, the admin queue's
 *       enrichment, the admin duplicate check — reads `userId` (a Number).
 *       An appeal from the phone reached the moderator with `userUniqueId:
 *       null` and `userDisplayName: null`. Nobody to approve or deny.
 *
 *   D2  It decided "already pending" from `users/{id}.suspensionAppealStatus`,
 *       a flag set on appeal and cleared by ONE of the three writers that end
 *       a suspension. After a single appeal it stayed `pending` for ever, so
 *       every LATER suspension was refused `409 Appeal already pending`.
 *
 * Both were invisible from the phone: the suspension screen clears its field
 * and button on submit, so a 409 and a success look the same. J11 recorded
 * "appeal submitted from the phone ✓" for a request that wrote nothing.
 *
 * Contract pinned (REAL Firestore + Auth emulator — the point IS the shape of
 * what lands in the collection and what the admin read makes of it, neither of
 * which a mocked db can show):
 *   One schema   — both endpoints write the canonical owner field, as a Number.
 *   Attribution  — an app-submitted appeal enriches to a real user.
 *   Cross-visible— each endpoint's duplicate check sees the other's rows.
 *   Idempotent   — a second appeal against the SAME live suspension is 409.
 *   Re-appealable— suspend → appeal → unsuspend → suspend → appeal succeeds.
 *   Ownership    — appealing for somebody else is still refused.
 *
 * NODE_ENV='local' is set BEFORE requiring src/utils/firebase so the Admin SDK
 * + Auth emulator target localhost. PER-FILE opt-in only.
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
const reportsRouter = require('../../src/routes/reports');

const APPEALS = 'suspensionAppeals';
const APPELLANT = 50990470;
const OTHER = 50990471;
const ADMIN_ID = 50990472;

function appApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', usersRouter);
  app.use('/api', reportsRouter);
  return app;
}

/** Put somebody in the state a suspended person is actually in. */
async function suspend(uniqueId, { canAppeal = true } = {}) {
  await db.doc(`users/${uniqueId}`).set(
    {
      isSuspended: true,
      suspensionReason: 'harassment confirmed (SHY-0463 test)',
      suspensionCanAppeal: canAppeal,
      suspensionEndDate: null,
      displayName: 'Appellant',
    },
    { merge: true },
  );
}

/** Exactly what the admin unsuspend route writes — including what it omits. */
async function adminUnsuspend(uniqueId) {
  await db.doc(`users/${uniqueId}`).update({
    isSuspended: false,
    suspensionReason: null,
    suspensionStartDate: null,
    suspensionEndDate: null,
    suspensionCanAppeal: null,
    suspendedBy: null,
  });
}

async function clearAppealsFor(...ids) {
  const snap = await db.collection(APPEALS).get();
  await Promise.all(
    snap.docs
      .filter((d) => {
        const v = d.data();
        return ids.some(
          (id) =>
            v.userId === id ||
            v.userId === String(id) ||
            v.uniqueId === id ||
            v.uniqueId === String(id),
        );
      })
      .map((d) => d.ref.delete()),
  );
}

beforeAll(() => {
  assertEmulatorReachable();
});

beforeEach(async () => {
  clearAuthCaches();
  await clearAppealsFor(APPELLANT, OTHER);
});

afterAll(async () => {
  await clearAppealsFor(APPELLANT, OTHER);
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ─── D1: one schema, and a moderator who can see who appealed ─────────────

describe('an appeal carries who made it', () => {
  test('the app endpoint writes the canonical owner field, as a Number', async () => {
    const user = await mintRealUser({ uniqueId: APPELLANT });
    await suspend(APPELLANT);

    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({ appealText: 'I will not do it again' })
      .expect(200);

    const snap = await db.collection(APPEALS).where('userId', '==', APPELLANT).get();
    expect(snap.size).toBe(1);
    // Number, not String: `req.auth.uniqueId` and every reader are numeric,
    // and a String here matches nothing while looking present in the console.
    expect(typeof snap.docs[0].data().userId).toBe('number');
  });

  test('a moderator sees the appellant, not a blank row', async () => {
    const user = await mintRealUser({ uniqueId: APPELLANT });
    const admin = await mintRealUser({ uniqueId: ADMIN_ID, admin: true });
    await suspend(APPELLANT);

    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({ appealText: 'I will not do it again' })
      .expect(200);

    const res = await request(appApp())
      .get('/api/appeals?status=pending')
      .set(admin.headers)
      .expect(200);

    const mine = res.body.find((a) => a.userUniqueId === APPELLANT);
    expect(mine).toBeDefined();
    expect(mine.userDisplayName).toBe('Appellant');
    expect(mine.suspensionReason).toBe('harassment confirmed (SHY-0463 test)');
  });
});

// ─── D2: a later suspension can still be appealed ─────────────────────────

describe('each suspension can be appealed', () => {
  test('suspend → appeal → unsuspend → suspend → appeal succeeds', async () => {
    const user = await mintRealUser({ uniqueId: APPELLANT });

    await suspend(APPELLANT);
    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({ appealText: 'first accusation' })
      .expect(200);

    // The admin route ends the suspension WITHOUT touching
    // `suspensionAppealStatus` — which is exactly how the stale flag survived.
    await adminUnsuspend(APPELLANT);
    await clearAppealsFor(APPELLANT);
    await suspend(APPELLANT);

    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({ appealText: 'a different accusation, months later' })
      .expect(200);
  });

  test('a second appeal against the SAME live suspension is still refused', async () => {
    const user = await mintRealUser({ uniqueId: APPELLANT });
    await suspend(APPELLANT);

    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({ appealText: 'first' })
      .expect(200);

    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({ appealText: 'second' })
      .expect(409);
  });
});

// ─── The two endpoints must see each other ────────────────────────────────

describe('the two endpoints agree an appeal exists', () => {
  test('app first, then web: the web endpoint refuses the duplicate', async () => {
    const user = await mintRealUser({ uniqueId: APPELLANT });
    await suspend(APPELLANT);

    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({ appealText: 'from the phone' })
      .expect(200);

    await request(appApp())
      .post('/api/appeals')
      .set(user.headers)
      .send({ appealText: 'from the web' })
      .expect(409);
  });

  test('web first, then app: the app endpoint refuses the duplicate', async () => {
    const user = await mintRealUser({ uniqueId: APPELLANT });
    await suspend(APPELLANT);

    await request(appApp())
      .post('/api/appeals')
      .set(user.headers)
      .send({ appealText: 'from the web' })
      .expect(200);

    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({ appealText: 'from the phone' })
      .expect(409);
  });
});

// ─── No widening ──────────────────────────────────────────────────────────

describe('the appeal right is still bounded', () => {
  test('appealing on somebody else behalf is refused', async () => {
    const user = await mintRealUser({ uniqueId: APPELLANT });
    await mintRealUser({ uniqueId: OTHER });
    await suspend(OTHER);

    await request(appApp())
      .post(`/api/users/${OTHER}/appeal`)
      .set(user.headers)
      .send({ appealText: 'let them out' })
      .expect(403);
  });

  test('an empty appeal is still refused', async () => {
    const user = await mintRealUser({ uniqueId: APPELLANT });
    await suspend(APPELLANT);

    await request(appApp())
      .post(`/api/users/${APPELLANT}/appeal`)
      .set(user.headers)
      .send({})
      .expect(400);
  });
});
