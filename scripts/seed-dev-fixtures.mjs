#!/usr/bin/env node
/**
 * Seed dev environment with fixture data.
 *
 * Usage: node scripts/seed-dev-fixtures.mjs
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing to the DEV service account.
 * Only run against the dev Firebase project.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to dev service account path');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(saPath, 'utf-8'));
if (!sa.project_id.includes('dev')) {
  console.error(`DANGER: project_id is "${sa.project_id}" — expected a dev project. Aborting.`);
  process.exit(1);
}

initializeApp({ credential: cert(sa) });
const db = getFirestore();

async function seed() {
  console.log(`Seeding dev fixtures in project: ${sa.project_id}`);

  // Test users
  const users = [
    { uid: 'dev_admin_001', displayName: 'Dev Admin', userType: 'ADMIN', coins: 999999, beans: 999999, gcs: 100 },
    { uid: 'dev_mod_001', displayName: 'Dev Moderator', userType: 'MODERATOR', coins: 50000, beans: 10000, gcs: 100 },
    { uid: 'dev_user_001', displayName: 'Dev User 1', userType: 'MEMBER', coins: 5000, beans: 1000, gcs: 100 },
    { uid: 'dev_user_002', displayName: 'Dev User 2', userType: 'MEMBER', coins: 1000, beans: 500, gcs: 100 },
    { uid: 'dev_user_003', displayName: 'Dev User 3', userType: 'MEMBER', coins: 100, beans: 0, gcs: 50 },
  ];

  for (const u of users) {
    await db.doc(`users/${u.uid}`).set({ ...u, createdAt: Date.now(), loginStreak: 1 }, { merge: true });
  }
  console.log(`  Created ${users.length} test users`);

  // Gifts (same as production catalog)
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
    await db.doc(`gifts/${g.id}`).set({ ...g, weight: 1.0, animationUrl: '', soundUrl: '', iconUrl: '' }, { merge: true });
  }
  console.log(`  Created ${gifts.length} gifts`);

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
  }, { merge: true });
  console.log('  Created 1 banner');

  // Coin packages
  const coinPackages = [
    { id: 'cp_100', name: '100 Coins', coins: 100, price: 0.99, currency: 'USD', order: 1, isActive: true, isBestValue: false },
    { id: 'cp_500', name: '500 Coins', coins: 500, price: 3.99, currency: 'USD', order: 2, isActive: true, isBestValue: false },
    { id: 'cp_1200', name: '1,200 Coins', coins: 1200, price: 7.99, currency: 'USD', order: 3, isActive: true, isBestValue: true },
    { id: 'cp_3000', name: '3,000 Coins', coins: 3000, price: 17.99, currency: 'USD', order: 4, isActive: true, isBestValue: false },
    { id: 'cp_6500', name: '6,500 Coins', coins: 6500, price: 34.99, currency: 'USD', order: 5, isActive: true, isBestValue: false },
    { id: 'cp_15000', name: '15,000 Coins', coins: 15000, price: 69.99, currency: 'USD', order: 6, isActive: true, isBestValue: false },
  ];

  for (const cp of coinPackages) {
    await db.doc(`coinPackages/${cp.id}`).set({ ...cp, createdAt: Date.now() }, { merge: true });
  }
  console.log(`  Created ${coinPackages.length} coin packages`);

  // Economy config
  await db.doc('config/economy').set({
    dailyLoginReward: 100,
    gachaSpinCost: 50,
    gachaPityThreshold: 50,
  }, { merge: true });
  console.log('  Created economy config');

  console.log('Done! Dev fixtures seeded.');
}

seed().catch(e => { console.error(e); process.exit(1); });
