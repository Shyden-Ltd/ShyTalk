'use strict';

/**
 * SHY-0249 — GET /api/appeals must tell an admin who is appealing and what
 * they were reported for. REAL services: real Auth-emulator tokens, real
 * Firestore documents, no doubles.
 *
 * The Appeals tab renders a "Reports & Evidence (N)" disclosure listing each
 * report's reason, reporter, description, message text and evidence. That
 * rendering has never run in production: `GET /api/appeals` enriches appeals
 * with user data only, so `appeal.reports` is always undefined and the section
 * is skipped.
 *
 * Separately, the appeal document written by the real user-facing endpoint
 * (`users.js` POST /user/:uniqueId/appeal) stores the account as `uniqueId`,
 * while the read path looks for `userId`/`user_id`. A real appeal therefore
 * resolves to nobody and shows null display name, null unique id and null
 * suspension reason.
 *
 * The whole appeals suite is green today because the TEST FIXTURE writes
 * `userId` — the field the reader wants and the product never writes. See
 * appeals-fixture-contract.test.js for the guard that stops that recurring.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const { db } = require('../../src/utils/firebase');
const { authMiddleware } = require('../../src/middleware/auth');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const reportsRouter = require('../../src/routes/reports');

// The appeal-submission endpoint lives in `src/routes/users.js`, which pulls in
// ESM-only `uuid` and cannot be `require`d under this Jest config. Rather than
// mock a path around it, the one test that needs it posts to the RUNNING local
// API — the same server the admin panel and the browser suites talk to, and a
// stronger statement than mounting the router in-process would be.
const LIVE_API = process.env.API_BASE_URL || 'http://localhost:3000';

// Namespaced well away from other suites' ids so a parallel file can't collide.
const ADMIN_ID = 64900001;
const APPELLANT_ID = 64900002;
const REPORTER_ID = 64900003;
const CLEAN_ID = 64900004;
const LEGACY_ID = 64900005;
const ORPHAN_ID = 64900006;

const CREATED_APPEALS = [];
const CREATED_REPORTS = [];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', reportsRouter);
  return app;
}

/** Write a report against `reportedUserUniqueId`, production shape. */
async function seedReport(fields) {
  const id = `shy0249-report-${CREATED_REPORTS.length}-${Date.now()}`;
  await db.doc(`reports/${id}`).set({
    id,
    status: 'pending',
    reason: 'Spam',
    evidenceUrls: [],
    ...fields,
  });
  CREATED_REPORTS.push(id);
  return id;
}

/** Write an appeal document with whichever account-field spelling is given. */
async function seedAppeal(fields) {
  const id = `shy0249-appeal-${CREATED_APPEALS.length}-${Date.now()}`;
  await db.doc(`suspensionAppeals/${id}`).set({
    id,
    appealText: 'Please reconsider',
    status: 'pending',
    createdAt: Date.now(),
    ...fields,
  });
  CREATED_APPEALS.push(id);
  return id;
}

const findAppeal = (body, id) => body.find((a) => a.id === id);

describe('SHY-0249 — appeal review shows the appellant and their reports', () => {
  let app;
  let admin;

  beforeAll(async () => {
    await assertEmulatorReachable();
    clearAuthCaches();
    app = createApp();
    admin = await mintRealUser({ uniqueId: ADMIN_ID, admin: true });
  });

  afterAll(async () => {
    await Promise.all([
      ...CREATED_APPEALS.map((id) => db.doc(`suspensionAppeals/${id}`).delete()),
      ...CREATED_REPORTS.map((id) => db.doc(`reports/${id}`).delete()),
      ...[ADMIN_ID, APPELLANT_ID, REPORTER_ID, CLEAN_ID, LEGACY_ID].map((id) =>
        db.doc(`users/${id}`).delete(),
      ),
    ]);
    process.env.NODE_ENV = PRIOR_NODE_ENV;
  });

  describe('the evidence behind the suspension', () => {
    let appealId;

    beforeAll(async () => {
      const appellant = await mintRealUser({
        uniqueId: APPELLANT_ID,
        isSuspended: true,
        extraUserData: {
          displayName: 'Appellant One',
          suspensionReason: 'Repeated harassment',
          suspensionStartDate: '2026-07-01',
          suspensionEndDate: '2026-08-01',
        },
      });
      await mintRealUser({
        uniqueId: REPORTER_ID,
        extraUserData: { displayName: 'Reporter One' },
      });

      await seedReport({
        reportedUserId: appellant.uid,
        reportedUserUniqueId: APPELLANT_ID,
        reporterId: REPORTER_ID,
        reporterUniqueId: REPORTER_ID,
        reporterName: 'Reporter One',
        reason: 'Harassment',
        description: 'Kept messaging after being asked to stop',
        messageText: 'let me in',
        evidenceUrls: ['https://images.shytalk.test/e1.png'],
        status: 'resolved',
        actionTaken: 'suspended',
        createdAt: 1_000,
      });
      await seedReport({
        reportedUserId: appellant.uid,
        reportedUserUniqueId: APPELLANT_ID,
        reporterId: REPORTER_ID,
        reporterUniqueId: REPORTER_ID,
        reporterName: 'Reporter One',
        reason: 'Spam',
        createdAt: 2_000,
      });

      appealId = await seedAppeal({ uniqueId: APPELLANT_ID });
    });

    it('returns the reports filed against the appealing account', async () => {
      const res = await request(app).get('/api/appeals').set(admin.headers);
      expect(res.status).toBe(200);

      const appeal = findAppeal(res.body, appealId);
      expect(appeal).toBeDefined();
      // The panel does `appeal.reports || []`, so undefined and [] render
      // identically — the assertion has to distinguish them.
      expect(Array.isArray(appeal.reports)).toBe(true);
      expect(appeal.reports).toHaveLength(2);
    });

    it('carries every field the Reports & Evidence panel renders', async () => {
      const res = await request(app).get('/api/appeals').set(admin.headers);
      const appeal = findAppeal(res.body, appealId);
      const harassment = appeal.reports.find((r) => r.reason === 'Harassment');

      // appeals.js reads exactly these. A join that dropped any of them would
      // render a report with "Unknown reason" or a blank reporter.
      expect({
        reason: harassment.reason,
        status: harassment.status,
        description: harassment.description,
        messageText: harassment.messageText,
        reporterName: harassment.reporterName,
        reporterUniqueId: harassment.reporterUniqueId,
        evidenceUrls: harassment.evidenceUrls,
      }).toEqual({
        reason: 'Harassment',
        status: 'resolved',
        description: 'Kept messaging after being asked to stop',
        messageText: 'let me in',
        reporterName: 'Reporter One',
        reporterUniqueId: REPORTER_ID,
        evidenceUrls: ['https://images.shytalk.test/e1.png'],
      });
    });

    it('orders reports newest first', async () => {
      const res = await request(app).get('/api/appeals').set(admin.headers);
      const appeal = findAppeal(res.body, appealId);
      expect(appeal.reports.map((r) => r.reason)).toEqual(['Spam', 'Harassment']);
    });

    it('identifies the appellant', async () => {
      const res = await request(app).get('/api/appeals').set(admin.headers);
      const appeal = findAppeal(res.body, appealId);
      expect({
        userUniqueId: appeal.userUniqueId,
        displayName: appeal.displayName,
        suspensionReason: appeal.suspensionReason,
      }).toEqual({
        userUniqueId: APPELLANT_ID,
        displayName: 'Appellant One',
        suspensionReason: 'Repeated harassment',
      });
    });
  });

  describe('an appeal submitted through the real user-facing endpoint', () => {
    it('resolves to the account that submitted it', async () => {
      // This is the defect the fixture hid: the writer stores `uniqueId`, the
      // reader wanted `userId`. Going through the real endpoint rather than
      // seeding the document is the whole point — a seeded document proves
      // only that the test agrees with itself.
      const appellant = await mintRealUser({
        uniqueId: LEGACY_ID,
        isSuspended: true,
        extraUserData: { displayName: 'Real Appellant', suspensionReason: 'Spam' },
      });

      const submit = await fetch(`${LIVE_API}/api/users/${LEGACY_ID}/appeal`, {
        method: 'POST',
        headers: { ...appellant.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appealText: 'It was not me' }),
      });
      expect(submit.status).toBe(200);

      const res = await request(app).get('/api/appeals').set(admin.headers);
      const appeal = res.body.find((a) => a.appealText === 'It was not me');
      expect(appeal).toBeDefined();
      CREATED_APPEALS.push(appeal.id);

      expect({
        userUniqueId: appeal.userUniqueId,
        displayName: appeal.displayName,
        suspensionReason: appeal.suspensionReason,
      }).toEqual({
        userUniqueId: LEGACY_ID,
        displayName: 'Real Appellant',
        suspensionReason: 'Spam',
      });
    });

    it('still resolves appeals written with the legacy userId spelling', async () => {
      // Documents already in Firestore use `userId`. Fixing the reader must not
      // strand them.
      await mintRealUser({
        uniqueId: CLEAN_ID,
        extraUserData: { displayName: 'Legacy Shape' },
      });
      const id = await seedAppeal({ userId: CLEAN_ID, appealText: 'legacy shape' });

      const res = await request(app).get('/api/appeals').set(admin.headers);
      const appeal = findAppeal(res.body, id);
      expect(appeal.displayName).toBe('Legacy Shape');
    });
  });

  describe('degraded inputs', () => {
    it('gives an appellant with no reports an empty array, not undefined', async () => {
      const id = await seedAppeal({ uniqueId: CLEAN_ID, appealText: 'clean record' });
      const res = await request(app).get('/api/appeals').set(admin.headers);
      const appeal = findAppeal(res.body, id);
      expect(appeal.reports).toEqual([]);
    });

    it('returns an appeal whose account no longer exists rather than failing', async () => {
      // One orphaned appeal must not blank the whole queue — the admin still
      // needs to see, and dismiss, the rest.
      const orphanId = await seedAppeal({ uniqueId: ORPHAN_ID, appealText: 'orphan' });

      const res = await request(app).get('/api/appeals').set(admin.headers);
      expect(res.status).toBe(200);

      const orphan = findAppeal(res.body, orphanId);
      expect({
        present: orphan !== undefined,
        userUniqueId: orphan?.userUniqueId ?? null,
        reports: orphan?.reports ?? null,
      }).toEqual({ present: true, userUniqueId: null, reports: [] });

      // And the healthy ones are still there alongside it.
      expect(res.body.length).toBeGreaterThan(1);
    });
  });

  describe('approving an appeal', () => {
    it('unsuspends an account that appealed through the real endpoint', async () => {
      // The read defects are bad; this one is worse. PATCH /appeals/:id
      // resolved the account with `appeal.userId ?? appeal.user_id`, so for an
      // appeal written by the app both were undefined — the handler updated
      // `users/undefined`, reported success, and left the person suspended.
      const APPROVE_ID = 64900007;
      const appellant = await mintRealUser({
        uniqueId: APPROVE_ID,
        isSuspended: true,
        extraUserData: { displayName: 'Approve Me', suspensionReason: 'Spam' },
      });

      const submit = await fetch(`${LIVE_API}/api/users/${APPROVE_ID}/appeal`, {
        method: 'POST',
        headers: { ...appellant.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appealText: 'approve please' }),
      });
      expect(submit.status).toBe(200);

      const list = await request(app).get('/api/appeals').set(admin.headers);
      const appeal = list.body.find((a) => a.appealText === 'approve please');
      CREATED_APPEALS.push(appeal.id);

      const patch = await request(app)
        .patch(`/api/appeals/${appeal.id}`)
        .set(admin.headers)
        .send({ status: 'approved' });
      expect(patch.status).toBe(200);

      const after = await db.doc(`users/${APPROVE_ID}`).get();
      expect(after.data().isSuspended).toBe(false);

      // And nothing was written to the literal document `users/undefined`,
      // which is where the old resolution sent the update.
      const junk = await db.doc('users/undefined').get();
      expect(junk.exists).toBe(false);

      await db.doc(`users/${APPROVE_ID}`).delete();
    });

    it('refuses an appeal whose account cannot be resolved', async () => {
      // Rather than writing to `users/undefined` and reporting success.
      const id = await seedAppeal({ appealText: 'no account at all' });
      const res = await request(app)
        .patch(`/api/appeals/${id}`)
        .set(admin.headers)
        .send({ status: 'approved' });

      expect(res.status).toBe(422);
      const junk = await db.doc('users/undefined').get();
      expect(junk.exists).toBe(false);
    });
  });

  describe('access control', () => {
    it('still refuses a non-admin', async () => {
      const plain = await mintRealUser({ uniqueId: REPORTER_ID });
      const res = await request(app).get('/api/appeals').set(plain.headers);
      expect(res.status).toBe(403);
      expect(res.body.appeals).toBeUndefined();
    });
  });
});
