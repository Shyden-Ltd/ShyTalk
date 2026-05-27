#!/usr/bin/env node
/* eslint-disable no-console -- operator-facing CLI; console output is the interface. */
/**
 * Seed the journey-test persona cast (P-02..P-19) into the LOCAL Firebase
 * emulator so the in-app persona picker works on local-flavor device builds.
 *
 * Why this exists separately from provision-test-personas.js: that script is
 * the dev/prod provisioner and enforces a >=20-char PERSONAS_PASSWORD (strong,
 * for real accounts). The local-flavor app bakes DEV_QA_PERSONAS_PASSWORD =
 * "localdev123" (app/build.gradle.kts), so the emulator accounts must use that
 * exact password for the picker to sign in. This wrapper reuses the
 * provisioner's exported registry + upsert/social-graph logic verbatim (no
 * duplication) and just supplies the local password against the emulator.
 *
 * Run (Firebase emulator must be up — see local/start.sh):
 *   cd express-api && node --env-file=.env.local scripts/seed-personas-local.js
 *
 * --env-file=.env.local makes src/utils/firebase point firebase-admin at the
 * emulator (project demo-shytalk). Idempotent — safe to re-run.
 */

const {
  personas,
  upsertPersona,
  applySocialGraph,
  buildSocialGraphWrites,
  assertSafeProject,
} = require('./provision-test-personas');
const admin = require('firebase-admin');
const { db } = require('../src/utils/firebase');
const { FieldValue } = require('firebase-admin/firestore');

const pw = process.env.PERSONAS_PASSWORD || 'localdev123';

(async () => {
  // Refuse to run unless the Firebase project is a local/dev/emulator one —
  // the same guard provision-test-personas.js enforces on its own runner.
  // Without it, a stray prod credential in the environment (no --env-file)
  // could overwrite real accounts with the local QA password.
  assertSafeProject(
    admin.app().options.projectId || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID,
  );
  const ctx = { auth: admin.auth(), db, pw, FieldValue };
  for (const p of personas) {
    const r = await upsertPersona(p, ctx);
    console.log(`OK ${p.id} ${p.email} uniqueId=${r.uniqueId}`);
  }
  await applySocialGraph(buildSocialGraphWrites(personas), ctx);
  const pwDisplay = pw === 'localdev123' ? pw : '***redacted***';
  console.log(`LOCAL_PERSONAS_SEEDED count=${personas.length} password=${pwDisplay}`);
  process.exit(0);
})().catch((e) => {
  console.error('LOCAL_PERSONAS_FAIL', e?.message || e);
  process.exit(1);
});
