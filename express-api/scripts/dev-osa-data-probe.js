#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * dev-osa-data-probe.js — read-only diagnostic for the OSA migration's
 * data invariants on dev Firestore. Answers the question:
 *
 *   "Did the OSA cohort-segregation migration actually run on dev, even
 *   though no `ops/segregation-migration` marker exists?"
 *
 * If every invariant comes back clean, the data IS migrated and the only
 * gap is the missing bookkeeping marker (easy fix).
 *
 * If any invariant is dirty, the migration genuinely never ran on dev
 * and OSA cohort isolation isn't enforced — prod deploy must be blocked
 * until the migration runs.
 *
 * Read-only — no writes. Safe to run repeatedly.
 *
 * Invocation: `node -r dotenv/config scripts/dev-osa-data-probe.js`
 */

require('dotenv').config();
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const SUSPECT_LIMIT = 5; // print up to this many sample rows per finding

function status(label, ok) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
}

async function buildCohortMap() {
  // uniqueId → cohort (resolved from users collection)
  const map = new Map();
  const queryRef = db.collection('users');
  const snap = await queryRef.get();
  snap.forEach((d) => {
    const data = d.data();
    if (data?.uniqueId !== undefined && data?.uniqueId !== null && data.cohort) {
      map.set(String(data.uniqueId), data.cohort);
    }
  });
  return map;
}

async function probeFollowEdges(cohortMap) {
  console.log('\n== Probe 1: cross-cohort follow edges ==');
  const snap = await db.collection('users').get();
  let crossFollowingCount = 0;
  let crossFollowerCount = 0;
  const samples = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const myUid = String(data.uniqueId);
    const myCohort = data.cohort;
    if (!myCohort) return;
    // SHYTALK_OFFICIAL is exempt from cohort gating per j18 contract.
    if (data.userType === 'SHYTALK_OFFICIAL' || data.isOfficial) return;
    for (const targetId of data.followingIds || []) {
      const targetCohort = cohortMap.get(String(targetId));
      if (targetCohort && targetCohort !== myCohort) {
        crossFollowingCount++;
        if (samples.length < SUSPECT_LIMIT) {
          samples.push(
            `  followingIds: user ${myUid}(${myCohort}) -> ${targetId}(${targetCohort})`,
          );
        }
      }
    }
    for (const sourceId of data.followerIds || []) {
      const sourceCohort = cohortMap.get(String(sourceId));
      if (sourceCohort && sourceCohort !== myCohort) {
        crossFollowerCount++;
      }
    }
  });
  status(
    `cross-cohort followingIds entries: ${crossFollowingCount} (expected 0)`,
    crossFollowingCount === 0,
  );
  status(
    `cross-cohort followerIds entries: ${crossFollowerCount} (expected 0)`,
    crossFollowerCount === 0,
  );
  samples.forEach((s) => console.log(s));
  return { followingCount: crossFollowingCount, followerCount: crossFollowerCount };
}

async function probeRooms(cohortMap) {
  console.log('\n== Probe 2: OPEN rooms with mixed-cohort participants ==');
  const snap = await db.collection('rooms').where('state', '==', 'OPEN').get();
  let mixed = 0;
  const samples = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const roomCohort = data.cohort;
    const participantIds = data.participantIds || [];
    if (!roomCohort) return;
    const conflicting = participantIds.filter((pid) => {
      const pCohort = cohortMap.get(String(pid));
      return pCohort && pCohort !== roomCohort;
    });
    if (conflicting.length > 0) {
      mixed++;
      if (samples.length < SUSPECT_LIMIT) {
        samples.push(
          `  room ${d.id} cohort=${roomCohort} has ${conflicting.length} off-cohort participants`,
        );
      }
    }
  });
  status(`mixed-cohort OPEN rooms: ${mixed} (expected 0)`, mixed === 0);
  samples.forEach((s) => console.log(s));
  return { mixedRooms: mixed, totalOpen: snap.size };
}

async function probeConversations(cohortMap) {
  console.log('\n== Probe 3: cross-cohort conversations not flagged frozen=true ==');
  const snap = await db.collection('conversations').get();
  let unfrozenCross = 0;
  let crossTotal = 0;
  const samples = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const participantIds = data.participantIds || [];
    if (participantIds.length < 2) return;
    const cohorts = new Set();
    for (const pid of participantIds) {
      const pCohort = cohortMap.get(String(pid));
      if (pCohort) cohorts.add(pCohort);
    }
    if (cohorts.size > 1) {
      crossTotal++;
      if (data.frozen !== true) {
        unfrozenCross++;
        if (samples.length < SUSPECT_LIMIT) {
          samples.push(
            `  conversation ${d.id} cohorts=${[...cohorts].join(',')} frozen=${data.frozen}`,
          );
        }
      }
    }
  });
  status(
    `cross-cohort conversations NOT frozen: ${unfrozenCross} (expected 0; total cross=${crossTotal})`,
    unfrozenCross === 0,
  );
  samples.forEach((s) => console.log(s));
  return { unfrozenCross, crossTotal };
}

async function probeOpsMarker() {
  console.log('\n== Probe 4: ops/segregation-migration marker ==');
  const snap = await db.doc('ops/segregation-migration').get();
  status(`marker exists: ${snap.exists}`, snap.exists);
  if (snap.exists) {
    const data = snap.data() || {};
    console.log(`  lastMigrationRunAt=${data.lastMigrationRunAt}`);
    console.log(`  fields: ${Object.keys(data).join(', ')}`);
  }
  return { exists: snap.exists };
}

async function main() {
  console.log('OSA data-invariant probe — read-only, target=dev');
  const cohortMap = await buildCohortMap();
  console.log(`resolved ${cohortMap.size} user→cohort entries`);

  const r1 = await probeFollowEdges(cohortMap);
  const r2 = await probeRooms(cohortMap);
  const r3 = await probeConversations(cohortMap);
  const r4 = await probeOpsMarker();

  const dataDirty =
    r1.followingCount > 0 || r1.followerCount > 0 || r2.mixedRooms > 0 || r3.unfrozenCross > 0;

  console.log('\n== Verdict ==');
  if (dataDirty) {
    console.log('DATA_DIRTY — OSA invariants violated. Migration was NOT properly applied to dev.');
    console.log('               Prod deploy must be BLOCKED. Run the migration before retrying.');
    process.exit(1);
  } else if (!r4.exists) {
    console.log('DATA_CLEAN_MARKER_MISSING — invariants hold but bookkeeping marker absent.');
    console.log(
      '                            Safe to write the marker; migration ran but did not record itself.',
    );
    process.exit(2);
  } else {
    console.log('ALL_CLEAN — invariants hold AND marker present. j19 should pass on next cycle.');
    process.exit(0);
  }
}
main().catch((e) => {
  console.error('PROBE_FAIL', e?.message || e);
  process.exit(3);
});
