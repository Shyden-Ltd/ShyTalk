# Dev Environment Setup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two fully isolated environments (Dev + Prod) with a gated CI/CD release pipeline, comprehensive testing, and automatic rollback.

**Architecture:** Android build flavors select Firebase project + API URLs. Express API uses `.env` files per server. A single GitHub Actions workflow handles build → test → dev deploy → approval gate → prod deploy. E2E tests create their own data via test helper API endpoints.

**Tech Stack:** Gradle product flavors, GitHub Actions (workflow_dispatch, environments, concurrency), Playwright, Firebase Admin SDK, Cloudflare R2/Pages/DNS, Caddy, PM2.

---

### Task 1: Create Dev Firebase Project

**Step 1: Create the Firebase project**

Go to https://console.firebase.google.com/ and create a new project:
- Project name: `shytalk-dev`
- Firestore location: `europe-west2` (London)
- Enable: Authentication (Google Sign-In + Email/Password), Firestore, Realtime Database, Cloud Messaging

**Step 2: Configure RTDB**

In Firebase Console → Realtime Database → Create Database:
- Location: `europe-west1` (Belgium)
- Start in locked mode

**Step 3: Add Android app to dev project**

In Firebase Console → Project Settings → Add App → Android:
- Package name: `com.shyden.shytalk`
- Download `google-services.json` — save as `app/src/dev/google-services.json` (will create directory in Task 5)

Also add a second Android app entry for the debug variant:
- Package name: `com.shyden.shytalk.dev`
- This ensures both `devDebug` (.dev suffix) and `devRelease` (base ID) work with Firebase

**Step 4: Generate service account key**

Firebase Console → Project Settings → Service Accounts → Generate New Private Key.
Save as `shytalk-dev-firebase-adminsdk.json`. This will be uploaded to the London server.

**Step 5: Deploy security rules to dev project**

```bash
npx firebase use shytalk-dev
npx firebase deploy --only firestore:rules
npx firebase deploy --only database
```

**Step 6: Commit**

```bash
git add app/src/dev/google-services.json
git commit -m "feat(env): add dev Firebase google-services.json"
```

> Note: Do NOT commit the service account key to git.

---

### Task 2: Create Dev R2 Bucket and CDN

**Step 1: Create the bucket**

In Cloudflare Dashboard → R2 → Create Bucket:
- Name: `shytalk-media-dev`
- Location hint: Western Europe (`WEUR`)

**Step 2: Create R2 API token for dev**

Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token:
- Permissions: Object Read & Write
- Specify bucket: `shytalk-media-dev`
- Save the Access Key ID and Secret Access Key

**Step 3: Set up dev CDN domain**

Cloudflare Dashboard → DNS for `shyden.co.uk`:
- Add CNAME: `dev-images.shytalk` → point to R2 custom domain (or use Cloudflare Transform Rules to proxy to the dev bucket)

Alternatively, in R2 → `shytalk-media-dev` → Settings → Custom Domains → Add `dev-images.shytalk.shyden.co.uk`

**Step 4: Verify**

```bash
curl -I https://dev-images.shytalk.shyden.co.uk/
```

---

### Task 3: Configure London Server as Dev API

**Step 1: Add DNS record**

Cloudflare Dashboard → DNS for `shyden.co.uk`:
- Add A record: `dev-api.shytalk` → `145.241.224.13` (proxied)

**Step 2: SSH to London and update Caddy**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13
```

Edit `/etc/caddy/Caddyfile`:

```
dev-api.shytalk.shyden.co.uk {
    reverse_proxy localhost:3000
}
```

Restart Caddy:
```bash
sudo systemctl restart caddy
```

**Step 3: Upload dev service account**

From local machine:
```bash
scp -i ~/.ssh/shytalk-oci shytalk-dev-firebase-adminsdk.json ubuntu@145.241.224.13:~/shytalk-api/
```

**Step 4: Create dev `.env` on London**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13
cat > ~/shytalk-api/.env << 'ENVEOF'
NODE_ENV=development
PORT=3000

# Dev Firebase
FIREBASE_SERVICE_ACCOUNT_PATH=/home/ubuntu/shytalk-api/shytalk-dev-firebase-adminsdk.json
FIREBASE_PROJECT_ID=shytalk-dev
FIREBASE_DATABASE_URL=https://shytalk-dev-default-rtdb.europe-west1.firebasedatabase.app

# Dev R2
R2_ACCOUNT_ID=9315582c39b627dca58dfa83602db385
R2_ACCESS_KEY_ID=<dev-r2-access-key>
R2_SECRET_ACCESS_KEY=<dev-r2-secret-key>
R2_BUCKET_NAME=shytalk-media-dev
CDN_URL=https://dev-images.shytalk.shyden.co.uk

# LiveKit (shared)
LIVEKIT_API_KEY=<same-as-prod>
LIVEKIT_API_SECRET=<same-as-prod>

# Test API
TEST_API_KEY=<generate-a-random-key>
ENVEOF
```

Replace placeholders with actual values.

**Step 5: Deploy Express API to London**

```bash
cd ~/express-api  # local machine
tar czf /tmp/shytalk-api.tar.gz --exclude='node_modules' --exclude='.env' .
scp -i ~/.ssh/shytalk-oci /tmp/shytalk-api.tar.gz ubuntu@145.241.224.13:/tmp/
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13 "cd ~/shytalk-api && tar xzf /tmp/shytalk-api.tar.gz && npm install --production && pm2 restart shytalk-api"
```

**Step 6: Verify**

```bash
curl https://dev-api.shytalk.shyden.co.uk/api/health
```

Expected: `{"status":"ok","timestamp":...}`

---

### Task 4: Set Up Dev Cloudflare Pages

**Step 1: Create admin config file**

Create: `public/admin/config.js`

```javascript
// Environment configuration — overridden per Cloudflare Pages deployment
window.SHYTALK_CONFIG = {
  API_BASE: "https://api.shytalk.shyden.co.uk",
  FIREBASE_CONFIG: {
    apiKey: "<PROD_FIREBASE_API_KEY>",
    authDomain: "shytalk-7ba69.firebaseapp.com",
    projectId: "shytalk-7ba69"
  }
};
```

**Step 2: Create dev config file**

Create: `public/admin/config.dev.js`

```javascript
window.SHYTALK_CONFIG = {
  API_BASE: "https://dev-api.shytalk.shyden.co.uk",
  FIREBASE_CONFIG: {
    apiKey: "<dev-firebase-api-key>",
    authDomain: "shytalk-dev.firebaseapp.com",
    projectId: "shytalk-dev"
  }
};
```

**Step 3: Update admin panel to use config**

Modify: `public/admin/index.html`

Add before the main script block (around line 4280):

```html
<script src="config.js"></script>
```

Replace the hardcoded constants (around line 4285-4291):

```javascript
// Old:
// const FIREBASE_CONFIG = { ... };
// const API_BASE = "https://api.shytalk.shyden.co.uk";

// New:
const FIREBASE_CONFIG = window.SHYTALK_CONFIG.FIREBASE_CONFIG;
const API_BASE = window.SHYTALK_CONFIG.API_BASE;
```

**Step 4: Create dev Cloudflare Pages project**

```bash
# Deploy dev site (copy config.dev.js as config.js for dev deployment)
cp public/admin/config.dev.js public/admin/config.js
npx wrangler pages deploy public --project-name shytalk-site-dev
# Restore prod config
git checkout public/admin/config.js
```

Then in Cloudflare Dashboard → Pages → `shytalk-site-dev` → Custom Domains → Add `dev.shytalk.shyden.co.uk`

**Step 5: Commit**

```bash
git add public/admin/config.js public/admin/config.dev.js public/admin/index.html
git commit -m "feat(env): externalize admin panel config for multi-env support"
```

---

### Task 5: Add Android Build Flavors

**Files:**
- Modify: `app/build.gradle.kts`
- Move: `app/google-services.json` → `app/src/prod/google-services.json`
- Create: `app/src/dev/google-services.json` (from Task 1)
- Create: `app/src/dev/res/values/strings.xml`

**Step 1: Move production google-services.json**

```bash
mkdir -p app/src/prod app/src/dev
git mv app/google-services.json app/src/prod/google-services.json
# dev/google-services.json should already exist from Task 1
```

**Step 2: Create dev strings overlay**

Create: `app/src/dev/res/values/strings.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">ShyTalk DEV</string>
</resources>
```

**Step 3: Add product flavors to build.gradle.kts**

Modify: `app/build.gradle.kts`

Add inside the `android { }` block, after `defaultConfig`:

```kotlin
flavorDimensions += "env"
productFlavors {
    create("dev") {
        dimension = "env"
        applicationIdSuffix = if (project.gradle.startParameter.taskNames.any {
            it.contains("Debug", ignoreCase = true)
        }) ".dev" else ""
        buildConfigField("String", "API_BASE_URL", "\"https://dev-api.shytalk.shyden.co.uk\"")
        buildConfigField("String", "WORKER_URL", "\"https://dev-api.shytalk.shyden.co.uk\"")
        buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "true")
    }
    create("prod") {
        dimension = "env"
        buildConfigField("String", "API_BASE_URL", "\"https://api.shytalk.shyden.co.uk\"")
        buildConfigField("String", "WORKER_URL", "\"https://api.shytalk.shyden.co.uk\"")
        buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "false")
    }
}
```

Remove the old env-var-based BuildConfig fields from `defaultConfig`:

```kotlin
// Remove these three from defaultConfig:
// buildConfigField("String", "LIVEKIT_SERVER_URL", ...)
// buildConfigField("String", "WORKER_URL", ...)
// buildConfigField("String", "API_BASE_URL", ...)
```

Add `LIVEKIT_SERVER_URL` to both flavors (shared value):

```kotlin
// In both flavors:
buildConfigField("String", "LIVEKIT_SERVER_URL", "\"${System.getenv("LIVEKIT_URL") ?: ""}\"")
```

Override `BYPASS_DEVICE_CHECKS` for debug builds:

```kotlin
buildTypes {
    debug {
        // Allow emulators in all debug builds
        buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "true")
    }
    // release keeps the flavor's value
}
```

> Note: The `applicationIdSuffix` approach above using `startParameter` is fragile. A cleaner approach is to set it only in debug buildType:

Actually, use this simpler approach instead:

```kotlin
flavorDimensions += "env"
productFlavors {
    create("dev") {
        dimension = "env"
        buildConfigField("String", "API_BASE_URL", "\"https://dev-api.shytalk.shyden.co.uk\"")
        buildConfigField("String", "WORKER_URL", "\"https://dev-api.shytalk.shyden.co.uk\"")
        buildConfigField("String", "LIVEKIT_SERVER_URL", "\"${System.getenv("LIVEKIT_URL") ?: ""}\"")
        buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "false")
    }
    create("prod") {
        dimension = "env"
        buildConfigField("String", "API_BASE_URL", "\"https://api.shytalk.shyden.co.uk\"")
        buildConfigField("String", "WORKER_URL", "\"https://api.shytalk.shyden.co.uk\"")
        buildConfigField("String", "LIVEKIT_SERVER_URL", "\"${System.getenv("LIVEKIT_URL") ?: ""}\"")
        buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "false")
    }
}
```

And in `buildTypes`:
```kotlin
buildTypes {
    debug {
        // All debug builds bypass device checks for emulator testing
        buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "true")
        applicationIdSuffix = ".dev"
    }
    release {
        isMinifyEnabled = true
        isShrinkResources = true
        proguardFiles(...)
        signingConfig = signingConfigs.getByName("release")
    }
}
```

This gives:
- `devDebug`: `com.shyden.shytalk.dev`, bypass=true
- `devRelease`: `com.shyden.shytalk`, bypass=false
- `prodDebug`: `com.shyden.shytalk.dev`, bypass=true
- `prodRelease`: `com.shyden.shytalk`, bypass=false

**Step 4: Update mergeAssets task matching**

The `afterEvaluate` block needs to match all flavor+buildType combinations:

```kotlin
afterEvaluate {
    tasks.matching { it.name.contains("mergeAssets", ignoreCase = true) }.configureEach {
        dependsOn(copyComposeResources)
    }
}
```

(Replace the existing `mergeDebugAssets` / `mergeReleaseAssets` matching.)

**Step 5: Build and verify**

```bash
./gradlew assembleDevDebug assembleProdDebug 2>&1 | tail -5
```

Expected: BUILD SUCCESSFUL

**Step 6: Commit**

```bash
git add app/build.gradle.kts app/src/prod/google-services.json app/src/dev/
git commit -m "feat(env): add dev/prod build flavors with environment-specific config"
```

---

### Task 6: Wire Device Check Bypass

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/AuthViewModel.kt`
- Modify: `app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt`

**Step 1: Pass bypass flag through DI**

In `AppKoinModule.kt`, add a named boolean:

```kotlin
single(named("bypassDeviceChecks")) { BuildConfig.BYPASS_DEVICE_CHECKS }
```

**Step 2: Use bypass flag in AuthViewModel**

In `AuthViewModel.kt`, inject the flag and skip device/ban checks when bypassed:

```kotlin
// In the device binding check (around line 75):
if (!bypassDeviceChecks) {
    // existing device binding check logic
}

// In the ban check (around line 155):
if (!bypassDeviceChecks) {
    // existing ban check logic
}
```

**Step 3: Build and run tests**

```bash
./gradlew testDevDebugUnitTest 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(env): wire BYPASS_DEVICE_CHECKS flag to skip device/ban checks"
```

---

### Task 7: Create Dev App Icon

**Files:**
- Create: `app/src/dev/res/drawable/ic_launcher_foreground.xml` (or use a modified version)
- Create: `app/src/dev/res/mipmap-anydpi/ic_launcher.xml`

**Step 1: Create a debug overlay icon**

The simplest approach: create a custom adaptive icon foreground for dev that adds a "DEV" banner.

Create: `app/src/dev/res/drawable/ic_dev_banner.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/ic_launcher_foreground" />
    <item android:gravity="top|end">
        <shape android:shape="rectangle">
            <solid android:color="#FFFF0000" />
            <size android:width="40dp" android:height="16dp" />
        </shape>
    </item>
</layer-list>
```

Create: `app/src/dev/res/mipmap-anydpi/ic_launcher.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_dev_banner" />
    <monochrome android:drawable="@drawable/ic_dev_banner" />
</adaptive-icon>
```

Copy also for `ic_launcher_round.xml` in the same directory.

**Step 2: Build and verify**

```bash
./gradlew assembleDevDebug
```

Install on device and verify the icon shows the DEV overlay.

**Step 3: Commit**

```bash
git add app/src/dev/res/
git commit -m "feat(env): add DEV icon overlay for dev flavor"
```

---

### Task 8: Create Test Helper API Endpoints

**Files:**
- Create: `express-api/src/routes/test-helpers.js`
- Modify: `express-api/src/index.js`
- Create: `express-api/src/cron/testDataCleanup.js`
- Modify: `express-api/src/cron/index.js`

**Step 1: Create test-helpers.js**

Create: `express-api/src/routes/test-helpers.js`

```javascript
/**
 * Test helper routes — available only in development.
 *
 * POST /api/test/setup       → Create test scenario, return testRunId + created IDs
 * GET  /api/test/verify/:col/:id → Read Firestore doc for assertion
 * POST /api/test/teardown     → Delete all data for a testRunId
 * POST /api/test/reset        → Wipe all test data, restore fixtures
 */

const router = require('express').Router();
const { db, FieldValue } = require('../utils/firebase');
const { generateId } = require('../utils/helpers');
const log = require('../utils/log');

const TEST_PREFIX = 'test_';

function requireTestApiKey(req, res) {
  const key = req.headers['x-test-api-key'];
  if (!key || key !== process.env.TEST_API_KEY) {
    res.status(403).json({ error: 'Invalid test API key' });
    return true;
  }
  return false;
}

// POST /api/test/setup
router.post('/test/setup', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const testRunId = `${TEST_PREFIX}${generateId()}`;
    const now = Date.now();
    const created = { testRunId, users: [], rooms: [], gifts: [], conversations: [] };

    const spec = req.body || {};

    // Create test users
    for (const userSpec of (spec.users || [])) {
      const uid = `${testRunId}_user_${generateId()}`;
      const userData = {
        uid,
        displayName: `[TEST] ${userSpec.name || 'User'}`,
        userType: userSpec.role || 'MEMBER',
        coins: userSpec.coins ?? 1000,
        beans: userSpec.beans ?? 0,
        gcs: 100,
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`users/${uid}`).set(userData);
      created.users.push(userData);
    }

    // Create test rooms
    for (const roomSpec of (spec.rooms || [])) {
      const roomId = `${testRunId}_room_${generateId()}`;
      const ownerId = roomSpec.ownerId || (created.users[0]?.uid ?? testRunId);
      const roomData = {
        id: roomId,
        name: `[TEST] ${roomSpec.name || 'Room'}`,
        ownerId,
        status: roomSpec.status || 'ACTIVE',
        createdAt: now,
        _testRun: testRunId,
      };
      await db.doc(`rooms/${roomId}`).set(roomData);
      created.rooms.push(roomData);
    }

    // Create test gifts
    for (const giftSpec of (spec.gifts || [])) {
      const giftId = `${testRunId}_gift_${generateId()}`;
      const giftData = {
        id: giftId,
        name: `[TEST] ${giftSpec.name || 'Gift'}`,
        coinValue: giftSpec.coinValue ?? 10,
        showInStore: giftSpec.showInStore ?? true,
        showOnWheel: giftSpec.showOnWheel ?? true,
        weight: 1.0,
        order: 0,
        animationUrl: '',
        soundUrl: '',
        iconUrl: '',
        _testRun: testRunId,
      };
      await db.doc(`gifts/${giftId}`).set(giftData);
      created.gifts.push(giftData);
    }

    log.info('test-helpers', 'Test setup complete', { testRunId, users: created.users.length, rooms: created.rooms.length });
    res.json(created);
  } catch (err) {
    log.error('test-helpers', 'Setup failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/test/verify/:collection/:id
router.get('/test/verify/:collection/:id', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const { collection, id } = req.params;
    const doc = await db.doc(`${collection}/${id}`).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/test/teardown
router.post('/test/teardown', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const { testRunId } = req.body;
    if (!testRunId || !testRunId.startsWith(TEST_PREFIX)) {
      return res.status(400).json({ error: 'Invalid testRunId' });
    }

    const deleted = await deleteTestData(testRunId);
    log.info('test-helpers', 'Teardown complete', { testRunId, deleted });
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('test-helpers', 'Teardown failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/test/reset — wipe ALL test data
router.post('/test/reset', async (req, res) => {
  try {
    if (requireTestApiKey(req, res)) return;

    const deleted = await deleteTestData(null); // null = delete all
    log.info('test-helpers', 'Full test reset complete', { deleted });
    res.json({ success: true, deleted });
  } catch (err) {
    log.error('test-helpers', 'Reset failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete test data. If testRunId is null, deletes ALL test data.
 */
async function deleteTestData(testRunId) {
  const collections = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];
  let totalDeleted = 0;

  for (const colName of collections) {
    let query = db.collection(colName).where('_testRun', '>=', TEST_PREFIX);
    if (testRunId) {
      query = db.collection(colName).where('_testRun', '==', testRunId);
    }

    const snap = await query.limit(500).get();
    if (snap.empty) continue;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    totalDeleted += snap.size;
  }

  return totalDeleted;
}

module.exports = router;
module.exports.deleteTestData = deleteTestData;
```

**Step 2: Mount only in dev**

Modify: `express-api/src/index.js`

After the existing route mounts (around line 86), add:

```javascript
// Test helper routes — dev environment only
if (process.env.NODE_ENV !== 'production') {
  app.use('/api', require('./routes/test-helpers'));
}
```

**Step 3: Create stale test data cleanup cron**

Create: `express-api/src/cron/testDataCleanup.js`

```javascript
/**
 * Cron: Clean up stale test data older than 1 hour.
 * Only runs in development environment.
 */

const { db } = require('../utils/firebase');
const log = require('../utils/log');

const TEST_PREFIX = 'test_';
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

async function testDataCleanup() {
  if (process.env.NODE_ENV === 'production') return;

  const cutoff = Date.now() - MAX_AGE_MS;
  const collections = ['users', 'rooms', 'gifts', 'conversations', 'banners', 'funFacts'];
  let totalDeleted = 0;

  for (const colName of collections) {
    const snap = await db.collection(colName)
      .where('_testRun', '>=', TEST_PREFIX)
      .where('createdAt', '<', cutoff)
      .limit(500)
      .get();

    if (snap.empty) continue;

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    totalDeleted += snap.size;
  }

  if (totalDeleted > 0) {
    log.info('cron', 'testDataCleanup: removed stale test data', { deleted: totalDeleted });
  }
}

module.exports = testDataCleanup;
```

**Step 4: Register cron**

Modify: `express-api/src/cron/index.js`

Add the test cleanup job (every 30 minutes, dev only):

```javascript
const testDataCleanup = require('./testDataCleanup');

// Inside startCronJobs():
if (process.env.NODE_ENV !== 'production') {
  cron.schedule('*/30 * * * *', testDataCleanup);
}
```

**Step 5: Commit**

```bash
git add express-api/src/routes/test-helpers.js express-api/src/cron/testDataCleanup.js express-api/src/index.js express-api/src/cron/index.js
git commit -m "feat(env): add test helper API endpoints and stale test data cleanup cron"
```

---

### Task 9: Create Dev Fixtures Script

**Files:**
- Create: `scripts/seed-dev-fixtures.mjs`

**Step 1: Create the script**

Create: `scripts/seed-dev-fixtures.mjs`

```javascript
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

  // Fun facts
  const funFacts = [
    { id: 'ff1', text: 'Honey never spoils.', category: 'science' },
    { id: 'ff2', text: 'Octopuses have three hearts.', category: 'animals' },
    { id: 'ff3', text: 'Bananas are berries, but strawberries are not.', category: 'food' },
  ];

  for (const f of funFacts) {
    await db.doc(`funFacts/${f.id}`).set({ ...f, createdAt: Date.now() }, { merge: true });
  }
  console.log(`  Created ${funFacts.length} fun facts`);

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
```

**Step 2: Commit**

```bash
git add scripts/seed-dev-fixtures.mjs
git commit -m "feat(env): add dev fixtures seeding script"
```

---

### Task 10: Create Android TestApiClient

**Files:**
- Create: `app/src/androidTest/java/com/shyden/shytalk/testing/TestApiClient.kt`

**Step 1: Create the test helper client**

```kotlin
package com.shyden.shytalk.testing

import com.shyden.shytalk.BuildConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement
import java.util.concurrent.TimeUnit

/**
 * JUnit TestRule that manages test data lifecycle via the dev API.
 *
 * Usage:
 * ```
 * @get:Rule val testApi = TestApiClient()
 *
 * @Test fun myTest() {
 *     val data = testApi.setup(users = listOf(TestUser("Alice", "MEMBER")))
 *     // ... run UI test using data.users[0].uid ...
 *     // teardown happens automatically in @After via the TestRule
 * }
 * ```
 */
class TestApiClient : TestRule {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val baseUrl = BuildConfig.API_BASE_URL
    private val testApiKey = "test-api-key-for-ci" // Match TEST_API_KEY in dev .env

    var testRunId: String? = null
        private set

    override fun apply(base: Statement, description: Description): Statement {
        return object : Statement() {
            override fun evaluate() {
                try {
                    base.evaluate()
                } finally {
                    teardown()
                }
            }
        }
    }

    data class TestUser(val name: String, val role: String = "MEMBER", val coins: Long = 1000)
    data class TestRoom(val name: String, val ownerId: String? = null)

    data class SetupResult(
        val testRunId: String,
        val users: List<JSONObject>,
        val rooms: List<JSONObject>
    )

    fun setup(
        users: List<TestUser> = emptyList(),
        rooms: List<TestRoom> = emptyList()
    ): SetupResult {
        val body = JSONObject().apply {
            put("users", JSONArray(users.map {
                JSONObject().put("name", it.name).put("role", it.role).put("coins", it.coins)
            }))
            put("rooms", JSONArray(rooms.map {
                JSONObject().put("name", it.name).apply {
                    if (it.ownerId != null) put("ownerId", it.ownerId)
                }
            }))
        }

        val response = post("/api/test/setup", body)
        testRunId = response.getString("testRunId")

        return SetupResult(
            testRunId = testRunId!!,
            users = response.getJSONArray("users").let { arr ->
                (0 until arr.length()).map { arr.getJSONObject(it) }
            },
            rooms = response.getJSONArray("rooms").let { arr ->
                (0 until arr.length()).map { arr.getJSONObject(it) }
            }
        )
    }

    fun verify(collection: String, id: String): JSONObject {
        return get("/api/test/verify/$collection/$id")
    }

    fun teardown() {
        val runId = testRunId ?: return
        try {
            post("/api/test/teardown", JSONObject().put("testRunId", runId))
        } catch (e: Exception) {
            // Log but don't fail — failsafe cron will clean up
            System.err.println("Test teardown failed: ${e.message}")
        }
        testRunId = null
    }

    private fun post(path: String, body: JSONObject): JSONObject {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .addHeader("X-Test-Api-Key", testApiKey)
            .build()

        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: "{}"
        if (!response.isSuccessful) {
            throw RuntimeException("Test API $path failed: ${response.code} $responseBody")
        }
        return JSONObject(responseBody)
    }

    private fun get(path: String): JSONObject {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .addHeader("X-Test-Api-Key", testApiKey)
            .build()

        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: "{}"
        if (!response.isSuccessful) {
            throw RuntimeException("Test API $path failed: ${response.code} $responseBody")
        }
        return JSONObject(responseBody)
    }
}
```

**Step 2: Commit**

```bash
git add app/src/androidTest/java/com/shyden/shytalk/testing/TestApiClient.kt
git commit -m "feat(env): add TestApiClient JUnit rule for E2E test data management"
```

---

### Task 11: Set Up Playwright for Web Testing

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/web/admin-panel.spec.ts`
- Create: `tests/web/landing-page.spec.ts`
- Modify: `package.json` (root or create one)

**Step 1: Initialize Playwright**

```bash
npm init -y
npm install -D @playwright/test
npx playwright install chromium
```

**Step 2: Create Playwright config**

Create: `playwright.config.ts`

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web',
  timeout: 30_000,
  retries: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
  ],
  use: {
    baseURL: process.env.WEB_BASE_URL || 'https://dev.shytalk.shyden.co.uk',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
```

**Step 3: Create landing page test**

Create: `tests/web/landing-page.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('loads and displays app name', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ShyTalk/i);
  });

  test('has download link', async ({ page }) => {
    await page.goto('/');
    const playStoreLink = page.locator('a[href*="play.google.com"]');
    await expect(playStoreLink).toBeVisible();
  });
});
```

**Step 4: Create admin panel smoke test**

Create: `tests/web/admin-panel.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Admin Panel', () => {
  test('loads login page', async ({ page }) => {
    await page.goto('/admin/');
    await expect(page.locator('text=Sign in')).toBeVisible();
  });

  test('shows correct API endpoint', async ({ page }) => {
    await page.goto('/admin/');
    // Verify the config loaded correctly
    const apiBase = await page.evaluate(() => (window as any).SHYTALK_CONFIG?.API_BASE);
    expect(apiBase).toBeTruthy();
    expect(apiBase).toContain('shytalk.shyden.co.uk');
  });
});
```

**Step 5: Commit**

```bash
git add playwright.config.ts tests/web/ package.json package-lock.json
git commit -m "feat(env): add Playwright web testing setup with landing page and admin smoke tests"
```

---

### Task 12: Create GitHub Actions Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Remove: `.github/workflows/android-tests.yml` (replaced by release.yml)

**Step 1: Create the unified release workflow**

Create: `.github/workflows/release.yml`

```yaml
name: Release Pipeline

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]

concurrency:
  group: release-pipeline
  cancel-in-progress: false

jobs:
  # ──────────────────────────────────────────────
  # Stage 1: Build, Test & Deploy to Dev
  # ──────────────────────────────────────────────

  build-and-test:
    name: Build & Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Build devDebug + devRelease
        run: ./gradlew assembleDevDebug assembleDevRelease

      - name: Run unit tests
        run: ./gradlew testDevDebugUnitTest

      - name: Publish unit test report
        uses: dorny/test-reporter@v1
        if: always()
        with:
          name: Unit Tests
          path: '**/build/test-results/**/TEST-*.xml'
          reporter: java-junit

      - name: Upload devRelease AAB
        uses: actions/upload-artifact@v4
        with:
          name: dev-release-aab
          path: app/build/outputs/bundle/devRelease/*.aab

      - name: Upload devDebug APK
        uses: actions/upload-artifact@v4
        with:
          name: dev-debug-apk
          path: app/build/outputs/apk/dev/debug/*.apk

  e2e-tests:
    name: E2E Tests (Android)
    runs-on: ubuntu-latest
    needs: build-and-test
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Enable KVM (for Android emulator)
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm

      - name: Run E2E tests on managed device
        run: ./gradlew pixel4aDevDebugAndroidTest

      - name: Publish E2E test report
        uses: dorny/test-reporter@v1
        if: always()
        with:
          name: E2E Tests
          path: '**/build/outputs/androidTest-results/**/TEST-*.xml'
          reporter: java-junit

  web-tests:
    name: Web Tests (Playwright)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Playwright
        run: |
          npm ci
          npx playwright install --with-deps chromium

      - name: Run Playwright tests
        run: npx playwright test
        env:
          WEB_BASE_URL: https://dev.shytalk.shyden.co.uk

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/

      - name: Publish Playwright results
        uses: dorny/test-reporter@v1
        if: always()
        with:
          name: Web Tests
          path: playwright-results.xml
          reporter: java-junit

  deploy-dev:
    name: Deploy to Dev
    runs-on: ubuntu-latest
    needs: [build-and-test, e2e-tests, web-tests]
    steps:
      - uses: actions/checkout@v4

      - name: Download devRelease AAB
        uses: actions/download-artifact@v4
        with:
          name: dev-release-aab
          path: ./aab/

      - name: Deploy Express API to London (dev)
        env:
          SSH_KEY: ${{ secrets.LONDON_SSH_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan 145.241.224.13 >> ~/.ssh/known_hosts

          cd express-api
          tar czf /tmp/api.tar.gz --exclude='node_modules' --exclude='.env' .
          scp /tmp/api.tar.gz ubuntu@145.241.224.13:/tmp/
          ssh ubuntu@145.241.224.13 "cd ~/shytalk-api && tar xzf /tmp/api.tar.gz && npm install --production && pm2 restart shytalk-api"

      - name: Verify dev API health
        run: |
          sleep 5
          curl -sf https://dev-api.shytalk.shyden.co.uk/api/health

      - name: Upload to Play Store internal track
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.shyden.shytalk
          releaseFiles: ./aab/*.aab
          track: internal
          status: completed

      - name: Deploy web to dev site
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          cp public/admin/config.dev.js public/admin/config.js
          npx wrangler pages deploy public --project-name shytalk-site-dev

  # ──────────────────────────────────────────────
  # Stage 2: Production Release (after approval)
  # ──────────────────────────────────────────────

  approve-production:
    name: Approve Production Release
    runs-on: ubuntu-latest
    needs: deploy-dev
    environment: production  # Requires manual approval in GitHub settings
    steps:
      - run: echo "Production release approved"

  deploy-prod:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: approve-production
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Rebase onto main
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git fetch origin main
          git rebase origin/main

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Build prodRelease
        run: ./gradlew assembleProdRelease bundleProdRelease

      - name: Run prod smoke tests
        run: ./gradlew testProdReleaseUnitTest

      - name: Archive previous API version
        env:
          SSH_KEY: ${{ secrets.SINGAPORE_SSH_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan 213.35.98.160 >> ~/.ssh/known_hosts
          ssh ubuntu@213.35.98.160 "cd ~/shytalk-api && tar czf /tmp/api-previous.tar.gz --exclude='node_modules' --exclude='.env' ."

      - name: Deploy Express API to Singapore (prod)
        env:
          SSH_KEY: ${{ secrets.SINGAPORE_SSH_KEY }}
        run: |
          cd express-api
          tar czf /tmp/api.tar.gz --exclude='node_modules' --exclude='.env' .
          scp /tmp/api.tar.gz ubuntu@213.35.98.160:/tmp/
          ssh ubuntu@213.35.98.160 "cd ~/shytalk-api && tar xzf /tmp/api.tar.gz && npm install --production && pm2 restart shytalk-api"

      - name: Verify prod API health
        run: |
          sleep 5
          curl -sf https://api.shytalk.shyden.co.uk/api/health

      - name: Upload to Play Store production track
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.shyden.shytalk
          releaseFiles: app/build/outputs/bundle/prodRelease/*.aab
          track: production
          status: draft

      - name: Deploy web to prod site
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          npx wrangler pages deploy public --project-name shytalk-site

      - name: Auto-merge PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh pr merge ${{ github.event.pull_request.number }} --merge --auto

  # ──────────────────────────────────────────────
  # Rollback & Alert (if auto-merge fails)
  # ──────────────────────────────────────────────

  alert-desync:
    name: Alert - Prod/Main Desync
    runs-on: ubuntu-latest
    needs: deploy-prod
    if: failure()
    steps:
      - uses: actions/checkout@v4

      - name: Create critical issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh issue create \
            --title "CRITICAL: Production deployed but main not updated" \
            --label "critical,prod-desync" \
            --assignee "${{ github.event.pull_request.user.login }}" \
            --body "$(cat <<'ISSUE_EOF'
          ## Production/Main Desync Alert

          **PR:** #${{ github.event.pull_request.number }}
          **Branch:** ${{ github.head_ref }}
          **Deployed SHA:** ${{ github.event.pull_request.head.sha }}
          **Deployed by:** ${{ github.actor }}

          ### What happened
          Production was deployed successfully but the auto-merge to main failed.
          This means `main` does not match what is live in production.

          ### Immediate action required
          1. Check the PR for merge conflicts
          2. Resolve conflicts and merge manually
          3. Verify `main` matches the deployed SHA
          4. Close this issue once resolved

          ### Components deployed
          - Express API (Singapore)
          - Play Store production track
          - Web (shytalk.shyden.co.uk)
          ISSUE_EOF
          )"

      - name: Comment on PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh pr comment ${{ github.event.pull_request.number }} \
            --body "## ⛔ CRITICAL: Production deployed but auto-merge failed. Main branch does not match production. See the created issue for resolution steps."
```

**Step 2: Set up GitHub repository secrets**

In GitHub → Settings → Secrets and variables → Actions, add:
- `LONDON_SSH_KEY` — private key for London server
- `SINGAPORE_SSH_KEY` — private key for Singapore server
- `PLAY_SERVICE_ACCOUNT_JSON` — Google Play service account JSON content
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Pages deploy permissions

**Step 3: Set up GitHub environment**

In GitHub → Settings → Environments → New environment:
- Name: `production`
- Required reviewers: add yourself (or team members who can approve releases)

**Step 4: Remove old workflow**

```bash
git rm .github/workflows/android-tests.yml
```

**Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): add unified release pipeline with gated prod deployment"
```

---

### Task 13: Update MEMORY.md

**Step 1: Update memory with new environment information**

Add to `MEMORY.md`:

```markdown
## Environments (Dev + Prod)
- **Dev Firebase:** `shytalk-dev` (europe-west2 Firestore, europe-west1 RTDB)
- **Prod Firebase:** `shytalk-7ba69` (asia-southeast1)
- **Dev API:** `dev-api.shytalk.shyden.co.uk` → London (145.241.224.13)
- **Prod API:** `api.shytalk.shyden.co.uk` → Singapore (213.35.98.160)
- **Dev R2:** `shytalk-media-dev` (WEUR), CDN: `dev-images.shytalk.shyden.co.uk`
- **Dev Web:** `dev.shytalk.shyden.co.uk` (Cloudflare Pages `shytalk-site-dev`)
- **Build flavors:** `dev` and `prod` in `app/build.gradle.kts`
- **google-services.json:** `app/src/dev/` and `app/src/prod/`
- **CI/CD:** Single `release.yml` workflow: PR → build+test → deploy dev → approval gate → deploy prod
- **Test helpers:** `POST /api/test/setup|teardown|verify|reset` (dev only, requires `X-Test-Api-Key` header)
- **Dev fixtures:** `scripts/seed-dev-fixtures.mjs` (run against dev Firebase only)
```

**Step 2: Commit**

```bash
git add -A
git commit -m "docs: update MEMORY.md with environment setup details"
```

---

### Task 14: Final Verification

**Step 1: Build all variants**

```bash
./gradlew assembleDevDebug assembleDevRelease assembleProdDebug assembleProdRelease
```

All four should build successfully.

**Step 2: Run all unit tests**

```bash
./gradlew testDevDebugUnitTest testProdDebugUnitTest
```

All should pass.

**Step 3: Verify dev API**

```bash
curl https://dev-api.shytalk.shyden.co.uk/api/health
```

**Step 4: Verify dev web**

```bash
curl -s https://dev.shytalk.shyden.co.uk/admin/config.js | head -5
```

Should show the dev config.

**Step 5: Run Playwright tests locally**

```bash
npx playwright test
```

**Step 6: Seed dev fixtures**

```bash
GOOGLE_APPLICATION_CREDENTIALS=./shytalk-dev-firebase-adminsdk.json node scripts/seed-dev-fixtures.mjs
```

**Step 7: Install dev app on device**

```bash
./gradlew installDevDebug
```

Verify: "ShyTalk DEV" appears with debug icon, connects to dev API.

**Step 8: Final commit and push**

```bash
git push origin main
```
