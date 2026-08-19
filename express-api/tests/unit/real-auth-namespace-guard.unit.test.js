/**
 * `assertNoTestNamespace()` is the only thing standing between "this file
 * namespaced its Firestore project AND mints Auth tokens" and a mystery 401,
 * because the Auth emulator resolves ID tokens against the project it was
 * STARTED with. Firestore isolates per project; Auth does not.
 *
 * Pure unit test: firebase + the auth middleware are doubled so nothing touches
 * an emulator (doubles are permitted in `tests/unit/**` only).
 */

jest.mock('../../src/utils/firebase', () => ({
  auth: { createCustomToken: jest.fn() },
  db: { doc: jest.fn(() => ({ set: jest.fn() })) },
}));

jest.mock('../../src/middleware/auth', () => ({
  clearUniqueIdCache: jest.fn(),
  clearSuspensionCache: jest.fn(),
  clearAdminClaimCache: jest.fn(),
  clearBanCache: jest.fn(),
}));

const {
  assertNoTestNamespace,
  mintRealUser,
  mintTokenWithoutUserDoc,
} = require('../helpers/real-auth');

const PRIOR = process.env.FIRESTORE_TEST_NAMESPACE;

afterEach(() => {
  if (PRIOR === undefined) delete process.env.FIRESTORE_TEST_NAMESPACE;
  else process.env.FIRESTORE_TEST_NAMESPACE = PRIOR;
});

describe('assertNoTestNamespace — Firestore namespacing and Auth minting are mutually exclusive', () => {
  test('a clean environment passes', () => {
    delete process.env.FIRESTORE_TEST_NAMESPACE;
    expect(() => assertNoTestNamespace()).not.toThrow();
  });

  test('a namespaced environment throws, naming the offending namespace', () => {
    process.env.FIRESTORE_TEST_NAMESPACE = 'subs';
    expect(() => assertNoTestNamespace()).toThrow(/FIRESTORE_TEST_NAMESPACE is set to 'subs'/);
  });

  test('the error explains WHY, so the reader is not left chasing a 401', () => {
    process.env.FIRESTORE_TEST_NAMESPACE = 'backups';
    expect(() => assertNoTestNamespace()).toThrow(/401/);
  });

  test.each([
    ['mintRealUser', () => mintRealUser({ uniqueId: 1 })],
    ['mintTokenWithoutUserDoc', () => mintTokenWithoutUserDoc({})],
  ])('%s refuses to mint while a namespace is set', async (_name, call) => {
    process.env.FIRESTORE_TEST_NAMESPACE = 'storage';
    await expect(call()).rejects.toThrow(/FIRESTORE_TEST_NAMESPACE/);
  });

  test('mintRealUser rejects BEFORE writing a users doc or minting a token', async () => {
    const { auth, db } = require('../../src/utils/firebase');
    process.env.FIRESTORE_TEST_NAMESPACE = 'exports';

    await expect(mintRealUser({ uniqueId: 42 })).rejects.toThrow(/FIRESTORE_TEST_NAMESPACE/);

    expect(db.doc).not.toHaveBeenCalled();
    expect(auth.createCustomToken).not.toHaveBeenCalled();
  });
});
