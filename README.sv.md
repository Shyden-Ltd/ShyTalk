# ShyTalk

**Rostrumschattrum, nytankt.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [العربية](README.ar.md) | [Deutsch](README.de.md) | [English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | **Svenska** | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Om

ShyTalk ar en social roschattapp dar anvandare kan skapa och ga med i rostchattrum i realtid. Byggd med Kotlin Multiplatform (KMP), stoder den bade Android och iOS med en delad kodbas. Oavsett om du vill vara vard for ett samtal, lyssna in, eller fa kontakt med manniskor runt om i varlden, gor ShyTalk det enkelt.

## Funktioner

### Rostchattrum
- Skapa eller ga med i rum med rostchatt i realtid, drivet av LiveKit
- Strukturerat platssystem med roller for agare, vard och deltagare
- Platsbegaran och inbjudningar -- begara att fa en plats eller bjud in lyssnare att tala
- Svavande chatthuvud -- fortsatt rostchatta medan du blaaddrar i andra delar av appen
- Rumets utgang -- rum stangs automatiskt nar agaren ar borta, med nedrakningsklockor

### Meddelanden
- Livechatt med text bredvid rosten i varje rum
- Privata meddelanden med en-till-en-konversationer
- Gruppchattar med medlemshantering och behorigheter
- Skrivindikator i realtid
- Stodjer klistermanken

### Socialt
- Anpassningsbara anvandarprofiler med foton, omslagsbilder, nationalitetsflaggor och bios
- Foljsystem -- folj andra anvandare och se nar de ar aktiva
- Gavovagg -- visa upp gavor fran andra anvandare
- Blockeringssystem -- blockera anvandare over rum och profiler

### Virtuell ekonomi
- Myntbaserad ekonomi med planbok och transaktionshistorik
- Dagliga inloggningsbeloaningar med bonusar for sviter
- Lucky Spin (gacha)-system med priser i olika nivaer
- Virtuella gavor -- skicka och ta emot animerade gavor under rostchattar
- Ryggsacksinventering for att lagra gavor
- Myntpaket for kop av mynt
- Sandningsbanners med animerade gavoeffekter

### Konto och identitet
- Fleranvandares autentisering -- logga in med Google, Apple eller e-post (OTP)
- Lanka flera inloggningsmetoder till ett enda konto
- Stabil anvandaridentitet (uniqueId) som bestaar over Firebase-projekt
- Hantering av lankade konton i Installningar med stod for lankining/avlankning
- Enhetsbindning -- varje enhet ar permanent kopplad till ett konto

### Moderering och sakerhet
- Modereringsverktyg -- tysta, sparka ut, flytta platser och hantera vardar som rumsagare
- Anvandarrapporteringssystem med granskningsarbetsflode
- Varnings- och avstangningssystem for policybrott
- Skarmar for gemenskapsstandarder, integritetspolicy och anvandarvillkor
- Flode for rattsligt godkannande for nya anvandare
- Tvingad uppdatering for foraaldrade appversioner

### Startskarmar
- Konfigurerbara startskarmar som visas vid appstart
- Adminhantererat innehall med schemalagganings- och maalgruoopsalternativ

### Sakerhet
- PIN-kodsskydd for appatkomst
- Biometrisk autentisering -- fingeravtryck och ansiktsigenkanning
- OTP (engangsloosenord) verifiering for kansliga atgarder

### Adminpanel
- Webbaserad modereringsinstrumentpanel paa projektets statiska webbplats
- Anvandarhantering, innehaallsmoderering och konfiguration
- Mall- och gavohantering med live-forhandsvisning
- Realtidslogstromning och varningar

### Bildkomprimering
- Automatisk bildkomprimering vid uppladdning via Express API
- Minskar lagrings- och bandbreddskostnader med bibehaallan kvalitet

### Internationalisering
- 19 spraak stods direkt
- Fullstandig lokalisering av alla anvandarriktade strangar

### Loggning och overvakning
- Strukturerad loggning over Express API, mobilappar och adminpanel
- Realtidslogstromning i admininstrumentpanelen
- Enhets- och natverksblockeringar med automatisk tillaampning
- Varningssystem for kritiska fel och avvikelser
- Trace ID-spridning for end-to-end-sparning av forfraaogningar

## Teknikstapel

| Lager | Teknik |
|-------|--------|
| **Ramverk** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Arkitektur** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Autentisering** | Firebase Authentication (Google, Apple, E-post+OTP) med fleranvandares identitetssystem |
| **Databas** | Cloud Firestore |
| **Realtid** | Firebase Realtime Database |
| **Lagring** | Cloudflare R2 (via Express API-proxy) |
| **API-server** | Express.js paa Oracle Cloud Free Tier |
| **Rost** | LiveKit |
| **Push-notiser** | Firebase Cloud Messaging |
| **Bildladdning** | Coil 3 (KMP) |
| **Animationer** | Lottie Compose |
| **Datum/Tid** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Arkitektur

ShyTalk foljer **MVVM** med ett rent **Repository Pattern**:

```
+---------------------------------------------+
|                   UI-lager                   |
|  Compose-skarmar -> ViewModels -> UI-tillstaand |
+---------------------------------------------+
|                 Domanlager                   |
|          Repository-granssnitt               |
+---------------------------------------------+
|                 Datalager                    |
|  Repository-impl -> Firestore / R2 / RTDB / LiveKit  |
+---------------------------------------------+
```

- **shared-modul** (`commonMain`) -- Modeller, repository-granssnitt, ViewModels och UI som delas over plattformar
- **app-modul** -- Android-specifika skarmar, repository-implementationer och startpunkt
- **iosApp-modul** -- iOS-specifik startpunkt
- **express-api** -- Express.js-backend som kors paa Oracle Cloud Free Tier

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
|       |   |   +-- remote/           # LiveKit-rost, narvaro, notiser
|       |   |   +-- repository/       # Repository-implementationer
|       |   +-- feature/
|       |   |   +-- auth/             # Google-inloggningsskarm
|       |   |   +-- profile/          # Profilskarm
|       |   |   +-- room/             # Rumsskarm
|       |   |   +-- settings/         # Appinstallningar
|       |   +-- navigation/           # NavGraph & skarmrutter
|       +-- test/                     # Enhetstester
|       +-- androidTest/              # E2E-tester (Compose UI Test)
+-- shared/                           # KMP delad modul
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Delade Koin-moduler
|       |   +-- model/                # Datamodeller (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Delade komponenter
|       |   +-- util/                 # Verktyg & konstanter
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Repository-granssnitt
|       +-- feature/                  # Delade funktionsmoduler
+-- iosApp/                           # iOS-appmodul
+-- express-api/                      # Express.js API-server
|   +-- src/
|       +-- routes/                   # API-rutthanterare
|       +-- middleware/               # Autentisering, loggning mellanprogramvara
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Schemalagda jobb
+-- public/                           # Statisk webbplats & adminpanel
+-- local/                            # Lokal utvecklingsmiljo (emulatorer, testdata)
+-- tests/web/                        # Playwright webblasartester
+-- scripts/                          # Verktygsscript
+-- .github/workflows/                # CI/CD (PR-kontroller, Distribuera till Dev/Prod, E2E, lint)
+-- firestore.rules                   # Firestores sakerhetsegler
+-- database.rules.json               # RTDB-sakerhetsregler
+-- firestore.indexes.json            # Firestores sammansatta index
+-- firebase.json                     # Firebase-konfiguration
```

## Kom igang

### Forutsattningar

- **Android Studio** Ladybug eller nyare
- **JDK 17+**
- **Node.js 24+**
- **Docker** (for lokal LiveKit-server)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Lokal utveckling (rekommenderas)

Det snabbaste sattet att komma igang. Anvander Firebase Emulators och en lokal LiveKit Docker-container -- inga molnkonton behövs, inga kostnader, inga kvotagranser.

1. **Klona och installera**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Starta lokala tjanster**
   ```bash
   bash local/start.sh
   ```
   Detta startar Firebase Emulators (Firestore, Auth, RTDB) och en LiveKit Docker-container. Vid forsta korningen skapas testdata automatiskt (admin-anvandare, exempelgavor, konfiguration).

   Du ser:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Starta Express API** (i en ny terminal)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Redigera R2/SMTP-varden vid behov
   npm run local
   ```
   API:et startar paa `http://localhost:3000`. Testa: `curl http://localhost:3000/api/health`

4. **Kor paa Android-emulator**
   ```bash
   ./gradlew installLocalDebug
   ```
   Byggsmaken `local` ansluter till `10.0.2.2` (Android-emulatorns loopback till din maskin). Det fungerar direkt -- ingen extra konfiguration behovs.

5. **Kor paa en fysisk enhet**

   Din telefon maste vara paa **samma Wi-Fi-natverk** som din utvecklingsmaskin.

   a. Hitta din maskins lokala IP:
   ```bash
   # Windows
   ipconfig    # Leta efter "IPv4 Address" under din Wi-Fi-adapter (t.ex. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # eller: ip addr show
   ```

   b. Uppdatera den lokala byggsmaken till att anvanda din IP istallet for `10.0.2.2`. I `app/build.gradle.kts`, hitta `local`-smaken och andra:
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

   d. Alternativt, anvand **adb reverse** for att slippa andra nagon kod (enheten dirigerar localhost till din maskin):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore-emulator
   adb reverse tcp:9099 tcp:9099   # Auth-emulator
   adb reverse tcp:9000 tcp:9000   # RTDB-emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Med `adb reverse` fungerar standardadresserna `10.0.2.2` i den lokala smaken aven paa en fysisk enhet -- inga andringar i byggkonfigurationen behövs.

6. **Logga in**
   - Anvand e-postinloggningsflödet med det forinlagda testkontot: `claude-test@shytalk.dev` / `localdev123`
   - Eller skapa ett nytt konto -- det anvander de lokala emulatorerna
   - Google/Apple-inloggning fungerar inte lokalt (ingen riktig OAuth) -- anvand e-post-OTP istallet

7. **Stoppa lokala tjanster**
   ```bash
   bash local/stop.sh
   ```
   Eller tryck `Ctrl+C` i `start.sh`-terminalen. Emulatordata sparas automatiskt och aterstalls vid nasta start.

### Anvaandbara lokala utvecklings-URL:er

| Tjanst | URL | Syfte |
|--------|-----|-------|
| Firebase Emulator UI | http://localhost:4000 | Bladdra i Firestore-data, Auth-anvandare, RTDB |
| Express API | http://localhost:3000 | Backend-API |
| Halsokontroll | http://localhost:3000/api/health | Verifiera att API:et kor |

### Molnutveckling (valfritt)

Om du behover testa mot riktiga molntjanster (t.ex. riktiga push-notiser, riktigt Google Sign-In):

1. **Firebase-installation**
   - Skapa ett Firebase-projekt paa [console.firebase.google.com](https://console.firebase.google.com)
   - Aktivera **Google Sign-In** och **Apple Sign-In** under Autentisering
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

4. **Bygg Android-appen** (dev-smak)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Miljovariabler

| Variabel | Beskrivning | Var |
|----------|-------------|-----|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK-tjaanstekonto JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2-konto-ID | Express API |
| `R2_ACCESS_KEY_ID` | R2-atkomstnyckel | Express API |
| `R2_SECRET_ACCESS_KEY` | R2-hemlig nyckel | Express API |
| `R2_BUCKET_NAME` | R2-hinknnam (standard: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | LiveKit API-nyckel | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API-hemlighet | Express API |
| `LIVEKIT_URL` | LiveKit-server-URL | Android-app (BuildConfig) |
| `WORKER_URL` | Express API-bas-URL | Android-app (BuildConfig) |

## Testning

| Svit | Kommando | Antal |
|------|----------|-------|
| Kotlin-enhetstester | `./gradlew test` | 100+ tester |
| Express API-tester | `cd express-api && npm test` | 1 540+ tester |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 funktionsfiler |
| Playwright webblasartester | `npx playwright test` | 28 specifikationer |

```bash
# Kotlin/KMP-enhetstester
./gradlew test

# Express API-tester
cd express-api && npm test

# E2E-tester (kraver ansluten enhet eller emulator)
./gradlew connectedDevDebugAndroidTest

# Playwright webblasartester (kraver att adminpanelen kor)
npx playwright test
```

## Distribution

Distributioner hanteras via GitHub Actions-arbetsfloden (`.github/workflows/`):

| Arbetsflode | Utlosare | Vad det gor |
|-------------|----------|-------------|
| **PR Checks** | Automatiskt vid PR till `main` | Kor lint, Kotlin-tester, Express API-tester, Playwright-tester (baserat paa andrade filer) |
| **Deploy to Dev** | Manuellt (`workflow_dispatch`) | Distribuerar Express API + webb till dev, distribuerar APK till testare, kor valfritt Playwright-tester |
| **Deploy to Prod** | Manuellt (`workflow_dispatch`) | Distribuerar en taggad release till prod -- Express API, webb, Play Store och App Store |

Ytterligare arbetsfloden: **E2E Tests** (Android-emulatormatris), **SonarCloud** (statisk analys), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Distribueras till Oracle Cloud-VM:ar via SSH + PM2 (dev: London, prod: Singapore)
- **Android:** Paketeras och laddas upp till Google Play via CI
- **iOS:** Byggs och laddas upp till App Store Connect / TestFlight via CI
- **Adminpanel / webb:** Distribueras till Cloudflare Pages

## Bidra

Bidrag ar valkommen! Se [CONTRIBUTING.md](CONTRIBUTING.md) for riktlinjer.

## Licens

Detta projekt ar licensierat under Apache License 2.0. Se [LICENSE](LICENSE) for detaljer.

## Tackord

- [Firebase](https://firebase.google.com) -- Autentisering, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Rostommunikation i realtid
- [Cloudflare](https://www.cloudflare.com) -- R2-lagring, Pages-hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Free Tier-VM for Express API
- [Express.js](https://expressjs.com) -- API-serverramverk
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Modernt deklarativt UI
- [Koin](https://insert-koin.io) -- Lattviktig dependency injection
- [Coil](https://coil-kt.github.io/coil/) -- Bildladdning for Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Animerade gavor och UI-effekter
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Multiplattforms datum/tid
