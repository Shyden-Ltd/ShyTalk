# ShyTalk

**Stanze di chat vocale, reinventate.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | **Italiano** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Informazioni

ShyTalk e un'app sociale di chat vocale in cui gli utenti possono creare e unirsi a stanze di chat vocale in tempo reale. Costruita con Kotlin Multiplatform (KMP), supporta sia Android che iOS con una base di codice condivisa. Che tu voglia ospitare una conversazione, ascoltare o connetterti con persone in tutto il mondo, ShyTalk lo rende facile.

## Funzionalita

### Stanze di chat vocale
- Crea o unisciti a stanze con voce in tempo reale alimentata da LiveKit
- Sistema di posti strutturato con ruoli di proprietario, host e partecipante
- Richieste e inviti per i posti -- richiedi di unirti a un posto o invita gli ascoltatori a parlare
- Chathead fluttuante -- continua la chat vocale mentre navighi in altre parti dell'app
- Scadenza della stanza -- le stanze si chiudono automaticamente quando il proprietario e assente, con timer per il conto alla rovescia

### Messaggistica
- Chat testuale in tempo reale accanto alla voce in ogni stanza
- Messaggistica privata con conversazioni 1-a-1
- Chat di gruppo con gestione dei membri e permessi
- Indicatori di digitazione in tempo reale
- Supporto sticker

### Sociale
- Profili utente personalizzabili con foto, immagini di copertina, bandiere di nazionalita e biografie
- Sistema di follow -- segui altri utenti e vedi quando sono attivi
- Muro dei regali -- mostra i regali ricevuti da altri utenti
- Sistema di blocco -- blocca utenti attraverso stanze e profili

### Economia virtuale
- Economia basata su monete con portafoglio e cronologia delle transazioni
- Ricompense di accesso giornaliero con bonus serie
- Sistema Giro Fortunato (gacha) con premi a livelli
- Regali virtuali -- invia e ricevi regali animati durante le chat vocali
- Inventario zaino per conservare i regali
- Pacchetti di monete per acquistare monete
- Banner di trasmissione con effetti regalo animati

### Account e identita
- Autenticazione multi-provider -- accedi con Google, Apple o Email (OTP)
- Collega piu metodi di accesso a un singolo account
- Identita utente stabile (uniqueId) che persiste attraverso i progetti Firebase
- Gestione Account Collegati nelle Impostazioni con supporto per collegamento/scollegamento
- Associazione dispositivo -- ogni dispositivo e permanentemente legato a un account

### Moderazione e sicurezza
- Strumenti di moderazione -- silenzia, espelli, sposta i posti e gestisci gli host come proprietario della stanza
- Sistema di segnalazione utenti con flusso di revisione
- Sistema di avvertimento e sospensione per violazioni delle politiche
- Schermate degli standard della comunita, informativa sulla privacy e termini di servizio
- Flusso di accettazione legale per i nuovi utenti
- Aggiornamento forzato per versioni obsolete dell'app

### Schermate di avvio
- Schermate di lancio configurabili mostrate all'avvio dell'app
- Contenuto gestito dall'amministratore con opzioni di pianificazione e targeting

### Sicurezza
- Protezione con codice PIN per l'accesso all'app
- Autenticazione biometrica -- impronta digitale e riconoscimento facciale
- Verifica OTP (password monouso) per azioni sensibili

### Pannello di amministrazione
- Dashboard di moderazione basata sul web nel sito statico del progetto
- Gestione utenti, moderazione dei contenuti e configurazione
- Gestione di template e regali con anteprima in tempo reale
- Streaming dei log in tempo reale e avvisi

### Compressione immagini
- Compressione automatica delle immagini al caricamento tramite Express API
- Riduce i costi di archiviazione e larghezza di banda preservando la qualita

### Internazionalizzazione
- 19 lingue supportate nativamente
- Localizzazione completa per tutte le stringhe rivolte all'utente

### Logging e monitoraggio
- Logging strutturato attraverso Express API, app mobili e pannello di amministrazione
- Streaming dei log in tempo reale nel dashboard di amministrazione
- Blocco dispositivi e reti con applicazione automatica
- Sistema di avvisi per errori critici e anomalie
- Propagazione Trace ID per il tracciamento delle richieste end-to-end

## Stack tecnologico

| Livello | Tecnologia |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architettura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Autenticazione** | Firebase Authentication (Google, Apple, Email+OTP) con sistema di identita multi-provider |
| **Database** | Cloud Firestore |
| **Tempo reale** | Firebase Realtime Database |
| **Archiviazione** | Cloudflare R2 (tramite proxy Express API) |
| **Server API** | Express.js su Oracle Cloud Free Tier |
| **Voce** | LiveKit |
| **Notifiche push** | Firebase Cloud Messaging |
| **Caricamento immagini** | Coil 3 (KMP) |
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

- **Modulo condiviso** (`commonMain`) -- Modelli, interfacce repository, ViewModel e UI condivisi tra le piattaforme
- **Modulo app** -- Schermate specifiche per Android, implementazioni repository e punto di ingresso
- **Modulo iosApp** -- Punto di ingresso specifico per iOS
- **express-api** -- Backend Express.js in esecuzione su Oracle Cloud Free Tier

## Struttura del progetto

```
ShyTalk/
+-- app/                              # Modulo app Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Punto di ingresso dell'applicazione
|       |   +-- MainActivity.kt       # Activity principale
|       |   +-- core/
|       |   |   +-- di/               # Modulo Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Voce LiveKit, presenza, notifiche
|       |   |   +-- repository/       # Implementazioni repository
|       |   +-- feature/
|       |   |   +-- auth/             # Schermata di accesso Google
|       |   |   +-- profile/          # Schermata profilo
|       |   |   +-- room/             # Schermata stanza
|       |   |   +-- settings/         # Impostazioni app
|       |   +-- navigation/           # NavGraph & percorsi schermata
|       +-- test/                     # Test unitari
|       +-- androidTest/              # Test E2E (Compose UI Test)
+-- shared/                           # Modulo condiviso KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Moduli Koin condivisi
|       |   +-- model/                # Modelli dati (User, ChatRoom, Gift, ecc.)
|       |   +-- ui/                   # Componenti condivisi
|       |   +-- util/                 # Utilita & costanti
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, ecc.
|       |   +-- repository/           # Interfacce repository
|       +-- feature/                  # Moduli funzionalita condivisi
+-- iosApp/                           # Modulo app iOS
+-- express-api/                      # Server Express.js API
|   +-- src/
|       +-- routes/                   # Handler dei percorsi API
|       +-- middleware/               # Auth, middleware di logging
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Attivita pianificate
+-- public/                           # Sito statico & pannello di amministrazione
+-- local/                            # Ambiente di sviluppo locale (emulatori, dati di seed)
+-- tests/web/                        # Test browser Playwright
+-- scripts/                          # Script di utilita
+-- .github/workflows/                # CI/CD (Controlli PR, Deploy su Dev/Prod, E2E, lint)
+-- firestore.rules                   # Regole di sicurezza Firestore
+-- database.rules.json               # Regole di sicurezza RTDB
+-- firestore.indexes.json            # Indici composti Firestore
+-- firebase.json                     # Configurazione Firebase
```

## Per iniziare

### Prerequisiti

- **Android Studio** Ladybug o piu recente
- **JDK 17+**
- **Node.js 24+**
- **Docker** (per il server LiveKit locale)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Sviluppo locale (Consigliato)

Il modo piu veloce per iniziare. Utilizza gli emulatori Firebase e un container Docker LiveKit locale -- nessun account cloud necessario, nessun costo, nessun limite di quota.

1. **Clona e installa**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Avvia i servizi locali**
   ```bash
   bash local/start.sh
   ```
   Questo avvia gli emulatori Firebase (Firestore, Auth, RTDB) e un container Docker LiveKit. Alla prima esecuzione, inserisce automaticamente i dati di test (utente admin, regali di esempio, configurazione).

   Vedrai:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Avvia Express API** (in un nuovo terminale)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Modifica i valori R2/SMTP se necessario
   npm run local
   ```
   L'API si avvia su `http://localhost:3000`. Test: `curl http://localhost:3000/api/health`

4. **Esegui sull'emulatore Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   Il build flavor `local` si connette a `10.0.2.2` (loopback dell'emulatore Android verso la tua macchina). Funziona subito -- nessuna configurazione aggiuntiva necessaria.

5. **Esegui su un dispositivo fisico**

   Il tuo telefono deve essere sulla **stessa rete Wi-Fi** della tua macchina di sviluppo.

   a. Trova l'IP locale della tua macchina:
   ```bash
   # Windows
   ipconfig    # Cerca "IPv4 Address" sotto il tuo adattatore Wi-Fi (es. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # o: ip addr show
   ```

   b. Aggiorna il build flavor locale per usare il tuo IP invece di `10.0.2.2`. In `app/build.gradle.kts`, trova il flavor `local` e cambia:
   ```kotlin
   // Sostituisci 10.0.2.2 con l'IP locale della tua macchina
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Collega il tuo dispositivo tramite USB e abilita il debug USB, poi:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. In alternativa, usa **adb reverse** per evitare di modificare il codice (il dispositivo reindirizza localhost alla tua macchina):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulatore Firestore
   adb reverse tcp:9099 tcp:9099   # Emulatore Auth
   adb reverse tcp:9000 tcp:9000   # Emulatore RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Con `adb reverse`, gli indirizzi predefiniti `10.0.2.2` nel flavor locale funzioneranno anche su un dispositivo fisico -- nessuna modifica alla configurazione di build necessaria.

6. **Accedi**
   - Usa il flusso di accesso via email con l'account di test inserito: `claude-test@shytalk.dev` / `localdev123`
   - Oppure crea un nuovo account -- utilizzera gli emulatori locali
   - L'accesso con Google/Apple non funziona localmente (nessun OAuth reale) -- usa l'OTP via email al suo posto

7. **Ferma i servizi locali**
   ```bash
   bash local/stop.sh
   ```
   Oppure premi `Ctrl+C` nel terminale `start.sh`. I dati dell'emulatore vengono salvati automaticamente e ripristinati al prossimo avvio.

### URL utili per lo sviluppo locale

| Servizio | URL | Scopo |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Esplora i dati Firestore, utenti Auth, RTDB |
| Express API | http://localhost:3000 | API backend |
| Controllo salute | http://localhost:3000/api/health | Verifica che l'API sia in esecuzione |

### Sviluppo cloud (Opzionale)

Se hai bisogno di testare con servizi cloud reali (es. notifiche push reali, accesso Google reale):

1. **Configurazione Firebase**
   - Crea un progetto Firebase su [console.firebase.google.com](https://console.firebase.google.com)
   - Abilita **Accesso Google** e **Accesso Apple** nell'Autenticazione
   - Abilita **Firestore**, **Realtime Database** e **Cloud Messaging**
   - Scarica `google-services.json` e posizionalo in `app/src/dev/`

2. **Configurazione Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Modifica con le tue credenziali cloud
   npm install
   npm start
   ```

3. **Deploy delle regole Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Compila l'app Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variabili d'ambiente

| Variabile | Descrizione | Dove |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON dell'account di servizio Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID account Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Chiave di accesso R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Chiave segreta R2 | Express API |
| `R2_BUCKET_NAME` | Nome del bucket R2 (predefinito: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | Chiave API LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Segreto API LiveKit | Express API |
| `LIVEKIT_URL` | URL del server LiveKit | App Android (BuildConfig) |
| `WORKER_URL` | URL base Express API | App Android (BuildConfig) |

## Test

| Suite | Comando | Quantita |
|-------|---------|-------|
| Test unitari Kotlin | `./gradlew test` | 100+ test |
| Test Express API | `cd express-api && npm test` | 1.540+ test |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 file di funzionalita |
| Test web Playwright | `npx playwright test` | 28 specifiche |

```bash
# Test unitari Kotlin/KMP
./gradlew test

# Test Express API
cd express-api && npm test

# Test E2E (richiede dispositivo connesso o emulatore)
./gradlew connectedDevDebugAndroidTest

# Test browser Playwright (richiede pannello di amministrazione in esecuzione)
npx playwright test
```

## Distribuzione

Le distribuzioni sono gestite tramite i workflow di GitHub Actions (`.github/workflows/`):

| Workflow | Trigger | Cosa fa |
|----------|---------|-------------|
| **PR Checks** | Automatico su PR verso `main` | Esegue lint, test Kotlin, test Express API, test Playwright (basato sui file modificati) |
| **Deploy to Dev** | Manuale (`workflow_dispatch`) | Distribuisce Express API + web su dev, distribuisce APK ai tester, esegue opzionalmente test Playwright |
| **Deploy to Prod** | Manuale (`workflow_dispatch`) | Distribuisce una release con tag in prod -- Express API, web, Play Store e App Store |

Workflow aggiuntivi: **E2E Tests** (matrice emulatore Android), **SonarCloud** (analisi statica), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Distribuito su VM Oracle Cloud tramite SSH + PM2 (dev: Londra, prod: Singapore)
- **Android:** Impacchettato e caricato su Google Play tramite CI
- **iOS:** Compilato e caricato su App Store Connect / TestFlight tramite CI
- **Pannello di amministrazione / Web:** Distribuito su Cloudflare Pages

## Contribuire

I contributi sono benvenuti! Consulta [CONTRIBUTING.md](CONTRIBUTING.md) per le linee guida.

## Licenza

Questo progetto e concesso in licenza sotto la Licenza Apache 2.0. Vedi [LICENSE](LICENSE) per i dettagli.

## Ringraziamenti

- [Firebase](https://firebase.google.com) -- Autenticazione, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Comunicazione vocale in tempo reale
- [Cloudflare](https://www.cloudflare.com) -- Archiviazione R2, hosting Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM di livello gratuito per Express API
- [Express.js](https://expressjs.com) -- Framework server API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI dichiarativa moderna
- [Koin](https://insert-koin.io) -- Iniezione di dipendenze leggera
- [Coil](https://coil-kt.github.io/coil/) -- Caricamento immagini per Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Effetti regalo e UI animati
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Data/ora multipiattaforma
