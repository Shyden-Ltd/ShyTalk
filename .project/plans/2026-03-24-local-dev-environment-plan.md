# Local Development Environment — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cloud Firebase and LiveKit with local emulators for zero-cost, zero-quota development and testing.

**Architecture:** Firebase Emulator Suite (Firestore, Auth, RTDB) via `npx firebase emulators:start`. LiveKit via Docker container. New `local` Android build flavor. Wrapper scripts to start/stop everything. Seed script for initial data.

**Tech Stack:** Firebase CLI + Emulators (Java 11+), Docker, Node.js, Kotlin, Gradle

**Spec:** `.project/plans/2026-03-24-local-dev-environment-design.md`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `local/docker-compose.yml` | Create | LiveKit container |
| `local/livekit.yaml` | Create | LiveKit server config |
| `local/seed.js` | Create | Seed Firebase emulators with initial data |
| `local/start.sh` | Create | Start all local services |
| `local/stop.sh` | Create | Stop all local services |
| `firebase.json` | Modify | Add emulators block |
| `express-api/src/utils/firebase.js` | Modify | Detect local mode, connect to emulators |
| `express-api/src/utils/fcm.js` | Modify | Skip FCM in local mode |
| `express-api/package.json` | Modify | Add "local" npm script |
| `express-api/.env.example` | Modify | Document local env vars |
| `.gitignore` | Modify | Ignore emulator data and .env.local |
| `app/build.gradle.kts` | Modify | Add `local` flavor + asset merge tasks |
| `app/src/local/google-services.json` | Create | Placeholder for emulators |
| `app/src/local/res/xml/network_security_config.xml` | Create | Permit cleartext HTTP to localhost |
| `app/src/local/AndroidManifest.xml` | Create | Reference network security config |
| `app/src/main/java/.../core/di/AppKoinModule.kt` | Modify | Add useEmulator() calls for local flavor |
| `express-api/tests/utils/firebase-local.test.js` | Create | Tests for local mode detection and FCM guard |
| `express-api/.env.local.example` | Create | Template for local development env vars |
| `.github/workflows/e2e-tests.yml` | Modify | Start Firebase emulators before E2E tests |

---

## Chunk 1: Firebase Emulator Config

### Task 1: Update firebase.json with emulator ports

**Files:**
- Modify: `firebase.json`

- [ ] **Step 1: Add emulators block**

Read `firebase.json`. Add the `emulators` block after the existing `database` section:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "database": {
    "rules": "database.rules.json"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "database": { "port": 9000 },
    "ui": { "port": 4000, "enabled": true }
  }
}
```

- [ ] **Step 2: Verify emulators start**

```bash
npx firebase emulators:start --project=demo-shytalk
```

Expected: Emulator UI at http://localhost:4000, Firestore at 8080, Auth at 9099, RTDB at 9000. Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
git add firebase.json
git commit -m "chore: add Firebase emulator config to firebase.json"
```

---

### Task 2: Update Express API to detect local mode

**Files:**
- Modify: `express-api/src/utils/firebase.js` (insert after line 12, before line 14)
- Modify: `express-api/src/utils/fcm.js` (add local mode guard in `sendFcmToTokens()` and `cleanupInvalidTokens()`)
- Modify: `express-api/package.json` (add script at line 9)
- Modify: `express-api/.env.example` (add local dev section after the Firebase block)

- [ ] **Step 1: Write failing test for local mode detection**

Create `express-api/tests/utils/firebase-local.test.js`:

```javascript
describe('firebase.js local mode', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  });

  test('sets emulator env vars when NODE_ENV is local', () => {
    // This test validates the env var setting logic
    // extracted from firebase.js for testability
    const { configureLocalEmulators } = require('../../src/utils/firebase');

    process.env.NODE_ENV = 'local';
    configureLocalEmulators();

    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('localhost:8080');
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('localhost:9099');
    expect(process.env.FIREBASE_DATABASE_EMULATOR_HOST).toBe('localhost:9000');
  });

  test('does not set emulator env vars in production', () => {
    const { configureLocalEmulators } = require('../../src/utils/firebase');

    process.env.NODE_ENV = 'production';
    configureLocalEmulators();

    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeUndefined();
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBeUndefined();
    expect(process.env.FIREBASE_DATABASE_EMULATOR_HOST).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd express-api && npx jest --testPathPatterns="firebase-local" --verbose
```

Expected: FAIL — `configureLocalEmulators` not found.

- [ ] **Step 3: Implement local mode detection in firebase.js**

In `express-api/src/utils/firebase.js`, after the `serviceAccountPath` assignment (after line 12), add:

```javascript
function configureLocalEmulators() {
  if (process.env.NODE_ENV === 'local') {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9000';
  }
}

// Configure emulators before any Firebase calls
configureLocalEmulators();
```

Also update the `admin.initializeApp()` block to handle local mode (no service account needed):

```javascript
if (!admin.apps.length) {
  if (process.env.NODE_ENV === 'local') {
    // Emulators don't need a service account or database URL
    admin.initializeApp({ projectId: 'demo-shytalk' });
  } else {
    if (!process.env.FIREBASE_DATABASE_URL) {
      // eslint-disable-next-line no-console
      console.error(
        'FIREBASE_DATABASE_URL env var is required (RTDB region differs between dev and prod)',
      );
      process.exit(1);
    }
    const initOptions = {
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    };

    if (serviceAccountPath) {
      const serviceAccount = require(serviceAccountPath);
      initOptions.credential = admin.credential.cert(serviceAccount);
    }

    admin.initializeApp(initOptions);
  }
}
```

Export `configureLocalEmulators` for testing:
```javascript
module.exports = { admin, db, auth, rtdb, messaging, FieldValue, configureLocalEmulators };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest --testPathPatterns="firebase-local" --verbose
```

Expected: PASS

- [ ] **Step 5: Add FCM local mode guard**

In `express-api/src/utils/fcm.js`, inside `sendFcmToTokens()` — add immediately after the `if (!tokens || tokens.length === 0) return [];` early-return:

```javascript
if (process.env.NODE_ENV === 'local') {
  console.log('[FCM-LOCAL] Would send to', tokens.length, 'tokens:', data?.title);
  return;
}
```

Inside `cleanupInvalidTokens()` — add immediately after the existing `if (!invalidTokens || ...) return;` early-return:

```javascript
if (process.env.NODE_ENV === 'local') return;
```

- [ ] **Step 6: Write tests for FCM local mode guard**

Add to `express-api/tests/utils/firebase-local.test.js`:

```javascript
describe('fcm.js local mode', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.resetModules();
  });

  test('sendFcmToTokens returns early in local mode', async () => {
    process.env.NODE_ENV = 'local';
    jest.resetModules();
    const { sendFcmToTokens } = require('../../src/utils/fcm');
    const result = await sendFcmToTokens(['token1'], { title: 'Test' });
    expect(result).toBeUndefined();
  });

  test('cleanupInvalidTokens returns early in local mode', async () => {
    process.env.NODE_ENV = 'local';
    jest.resetModules();
    const { cleanupInvalidTokens } = require('../../src/utils/fcm');
    // Should not throw or call Firestore
    await expect(cleanupInvalidTokens(['token1'], '100000001')).resolves.toBeUndefined();
  });
});
```

Run: `npx jest --testPathPatterns="firebase-local" --verbose` — Expected: PASS

- [ ] **Step 7: Add "local" npm script**

In `express-api/package.json`, add to the scripts section (after the "dev" script):

```json
"local": "node --env-file=.env.local src/index.js",
```

- [ ] **Step 8: Update .env.example with local mode docs**

In `express-api/.env.example`, after line 17 (the `# FIREBASE_PROJECT_ID=shytalk-dev` line), add:

```
# ── Local Development (Firebase Emulators) ──────────────
# Set NODE_ENV=local to use Firebase Emulators instead of cloud.
# Copy this file to .env.local and set NODE_ENV=local.
# No service account needed — emulators don't require auth.
# Start emulators first: bash local/start.sh
```

- [ ] **Step 9: Run full test suite**

```bash
npm test
```

Expected: ALL PASS (existing tests use mocks, not affected by local mode)

- [ ] **Step 10: Commit**

```bash
git add express-api/src/utils/firebase.js express-api/src/utils/fcm.js \
       express-api/package.json express-api/.env.example \
       express-api/tests/utils/firebase-local.test.js
git commit -m "feat: add local mode detection for Firebase emulators and LiveKit"
```

---

## Chunk 2: LiveKit Docker + Wrapper Scripts

### Task 3: Create LiveKit Docker config

**Files:**
- Create: `local/docker-compose.yml`
- Create: `local/livekit.yaml`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882"
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    command: --config /etc/livekit.yaml
```

- [ ] **Step 2: Create livekit.yaml**

```yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: false
keys:
  devkey: devsecret
logging:
  level: info
```

- [ ] **Step 3: Verify LiveKit starts**

```bash
docker compose -f local/docker-compose.yml up -d
curl -s http://localhost:7880
docker compose -f local/docker-compose.yml down
```

Expected: Container starts, port 7880 responds.

- [ ] **Step 4: Commit**

```bash
git add local/docker-compose.yml local/livekit.yaml
git commit -m "chore: add LiveKit Docker config for local development"
```

---

### Task 4: Create wrapper scripts

**Files:**
- Create: `local/start.sh`
- Create: `local/stop.sh`
- Modify: `.gitignore`

- [ ] **Step 1: Create start.sh**

```bash
#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Starting LiveKit..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo "Starting Firebase Emulators..."
cd "$PROJECT_ROOT"
npx firebase emulators:start \
  --project=demo-shytalk \
  --import=local/firebase-emulator-data \
  --export-on-exit=local/firebase-emulator-data &
FIREBASE_PID=$!

# Wait for emulators to be ready
echo "Waiting for emulators..."
until curl -s http://localhost:4000 > /dev/null 2>&1; do sleep 1; done
echo "Emulators ready."

# Seed data on first run
if [ ! -d "local/firebase-emulator-data/firestore_export" ]; then
  echo "First run - seeding data..."
  node local/seed.js
fi

echo ""
echo "Local environment ready:"
echo "  Firebase UI:  http://localhost:4000"
echo "  Firestore:    localhost:8080"
echo "  Auth:         localhost:9099"
echo "  RTDB:         localhost:9000"
echo "  LiveKit:      localhost:7880"
echo ""
echo "Start the API:  cd express-api && npm run local"
echo "Build Android:  ./gradlew installLocalDebug"
echo ""

# Keep running until Ctrl+C — clean shutdown exports emulator data
trap "echo 'Shutting down...'; kill $FIREBASE_PID 2>/dev/null; wait $FIREBASE_PID 2>/dev/null; docker compose -f $SCRIPT_DIR/docker-compose.yml down; exit 0" INT TERM
wait $FIREBASE_PID
```

- [ ] **Step 2: Create stop.sh**

```bash
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true
pkill -f "firebase emulators" 2>/dev/null || true
pkill -f "express-api/src/index.js" 2>/dev/null || true
echo "Local environment stopped."
```

- [ ] **Step 3: Make scripts executable**

```bash
chmod +x local/start.sh local/stop.sh
```

- [ ] **Step 4: Update .gitignore**

Add after the existing `.env` line:

```
# Local development
local/firebase-emulator-data/
express-api/.env.local
```

- [ ] **Step 5: Commit**

```bash
git add local/start.sh local/stop.sh .gitignore
git commit -m "chore: add local environment start/stop scripts"
```

---

## Chunk 3: Seed Script

### Task 5: Create seed data script

**Files:**
- Create: `local/seed.js`

- [ ] **Step 1: Create seed.js**

```javascript
/**
 * Seed Firebase Emulators with initial data.
 * Run: node local/seed.js
 *
 * Idempotent — checks if data exists before creating.
 * Uses Firebase Admin SDK pointed at emulators via env vars.
 */

const admin = require('firebase-admin');

// Point at emulators
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.FIREBASE_DATABASE_EMULATOR_HOST =
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || 'localhost:9000';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'demo-shytalk' });
}

const db = admin.firestore();
const auth = admin.auth();

async function seedIfMissing(path, data) {
  const doc = await db.doc(path).get();
  if (!doc.exists) {
    await db.doc(path).set(data);
    console.log(`  Created: ${path}`);
  } else {
    console.log(`  Exists:  ${path}`);
  }
}

async function seedAuthUser(email, password, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    console.log(`  Exists:  Auth user ${email}`);
    return existing.uid;
  } catch (_err) {
    const created = await auth.createUser({ email, password, displayName, emailVerified: true });
    console.log(`  Created: Auth user ${email}`);
    return created.uid;
  }
}

async function seed() {
  // Verify emulator is running before seeding (prevents accidental writes to cloud Firestore)
  try {
    await fetch('http://localhost:8080');
  } catch {
    console.error('Firestore emulator not running at localhost:8080. Start with: bash local/start.sh');
    process.exit(1);
  }

  const now = Date.now();
  console.log('Seeding Firebase Emulators...\n');

  // Config documents
  console.log('Config:');
  await seedIfMissing('config/economy', {
    dailyBonus: 50,
    spinCost: 10,
    pullCosts: { 1: 10, 10: 80, 100: 700 },
    milestoneRewards: { 7: 100, 14: 250, 30: 500 },
  });
  await seedIfMissing('config/app', {
    minVersionCode: 1,
    latestVersionCode: 1,
    latestVersionName: '1.0.0',
    accountDeletionGracePeriodDays: 30,
    inactiveAccountDeleteMonths: 0,
  });
  await seedIfMissing('config/startingScreens', {});
  await seedIfMissing('config/moderation', {
    autoModEnabled: false,
    gcsThreshold: 50,
  });
  await seedIfMissing('alertConfig/settings', {
    errorRateThreshold: 10,
    slowResponseThreshold: 5000,
    alertCooldownMs: 300000,
  });
  await seedIfMissing('logConfig/settings', {
    retentionHours: 48,
    archiveRetentionDays: 90,
  });

  // Counter
  console.log('\nCounter:');
  await seedIfMissing('counters/uniqueId', { value: 100000000 });

  // Admin user
  console.log('\nAdmin user:');
  const adminFirebaseUid = await seedAuthUser('claude-test@shytalk.dev', 'localdev123', 'Local Admin');
  await seedIfMissing('users/100000001', {
    uid: 'claude-test@shytalk.dev',
    firebaseUid: adminFirebaseUid,
    uniqueId: 100000001,
    displayName: 'Local Admin',
    userType: 'ADMIN',
    shyCoins: 10000,
    shyBeans: 0,
    gcsScore: 100,
    warningCount: 0,
    hasActiveWarning: false,
    luckScore: 0,
    pityCounter: 0,
    loginStreak: 0,
    isSuspended: false,
    blockedUserIds: [],
    followingIds: [],
    followerIds: [],
    createdAt: now,
  });
  await seedIfMissing('identityMap/email:claude-test@shytalk.dev', {
    uniqueId: 100000001,
    provider: 'email',
    identifier: 'claude-test@shytalk.dev',
    linkedAt: now,
    unlinked: false,
    unlinkedAt: null,
  });

  // Regular user
  console.log('\nRegular user:');
  const userFirebaseUid = await seedAuthUser('user@test.com', 'localdev123', 'Test User');
  await seedIfMissing('users/100000002', {
    uid: 'user@test.com',
    firebaseUid: userFirebaseUid,
    uniqueId: 100000002,
    displayName: 'Test User',
    userType: 'MEMBER',
    shyCoins: 500,
    shyBeans: 0,
    gcsScore: 100,
    warningCount: 0,
    hasActiveWarning: false,
    luckScore: 0,
    pityCounter: 0,
    loginStreak: 0,
    isSuspended: false,
    blockedUserIds: [],
    followingIds: [],
    followerIds: [],
    createdAt: now,
  });
  await seedIfMissing('identityMap/email:user@test.com', {
    uniqueId: 100000002,
    provider: 'email',
    identifier: 'user@test.com',
    linkedAt: now,
    unlinked: false,
    unlinkedAt: null,
  });

  // Update counter to reflect seeded users
  await db.doc('counters/uniqueId').set({ value: 100000002 });

  // Sample gifts
  console.log('\nSample content:');
  await seedIfMissing('gifts/local-gift-1', {
    name: 'Heart',
    coinValue: 10,
    showInStore: true,
    showOnWheel: true,
    weight: 1.0,
    order: 0,
    animationUrl: '',
    soundUrl: '',
    iconUrl: '',
  });
  await seedIfMissing('gifts/local-gift-2', {
    name: 'Star',
    coinValue: 50,
    showInStore: true,
    showOnWheel: true,
    weight: 0.5,
    order: 1,
    animationUrl: '',
    soundUrl: '',
    iconUrl: '',
  });
  await seedIfMissing('gifts/local-gift-3', {
    name: 'Diamond',
    coinValue: 200,
    showInStore: true,
    showOnWheel: false,
    weight: 0.1,
    order: 2,
    animationUrl: '',
    soundUrl: '',
    iconUrl: '',
  });

  // Coin package
  await seedIfMissing('coinPackages/local-pack-1', {
    coins: 100,
    bonusCoins: 0,
    productId: 'local_100_coins',
    isActive: true,
    order: 0,
  });

  // Fun fact
  await seedIfMissing('funFacts/local-fact-1', {
    text: 'ShyTalk was built with Kotlin Multiplatform!',
    isActive: true,
  });

  console.log('\nSeed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Test seed script against running emulators**

```bash
# Start emulators in background
npx firebase emulators:start --project=demo-shytalk &
sleep 10

# Run seed
node local/seed.js

# Verify in Emulator UI: http://localhost:4000
# Check Firestore has users, gifts, config docs
# Check Auth has 2 users

# Stop emulators
pkill -f "firebase emulators"
```

Expected: All docs created, emulator UI shows data.

- [ ] **Step 3: Run seed again (idempotency test)**

```bash
npx firebase emulators:start --project=demo-shytalk --import=local/firebase-emulator-data &
sleep 10
node local/seed.js
pkill -f "firebase emulators"
```

Expected: All items show "Exists:" not "Created:" — no duplicates.

- [ ] **Step 4: Commit**

```bash
git add local/seed.js
git commit -m "feat: add seed script for Firebase emulators"
```

---

## Chunk 4: Android Local Build Flavor

### Task 6: Add local build flavor to Gradle

**Files:**
- Modify: `app/build.gradle.kts` (productFlavors at line 36, afterEvaluate at line 181)
- Create: `app/src/local/google-services.json`
- Create: `app/src/local/res/xml/network_security_config.xml`
- Create: `app/src/local/AndroidManifest.xml`

- [ ] **Step 1: Add local flavor to build.gradle.kts**

In `app/build.gradle.kts`, inside the `productFlavors` block (after the `prod` flavor, around line 55), add:

```kotlin
create("local") {
    dimension = "env" // matches existing "env" dimension used by dev/prod flavors
    applicationIdSuffix = ".local"
    buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3000\"")
    buildConfigField("String", "WORKER_URL", "\"http://10.0.2.2:3000\"")
    buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://10.0.2.2:7880\"")
    buildConfigField("String", "RTDB_URL", "\"http://10.0.2.2:9000\"")
    buildConfigField("String", "EMAIL_LINK_DOMAIN", "\"localhost\"")
    buildConfigField("String", "WEB_CLIENT_ID", "\"placeholder-local\"")
    buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "true")
}
```

- [ ] **Step 2: Update afterEvaluate asset merge task list**

In `app/build.gradle.kts` at line 181, add `"mergeLocalDebugAssets"` and `"mergeLocalReleaseAssets"` to the list:

```kotlin
listOf(
    "mergeDevDebugAssets", "mergeDevReleaseAssets",
    "mergeProdDebugAssets", "mergeProdReleaseAssets",
    "mergeLocalDebugAssets", "mergeLocalReleaseAssets",
)
```

- [ ] **Step 3: Create placeholder google-services.json**

Create `app/src/local/google-services.json`:

```json
{
  "project_info": {
    "project_number": "0",
    "project_id": "demo-shytalk"
  },
  "client": [
    {
      "client_info": {
        "mobilesdk_app_id": "1:0:android:0",
        "android_client_info": {
          "package_name": "com.shyden.shytalk"
        }
      },
      "api_key": [{ "current_key": "placeholder" }]
    },
    {
      "client_info": {
        "mobilesdk_app_id": "1:0:android:0",
        "android_client_info": {
          "package_name": "com.shyden.shytalk.local"
        }
      },
      "api_key": [{ "current_key": "placeholder" }]
    }
  ]
}
```

- [ ] **Step 4: Create network security config for cleartext HTTP**

Create `app/src/local/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
```

- [ ] **Step 5: Create flavor-specific AndroidManifest.xml**

Create `app/src/local/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:networkSecurityConfig="@xml/network_security_config" />
</manifest>
```

- [ ] **Step 6: Verify build compiles**

```bash
./gradlew assembleLocalDebug
```

Expected: BUILD SUCCESSFUL

- [ ] **Step 7: Commit**

> **Note:** `google-services.json` matches the `.gitignore` pattern, so it must be force-added.

```bash
git add -f app/src/local/google-services.json
git add app/build.gradle.kts app/src/local/
git commit -m "feat: add local Android build flavor for emulator development"
```

---

### Task 7: Add Firebase emulator connection in Koin module

**Files:**
- Modify: `app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt` (lines 104-106)

- [ ] **Step 1: Add useEmulator calls for local flavor**

In `AppKoinModule.kt`, after the Firebase singleton declarations (around line 106), add:

```kotlin
// Connect to Firebase Emulators for local development
if (BuildConfig.FLAVOR == "local") {
    Firebase.firestore.useEmulator("10.0.2.2", 8080)
    Firebase.auth.useEmulator("10.0.2.2", 9099)
    Firebase.database.useEmulator("10.0.2.2", 9000)
}
```

Add required imports if not present:
```kotlin
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.google.firebase.firestore.firestore
import com.google.firebase.database.database
```

- [ ] **Step 2: Verify build compiles**

```bash
./gradlew assembleLocalDebug
```

Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Run unit tests**

```bash
./gradlew testLocalDebugUnitTest
```

Expected: BUILD SUCCESSFUL (unit tests use mocks, not affected)

- [ ] **Step 4: Commit**

```bash
git add app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt
git commit -m "feat: connect Android to Firebase emulators in local flavor"
```

---

## Chunk 5: .env.local Template + End-to-End Test

### Task 8: Create .env.local template and verify full stack

**Files:**
- Create: `express-api/.env.local.example` (committed, not gitignored — template for developers)

- [ ] **Step 1: Create .env.local.example**

```
# Local Development Environment
# Copy to .env.local and fill in R2/SMTP values from your .env
#
# Start emulators first: bash local/start.sh
# Then start API: npm run local

NODE_ENV=local
PORT=3000

# Firebase (emulators — no real credentials needed)
FIREBASE_DATABASE_URL=http://localhost:9000

# LiveKit (local Docker container)
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
LIVEKIT_HOST=http://localhost:7880
# Note: Verify LIVEKIT_HOST is read by the Express API codebase.
# If not, this variable may need a different name or be added to the livekit route.

# R2 Storage (still uses cloud — free tier)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
CDN_URL=

# SMTP (still uses cloud — free)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# Testing
TEST_API_KEY=local-test-key
```

- [ ] **Step 2: Full stack integration test**

```bash
# 1. Start local environment
bash local/start.sh &

# 2. Wait for services
sleep 15

# 3. Copy .env.local.example to .env.local, fill in R2/SMTP values
cp express-api/.env.local.example express-api/.env.local
# Edit .env.local with real R2/SMTP values

# 4. Start Express API
cd express-api && npm run local &
sleep 5

# 5. Test health endpoint
curl -s http://localhost:3000/api/health
# Expected: {"status":"ok","timestamp":...}

# 6. Test starting screens (pre-auth)
curl -s http://localhost:3000/api/config/startingScreens
# Expected: {} (empty — no starting screens configured)

# 7. Check Firebase Emulator UI
# Open http://localhost:4000 — should show Firestore data from seed

# 8. Stop everything
bash local/stop.sh
```

- [ ] **Step 3: Commit**

```bash
git add express-api/.env.local.example
git commit -m "docs: add .env.local.example template for local development"
```

---

## Chunk 6: i18n + Documentation

### Task 9: Add local mode string resources (if any UI changes needed)

No new user-facing strings are needed — the local flavor changes are all backend/config. Skip this task.

### Task 10: Update CLAUDE.md with local development instructions

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Local Development section**

Add after the "Environments" section in CLAUDE.md:

```markdown
## Local Development (Zero Cloud)
- **Start:** `bash local/start.sh` (starts Firebase Emulators + LiveKit Docker)
- **API:** `cd express-api && npm run local`
- **Android:** `./gradlew installLocalDebug`
- **Firebase UI:** http://localhost:4000
- **Stop:** `bash local/stop.sh` or Ctrl+C in the start.sh terminal
- **Prerequisites:** Java 11+, Docker, Firebase CLI (`npm i -g firebase-tools`)
- **Seed data:** Auto-runs on first start. Manual: `node local/seed.js`
- **No cloud quota consumed** — all Firestore/Auth/RTDB traffic goes to emulators
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add local development instructions to CLAUDE.md"
```

---

## Chunk 7: CI Integration

### Task 11: Update E2E workflow to start Firebase emulators

**Files:**
- Modify: `.github/workflows/e2e-tests.yml`

- [ ] **Step 1: Add Firebase emulator setup to E2E workflow**

In `.github/workflows/e2e-tests.yml`, add the following steps **before** the E2E test run step:

1. **Add Java setup** (required by Firebase emulators):

```yaml
- name: Set up Java 17
  uses: actions/setup-java@v4
  with:
    distribution: 'temurin'
    java-version: '17'
```

2. **Start Firebase emulators with polling**:

```yaml
- name: Start Firebase Emulators
  run: |
    npx firebase emulators:start --project=demo-shytalk &
    echo "Waiting for emulators to be ready..."
    for i in $(seq 1 30); do
      if curl -s http://localhost:4000 > /dev/null 2>&1; then
        echo "Emulators ready after ${i}s"
        break
      fi
      sleep 1
    done
    if ! curl -s http://localhost:4000 > /dev/null 2>&1; then
      echo "ERROR: Emulators did not start within 30s"
      exit 1
    fi
```

3. **Seed data**:

```yaml
- name: Seed Firebase Emulator data
  run: node local/seed.js
```

4. **Start Express API in local mode**:

```yaml
- name: Start Express API (local mode)
  run: |
    cd express-api
    cp .env.local.example .env.local
    NODE_ENV=local node src/index.js &
    sleep 3
    curl -s http://localhost:3000/api/health || (echo "API failed to start" && exit 1)
```

- [ ] **Step 2: Verify workflow syntax**

```bash
# Validate the workflow YAML is parseable
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e-tests.yml'))"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "ci: start Firebase emulators before E2E tests"
```
