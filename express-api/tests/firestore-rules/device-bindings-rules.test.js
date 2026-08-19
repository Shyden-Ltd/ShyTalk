/**
 * REAL Firestore security-rules tests for `deviceBindings/{deviceId}`, against
 * the live emulator via `@firebase/rules-unit-testing` (SHY-0170, EPIC-0006).
 *
 * The device-lock (anti-abuse / ban-evasion) binding is now owned entirely by
 * the Express API (`POST /api/devices/lock-check` + `/api/device-info`, both via
 * the Admin SDK, which BYPASSES these rules). No client — app or admin console
 * (which reads via `/api/admin/devices`) — touches `deviceBindings` directly any
 * more, so the collection is tightened to DENY ALL client access. These tests
 * prove the denial against the real engine: a signed-in user cannot read even
 * their OWN binding, cannot create/update/delete, and an anon caller is denied.
 *
 * Requires the Firestore emulator (`FIRESTORE_EMULATOR_HOST`, default
 * localhost:8080). Start it with `bash local/start.sh`.
 */

const { readFileSync } = require('fs');
const { join } = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const { firestoreHostPort, assertEmulatorReachable } = require('../helpers/firebase-emulator');

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');
const PROJECT_ID = `demo-shytalk-devbind-rules-${process.env.JEST_WORKER_ID || '1'}`;

// uniqueId is a NUMBER in the claim (as Express mints it); the rule would
// stringify via `string(callerUniqueId())`.
const OWNER = { uid: 'fbuid-dev-owner', uniqueId: 70001, cohort: 'adult' };
const OTHER = { uid: 'fbuid-dev-other', uniqueId: 70002, cohort: 'adult' };
const ADMIN = { uid: 'fbuid-dev-admin', uniqueId: 70003, cohort: 'adult', admin: true };

let testEnv;
const handles = new Map();

function dbFor(persona) {
  const { uid, ...claims } = persona;
  if (!handles.has(uid)) {
    handles.set(uid, testEnv.authenticatedContext(uid, claims).firestore());
  }
  return handles.get(uid);
}
function dbAnon() {
  if (!handles.has('__anon__')) {
    handles.set('__anon__', testEnv.unauthenticatedContext().firestore());
  }
  return handles.get('__anon__');
}

/** Seed a binding via the admin-bypass context (mirrors the server Admin SDK write). */
function seedBinding(deviceId, ownerUniqueId) {
  return testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .firestore()
      .doc(`deviceBindings/${deviceId}`)
      .set({ uniqueId: String(ownerUniqueId), boundAt: 1 });
  });
}

beforeAll(async () => {
  await assertEmulatorReachable();
  const { host, port } = firestoreHostPort();
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  handles.clear();
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('deviceBindings/{deviceId} — server-only, all client access denied (real rules engine)', () => {
  test('the admin-bypass seed itself succeeds (sanity — the Admin SDK path still works)', async () => {
    await assertSucceeds(seedBinding('d-sanity', OWNER.uniqueId));
  });

  test('a signed-in user CANNOT read even their OWN device binding', async () => {
    await seedBinding('d-own', OWNER.uniqueId);
    await assertFails(dbFor(OWNER).doc('deviceBindings/d-own').get());
  });

  test('a signed-in user CANNOT read ANOTHER user’s binding', async () => {
    await seedBinding('d-other', OWNER.uniqueId);
    await assertFails(dbFor(OTHER).doc('deviceBindings/d-other').get());
  });

  test('an ADMIN-claim client CANNOT read directly either (admin console uses the API)', async () => {
    await seedBinding('d-admin', OWNER.uniqueId);
    await assertFails(dbFor(ADMIN).doc('deviceBindings/d-admin').get());
  });

  test('an anonymous caller CANNOT read', async () => {
    await seedBinding('d-anon', OWNER.uniqueId);
    await assertFails(dbAnon().doc('deviceBindings/d-anon').get());
  });

  test('a signed-in user CANNOT create a binding (bindDevice is server-only now)', async () => {
    await assertFails(
      dbFor(OWNER)
        .doc('deviceBindings/d-create')
        .set({ uniqueId: String(OWNER.uniqueId) }),
    );
  });

  test('a signed-in user CANNOT update an existing binding', async () => {
    await seedBinding('d-update', OWNER.uniqueId);
    await assertFails(
      dbFor(OWNER)
        .doc('deviceBindings/d-update')
        .set({ uniqueId: String(OWNER.uniqueId), x: 1 }),
    );
  });

  test('a signed-in user CANNOT delete a binding', async () => {
    await seedBinding('d-del', OWNER.uniqueId);
    await assertFails(dbFor(OWNER).doc('deviceBindings/d-del').delete());
  });
});
