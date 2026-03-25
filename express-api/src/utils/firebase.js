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

if (!admin.apps.length) {
  if (process.env.NODE_ENV === 'local') {
    // Emulators need a databaseURL for RTDB even though traffic goes to emulator
    admin.initializeApp({
      projectId: 'demo-shytalk',
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
