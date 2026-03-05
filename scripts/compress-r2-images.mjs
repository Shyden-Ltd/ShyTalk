/**
 * Compress all images in the R2 bucket (via local backup) and re-upload.
 *
 * - JPEG/PNG → WebP (quality 80, max 1920px wide)
 * - Updates Firestore URLs from .jpg/.png to .webp where applicable
 * - Skips files already in WebP format
 *
 * Run:
 *   node scripts/compress-r2-images.mjs
 */

import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { resolve, dirname, join, extname, basename } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  const { config } = await import("dotenv");
  config({ path: envPath });
}

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = await import("@aws-sdk/client-s3");
const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

if (!getApps().length) initializeApp();
const db = getFirestore();

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "shytalk-media";
const R2_PUBLIC_BASE = "https://images.shytalk.shyden.co.uk";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const BACKUP_DIR = resolve(__dirname, "../backups/r2");
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_WIDTH = 1920;
const WEBP_QUALITY = 80;

function walkDir(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else if (IMAGE_EXTS.has(extname(full).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

async function compressAndUpload(localPath) {
  const relPath = localPath.replace(BACKUP_DIR + "\\", "").replace(BACKUP_DIR + "/", "");
  const r2Key = relPath.replace(/\\/g, "/");
  const ext = extname(r2Key).toLowerCase();
  const originalSize = statSync(localPath).size;

  // Read and compress
  const buffer = readFileSync(localPath);
  let compressed;
  let newKey = r2Key;

  if (ext === ".webp") {
    // Already WebP — just resize if needed
    compressed = await sharp(buffer)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } else {
    // Convert to WebP
    compressed = await sharp(buffer)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    newKey = r2Key.replace(/\.(jpg|jpeg|png)$/i, ".webp");
  }

  const savings = ((1 - compressed.length / originalSize) * 100).toFixed(1);
  console.log(
    `  ${r2Key}: ${(originalSize / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB (${savings}% smaller)${newKey !== r2Key ? ` → ${newKey}` : ""}`
  );

  // Upload compressed version
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: newKey,
      Body: compressed,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  // Delete old key if we changed extension
  if (newKey !== r2Key) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: r2Key }));
  }

  return { oldUrl: `${R2_PUBLIC_BASE}/${r2Key}`, newUrl: `${R2_PUBLIC_BASE}/${newKey}`, changed: newKey !== r2Key };
}

async function updateFirestoreUrls(urlMap) {
  if (urlMap.size === 0) return;
  console.log(`\nUpdating ${urlMap.size} Firestore URL(s)...`);

  // Users
  const users = await db.collection("users").get();
  for (const doc of users.docs) {
    const d = doc.data();
    const updates = {};
    if (d.profilePhotoUrl && urlMap.has(d.profilePhotoUrl)) updates.profilePhotoUrl = urlMap.get(d.profilePhotoUrl);
    if (d.coverPhotoUrl && urlMap.has(d.coverPhotoUrl)) updates.coverPhotoUrl = urlMap.get(d.coverPhotoUrl);
    if (Object.keys(updates).length) {
      await doc.ref.update(updates);
      console.log(`  Updated user ${doc.id}`);
    }
  }

  // Banners
  const banners = await db.collection("banners").get();
  for (const doc of banners.docs) {
    const d = doc.data();
    if (d.imageUrl && urlMap.has(d.imageUrl)) {
      await doc.ref.update({ imageUrl: urlMap.get(d.imageUrl) });
      console.log(`  Updated banner ${doc.id}`);
    }
  }

  // Conversations (group photos)
  const convs = await db.collection("conversations").get();
  for (const doc of convs.docs) {
    const d = doc.data();
    if (d.groupPhotoUrl && urlMap.has(d.groupPhotoUrl)) {
      await doc.ref.update({ groupPhotoUrl: urlMap.get(d.groupPhotoUrl) });
      console.log(`  Updated conversation ${doc.id}`);
    }
  }
}

async function main() {
  if (!existsSync(BACKUP_DIR)) {
    console.error("No backup dir found. Run backup-r2.sh first.");
    process.exit(1);
  }

  const files = walkDir(BACKUP_DIR);
  console.log(`Found ${files.length} images to compress\n`);

  const urlMap = new Map();
  let totalSaved = 0;

  for (const file of files) {
    try {
      const originalSize = statSync(file).size;
      const result = await compressAndUpload(file);
      const newSize = statSync(file).size; // approximate
      if (result.changed) {
        urlMap.set(result.oldUrl, result.newUrl);
      }
      totalSaved += originalSize;
    } catch (e) {
      console.error(`  ERROR: ${file}: ${e.message}`);
    }
  }

  await updateFirestoreUrls(urlMap);
  console.log(`\nDone! Compressed and re-uploaded ${files.length} images.`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
