# ShyTalk

**Sprachchat-Raeume, neu gedacht.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | **Deutsch** | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Ueber das Projekt

ShyTalk ist eine soziale Sprachchat-App, in der Nutzer Echtzeit-Sprachchatraeume erstellen und ihnen beitreten koennen. Entwickelt mit Kotlin Multiplatform (KMP), unterstuetzt es sowohl Android als auch iOS mit einer gemeinsamen Codebasis. Egal ob du ein Gespraech moderieren, zuhoeren oder dich mit Menschen auf der ganzen Welt verbinden moechtest -- ShyTalk macht es einfach.

iOS ist eine unterstuetzte Plattform, aber dieser Leitfaden konzentriert sich auf die Android-Entwicklung, die das primaere Entwicklungsziel ist.

## Funktionen

### Sprachchat-Raeume
- Erstelle oder trete Raeumen mit Echtzeit-Sprache bei, unterstuetzt durch LiveKit
- Strukturiertes Sitzsystem mit Eigentuemer-, Moderator- und Teilnehmerrollen
- Sitzanfragen und Einladungen -- fordere einen Sitzplatz an oder lade Zuhoerer zum Sprechen ein
- Schwebendes Chatfenster -- fuehre den Sprachchat fort, waehrend du andere Teile der App durchsuchst
- Raum-Ablauf -- Raeume schliessen automatisch, wenn der Eigentuemer abwesend ist, mit Countdown-Timern

### Nachrichten
- Live-Textchat neben Sprache in jedem Raum
- Private Nachrichten mit 1-zu-1-Gespraechen
- Gruppenchats mit Mitgliederverwaltung und Berechtigungen
- Tipp-Indikatoren in Echtzeit
- Sticker-Unterstuetzung

### Soziales
- Anpassbare Nutzerprofile mit Fotos, Titelbildern, Nationalitaetsflaggen und Biografien
- Folge-System -- folge anderen Nutzern und sieh, wann sie aktiv sind
- Geschenke-Wand -- prasentiere erhaltene Geschenke von anderen Nutzern
- Blockier-System -- blockiere Nutzer ueber Raeume und Profile hinweg

### Virtuelle Wirtschaft
- Muenzbasierte Wirtschaft mit Wallet und Transaktionsverlauf
- Taegliche Login-Belohnungen mit Serien-Boni
- Gluecksrad-System (Gacha) mit gestaffelten Preisen
- Virtuelle Geschenke -- sende und empfange animierte Geschenke waehrend Sprachchats
- Rucksack-Inventar zum Aufbewahren von Geschenken
- Muenzpakete zum Kauf von Muenzen
- Broadcast-Banner mit animierten Geschenk-Effekten

### Konto & Identitaet
- Multi-Provider-Authentifizierung -- melde dich mit Google, Apple oder E-Mail (OTP) an
- Verknuepfe mehrere Anmeldemethoden mit einem einzelnen Konto
- Stabile Nutzeridentitaet (uniqueId), die ueber Firebase-Projekte hinweg bestehen bleibt
- Verwaltung verknuepfter Konten in den Einstellungen mit Verknuepfungs-/Entknuepfungsunterstuetzung
- Geraetebindung -- jedes Geraet ist dauerhaft mit einem Konto verbunden

### Moderation & Sicherheit
- Moderationswerkzeuge -- stummschalten, kicken, Sitze verschieben und Moderatoren als Raumeigentuemer verwalten
- Nutzermeldesystem mit Ueberpruefungs-Workflow
- Verwarnungs- und Sperrsystem fuer Richtlinienverstoesze
- Bildschirme fuer Gemeinschaftsstandards, Datenschutzrichtlinie und Nutzungsbedingungen
- Rechtshinweis-Akzeptanzfluss fuer neue Nutzer
- Erzwungenes Update fuer veraltete App-Versionen

### Startbildschirme
- Konfigurierbare Startbildschirme, die beim App-Start angezeigt werden
- Vom Administrator verwalteter Inhalt mit Planungs- und Targeting-Optionen

### Sicherheit
- PIN-Code-Schutz fuer den App-Zugang
- Biometrische Authentifizierung -- Fingerabdruck und Gesichtserkennung
- OTP-Verifizierung (Einmalpasswort) fuer sensible Aktionen

### Admin-Panel
- Webbasiertes Moderations-Dashboard auf der statischen Seite des Projekts
- Nutzerverwaltung, Inhaltsmoderation und Konfiguration
- Vorlagen- und Geschenkverwaltung mit Live-Vorschau
- Echtzeit-Log-Streaming und Benachrichtigungen

### Bildkomprimierung
- Automatische Bildkomprimierung beim Upload ueber die Express API
- Reduziert Speicher- und Bandbreitenkosten bei gleichzeitiger Qualitaetserhaltung

### Internationalisierung
- 19 Sprachen von Haus aus unterstuetzt
- Vollstaendige Lokalisierung aller nutzersichtbaren Texte

### Logging & Ueberwachung
- Strukturiertes Logging ueber Express API, mobile Apps und Admin-Panel
- Echtzeit-Log-Streaming im Admin-Dashboard
- Geraete- und Netzwerkbann mit automatischer Durchsetzung
- Benachrichtigungssystem fuer kritische Fehler und Anomalien
- Trace-ID-Weitergabe fuer End-to-End-Anfragenverfolgung

## Technologie-Stack

| Schicht | Technologie |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architektur** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Authentifizierung** | Firebase Authentication (Google, Apple, Email+OTP) mit Multi-Provider-Identitaetssystem |
| **Datenbank** | Cloud Firestore |
| **Echtzeit** | Firebase Realtime Database |
| **Speicher** | Cloudflare R2 (ueber Express API Proxy) |
| **API-Server** | Express.js auf Oracle Cloud Free Tier |
| **Sprache** | LiveKit (self-hosted on Oracle Cloud) |
| **Push-Benachrichtigungen** | Firebase Cloud Messaging |
| **Bildladen** | Coil 3 (KMP) |
| **Animationen** | Lottie Compose |
| **Datum/Zeit** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Architektur

ShyTalk folgt dem **MVVM**-Muster mit einem sauberen **Repository Pattern**:

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

- **Shared-Modul** (`commonMain`) -- Modelle, Repository-Interfaces, ViewModels und UI, geteilt ueber Plattformen
- **App-Modul** -- Android-spezifische Bildschirme, Repository-Implementierungen und Einstiegspunkt
- **iosApp-Modul** -- iOS-spezifischer Einstiegspunkt
- **express-api** -- Express.js-Backend auf Oracle Cloud Free Tier

## Projektstruktur

```
ShyTalk/
+-- app/                              # Android-App-Modul
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Anwendungs-Einstiegspunkt
|       |   +-- MainActivity.kt       # Hauptaktivitaet
|       |   +-- core/
|       |   |   +-- di/               # Koin DI-Modul
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit-Sprache, Praesenz, Benachrichtigungen
|       |   |   +-- repository/       # Repository-Implementierungen
|       |   +-- feature/
|       |   |   +-- auth/             # Google-Anmelde-Bildschirm
|       |   |   +-- profile/          # Profil-Bildschirm
|       |   |   +-- room/             # Raum-Bildschirm
|       |   |   +-- settings/         # App-Einstellungen
|       |   +-- navigation/           # NavGraph & Bildschirmrouten
|       +-- test/                     # Unit-Tests
|       +-- androidTest/              # E2E-Tests (Compose UI Test)
+-- shared/                           # KMP Shared-Modul
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Geteilte Koin-Module
|       |   +-- model/                # Datenmodelle (User, ChatRoom, Gift usw.)
|       |   +-- ui/                   # Geteilte Komponenten
|       |   +-- util/                 # Hilfsfunktionen & Konstanten
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService usw.
|       |   +-- repository/           # Repository-Interfaces
|       +-- feature/                  # Geteilte Feature-Module
+-- iosApp/                           # iOS-App-Modul
+-- express-api/                      # Express.js API-Server
|   +-- src/
|       +-- routes/                   # API-Routen-Handler
|       +-- middleware/               # Auth, Logging-Middleware
|       +-- utils/                    # Firebase Admin, R2, Logger
|       +-- cron/                     # Geplante Aufgaben
+-- public/                           # Statische Seite & Admin-Panel
+-- local/                            # Lokale Entwicklungsumgebung (Emulatoren, Testdaten)
+-- tests/web/                        # Playwright-Browsertests
+-- scripts/                          # Hilfsskripte
+-- .github/workflows/                # CI/CD (PR-Checks, Deploy zu Dev/Prod, E2E, Lint)
+-- firestore.rules                   # Firestore-Sicherheitsregeln
+-- database.rules.json               # RTDB-Sicherheitsregeln
+-- firestore.indexes.json            # Zusammengesetzte Firestore-Indizes
+-- firebase.json                     # Firebase-Konfiguration
```

## Erste Schritte

### Voraussetzungen

- **Android Studio** Ladybug oder neuer
- **JDK 21+**
- **Node.js 24+**
- **Docker** (fuer LiveKit-Sprachserver, MinIO-Speicher, Mailpit-E-Mail)
- **Firebase CLI** (`npm install -g firebase-tools`)

Keine Cloud-Konten erforderlich um loszulegen -- die lokale Umgebung laeuft vollstaendig offline.

### Lokale Entwicklung (Empfohlen)

Der schnellste Weg, um loszulegen. Ein Befehl startet alles -- Firebase-Emulatoren, Docker-Container, Express API und baut die Android-App. Keine Cloud-Konten noetig, keine Kosten, keine Kontingentbegrenzungen.

1. **Klonen und installieren**
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

   Dieser einzelne Befehl:
   - Startet Docker-Container (LiveKit-Sprachserver, MinIO-Speicher, Mailpit-E-Mail)
   - Startet Firebase-Emulatoren (Firestore, Auth, RTDB)
   - Seedet Testdaten und erstellt den MinIO-Speicher-Bucket
   - Startet die Express API
   - Baut und installiert die Android-App (wenn ein Geraet angeschlossen ist)

   Wenn bereit, siehst du:
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

3. **Anmelden**
   - Verwende den E-Mail-Anmeldefluss mit dem geseedeten Testkonto: `claude-test@shytalk.dev` / `localdev123`
   - Oder erstelle ein neues Konto -- es verwendet die lokalen Emulatoren
   - Google/Apple-Anmeldung funktioniert lokal nicht (kein echtes OAuth) -- verwende stattdessen E-Mail-OTP
   - OTP-Codes werden von Mailpit erfasst -- pruefe http://localhost:8025

4. **Auf einem physischen Geraet ausfuehren**

   Dein Telefon muss sich im **selben Wi-Fi-Netzwerk** wie dein Entwicklungsrechner befinden.

   a. Finde die lokale IP deines Rechners:
   ```bash
   # Windows
   ipconfig    # Suche nach "IPv4 Address" unter deinem Wi-Fi-Adapter (z.B. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # oder: ip addr show
   ```

   b. Aktualisiere den lokalen Build-Flavor, um deine IP statt `10.0.2.2` zu verwenden. In `app/build.gradle.kts` finde den `local`-Flavor und aendere:
   ```kotlin
   // Ersetze 10.0.2.2 durch die lokale IP deines Rechners
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Verbinde dein Geraet per USB und aktiviere USB-Debugging, dann:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternativ verwende **adb reverse**, um Codeaenderungen zu vermeiden (Geraet leitet localhost zu deinem Rechner weiter):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore-Emulator
   adb reverse tcp:9099 tcp:9099   # Auth-Emulator
   adb reverse tcp:9000 tcp:9000   # RTDB-Emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (Bildspeicher)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Mit `adb reverse` funktionieren die Standard-`10.0.2.2`-Adressen im lokalen Flavor auch auf einem physischen Geraet -- keine Build-Konfigurationsaenderungen noetig.

5. **Lokale Dienste stoppen**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Oder druecke `Ctrl+C` im Startskript-Terminal. Emulatordaten werden automatisch gespeichert und beim naechsten Start wiederhergestellt.

### Nuetzliche URLs fuer lokale Entwicklung

| Dienst | URL | Zweck |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Firestore-Daten, Auth-Nutzer, RTDB durchsuchen |
| Express API | http://localhost:3000 | Backend-API |
| Gesundheitspruefung | http://localhost:3000/api/health | Pruefen, ob die API laeuft |
| Mailpit | http://localhost:8025 | Erfasste E-Mails und OTP-Codes anzeigen |
| MinIO Console | http://localhost:9001 | Hochgeladene Bilder und Dateien durchsuchen |

### Optionale Dienste

**LibreTranslate (Nachrichtenuebersetung)**

Optionales Docker-Image (6 GB+) zum lokalen Testen der Uebersetzungsfunktion:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Nicht im Standard-Setup enthalten wegen der groszen Image-Groesze. Die Uebersetzung funktioniert auch ohne -- Nachrichten bleiben einfach unuebersetzt.

### Cloud-Entwicklung (Optional)

Wenn du gegen echte Cloud-Dienste testen musst (z.B. echte Push-Benachrichtigungen, echte Google-Anmeldung):

1. **Firebase einrichten**
   - Erstelle ein Firebase-Projekt unter [console.firebase.google.com](https://console.firebase.google.com)
   - Aktiviere **Google-Anmeldung** und **Apple-Anmeldung** unter Authentifizierung
   - Aktiviere **Firestore**, **Realtime Database** und **Cloud Messaging**
   - Lade `google-services.json` herunter und platziere es in `app/src/dev/`

2. **Express API einrichten**
   ```bash
   cd express-api
   cp .env.example .env  # Mit deinen Cloud-Anmeldedaten bearbeiten
   npm install
   npm start
   ```

3. **Firestore-Regeln bereitstellen**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Android-App bauen** (dev-Flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Umgebungsvariablen

| Variable | Beschreibung | Wo |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK Dienstkonto-JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 Konto-ID | Express API |
| `R2_ACCESS_KEY_ID` | R2-Zugriffsschluessel | Express API |
| `R2_SECRET_ACCESS_KEY` | R2-Geheimschluessel | Express API |
| `R2_BUCKET_NAME` | R2-Bucket-Name (Standard: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | LiveKit API-Schluessel (Asien/Singapur) | Express API |
| `LIVEKIT_SECRET_ASIA` | LiveKit API-Geheimnis (Asien/Singapur) | Express API |
| `LIVEKIT_URL_ASIA` | LiveKit-Server-URL (Asien) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | LiveKit API-Schluessel (EU/London) | Express API |
| `LIVEKIT_SECRET_EU` | LiveKit API-Geheimnis (EU/London) | Express API |
| `LIVEKIT_URL_EU` | LiveKit-Server-URL (EU) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | LiveKit API-Schluessel (Fallback wenn regionale Schluessel nicht gesetzt) | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API-Geheimnis (Fallback wenn regionale Schluessel nicht gesetzt) | Express API |
| `LIVEKIT_URL` | LiveKit-Server-URL (wird zur Build-Zeit in die Android-App eingebettet) | Android-App (BuildConfig) |
| `WORKER_URL` | Express API Basis-URL | Android-App (BuildConfig) |

## Tests

### Tests lokal ausfuehren

```bash
# Interaktives Testmenue (waehle was du ausfuehren moechtest):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Oder einzelne Suiten ausfuehren:
bash local/test-unit.sh       # Kotlin + Express API Unit-Tests
bash local/test-playwright.sh # Playwright Web-Tests (benoetigt lokale Umgebung)
bash local/test-e2e.sh        # Android E2E-Tests (benoetigt lokale Umgebung + Geraet)
bash local/test-lint.sh       # ktlint + ESLint

# Allure-Testbericht anzeigen:
npx allure serve allure-results
```

### Test-Suiten

| Suite | Befehl | Anzahl |
|-------|---------|-------|
| Kotlin Unit-Tests | `./gradlew test` | 100+ Tests |
| Express API Tests | `cd express-api && npm test` | 1.540+ Tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 Feature-Dateien |
| Playwright Web-Tests | `npx playwright test` | 28 Spezifikationen |

```bash
# Kotlin/KMP Unit-Tests
./gradlew test

# Express API Tests
cd express-api && npm test

# E2E-Tests (erfordert verbundenes Geraet oder Emulator)
./gradlew connectedDevDebugAndroidTest

# Playwright-Browsertests (erfordert laufendes Admin-Panel)
npx playwright test
```

### Testen in CI

In CI laufen Playwright- und Android-E2E-Tests gegen dieselbe lokale Umgebung (Emulatoren + Docker) -- es werden keine Cloud-Dienste verwendet. Dies stellt sicher, dass Tests niemals echte Tester beeintraechtigen.

## Fehlerbehebung

- **Port bereits belegt**: `lsof -i :<port>` (Linux/macOS) oder `netstat -ano | findstr :<port>` (Windows) um herauszufinden, was den Port verwendet.
- **Docker laeuft nicht**: Stelle sicher, dass Docker Desktop gestartet ist. Fuehre `docker ps` zur Ueberpruefung aus.
- **Firebase-Emulatoren starten nicht**: Erfordert Java 21+. Pruefe mit `java -version`.
- **Android-Build schlaegt fehl**: Stelle sicher, dass JDK 21+ und Android SDK installiert sind. Versuche `./gradlew clean`.
- **adb-Geraet nicht erkannt**: Aktiviere USB-Debugging. Fuehre `adb devices` zur Ueberpruefung aus.
- **Bilder laden nicht**: MinIO-Bucket wurde moeglicherweise nicht erstellt. Fuehre `cd express-api && NODE_ENV=local node ../local/seed.js` aus. Fuer physische Geraete, fuehre `adb reverse tcp:9002 tcp:9002` aus.
- **OTP kommt nicht an**: Pruefe die Konsolenausgabe auf `[OTP-LOCAL]`-Zeilen. Pruefe auch die Mailpit-UI unter http://localhost:8025.
- **Emulatordaten zuruecksetzen**: Loesche das Verzeichnis `local/firebase-emulator-data/` und starte neu.
- **MinIO-Daten zuruecksetzen**: Fuehre `docker compose -f local/docker-compose.yml down -v` aus, um Volumes zu entfernen.

## Bereitstellung

Bereitstellungen werden ueber GitHub Actions Workflows verwaltet (`.github/workflows/`):

| Workflow | Ausloeser | Was er macht |
|----------|---------|-------------|
| **PR Checks** | Automatisch bei PRs zu `main` | Fuehrt Lint, Kotlin-Tests, Express API-Tests, Playwright-Tests aus (basierend auf geaenderten Dateien) |
| **Deploy to Dev** | Manuell (`workflow_dispatch`) | Stellt Express API + Web in dev bereit, verteilt APK an Tester, fuehrt optional Playwright-Tests aus |
| **Deploy to Prod** | Manuell (`workflow_dispatch`) | Stellt ein getaggtes Release in prod bereit -- Express API, Web, Play Store und App Store |

Zusaetzliche Workflows: **E2E Tests** (Android-Emulator-Matrix), **SonarCloud** (statische Analyse), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Auf Oracle Cloud VMs bereitgestellt via SSH + PM2 (dev: London, prod: Singapur)
- **Android:** Gebundelt und zu Google Play hochgeladen via CI
- **iOS:** Gebaut und zu App Store Connect / TestFlight hochgeladen via CI
- **Admin-Panel / Web:** Auf Cloudflare Pages bereitgestellt

## Mitwirken

Beitraege sind willkommen! Bitte siehe [CONTRIBUTING.md](CONTRIBUTING.md) fuer Richtlinien.

## Lizenz

Dieses Projekt ist unter der Apache-Lizenz 2.0 lizenziert. Siehe [LICENSE](LICENSE) fuer Details.

## Danksagungen

- [Firebase](https://firebase.google.com) -- Authentifizierung, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Echtzeit-Sprachkommunikation
- [Cloudflare](https://www.cloudflare.com) -- R2-Speicher, Pages-Hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Kostenlose VM-Stufe fuer Express API
- [Express.js](https://expressjs.com) -- API-Server-Framework
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Moderne deklarative UI
- [Koin](https://insert-koin.io) -- Leichtgewichtige Dependency Injection
- [Coil](https://coil-kt.github.io/coil/) -- Bildladen fuer Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Animierte Geschenk- und UI-Effekte
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Multiplattform Datum/Zeit
