#!/usr/bin/env node
/**
 * Provision the journey-test persona cast onto Firebase Auth + Firestore.
 *
 * Source of truth: .project/test-plans/manual/_personas.md.
 *
 * Creates or updates the stable persona accounts (P-02..P-19). Ephemeral
 * personas (P-01 Adam, P-03 Mia) are NOT provisioned — they are created
 * fresh inside journey scenarios that exercise the signup flow.
 *
 * What this writes for each persona:
 *   - Firebase Auth user (email/password); reuses + resets password if it exists
 *   - users/{uniqueId} doc with userType, cohort, wallet, locale, etc.
 *   - identityMap/email:{email}
 *   - Custom claims (uniqueId, cohort, isAdmin where applicable)
 *   - Follow relationships per the persona spec (Marcus follows other minors, etc.)
 *
 * Idempotent. Safe to re-run. Cleanup is via Firebase Console + Firestore Console.
 *
 * Usage (on the dev Express host):
 *   cd /home/ubuntu/express-api
 *   PERSONAS_PASSWORD='<strong-shared-password>' \
 *   node -r dotenv/config scripts/provision-test-personas.js
 *
 * The same password is used for every provisioned persona. Capture it in
 * ~/.shytalk/dev-personas-credentials (chmod 600) on the operator machine.
 */

const admin = require('firebase-admin');
const { db } = require('../src/utils/firebase');

const pw = process.env.PERSONAS_PASSWORD;
if (!pw || pw.length < 12) {
  console.error('MISSING_ENV — set PERSONAS_PASSWORD (>=12 chars) before running.');
  process.exit(2);
}

// DOB helper — ISO date string → ms.
const dobMs = (iso) => new Date(iso + 'T00:00:00Z').getTime();

/**
 * Persona registry. Each entry is one stable account.
 *
 * Schema:
 *   uniqueId: number — stable id, persisted in claims + Firestore
 *   email:    string — Firebase Auth identifier
 *   displayName: string — shown in UI
 *   userType: one of MEMBER | SHYTALK_OFFICIAL | MC_SINGER | MC_EVENT_HOST | TEACHER
 *   cohort:   'adult' | 'minor'
 *   dob:      ISO date used to compute cohort runtime-side; must match cohort
 *   locale:   2-letter locale preference, stored as `localePreference`
 *   wallet:   { shyCoins, beans, gcs }
 *   isAgeVerified: boolean
 *   isAdmin:  optional — sets custom claim `isAdmin: true`
 *   follows:  array of uniqueIds the persona follows (cross-side mirror is written)
 *   extra:    additional Firestore fields (loginStreak, lastLoginRewardDate, etc.)
 */
const personas = [
  {
    id: 'P-02',
    uniqueId: 50000010,
    email: 'adult-power@shytalk.dev',
    displayName: 'Alice (P-02 adult power)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1998-06-15',
    locale: 'en',
    wallet: { shyCoins: 5000, beans: 2000, gcs: 100 },
    isAgeVerified: true,
    follows: [50000060, 50000080],
  },
  {
    id: 'P-04',
    uniqueId: 60000010,
    email: 'minor-power@shytalk.dev',
    displayName: 'Marcus (P-04 minor power)',
    userType: 'MEMBER',
    cohort: 'minor',
    dob: '2009-04-10',
    locale: 'en',
    wallet: { shyCoins: 300, beans: 100, gcs: 0 },
    isAgeVerified: false,
    follows: [],
  },
  {
    id: 'P-05',
    uniqueId: 50000020,
    email: 'lapsed-adult@shytalk.dev',
    displayName: 'Lena (P-05 lapsed)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1995-03-22',
    locale: 'de',
    wallet: { shyCoins: 800, beans: 50, gcs: 0 },
    isAgeVerified: true,
    follows: [50000010],
    extra: {
      loginStreak: 0,
      lastLoginRewardDate: '2026-04-01',
      acceptedPrivacyVersion: 2,
      acceptedTermsVersion: 2,
      fcmTokens: [],
    },
  },
  {
    id: 'P-06',
    uniqueId: 50000030,
    email: 'dob-mismatch@shytalk.dev',
    displayName: 'Hayato (P-06 DOB mismatch)',
    userType: 'MEMBER',
    cohort: 'adult', // starts adult — j04 flips them to minor mid-journey via admin review
    dob: '2007-01-01',
    locale: 'ja',
    wallet: { shyCoins: 100, beans: 0, gcs: 0 },
    isAgeVerified: false,
    follows: [50000010, 50000060],
  },
  {
    id: 'P-07',
    uniqueId: 50000040,
    email: 'adult-prober@shytalk.dev',
    displayName: 'Vexa (P-07 cross-cohort prober)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1996-09-09',
    locale: 'en',
    wallet: { shyCoins: 200, beans: 0, gcs: 0 },
    isAgeVerified: true,
    follows: [],
  },
  {
    id: 'P-08',
    uniqueId: 50000050,
    email: 'harasser@shytalk.dev',
    displayName: 'Raul (P-08 harasser)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1992-11-30',
    locale: 'en',
    wallet: { shyCoins: 0, beans: 0, gcs: 0 },
    isAgeVerified: true,
    follows: [50000051],
  },
  {
    id: 'P-09',
    uniqueId: 50000051,
    email: 'victim@shytalk.dev',
    displayName: 'Nora (P-09 victim)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1997-02-14',
    locale: 'en',
    wallet: { shyCoins: 0, beans: 0, gcs: 0 },
    isAgeVerified: true,
    follows: [],
  },
  {
    id: 'P-10',
    uniqueId: 50000060,
    email: 'host@shytalk.dev',
    displayName: 'Theo (P-10 voice host)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1993-07-21',
    locale: 'en',
    wallet: { shyCoins: 1500, beans: 4000, gcs: 25 },
    isAgeVerified: true,
    follows: [50000010, 50000080, 50000081],
  },
  {
    id: 'P-11',
    uniqueId: 50000061,
    email: 'joiner-flaky@shytalk.dev',
    displayName: 'Ines (P-11 flaky-net joiner)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1999-10-05',
    locale: 'en',
    wallet: { shyCoins: 200, beans: 100, gcs: 0 },
    isAgeVerified: true,
    follows: [50000060],
  },
  {
    id: 'P-12',
    uniqueId: 90000001,
    email: 'admin@shytalk.dev',
    displayName: 'Greta (P-12 admin)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1990-01-01',
    locale: 'en',
    wallet: { shyCoins: 0, beans: 0, gcs: 0 },
    isAgeVerified: true,
    isAdmin: true,
    follows: [],
  },
  {
    id: 'P-13',
    uniqueId: 50000070,
    email: 'rtl-user@shytalk.dev',
    displayName: 'Layla (P-13 ar)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1994-12-12',
    locale: 'ar',
    wallet: { shyCoins: 500, beans: 200, gcs: 0 },
    isAgeVerified: true,
    follows: [50000010],
  },
  {
    id: 'P-14',
    uniqueId: 50000071,
    email: 'cjk-user@shytalk.dev',
    displayName: 'Kenji (P-14 ja)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '1991-05-05',
    locale: 'ja',
    wallet: { shyCoins: 500, beans: 200, gcs: 0 },
    isAgeVerified: true,
    follows: [50000010],
  },
  {
    id: 'P-15',
    uniqueId: 50000080,
    email: 'mc-singer@shytalk.dev',
    displayName: 'Selma (P-15 MC Singer)',
    userType: 'MC_SINGER',
    cohort: 'adult',
    dob: '1996-08-08',
    locale: 'en',
    wallet: { shyCoins: 200, beans: 10000, gcs: 50 },
    isAgeVerified: true,
    follows: [50000081],
    extra: { followerCount: 200 },
  },
  {
    id: 'P-16',
    uniqueId: 50000081,
    email: 'mc-event-host@shytalk.dev',
    displayName: 'Tariq (P-16 Event Host)',
    userType: 'MC_EVENT_HOST',
    cohort: 'adult',
    dob: '1985-03-15',
    locale: 'en',
    wallet: { shyCoins: 10000, beans: 50000, gcs: 200 },
    isAgeVerified: true,
    follows: [50000080],
    extra: { followerCount: 800, teamRoster: [50000080] },
  },
  {
    id: 'P-17',
    uniqueId: 50000090,
    email: 'teacher@shytalk.dev',
    displayName: 'Bao (P-17 Teacher)',
    userType: 'TEACHER',
    cohort: 'adult',
    dob: '1980-09-09',
    locale: 'zh',
    wallet: { shyCoins: 500, beans: 3000, gcs: 10 },
    isAgeVerified: true,
    follows: [],
    extra: { followerCount: 120, teachingLanguages: ['zh', 'en'] },
  },
  {
    id: 'P-18',
    uniqueId: 50000091,
    email: 'student@shytalk.dev',
    displayName: 'Yuki (P-18 Student)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '2000-02-29',
    locale: 'ja',
    wallet: { shyCoins: 300, beans: 50, gcs: 0 },
    isAgeVerified: true,
    follows: [50000090],
  },
  {
    id: 'P-19',
    uniqueId: 1,
    email: 'officia@shytalk.dev',
    displayName: 'ShyTalk Official',
    userType: 'SHYTALK_OFFICIAL',
    cohort: 'adult',
    dob: '2020-01-01', // not displayed; the bot is exempt from cohort matching anyway
    locale: 'en',
    wallet: { shyCoins: 0, beans: 0, gcs: 0 },
    isAgeVerified: true,
    follows: [],
    extra: { isOfficial: true, isUnblockable: true },
  },
];

/** Ensure follow relationships are bidirectional and only persisted once. */
function buildSocialGraphWrites() {
  const followingByUid = new Map(); // uid → Set(targets)
  const followersByUid = new Map(); // uid → Set(sources)
  for (const p of personas) {
    if (!p.follows || p.follows.length === 0) continue;
    const me = String(p.uniqueId);
    if (!followingByUid.has(me)) followingByUid.set(me, new Set());
    for (const t of p.follows) {
      const target = String(t);
      followingByUid.get(me).add(target);
      if (!followersByUid.has(target)) followersByUid.set(target, new Set());
      followersByUid.get(target).add(me);
    }
  }
  return { followingByUid, followersByUid };
}

async function upsertPersona(p) {
  // 1. Auth user
  let fbUid;
  try {
    const u = await admin.auth().getUserByEmail(p.email);
    fbUid = u.uid;
    await admin.auth().updateUser(fbUid, {
      password: pw,
      emailVerified: true,
      displayName: p.displayName,
    });
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    const u = await admin.auth().createUser({
      email: p.email,
      password: pw,
      emailVerified: true,
      displayName: p.displayName,
    });
    fbUid = u.uid;
  }

  // 2. users/{uniqueId} doc — full shape used by sign-in + screens
  const userDoc = {
    uid: String(p.uniqueId),
    firebaseUid: fbUid,
    uniqueId: p.uniqueId,
    displayName: p.displayName,
    email: p.email,
    dateOfBirth: dobMs(p.dob),
    cohort: p.cohort,
    userType: p.userType,
    localePreference: p.locale,
    shyCoins: p.wallet.shyCoins,
    beans: p.wallet.beans,
    gcs: p.wallet.gcs,
    isAgeVerified: !!p.isAgeVerified,
    isQa: true,
    createdAt: Date.now(),
    ...(p.extra || {}),
  };
  await db.doc('users/' + String(p.uniqueId)).set(userDoc, { merge: true });

  // 3. identityMap
  await db.doc('identityMap/email:' + p.email).set(
    {
      provider: 'email',
      identifier: p.email,
      uniqueId: p.uniqueId,
      firebaseUid: fbUid,
      createdAt: Date.now(),
      isQa: true,
    },
    { merge: true },
  );

  // 4. Custom claims
  const claims = { uniqueId: p.uniqueId, cohort: p.cohort };
  if (p.isAdmin) claims.isAdmin = true;
  await admin.auth().setCustomUserClaims(fbUid, claims);

  return { fbUid, uniqueId: p.uniqueId };
}

async function applySocialGraph(graph) {
  const { followingByUid, followersByUid } = graph;
  const writes = [];
  for (const [me, targets] of followingByUid.entries()) {
    writes.push(
      db.doc('users/' + me).set(
        {
          followingIds: Array.from(targets),
          followingCount: targets.size,
        },
        { merge: true },
      ),
    );
  }
  for (const [target, sources] of followersByUid.entries()) {
    writes.push(
      db.doc('users/' + target).set(
        {
          followerIds: Array.from(sources),
          followerCount: sources.size,
        },
        { merge: true },
      ),
    );
  }
  await Promise.all(writes);
}

(async () => {
  console.log('PROVISIONING ' + personas.length + ' personas...');
  for (const p of personas) {
    try {
      const r = await upsertPersona(p);
      console.log(`OK ${p.id} ${p.email} uniqueId=${r.uniqueId} fb=${r.fbUid}`);
    } catch (e) {
      console.error(`FAIL ${p.id} ${p.email}`, e?.message || e);
      process.exit(1);
    }
  }
  console.log('Applying social graph...');
  await applySocialGraph(buildSocialGraphWrites());
  console.log('PROVISION_ALL_OK count=' + personas.length);
})().catch((e) => {
  console.error('PROVISION_FAIL', e?.message || e);
  process.exit(1);
});
