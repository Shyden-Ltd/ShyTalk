'use strict';

// SHY-0060 — safety-audit of blocked attempts (AC53), proven through the real
// caller: checkFeatureAccess fires a fire-and-forget write to the safetyAudit
// collection when it produces a block. Real emulator, no mocks.
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { checkFeatureAccess } = require('../../src/safety/enforce');
const {
  __resetAgeGatingFlagCache,
  __setSafetyConfigDocForTests,
} = require('../../src/safety/age-gating-flag');
const { hashUserId, SAFETY_AUDIT_COLLECTION } = require('../../src/safety/safety-audit');

const SAFETY_DOC = 'config/safety-test-audit';
const NOW = Date.UTC(2026, 6, 8);
const dobForAge = (years) => Date.UTC(2026 - years, 6, 8);
const setFlag = (enabled) => db.doc(SAFETY_DOC).set({ ageGatingEnabled: enabled });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll by the (unique-per-test) hashed id — the audit write is fire-and-forget
// so it may post-date the checkFeatureAccess return. Scoped to one id so the
// shared collection needs no clearing.
async function auditRowsFor(userId, { timeoutMs = 4000 } = {}) {
  const q = db.collection(SAFETY_AUDIT_COLLECTION).where('userIdHash', '==', hashUserId(userId));
  const deadline = Date.now() + timeoutMs;
  let snap = await q.get();
  while (snap.empty && Date.now() < deadline) {
    await sleep(50);
    snap = await q.get();
  }
  return snap.docs.map((d) => d.data());
}

// safetyAudit is a SHARED collection (every age-gate suite writes to it and the
// local emulator persists across runs), so this file — the only one that
// ASSERTS row counts — surgically clears its own ids by hash. Endpoint suites
// never query it, so their rows are harmless.
const FILE_IDS = [65000001, 65000002, 65000003, 65000004, 65000005];
async function clearAuditFor(userId) {
  const snap = await db
    .collection(SAFETY_AUDIT_COLLECTION)
    .where('userIdHash', '==', hashUserId(userId))
    .get();
  if (snap.empty) return;
  const batch = db.batch();
  for (const d of snap.docs) batch.delete(d.ref);
  await batch.commit();
}

beforeAll(async () => {
  await assertEmulatorReachable();
  __setSafetyConfigDocForTests(SAFETY_DOC);
});
afterAll(() => {
  __setSafetyConfigDocForTests();
  if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = PRIOR_NODE_ENV;
});
beforeEach(async () => {
  __resetAgeGatingFlagCache();
  await db.doc(SAFETY_DOC).delete();
  for (const id of FILE_IDS) await clearAuditFor(id);
});
afterEach(async () => {
  await db.doc(SAFETY_DOC).delete();
  for (const id of FILE_IDS) await clearAuditFor(id);
});

describe('safety-audit — a blocked attempt is logged', () => {
  test('an under-age block writes one row: hashed id, feature, threshold, age, region', async () => {
    await setFlag(true);
    const userData = {
      uniqueId: 65000001,
      ageVerified: true,
      dateOfBirth: dobForAge(14),
      nationality: 'GB',
    };

    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', userData, NOW);
    expect(block.status).toBe(403);

    const rows = await auditRowsFor(65000001);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userIdHash: hashUserId(65000001),
      feature: 'DIRECT_MESSAGE_WITH_STRANGER',
      threshold: 18,
      userAge: 14,
      region: 'GB',
    });
    expect(typeof rows[0].timestamp).toBe('number');
    // The plaintext id must NEVER be persisted.
    expect(rows[0]).not.toHaveProperty('userId');
    expect(rows[0]).not.toHaveProperty('uniqueId');
  });

  test('an unverified (REVERIFY) block logs userAge null and keeps the region', async () => {
    await setFlag(true);
    const userData = {
      uniqueId: 65000002,
      ageVerified: false,
      dateOfBirth: dobForAge(30),
      nationality: 'DE',
    };

    await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', userData, NOW);

    const rows = await auditRowsFor(65000002);
    expect(rows).toHaveLength(1);
    expect(rows[0].userAge).toBeNull();
    expect(rows[0].region).toBe('DE');
  });

  test('a region block logs the elevated threshold', async () => {
    await setFlag(true);
    const userData = {
      uniqueId: 65000003,
      ageVerified: true,
      dateOfBirth: dobForAge(15),
      nationality: 'DE',
    };

    await checkFeatureAccess(db, 'SIGNUP', userData, NOW);

    const rows = await auditRowsFor(65000003);
    expect(rows[0]).toMatchObject({ feature: 'SIGNUP', threshold: 16, userAge: 15, region: 'DE' });
  });
});

describe('safety-audit — allowed / flag-off write NO row', () => {
  test('an ALLOWED verdict writes no audit row', async () => {
    await setFlag(true);
    const userData = { uniqueId: 65000004, ageVerified: true, dateOfBirth: dobForAge(30) };

    const block = await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', userData, NOW);
    expect(block).toBeNull();

    const rows = await auditRowsFor(65000004, { timeoutMs: 600 });
    expect(rows).toHaveLength(0);
  });

  test('flag OFF writes no audit row (the gate is never evaluated)', async () => {
    await setFlag(false);
    const userData = { uniqueId: 65000005, ageVerified: true, dateOfBirth: dobForAge(14) };

    await checkFeatureAccess(db, 'DIRECT_MESSAGE_WITH_STRANGER', userData, NOW);

    const rows = await auditRowsFor(65000005, { timeoutMs: 600 });
    expect(rows).toHaveLength(0);
  });
});
