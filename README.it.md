# ShyTalk

**Stanze di chat vocale, reinventate.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | **Italiano** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Informazioni

ShyTalk e un'app social di chat vocale dove gli utenti possono creare e unirsi a stanze di chat vocale in tempo reale. Costruita con Kotlin Multiplatform (KMP), supporta sia Android che iOS con un codebase condiviso. Che tu voglia ospitare una conversazione, ascoltare o connetterti con persone di tutto il mondo, ShyTalk lo rende facile.

iOS e una piattaforma supportata ma questa guida si concentra sullo sviluppo Android, che e l'obiettivo di sviluppo principale.

## Funzionalita

### Stanze di Chat Vocale
- Crea o unisciti a stanze con voce in tempo reale alimentata da LiveKit
- Sistema di posti strutturato con ruoli di proprietario, host e partecipante
- Richieste e inviti ai posti -- richiedi di unirti a un posto o invita gli ascoltatori a parlare
- Chathead flottante -- continua la chat vocale mentre navighi altre parti dell'app
- Scadenza stanza -- le stanze si chiudono automaticamente quando il proprietario e assente, con timer di conto alla rovescia

### Messaggistica
- Chat testuale dal vivo accanto alla voce in ogni stanza
- Messaggistica privata con conversazioni 1-a-1
- Chat di gruppo con gestione membri e permessi
- Indicatori di digitazione in tempo reale
- Supporto sticker

### Social
- Profili utente personalizzabili con foto, immagini di copertina, bandiere di nazionalita e biografie
- Sistema di follow -- segui altri utenti e vedi quando sono attivi
- Muro dei regali -- mostra i regali ricevuti da altri utenti
- Sistema di blocco -- blocca utenti in stanze e profili

### Economia Virtuale
- Economia basata su monete con portafoglio e cronologia transazioni
- Ricompense di accesso giornaliero con bonus serie
- Sistema Lucky Spin (gacha) con premi a livelli
- Regali virtuali -- invia e ricevi regali animati durante le chat vocali
- Inventario zaino per conservare i regali
- Pacchetti di monete per acquistare monete
- Banner di trasmissione con effetti regalo animati

### Account e Identita
- Autenticazione multi-provider -- accedi con Google, Apple o Email (OTP)
- Collega piu metodi di accesso a un singolo account
- Identita utente stabile (uniqueId) che persiste tra i progetti Firebase
- Gestione account collegati nelle Impostazioni con supporto collegamento/scollegamento
- Binding del dispositivo -- ogni dispositivo e legato permanentemente a un account

### Moderazione e Sicurezza
- Strumenti di moderazione -- silenzia, espelli, sposta posti e gestisci host come proprietario della stanza
- Sistema di segnalazione utenti con workflow di revisione
- Sistema di avvertimenti e sospensioni per violazioni delle policy
- Schermate degli standard comunitari, politica sulla privacy e termini di servizio
- Flusso di accettazione legale per nuovi utenti
- Aggiornamento forzato per versioni dell'app obsolete

### Schermate di Avvio
- Schermate di lancio configurabili mostrate all'avvio dell'app
- Contenuto gestito dall'admin con opzioni di pianificazione e targeting

### Sicurezza
- Protezione con codice PIN per l'accesso all'app
- Autenticazione biometrica -- impronta digitale e riconoscimento facciale
- Verifica OTP (password monouso) per azioni sensibili

### Pannello Admin
- Dashboard di moderazione web-based sul sito statico del progetto
- Gestione utenti, moderazione contenuti e configurazione
- Gestione template e regali con anteprima dal vivo
- Streaming di log e alerting in tempo reale

### Compressione Immagini
- Compressione automatica delle immagini al caricamento via Express API
- Riduce i costi di storage e bandwidth mantenendo la qualita

### Internazionalizzazione
- 19 lingue supportate nativamente
- Localizzazione completa di tutte le stringhe visibili all'utente

### Logging e Monitoraggio
- Logging strutturato su Express API, app mobile e pannello admin
- Streaming di log in tempo reale nella dashboard admin
- Ban di dispositivi e reti con applicazione automatica
- Sistema di alerting per errori critici e anomalie
- Propagazione Trace ID per il tracciamento delle richieste end-to-end

## Stack Tecnologico

| Livello | Tecnologia |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architettura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Autenticazione** | Firebase Authentication (Google, Apple, Email+OTP) con sistema di identita multi-provider |
| **Database** | Cloud Firestore |
| **Real-time** | Firebase Realtime Database |
| **Storage** | Cloudflare R2 (via proxy Express API) |
| **Server API** | Express.js su Oracle Cloud Free Tier |
| **Voce** | LiveKit (self-hosted on Oracle Cloud) |
| **Notifiche Push** | Firebase Cloud Messaging |
| **Caricamento Immagini** | Coil 3 (KMP) |
| **Animazioni** | Lottie Compose |
| **Data/Ora** | kotlinx-datetime |
| **Navigazione** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Architettura

ShyTalk segue il pattern **MVVM** con un **Repository Pattern** pulito:

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

- **Modulo shared** (`commonMain`) -- Modelli, interfacce repository, ViewModel e UI condivisi tra piattaforme
- **Modulo app** -- Schermate specifiche Android, implementazioni repository e punto di ingresso
- **Modulo iosApp** -- Punto di ingresso specifico iOS
- **express-api** -- Backend Express.js in esecuzione su Oracle Cloud Free Tier

## Struttura del Progetto

```
ShyTalk/
+-- app/                              # Modulo app Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Punto di ingresso dell'applicazione
|       |   +-- MainActivity.kt       # Attivita principale
|       |   +-- core/
|       |   |   +-- di/               # Modulo Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Voce LiveKit, presenza, notifiche
|       |   |   +-- repository/       # Implementazioni repository
|       |   +-- feature/
|       |   |   +-- auth/             # Schermata accesso Google
|       |   |   +-- profile/          # Schermata profilo
|       |   |   +-- room/             # Schermata stanza
|       |   |   +-- settings/         # Impostazioni app
|       |   +-- navigation/           # NavGraph & rotte schermata
|       +-- test/                     # Test unitari
|       +-- androidTest/              # Test E2E (Compose UI Test)
+-- shared/                           # Modulo condiviso KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Moduli Koin condivisi
|       |   +-- model/                # Modelli dati (User, ChatRoom, Gift, ecc.)
|       |   +-- ui/                   # Componenti condivisi
|       |   +-- util/                 # Utilita e costanti
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, ecc.
|       |   +-- repository/           # Interfacce repository
|       +-- feature/                  # Moduli funzionalita condivisi
+-- iosApp/                           # Modulo app iOS
+-- express-api/                      # Server Express.js API
|   +-- src/
|       +-- routes/                   # Handler rotte API
|       +-- middleware/               # Middleware auth e logging
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Lavori pianificati
+-- public/                           # Sito statico & pannello admin
+-- local/                            # Ambiente di sviluppo locale (emulatori, dati seed)
+-- tests/web/                        # Test browser Playwright
+-- scripts/                          # Script di utilita
+-- .github/workflows/                # CI/CD (Check PR, Deploy su Dev/Prod, E2E, lint)
+-- firestore.rules                   # Regole di sicurezza Firestore
+-- database.rules.json               # Regole di sicurezza RTDB
+-- firestore.indexes.json            # Indici compositi Firestore
+-- firebase.json                     # Configurazione Firebase
```

## Iniziare

### Prerequisiti

- **Android Studio** Ladybug o successivo
- **JDK 21+**
- **Node.js 24+**
- **Docker** (per server vocale LiveKit, storage MinIO, email Mailpit)
- **Firebase CLI** (`npm install -g firebase-tools`)

Non servono account cloud per iniziare -- l'ambiente locale funziona completamente offline.

### Sviluppo Locale (Consigliato)

Il modo piu veloce per iniziare. Un comando avvia tutto -- emulatori Firebase, container Docker, Express API e compila l'app Android. Nessun account cloud necessario, nessun costo, nessun limite di quota.

1. **Clonare e installare**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Avviare tutto**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Questo singolo comando:
   - Avvia i container Docker (server vocale LiveKit, storage MinIO, email Mailpit)
   - Avvia gli emulatori Firebase (Firestore, Auth, RTDB)
   - Semina i dati di test e crea il bucket di storage MinIO
   - Avvia l'Express API
   - Compila e installa l'app Android (se un dispositivo e connesso)

   Quando pronto, vedrai:
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

3. **Accedere**
   - Usa il flusso di accesso via email con l'account di test: `claude-test@shytalk.dev` / `localdev123`
   - Oppure crea un nuovo account -- usera gli emulatori locali
   - L'accesso Google/Apple non funziona localmente (nessun OAuth reale) -- usa l'OTP via email
   - I codici OTP sono catturati da Mailpit -- controlla http://localhost:8025

4. **Eseguire su un Dispositivo Fisico**

   Il tuo telefono deve essere sulla **stessa rete Wi-Fi** della tua macchina di sviluppo.

   a. Trova l'IP locale della tua macchina:
   ```bash
   # Windows
   ipconfig    # Cerca "IPv4 Address" sotto il tuo adattatore Wi-Fi (es. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # oppure: ip addr show
   ```

   b. Aggiorna il flavor di build locale per usare il tuo IP al posto di `10.0.2.2`. In `app/build.gradle.kts`, trova il flavor `local` e modifica:
   ```kotlin
   // Sostituisci 10.0.2.2 con l'IP locale della tua macchina
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Collega il tuo dispositivo via USB e abilita il debug USB, poi:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. In alternativa, usa **adb reverse** per evitare modifiche al codice (il dispositivo instrada localhost alla tua macchina):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulatore Firestore
   adb reverse tcp:9099 tcp:9099   # Emulatore Auth
   adb reverse tcp:9000 tcp:9000   # Emulatore RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (storage immagini)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Con `adb reverse`, gli indirizzi predefiniti `10.0.2.2` nel flavor locale funzioneranno anche su un dispositivo fisico -- nessuna modifica alla configurazione di build necessaria.

5. **Fermare i servizi locali**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Oppure premi `Ctrl+C` nel terminale dello script di avvio. I dati dell'emulatore vengono salvati automaticamente e ripristinati al prossimo avvio.

### URL Utili per lo Sviluppo Locale

| Servizio | URL | Scopo |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Esplora dati Firestore, utenti Auth, RTDB |
| Express API | http://localhost:3000 | API backend |
| Health check | http://localhost:3000/api/health | Verifica che l'API sia in esecuzione |
| Mailpit | http://localhost:8025 | Visualizza email catturate e codici OTP |
| MinIO Console | http://localhost:9001 | Esplora immagini e file caricati |

### Servizi Opzionali

**LibreTranslate (Traduzione Messaggi)**

Immagine Docker opzionale da 6GB+ per testare la funzione di traduzione localmente:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Non inclusa nel setup predefinito a causa delle grandi dimensioni dell'immagine. La traduzione funziona senza -- i messaggi rimangono semplicemente non tradotti.

### Sviluppo Cloud (Opzionale)

Se hai bisogno di testare con servizi cloud reali (es. notifiche push reali, accesso Google reale):

1. **Setup Firebase**
   - Crea un progetto Firebase su [console.firebase.google.com](https://console.firebase.google.com)
   - Abilita **Accesso Google** e **Accesso Apple** nell'Autenticazione
   - Abilita **Firestore**, **Realtime Database** e **Cloud Messaging**
   - Scarica `google-services.json` e posizionalo in `app/src/dev/`

2. **Setup Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Modifica con le tue credenziali cloud
   npm install
   npm start
   ```

3. **Distribuire le regole Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Compilare l'app Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variabili d'Ambiente

| Variabile | Descrizione | Dove |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON dell'account di servizio Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID account Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Chiave di accesso R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Chiave segreta R2 | Express API |
| `R2_BUCKET_NAME` | Nome bucket R2 (predefinito: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | Chiave API LiveKit (Asia/Singapore) | Express API |
| `LIVEKIT_SECRET_ASIA` | Segreto API LiveKit (Asia/Singapore) | Express API |
| `LIVEKIT_URL_ASIA` | URL server LiveKit (Asia) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | Chiave API LiveKit (UE/Londra) | Express API |
| `LIVEKIT_SECRET_EU` | Segreto API LiveKit (UE/Londra) | Express API |
| `LIVEKIT_URL_EU` | URL server LiveKit (UE) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | Chiave API LiveKit (fallback quando le chiavi regionali non sono impostate) | Express API |
| `LIVEKIT_API_SECRET` | Segreto API LiveKit (fallback quando le chiavi regionali non sono impostate) | Express API |
| `LIVEKIT_URL` | URL server LiveKit (incorporato nell'app Android al momento della build) | App Android (BuildConfig) |
| `WORKER_URL` | URL base Express API | App Android (BuildConfig) |

## Test

### Eseguire Test Localmente

```bash
# Menu test interattivo (scegli cosa eseguire):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Oppure esegui suite individuali:
bash local/test-unit.sh       # Test unitari Kotlin + Express API
bash local/test-playwright.sh # Test web Playwright (richiede ambiente locale)
bash local/test-e2e.sh        # Test E2E Android (richiede ambiente locale + dispositivo)
bash local/test-lint.sh       # ktlint + ESLint

# Visualizza report test Allure:
npx allure serve allure-results
```

### Suite di Test

| Suite | Comando | Quantita |
|-------|---------|-------|
| Test unitari Kotlin | `./gradlew test` | 100+ test |
| Test Express API | `cd express-api && npm test` | 1.540+ test |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 file feature |
| Test web Playwright | `npx playwright test` | 28 specifiche |

```bash
# Test unitari Kotlin/KMP
./gradlew test

# Test Express API
cd express-api && npm test

# Test E2E (richiede dispositivo connesso o emulatore)
./gradlew connectedDevDebugAndroidTest

# Test browser Playwright (richiede pannello admin in esecuzione)
npx playwright test
```

### Test in CI

In CI, i test Playwright e Android E2E vengono eseguiti contro lo stesso ambiente locale (emulatori + Docker) -- nessun servizio cloud viene utilizzato. Questo assicura che i test non interferiscano mai con i tester reali.

## Risoluzione Problemi

- **Porta gia in uso**: `lsof -i :<port>` (Linux/macOS) o `netstat -ano | findstr :<port>` (Windows) per trovare cosa sta usando la porta.
- **Docker non in esecuzione**: Assicurati che Docker Desktop sia avviato. Esegui `docker ps` per verificare.
- **Gli emulatori Firebase non si avviano**: Richiede Java 21+. Controlla con `java -version`.
- **Build Android fallita**: Assicurati che JDK 21+ e Android SDK siano installati. Prova `./gradlew clean`.
- **Dispositivo adb non rilevato**: Abilita il debug USB. Esegui `adb devices` per controllare.
- **Le immagini non si caricano**: Il bucket MinIO potrebbe non essere stato creato. Esegui `cd express-api && NODE_ENV=local node ../local/seed.js`. Per dispositivi fisici, esegui `adb reverse tcp:9002 tcp:9002`.
- **OTP non arriva**: Controlla l'output della console per le righe `[OTP-LOCAL]`. Controlla anche l'UI di Mailpit su http://localhost:8025.
- **Reset dati emulatore**: Elimina la directory `local/firebase-emulator-data/` e riavvia.
- **Reset dati MinIO**: Esegui `docker compose -f local/docker-compose.yml down -v` per rimuovere i volumi.

## Deployment

I deployment sono gestiti tramite workflow di GitHub Actions (`.github/workflows/`):

| Workflow | Trigger | Cosa fa |
|----------|---------|-------------|
| **PR Checks** | Automatico sui PR a `main` | Esegue lint, test Kotlin, test Express API, test Playwright (in base ai file modificati) |
| **Deploy to Dev** | Manuale (`workflow_dispatch`) | Distribuisce Express API + web su dev, distribuisce APK ai tester, esegue opzionalmente test Playwright |
| **Deploy to Prod** | Manuale (`workflow_dispatch`) | Distribuisce un rilascio taggato su prod -- Express API, web, Play Store e App Store |

Workflow aggiuntivi: **E2E Tests** (matrice emulatori Android), **SonarCloud** (analisi statica), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Distribuita su VM Oracle Cloud via SSH + PM2 (dev: Londra, prod: Singapore)
- **Android:** Impacchettata e caricata su Google Play via CI
- **iOS:** Compilata e caricata su App Store Connect / TestFlight via CI
- **Pannello admin / web:** Distribuito su Cloudflare Pages

## Contribuire

I contributi sono benvenuti! Per favore consulta [CONTRIBUTING.md](CONTRIBUTING.md) per le linee guida.

## Licenza

Questo progetto e concesso in licenza sotto la Licenza Apache 2.0. Vedi [LICENSE](LICENSE) per i dettagli.

## Ringraziamenti

- [Firebase](https://firebase.google.com) -- Autenticazione, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Comunicazione vocale in tempo reale
- [Cloudflare](https://www.cloudflare.com) -- Storage R2, hosting Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM tier gratuito per Express API
- [Express.js](https://expressjs.com) -- Framework server API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI dichiarativa moderna
- [Koin](https://insert-koin.io) -- Iniezione di dipendenze leggera
- [Coil](https://coil-kt.github.io/coil/) -- Caricamento immagini per Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Effetti regalo e UI animati
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Data/ora multipiattaforma
