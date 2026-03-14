# Optimise Recommendations — Design Doc

**Date:** 2026-03-11
**Branch:** feature/dev-environment

## Overview

Six improvements identified by the /optimise audit that couldn't be auto-fixed. Each is scoped as a discrete task.

## Fix 1: Google Play Purchase Verification

**Problem:** `POST /economy/purchase` accepts purchase tokens without server-side verification. Crafted requests can credit coins.

**Design:**
- Create `express-api/src/utils/playStore.js`:
  - Reuse Firebase service account credentials (already loaded by `firebase-admin`) to obtain OAuth2 access tokens via `google-auth-library` (transitive dep of `firebase-admin`)
  - `verifyProductPurchase(packageName, productId, token)` — calls `GET androidpublisher.googleapis.com/v3/applications/{pkg}/purchases/products/{productId}/tokens/{token}`
  - `verifySubscription(packageName, subscriptionId, token)` — calls `GET androidpublisher.googleapis.com/v3/applications/{pkg}/purchases/subscriptionsv2/tokens/{token}`
  - Returns parsed response or throws on verification failure
- In `economy.js` purchase route:
  - Call `verifyProductPurchase()` before crediting coins
  - Reject if `purchaseState !== 0` (not purchased) or `consumptionState === 1` (already consumed)
  - Update receipt doc with `verified: true` and Google's `orderId`
  - For subscriptions: call `verifySubscription()`, check subscription state
- No new npm dependencies — uses `google-auth-library` (already bundled with `firebase-admin`)
- **Manual step:** Grant Firebase service account "View financial data" permission in Google Play Console

## Fix 2: HomeViewModel Refresh Optimization

**Problem:** 120s polling with `userCache.clear()` forces full re-fetch of all users every cycle.

**Design:**
- Increase `REFRESH_INTERVAL_MS` from `120_000` to `300_000` (5 minutes)
- Replace `userCache.clear()` with time-based eviction:
  - Add `userCacheTimestamps: MutableMap<String, Long>` tracking when each user was cached
  - In `refreshRoomsInternal()`, only evict entries older than 5 minutes
  - `filterAndEmitRooms()` already only fetches uncached users, so stale eviction feeds into that
- Keep `loadBanners()` in the refresh cycle (cheap via Firestore offline cache)

## Fix 3: Conversation Notification Batching

**Problem:** Each recipient triggers 2 sequential Firestore reads (user doc + settings). 10-person group = 20 reads per message.

**Design:**
- In `sendMessageNotifications()`, before the loop:
  - Batch-fetch all recipient user docs via `db.getAll(...userRefs)` (Firebase Admin supports up to 100 refs)
  - Batch-fetch all recipient settings docs via `db.getAll(...settingsRefs)`
  - Build lookup maps: `usersById`, `settingsByUserId`
- Replace per-recipient `db.doc().get()` with map lookups
- 10-person group: 20 reads → 2 batch reads

## Fix 4: Deduplicate S3Client

**Problem:** `admin-backup.js` and `admin-cleanup.js` each create their own S3Client identical to `r2.js`.

**Design:**
- Add to `r2.js`:
  - `listObjectsWithMetadata(prefix)` — returns `[{key, size, lastModified}]` (what admin routes need)
  - Export `s3` client and `bucketName` for direct use in edge cases
- In `admin-backup.js`: remove duplicate S3Client, import `{ s3, bucketName, listObjectsWithMetadata }` from `r2.js`; remove `@aws-sdk/client-s3` imports
- In `admin-cleanup.js`: same — import shared client from `r2.js`

## Fix 5: Keystore Password Externalization

**Problem:** Signing password hardcoded in `app/build.gradle.kts` (visible in source control).

**Design:**
- Add to `local.properties` (already gitignored): `KEYSTORE_PASSWORD=<password>`
- In `build.gradle.kts` signingConfigs:
  - Read password via `project.findProperty("KEYSTORE_PASSWORD")?.toString() ?: System.getenv("KEYSTORE_PASSWORD") ?: ""`
  - Falls back to env var for CI, then empty string (CI uses dummy signing anyway)
- Remove the plaintext password from source code

## Fix 6: Express API .env.example

**Problem:** No documentation of required environment variables for the Express API.

**Design:**
- Create `express-api/.env.example` listing every `process.env.*` reference:
  - **Firebase:** `FIREBASE_SERVICE_ACCOUNT_PATH`, `FIREBASE_DATABASE_URL` (required), `FIREBASE_PROJECT_ID`
  - **R2 Storage:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `CDN_URL`
  - **LiveKit:** `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
  - **Server:** `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`
  - **Translation:** `LIBRETRANSLATE_URL`
  - **Testing:** `TEST_API_KEY` (dev only)
- Group by service, include descriptions and example values
- Mark required vs optional with defaults noted
