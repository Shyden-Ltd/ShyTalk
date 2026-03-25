// ─── Shared mock factories ────────────────────────────────────────

const mockFirestore = { collection: jest.fn() };
const mockAuth = { verifyIdToken: jest.fn() };
const mockDatabase = { ref: jest.fn() };
const mockMessaging = { sendEachForMulticast: jest.fn() };
const mockFieldValue = { increment: jest.fn(), serverTimestamp: jest.fn() };
const mockCert = jest.fn().mockReturnValue('mock-credential');
const mockInitializeApp = jest.fn();

function setupFirebaseAdminMock(appsLength = 0) {
  jest.doMock('firebase-admin', () => ({
    apps: { length: appsLength },
    credential: { cert: mockCert },
    initializeApp: mockInitializeApp,
    firestore: Object.assign(jest.fn().mockReturnValue(mockFirestore), {
      FieldValue: mockFieldValue,
    }),
    auth: jest.fn().mockReturnValue(mockAuth),
    database: jest.fn().mockReturnValue(mockDatabase),
    messaging: jest.fn().mockReturnValue(mockMessaging),
  }));
}

describe('firebase.js local mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  afterEach(() => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  });

  test('sets emulator env vars when NODE_ENV is local', () => {
    process.env.NODE_ENV = 'local';
    setupFirebaseAdminMock(0);

    const { configureLocalEmulators } = require('../../src/utils/firebase');

    // configureLocalEmulators is called at require-time, env vars already set
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('localhost:8080');
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('localhost:9099');
    expect(process.env.FIREBASE_DATABASE_EMULATOR_HOST).toBe('localhost:9000');

    // Calling again should be idempotent
    configureLocalEmulators();
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('localhost:8080');
  });

  test('does not set emulator env vars in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.FIREBASE_DATABASE_URL = 'https://test-db.firebaseio.com';
    setupFirebaseAdminMock(0);

    const { configureLocalEmulators } = require('../../src/utils/firebase');

    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeUndefined();
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
    expect(process.env.FIREBASE_DATABASE_EMULATOR_HOST).toBeUndefined();

    // Calling explicitly should still not set them
    configureLocalEmulators();
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeUndefined();
  });

  test('initializes Firebase with projectId in local mode', () => {
    process.env.NODE_ENV = 'local';
    setupFirebaseAdminMock(0);

    require('../../src/utils/firebase');

    expect(mockInitializeApp).toHaveBeenCalledWith({
      projectId: 'demo-shytalk',
      databaseURL: 'http://localhost:9000?ns=demo-shytalk-default-rtdb',
    });
    expect(mockCert).not.toHaveBeenCalled();
  });
});

describe('fcm.js local mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('sendFcmToTokens returns early in local mode', async () => {
    process.env.NODE_ENV = 'local';
    setupFirebaseAdminMock(0);

    const { sendFcmToTokens } = require('../../src/utils/fcm');
    const result = await sendFcmToTokens(['token1'], { title: 'Test' });
    expect(result).toEqual([]);
    expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled();
  });

  test('cleanupInvalidTokens returns early in local mode', async () => {
    process.env.NODE_ENV = 'local';
    setupFirebaseAdminMock(0);

    const { cleanupInvalidTokens } = require('../../src/utils/fcm');
    // Should not throw or call Firestore
    await expect(cleanupInvalidTokens(['token1'], '100000001')).resolves.toBeUndefined();
  });
});
