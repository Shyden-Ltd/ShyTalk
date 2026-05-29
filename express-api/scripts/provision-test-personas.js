#!/usr/bin/env node
/* eslint-disable no-console -- operator-facing CLI; console output is
   the interface, not a side-effect. */
/**
 * Provision the journey-test persona cast onto Firebase Auth + Firestore.
 *
 * Source of truth: journey-tests/_personas.md.
 *
 * Creates or updates the stable persona accounts (P-02..P-19). Ephemeral
 * personas (P-01 Adam, P-03 Mia) are NOT provisioned — they are created
 * fresh inside journey scenarios that exercise the signup flow.
 *
 * What this writes for each persona:
 *   - Firebase Auth user (email/password); reuses + resets password if it exists
 *   - users/{uniqueId} doc with userType, cohort, wallet, locale, ageVerified
 *   - identityMap/email:{email}
 *   - Custom claims (uniqueId, cohort, isAdmin where applicable)
 *   - Follow relationships per the persona spec — STORED AS NUMBERS to
 *     match the live wire format (`FieldValue.arrayUnion(targetId)` where
 *     targetId is `Number(...)` in users.js).
 *
 * Idempotent. Safe to re-run. createdAt is preserved on re-runs to keep
 * any journey assertion tied to account age stable.
 *
 * Usage (on the dev Express host):
 *   export PERSONAS_PASSWORD=$(openssl rand -base64 24)
 *   cd /home/ubuntu/express-api
 *   node -r dotenv/config scripts/provision-test-personas.js
 *
 * Password strength: the env-var check enforces >=20 chars to discourage
 * weak shared passwords. Generate with `openssl rand -base64 24` and
 * capture in `~/.shytalk/dev-personas-credentials` (chmod 600).
 *
 * Production safeguard: the script refuses to run unless the resolved
 * Firebase project id contains "dev" or "local". Set FIREBASE_PROJECT_ID
 * or rely on the SDK default; a project id like "shytalk-7ba69" (prod)
 * triggers an immediate exit before any write.
 *
 * Module exports: every pure helper is exported so the Jest test suite
 * (`__tests__/scripts/provision-test-personas.test.js`) can pin the
 * persona registry shape + helper logic without hitting Firebase.
 */

// DOB helper — ISO date string → ms (UTC midnight, matches age-verification system).
const dobMs = (iso) => new Date(iso + 'T00:00:00Z').getTime();

/**
 * Persona registry. Source of truth: _personas.md.
 *
 * Schema:
 *   uniqueId: number — stable id, persisted in claims + Firestore
 *   email:    string — Firebase Auth identifier
 *   displayName: string
 *   userType: one of MEMBER | SHYTALK_OFFICIAL | MC_SINGER | MC_EVENT_HOST | TEACHER
 *   cohort:   'adult' | 'minor' — must match `dob` (the SHYTALK_OFFICIAL bot is exempt)
 *   dob:      ISO date used to compute cohort runtime-side
 *   locale:   2-letter locale, stored as `localePreference`
 *   wallet:   { shyCoins, beans, gcs }
 *   ageVerified: boolean (Firestore field name — matches User.kt:90, age-verification.js, admin-age-verification.js)
 *   isAdmin:  optional — sets custom claim `isAdmin: true` (P-12 Greta only)
 *   follows:  number[] of uniqueIds; mirror is written automatically
 *   extra:    additional Firestore fields merged into the user doc
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
    ageVerified: true,
    // Officia (uniqueId=1) included so j19 can verify the migration
    // preserves cross-cohort follow edges to/from SHYTALK_OFFICIAL.
    follows: [50000060, 50000080, 1],
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
    ageVerified: false,
    // Officia (uniqueId=1) included so j19 can verify Officia retains
    // followers from BOTH cohorts post-migration (adult Alice + this
    // minor Marcus). System accounts are exempt from the cross-cohort
    // follow-edge cleanup.
    follows: [1],
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
    ageVerified: true,
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
    // Hayato: starts adult, j04 admin-flips to minor mid-journey.
    // IMPORTANT: the j04 scenario MUST also call the claims-update endpoint
    // (force-refresh JWT) after the Firestore cohort flip — otherwise the
    // token stays adult-scoped because this script only sets the initial
    // claims and is not re-run mid-journey.
    uniqueId: 50000030,
    email: 'dob-mismatch@shytalk.dev',
    displayName: 'Hayato (P-06 DOB mismatch)',
    userType: 'MEMBER',
    cohort: 'adult',
    dob: '2007-01-01',
    locale: 'ja',
    wallet: { shyCoins: 100, beans: 0, gcs: 0 },
    ageVerified: false,
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
    ageVerified: true,
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
    ageVerified: true,
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
    ageVerified: true,
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
    ageVerified: true,
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
    ageVerified: true,
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
    ageVerified: true,
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
    ageVerified: true,
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
    ageVerified: true,
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
    ageVerified: true,
    follows: [50000081],
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
    ageVerified: true,
    follows: [50000080],
    extra: { teamRoster: [50000080] },
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
    ageVerified: true,
    follows: [],
    extra: { teachingLanguages: ['zh', 'en'] },
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
    ageVerified: true,
    follows: [50000090],
  },
  {
    id: 'P-19',
    uniqueId: 1,
    email: 'officia@shytalk.dev',
    displayName: 'ShyTalk Official',
    userType: 'SHYTALK_OFFICIAL',
    // SHYTALK_OFFICIAL is exempt from cohort matching; the DOB is artificial.
    cohort: 'adult',
    dob: '2020-01-01',
    locale: 'en',
    wallet: { shyCoins: 0, beans: 0, gcs: 0 },
    ageVerified: true,
    follows: [],
    extra: { isOfficial: true, isUnblockable: true },
  },
];

/**
 * Derive cohort from DOB on a given reference date. Used by the test
 * suite to assert persona.cohort matches persona.dob.
 */
function derivedCohort(dobIso, refIso = '2026-05-16') {
  const dobYear = parseInt(dobIso.slice(0, 4), 10);
  const dobMd = dobIso.slice(5);
  const refYear = parseInt(refIso.slice(0, 4), 10);
  const refMd = refIso.slice(5);
  let age = refYear - dobYear;
  if (refMd < dobMd) age -= 1;
  return age >= 18 ? 'adult' : 'minor';
}

/**
 * Build follower/following maps from the persona registry. Element type
 * is `number` to match `FieldValue.arrayUnion(targetId)` in users.js:1009
 * (where targetId is `Number(...)`). Casting to String would diverge from
 * the live wire format and cause follow-edge bugs.
 */
function buildSocialGraphWrites(personasList) {
  const followingByUid = new Map(); // uid:number → Set<number>
  const followersByUid = new Map();
  for (const p of personasList) {
    if (!p.follows || p.follows.length === 0) continue;
    const me = p.uniqueId;
    if (typeof me !== 'number') {
      throw new Error('persona uniqueId must be a number: ' + p.id);
    }
    if (!followingByUid.has(me)) followingByUid.set(me, new Set());
    for (const t of p.follows) {
      if (typeof t !== 'number') {
        throw new Error('persona follow targets must be numbers: ' + p.id);
      }
      if (t === me) {
        throw new Error('persona cannot follow self: ' + p.id);
      }
      followingByUid.get(me).add(t);
      if (!followersByUid.has(t)) followersByUid.set(t, new Set());
      followersByUid.get(t).add(me);
    }
  }
  return { followingByUid, followersByUid };
}

/**
 * Build the `users/{uniqueId}` doc shape. Field names match the live
 * schema (User.kt + age-verification.js): `ageVerified` not
 * `isAgeVerified`. The `createdAt` field is set only when the existing
 * doc has no createdAt — preserves account age across re-runs.
 */
function buildUserDoc(p, fbUid, opts = {}) {
  const { existingCreatedAt = null, now = Date.now() } = opts;
  // Apply the `[SEED] ` prefix to the user-visible displayName HERE, at
  // write-time — NOT in the persona registry above. Reason: the runner
  // (manual-qa-runner.js) resolves personas by name-prefix match against
  // the registry ("Alice" → P-02), and a `[SEED]` prefix in the registry
  // would break that lookup across ~70 runner tests. The visible-marker
  // requirement is a Firestore / UI concern; the runner uses the registry
  // for in-process lookup and doesn't need the prefix. Idempotent: if
  // an existing displayName already has the prefix (re-runs / manual seed
  // before this code shipped), don't double-prefix.
  const prefixedName = p.displayName.startsWith('[SEED] ')
    ? p.displayName
    : `[SEED] ${p.displayName}`;
  const doc = {
    uid: String(p.uniqueId),
    firebaseUid: fbUid,
    uniqueId: p.uniqueId,
    displayName: prefixedName,
    email: p.email,
    dateOfBirth: dobMs(p.dob),
    cohort: p.cohort,
    userType: p.userType,
    localePreference: p.locale,
    shyCoins: p.wallet.shyCoins,
    beans: p.wallet.beans,
    gcs: p.wallet.gcs,
    ageVerified: !!p.ageVerified,
    isQa: true,
    // Seed-identification markers — let UI / admin tooling distinguish
    // automation-seeded personas from real users at a glance.
    //   - `seedSource: 'automation'` is the machine-readable hook (future
    //     UI badges, admin filters, analytics exclusion all key off this).
    //   - The `[SEED]` prefix on `displayName` (set in the persona registry
    //     above) is the immediate user-visible marker so any human seeing
    //     these accounts in the app — moderators, testers, internal
    //     dogfood users — knows at a glance these are not regular users.
    //   - `seedRunAt` captures when the last provision ran for audit
    //     trail — useful when investigating "why does dev have stale
    //     personas?" — compare against the deploy-dev workflow history.
    seedSource: 'automation',
    seedRunAt: now,
    createdAt: existingCreatedAt || now,
    ...(p.extra || {}),
  };
  return doc;
}

/**
 * Custom-claims shape — uniqueId + cohort + optional admin.
 *
 * Claim key is `admin` (not `isAdmin`) to match the live middleware in
 * express-api/src/middleware/auth.js:241 which reads
 * `customClaims?.admin === true`. The persona registry uses
 * `isAdmin: true` as the INPUT flag for readability; the OUTPUT claim
 * key must be `admin` or the admin middleware silently 403s.
 */
function buildClaims(p) {
  const claims = { uniqueId: p.uniqueId, cohort: p.cohort };
  if (p.isAdmin) claims.admin = true;
  return claims;
}

/**
 * Refuse to run unless the project id looks like a dev/local environment.
 * Throws — never returns silently — so the caller can't accidentally
 * proceed against production credentials.
 */
function assertSafeProject(projectId) {
  const p = String(projectId || '').toLowerCase();
  if (!p) {
    throw new Error('SAFETY: project id is empty — refusing to run');
  }
  // Firebase docs convention: `demo-` prefix marks an emulator-only project
  // (cannot accidentally hit prod even if creds leak — Google rejects
  // non-existent project ids). We accept it as a strong signal of safety,
  // alongside the existing dev/local/emulator substring whitelist.
  if (p.startsWith('demo-') || p.includes('dev') || p.includes('local') || p.includes('emulator')) {
    return p;
  }
  throw new Error(
    `SAFETY: refusing to run against project "${projectId}" — only dev/local/emulator/demo-* projects are allowed`,
  );
}

/**
 * IO layer — needs an injected `auth` and `db` so the Jest suite can
 * stub them. The runner at the bottom of the file calls this with real
 * firebase-admin handles.
 */
async function upsertPersona(p, ctx) {
  const { auth, db, pw, FieldValue } = ctx;

  // 1. Auth user — create or update password + name + emailVerified
  let fbUid;
  try {
    const u = await auth.getUserByEmail(p.email);
    fbUid = u.uid;
    await auth.updateUser(fbUid, {
      password: pw,
      emailVerified: true,
      displayName: p.displayName,
    });
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    const u = await auth.createUser({
      email: p.email,
      password: pw,
      emailVerified: true,
      displayName: p.displayName,
    });
    fbUid = u.uid;
  }

  // 2. users/{uniqueId} — read existing first to preserve createdAt + clean stale field name
  const userRef = db.doc('users/' + String(p.uniqueId));
  const existing = await userRef.get();
  const existingCreatedAt = existing.exists ? existing.data().createdAt : null;
  const doc = buildUserDoc(p, fbUid, { existingCreatedAt });

  // Delete the old (incorrect) `isAgeVerified` field if a prior buggy
  // run left it lying around. FieldValue.delete() is a sentinel.
  if (existing.exists && Object.prototype.hasOwnProperty.call(existing.data(), 'isAgeVerified')) {
    doc.isAgeVerified = FieldValue.delete();
  }
  // Delete stale denormalized counters from earlier buggy run
  for (const stale of ['followingCount', 'followerCount']) {
    if (existing.exists && Object.prototype.hasOwnProperty.call(existing.data(), stale)) {
      doc[stale] = FieldValue.delete();
    }
  }

  await userRef.set(doc, { merge: true });

  // 3. identityMap row
  const idMapRef = db.doc('identityMap/email:' + p.email);
  const idMapExisting = await idMapRef.get();
  await idMapRef.set(
    {
      provider: 'email',
      identifier: p.email,
      uniqueId: p.uniqueId,
      firebaseUid: fbUid,
      createdAt: idMapExisting.exists ? idMapExisting.data().createdAt : Date.now(),
      isQa: true,
    },
    { merge: true },
  );

  // 4. Custom claims
  await auth.setCustomUserClaims(fbUid, buildClaims(p));

  return { fbUid, uniqueId: p.uniqueId };
}

async function applySocialGraph(graph, ctx) {
  const { db } = ctx;
  const { followingByUid, followersByUid } = graph;
  const writes = [];
  for (const [me, targets] of followingByUid.entries()) {
    writes.push(
      db.doc('users/' + String(me)).set({ followingIds: Array.from(targets) }, { merge: true }),
    );
  }
  for (const [target, sources] of followersByUid.entries()) {
    writes.push(
      db.doc('users/' + String(target)).set({ followerIds: Array.from(sources) }, { merge: true }),
    );
  }
  await Promise.all(writes);
}

module.exports = {
  personas,
  dobMs,
  derivedCohort,
  buildSocialGraphWrites,
  buildUserDoc,
  buildClaims,
  assertSafeProject,
  upsertPersona,
  applySocialGraph,
};

// ── Runner ───────────────────────────────────────────────────────────
if (require.main === module) {
  const admin = require('firebase-admin');
  const { db } = require('../src/utils/firebase');
  const { FieldValue } = require('firebase-admin/firestore');

  const pw = process.env.PERSONAS_PASSWORD;
  if (!pw || pw.length < 20) {
    console.error(
      'MISSING_ENV — set PERSONAS_PASSWORD (>=20 chars) before running. Generate with: openssl rand -base64 24',
    );
    process.exit(2);
  }

  const projectId =
    admin.app().options.projectId || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  try {
    assertSafeProject(projectId);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  const ctx = { auth: admin.auth(), db, pw, FieldValue };

  (async () => {
    console.log('PROVISIONING ' + personas.length + ' personas against project ' + projectId);
    for (const p of personas) {
      try {
        const r = await upsertPersona(p, ctx);
        console.log(`OK ${p.id} ${p.email} uniqueId=${r.uniqueId} fb=${r.fbUid}`);
      } catch (e) {
        console.error(`FAIL ${p.id} ${p.email}`, e?.message || e);
        process.exit(1);
      }
    }
    console.log('Applying social graph...');
    await applySocialGraph(buildSocialGraphWrites(personas), ctx);
    console.log('PROVISION_ALL_OK count=' + personas.length);
    // firebase-admin keeps the event loop alive via idle HTTP/2 keep-alive
    // connections and metric-export timers. Force-exit so callers that
    // chain the next step (e.g. dev-runner-bootstrap.sh Phase 4) don't
    // wedge waiting for a graceful drain that never comes.
    process.exit(0);
  })().catch((e) => {
    console.error('PROVISION_FAIL', e?.message || e);
    process.exit(1);
  });
}
