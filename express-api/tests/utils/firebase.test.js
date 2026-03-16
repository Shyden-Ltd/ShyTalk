/**
 * Tests for src/utils/firebase.js — Firebase Admin SDK initialization.
 *
 * This module initializes Firebase Admin at require-time, so each test
 * uses jest.resetModules() to get a fresh import with controlled env vars.
 */

// ─── Shared mock factories ────────────────────────────────────────

const mockFirestore = { collection: jest.fn() };
const mockAuth = { verifyIdToken: jest.fn() };
const mockDatabase = { ref: jest.fn() };
const mockMessaging = { send: jest.fn() };
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

// ─── Tests ────────────────────────────────────────────────────────

describe('firebase.js', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Clone env so we can safely modify it
    process.env = { ...originalEnv };
    // Set required env var
    process.env.FIREBASE_DATABASE_URL = 'https://test-db.firebaseio.com';
    // Remove optional env vars
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('calls initializeApp when no existing apps', () => {
    setupFirebaseAdminMock(0);

    require('../../src/utils/firebase');

    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockInitializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseURL: 'https://test-db.firebaseio.com',
      }),
    );
  });

  test('does not call initializeApp when app already exists', () => {
    setupFirebaseAdminMock(1); // Simulate existing app

    require('../../src/utils/firebase');

    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  test('uses FIREBASE_SERVICE_ACCOUNT_PATH for credential when set', () => {
    // Point to a mock module that jest can resolve
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '../../tests/__fixtures__/fake-sa.json';

    setupFirebaseAdminMock(0);

    // Mock the service account file require
    jest.doMock(
      '../../tests/__fixtures__/fake-sa.json',
      () => ({
        project_id: 'test-project',
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: 'fake-key',
      }),
      { virtual: true },
    );

    require('../../src/utils/firebase');

    expect(mockCert).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'test-project' }));
    expect(mockInitializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'mock-credential',
        databaseURL: 'https://test-db.firebaseio.com',
      }),
    );
  });

  test('uses GOOGLE_APPLICATION_CREDENTIALS as fallback', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '../../tests/__fixtures__/fallback-sa.json';

    setupFirebaseAdminMock(0);

    jest.doMock(
      '../../tests/__fixtures__/fallback-sa.json',
      () => ({
        project_id: 'fallback-project',
      }),
      { virtual: true },
    );

    require('../../src/utils/firebase');

    expect(mockCert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'fallback-project' }),
    );
  });

  test('does not use credential.cert when no service account path set', () => {
    setupFirebaseAdminMock(0);

    require('../../src/utils/firebase');

    expect(mockCert).not.toHaveBeenCalled();
    expect(mockInitializeApp).toHaveBeenCalledWith({
      databaseURL: 'https://test-db.firebaseio.com',
    });
  });

  test('exits with code 1 when FIREBASE_DATABASE_URL is missing', () => {
    delete process.env.FIREBASE_DATABASE_URL;

    setupFirebaseAdminMock(0);

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => require('../../src/utils/firebase')).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('FIREBASE_DATABASE_URL'));

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  test('exports db, auth, rtdb, messaging, FieldValue, and admin', () => {
    setupFirebaseAdminMock(0);

    const firebase = require('../../src/utils/firebase');

    expect(firebase.db).toBe(mockFirestore);
    expect(firebase.auth).toBe(mockAuth);
    expect(firebase.rtdb).toBe(mockDatabase);
    expect(firebase.messaging).toBe(mockMessaging);
    expect(firebase.FieldValue).toBe(mockFieldValue);
    expect(firebase.admin).toBeDefined();
  });

  test('FIREBASE_SERVICE_ACCOUNT_PATH takes priority over GOOGLE_APPLICATION_CREDENTIALS', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '../../tests/__fixtures__/primary-sa.json';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '../../tests/__fixtures__/secondary-sa.json';

    setupFirebaseAdminMock(0);

    jest.doMock(
      '../../tests/__fixtures__/primary-sa.json',
      () => ({
        project_id: 'primary-project',
      }),
      { virtual: true },
    );

    jest.doMock(
      '../../tests/__fixtures__/secondary-sa.json',
      () => ({
        project_id: 'secondary-project',
      }),
      { virtual: true },
    );

    require('../../src/utils/firebase');

    expect(mockCert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'primary-project' }),
    );
  });
});
