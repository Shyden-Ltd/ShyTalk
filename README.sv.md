# ShyTalk

**Rostchattrum, nytankta.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | **Svenska** | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Om projektet

ShyTalk ar en social rostchattapp dar anvandare kan skapa och ga med i rostchattrum i realtid. Byggd med Kotlin Multiplatform (KMP), stodjer den bade Android och iOS med en delad kodbas. Oavsett om du vill vara vard for ett samtal, lyssna eller fa kontakt med manniskor runt om i varlden -- ShyTalk gor det enkelt.

iOS ar en plattform som stods, men den har guiden fokuserar pa Android-utveckling, som ar det primara utvecklingsmalet.

## Funktioner

### Rostchattrum
- Skapa eller ga med i rum med rostchatt i realtid driven av LiveKit
- Strukturerat platssystem med agare, vard och deltagarroller
- Platsforfragan och inbjudningar -- begara att fa en plats eller bjud in lyssnare att tala
- Flytande chatthuvud -- fortsatt rostchatten medan du blaaddrar i andra delar av appen
- Rumets utgang -- rum stangs automatiskt nar agaren ar borta, med nedrakningstimare

### Meddelanden
- Livetextchatt bredvid rost i varje rum
- Privata meddelanden med 1-till-1-konversationer
- Gruppchatt med medlemshantering och behorigheter
- Skrivindikatorer i realtid
- Stickerstod

### Socialt
- Anpassningsbara anvandarprofiler med foton, omslagsbilder, nationalitetsflaggor och bios
- Foljsystem -- folj andra anvandare och se nar de ar aktiva
- Presentvagg -- visa presenter som mottagits fran andra anvandare
- Blocksystem -- blockera anvandare over rum och profiler

### Virtuell ekonomi
- Myntbaserad ekonomi med planbok och transaktionshistorik
- Dagliga inloggningsbeloaningar med svitbonusar
- Lucky Spin-system (gacha) med rangordnade priser
- Virtuella presenter -- skicka och ta emot animerade presenter under rostchatt
- Ryggsacksinventering for att lagra presenter
- Myntpaket for kop av mynt
- Sandningsbanners med animerade presenteffekter

### Konto & identitet
- Fleraleverantorsautentisering -- logga in med Google, Apple eller e-post (OTP)
- Lanka flera inloggningsmetoder till ett enda konto
- Stabil anvandaridentitet (uniqueId) som bestaer over Firebase-projekt
- Hantering av lankade konton i installningar med stod for lanka/avlanka
- Enhetsbindning -- varje enhet ar permanent kopplad till ett konto

### Moderering & sakerhet
- Modereringsverktyg -- tysta, sparka ut, flytta platser och hantera vardar som rumagare
- System for anvandarrapportering med granskningsarbetsflode
- Varnings- och avstangningssystem for policyovertraddelser
- Skarmar for gemenskapsregler, integritetspolicy och anvandarvillkor
- Juridiskt godkannandeflode for nya anvandare
- Tvingad uppdatering for foraldrade appversioner

### Startskaarmar
- Konfigurerbara startskaarmar som visas vid appstart
- Administratorshanterat innehall med schemalagnings- och malstyrningsalternativ

### Sakerhet
- PIN-kodsskydd for appatkomst
- Biometrisk autentisering -- fingeravtryck och ansiktsigenkanning
- OTP-verifiering (engangslosen) for kansliga atgarder

### Adminpanel
- Webbaserad modereringspanel pa projektets statiska webbplats
- Anvandarhantering, innehallsmoderering och konfiguration
- Mall- och presenthantering med liveforhandsgranskning
- Loggstrommning och larm i realtid

### Bildkomprimering
- Automatisk bildkomprimering vid uppladdning via Express API
- Minskar lagrings- och bandbreddskostnader med bibehallen kvalitet

### Internationalisering
- 19 sprak stods direkt
- Fullstandig lokalisering av alla anvandarsynliga strangar

### Loggning & overvakning
- Strukturerad loggning over Express API, mobilappar och adminpanel
- Loggstrommning i realtid i adminpanelen
- Enhets- och natverksblockering med automatisk tillamning
- Larmsystem for kritiska fel och avvikelser
- Trace ID-spridning for end-to-end-sporning av forfragan

## Teknikstack

| Lager | Teknik |
|-------|-----------|
| **Ramverk** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Arkitektur** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Autentisering** | Firebase Authentication (Google, Apple, Email+OTP) med fleraleverantorsidentitetssystem |
| **Databas** | Cloud Firestore |
| **Realtid** | Firebase Realtime Database |
| **Lagring** | Cloudflare R2 (via Express API-proxy) |
| **API-server** | Express.js pa Oracle Cloud Free Tier |
| **Rost** | LiveKit |
| **Push-notiser** | Firebase Cloud Messaging |
| **Bildladdning** | Coil 3 (KMP) |
| **Animationer** | Lottie Compose |
| **Datum/tid** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Arkitektur

ShyTalk foljer **MVVM** med ett rent **Repository Pattern**:

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

- **shared-modul** (`commonMain`) -- Modeller, repository-granssnitt, ViewModels och UI delat over plattformar
- **app-modul** -- Android-specifika skarmar, repository-implementationer och startpunkt
- **iosApp-modul** -- iOS-specifik startpunkt
- **express-api** -- Express.js-backend pa Oracle Cloud Free Tier

## Projektstruktur

```
ShyTalk/
+-- app/                              # Android-appmodul
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Applikationens startpunkt
|       |   +-- MainActivity.kt       # Huvudaktivitet
|       |   +-- core/
|       |   |   +-- di/               # Koin DI-modul
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit rost, narvaro, notiser
|       |   |   +-- repository/       # Repository-implementationer
|       |   +-- feature/
|       |   |   +-- auth/             # Google-inloggningsskarm
|       |   |   +-- profile/          # Profilskarm
|       |   |   +-- room/             # Rumskarm
|       |   |   +-- settings/         # Appinstallningar
|       |   +-- navigation/           # NavGraph & skarmrutter
|       +-- test/                     # Enhetstester
|       +-- androidTest/              # E2E-tester (Compose UI Test)
+-- shared/                           # KMP delad modul
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Delade Koin-moduler
|       |   +-- model/                # Datamodeller (User, ChatRoom, Gift m.fl.)
|       |   +-- ui/                   # Delade komponenter
|       |   +-- util/                 # Verktyg & konstanter
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService m.fl.
|       |   +-- repository/           # Repository-granssnitt
|       +-- feature/                  # Delade funktionsmoduler
+-- iosApp/                           # iOS-appmodul
+-- express-api/                      # Express.js API-server
|   +-- src/
|       +-- routes/                   # API-rutthanterare
|       +-- middleware/               # Auth, loggnings-middleware
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Schemalagda jobb
+-- public/                           # Statisk webbplats & adminpanel
+-- local/                            # Lokal utvecklingsmiljo (emulatorer, testdata)
+-- tests/web/                        # Playwright webbtester
+-- scripts/                          # Verktygsskript
+-- .github/workflows/                # CI/CD (PR-kontroller, Deploy till Dev/Prod, E2E, lint)
+-- firestore.rules                   # Firestore-sakerhetsregler
+-- database.rules.json               # RTDB-sakerhetsregler
+-- firestore.indexes.json            # Firestore sammansatta index
+-- firebase.json                     # Firebase-konfiguration
```

## Komma igang

### Forutsattningar

- **Android Studio** Ladybug eller nyare
- **JDK 17+**
- **Node.js 24+**
- **Docker** (for LiveKit-rostserver, MinIO-lagring, Mailpit-e-post)
- **Firebase CLI** (`npm install -g firebase-tools`)

Inga molnkonton behovs for att komma igang -- den lokala miljon kors helt offline.

### Lokal utveckling (Rekommenderat)

Det snabbaste sattet att komma igang. Ett kommando startar allt -- Firebase-emulatorer, Docker-containrar, Express API och bygger Android-appen. Inga molnkonton behovs, inga kostnader, inga kvotbegransningar.

1. **Klona och installera**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Starta allt**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Detta enda kommando:
   - Startar Docker-containrar (LiveKit-rostserver, MinIO-lagring, Mailpit-e-post)
   - Startar Firebase-emulatorer (Firestore, Auth, RTDB)
   - Seedar testdata och skapar MinIO-lagringshinken
   - Startar Express API
   - Bygger och installerar Android-appen (om en enhet ar ansluten)

   Nar allt ar klart ser du:
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

3. **Logga in**
   - Anvand e-postinloggningsfllodet med det seedade testkontot: `claude-test@shytalk.dev` / `localdev123`
   - Eller skapa ett nytt konto -- det anvander de lokala emulatorerna
   - Google/Apple-inloggning fungerar inte lokalt (inget riktigt OAuth) -- anvand e-post-OTP istallet
   - OTP-koder fangas av Mailpit -- kolla http://localhost:8025

4. **Koor pa en fysisk enhet**

   Din telefon maste vara pa **samma Wi-Fi-natverk** som din utvecklingsmaskin.

   a. Hitta din maskins lokala IP:
   ```bash
   # Windows
   ipconfig    # Leta efter "IPv4 Address" under din Wi-Fi-adapter (t.ex. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # eller: ip addr show
   ```

   b. Uppdatera den lokala build-flavorn att anvanda din IP istallet for `10.0.2.2`. I `app/build.gradle.kts`, hitta `local`-flavorn och andra:
   ```kotlin
   // Ersatt 10.0.2.2 med din maskins lokala IP
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Anslut din enhet via USB och aktivera USB-felsookning, sedan:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternativt, anvand **adb reverse** for att undvika kodandringar (enheten dirigerar localhost till din maskin):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore-emulator
   adb reverse tcp:9099 tcp:9099   # Auth-emulator
   adb reverse tcp:9000 tcp:9000   # RTDB-emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (bildlagring)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Med `adb reverse` fungerar standardadresserna `10.0.2.2` i den lokala flavorn aven pa en fysisk enhet -- inga byggkonfigurationsandringar behovs.

5. **Stoppa lokala tjanster**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Eller tryck `Ctrl+C` i startskriptterminalen. Emulatordata sparas automatiskt och aterstalls vid nasta start.

### Anvandbar lokala utvecklings-URL:er

| Tjanst | URL | Syfte |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Bladddra i Firestore-data, Auth-anvandare, RTDB |
| Express API | http://localhost:3000 | Backend-API |
| Halsokontroll | http://localhost:3000/api/health | Verifiera att API:et kor |
| Mailpit | http://localhost:8025 | Visa fangade e-postmeddelanden och OTP-koder |
| MinIO Console | http://localhost:9001 | Bladddra bland uppladdade bilder och filer |

### Valfria tjanster

**LibreTranslate (Meddelandeoversattning)**

Valfri Docker-image pa 6 GB+ for att testa oversattningsfunktionen lokalt:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Ingar inte i standardkonfigurationen pa grund av stor bildstorlek. Oversattning fungerar utan den -- meddelanden forblir bara ooversatta.

### Molnutveckling (Valfritt)

Om du behover testa mot riktiga molntjanster (t.ex. riktiga push-notiser, riktig Google-inloggning):

1. **Firebase-installation**
   - Skapa ett Firebase-projekt pa [console.firebase.google.com](https://console.firebase.google.com)
   - Aktivera **Google-inloggning** och **Apple-inloggning** under Autentisering
   - Aktivera **Firestore**, **Realtime Database** och **Cloud Messaging**
   - Ladda ner `google-services.json` och placera den i `app/src/dev/`

2. **Express API-installation**
   ```bash
   cd express-api
   cp .env.example .env  # Redigera med dina molnuppgifter
   npm install
   npm start
   ```

3. **Distribuera Firestore-regler**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Bygg Android-appen** (dev-flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Miljovariabler

| Variabel | Beskrivning | Var |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK-tjanstekonto-JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2-konto-ID | Express API |
| `R2_ACCESS_KEY_ID` | R2-atkomstnyckel | Express API |
| `R2_SECRET_ACCESS_KEY` | R2-hemlig nyckel | Express API |
| `R2_BUCKET_NAME` | R2-hinknamn (standard: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | LiveKit API-nyckel | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API-hemlighet | Express API |
| `LIVEKIT_URL` | LiveKit-server-URL | Android-app (BuildConfig) |
| `WORKER_URL` | Express API-bas-URL | Android-app (BuildConfig) |

## Testning

### Kora tester lokalt

```bash
# Interaktiv testmeny (valj vad du vill kora):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Eller kor enskilda testsviter:
bash local/test-unit.sh       # Kotlin + Express API enhetstester
bash local/test-playwright.sh # Playwright webbtester (kraver lokal miljo)
bash local/test-e2e.sh        # Android E2E-tester (kraver lokal miljo + enhet)
bash local/test-lint.sh       # ktlint + ESLint

# Visa Allure-testrapport:
npx allure serve allure-results
```

### Testsviter

| Svit | Kommando | Antal |
|-------|---------|-------|
| Kotlin enhetstester | `./gradlew test` | 100+ tester |
| Express API-tester | `cd express-api && npm test` | 1 540+ tester |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 funktionsfiler |
| Playwright webbtester | `npx playwright test` | 28 specifikationer |

```bash
# Kotlin/KMP enhetstester
./gradlew test

# Express API-tester
cd express-api && npm test

# E2E-tester (kraver ansluten enhet eller emulator)
./gradlew connectedDevDebugAndroidTest

# Playwright webbtester (kraver att adminpanelen kor)
npx playwright test
```

### Testning i CI

I CI kors Playwright- och Android E2E-tester mot samma lokala miljo (emulatorer + Docker) -- inga molntjanster anvands. Detta sakerstaller att tester aldrig paverkar riktiga testare.

## Felsokning

- **Port redan i anvandning**: `lsof -i :<port>` (Linux/macOS) eller `netstat -ano | findstr :<port>` (Windows) for att hitta vad som anvander porten.
- **Docker kor inte**: Se till att Docker Desktop ar startat. Kor `docker ps` for att verifiera.
- **Firebase-emulatorer startar inte**: Kraver Java 11+. Kontrollera med `java -version`.
- **Android-bygget misslyckas**: Se till att JDK 17+ och Android SDK ar installerade. Prova `./gradlew clean`.
- **adb-enhet hittas inte**: Aktivera USB-felsookning. Kor `adb devices` for att kontrollera.
- **Bilder laddas inte**: MinIO-hinken kanske inte har skapats. Kor `cd express-api && NODE_ENV=local node ../local/seed.js`. For fysiska enheter, kor `adb reverse tcp:9002 tcp:9002`.
- **OTP kommer inte**: Kontrollera konsolutdata for `[OTP-LOCAL]`-rader. Kolla ocksa Mailpit UI pa http://localhost:8025.
- **Aterstall emulatordata**: Ta bort katalogen `local/firebase-emulator-data/` och starta om.
- **Aterstall MinIO-data**: Kor `docker compose -f local/docker-compose.yml down -v` for att ta bort volymer.

## Distribution

Distributioner hanteras genom GitHub Actions-arbetsfloden (`.github/workflows/`):

| Arbetsflode | Utlosare | Vad det gor |
|----------|---------|-------------|
| **PR Checks** | Automatiskt vid PR till `main` | Kor lint, Kotlin-tester, Express API-tester, Playwright-tester (baserat pa andrade filer) |
| **Deploy to Dev** | Manuellt (`workflow_dispatch`) | Distribuerar Express API + webb till dev, delar ut APK till testare, kor valfritt Playwright-tester |
| **Deploy to Prod** | Manuellt (`workflow_dispatch`) | Distribuerar en taggad release till prod -- Express API, webb, Play Store och App Store |

Ytterligare arbetsfloden: **E2E Tests** (Android-emulatormatris), **SonarCloud** (statisk analys), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Distribuerad till Oracle Cloud VM via SSH + PM2 (dev: London, prod: Singapore)
- **Android:** Paketerad och uppladdad till Google Play via CI
- **iOS:** Byggd och uppladdad till App Store Connect / TestFlight via CI
- **Adminpanel / webb:** Distribuerad till Cloudflare Pages

## Bidra

Bidrag ar valkommen! Se [CONTRIBUTING.md](CONTRIBUTING.md) for riktlinjer.

## Licens

Detta projekt ar licensierat under Apache License 2.0. Se [LICENSE](LICENSE) for detaljer.

## Tackord

- [Firebase](https://firebase.google.com) -- Autentisering, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Rostkommunikation i realtid
- [Cloudflare](https://www.cloudflare.com) -- R2-lagring, Pages-hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Gratis VM for Express API
- [Express.js](https://expressjs.com) -- API-serverramverk
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Modernt deklarativt UI
- [Koin](https://insert-koin.io) -- Lattviktig dependency injection
- [Coil](https://coil-kt.github.io/coil/) -- Bildladdning for Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Animerade present- och UI-effekter
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Multiplattform datum/tid
