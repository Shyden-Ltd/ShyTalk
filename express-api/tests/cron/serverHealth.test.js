/**
 * serverHealth.test.js — EPIC-0003 / SHY-0120 slice 6 (real integration).
 *
 * MIGRATED off the firebase + log + child_process Jest mocks (and the
 * monkey-patched `process.memoryUsage` / `os.totalmem`). The prior tests faked
 * the memory numbers + the pm2 output and asserted "the alert mock was
 * called", so they could not catch a real alert doc written wrong, the
 * in-flight guard failing, or the PM2 branch crashing against a real binary.
 *
 * This suite drives the REAL serverHealth check with the REAL emulator-backed
 * alertManager:
 *   - REAL `process.memoryUsage()` / `os.totalmem()` — not patched. The check
 *     is steered by the THRESHOLD instead: a tiny positive threshold makes the
 *     real RSS% exceed it (alert fires); a high threshold keeps it under (no
 *     alert). serverHealth reads `serverMemoryWarningPercent || 30`, so a
 *     seeded 0 would fall through to 30 — the fire test uses 0.01 (the test
 *     process always uses far more than 0.01% of system RAM).
 *   - REAL alertManager: createAlert writes a real `alerts/{id}` doc, asserted
 *     by reading the collection. Its config comes from `alertConfig/settings`
 *     via the async loadConfig cache; serverHealth reads the SYNC getConfig(),
 *     so applyConfig() seeds the doc, resets the cache, then warms it with a
 *     real trackSlowEndpoint(_, 0) (0 <= threshold → loads config, no alert).
 *   - REAL `execFile('pm2', ['jlist'])`: the PM2 branch runs live (resolves
 *     gracefully whether or not pm2 is installed — absent → err branch
 *     resolves; present → first run has no restart delta → no alert).
 *
 * The PM2 restart-DELTA detection logic is unit-tested as a pure function
 * (`detectPm2Restarts`, serverHealth.unit.test.js) because a real pm2 restart
 * between runs is not CI-inducible (operator-approved Option A, EPIC-0003).
 *
 * Isolation: clears `alerts` + `alertConfig` and resets the alertManager's
 * in-memory state in beforeEach. See tests/helpers/firebase-emulator.js.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const serverHealth = require('../../src/cron/serverHealth');
const alertManager = require('../../src/utils/alertManagerInstance');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');

const alertsByType = async (type) => {
  const snap = await db.collection('alerts').where('type', '==', type).get();
  return snap.docs.map((d) => d.data());
};
const alertCount = async () => (await db.collection('alerts').get()).size;

// Seed alertConfig + warm the alertManager cache so serverHealth's SYNC
// getConfig() returns it. trackSlowEndpoint(_, 0) calls loadConfig() then
// early-returns (0 <= slowEndpointThresholdMs) — config loaded, no alert.
async function applyConfig(overrides) {
  await db.doc('alertConfig/settings').set(overrides);
  alertManager._clearState();
  await alertManager.trackSlowEndpoint('config-warmup', 0);
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

beforeEach(async () => {
  await clearCollection(db, 'alerts');
  await clearCollection(db, 'alertConfig');
  alertManager._clearState();
});

afterAll(async () => {
  await clearCollection(db, 'alerts');
  await clearCollection(db, 'alertConfig');
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('serverHealth check (real Firestore emulator + real alertManager)', () => {
  test('writes no alert when RSS is under the memory threshold (PM2 disabled)', async () => {
    await applyConfig({ serverMemoryWarningPercent: 99.9, pm2RestartAlert: false });

    await expect(serverHealth(alertManager)).resolves.toBeUndefined();

    expect(await alertCount()).toBe(0);
  });

  test('fires a high_memory alert with real RSS metrics when over the threshold', async () => {
    // 0.01% — the test process always uses far more of system RAM than that.
    await applyConfig({ serverMemoryWarningPercent: 0.01, pm2RestartAlert: false });

    await serverHealth(alertManager);

    const alerts = await alertsByType('high_memory');
    expect(alerts).toHaveLength(1);
    const alert = alerts[0];
    expect(alert.severity).toBe('warning');
    expect(alert.title).toBe('High server memory usage');
    expect(alert.status).toBe('unresolved');
    expect(alert.message).toMatch(/RSS/);
    // Real, non-faked metrics on the alert context.
    expect(typeof alert.context.rssMB).toBe('number');
    expect(alert.context.rssMB).toBeGreaterThan(0);
    expect(typeof alert.context.systemTotalMB).toBe('number');
    expect(alert.context.systemTotalMB).toBeGreaterThan(0);
    expect(typeof alert.context.rssPercent).toBe('number');
  });

  test('the in-flight guard fires exactly ONE alert under concurrent invocation', async () => {
    await applyConfig({ serverMemoryWarningPercent: 0.01, pm2RestartAlert: false });

    // Both calls start in the same tick; the first sets inFlight=true
    // synchronously before any await, so the second short-circuits and writes
    // no second alert.
    await Promise.all([serverHealth(alertManager), serverHealth(alertManager)]);

    expect(await alertsByType('high_memory')).toHaveLength(1);
  });

  test('runs the PM2 branch live and writes no spurious alert (real execFile)', async () => {
    // High memory threshold so only the PM2 branch is meaningfully exercised.
    // execFile('pm2','jlist') runs for real: absent → err branch resolves;
    // present → first run has no restart delta → no pm2_restart alert.
    await applyConfig({ serverMemoryWarningPercent: 99.9, pm2RestartAlert: true });

    await expect(serverHealth(alertManager)).resolves.toBeUndefined();

    expect(await alertsByType('pm2_restart')).toHaveLength(0);
    expect(await alertCount()).toBe(0);
  });
});
