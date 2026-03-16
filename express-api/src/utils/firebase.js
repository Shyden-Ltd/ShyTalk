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

if (!admin.apps.length) {
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

const db = admin.firestore();
const auth = admin.auth();
const rtdb = admin.database();
const messaging = admin.messaging();
const { FieldValue } = admin.firestore;

module.exports = { admin, db, auth, rtdb, messaging, FieldValue };
