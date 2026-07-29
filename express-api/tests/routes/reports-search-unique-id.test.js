'use strict';

/**
 * SHY-0251 — the Reports tab's search box says "Search by unique ID..." and is
 * `type="number"`, so a moderator can only type digits into it. The endpoint,
 * however, matched only `reportedUserName`, `reporterName`, `reason` and
 * `description` — never the unique-ID fields the report documents carry. Every
 * search a moderator could physically perform returned nothing.
 *
 * REAL services: real Auth-emulator admin token, real Firestore documents.
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

const ADMIN_ID = 65100001;
const REPORTED_ID = 65100002;
const REPORTER_ID = 65100003;
const PREFIX = `shy0251-${process.pid}`;
const CREATED = [];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', reportsRouter);
  return app;
}

async function seedReport(fields) {
  const id = `${PREFIX}-${CREATED.length}-${Date.now()}`;
  await db.doc(`reports/${id}`).set({
    id,
    status: 'pending',
    reason: 'Spam',
    description: 'unrelated description',
    reportedUserName: 'Zebra Reported',
    reporterName: 'Yak Reporter',
    reportedUserUniqueId: REPORTED_ID,
    reporterUniqueId: REPORTER_ID,
    evidenceUrls: [],
    createdAt: Date.now(),
    ...fields,
  });
  CREATED.push(id);
  return id;
}

/**
 * The endpoint groups reports UNDER the reported user (`{ users: [{ reports }] }`),
 * so flatten before looking for an id. Reading `body.reports` would silently
 * find nothing and make every assertion below fail for the wrong reason.
 */
const idsIn = (body) => (body.users || []).flatMap((u) => (u.reports || []).map((r) => r.id));

describe('SHY-0251 — reports search must match unique IDs', () => {
  let app;
  let admin;

  beforeAll(async () => {
    await assertEmulatorReachable();
    app = createApp();
    admin = await mintRealUser({ uniqueId: ADMIN_ID, admin: true });
    await mintRealUser({ uniqueId: REPORTED_ID });
    await mintRealUser({ uniqueId: REPORTER_ID });
  });

  afterAll(async () => {
    await Promise.all(CREATED.map((id) => db.doc(`reports/${id}`).delete()));
    clearAuthCaches();
    process.env.NODE_ENV = PRIOR_NODE_ENV;
  });

  const search = (term) =>
    request(app).get(`/api/reports?status=pending&search=${term}`).set(admin.headers);

  test('search by reportedUserUniqueId returns the report', async () => {
    const id = await seedReport({});
    const res = await search(String(REPORTED_ID));
    expect(res.status).toBe(200);
    expect(idsIn(res.body)).toContain(id);
  });

  test('search by reporterUniqueId returns the report', async () => {
    const id = await seedReport({});
    const res = await search(String(REPORTER_ID));
    expect(idsIn(res.body)).toContain(id);
  });

  test('a partial unique id matches by substring, like the text fields do', async () => {
    const id = await seedReport({});
    const res = await search(String(REPORTED_ID).slice(0, 5));
    expect(idsIn(res.body)).toContain(id);
  });

  test('search by reason still works — no regression', async () => {
    const id = await seedReport({ reason: 'Harassment' });
    const res = await search('harassment');
    expect(idsIn(res.body)).toContain(id);
  });

  test('search by display name still works — no regression', async () => {
    const id = await seedReport({ reportedUserName: 'Quokka Someone' });
    const res = await search('quokka');
    expect(idsIn(res.body)).toContain(id);
  });

  test('a search matching nothing returns an empty list, not an error', async () => {
    await seedReport({});
    const res = await search('99999999');
    expect(res.status).toBe(200);
    expect(idsIn(res.body)).toEqual([]);
  });

  test('a report missing the unique-id fields does not break the search', async () => {
    // Written as an ABSENT key, not `undefined` — Firestore rejects explicit
    // undefined, so setting it that way would test the writer, not the reader.
    const id = `${PREFIX}-legacy-${Date.now()}`;
    await db.doc(`reports/${id}`).set({
      id,
      status: 'pending',
      reason: 'Legacy shape',
      description: 'no unique ids on this document at all',
      reportedUserName: 'Legacy Reported',
      reporterName: 'Legacy Reporter',
      reportedUserId: `legacy-uid-${Date.now()}`,
      createdAt: Date.now(),
    });
    CREATED.push(id);

    const res = await search('legacy');
    expect(res.status).toBe(200);
    expect(idsIn(res.body)).toContain(id);
  });
});
