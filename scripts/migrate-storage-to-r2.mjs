/**
 * One-time migration script: Firebase Storage → Cloudflare R2
 *
 * Steps:
 *   1. List all files in Firebase Storage across 6 folders
 *   2. Download bytes + contentType from Firebase Storage
 *   3. Upload to R2 at the same relative path (skip if already present in R2)
 *   4. Build old_firebase_url → new_r2_url map
 *   5. Batch-update Firestore documents with the new R2 URLs
 *
 * Setup:
 *   npm install firebase-admin @aws-sdk/client-s3 dotenv
 *   Create a .env file (see required vars below) — never commit this file!
 *
 * Required .env vars:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json
 *   CF_ACCOUNT_ID=your_cloudflare_account_id
 *   R2_ACCESS_KEY=your_r2_access_key_id
 *   R2_SECRET_KEY=your_r2_secret_access_key
 *   R2_BUCKET_NAME=shytalk-media
 *   R2_PUBLIC_BASE=https://images.shytalk.shyden.co.uk
 *   FIREBASE_STORAGE_BUCKET=shytalk-7ba69.appspot.com
 *
 * Run:
 *   node scripts/migrate-storage-to-r2.mjs [--dry-run]
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  const { config } = await import("dotenv");
  config({ path: envPath });
}

const {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  HeadObjectCommand,
} = await import("@aws-sdk/client-s3");

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getStorage } = await import("firebase-admin/storage");

// --- Config ---
const DRY_RUN = process.argv.includes("--dry-run");
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "shytalk-media";
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE ?? "https://images.shytalk.shyden.co.uk";
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET ?? "shytalk-7ba69.appspot.com";

if (!CF_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error("Missing required env vars: CF_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY");
  process.exit(1);
}

if (DRY_RUN) console.log("🔍 DRY RUN mode — no changes will be made");

// --- Firebase Admin init ---
if (!getApps().length) {
  initializeApp({ storageBucket: FIREBASE_STORAGE_BUCKET });
}
const db = getFirestore();
const bucket = getStorage().bucket();

// --- R2 S3 client ---
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const FOLDERS = [
  "pm_images",
  "stickers",
  "report_evidence",
  "profile_photos",
  "cover_photos",
  "group_photos",
];

// --- Helpers ---

function firebaseUrlToKey(downloadUrl) {
  const match = downloadUrl?.match(/\/o\/(.+?)\?/);
  return match ? decodeURIComponent(match[1]) : null;
}

function r2Url(key) {
  return `${R2_PUBLIC_BASE}/${key}`;
}

async function fileExistsInR2(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToR2(key, buffer, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

// --- Step 1 & 2 & 3: Copy files from Firebase Storage to R2 ---
async function migrateFiles() {
  const urlMap = new Map(); // firebase_download_url → r2_url
  let totalFiles = 0;
  let skipped = 0;
  let uploaded = 0;
  let errors = 0;

  for (const folder of FOLDERS) {
    const [files] = await bucket.getFiles({ prefix: `${folder}/` });
    console.log(`\n📂 ${folder}/: ${files.length} files`);

    for (const file of files) {
      totalFiles++;
      const key = file.name; // e.g. "profile_photos/uid/12345.jpg"

      try {
        // Check if already uploaded (resumable)
        if (!DRY_RUN && (await fileExistsInR2(key))) {
          console.log(`  ⏭  Already in R2: ${key}`);
          skipped++;

          // Still need the Firebase download URL → R2 URL mapping
          const [metadata] = await file.getMetadata();
          const [signedUrls] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 60 * 60 * 1000,
          });
          urlMap.set(signedUrls, r2Url(key));
          continue;
        }

        // Get metadata and download URL
        const [metadata] = await file.getMetadata();
        const contentType = metadata.contentType ?? "application/octet-stream";

        // Download bytes from Firebase Storage
        const [buffer] = await file.download();

        // Get Firebase download URL (for URL remapping)
        const downloadUrl = metadata.mediaLink ?? null;
        // We'll build the URL map differently - using the public download URL pattern
        // Firebase Storage download URLs look like:
        // https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded_path}?alt=media&token={token}
        const [signedUrl] = await file.getSignedUrl({
          action: "read",
          expires: Date.now() + 60 * 60 * 1000,
        });

        if (DRY_RUN) {
          console.log(`  🔍 Would upload: ${key} (${contentType}, ${buffer.length} bytes)`);
          uploaded++;
          continue;
        }

        await uploadToR2(key, buffer, contentType);
        console.log(`  ✅ Uploaded: ${key}`);
        uploaded++;
        urlMap.set(key, r2Url(key)); // key → r2Url mapping
      } catch (e) {
        console.error(`  ❌ Error processing ${key}: ${e.message}`);
        errors++;
      }
    }
  }

  console.log(`\n📊 Migration summary:`);
  console.log(`   Total files: ${totalFiles}`);
  console.log(`   Uploaded: ${uploaded}`);
  console.log(`   Skipped (already in R2): ${skipped}`);
  console.log(`   Errors: ${errors}`);

  return urlMap;
}

// --- Step 4 & 5: Scan Firestore and update URLs ---
async function updateFirestoreUrls() {
  if (DRY_RUN) {
    console.log("\n🔍 Skipping Firestore update in dry-run mode");
    return;
  }

  console.log("\n🔄 Updating Firestore documents...");

  // Build a reverse lookup: Firebase Storage path → R2 URL
  // We do this by querying Firestore for all Firebase Storage URLs and replacing them
  const FIREBASE_URL_PREFIX = "https://firebasestorage.googleapis.com";

  function toR2Url(url) {
    if (!url || !url.startsWith(FIREBASE_URL_PREFIX)) return null;
    const key = firebaseUrlToKey(url);
    return key ? r2Url(key) : null;
  }

  function replaceUrl(url) {
    const newUrl = toR2Url(url);
    return newUrl ?? url;
  }

  let updated = 0;

  // --- users ---
  const usersSnap = await db.collection("users").get();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const updates = {};

    const profileNew = toR2Url(data.profilePhotoUrl);
    if (profileNew) updates.profilePhotoUrl = profileNew;

    const coverNew = toR2Url(data.coverPhotoUrl);
    if (coverNew) updates.coverPhotoUrl = coverNew;

    if (data._preSuspension) {
      const preNew = {};
      const preProfile = toR2Url(data._preSuspension.profilePhotoUrl);
      if (preProfile) preNew.profilePhotoUrl = preProfile;
      const preCover = toR2Url(data._preSuspension.coverPhotoUrl);
      if (preCover) preNew.coverPhotoUrl = preCover;
      if (Object.keys(preNew).length > 0) {
        updates._preSuspension = { ...data._preSuspension, ...preNew };
      }
    }

    if (Object.keys(updates).length > 0) {
      await doc.ref.update(updates);
      console.log(`  👤 Updated user: ${doc.id}`);
      updated++;
    }
  }

  // --- conversations: groupPhotoUrl + messages ---
  const convsSnap = await db.collection("conversations").get();
  for (const doc of convsSnap.docs) {
    const data = doc.data();
    const updates = {};
    const groupNew = toR2Url(data.groupPhotoUrl);
    if (groupNew) updates.groupPhotoUrl = groupNew;
    if (Object.keys(updates).length > 0) {
      await doc.ref.update(updates);
      updated++;
    }

    // IMAGE messages: imageUrls[]
    const imageSnap = await doc.ref.collection("messages").where("type", "==", "IMAGE").get();
    for (const msgDoc of imageSnap.docs) {
      const msgData = msgDoc.data();
      const oldUrls = msgData.imageUrls ?? [];
      const newUrls = oldUrls.map(replaceUrl);
      if (newUrls.some((u, i) => u !== oldUrls[i])) {
        await msgDoc.ref.update({ imageUrls: newUrls });
        updated++;
      }
    }

    // STICKER messages: stickerUrl
    const stickerSnap = await doc.ref.collection("messages").where("type", "==", "STICKER").get();
    for (const msgDoc of stickerSnap.docs) {
      const msgData = msgDoc.data();
      const newUrl = toR2Url(msgData.stickerUrl);
      if (newUrl) {
        await msgDoc.ref.update({ stickerUrl: newUrl });
        updated++;
      }
    }
  }

  // --- reports + reports_archive ---
  for (const col of ["reports", "reports_archive"]) {
    const snap = await db.collection(col).get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const oldUrls = data.evidenceUrls ?? [];
      const newUrls = oldUrls.map(replaceUrl);
      if (newUrls.some((u, i) => u !== oldUrls[i])) {
        await doc.ref.update({ evidenceUrls: newUrls });
        updated++;
      }
    }
  }

  console.log(`✅ Firestore update complete: ${updated} documents updated`);
}

// --- Main ---
async function main() {
  console.log("🚀 Starting Firebase Storage → Cloudflare R2 migration");
  await migrateFiles();
  await updateFirestoreUrls();
  console.log("\n✅ Migration complete!");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
