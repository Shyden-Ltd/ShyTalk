# Local Development Environment — Design Spec

**Date:** 2026-03-24
**Status:** Draft
**Priority:** High (eliminates Firestore quota exhaustion and LiveKit costs)

## 1. Overview

Replace cloud Firebase and LiveKit with local alternatives for development and automated testing. Firebase Emulator Suite handles Firestore, Auth, and RTDB. LiveKit runs as a Docker container. R2, SMTP, and LibreTranslate remain on cloud (free tier, no issues). A wrapper script starts everything with one command.

### Goals
- Zero Firestore reads/writes against cloud during development and automated testing
- Zero LiveKit Cloud usage during development
- CI E2E tests run against emulators (no cloud quota consumed)
- Dev cloud environment reserved for manual testing and post-deploy smoke tests only

### Services

| Service | Current | Local | Cost Saving |
|---|---|---|---|
| Firebase (Firestore, Auth, RTDB) | Google Cloud (Spark free tier) | Firebase Emulator Suite | Eliminates quota exhaustion |
| LiveKit | LiveKit Cloud (paid) | Docker container | Eliminates paid service |
| R2 storage | Cloudflare R2 | Keep cloud | Free tier sufficient |
| SMTP email | Oracle Cloud | Keep cloud | Free |
| LibreTranslate | Remote | Keep cloud | Free |

## 2. File Structure

```
/
├── local/
│   ├── start.sh                    # Start all local services
│   ├── stop.sh                     # Stop all local services
│   ├── seed.js                     # Seed Firebase emulators with initial data
│   ├── livekit.yaml                # LiveKit server config
│   ├── docker-compose.yml          # LiveKit container
│   └── firebase-emulator-data/     # Persisted emulator state (gitignored)
├── firebase.json                   # Updated with emulator config
├── express-api/
│   ├── .env.local                  # Local environment variables (gitignored)
│   └── src/utils/firebase.js       # Updated to detect local mode
└── app/
    └── src/local/                  # New Android build flavor
        └── google-services.json    # Placeholder for emulators
```

## 3. Firebase Emulator Configuration

### 3.1 firebase.json

Add emulators block to the existing `firebase.json`:

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

- Emulator UI at `http://localhost:4000` for browsing data visually
- Security rules and indexes are loaded from existing files
- No FCM emulator (not available) — push notifications logged to console in local mode
- Data persisted to `local/firebase-emulator-data/` via `--import`/`--export-on-exit` flags

### 3.2 Express API Changes (firebase.js)

When `NODE_ENV=local`, set emulator host env vars before `admin.initializeApp()`:

```javascript
if (process.env.NODE_ENV === 'local') {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9000';
}
```

These env vars are set at the top of `firebase.js` itself, before the `admin.initializeApp()` call in the same file. They must be set before any Firebase Admin SDK method is invoked.

Firebase Admin SDK automatically detects these env vars and routes all traffic to emulators. No service account file needed in local mode — `admin.initializeApp()` with no args works against emulators.

### 3.3 FCM Handling

Firebase Cloud Messaging has no emulator. Wrap all `messaging.send()` calls:

```javascript
if (process.env.NODE_ENV === 'local') {
  console.log('[FCM-LOCAL] Would send:', payload);
  return;
}
```

Apply to: `express-api/src/utils/fcm.js` (centralized FCM utility).

### 3.4 Auth Emulator Behaviour

- No real Google/Apple OAuth — emulator provides a test sign-in UI at `http://localhost:9099`
- `auth.createCustomToken()` and `auth.verifyIdToken()` work against emulator
- Custom auth flows (PIN, biometric, OTP) work unchanged
- Test users created by seed script or via emulator UI
- RTDB rules enforce authentication — Android client must sign in via the Auth emulator before RTDB reads/writes will succeed. The seed script uses Admin SDK which bypasses rules.

## 4. LiveKit Local Setup

### 4.1 Docker Compose

`local/docker-compose.yml`:

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

### 4.2 LiveKit Config

`local/livekit.yaml`:

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

- Fixed API key `devkey` / secret `devsecret` for local use
- Express API uses these via `.env.local`
- Android connects to `ws://10.0.2.2:7880` (emulator) or `ws://<local-ip>:7880` (physical device)

## 5. Android Build Flavor

New `local` flavor in `app/build.gradle.kts`:

```kotlin
local {
    dimension = "environment"
    applicationIdSuffix = ".local"
    buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3000\"")
    buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://10.0.2.2:7880\"")
    buildConfigField("String", "RTDB_URL", "\"http://10.0.2.2:9000\"")
    buildConfigField("String", "EMAIL_LINK_DOMAIN", "\"localhost\"")
    buildConfigField("String", "WORKER_URL", "\"http://10.0.2.2:3000\"")
    buildConfigField("String", "WEB_CLIENT_ID", "\"placeholder-local\"")
    buildConfigField("String", "BYPASS_DEVICE_CHECKS", "\"true\"")
}
```

`app/src/local/google-services.json`:
Placeholder with both package names (`com.shyden.shytalk` and `com.shyden.shytalk.local`), same pattern as CI placeholder.

**Cleartext HTTP:** Android blocks cleartext HTTP by default. Create `app/src/local/res/xml/network_security_config.xml` that permits cleartext to `10.0.2.2` and `localhost`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
```
Then create a flavor-specific `app/src/local/AndroidManifest.xml` that references it:
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:networkSecurityConfig="@xml/network_security_config" />
</manifest>
```

**Asset merge task:** Update the `afterEvaluate` asset merge task list in `app/build.gradle.kts` to include `mergeLocalDebugAssets` and `mergeLocalReleaseAssets`.

Firebase SDK emulator connection in Koin module — when flavor is `local`:
```kotlin
Firebase.firestore.useEmulator("10.0.2.2", 8080)
Firebase.auth.useEmulator("10.0.2.2", 9099)
Firebase.database.useEmulator("10.0.2.2", 9000)
```

## 6. Seed Data

`local/seed.js` — idempotent script (checks if data exists before creating):

**Config documents:**
- `config/economy` — default economy settings (daily bonus, spin cost, etc.)
- `config/app` — version info, grace period settings
- `config/startingScreens` — empty (no blocking screens)
- `config/moderation` — default moderation thresholds
- `alertConfig/settings` — default alert thresholds
- `logConfig/settings` — default log config

**Counter:**
- `counters/uniqueId` — `{ value: 100000000 }`

**Admin user:**
- Firebase Auth: `claude-test@shytalk.dev` (password: `localdev123`)
- `users/100000001` — userType: ADMIN, displayName: "Local Admin"
- `identityMap/email:claude-test@shytalk.dev` — linked to uniqueId 100000001

**Regular user:**
- Firebase Auth: `user@test.com` (password: `localdev123`)
- `users/100000002` — userType: MEMBER, displayName: "Test User"
- `identityMap/email:user@test.com` — linked to uniqueId 100000002

**Sample content:**
- 3 gifts in `gifts/` (different coin values for economy testing)
- 1 coin package in `coinPackages/`
- 1 fun fact in `funFacts/`

Run via: `node local/seed.js`
Uses Firebase Admin SDK pointed at emulators (same env var detection as firebase.js).

## 7. Environment Configuration

### 7.1 Express API

`express-api/.env.local` (gitignored):

```
NODE_ENV=local
PORT=3000
FIREBASE_DATABASE_URL=http://localhost:9000
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
LIVEKIT_HOST=http://localhost:7880
R2_ACCOUNT_ID=<existing value>
R2_ACCESS_KEY_ID=<existing value>
R2_SECRET_ACCESS_KEY=<existing value>
R2_BUCKET_NAME=<existing value>
CDN_URL=<existing value>
SMTP_HOST=<existing value>
SMTP_PORT=587
SMTP_USER=<existing value>
SMTP_PASS=<existing value>
```

New npm script in `express-api/package.json`:
```json
"local": "node --env-file=.env.local src/index.js"
```

### 7.2 .gitignore additions

```
local/firebase-emulator-data/
express-api/.env.local
```

## 8. Wrapper Scripts

### 8.1 start.sh

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

# Keep running until Ctrl+C
trap "echo 'Shutting down...'; kill $FIREBASE_PID 2>/dev/null; wait $FIREBASE_PID 2>/dev/null; docker compose -f $SCRIPT_DIR/docker-compose.yml down; exit 0" INT TERM
wait $FIREBASE_PID
```

### 8.2 stop.sh

```bash
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true
pkill -f "firebase emulators" 2>/dev/null || true
pkill -f "express-api/src/index.js" 2>/dev/null || true
echo "Local environment stopped."
```

## 9. Testing Strategy

### 9.1 Testing Tiers

| Tier | Environment | Quota Impact | When |
|---|---|---|---|
| Unit tests | Mocked (no Firebase) | Zero | Every commit (pre-commit hooks, CI) |
| Integration/E2E | Local emulators | Zero | During development, pre-push |
| CI E2E suite | Firebase emulators in CI runner | Zero | PR checks — emulators started in workflow |
| Smoke tests | Dev (cloud) | Minimal (~100-200 ops) | Post-deploy to dev only |

### 9.2 CI Changes

Update `.github/workflows/e2e-tests.yml` to start Firebase emulators before running tests:

```yaml
- name: Start Firebase Emulators
  run: |
    npx firebase emulators:start --project=demo-shytalk &
    echo "Waiting for emulators..."
    until curl -s http://localhost:4000 > /dev/null 2>&1; do sleep 1; done
    echo "Emulators ready."

- name: Seed test data
  run: node local/seed.js
  env:
    FIRESTORE_EMULATOR_HOST: localhost:8080
    FIREBASE_AUTH_EMULATOR_HOST: localhost:9099
    FIREBASE_DATABASE_URL: http://localhost:9000
```

The Express API test server in CI uses `NODE_ENV=local` with emulator env vars. Zero cloud Firestore operations.

### 9.3 Quota Budget

After this change:

| Activity | Cloud Firestore Ops/Day |
|---|---|
| CI (all test suites) | **0** (emulators) |
| Development | **0** (emulators) |
| Post-deploy smoke test | ~100-200 |
| Manual tester usage | ~500-2,000 |
| Crons (idle dev server) | ~200 (already reduced) |
| **Total** | **~800-2,400** (was 10,000-33,000) |

Well within the 50K read / 20K write / 20K delete Spark plan limits.

## 10. Prerequisites

- **Java 11+** — required by Firebase Emulator Suite
- **Docker** — required for LiveKit container
- **Firebase CLI** — `npm install -g firebase-tools` (or `npx firebase`)
- **Node.js 24** — already in use

## 11. What Does NOT Change

- R2 storage configuration and usage
- SMTP email configuration and usage
- LibreTranslate configuration and usage
- Production deployment workflow
- Dev server deployment workflow (still deploys to Oracle Cloud)
- Firestore security rules (same file used by emulators)
- Firestore indexes (same file used by emulators)
- Express API route code (zero changes to business logic)
- Unit test mocking approach (Jest mocks unchanged)
