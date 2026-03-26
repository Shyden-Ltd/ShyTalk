# ShyTalk

**Voice chat rooms, reimagined.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## About

ShyTalk is a social voice chat app where users can create and join real-time voice chat rooms. Built with Kotlin Multiplatform (KMP), it targets both Android and iOS with a shared codebase. Whether you want to host a conversation, listen in, or connect with people around the world, ShyTalk makes it easy.

iOS is a supported platform but this guide focuses on Android development, which is the primary development target.

## Features

### Voice Chat Rooms
- Create or join rooms with real-time voice powered by LiveKit
- Structured seating system with owner, host, and attendee roles
- Seat requests and invites -- request to join a seat or invite listeners to speak
- Floating chathead -- continue voice chat while browsing other parts of the app
- Room expiry -- rooms auto-close when the owner is away, with countdown timers

### Messaging
- Live text chat alongside voice in every room
- Private messaging with 1-on-1 conversations
- Group chats with member management and permissions
- Typing indicators in real-time
- Sticker support

### Social
- Customizable user profiles with photos, cover images, nationality flags, and bios
- Follow system -- follow other users and see when they're active
- Gift wall -- showcase gifts received from other users
- Block system -- block users across rooms and profiles

### Virtual Economy
- Coin-based economy with wallet and transaction history
- Daily login rewards with streak bonuses
- Lucky Spin (gacha) system with tiered prizes
- Virtual gifts -- send and receive animated gifts during voice chats
- Backpack inventory for storing gifts
- Coin packages for purchasing coins
- Broadcast banners with animated gift effects

### Account & Identity
- Multi-provider authentication -- sign in with Google, Apple, or Email (OTP)
- Link multiple sign-in methods to a single account
- Stable user identity (uniqueId) that persists across Firebase projects
- Linked Accounts management in Settings with link/unlink support
- Device binding -- each device is permanently tied to one account

### Moderation & Safety
- Moderation tools -- mute, kick, move seats, and manage hosts as a room owner
- User reporting system with review workflow
- Warning and suspension system for policy violations
- Community standards, privacy policy, and terms of service screens
- Legal acceptance flow for new users
- Force update enforcement for outdated app versions

### Starting Screens
- Configurable launch screens shown on app startup
- Admin-managed content with scheduling and targeting options

### Security
- PIN code protection for app access
- Biometric authentication -- fingerprint and face recognition
- OTP (one-time password) verification for sensitive actions

### Admin Panel
- Web-based moderation dashboard at the project's static site
- User management, content moderation, and configuration
- Template and gift management with live preview
- Real-time log streaming and alerting

### Image Compression
- Automatic image compression on upload via the Express API
- Reduces storage and bandwidth costs while preserving quality

### Internationalization
- 19 languages supported out of the box
- Full localization for all user-facing strings

### Logging & Monitoring
- Structured logging across Express API, mobile apps, and admin panel
- Real-time log streaming in the admin dashboard
- Device and network banning with automatic enforcement
- Alerting system for critical errors and anomalies
- Trace ID propagation for end-to-end request tracking

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architecture** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Auth** | Firebase Authentication (Google, Apple, Email+OTP) with multi-provider identity system |
| **Database** | Cloud Firestore |
| **Real-time** | Firebase Realtime Database |
| **Storage** | Cloudflare R2 (via Express API proxy) |
| **API Server** | Express.js on Oracle Cloud Free Tier |
| **Voice** | LiveKit (self-hosted on Oracle Cloud) |
| **Push Notifications** | Firebase Cloud Messaging |
| **Image Loading** | Coil 3 (KMP) |
| **Animations** | Lottie Compose |
| **Date/Time** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Architecture

ShyTalk follows **MVVM** with a clean **Repository Pattern**:

```
+---------------------------------------------+
|                    UI Layer                  |
|  Compose Screens -> ViewModels -> UI State   |
+---------------------------------------------+
|                  Domain Layer                |
|         Repository Interfaces                |
+---------------------------------------------+
|                  Data Layer                  |
|  Repository Impls -> Firestore / R2 / RTDB / LiveKit  |
+---------------------------------------------+
```

- **shared module** (`commonMain`) -- Models, repository interfaces, ViewModels, and UI shared across platforms
- **app module** -- Android-specific screens, repository implementations, and entry point
- **iosApp module** -- iOS-specific entry point
- **express-api** -- Express.js backend running on Oracle Cloud Free Tier

## Project Structure

```
ShyTalk/
+-- app/                              # Android app module
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Application entry point
|       |   +-- MainActivity.kt       # Main activity
|       |   +-- core/
|       |   |   +-- di/               # Koin DI module
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit voice, presence, notifications
|       |   |   +-- repository/       # Repository implementations
|       |   +-- feature/
|       |   |   +-- auth/             # Google Sign-In screen
|       |   |   +-- profile/          # Profile screen
|       |   |   +-- room/             # Room screen
|       |   |   +-- settings/         # App settings
|       |   +-- navigation/           # NavGraph & Screen routes
|       +-- test/                     # Unit tests
|       +-- androidTest/              # E2E tests (Compose UI Test)
+-- shared/                           # KMP shared module
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Shared Koin modules
|       |   +-- model/                # Data models (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Shared components
|       |   +-- util/                 # Utilities & constants
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Repository interfaces
|       +-- feature/                  # Shared feature modules
+-- iosApp/                           # iOS app module
+-- express-api/                      # Express.js API server
|   +-- src/
|       +-- routes/                   # API route handlers
|       +-- middleware/               # Auth, logging middleware
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Scheduled jobs
+-- public/                           # Static site & admin panel
+-- local/                            # Local development environment (emulators, seed data)
+-- tests/web/                        # Playwright browser tests
+-- scripts/                          # Utility scripts
+-- .github/workflows/                # CI/CD (PR Checks, Deploy to Dev/Prod, E2E, lint)
+-- firestore.rules                   # Firestore security rules
+-- database.rules.json               # RTDB security rules
+-- firestore.indexes.json            # Firestore composite indexes
+-- firebase.json                     # Firebase configuration
```

## Getting Started

### Prerequisites

- **Android Studio** Ladybug or newer
- **JDK 21+**
- **Node.js 24+**
- **Docker** (for LiveKit voice server, MinIO storage, Mailpit email)
- **Firebase CLI** (`npm install -g firebase-tools`)

No cloud accounts are needed to get started -- the local environment runs entirely offline.

### Local Development (Recommended)

The fastest way to get started. One command starts everything -- Firebase Emulators, Docker containers, Express API, and builds the Android app. No cloud accounts needed, no costs, no quota limits.

1. **Clone and install**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Start everything**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   This single command:
   - Starts Docker containers (LiveKit voice server, MinIO storage, Mailpit email)
   - Starts Firebase Emulators (Firestore, Auth, RTDB)
   - Seeds test data and creates the MinIO storage bucket
   - Starts the Express API
   - Builds and installs the Android app (if a device is connected)

   When ready, you'll see:
   ```
   Local environment ready (fully offline):

     Services:
       Firebase UI:    http://localhost:4000
       Express API:    http://localhost:3000
       Mailpit UI:     http://localhost:8025
       MinIO Console:  http://localhost:9001
       LiveKit:        localhost:7880

     Credentials:
       Test admin:     claude-test@shytalk.dev / localdev123
       Test user:      user@test.com / localdev123
       MinIO:          minioadmin / minioadmin
   ```

3. **Sign in**
   - Use the email sign-in flow with the seeded test account: `claude-test@shytalk.dev` / `localdev123`
   - Or create a new account -- it will use the local emulators
   - Google/Apple sign-in won't work locally (no real OAuth) -- use email OTP instead
   - OTP codes are captured by Mailpit -- check http://localhost:8025

4. **Run on a Physical Device**

   Your phone must be on the **same Wi-Fi network** as your development machine.

   a. Find your machine's local IP:
   ```bash
   # Windows
   ipconfig    # Look for "IPv4 Address" under your Wi-Fi adapter (e.g. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # or: ip addr show
   ```

   b. Update the local build flavor to use your IP instead of `10.0.2.2`. In `app/build.gradle.kts`, find the `local` flavor and change:
   ```kotlin
   // Replace 10.0.2.2 with your machine's local IP
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Connect your device via USB and enable USB debugging, then:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternatively, use **adb reverse** to avoid changing any code (device routes localhost to your machine):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (image storage)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI (view OTP emails)
   ```
   With `adb reverse`, the default `10.0.2.2` addresses in the local flavor will work on a physical device too -- no build config changes needed.

5. **Stop local services**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Or press `Ctrl+C` in the start script terminal. Emulator data is saved automatically and restored on next start.

### Useful Local Dev URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Browse Firestore data, Auth users, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Health check | http://localhost:3000/api/health | Verify API is running |
| Mailpit | http://localhost:8025 | View captured emails and OTP codes |
| MinIO Console | http://localhost:9001 | Browse uploaded images and files |

### Optional Services

**LibreTranslate (Message Translation)**

Optional 6GB+ Docker image for testing the translation feature locally:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Not included in the default setup due to large image size. Translation works without it -- messages just stay untranslated.

### Cloud Development (Optional)

If you need to test against real cloud services (e.g., real push notifications, real Google Sign-In):

1. **Firebase setup**
   - Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
   - Enable **Google Sign-In** and **Apple Sign-In** in Authentication
   - Enable **Firestore**, **Realtime Database**, and **Cloud Messaging**
   - Download `google-services.json` and place it in `app/src/dev/`

2. **Express API setup**
   ```bash
   cd express-api
   cp .env.example .env  # Edit with your cloud credentials
   npm install
   npm start
   ```

3. **Deploy Firestore rules**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Build the Android app** (dev flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Environment Variables

| Variable | Description | Where |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK service account JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 access key | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | Express API |
| `R2_BUCKET_NAME` | R2 bucket name (default: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | LiveKit API key (Asia/Singapore) | Express API |
| `LIVEKIT_SECRET_ASIA` | LiveKit API secret (Asia/Singapore) | Express API |
| `LIVEKIT_URL_ASIA` | LiveKit server URL (Asia) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | LiveKit API key (EU/London) | Express API |
| `LIVEKIT_SECRET_EU` | LiveKit API secret (EU/London) | Express API |
| `LIVEKIT_URL_EU` | LiveKit server URL (EU) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | LiveKit API key (fallback when per-region keys not set) | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API secret (fallback when per-region keys not set) | Express API |
| `LIVEKIT_URL` | LiveKit server URL (baked into Android app at build time) | Android app (BuildConfig) |
| `WORKER_URL` | Express API base URL | Android app (BuildConfig) |

## Testing

### Running Tests Locally

```bash
# Interactive test menu (choose what to run):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Or run individual suites:
bash local/test-unit.sh       # Kotlin + Express API unit tests
bash local/test-playwright.sh # Playwright web tests (needs local env)
bash local/test-e2e.sh        # Android E2E tests (needs local env + device)
bash local/test-lint.sh       # ktlint + ESLint

# View Allure test report:
npx allure serve allure-results
```

### Test Suites

| Suite | Command | Count |
|-------|---------|-------|
| Kotlin unit tests | `./gradlew test` | 100+ tests |
| Express API tests | `cd express-api && npm test` | 1,540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedLocalDebugAndroidTest` | 34 feature files |
| Playwright web tests | `npx playwright test` | 28 specs |

```bash
# Kotlin/KMP unit tests
./gradlew test

# Express API tests
cd express-api && npm test

# E2E tests (requires connected device or emulator)
./gradlew connectedLocalDebugAndroidTest

# Playwright browser tests (requires admin panel running)
npx playwright test
```

### Testing in CI

In CI, Playwright and Android E2E tests run against the same local environment (emulators + Docker) -- no cloud services are used. This ensures tests never interfere with live testers.

## Troubleshooting

- **Port already in use**: `lsof -i :<port>` (Linux/macOS) or `netstat -ano | findstr :<port>` (Windows) to find what's using the port.
- **Docker not running**: Ensure Docker Desktop is started. Run `docker ps` to verify.
- **Firebase emulators fail to start**: Requires Java 21+. Check with `java -version`.
- **Android build fails**: Ensure JDK 21+ and Android SDK are installed. Try `./gradlew clean`.
- **adb device not detected**: Enable USB debugging. Run `adb devices` to check.
- **Images not loading**: MinIO bucket may not be created. Run `cd express-api && NODE_PATH=./node_modules node ../local/seed.js`. For physical devices, run `adb reverse tcp:9002 tcp:9002`.
- **OTP not arriving**: Check console output for `[OTP-LOCAL]` lines. Also check Mailpit UI at http://localhost:8025.
- **Reset emulator data**: Delete `local/firebase-emulator-data/` directory and restart.
- **Reset MinIO data**: Run `docker compose -f local/docker-compose.yml down -v` to remove volumes.

## Deployment

Deployments are managed through GitHub Actions workflows (`.github/workflows/`):

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **PR Checks** | Automatic on PRs to `main` | Runs lint, Kotlin tests, Express API tests, Playwright tests (based on changed files) |
| **Deploy to Dev** | Manual (`workflow_dispatch`) | Deploys Express API + web to dev, distributes APK to testers, optionally runs Playwright tests |
| **Deploy to Prod** | Manual (`workflow_dispatch`) | Deploys a tagged release to prod -- Express API, web, Play Store, and App Store |

Additional workflows: **E2E Tests** (Android emulator matrix), **SonarCloud** (static analysis), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Deployed to Oracle Cloud VMs via SSH + PM2 (dev: London, prod: Singapore)
- **Android:** Bundled and uploaded to Google Play via CI
- **iOS:** Built and uploaded to App Store Connect / TestFlight via CI
- **Admin panel / web:** Deployed to Cloudflare Pages

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Firebase](https://firebase.google.com) -- Authentication, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Real-time voice communication
- [Cloudflare](https://www.cloudflare.com) -- R2 storage, Pages hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Free tier VM for Express API
- [Express.js](https://expressjs.com) -- API server framework
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Modern declarative UI
- [Koin](https://insert-koin.io) -- Lightweight dependency injection
- [Coil](https://coil-kt.github.io/coil/) -- Image loading for Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Animated gift and UI effects
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Multiplatform date/time
