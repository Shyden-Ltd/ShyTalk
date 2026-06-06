# ShyTalk

**Spraakchatrooms, opnieuw bedacht.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **Nederlands** | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Over

ShyTalk is een sociale spraakchat-app waar gebruikers realtime spraakchatrooms kunnen aanmaken en eraan kunnen deelnemen. Gebouwd met Kotlin Multiplatform (KMP), ondersteunt het zowel Android als iOS met een gedeelde codebase. Of je nu een gesprek wilt hosten, wilt luisteren of contact wilt leggen met mensen over de hele wereld, ShyTalk maakt het gemakkelijk.

iOS is een ondersteund platform maar deze gids richt zich op Android-ontwikkeling, dat het primaire ontwikkelingsdoel is.

## Functies

### Spraakchatrooms
- Maak of neem deel aan kamers met realtime spraak aangedreven door LiveKit
- Gestructureerd stoelensysteem met eigenaar-, host- en deelnemerrol
- Stoelaanvragen en uitnodigingen -- vraag aan om op een stoel te zitten of nodig luisteraars uit om te spreken
- Zwevend chatvenster -- ga door met spraakchat terwijl je door andere delen van de app bladert
- Kamerverlopen -- kamers sluiten automatisch wanneer de eigenaar afwezig is, met afteltimers

### Berichten
- Live tekstchat naast spraak in elke kamer
- Privéberichten met 1-op-1 gesprekken
- Groepschats met ledenbeheer en machtigingen
- Typindicatoren in realtime
- Stickerondersteuning

### Sociaal
- Aanpasbare gebruikersprofielen met foto's, omslagafbeeldingen, nationaliteitsvlaggen en bio's
- Volgsysteem -- volg andere gebruikers en zie wanneer ze actief zijn
- Cadeaumuur -- toon ontvangen cadeaus van andere gebruikers
- Blokkeersysteem -- blokkeer gebruikers in kamers en profielen

### Virtuele Economie
- Op munten gebaseerde economie met portemonnee en transactiegeschiedenis
- Dagelijkse inlogbeloningen met streakbonussen
- Lucky Spin (gacha) systeem met getrapte prijzen
- Virtuele cadeaus -- stuur en ontvang geanimeerde cadeaus tijdens spraakchats
- Rugzakinventaris voor het opslaan van cadeaus
- Muntpakketten voor het kopen van munten
- Uitzendbanners met geanimeerde cadeau-effecten

### Account & Identiteit
- Multi-provider authenticatie -- log in met Google, Apple of e-mail (OTP)
- Koppel meerdere inlogmethoden aan één account
- Stabiele gebruikersidentiteit (uniqueId) die behouden blijft over Firebase-projecten
- Beheer van gekoppelde accounts in Instellingen met koppel/ontkoppel ondersteuning
- Apparaatbinding -- elk apparaat is permanent gekoppeld aan één account

### Moderatie & Veiligheid
- Moderatietools -- dempen, verwijderen, stoelen verplaatsen en hosts beheren als kamereigenaar
- Gebruikersmeldingssysteem met beoordelingsworkflow
- Waarschuwings- en schorsingssysteem voor beleidsschendingen
- Schermen voor gemeenschapsnormen, privacybeleid en servicevoorwaarden
- Juridisch acceptatieproces voor nieuwe gebruikers
- Geforceerde update voor verouderde app-versies

### Startschermen
- Configureerbare opstartschermen die bij het starten van de app worden getoond
- Door beheerders beheerde inhoud met plannings- en targetingopties

### Beveiliging
- PIN-codebescherming voor app-toegang
- Biometrische authenticatie -- vingerafdruk en gezichtsherkenning
- OTP-verificatie (eenmalig wachtwoord) voor gevoelige acties

### Beheerpaneel
- Webgebaseerd moderatiedashboard op de statische site van het project
- Gebruikersbeheer, inhoudsmoderatie en configuratie
- Template- en cadeaubeheer met live preview
- Realtime logstreaming en waarschuwingen

### Beeldcompressie
- Automatische beeldcompressie bij upload via Express API
- Vermindert opslag- en bandbreedtekosten met behoud van kwaliteit

### Internationalisatie
- 19 talen standaard ondersteund
- Volledige lokalisatie van alle gebruikersgerichte teksten

### Logging & Monitoring
- Gestructureerde logging over Express API, mobiele apps en beheerpaneel
- Realtime logstreaming in het beheerdashboard
- Apparaat- en netwerkblokkering met automatische handhaving
- Waarschuwingssysteem voor kritieke fouten en anomalieën
- Trace ID-propagatie voor end-to-end verzoektracking

## Technologiestack

| Laag | Technologie |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architectuur** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Authenticatie** | Firebase Authentication (Google, Apple, Email+OTP) met multi-provider identiteitssysteem |
| **Database** | Cloud Firestore |
| **Realtime** | Firebase Realtime Database |
| **Opslag** | Cloudflare R2 (via Express API proxy) |
| **API-server** | Express.js op Oracle Cloud Free Tier |
| **Spraak** | LiveKit (self-hosted on Oracle Cloud) |
| **Pushmeldingen** | Firebase Cloud Messaging |
| **Beeldlading** | Coil 3 (KMP) |
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

- **Shared module** (`commonMain`) -- Modellen, repository-interfaces, ViewModels en UI gedeeld over platforms
- **App module** -- Android-specifieke schermen, repository-implementaties en ingangspunt
- **iosApp module** -- iOS-specifiek ingangspunt
- **express-api** -- Express.js backend draaiend op Oracle Cloud Free Tier

## Projectstructuur

```
ShyTalk/
+-- app/                              # Android app-module
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Applicatie-ingangspunt
|       |   +-- MainActivity.kt       # Hoofdactiviteit
|       |   +-- core/
|       |   |   +-- di/               # Koin DI-module
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit spraak, aanwezigheid, meldingen
|       |   |   +-- repository/       # Repository-implementaties
|       |   +-- feature/
|       |   |   +-- auth/             # Google-inlogscherm
|       |   |   +-- profile/          # Profielscherm
|       |   |   +-- room/             # Kamerscherm
|       |   |   +-- settings/         # App-instellingen
|       |   +-- navigation/           # NavGraph & schermroutes
|       +-- test/                     # Unit tests
|       +-- androidTest/              # E2E tests (Compose UI Test)
+-- shared/                           # KMP gedeelde module
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Gedeelde Koin-modules
|       |   +-- model/                # Datamodellen (User, ChatRoom, Gift, enz.)
|       |   +-- ui/                   # Gedeelde componenten
|       |   +-- util/                 # Hulpmiddelen & constanten
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, enz.
|       |   +-- repository/           # Repository-interfaces
|       +-- feature/                  # Gedeelde functiemodules
+-- iosApp/                           # iOS app-module
+-- express-api/                      # Express.js API-server
|   +-- src/
|       +-- routes/                   # API route-handlers
|       +-- middleware/               # Auth, logging middleware
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Geplande taken
+-- public/                           # Statische site & beheerpaneel
+-- local/                            # Lokale ontwikkelomgeving (emulators, seed data)
+-- tests/web/                        # Playwright browsertests
+-- scripts/                          # Hulpscripts
+-- .github/workflows/                # CI/CD (PR Checks, Deploy naar Dev/Prod, E2E, lint)
+-- firestore.rules                   # Firestore beveiligingsregels
+-- database.rules.json               # RTDB beveiligingsregels
+-- firestore.indexes.json            # Firestore samengestelde indexen
+-- firebase.json                     # Firebase configuratie
```

## Aan de slag

### Vereisten

- **Android Studio** Ladybug of nieuwer
- **JDK 21+**
- **Node.js 24+**
- **Docker** (voor LiveKit spraakserver, MinIO opslag, Mailpit e-mail)
- **Firebase CLI** (`npm install -g firebase-tools`)

Geen cloudaccounts nodig om te beginnen -- de lokale omgeving draait volledig offline.

### Lokale Ontwikkeling (Aanbevolen)

De snelste manier om te beginnen. Eén commando start alles -- Firebase Emulators, Docker-containers, Express API en bouwt de Android-app. Geen cloudaccounts nodig, geen kosten, geen quotalimieten.

1. **Klonen en installeren**
   ```bash
   git clone https://github.com/Shyden-Ltd/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Alles starten**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Dit enkele commando:
   - Start Docker-containers (LiveKit spraakserver, MinIO opslag, Mailpit e-mail)
   - Start Firebase Emulators (Firestore, Auth, RTDB)
   - Zaait testdata en maakt de MinIO opslagbucket aan
   - Start de Express API
   - Bouwt en installeert de Android-app (als een apparaat is aangesloten)

   Wanneer gereed, zie je:
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

3. **Inloggen**
   - Gebruik de e-mail inlogflow met het gezaaide testaccount: `claude-test@shytalk.dev` / `localdev123`
   - Of maak een nieuw account aan -- het gebruikt de lokale emulators
   - Google/Apple inloggen werkt niet lokaal (geen echte OAuth) -- gebruik e-mail OTP
   - OTP-codes worden vastgelegd door Mailpit -- controleer http://localhost:8025

4. **Uitvoeren op een Fysiek Apparaat**

   Je telefoon moet op **hetzelfde Wi-Fi-netwerk** zijn als je ontwikkelmachine.

   a. Vind het lokale IP van je machine:
   ```bash
   # Windows
   ipconfig    # Zoek naar "IPv4 Address" onder je Wi-Fi adapter (bijv. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # of: ip addr show
   ```

   b. Werk de lokale build flavor bij om jouw IP te gebruiken in plaats van `10.0.2.2`. In `app/build.gradle.kts`, vind de `local` flavor en wijzig:
   ```kotlin
   // Vervang 10.0.2.2 door het lokale IP van je machine
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Sluit je apparaat aan via USB en schakel USB-debugging in, dan:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Gebruik anders **adb reverse** om codewijzigingen te vermijden (apparaat routeert localhost naar je machine):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (beeldopslag)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Met `adb reverse` werken de standaard `10.0.2.2` adressen in de lokale flavor ook op een fysiek apparaat -- geen build-configuratiewijzigingen nodig.

5. **Lokale services stoppen**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Of druk op `Ctrl+C` in de startscript-terminal. Emulatordata wordt automatisch opgeslagen en hersteld bij de volgende start.

### Nuttige Lokale Ontwikkel-URLs

| Service | URL | Doel |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Firestore data, Auth gebruikers, RTDB bekijken |
| Express API | http://localhost:3000 | Backend API |
| Health check | http://localhost:3000/api/health | Controleer of de API draait |
| Mailpit | http://localhost:8025 | Vastgelegde e-mails en OTP-codes bekijken |
| MinIO Console | http://localhost:9001 | Geüploade afbeeldingen en bestanden bekijken |

### Optionele Services

**LibreTranslate (Berichtvertaling)**

Optionele 6GB+ Docker image voor het lokaal testen van de vertaalfunctie:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Niet opgenomen in de standaard setup vanwege de grote imagegrootte. Vertaling werkt zonder -- berichten blijven gewoon onvertaald.

### Cloud Ontwikkeling (Optioneel)

Als je moet testen met echte cloudservices (bijv. echte pushmeldingen, echte Google-login):

1. **Firebase setup**
   - Maak een Firebase-project aan op [console.firebase.google.com](https://console.firebase.google.com)
   - Schakel **Google-login** en **Apple-login** in bij Authenticatie
   - Schakel **Firestore**, **Realtime Database** en **Cloud Messaging** in
   - Download `google-services.json` en plaats het in `app/src/dev/`

2. **Express API setup**
   ```bash
   cd express-api
   cp .env.example .env  # Bewerk met je cloud-inloggegevens
   npm install
   npm start
   ```

3. **Firestore regels deployen**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Android app bouwen** (dev flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Omgevingsvariabelen

| Variabele | Beschrijving | Waar |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK serviceaccount JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 account-ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 toegangssleutel | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 geheime sleutel | Express API |
| `R2_BUCKET_NAME` | R2 bucketnaam (standaard: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | LiveKit API-sleutel (Azie/Singapore) | Express API |
| `LIVEKIT_SECRET_ASIA` | LiveKit API-geheim (Azie/Singapore) | Express API |
| `LIVEKIT_URL_ASIA` | LiveKit server-URL (Azie) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | LiveKit API-sleutel (EU/Londen) | Express API |
| `LIVEKIT_SECRET_EU` | LiveKit API-geheim (EU/Londen) | Express API |
| `LIVEKIT_URL_EU` | LiveKit server-URL (EU) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | LiveKit API-sleutel (terugval wanneer regionale sleutels niet zijn ingesteld) | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API-geheim (terugval wanneer regionale sleutels niet zijn ingesteld) | Express API |
| `LIVEKIT_URL` | LiveKit server-URL (ingebakken in Android app tijdens build) | Android app (BuildConfig) |
| `WORKER_URL` | Express API basis-URL | Android app (BuildConfig) |

## Testen

### Lokaal Tests Uitvoeren

```bash
# Interactief testmenu (kies wat je wilt uitvoeren):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Of voer individuele suites uit:
bash local/test-unit.sh       # Kotlin + Express API unit tests
bash local/test-playwright.sh # Playwright webtests (vereist lokale omgeving)
bash local/test-e2e.sh        # Android E2E tests (vereist lokale omgeving + apparaat)
bash local/test-lint.sh       # ktlint + ESLint

# Allure testrapport bekijken:
npx allure serve allure-results
```

### Testsuites

| Suite | Commando | Aantal |
|-------|---------|-------|
| Kotlin unit tests | `./gradlew test` | 100+ tests |
| Express API tests | `cd express-api && npm test` | 1.540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature-bestanden |
| Playwright webtests | `npx playwright test` | 28 specs |

```bash
# Kotlin/KMP unit tests
./gradlew test

# Express API tests
cd express-api && npm test

# E2E tests (vereist aangesloten apparaat of emulator)
./gradlew connectedDevDebugAndroidTest

# Playwright browsertests (vereist draaiend beheerpaneel)
npx playwright test
```

### Testen in CI

In CI draaien Playwright en Android E2E tests tegen dezelfde lokale omgeving (emulators + Docker) -- er worden geen cloudservices gebruikt. Dit zorgt ervoor dat tests nooit interfereren met echte testers.

## Probleemoplossing

- **Poort al in gebruik**: `lsof -i :<port>` (Linux/macOS) of `netstat -ano | findstr :<port>` (Windows) om te vinden wat de poort gebruikt.
- **Docker draait niet**: Zorg dat Docker Desktop is gestart. Voer `docker ps` uit om te verifiëren.
- **Firebase emulators starten niet**: Vereist Java 21+. Controleer met `java -version`.
- **Android build mislukt**: Zorg dat JDK 21+ en Android SDK zijn geïnstalleerd. Probeer `./gradlew clean`.
- **adb apparaat niet gedetecteerd**: Schakel USB-debugging in. Voer `adb devices` uit om te controleren.
- **Afbeeldingen laden niet**: MinIO bucket is mogelijk niet aangemaakt. Voer `cd express-api && NODE_ENV=local node ../local/seed.js` uit. Voor fysieke apparaten, voer `adb reverse tcp:9002 tcp:9002` uit.
- **OTP komt niet aan**: Controleer console-uitvoer op `[OTP-LOCAL]` regels. Controleer ook de Mailpit UI op http://localhost:8025.
- **Emulatordata resetten**: Verwijder de map `local/firebase-emulator-data/` en herstart.
- **MinIO data resetten**: Voer `docker compose -f local/docker-compose.yml down -v` uit om volumes te verwijderen.

## Deployment

Deployments worden beheerd via GitHub Actions workflows (`.github/workflows/`):

| Workflow | Trigger | Wat het doet |
|----------|---------|-------------|
| **PR Checks** | Automatisch bij PRs naar `main` | Voert lint, Kotlin tests, Express API tests, Playwright tests uit (gebaseerd op gewijzigde bestanden) |
| **Deploy to Dev** | Handmatig (`workflow_dispatch`) | Deployt Express API + web naar dev, distribueert APK naar testers, voert optioneel Playwright tests uit |
| **Deploy to Prod** | Handmatig (`workflow_dispatch`) | Deployt een getagde release naar prod -- Express API, web, Play Store en App Store |

Aanvullende workflows: **E2E Tests** (Android emulator matrix), **SonarCloud** (statische analyse), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Gedeployd op Oracle Cloud VMs via SSH + PM2 (dev: Londen, prod: Singapore)
- **Android:** Gebundeld en geüpload naar Google Play via CI
- **iOS:** Gebouwd en geüpload naar App Store Connect / TestFlight via CI
- **Beheerpaneel / web:** Gedeployd op Cloudflare Pages

## Bijdragen

Bijdragen zijn welkom! Zie [CONTRIBUTING.md](CONTRIBUTING.md) voor richtlijnen.

## Licentie

Dit project is gelicentieerd onder de Apache License 2.0. Zie [LICENSE](LICENSE) voor details.

## Erkenningen

- [Firebase](https://firebase.google.com) -- Authenticatie, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Realtime spraakcommunicatie
- [Cloudflare](https://www.cloudflare.com) -- R2 opslag, Pages hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Gratis tier VM voor Express API
- [Express.js](https://expressjs.com) -- API server framework
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Moderne declaratieve UI
- [Koin](https://insert-koin.io) -- Lichtgewicht dependency injection
- [Coil](https://coil-kt.github.io/coil/) -- Beeldlading voor Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Geanimeerde cadeau- en UI-effecten
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Multiplatform datum/tijd
