#!/usr/bin/env node
/**
 * Provision a dedicated Dev QA Firebase Auth user + Firestore identity
 * + custom claims, so an operator (or autonomous QA loop) can sign into
 * the dev-flavor app via the new "Dev Sign-In" shortcut without going
 * through Google/Apple OAuth.
 *
 * Pairs with the SignInScreen `BuildVariant.isDevSignInAvailable` gate
 * (#677) and the anti-emulator toggle (#676): together they let manual
 * QA + automation sign in on the Android emulator against real dev
 * Firebase.
 *
 * What this script writes:
 *   - Firebase Auth user (email/password); reuses existing if present
 *     and resets its password to the supplied one.
 *   - users/{uniqueId} doc with cohort='adult', DOB=2000-01-01, displayName='Claude QA',
 *     `isQa: true` (so adminCleanup / migration scripts can skip if needed)
 *   - identityMap/email:{email} → { provider, identifier, uniqueId, firebaseUid }
 *   - Custom claims: { uniqueId, cohort: 'adult' }
 *
 * Idempotent: re-running with the same env updates the password +
 * confirms the existing rows. Safe to run multiple times.
 *
 * Usage (run on the dev Express host as ubuntu):
 *   cd /home/ubuntu/express-api
 *   DEV_QA_EMAIL='claude-qa@shytalk.dev' \
 *   DEV_QA_PWD='<random-strong-password>' \
 *   node -r dotenv/config scripts/provision-dev-qa-account.js
 *
 * To rotate the password later, re-run with a new DEV_QA_PWD. The
 * Firestore + claims rows stay the same; only the Auth credential
 * changes.
 *
 * To DELETE the account: use Firebase Console → Authentication. Then
 * delete the users/{uniqueId} + identityMap/email:* docs via Firestore
 * Console. (A separate teardown script would be cleaner — out of scope
 * here; this is a one-off provision.)
 *
 * Cohort note: hardcoded to 'adult' because dev QA needs to exercise
 * adult-tier features (PMs, voice rooms with adult cohort tag, gifting,
 * etc.). If you need a minor-cohort QA user too, copy this script and
 * change `cohort` + `dateOfBirth` accordingly.
 */

const admin = require('firebase-admin');
const { db } = require('../src/utils/firebase');

const email = process.env.DEV_QA_EMAIL;
const pw = process.env.DEV_QA_PWD;

if (!email || !pw) {
  console.error(
    'MISSING_ENV — set DEV_QA_EMAIL and DEV_QA_PWD before running.\n' +
      'Example:\n' +
      "  DEV_QA_EMAIL='claude-qa@shytalk.dev' \\\n" +
      "  DEV_QA_PWD='<openssl rand -base64 24>' \\\n" +
      '  node -r dotenv/config scripts/provision-dev-qa-account.js',
  );
  process.exit(2);
}

(async () => {
  // 1. Firebase Auth user — create or update.
  let uid;
  try {
    const u = await admin.auth().getUserByEmail(email);
    uid = u.uid;
    await admin.auth().updateUser(uid, { password: pw, emailVerified: true });
    console.log('UPDATED_EXISTING fb=' + uid);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      const u = await admin.auth().createUser({
        email,
        password: pw,
        emailVerified: true,
        displayName: 'Claude QA',
      });
      uid = u.uid;
      console.log('CREATED fb=' + uid);
    } else {
      throw e;
    }
  }

  // 2. Allocate (or reuse) a uniqueId. QA accounts use the 50000001+
  //    range to keep them visually separable from production-style
  //    uniqueIds and from the dev smoke account (10000007/10000008).
  const idMapDoc = await db.doc('identityMap/email:' + email).get();
  let uniqueId;
  if (idMapDoc.exists) {
    uniqueId = idMapDoc.data().uniqueId;
    console.log('EXISTING_UNIQUE=' + uniqueId);
  } else {
    uniqueId = 50000001;
    while ((await db.doc('users/' + String(uniqueId)).get()).exists) {
      uniqueId++;
    }
    console.log('ALLOCATED_UNIQUE=' + uniqueId);
  }

  // 3. users/{uniqueId} doc.
  await db.doc('users/' + String(uniqueId)).set(
    {
      uid: String(uniqueId),
      firebaseUid: uid,
      uniqueId,
      displayName: 'Claude QA',
      email,
      // 2000-01-01 → adult cohort under any plausible age-derivation rule.
      dateOfBirth: 946684800000,
      cohort: 'adult',
      createdAt: Date.now(),
      isQa: true,
    },
    { merge: true },
  );

  // 4. identityMap row so /api/users/sign-in resolves the Firebase uid → uniqueId.
  await db.doc('identityMap/email:' + email).set(
    {
      provider: 'email',
      identifier: email,
      uniqueId,
      firebaseUid: uid,
      createdAt: Date.now(),
      isQa: true,
    },
    { merge: true },
  );

  // 5. Custom claims — uniqueId + cohort. Mirrors what
  //    `mintClaims(uid, { uniqueId, cohort })` would set during a real
  //    sign-in via Express.
  await admin.auth().setCustomUserClaims(uid, { uniqueId, cohort: 'adult' });

  console.log('PROVISION_OK email=' + email + ' uniqueId=' + uniqueId + ' fbUid=' + uid);
})().catch((e) => {
  console.error('PROVISION_FAIL', e?.message || e);
  process.exit(1);
});
