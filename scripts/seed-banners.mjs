/**
 * One-time seed script: populate Firestore `banners` collection
 *
 * Run:
 *   node scripts/seed-banners.mjs
 */

import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  const { config } = await import("dotenv");
  config({ path: envPath });
}

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

if (!getApps().length) initializeApp();
const db = getFirestore();

const BANNERS = [
  {
    title: "Safe & Supportive Community",
    imageUrl: "https://images.shytalk.shyden.co.uk/banners/safe-community.png",
    actionType: "NONE",
    actionValue: null,
    sortOrder: 1,
    isActive: true,
    startDate: Date.now(),
    endDate: null, // no expiry
  },
];

async function seed() {
  const collection = db.collection("banners");
  const existing = await collection.get();
  const existingTitles = new Set(existing.docs.map((d) => d.data().title));

  let added = 0;
  let skipped = 0;

  for (const banner of BANNERS) {
    if (existingTitles.has(banner.title)) {
      console.log(`  SKIP (exists): ${banner.title}`);
      skipped++;
      continue;
    }

    await collection.add(banner);
    console.log(`  ADD: ${banner.title}`);
    added++;
  }

  console.log(`\nDone! Added ${added}, skipped ${skipped}.`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
