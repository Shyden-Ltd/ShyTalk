# ShyTalk

**Spraakchatrooms, opnieuw bedacht.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **Nederlands** | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Over het project

ShyTalk is een sociale spraakchat-app waar gebruikers realtime spraakchatrooms kunnen aanmaken en eraan kunnen deelnemen. Gebouwd met Kotlin Multiplatform (KMP), ondersteunt het zowel Android als iOS met een gedeelde codebase. Of je nu een gesprek wilt hosten, wilt meeluisteren of contact wilt leggen met mensen over de hele wereld -- ShyTalk maakt het eenvoudig.

## Functies

### Spraakchatrooms
- Maak rooms aan of neem deel met realtime spraak mogelijk gemaakt door LiveKit
- Gestructureerd stoelensysteem met eigenaar-, host- en deelnemersrollen
- Stoelaanvragen en uitnodigingen -- vraag een stoel aan of nodig luisteraars uit om te spreken
- Zwevend chatvenster -- ga door met spraakchat terwijl je andere delen van de app bekijkt
- Room-verloop -- rooms sluiten automatisch wanneer de eigenaar afwezig is, met afteltimers

### Berichten
- Live tekstchat naast spraak in elke room
- Privéberichten met 1-op-1 gesprekken
- Groepschats met ledenbeheer en machtigingen
- Typindicatoren in realtime
- Stickerondersteuning

### Sociaal
- Aanpasbare gebruikersprofielen met foto's, omslagafbeeldingen, nationaliteitsvlaggen en biografieën
- Volgsysteem -- volg andere gebruikers en zie wanneer ze actief zijn
- Cadeaumuur -- toon ontvangen cadeaus van andere gebruikers
- Blokkeer-systeem -- blokkeer gebruikers in rooms en profielen

### Virtuele economie
- Op munten gebaseerde economie met portemonnee en transactiegeschiedenis
- Dagelijkse inlogbeloningen met streakbonussen
- Lucky Spin (gacha) systeem met gestaffelde prijzen
- Virtuele cadeaus -- stuur en ontvang geanimeerde cadeaus tijdens spraakchat
- Rugzakinventaris voor het opslaan van cadeaus
- Muntpakketten voor het kopen van munten
- Broadcast-banners met geanimeerde cadeau-effecten

### Account & identiteit
- Multi-provider-authenticatie -- log in met Google, Apple of e-mail (OTP)
- Koppel meerdere inlogmethoden aan één account
- Stabiele gebruikersidentiteit (uniqueId) die behouden blijft over Firebase-projecten
- Beheer van gekoppelde accounts in Instellingen met koppel-/ontkoppelondersteuning
- Apparaatbinding -- elk apparaat is permanent gekoppeld aan één account

### Moderatie & veiligheid
- Moderatietools -- dempen, verwijderen, stoelen verplaatsen en hosts beheren als room-eigenaar
- Gebruikersrapportagesysteem met beoordelingsworkflow
- Waarschuwings- en schorsingsysteem voor beleidsschendingen
- Schermen voor gemeenschapsrichtlijnen, privacybeleid en gebruiksvoorwaarden
- Juridische acceptatiestroom voor nieuwe gebruikers
- Geforceerde update-afdwinging voor verouderde app-versies

### Startschermen
- Configureerbare startschermen die worden getoond bij het opstarten van de app
- Door beheerders beheerde inhoud met plannings- en targetingopties

### Beveiliging
- PIN-codebeveiliging voor app-toegang
- Biometrische authenticatie -- vingerafdruk en gezichtsherkenning
- OTP-verificatie (eenmalig wachtwoord) voor gevoelige acties

### Admin-paneel
- Webgebaseerd moderatiedashboard op de statische site van het project
- Gebruikersbeheer, inhoudsmoderatie en configuratie
- Sjabloon- en cadeaubeheer met live preview
- Realtime log-streaming en waarschuwingen

### Beeldcompressie
- Automatische beeldcompressie bij upload via de Express API
- Vermindert opslag- en bandbreedtekosten met behoud van kwaliteit

### Internationalisering
- 19 talen standaard ondersteund
- Volledige lokalisatie van alle gebruikersgerichte teksten

### Logging & monitoring
- Gestructureerde logging over Express API, mobiele apps en admin-paneel
- Realtime log-streaming in het admin-dashboard
- Apparaat- en netwerkbanning met automatische handhaving
- Waarschuwingssysteem voor kritieke fouten en anomalieën
- Trace-ID-propagatie voor end-to-end verzoektracking

## Technologie-stack

| Laag | Technologie |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architectuur** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Authenticatie** | Firebase Authentication (Google, Apple, Email+OTP) met multi-provider-identiteitssysteem |
| **Database** | Cloud Firestore |
| **Realtime** | Firebase Realtime Database |
| **Opslag** | Cloudflare R2 (via Express API proxy) |
| **API-server** | Express.js op Oracle Cloud Free Tier |
| **Spraak** | LiveKit |
| **Pushmeldingen** | Firebase Cloud Messaging |
| **Afbeeldingen laden** | Coil 3 (KMP) |
| **Animaties** | Lottie Compose |
| **Datum/Tijd** | kotlinx-datetime |
| **Navigatie** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Architectuur

ShyTalk volgt **MVVM** met een schoon **Repository Pattern**:

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

- **Shared module** (`commonMain`) -- Modellen, repository-interfaces, ViewModels en UI gedeeld over platformen
- **App module** -- Android-specifieke schermen, repository-implementaties en toegangspunt
- **iosApp module** -- iOS-specifiek toegangspunt
- **express-api** -- Express.js-backend op Oracle Cloud Free Tier

## Projectstructuur

```
ShyTalk/
+-- app/                              # Android-app-module
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Applicatie-toegangspunt
|       |   +-- MainActivity.kt       # Hoofdactiviteit
|       |   +-- core/
|       |   |   +-- di/               # Koin DI-module
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit-spraak, aanwezigheid, meldingen
|       |   |   +-- repository/       # Repository-implementaties
|       |   +-- feature/
|       |   |   +-- auth/             # Google-aanmeldscherm
|       |   |   +-- profile/          # Profielscherm
|       |   |   +-- room/             # Roomscherm
|       |   |   +-- settings/         # App-instellingen
|       |   +-- navigation/           # NavGraph & schermroutes
|       +-- test/                     # Unit-tests
|       +-- androidTest/              # E2E-tests (Compose UI Test)
+-- shared/                           # KMP shared module
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Gedeelde Koin-modules
|       |   +-- model/                # Datamodellen (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Gedeelde componenten
|       |   +-- util/                 # Hulpfuncties & constanten
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Repository-interfaces
|       +-- feature/                  # Gedeelde feature-modules
+-- iosApp/                           # iOS-app-module
+-- express-api/                      # Express.js API-server
|   +-- src/
|       +-- routes/                   # API-route-handlers
|       +-- middleware/               # Auth, logging-middleware
|       +-- utils/                    # Firebase Admin, R2, Logger
|       +-- cron/                     # Geplande taken
+-- public/                           # Statische site & admin-paneel
+-- local/                            # Lokale ontwikkelomgeving (emulators, testdata)
+-- tests/web/                        # Playwright-browsertests
+-- scripts/                          # Hulpscripts
+-- .github/workflows/                # CI/CD (PR-checks, Deploy naar Dev/Prod, E2E, Lint)
+-- firestore.rules                   # Firestore-beveiligingsregels
+-- database.rules.json               # RTDB-beveiligingsregels
+-- firestore.indexes.json            # Samengestelde Firestore-indexen
+-- firebase.json                     # Firebase-configuratie
```

## Aan de slag

### Vereisten

- **Android Studio** Ladybug of nieuwer
- **JDK 17+**
- **Node.js 24+**
- **Docker** (voor lokale LiveKit-server)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Lokale ontwikkeling (Aanbevolen)

De snelste manier om te beginnen. Gebruikt Firebase-emulators en een lokale LiveKit Docker-container -- geen cloudaccounts nodig, geen kosten, geen quotumlimieten.

1. **Klonen en installeren**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Lokale services starten**
   ```bash
   bash local/start.sh
   ```
   Dit start Firebase-emulators (Firestore, Auth, RTDB) en een LiveKit Docker-container. Bij de eerste keer worden automatisch testdata geseed (admin-gebruiker, voorbeeldcadeaus, configuratie).

   Je ziet:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Express API starten** (in een nieuw terminalvenster)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Pas R2/SMTP-waarden aan indien nodig
   npm run local
   ```
   De API start op `http://localhost:3000`. Test: `curl http://localhost:3000/api/health`

4. **Uitvoeren op Android-emulator**
   ```bash
   ./gradlew installLocalDebug
   ```
   De `local` build-flavor maakt verbinding met `10.0.2.2` (loopback van Android-emulator naar je machine). Het werkt gewoon -- geen extra configuratie nodig.

5. **Uitvoeren op een fysiek apparaat**

   Je telefoon moet op **hetzelfde Wi-Fi-netwerk** als je ontwikkelmachine zitten.

   a. Zoek het lokale IP-adres van je machine:
   ```bash
   # Windows
   ipconfig    # Zoek naar "IPv4 Address" onder je Wi-Fi-adapter (bijv. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # of: ip addr show
   ```

   b. Werk de lokale build-flavor bij om je IP te gebruiken in plaats van `10.0.2.2`. Zoek in `app/build.gradle.kts` de `local`-flavor en wijzig:
   ```kotlin
   // Vervang 10.0.2.2 door het lokale IP van je machine
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Verbind je apparaat via USB en schakel USB-debugging in, dan:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Gebruik als alternatief **adb reverse** om codewijzigingen te vermijden (apparaat routeert localhost naar je machine):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore-emulator
   adb reverse tcp:9099 tcp:9099   # Auth-emulator
   adb reverse tcp:9000 tcp:9000   # RTDB-emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Met `adb reverse` werken de standaard `10.0.2.2`-adressen in de lokale flavor ook op een fysiek apparaat -- geen build-configuratiewijzigingen nodig.

6. **Inloggen**
   - Gebruik de e-mailinlogstroom met het geseede testaccount: `claude-test@shytalk.dev` / `localdev123`
   - Of maak een nieuw account aan -- het gebruikt de lokale emulators
   - Google/Apple-inloggen werkt niet lokaal (geen echte OAuth) -- gebruik in plaats daarvan e-mail-OTP

7. **Lokale services stoppen**
   ```bash
   bash local/stop.sh
   ```
   Of druk op `Ctrl+C` in het `start.sh`-terminalvenster. Emulatordata wordt automatisch opgeslagen en hersteld bij de volgende start.

### Handige lokale ontwikkelings-URL's

| Service | URL | Doel |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Firestore-data, Auth-gebruikers, RTDB bekijken |
| Express API | http://localhost:3000 | Backend-API |
| Gezondheidscontrole | http://localhost:3000/api/health | Controleer of de API draait |

### Cloud-ontwikkeling (Optioneel)

Als je moet testen tegen echte cloudservices (bijv. echte pushmeldingen, echte Google-inlog):

1. **Firebase instellen**
   - Maak een Firebase-project aan op [console.firebase.google.com](https://console.firebase.google.com)
   - Schakel **Google-inlog** en **Apple-inlog** in bij Authenticatie
   - Schakel **Firestore**, **Realtime Database** en **Cloud Messaging** in
   - Download `google-services.json` en plaats het in `app/src/dev/`

2. **Express API instellen**
   ```bash
   cd express-api
   cp .env.example .env  # Bewerk met je cloud-inloggegevens
   npm install
   npm start
   ```

3. **Firestore-regels deployen**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Android-app bouwen** (dev-flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Omgevingsvariabelen

| Variabele | Beschrijving | Waar |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK serviceaccount-JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 account-ID | Express API |
| `R2_ACCESS_KEY_ID` | R2-toegangssleutel | Express API |
| `R2_SECRET_ACCESS_KEY` | R2-geheime sleutel | Express API |
| `R2_BUCKET_NAME` | R2-bucketnaam (standaard: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | LiveKit API-sleutel | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API-geheim | Express API |
| `LIVEKIT_URL` | LiveKit-server-URL | Android-app (BuildConfig) |
| `WORKER_URL` | Express API basis-URL | Android-app (BuildConfig) |

## Testen

| Suite | Commando | Aantal |
|-------|---------|-------|
| Kotlin unit-tests | `./gradlew test` | 100+ tests |
| Express API tests | `cd express-api && npm test` | 1.540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature-bestanden |
| Playwright webtests | `npx playwright test` | 28 specificaties |

```bash
# Kotlin/KMP unit-tests
./gradlew test

# Express API tests
cd express-api && npm test

# E2E-tests (vereist verbonden apparaat of emulator)
./gradlew connectedDevDebugAndroidTest

# Playwright-browsertests (vereist draaiend admin-paneel)
npx playwright test
```

## Deployment

Deployments worden beheerd via GitHub Actions workflows (`.github/workflows/`):

| Workflow | Trigger | Wat het doet |
|----------|---------|-------------|
| **PR Checks** | Automatisch bij PR's naar `main` | Voert lint, Kotlin-tests, Express API-tests, Playwright-tests uit (op basis van gewijzigde bestanden) |
| **Deploy to Dev** | Handmatig (`workflow_dispatch`) | Deployt Express API + web naar dev, distribueert APK naar testers, voert optioneel Playwright-tests uit |
| **Deploy to Prod** | Handmatig (`workflow_dispatch`) | Deployt een getagde release naar prod -- Express API, web, Play Store en App Store |

Aanvullende workflows: **E2E Tests** (Android-emulatormatrix), **SonarCloud** (statische analyse), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Gedeployd op Oracle Cloud VM's via SSH + PM2 (dev: Londen, prod: Singapore)
- **Android:** Gebundeld en geüpload naar Google Play via CI
- **iOS:** Gebouwd en geüpload naar App Store Connect / TestFlight via CI
- **Admin-paneel / Web:** Gedeployd op Cloudflare Pages

## Bijdragen

Bijdragen zijn welkom! Zie [CONTRIBUTING.md](CONTRIBUTING.md) voor richtlijnen.

## Licentie

Dit project is gelicentieerd onder de Apache License 2.0. Zie [LICENSE](LICENSE) voor details.

## Dankbetuigingen

- [Firebase](https://firebase.google.com) -- Authenticatie, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Realtime spraakcommunicatie
- [Cloudflare](https://www.cloudflare.com) -- R2-opslag, Pages-hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Gratis VM-tier voor Express API
- [Express.js](https://expressjs.com) -- API-server-framework
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Moderne declaratieve UI
- [Koin](https://insert-koin.io) -- Lichtgewicht dependency injection
- [Coil](https://coil-kt.github.io/coil/) -- Afbeeldingen laden voor Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Geanimeerde cadeau- en UI-effecten
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Multiplatform datum/tijd
