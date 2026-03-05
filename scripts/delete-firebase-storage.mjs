/**
 * One-time cleanup: delete all files from Firebase Storage after R2 migration.
 * Run ONLY after confirming R2 migration was successful.
 *
 * Run:
 *   node scripts/delete-firebase-storage.mjs
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
const { getStorage } = await import("firebase-admin/storage");

const FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ?? "shytalk-7ba69.appspot.com";

if (!getApps().length) {
  initializeApp({ storageBucket: FIREBASE_STORAGE_BUCKET });
}
const bucket = getStorage().bucket();

const FOLDERS = [
  "pm_images",
  "stickers",
  "report_evidence",
  "profile_photos",
  "cover_photos",
  "group_photos",
];

let total = 0;

for (const folder of FOLDERS) {
  const [files] = await bucket.getFiles({ prefix: `${folder}/` });
  console.log(`📂 ${folder}/: ${files.length} files`);
  for (const file of files) {
    try {
      await file.delete();
      console.log(`  🗑️  Deleted: ${file.name}`);
      total++;
    } catch (e) {
      console.error(`  ❌ Failed to delete ${file.name}: ${e.message}`);
    }
  }
}

console.log(`\nDone — deleted ${total} files from Firebase Storage.`);
console.log("You can now downgrade back to Spark plan.");
