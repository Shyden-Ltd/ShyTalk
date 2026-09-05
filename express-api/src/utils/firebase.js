/**
 * Firebase Admin SDK initialization.
 *
 * Provides shared instances of Firestore, Auth, RTDB, and Messaging.
 * Expects GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON,
 * or FIREBASE_SERVICE_ACCOUNT_PATH for explicit path.
 */

const admin = require('firebase-admin');
// firebase-admin 14 REMOVED the ENTIRE namespaced root surface, not just one or
// two names: `admin.apps`, `admin.credential`, `admin.auth`, `admin.firestore`,
// `admin.database`, `admin.messaging`, `admin.appCheck` and `admin.app` are all
// `undefined` on 14.x. Only the app lifecycle survives on the root export, so
// everything else must come from a modular entry point. Reading any of them
// throws "Cannot read properties of undefined" — at module load, which is a
// crash loop rather than a failed request (SHY-0371).
const { getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

function configureLocalEmulators() {
  if (process.env.NODE_ENV === 'local') {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9000';
    // There are no credentials against the emulators, so google-auth-library
    // would probe the GCE metadata server and gcp-metadata would print
    // MetadataLookupWarning on every boot. 'none' turns the probe off; a value
    // the operator already chose wins.
    process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
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

if (!getApps().length) {
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
      initOptions.credential = cert(serviceAccount);
    }

    admin.initializeApp(initOptions);
  }
}

const db = getFirestore();
const auth = getAuth();
const rtdb = getDatabase();
const messaging = getMessaging();
// FieldValue now comes from the modular entry point above — firebase-admin 14
// removed the `admin.firestore` namespace it used to hang off.
//
// The raw `admin` root object is deliberately NOT re-exported. On 14 it carries
// only the app lifecycle, so every namespace a caller would reach for through it
// is `undefined` — that re-export is exactly how `admin.appCheck()` survived in
// middleware/app-check.js (SHY-0371). Callers take the typed handles below, or a
// modular entry point of their own.
module.exports = { db, auth, rtdb, messaging, FieldValue, configureLocalEmulators };
