# ShyTalk

**Voice chat rooms, reimagined.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.0.21-blue.svg)](https://kotlinlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## About

ShyTalk is a social voice chat app where users can create and join real-time voice chat rooms. Built with Kotlin Multiplatform, it targets both Android and iOS with a shared codebase. Whether you want to host a conversation, listen in, or connect with people around the world, ShyTalk makes it easy.

## Features

### Voice Chat Rooms
- Create or join rooms with real-time voice powered by LiveKit
- Structured seating system with owner, host, and attendee roles
- Seat requests and invites — request to join a seat or invite listeners to speak
- Floating chathead — continue voice chat while browsing other parts of the app
- Room expiry — rooms auto-close when the owner is away, with countdown timers

### Messaging
- Live text chat alongside voice in every room
- Private messaging with 1-on-1 conversations
- Group chats with member management and permissions
- Typing indicators in real-time
- Sticker support
- Message translation — tap to translate messages in 20 languages

### Internationalization
- Full app UI translated into 20 languages
- Auto-translate for SuperShy subscribers — incoming messages translated automatically
- Browser-language detection for public webpages

### Social
- Customizable user profiles with photos, cover images, nationality flags, and bios
- Follow system — follow other users and see when they're active
- Gift wall — showcase gifts received from other users
- Block system — block users across rooms and profiles

### Virtual Economy
- Coin-based economy with wallet and transaction history
- Daily login rewards with streak bonuses
- Lucky Spin (gacha) system with tiered prizes
- Virtual gifts — send and receive animated gifts during voice chats
- Backpack inventory for storing gifts
- Coin packages for purchasing coins
- Broadcast banners with animated gift effects

### Moderation & Safety
- Moderation tools — mute, kick, move seats, and manage hosts as a room owner
- User reporting system with review workflow
- Warning and suspension system for policy violations
- Community standards, privacy policy, and terms of service screens
- Legal acceptance flow for new users
- Force update enforcement for outdated app versions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architecture** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Auth** | Firebase Authentication (Phone + Google Sign-In) |
| **Database** | Cloud Firestore |
| **Real-time** | Firebase Realtime Database (presence, typing, events) |
| **Storage** | Cloudflare R2 (via S3-compatible API) |
| **API Server** | Express.js + Firebase Admin SDK (Oracle Cloud) |
| **Push Notifications** | Firebase Cloud Messaging |
| **Voice** | LiveKit |
| **Image Loading** | Coil 3 (KMP) |
| **Animations** | Lottie Compose |
| **Date/Time** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **Billing** | Google Play Billing |
| **Web Hosting** | Cloudflare Pages |
| **Reverse Proxy** | Caddy (auto HTTPS) |
| **Process Manager** | PM2 |

## Architecture

ShyTalk follows **MVVM** with a clean **Repository Pattern**:

```
┌─────────────────────────────────────────────┐
│                    UI Layer                  │
│  Compose Screens → ViewModels → UI State    │
├─────────────────────────────────────────────┤
│                  Domain Layer                │
│         Repository Interfaces                │
├─────────────────────────────────────────────┤
│                  Data Layer                  │
│  Repository Impls → Firebase / LiveKit / R2  │
├─────────────────────────────────────────────┤
│              Express.js API                  │
│  Routes → Firebase Admin SDK → Firestore     │
└─────────────────────────────────────────────┘
```

- **shared module** (`commonMain`) — Models, repository interfaces, ViewModels, and UI shared across platforms
- **app module** — Android-specific screens, repository implementations, and entry point
- **iosApp module** — iOS-specific entry point
- **express-api** — Express.js server handling all backend logic

## Project Structure

```
ShyTalk/
├── app/                              # Android app module
│   └── src/
│       ├── main/java/.../
│       │   ├── ShyTalkApp.kt         # Application entry point
│       │   ├── MainActivity.kt       # Main activity
│       │   ├── core/
│       │   │   ├── di/               # Koin DI module
│       │   │   └── room/             # ActiveRoomManager & RoomService
│       │   ├── data/
│       │   │   ├── remote/           # LiveKit voice, presence, notifications
│       │   │   └── repository/       # Repository implementations
│       │   ├── feature/
│       │   │   ├── auth/             # Google Sign-In screen
│       │   │   ├── profile/          # Profile screen
│       │   │   ├── room/             # Room screen
│       │   │   ├── settings/         # App settings
│       │   │   ├── suspension/       # Suspension screen
│       │   │   ├── update/           # Force update screen
│       │   │   └── warning/          # Warning acknowledgment
│       │   └── navigation/           # NavGraph & Screen routes
│       ├── test/                     # Unit tests
│       └── androidTest/              # E2E tests (Compose UI Test)
├── shared/                           # KMP shared module
│   └── src/
│       ├── commonMain/kotlin/.../
│       │   ├── core/model/           # Data models (User, ChatRoom, Gift, etc.)
│       │   ├── data/repository/      # Repository interfaces
│       │   └── feature/              # ViewModels & Compose screens
│       ├── commonMain/composeResources/
│       │   ├── values/strings.xml    # English strings (source of truth)
│       │   └── values-{lang}/        # 19 translated string files
│       ├── androidMain/              # Android platform implementations
│       └── iosMain/                  # iOS platform implementations
├── express-api/                      # Backend API server
│   └── src/
│       ├── index.js                  # Express setup + server start
│       ├── middleware/               # Auth (Firebase Admin verifyIdToken)
│       ├── routes/                   # API route handlers
│       ├── utils/                    # Firebase, R2, helpers
│       └── cron/                     # Scheduled jobs (node-cron)
├── iosApp/                           # iOS app module
├── public/                           # Cloudflare Pages (landing + admin)
├── firestore.rules                   # Firestore security rules
├── database.rules.json               # RTDB security rules
└── firebase.json                     # Firebase configuration
```

## Getting Started

### Prerequisites

- **Android Studio** Ladybug or newer
- **JDK 17+**
- **Node.js 20+** (for Express API)
- **Firebase project** with Firestore, Auth, RTDB, and FCM enabled
- **LiveKit server** for real-time voice
- **Cloudflare account** with R2 bucket for media storage

### 1. Clone the repository

```bash
git clone https://github.com/ShydenMcM/ShyTalk.git
cd ShyTalk
```

### 2. Firebase setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Phone Authentication** and **Google Sign-In** in the Authentication section
3. Create a **Cloud Firestore** database
4. Create a **Realtime Database** instance
5. Download `google-services.json` and place it in `app/`
6. Generate a **service account key** (Project Settings → Service Accounts → Generate new private key)

### 3. Cloudflare R2 setup

1. Create an R2 bucket in [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Create R2 API credentials (Access Key ID + Secret Access Key)
3. Set up a custom domain for the bucket (e.g., `images.yourdomain.com`)

### 4. Express API setup

```bash
cd express-api
npm install
```

Create a `.env` file in `express-api/`:

```env
PORT=3000
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_URL=wss://your-livekit-server.com
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://images.yourdomain.com
ADMIN_UIDS=uid1,uid2
```

Start the API server:

```bash
node src/index.js
```

For production, use PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

### 5. Deploy Firestore & RTDB rules

```bash
firebase deploy --only firestore:rules
firebase deploy --only database
```

### 6. Android app configuration

Set the following environment variables (or define them in `local.properties`):

```properties
API_BASE_URL=https://your-api-domain.com
WORKER_URL=https://your-api-domain.com
LIVEKIT_URL=wss://your-livekit-server.com
```

### 7. Build and run

```bash
./gradlew assembleDebug
```

### Configuration Reference

| Item | Location | Description |
|------|----------|-------------|
| Firebase config | `app/google-services.json` | Firebase project credentials |
| Service account | Server-side only | Firebase Admin SDK auth |
| LiveKit URL | `LIVEKIT_URL` env var | Voice chat server URL |
| API base URL | `API_BASE_URL` env var | Express API server URL |
| R2 credentials | Express `.env` | Cloudflare R2 storage credentials |
| Firestore rules | `firestore.rules` | Firestore security rules |
| RTDB rules | `database.rules.json` | Realtime Database security rules |
| Web client ID | `GoogleSignInScreen.kt` | Google OAuth client ID |

## Internationalization

ShyTalk supports 20 languages: English, Spanish, French, German, Portuguese, Italian, Dutch, Polish, Arabic, Japanese, Korean, Chinese, Hindi, Turkish, Russian, Ukrainian, Swedish, Thai, Vietnamese, and Indonesian.

- **App strings** are in `shared/src/commonMain/composeResources/values/strings.xml` (English source) with translations in `values-{lang}/` directories
- **Language preference** is stored locally via `LanguagePreference` (expect/actual for Android/iOS)
- **Message translation** uses the Express API `/api/translate` endpoint
- **Public webpages** detect browser language and swap text automatically

To add a new language:
1. Create `shared/src/commonMain/composeResources/values-{code}/strings.xml`
2. Translate all string entries from the English file
3. Add the language to `SUPPORTED_LANGUAGES` in `AppSettingsScreen.kt`

## Testing

### Unit Tests

```bash
# Run all Kotlin unit tests
./gradlew test
```

### E2E Tests (Gradle Managed Devices)

The project includes an E2E regression test suite using Compose UI Test with fake repositories for deterministic, offline testing.

```bash
# Run on a single device profile
./gradlew pixel8DebugAndroidTest

# Available device profiles:
#   pixel4a       — small phone
#   pixel8        — medium phone
#   pixel9ProXL   — large phone
#   pixelTablet   — tablet
```

### Express API Tests

```bash
cd express-api
npm test
```

## Deployment

### Express API (Production)

The API runs on an Ubuntu VM with PM2 and Caddy for auto HTTPS:

1. Set up an Ubuntu VM (e.g., Oracle Cloud Free Tier)
2. Install Node.js 20, PM2, and Caddy
3. Configure Caddy to reverse proxy to `localhost:3000`
4. Deploy the Express API and start with PM2

### Static Pages

Public pages are deployed via Cloudflare Pages:

```bash
npx wrangler pages deploy public --project-name shytalk-site
```

### Android App

```bash
# Build release APK
./gradlew assembleRelease

# Build and upload to Play Store
./gradlew bundleRelease
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes with clear messages
4. Run all tests before pushing (`./gradlew test`)
5. Push to your fork and open a Pull Request

### Code Style

- Follow Kotlin coding conventions
- Use meaningful names for variables, functions, and classes
- Keep composables focused and modular
- Write ViewModels with unidirectional data flow (StateFlow + UI State)
- Use Compose Multiplatform string resources (`stringResource(Res.string.xxx)`) for all UI text

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Firebase](https://firebase.google.com) — Authentication, Firestore, RTDB, Cloud Messaging
- [LiveKit](https://livekit.io) — Real-time voice communication
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — Object storage for media
- [Jetpack Compose](https://developer.android.com/jetpack/compose) — Modern declarative UI
- [Koin](https://insert-koin.io) — Lightweight dependency injection
- [Coil](https://coil-kt.github.io/coil/) — Image loading for Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) — Animated gift and UI effects
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) — Multiplatform date/time
- [Express.js](https://expressjs.com) — Node.js web framework
- [Caddy](https://caddyserver.com) — Automatic HTTPS reverse proxy
