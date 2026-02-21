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
| **Auth** | Firebase Authentication (Google Sign-In) |
| **Database** | Cloud Firestore |
| **Storage** | Firebase Storage |
| **Cloud Functions** | Firebase Functions (Node.js) |
| **Push Notifications** | Firebase Cloud Messaging |
| **Voice** | LiveKit |
| **Image Loading** | Coil 3 (KMP) |
| **Animations** | Lottie Compose |
| **Date/Time** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **Billing** | Google Play Billing |

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
│  Repository Impls → Firebase / LiveKit       │
└─────────────────────────────────────────────┘
```

- **shared module** (`commonMain`) — Models, repository interfaces, ViewModels, and UI shared across platforms
- **app module** — Android-specific screens, repository implementations, and entry point
- **iosApp module** — iOS-specific entry point

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
│       │   │   └── repository/       # Repository implementations (Firebase)
│       │   ├── feature/
│       │   │   ├── auth/             # Google Sign-In screen
│       │   │   ├── profile/          # Profile screen
│       │   │   ├── room/             # Room screen
│       │   │   ├── settings/         # App settings
│       │   │   ├── suspension/       # Suspension screen
│       │   │   ├── update/           # Force update screen
│       │   │   └── warning/          # Warning acknowledgment
│       │   └── navigation/           # NavGraph & Screen routes
│       ├── test/                     # Unit tests (~1240 tests)
│       └── androidTest/              # E2E tests (Compose UI Test)
│           ├── fake/                 # Fake repositories & services
│           ├── journey/              # Journey test files (~53 tests)
│           └── testdata/             # Test data fixtures
├── shared/                           # KMP shared module
│   └── src/commonMain/kotlin/.../
│       ├── core/
│       │   ├── di/                   # Shared Koin modules
│       │   ├── model/                # Data models (User, ChatRoom, Gift, etc.)
│       │   ├── room/                 # RoomLifecycleManager interface
│       │   ├── ui/                   # Shared components (BroadcastBanner, GiftEffects)
│       │   └── util/                 # Utilities & constants
│       ├── data/
│       │   ├── remote/               # VoiceService, TokenService, etc.
│       │   └── repository/           # Repository interfaces
│       └── feature/
│           ├── auth/                 # Auth ViewModel
│           ├── daily/                # Daily reward dialog & ViewModel
│           ├── gacha/                # Lucky Spin overlay & ViewModel
│           ├── gifting/              # Gift sending ViewModel
│           ├── home/                 # Home screen & room list
│           ├── legal/                # Legal acceptance screen
│           ├── main/                 # Main screen with bottom navigation
│           ├── messaging/            # Private chat, conversations, group setup
│           ├── privacy/              # Privacy policy screen
│           ├── profile/              # Profile, follow list, gift wall
│           ├── room/                 # Room ViewModel & components
│           ├── settings/             # Settings ViewModels
│           └── shop/                 # Wallet & transaction history
├── iosApp/                           # iOS app module
├── functions/                        # Firebase Cloud Functions (Node.js)
├── public/                           # Static landing page
├── firestore.rules                   # Firestore security rules
├── firestore.indexes.json            # Firestore composite indexes
└── firebase.json                     # Firebase configuration
```

## Getting Started

### Prerequisites

- **Android Studio** Ladybug or newer
- **JDK 11+**
- **Firebase project** with Firestore, Auth, Storage, Cloud Messaging, and Functions enabled
- **LiveKit server** for real-time voice

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/shyden/ShyTalk.git
   cd ShyTalk
   ```

2. **Firebase configuration**
   - Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
   - Enable **Google Sign-In** in the Authentication section
   - Download `google-services.json` and place it in `app/`

3. **LiveKit configuration**
   - Set the `LIVEKIT_URL` environment variable to your LiveKit server URL

4. **Deploy Cloud Functions**
   ```bash
   cd functions
   npm install
   firebase deploy --only functions
   ```

5. **Deploy Firestore rules**
   ```bash
   firebase deploy --only firestore:rules
   ```

6. **Build and run**
   ```bash
   ./gradlew assembleDebug
   ```

### Configuration

| Item | Location | Description |
|------|----------|-------------|
| Firebase | `app/google-services.json` | Firebase project config |
| LiveKit URL | `LIVEKIT_URL` env var | Voice chat server URL |
| Web Client ID | `GoogleSignInScreen.kt` | Google OAuth client ID |
| Firestore Rules | `firestore.rules` | Security rules for Firestore |

## Testing

### Unit Tests

```bash
# Run all Kotlin unit tests (~1240 tests)
./gradlew test

# Run Cloud Functions tests (~109 tests)
cd functions && npm test
```

### E2E Tests (Gradle Managed Devices)

The project includes an E2E regression test suite using Compose UI Test with fake repositories for deterministic, offline testing.

```bash
# Run on a single device profile
./gradlew pixel8DebugAndroidTest

# Available device profiles:
#   pixel4a   — small phone
#   pixel8    — medium phone
#   pixel9ProXL — large phone
#   pixelTablet — tablet
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

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Firebase](https://firebase.google.com) — Authentication, Firestore, Storage, Functions, Cloud Messaging
- [LiveKit](https://livekit.io) — Real-time voice communication
- [Jetpack Compose](https://developer.android.com/jetpack/compose) — Modern declarative UI
- [Koin](https://insert-koin.io) — Lightweight dependency injection
- [Coil](https://coil-kt.github.io/coil/) — Image loading for Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) — Animated gift and UI effects
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) — Multiplatform date/time
