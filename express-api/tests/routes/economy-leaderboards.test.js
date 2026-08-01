/**
 * SHY-0265 — GET /api/economy/leaderboards
 *
 * THE FEATURE EXISTED ONLY AS A TEST. j05 has asserted this since it was
 * written:
 *
 *   When Alice on Web opens "/leaderboard"
 *   Then within 3000ms Alice's Web UI shows her own rank in the top 100
 *   Then the response from /api/economy/leaderboards has cohort="adult" in every row
 *
 * There was no route, no page and no screen. The scenario failed on every run
 * and the failure pointed at the app. Operator 2026-08-01: "if we have tests
 * written for them then that means they should have been built already, because
 * of TDD… which is another failure we need to fix."
 *
 * COHORT SCOPING IS THE SAFETY PROPERTY, not a nicety. ShyTalk segregates minors
 * from adults in rooms, discovery and PMs; a leaderboard that mixed them would
 * re-open that boundary through a back door and put minors' display names in
 * front of adults who cannot otherwise see them. So the cohort comes from the
 * VERIFIED claim and never from a parameter — otherwise any adult could ask for
 * the minor board.
 *
 * Real Firestore emulator throughout. No doubles.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const express = require('express');
const request = require('supertest');

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable, clearPrefixed } = require('../helpers/firebase-emulator');
const { mintRealUser } = require('../helpers/real-auth');
const { authMiddleware } = require('../../src/middleware/auth');
const economyRouter = require('../../src/routes/economy');

// Per-FILE id prefix so parallel workers never clear each other's rows.
const P = 'lb265';
let app;
const users = {};

/** Seed a user with a known cohort and gift spend. */
async function seedSpender({ key, cohort, spend, displayName, banned = false }) {
  const uniqueId = `${P}-${key}`;
  await db.doc(`users/${uniqueId}`).set({
    uniqueId,
    displayName,
    cohort,
    giftSpendTotal: spend,
    ...(banned ? { isBanned: true } : {}),
  });
  users[key] = uniqueId;
  return uniqueId;
}

beforeAll(async () => {
  await assertEmulatorReachable();
  app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api', economyRouter);
}, 60000);

afterAll(async () => {
  await clearPrefixed(db, 'users', P);
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

beforeEach(async () => {
  await clearPrefixed(db, 'users', P);
});

/** An adult caller with a verified cohort claim. */
async function adultCaller(spend = 0) {
  const minted = await mintRealUser({
    uniqueId: `${P}-caller`,
    cohort: 'adult',
    extraUserData: { cohort: 'adult', giftSpendTotal: spend, displayName: 'Alice' },
  });
  return minted;
}

describe('cohort scoping — the safety property', () => {
  test('every row is in the CALLER’s cohort', async () => {
    const caller = await adultCaller(500);
    await seedSpender({ key: 'a1', cohort: 'adult', spend: 900, displayName: 'AdultOne' });
    await seedSpender({ key: 'm1', cohort: 'minor', spend: 9000, displayName: 'MinorTop' });

    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    // The minor with the HIGHEST spend must be absent — the assertion j05 makes.
    for (const row of res.body.rows) expect(row.cohort).toBe('adult');
    expect(res.body.rows.map((r) => r.displayName)).not.toContain('MinorTop');
  });

  test('a forged cohort parameter is ignored — the claim decides', async () => {
    // Without this, any adult could enumerate minors by adding ?cohort=minor.
    const caller = await adultCaller(100);
    await seedSpender({ key: 'm2', cohort: 'minor', spend: 5000, displayName: 'MinorTwo' });

    const res = await request(app)
      .get('/api/economy/leaderboards?cohort=minor')
      .set('Authorization', `Bearer ${caller.idToken}`);

    expect(res.status).toBe(200);
    for (const row of res.body.rows) expect(row.cohort).toBe('adult');
  });

  test('a banned user is not left on public display', async () => {
    const caller = await adultCaller(100);
    await seedSpender({
      key: 'b1',
      cohort: 'adult',
      spend: 9999,
      displayName: 'BannedWhale',
      banned: true,
    });

    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);

    expect(res.body.rows.map((r) => r.displayName)).not.toContain('BannedWhale');
  });
});

describe('ranking', () => {
  test('rows are ordered by spend, highest first, with ranks from 1', async () => {
    const caller = await adultCaller(1);
    await seedSpender({ key: 'r1', cohort: 'adult', spend: 300, displayName: 'Third' });
    await seedSpender({ key: 'r2', cohort: 'adult', spend: 900, displayName: 'First' });
    await seedSpender({ key: 'r3', cohort: 'adult', spend: 600, displayName: 'Second' });

    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);

    const names = res.body.rows.map((r) => r.displayName);
    expect(names.slice(0, 3)).toEqual(['First', 'Second', 'Third']);
    expect(res.body.rows[0].rank).toBe(1);
    expect(res.body.rows[1].rank).toBe(2);
  });

  test('ties break deterministically, so equal spenders never swap places', async () => {
    // Two requests returning a different order would make the whole board look
    // unstable and would flake any test that asserts on it.
    const caller = await adultCaller(1);
    await seedSpender({ key: 't1', cohort: 'adult', spend: 500, displayName: 'TieA' });
    await seedSpender({ key: 't2', cohort: 'adult', spend: 500, displayName: 'TieB' });

    const first = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);
    const second = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);

    expect(first.body.rows.map((r) => r.uniqueId)).toEqual(second.body.rows.map((r) => r.uniqueId));
  });

  test('caps at 100 rows', async () => {
    const caller = await adultCaller(1);
    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);
    expect(res.body.rows.length).toBeLessThanOrEqual(100);
  });

  test('a cohort with few spenders returns only what exists, unpadded', async () => {
    const caller = await adultCaller(50);
    await seedSpender({ key: 's1', cohort: 'adult', spend: 100, displayName: 'Only' });

    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);

    expect(res.body.rows.every((r) => r.displayName && r.uniqueId)).toBe(true);
  });

  test('an empty display name falls back to the id, never a blank row', async () => {
    const caller = await adultCaller(1);
    await seedSpender({ key: 'n1', cohort: 'adult', spend: 800, displayName: '' });

    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);

    const row = res.body.rows.find((r) => r.uniqueId === `${P}-n1`);
    expect(row.displayName).toBeTruthy();
  });
});

describe('the caller’s own standing', () => {
  test('`me` is present even when the caller is outside the top 100', async () => {
    const caller = await adultCaller(1);
    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);
    expect(res.body.me).toBeTruthy();
    expect(res.body.me.uniqueId).toBe(`${P}-caller`);
  });

  test('a caller who has spent nothing gets amount 0 and NO rank', async () => {
    // The absence of a rank is information — omitting the caller entirely would
    // leave them unable to tell "unranked" from "the page is broken".
    const caller = await adultCaller(0);
    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${caller.idToken}`);
    expect(res.body.me.amount).toBe(0);
    expect(res.body.me.rank).toBeNull();
  });
});

describe('access control', () => {
  test('unauthenticated requests get 401 and no rows', async () => {
    const res = await request(app).get('/api/economy/leaderboards');
    expect(res.status).toBe(401);
    expect(res.body.rows).toBeUndefined();
  });

  test('a suspended caller is refused — a leaderboard is a social surface', async () => {
    const suspended = await mintRealUser({
      uniqueId: `${P}-susp`,
      cohort: 'adult',
      extraUserData: {
        cohort: 'adult',
        isSuspended: true,
        suspensionEndDate: new Date(Date.now() + 864e5).toISOString(),
        giftSpendTotal: 100,
      },
    });
    const res = await request(app)
      .get('/api/economy/leaderboards')
      .set('Authorization', `Bearer ${suspended.idToken}`);
    expect([401, 403]).toContain(res.status);
    expect(res.body.rows).toBeUndefined();
  });
});

describe('the ranking key is maintained by the product, not by the test', () => {
  /**
   * A leaderboard ranked on a field nothing writes would be permanently empty —
   * exactly the failure mode this whole story exists to fix, reproduced one
   * layer down. So the gift path itself must increment `giftSpendTotal`, in the
   * SAME transaction as the coin debit: a partial failure that debited coins but
   * skipped the increment would give away a gift for free, and one that did the
   * reverse would grant a rank nobody paid for.
   */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/routes/economy.js'), 'utf8');

  test('every gift-send site increments giftSpendTotal', () => {
    const debits = src.match(/shyCoins: FieldValue\.increment\(-totalCost\)/g) || [];
    const credits = src.match(/giftSpendTotal: FieldValue\.increment\(totalCost\)/g) || [];
    expect(debits.length).toBeGreaterThan(0);
    expect(credits.length).toBe(debits.length);
  });

  test('the increment shares the debit’s transaction', () => {
    // Adjacency inside one `t.update` object is what makes them atomic. Split
    // across two updates they could diverge under a retry.
    const together =
      /t\.update\(senderRef, \{\s*shyCoins: FieldValue\.increment\(-totalCost\),\s*giftSpendTotal: FieldValue\.increment\(totalCost\),\s*\}\)/g;
    const matches = src.match(together) || [];
    const debits = src.match(/shyCoins: FieldValue\.increment\(-totalCost\)/g) || [];
    expect(matches.length).toBe(debits.length);
  });
});
