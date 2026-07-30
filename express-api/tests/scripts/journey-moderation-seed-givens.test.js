/**
 * journey-moderation-seed-givens.test.js — SHY-0259
 *
 * j11's moderation cycle is written as a chain of scenarios where each one
 * restates the previous one's outcome as its own precondition:
 *
 *   Scenario: Greta issues a first-strike warning …
 *   Scenario: … Given Greta has issued a warning to Raul on Nora's report
 *
 * Twelve of those setup Givens had no matcher at all, so every scenario past
 * the first failed as STEP_NOT_IMPLEMENTED — indistinguishable, in the matrix
 * report, from the product being broken.
 *
 * They are now implemented by driving the REAL moderation routes as the REAL
 * personas. The alternative — mirroring each route's Firestore writes inside
 * the harness — creates a second implementation of the same behaviour, and
 * the two drift silently. j11 is the evidence: it asserts a field called
 * `suspendedUntil` that the product has never written (production uses
 * `isSuspended` + `suspensionEndDate`), because the corpus was authored
 * against a mirror rather than against the route.
 *
 * So this suite runs the real routers, behind the real authMiddleware, with
 * real Firebase ID tokens, against the real Firestore emulator. No doubles:
 * a mocked db cannot prove that POST /api/appeals rejects a caller who is not
 * genuinely suspended, and that rejection is exactly what makes the
 * suspension Given trustworthy.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');
const path = require('path');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { mintRealUser, clearAuthCaches } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');
const reportsRouter = require('../../src/routes/reports');
const adminUsersRouter = require('../../src/routes/admin-users');
const conversationsRouter = require('../../src/routes/conversations');
const usersRouter = require('../../src/routes/users');

const runner = require(path.resolve(__dirname, '../../scripts/manual-qa-runner.js'));
const { executeStep } = runner;

// Distinct from every other persona uniqueId so a parallel Jest worker
// running the real j11 corpus cannot collide with these.
const REPORTER = 50009011;
const OFFENDER = 50009012;
const ADMIN = 50009013;

let app;
const tokens = new Map();

/**
 * Route the runner's ctx.fetch into the real Express app via supertest.
 *
 * This is an adapter, not a double: every request runs the real router, the
 * real authMiddleware and the real Firestore emulator. It exists only because
 * the runner speaks fetch() and supertest speaks its own client — no
 * behaviour is stubbed, and a route that 403s here 403s in production.
 */
function supertestFetch(url, init = {}) {
  const apiPath = url.replace(/^https?:\/\/[^/]+/, '');
  const method = (init.method || 'GET').toLowerCase();
  let req = request(app)[method](apiPath);
  for (const [k, v] of Object.entries(init.headers || {})) req = req.set(k, v);
  if (init.body) req = req.send(JSON.parse(init.body));
  return req.then((res) => ({
    status: res.status,
    text: async () => (res.text === undefined ? JSON.stringify(res.body) : res.text),
    json: async () => res.body,
  }));
}

function makeRunnerCtx() {
  const ctx = {
    // No host: requests never leave the process, so an origin would be a
    // fiction. supertestFetch strips any origin and dials the app directly.
    apiBase: '',
    target: 'local',
    sessions: new Map(),
    personaPlatforms: new Map(),
    personaPaths: new Map(),
    scenarioVars: new Map(),
    snapshots: new Map(),
    db,
    fetch: supertestFetch,
    locale: 'en',
  };
  for (const [name, uniqueId] of [
    ['Nora', REPORTER],
    ['Raul', OFFENDER],
    ['Greta', ADMIN],
  ]) {
    ctx.sessions.set(name, {
      persona: { uniqueId, displayName: name },
      idToken: tokens.get(name).idToken,
      localId: tokens.get(name).uid,
    });
  }
  return ctx;
}

/**
 * The runner resolves persona names through its own registry, which maps to
 * the provisioned dev/local personas. These tests mint their own isolated
 * users, so the registry lookup is redirected at the three names in play.
 * Everything downstream — routes, auth, Firestore — stays real.
 */
let restorePersonas;
beforeAll(async () => {
  await assertEmulatorReachable();

  // `cohort` rides on the ID TOKEN as a developer claim; it is NOT written
  // to the users doc. The conversations router's cross-cohort gate reads the
  // OTHER participant's cohort from Firestore, so without extraUserData the
  // gate sees `undefined` and 404s the thread — the route working correctly
  // against an incomplete fixture.
  const adult = { cohort: 'adult', extraUserData: { cohort: 'adult' } };
  const minted = await Promise.all([
    mintRealUser({ uniqueId: REPORTER, ...adult }),
    mintRealUser({ uniqueId: OFFENDER, ...adult }),
    mintRealUser({ uniqueId: ADMIN, ...adult, admin: true }),
  ]);
  tokens.set('Nora', minted[0]);
  tokens.set('Raul', minted[1]);
  tokens.set('Greta', minted[2]);

  const registry = new Map([
    ['Nora', { uniqueId: REPORTER, email: 'nora@example.test', displayName: 'Nora' }],
    ['Raul', { uniqueId: OFFENDER, email: 'raul@example.test', displayName: 'Raul' }],
    ['Greta', { uniqueId: ADMIN, email: 'greta@example.test', displayName: 'Greta' }],
    // Theo shares the offender's user doc: the warning Givens are about the
    // flag transition, not about which persona owns it.
    ['Theo', { uniqueId: OFFENDER, email: 'theo@example.test', displayName: 'Theo' }],
  ]);
  const provisioner = require('../../scripts/provision-test-personas');
  const original = provisioner.personas;
  provisioner.personas = [...registry.values()].map((p) => ({ ...p, id: `T-${p.uniqueId}` }));
  restorePersonas = () => {
    provisioner.personas = original;
  };

  app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', reportsRouter);
  app.use('/api', adminUsersRouter);
  app.use('/api', conversationsRouter);
  // acknowledge-warning lives here, and the warning Givens transition it.
  app.use('/api', usersRouter);
});

afterAll(async () => {
  if (restorePersonas) restorePersonas();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(() => clearAuthCaches());

const run = (text, ctx) => executeStep({ kind: 'Given', text }, ctx);

/**
 * Assert a step succeeded WITH its error text in the failure output.
 * `toMatchObject({ ok: true })` prints only "true !== false", which hides
 * the one thing needed to fix it.
 */
const expectStepOk = (r) =>
  expect({ ok: r.ok, error: r.error }).toEqual({ ok: true, error: undefined });

describe('the moderation Givens drive the real routes', () => {
  test('the whole j11 chain establishes real state, step by step', async () => {
    const ctx = makeRunnerCtx();

    const sent = await run('Raul has sent Nora "offensive content #1"', ctx);
    expectStepOk(sent);

    const reported = await run('Nora has just submitted a Harassment report against Raul', ctx);
    expectStepOk(reported);
    const reports = await db.collection('reports').get();
    const mine = reports.docs
      .map((d) => d.data())
      .filter((r) => String(r.reportedUserUniqueId ?? r.reportedId ?? '') === String(OFFENDER));
    expect(mine.length).toBeGreaterThan(0);

    const warned = await run("Greta has issued a warning to Raul on Nora's report", ctx);
    expectStepOk(warned);

    const suspended = await run('Greta has issued a 3-day suspension to Raul', ctx);
    expectStepOk(suspended);
    const offender = await db.doc(`users/${OFFENDER}`).get();
    expect(offender.data()).toMatchObject({ isSuspended: true });
    // The suspension end date is derived from the step's "3-day", not from a
    // constant this test invented, so a matcher that ignored the duration
    // would be caught.
    const endDate = offender.data().suspensionEndDate;
    const threeDays = 3 * 86400000;
    expect(endDate - Date.now()).toBeGreaterThan(threeDays - 120000);
    expect(endDate - Date.now()).toBeLessThan(threeDays + 120000);
  });

  test('the appeal Given is trustworthy because the real route refuses a non-suspended caller', async () => {
    // This is the whole argument for driving real routes. POST /api/appeals
    // returns 400 "User is not suspended" unless the suspension genuinely
    // wrote — so the appeal succeeding is independent evidence that the
    // preceding Given did real work, not just that it returned ok.
    const ctx = makeRunnerCtx();
    await run('Greta has issued a 3-day suspension to Raul', ctx);
    const appealed = await run('Raul has submitted a suspension appeal', ctx);
    expectStepOk(appealed);

    const appeals = await db.collection('suspensionAppeals').where('userId', '==', OFFENDER).get();
    expect(appeals.empty).toBe(false);
  });

  test('an appeal Given re-run on an already-appealed user still reports established', async () => {
    // A Given asserts state, not the act. Re-running a scenario must not
    // fail on "already pending" — but only that specific conflict is
    // forgiven.
    const ctx = makeRunnerCtx();
    await run('Greta has issued a 3-day suspension to Raul', ctx);
    await run('Raul has submitted a suspension appeal', ctx);
    const again = await run('Raul has submitted a suspension appeal', ctx);
    expectStepOk(again);
  });

  test('lifting the suspension clears it through the real route', async () => {
    const ctx = makeRunnerCtx();
    await run('Greta has issued a 3-day suspension to Raul', ctx);
    const lifted = await run("Greta has lifted Raul's suspension", ctx);
    expectStepOk(lifted);
    const after = await db.doc(`users/${OFFENDER}`).get();
    expect(after.data().isSuspended).toBe(false);
  });
});

describe('the admin-dashboard and warning-state Givens', () => {
  test('a queue Given seeds the real collection to the stated depth', async () => {
    const ctx = makeRunnerCtx();
    expectStepOk(await run('Greta is on the admin dashboard with 3 pending reports', ctx));
    // Reads the real collection, not ctx bookkeeping: a matcher that only
    // recorded the number would pass a ctx assertion and fail the journey.
    const snap = await db.collection('reports').count().get();
    expect(snap.data().count).toBeGreaterThanOrEqual(3);
  });

  test('an unregistered queue noun is refused, not silently skipped', async () => {
    const ctx = makeRunnerCtx();
    const r = await run('Greta is on the admin dashboard with 3 pending unicorns', ctx);
    // No matcher accepts this shape at all, so it must surface as an
    // unimplemented step rather than as a quiet success.
    expect(r.ok).toBe(false);
  });

  test('the audit-log floor tops UP and never inflates an existing count', async () => {
    const ctx = makeRunnerCtx();
    const before = (await db.collection('auditLog').count().get()).data().count;
    expectStepOk(
      await run('Greta is on the admin dashboard with at least 5 audit-log entries', ctx),
    );
    const after = (await db.collection('auditLog').count().get()).data().count;
    expect(after).toBeGreaterThanOrEqual(Math.max(before, 5));
    // Re-running must not add more — a Given asserts a floor, not a delta.
    expectStepOk(
      await run('Greta is on the admin dashboard with at least 5 audit-log entries', ctx),
    );
    const third = (await db.collection('auditLog').count().get()).data().count;
    expect(third).toBe(after);
  });

  test('the warning Given sets the real flag, and acknowledging clears it', async () => {
    const ctx = makeRunnerCtx();
    ctx.sessions.set('Theo', ctx.sessions.get('Raul'));
    expectStepOk(await run('Theo is on the warning screen with hasActiveWarning=true', ctx));
    const warned = await db.doc(`users/${OFFENDER}`).get();
    expect(warned.data().hasActiveWarning).toBe(true);

    expectStepOk(await run('Theo has acknowledged the warning', ctx));
    const cleared = await db.doc(`users/${OFFENDER}`).get();
    expect(cleared.data().hasActiveWarning).toBe(false);
  });

  test('"mid-room with no active warning" clears a warning left by an earlier scenario', async () => {
    const ctx = makeRunnerCtx();
    ctx.sessions.set('Theo', ctx.sessions.get('Raul'));
    expectStepOk(await run('Theo is on the warning screen with hasActiveWarning=true', ctx));
    expectStepOk(await run('Theo is mid-room with no active warning', ctx));
    const after = await db.doc(`users/${OFFENDER}`).get();
    expect(after.data().hasActiveWarning).toBe(false);
  });
});

describe('the Givens fail loudly rather than half-succeeding', () => {
  test('an unknown persona names itself in the error', async () => {
    const ctx = makeRunnerCtx();
    const r = await run('Zzyzx has submitted a suspension appeal', ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Zzyzx/);
  });

  test('a non-admin caller cannot suspend — the route decides, not the harness', async () => {
    // Proves the seed is not writing Firestore behind the route's back: with
    // a non-admin session the same Given must fail on the real 403.
    const ctx = makeRunnerCtx();
    ctx.sessions.set('Greta', {
      persona: { uniqueId: REPORTER, displayName: 'Greta' },
      idToken: tokens.get('Nora').idToken,
      localId: tokens.get('Nora').uid,
    });
    const r = await run('Greta has issued a 3-day suspension to Raul', ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/40[13]/);
  });
});
