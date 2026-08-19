#!/usr/bin/env node
/**
 * Full environment reset — wipe all Firestore data, R2 storage, and RTDB.
 *
 * Usage:
 *   # Dev (default):
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/dev-sa.json node scripts/reset-data.mjs
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/dev-sa.json node scripts/reset-data.mjs --env dev
 *
 *   # Prod (requires explicit flag + interactive confirmation):
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/prod-sa.json node scripts/reset-data.mjs --env prod
 *
 * Optional env vars (for R2 wipe — loaded from express-api/.env if present):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * What this does:
 *   1. Deletes ALL documents from ALL known Firestore collections + subcollections
 *   2. Resets the uniqueId counter to 10000000
 *   3. Deletes ALL R2 objects (except system/ folder)
 *   4. Clears RTDB rooms + conversations nodes
 *   5. Re-seeds fixtures (dev only — gifts, economy config, banner)
 *
 * Safety:
 *   - Dev: aborts if the project_id does not contain "dev"
 *   - Prod: requires --env prod flag AND interactive confirmation (type project ID)
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Parse CLI args ──
const args = process.argv.slice(2);
const envFlagIdx = args.indexOf('--env');
const envArg = envFlagIdx !== -1 ? args[envFlagIdx + 1] : 'dev';

if (!['dev', 'prod'].includes(envArg)) {
  console.error(`Invalid --env value: "${envArg}". Must be "dev" or "prod".`);
  process.exit(1);
}

const isProd = envArg === 'prod';

// ── Load .env from express-api if it exists (for R2 credentials) ──
const envPath = resolve(__dirname, '..', 'express-api', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Firebase init ──
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON path');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(saPath, 'utf-8'));

// ── Safety checks ──
if (!isProd && !sa.project_id.includes('dev')) {
  console.error(`DANGER: project_id is "${sa.project_id}" but --env is dev.`);
  console.error('If you mean to reset production, use: --env prod');
  process.exit(1);
}

if (isProd && sa.project_id.includes('dev')) {
  console.error(`WARNING: project_id "${sa.project_id}" looks like a dev project but --env is prod.`);
  console.error('Use --env dev instead, or check your GOOGLE_APPLICATION_CREDENTIALS path.');
  process.exit(1);
}

// ── Interactive confirmation for production ──
async function confirmProd() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log('\n⚠️  PRODUCTION DATA WIPE ⚠️');
    console.log(`Project: ${sa.project_id}`);
    console.log('This will PERMANENTLY DELETE all Firestore data, R2 storage, and RTDB data.');
    console.log('This action CANNOT be undone.\n');
    rl.question(`Type the project ID "${sa.project_id}" to confirm: `, (answer) => {
      rl.close();
      resolve(answer.trim() === sa.project_id);
    });
  });
}

if (isProd) {
  const confirmed = await confirmProd();
  if (!confirmed) {
    console.error('Confirmation failed. Aborting.');
    process.exit(1);
  }
}

// ── RTDB URL ──
// Dev: europe-west1, Prod: asia-southeast1
const RTDB_REGIONS = {
  dev: 'europe-west1',
  prod: 'asia-southeast1',
};
const rtdbRegion = RTDB_REGIONS[envArg] || 'europe-west1';
const rtdbUrl = process.env.FIREBASE_DATABASE_URL ||
  `https://${sa.project_id}-default-rtdb.${rtdbRegion}.firebasedatabase.app`;

initializeApp({
  credential: cert(sa),
  databaseURL: rtdbUrl,
});
const db = getFirestore();
const rtdb = getDatabase();

const envLabel = isProd ? 'PRODUCTION' : 'DEV';
console.log(`\n🔄 Resetting ${envLabel} environment: ${sa.project_id}`);
console.log(`   RTDB: ${rtdbUrl}\n`);

// ── Collections ──
const TOP_LEVEL_COLLECTIONS = [
  'users', 'rooms', 'conversations', 'deviceBindings', 'gifts',
  'giftCatalog', 'economyConfig', 'banners', 'reports',
  'appeals', 'subscriptions', 'logConfig', 'deviceBans', 'networkBans',
  'config', 'coinPackages', 'purchaseReceipts', 'reportLocks',
  'reportsArchive', 'suspensionAppeals', 'broadcasts', 'adminAuditLog',
  'alertConfig', 'identityMap', 'counters',
];

// parent → [subcollection names]
const SUBCOLLECTIONS = {
  rooms: ['messages', 'seatRequests'],
  conversations: ['messages', 'userSettings', 'mutes'],
  users: ['backpack', 'giftWall', 'transactions', 'stalkers'],
};

async function deleteCollection(collectionPath) {
  let total = 0;
  while (true) {
    const snapshot = await db.collection(collectionPath).limit(500).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    total += snapshot.size;
  }
  return total;
}

async function run() {
  const results = {};
  let grandTotal = 0;

  // ── Phase 1: Delete subcollections ──
  console.log('Phase 1: Deleting subcollections...');
  for (const [parent, subs] of Object.entries(SUBCOLLECTIONS)) {
    const parentDocs = await db.collection(parent).listDocuments();
    for (const sub of subs) {
      let subTotal = 0;
      for (const parentRef of parentDocs) {
        subTotal += await deleteCollection(`${parent}/${parentRef.id}/${sub}`);
      }
      const key = `${parent}/*/${sub}`;
      results[key] = subTotal;
      grandTotal += subTotal;
      if (subTotal > 0) console.log(`  ${key}: ${subTotal} docs deleted`);
    }
  }

  // ── Phase 2: Delete top-level collections ──
  console.log('\nPhase 2: Deleting top-level collections...');
  for (const name of TOP_LEVEL_COLLECTIONS) {
    const deleted = await deleteCollection(name);
    results[name] = deleted;
    grandTotal += deleted;
    if (deleted > 0) console.log(`  ${name}: ${deleted} docs deleted`);
  }

  console.log(`\nFirestore: ${grandTotal} total documents deleted`);

  // ── Phase 3: Reset uniqueId counter ──
  console.log('\nPhase 3: Resetting uniqueId counter to 10000000...');
  await db.doc('counters/uniqueId').set({ value: 10000000 });
  console.log('  counters/uniqueId → { value: 10000000 }');

  // ── Phase 4: Wipe R2 storage ──
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    console.log('\nPhase 4: Wiping R2 storage...');
    try {
      const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');

      // Dev: shytalk-media-dev, Prod: shytalk-media
      const defaultBucket = isProd ? 'shytalk-media' : 'shytalk-media-dev';
      const bucketName = process.env.R2_BUCKET_NAME || defaultBucket;
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });

      const folders = ['profiles/', 'covers/', 'messages/', 'groups/', 'evidence/', 'stickers/', 'banners/'];
      let r2Total = 0;

      for (const prefix of folders) {
        const allKeys = [];
        let continuationToken;

        do {
          const resp = await s3.send(new ListObjectsV2Command({
            Bucket: bucketName, Prefix: prefix, MaxKeys: 1000, ContinuationToken: continuationToken,
          }));
          for (const obj of (resp.Contents || [])) allKeys.push(obj.Key);
          continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
        } while (continuationToken);

        if (allKeys.length > 0) {
          for (let i = 0; i < allKeys.length; i += 1000) {
            const batch = allKeys.slice(i, i + 1000);
            await s3.send(new DeleteObjectsCommand({
              Bucket: bucketName,
              Delete: { Objects: batch.map(k => ({ Key: k })) },
            }));
          }
        }

        if (allKeys.length > 0) console.log(`  ${prefix}: ${allKeys.length} objects deleted`);
        r2Total += allKeys.length;
      }

      console.log(`  R2 total: ${r2Total} objects deleted from ${bucketName} (system/ folder preserved)`);
    } catch (err) {
      console.error(`  R2 wipe failed: ${err.message}`);
    }
  } else {
    console.log('\nPhase 4: Skipping R2 wipe (R2 credentials not set)');
  }

  // ── Phase 5: Clear RTDB ──
  console.log('\nPhase 5: Clearing RTDB...');
  try {
    await rtdb.ref('rooms').remove();
    console.log('  rooms/ removed');
  } catch (err) {
    console.log(`  rooms/ skip: ${err.message}`);
  }
  try {
    await rtdb.ref('conversations').remove();
    console.log('  conversations/ removed');
  } catch (err) {
    console.log(`  conversations/ skip: ${err.message}`);
  }

  // ── Phase 6: Re-seed fixtures (dev only) ──
  if (!isProd) {
    console.log('\nPhase 6: Re-seeding dev fixtures...');
    await seedFixtures();
  } else {
    console.log('\nPhase 6: Skipping fixture seeding (production environment)');
  }

  console.log(`\n✅ ${envLabel} environment reset complete!`);
  console.log(`   Firestore: ${grandTotal} docs deleted, counter reset to 10000000`);
  if (!isProd) {
    console.log('   Fixtures: gifts, economy config, banner re-seeded');
  }
}

async function seedFixtures() {
  // Gifts
  const gifts = [
    { id: 'rose', name: 'Rose', coinValue: 1, order: 1, showInStore: true, showOnWheel: true },
    { id: 'lollipop', name: 'Lollipop', coinValue: 5, order: 2, showInStore: true, showOnWheel: true },
    { id: 'ice_cream', name: 'Ice Cream', coinValue: 10, order: 3, showInStore: true, showOnWheel: true },
    { id: 'coffee', name: 'Coffee', coinValue: 25, order: 4, showInStore: true, showOnWheel: true },
    { id: 'teddy_bear', name: 'Teddy Bear', coinValue: 50, order: 5, showInStore: true, showOnWheel: true },
    { id: 'heart', name: 'Heart', coinValue: 25, order: 6, showInStore: true, showOnWheel: true },
    { id: 'star', name: 'Star', coinValue: 10, order: 7, showInStore: true, showOnWheel: true },
    { id: 'crown', name: 'Crown', coinValue: 5000, order: 8, showInStore: true, showOnWheel: true },
    { id: 'diamond_ring', name: 'Diamond Ring', coinValue: 2000, order: 9, showInStore: true, showOnWheel: true },
    { id: 'universe', name: 'Universe', coinValue: 200000, order: 10, showInStore: true, showOnWheel: true },
  ];

  for (const g of gifts) {
    await db.doc(`gifts/${g.id}`).set({ ...g, weight: 1.0, animationUrl: '', soundUrl: '', iconUrl: '' });
  }
  console.log(`  Created ${gifts.length} gifts`);

  // Fun facts
  // Banner
  await db.doc('banners/dev_banner_1').set({
    id: 'dev_banner_1',
    title: 'Dev Test Banner',
    imageUrl: 'https://dev-images.shytalk.shyden.co.uk/system/shytalk_icon.webp',
    actionType: 'NONE',
    actionValue: '',
    isActive: true,
    sortOrder: 1,
    startDate: Date.now(),
    endDate: null,
  });
  console.log('  Created 1 banner');

  // Economy config
  await db.doc('config/economy').set({
    dailyLoginReward: 100,
    gachaSpinCost: 50,
    gachaPityThreshold: 50,
  });
  console.log('  Created economy config');
}

run().catch(e => { console.error(e); process.exit(1); });
