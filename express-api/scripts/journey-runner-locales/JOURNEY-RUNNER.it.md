# Runner dei journey-test on-device di ShyTalk

_Questa è una traduzione di JOURNEY-RUNNER.md._

`device-journey-runner.js` guida la **vera app ShyTalk su un telefono collegato**
attraverso journey utente end-to-end e scrive un **report dettagliato pass/fail** che
puoi leggere — così esegui un comando e leggi un report invece di toccare
ogni passaggio a mano.

È un runner **ibrido**. Ogni journey può fare assert su tre livelli contemporaneamente:

1. **UI** — tocca/ispeziona l'app dal vivo tramite `adb` + `uiautomator` (i
   `testTag` di Compose compaiono come `resource-id` nel dump; le finestre di dialogo vengono
   abbinate in base al loro testo visibile).
2. **Firestore** — legge direttamente l'emulatore locale (via `firebase-admin`) per
   confermare lo stato del database dietro ogni action.
3. **Server / API** — accede come ogni persona (un vero token ID Firebase
   dall'emulatore Auth) e chiama l'`express-api`, così verifica le **regole che
   il server impone** (il gate cohort OSA, l'override admin, la moderation) — che _non_
   sono visibili dalla sola UI.

> Le traduzioni di questa guida si trovano in `journey-runner-locales/` (20 lingue).

---

## 1. Prerequisiti

| Cosa ti serve                    | Come                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** in esecuzione | per gli emulatori Firebase + LiveKit/MinIO                                                                                                                    |
| **Lo stack locale attivo**       | `bash local/start.sh` (dalla root del repo) — avvia gli emulatori Firebase + l'express-api. Lascialo in esecuzione.                                           |
| **Personas inizializzate**       | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotente; inizializza il cast di test P‑02…P‑19 con password `localdev123`) |
| **Un telefono collegato**        | `adb devices` deve elencarne uno (cavo USB **oppure** `adb` wireless). Funziona anche un emulatore Android.                                                   |
| **Java 21+ e l'Android SDK**     | necessari solo la prima volta, così il runner può compilare l'app se l'APK manca                                                                              |

Il runner compila da sé l'APK debug `local` se non è già compilato.

---

## 2. Eseguilo

Dalla root del repo:

```sh
# Esegui l'intera suite contro lo stack locale
node express-api/scripts/device-journey-runner.js

# Vedi l'elenco dei journey senza eseguire nulla
node express-api/scripts/device-journey-runner.js --list

# Esegui solo journey specifici
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Forza prima una nuova compilazione dell'APK
node express-api/scripts/device-journey-runner.js --rebuild

# Elenco completo delle opzioni
node express-api/scripts/device-journey-runner.js --help
```

Opzioni: `--target local|dev` (default `local`) · `--serial <adb-serial>`
(default: selezione automatica) · `--journeys <ids>` · `--rebuild` · `--no-reset` (salta
la reinstallazione pulita nel journey smoke) · `--out <dir>` · `--list` · `--help`.

Il runner fissa **un** singolo serial adb per ogni comando, così funziona anche quando un
telefono compare due volte (USB + wireless). Per il target `local` configura
tunnel `adb reverse` affinché l'app on-device raggiunga lo stack sulla tua macchina.

---

## 3. Guarda i risultati

Al termine stampa un riepilogo e scrive, sotto `journey-results/`:

| File                            | Cosa                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Leggi questo** — per ogni journey, per ogni passaggio ✅/❌ con il motivo, i testTag a schermo e un link allo screenshot per ogni passaggio |
| `latest-report.json`            | gli stessi dati, leggibili dalla macchina                                                                                                     |
| `runs/<runId>/*.png`            | uno screenshot di ogni passaggio (sia pass _che_ fail)                                                                                        |
| `runs/<runId>/report.{md,json}` | il report archiviato per quella specifica esecuzione                                                                                          |

Il codice di uscita è `0` quando ogni journey è passato, `1` quando qualcuno è fallito. In caso di fallimento
il passaggio registra esattamente cosa c'era a schermo, così puoi vedere il _perché_ senza
ripilotare il telefono.

---

## 4. Cosa coprono i journey

Esegui `--list` per l'elenco aggiornato. A colpo d'occhio la suite copre:

- **Smoke** — installazione pulita → accettazione legale → sign-in, backend raggiungibile.
- **Sign-in cohort** — le personas adult / minor / admin accedono tramite il
  selettore di persona dev in-app; l'identità viene confermata rispetto all'overlay di debug e
  al campo `cohort` di Firestore.
- **Gate cohort OSA** — un minor non può seguire né visualizzare un adult (il server restituisce
  `404` e la write su Firestore non avviene mai), mentre le action della stessa cohort
  riescono — dimostrando che il gate è specifico per cohort, non un blocco generalizzato.
- **Admin** — l'override della cohort è solo per lo staff (un member normale viene rifiutato con
  `422`; un account staff riesce e scrive una riga di audit regolamentare).
- **Moderation** — report → suspend admin (+ audit) → appeal → unsuspend, interamente
  imposto dal server, con pulizia idempotente.

L'autenticazione nei journey usa sempre il **selettore di persona dev in-app** — mai
il vero sign-in Google/Apple.

> **Nota sulle specifiche dei journey.** I piani Gherkin in
> `.project/test-plans/manual/j01-j19` sono in parte _aspirazionali_: fanno riferimento a
> UI che l'app rilasciata non ha (ad es. una schermata di registrazione email/password, tab
> minor nascosti, una schermata di discovery). Il runner quindi mappa l'intento reale di
> ogni journey rispetto all'app + Firestore + API **effettivi**, e registra tali
> divergenze come finding invece di fallire su finzioni.

---

## 5. Risoluzione dei problemi

| Sintomo                                                     | Soluzione                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                       | Collega / abbina il telefono; verifica `adb devices`.                                                                           |
| Bloccato nel raggiungere SignIn / "backend NOT reachable"   | Lo stack locale non è attivo o i tunnel `adb reverse` non si sono impostati — riavvia `bash local/start.sh` ed esegui di nuovo. |
| `persona "<email>" not found in picker`                     | Le personas non sono inizializzate — esegui il comando di seed nel §1.                                                          |
| `Firestore assertions: ON` mancante / passaggi DB saltati   | Gli assert sul DB vengono eseguiti solo per `--target local`.                                                                   |
| La compilazione dell'APK fallisce                           | Apri il `gradle-build.log` stampato; assicurati che Java 21+ e l'Android SDK siano installati.                                  |
| Un passaggio fallisce su una schermata che non ti aspettavi | Apri lo screenshot indicato in `latest-report.md` per quel passaggio.                                                           |

---

## 6. Aggiungere un journey

I journey sono semplici oggetti con un metodo `run(device, reporter, ctx)`, composti
a partire dagli helper condivisi:

- `signInAs(device, reporter, ctx, email, nameToken)` — accede come persona tramite il
  selettore e attraversa gli interstitial di primo avvio fino alla Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, e `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Server: `getIdToken(email)` → il token ID di una persona, poi
  `apiCall(method, path, { token, body })`.

Avvolgi ogni assertion in `reporter.step(device, 'name', async () => { … })` — misura
il tempo del passaggio, ne cattura lo screenshot, registra pass/fail e, in caso di fallimento, cattura i
testTag a schermo. Aggiungi il nuovo oggetto all'array `all` in `buildJourneys`.

La logica pura (parsing, selettori, gestione degli arg) è testata a livello unit in
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`);
i livelli device/Firestore/API sono testati a livello di integrazione eseguendo la suite su un dispositivo reale.
