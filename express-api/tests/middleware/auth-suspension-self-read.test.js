/**
 * A suspended user must be able to LEARN that they are suspended.
 *
 * Found 2026-08-02 from the app-android gauntlet cell: every remaining sign-in
 * failure was P-08, the persona j11 suspends, and the app was showing
 *
 *     "Unable to Connect. Please check your internet connection."
 *
 * with full connectivity. The chain:
 *
 *     SignInScreen renders SuspensionScreen when uiState.isSuspended
 *     AuthViewModel.resolveProfileState learns that from
 *       userRepository.getUser(userId)  ->  GET /users/:id
 *     isSuspensionExemptPath() did not list that path  ->  403
 *       ->  getUser returns Resource.Error
 *       ->  the else branch sets isBackendUnreachable = true
 *
 * The only way to discover the suspension was an endpoint the suspension
 * blocked, so the app reported a moderation state as a network fault.
 *
 * THE APPEAL IS THE POINT. `isSuspensionExemptPath` already keeps
 * `/users/:id/appeal` and `POST /appeals` reachable — the policy deliberately
 * preserves appeal rights through a suspension. But the button that calls them
 * lives on a screen the app could never render, so the exemption protected an
 * unreachable control.
 *
 * Fixed SERVER-side rather than in the client: one change repairs Android, iOS
 * and web at once, with no app release. j11's "Raul's Android shows the
 * suspension screen with reason, end date, and appeal button" depends on it.
 *
 * SELF ONLY, and that is the whole risk of this change. The existing exempt
 * patterns are wholesale (`/^\/users\/[^/]+\/delete$/` matches ANY id and
 * leaves ownership to the route), but `GET /users/:id` SERVES OTHER PEOPLE'S
 * PROFILES. Exempting it wholesale would hand a suspended user the profile
 * browsing that suspension exists to remove. The check compares against the
 * caller's resolved uniqueId and fails closed.
 *
 * Real Auth + Firestore emulator throughout: the gate reads a real user doc and
 * a real verified token, and a mocked db cannot prove the id comparison that is
 * the entire security boundary here.
 */

const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');

/** Distinct id block so a parallel worker's cleanup cannot delete these. */
const SUSPENDED = 69100001;
const OTHER = 69100002;
const ACTIVE = 69100003;

/**
 * Probe wired like production: the REAL authMiddleware ahead of a handler that
 * stands in for `GET /users/:id`. What the handler returns is irrelevant — the
 * subject is whether the gate lets the request through at all.
 */
function createProbeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.get('/api/users/:id', (req, res) => res.json({ ok: true, id: req.params.id }));
  app.get('/api/users/:id/followers', (req, res) => res.json({ ok: true, via: 'followers' }));
  app.post('/api/users/:id/appeal', (req, res) => res.json({ ok: true, via: 'appeal' }));
  app.post('/api/users/sign-in', (req, res) => res.json({ found: true, suspended: true }));
  app.post('/api/probe/sensitive', (req, res) => res.json({ ok: true }));
  return app;
}

describe('a suspended user can read their OWN user doc', () => {
  let app;
  let suspended;
  let active;

  beforeAll(async () => {
    await assertEmulatorReachable();
    app = createProbeApp();
    suspended = await mintRealUser({ uniqueId: SUSPENDED, isSuspended: true });
    await mintRealUser({ uniqueId: OTHER, isSuspended: false });
    active = await mintRealUser({ uniqueId: ACTIVE, isSuspended: false });
  });

  afterAll(async () => {
    for (const id of [SUSPENDED, OTHER, ACTIVE]) {
      await db
        .doc(`users/${id}`)
        .delete()
        .catch(() => {});
    }
    clearAuthCaches();
    if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = PRIOR_NODE_ENV;
  });

  it('lets a suspended user GET their own profile — the only way to render the appeal', async () => {
    const res = await request(app).get(`/api/users/${SUSPENDED}`).set(suspended.headers);
    expect(res.status).toBe(200);
  });

  it("still refuses a suspended user ANOTHER user's profile", async () => {
    // The security boundary. A wholesale exemption on this path would restore
    // exactly the profile browsing suspension is meant to remove.
    const res = await request(app).get(`/api/users/${OTHER}`).set(suspended.headers);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  it("does not widen the exemption to SUB-paths of the caller's own id", async () => {
    // `/users/<self>/followers` is a different capability that happens to share
    // a prefix. A regex anchored loosely would have let it through.
    const res = await request(app).get(`/api/users/${SUSPENDED}/followers`).set(suspended.headers);
    expect(res.status).toBe(403);
  });

  it('does not turn the exemption into a write channel', async () => {
    // Only GET. A suspended user reading their own status is a right; mutating
    // through the same path is not.
    const res = await request(app)
      .post(`/api/users/${SUSPENDED}`)
      .set(suspended.headers)
      .send({ displayName: 'nope' });
    expect(res.status).toBe(403);
  });

  it('still blocks every other suspended request', async () => {
    const res = await request(app).post('/api/probe/sensitive').set(suspended.headers).send({});
    expect(res.status).toBe(403);
  });

  it('lets a suspended user reach POST /users/sign-in — it is identity, not capability', async () => {
    // THE ROOT BLOCKER of the whole chain, and the one that hid the others.
    //
    // `/users/sign-in` is the FIRST call the app makes, and the route is already
    // suspension-aware: it returns `{ found: true, suspended: true }` WITHOUT
    // updating firebaseUid or minting claims — a response added deliberately by
    // the Phase-2A audit so a suspended user learns their status without gaining
    // any capability.
    //
    // The middleware 403'd before that route could run, so the designed response
    // was unreachable and the app fell back to "Unable to Connect". Exempting
    // the gate here is safe precisely BECAUSE the route is the real guard — it
    // grants a suspended caller nothing.
    const res = await request(app).post('/api/users/sign-in').set(suspended.headers).send({});
    expect(res.status).not.toBe(403);
  });

  it('keeps the appeal endpoint reachable — the right this exists to serve', async () => {
    const res = await request(app).post(`/api/users/${SUSPENDED}/appeal`).set(suspended.headers);
    expect(res.status).toBe(200);
  });

  it('leaves an ACTIVE user entirely unaffected, including reading others', async () => {
    // The gate must only ever narrow behaviour for suspended callers.
    const own = await request(app).get(`/api/users/${ACTIVE}`).set(active.headers);
    const someone = await request(app).get(`/api/users/${OTHER}`).set(active.headers);
    expect([own.status, someone.status]).toEqual([200, 200]);
  });

  it('compares the id as a VALUE, not as a string that merely starts the same', async () => {
    // `69100001` vs `691000010` — a `startsWith` comparison would pass this and
    // hand the caller a different account's profile.
    const res = await request(app).get(`/api/users/${SUSPENDED}0`).set(suspended.headers);
    expect(res.status).toBe(403);
  });
});
