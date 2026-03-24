# ShyTalk

**Voice chat rooms, reimagined.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.0.21-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## About

ShyTalk is a social voice chat app where users can create and join real-time voice chat rooms. Built with Kotlin Multiplatform (KMP), it targets both Android and iOS with a shared codebase. Whether you want to host a conversation, listen in, or connect with people around the world, ShyTalk makes it easy.

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
| **Voice** | LiveKit |
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
+-- firestore.rules                   # Firestore security rules
+-- database.rules.json               # RTDB security rules
+-- firestore.indexes.json            # Firestore composite indexes
+-- firebase.json                     # Firebase configuration
```

## Getting Started

### Prerequisites

- **Android Studio** Ladybug or newer
- **JDK 17+**
- **Node.js 24+**
- **Docker** (for LiveKit local server)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Local Development (Recommended)

The fastest way to get started. Uses Firebase Emulators and a local LiveKit Docker container — no cloud accounts needed, no costs, no quota limits.

1. **Clone and install**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Start local services**
   ```bash
   bash local/start.sh
   ```
   This starts Firebase Emulators (Firestore, Auth, RTDB) and a LiveKit Docker container. On first run it automatically seeds test data (admin user, sample gifts, config).

   You'll see:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Start the Express API** (in a new terminal)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Edit R2/SMTP values if needed
   npm run local
   ```
   The API starts on `http://localhost:3000`. Test: `curl http://localhost:3000/api/health`

4. **Build and run the Android app**
   ```bash
   ./gradlew installLocalDebug
   ```
   The `local` build flavor connects to `10.0.2.2` (Android emulator loopback to host).

5. **Sign in**
   - Open the app in the Android emulator
   - Use the email sign-in flow with the seeded test account: `claude-test@shytalk.dev` / `localdev123`
   - Or create a new account — it will use the local emulators

6. **Stop local services**
   ```bash
   bash local/stop.sh
   ```
   Or press `Ctrl+C` in the `start.sh` terminal. Emulator data is saved automatically and restored on next start.

### Useful Local Dev URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Browse Firestore data, Auth users, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Health check | http://localhost:3000/api/health | Verify API is running |

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
| `LIVEKIT_API_KEY` | LiveKit API key | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API secret | Express API |
| `LIVEKIT_URL` | LiveKit server URL | Android app (BuildConfig) |
| `WORKER_URL` | Express API base URL | Android app (BuildConfig) |

## Testing

```bash
# Android/KMP unit tests
./gradlew test

# Express API tests
cd express-api && npm test

# E2E tests (requires connected device or emulator)
./gradlew connectedDebugAndroidTest
```

## Deployment

- **Express API:** Deploy to Oracle Cloud VM via `scp` + PM2
- **Android:** `./gradlew bundleRelease` then upload to Google Play
- **Admin panel:** `npx wrangler pages deploy public --project-name shytalk-site`

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
