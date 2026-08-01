/**
 * The liveness probe, against the REAL emulator.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE UNIT TESTS.
 *
 * `tests/unit/emulator-liveness-probe.unit.test.js` injects a fake Firestore to
 * exercise the timeout race, the caching, and the error wording — none of which
 * needs a real service. But a fake db accepts ANY collection name, and the first
 * real run of the new probe failed immediately:
 *
 *   3 INVALID_ARGUMENT: Collection id "__emulator_liveness_probe__" is invalid
 *   because it is reserved.
 *
 * Firestore reserves every identifier matching `__.*__`. Ten green unit tests
 * said the probe worked; the real emulator said it could not even write. That
 * gap is the whole reason this repo runs integration tests against the real
 * local stack — and it applies to the guard as much as to the product.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const {
  assertEmulatorReachable,
  assertPortOpen,
  resetLivenessCache,
} = require('./firebase-emulator');

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('against the running emulator', () => {
  beforeEach(() => resetLivenessCache());

  test('the probe completes a real gRPC round-trip', async () => {
    await expect(assertEmulatorReachable()).resolves.toBeUndefined();
  });

  test('the probe collection name is one Firestore actually accepts', async () => {
    // The regression that reached the real emulator. Asserted directly so a
    // future rename back into `__…__` reddens here rather than in forty
    // unrelated suites' beforeAll hooks.
    const ref = db.collection('emulator-liveness-probe').doc('name-validity-check');
    await expect(ref.set({ at: Date.now() })).resolves.toBeDefined();
    await ref.delete();
  });

  test('it leaves nothing behind', async () => {
    await assertEmulatorReachable();
    const snap = await db.collection('emulator-liveness-probe').limit(5).get();
    // Other workers may be probing concurrently, so this asserts the probe
    // deletes ITS document, not that the collection is globally empty.
    const mine = snap.docs.filter((d) => d.id.startsWith(`p-${process.pid}-`));
    expect(mine).toEqual([]);
  });

  test('it is fast when the emulator is healthy', async () => {
    // The measured contrast: 223ms healthy versus 60,004ms wedged. A probe that
    // took seconds on a good stack would be turned off.
    const started = Date.now();
    await assertEmulatorReachable();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('the cached success makes the second call free', async () => {
    await assertEmulatorReachable();
    const started = Date.now();
    await assertEmulatorReachable();
    expect(Date.now() - started).toBeLessThan(200);
  });

  test('assertPortOpen still answers for the port alone', async () => {
    await expect(assertPortOpen()).resolves.toBeUndefined();
  });
});
