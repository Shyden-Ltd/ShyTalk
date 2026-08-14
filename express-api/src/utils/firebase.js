/**
 * Firebase Admin SDK initialization.
 *
 * Provides shared instances of Firestore, Auth, RTDB, and Messaging.
 * Expects GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON,
 * or FIREBASE_SERVICE_ACCOUNT_PATH for explicit path.
 */

const admin = require('firebase-admin');

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

function configureLocalEmulators() {
  if (process.env.NODE_ENV === 'local') {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9000';
  }
}

// Configure emulators before any Firebase calls
configureLocalEmulators();

/**
 * Firestore + Auth emulator data is partitioned by projectId. A test file that
 * must WIPE a shared collection (the cron suites clear `users` wholesale, and
 * one of them asserts on an empty collection) can opt into its own project by
 * setting `FIRESTORE_TEST_NAMESPACE` before requiring this module — otherwise
 * its `beforeEach` deletes documents another Jest worker just seeded.
 *
 * Only for suites that do NOT mint Auth tokens: the Auth emulator resolves
 * tokens against the project it was STARTED with, so a namespaced project makes
 * every minted ID token 401 (proven under SHY-0149). Firestore-only suites are
 * unaffected. (SHY-0171)
 */
const LOCAL_PROJECT_ID =
  process.env.NODE_ENV === 'local' && process.env.FIRESTORE_TEST_NAMESPACE
    ? `demo-shytalk-${process.env.FIRESTORE_TEST_NAMESPACE}`
    : 'demo-shytalk';

if (!admin.apps.length) {
  if (process.env.NODE_ENV === 'local') {
    // Emulators need a databaseURL for RTDB even though traffic goes to emulator
    admin.initializeApp({
      projectId: LOCAL_PROJECT_ID,
      databaseURL: 'http://localhost:9000?ns=demo-shytalk-default-rtdb',
    });
  } else {
    if (!process.env.FIREBASE_DATABASE_URL) {
      // eslint-disable-next-line no-console
      console.error(
        'FIREBASE_DATABASE_URL env var is required (RTDB region differs between dev and prod)',
      );
      process.exit(1);
    }
    const initOptions = {
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    };

    if (serviceAccountPath) {
      const serviceAccount = require(serviceAccountPath);
      initOptions.credential = admin.credential.cert(serviceAccount);
    }

    admin.initializeApp(initOptions);
  }
}

const db = admin.firestore();
const auth = admin.auth();
const rtdb = admin.database();
const messaging = admin.messaging();
const { FieldValue } = admin.firestore;

module.exports = { admin, db, auth, rtdb, messaging, FieldValue, configureLocalEmulators };
