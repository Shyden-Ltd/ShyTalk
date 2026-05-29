# ShyTalk On-Device-Journey-Test-Runner

_Dies ist eine Übersetzung von JOURNEY-RUNNER.md._

`device-journey-runner.js` steuert die **echte ShyTalk-App auf einem verbundenen Telefon**
durch End-to-End-Benutzer-Journeys und schreibt einen **detaillierten Bestanden/Fehlgeschlagen-Bericht**,
den du lesen kannst – du führst also einen Befehl aus und liest einen Bericht, statt jeden
Schritt von Hand durchzutippen.

Es ist ein **hybrider** Runner. Jede Journey kann auf drei Ebenen gleichzeitig prüfen:

1. **UI** — tippt/inspiziert die laufende App über `adb` + `uiautomator` (Compose-
   `testTag`s erscheinen als `resource-id`s im Dump; Dialoge werden über
   ihren sichtbaren Text abgeglichen).
2. **Firestore** — liest den lokalen Emulator direkt (über `firebase-admin`), um
   den Datenbankzustand hinter jeder Aktion zu bestätigen.
3. **Server / API** — meldet sich als jede Persona an (echtes Firebase-ID-Token vom
   Auth-Emulator) und ruft die `express-api` auf, sodass die **Regeln geprüft werden,
   die der Server durchsetzt** (das OSA-Cohort-Gate, Admin-Override, Moderation) – die
   in der UI allein _nicht_ sichtbar sind.

> Übersetzungen dieser Anleitung liegen in `journey-runner-locales/` (20 Sprachen).

---

## 1. Voraussetzungen

| Du brauchst                           | Wie                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** läuft              | für die Firebase-Emulatoren + LiveKit/MinIO                                                                                                                    |
| **Der lokale Stack ist hochgefahren** | `bash local/start.sh` (vom Repo-Root) — startet die Firebase-Emulatoren + die express-api. Lass ihn laufen.                                                    |
| **Personas geseedet**                 | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotent; seedet die P‑02…P‑19-Test-Besetzung mit dem Passwort `localdev123`) |
| **Ein Telefon verbunden**             | `adb devices` muss eines auflisten (USB-Kabel **oder** drahtloses `adb`). Ein Android-Emulator funktioniert ebenfalls.                                         |
| **Java 21+ & das Android SDK**        | nur beim ersten Mal nötig, damit der Runner die App bauen kann, falls die APK fehlt                                                                            |

Der Runner baut die `local`-Debug-APK selbst, falls sie nicht bereits gebaut ist.

---

## 2. Ausführen

Vom Repo-Root:

```sh
# Die gesamte Suite gegen den lokalen Stack ausführen
node express-api/scripts/device-journey-runner.js

# Die Liste der Journeys ansehen, ohne etwas auszuführen
node express-api/scripts/device-journey-runner.js --list

# Nur bestimmte Journeys ausführen
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Zuerst einen frischen APK-Build erzwingen
node express-api/scripts/device-journey-runner.js --rebuild

# Vollständige Optionsliste
node express-api/scripts/device-journey-runner.js --help
```

Optionen: `--target local|dev` (Standard `local`) · `--serial <adb-serial>`
(Standard: automatische Auswahl) · `--journeys <ids>` · `--rebuild` · `--no-reset` (überspringt
die saubere Neuinstallation in der Smoke-Journey) · `--out <dir>` · `--list` · `--help`.

Der Runner fixiert **eine** adb-Serial für jeden Befehl, sodass er auch dann funktioniert, wenn ein
Telefon zweimal auftaucht (USB + drahtlos). Für das `local`-Ziel richtet er
`adb reverse`-Tunnel ein, damit die App auf dem Gerät den Stack auf deiner Maschine erreicht.

---

## 3. Die Ergebnisse ansehen

Wenn er fertig ist, gibt er eine Zusammenfassung aus und schreibt unter `journey-results/`:

| Datei                           | Was                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Lies das hier** — pro Journey, pro Schritt ✅/❌ mit dem Grund, den testTags auf dem Bildschirm und einem Screenshot-Link für jeden Schritt |
| `latest-report.json`            | dieselben Daten, maschinenlesbar                                                                                                              |
| `runs/<runId>/*.png`            | ein Screenshot jedes Schritts (Bestanden _und_ Fehlgeschlagen)                                                                                |
| `runs/<runId>/report.{md,json}` | der archivierte Bericht für genau diesen Lauf                                                                                                 |

Der Exit-Code ist `0`, wenn jede Journey bestanden hat, und `1`, wenn eine fehlgeschlagen ist. Bei einem Fehlschlag
hält der Schritt genau fest, was auf dem Bildschirm zu sehen war, sodass du das _Warum_ erkennen kannst, ohne
das Telefon erneut anzusteuern.

---

## 4. Was die Journeys abdecken

Führe `--list` für den aktuellen Satz aus. Auf einen Blick deckt die Suite ab:

- **Smoke** — saubere Installation → rechtliche Zustimmung → Anmeldung, Backend erreichbar.
- **Cohort-Anmeldung** — Erwachsenen-/Minderjährigen-/Admin-Personas melden sich über die
  In-App-Dev-Persona-Auswahl an; die Identität wird gegen das Debug-Overlay und das
  Firestore-Feld `cohort` bestätigt.
- **OSA-Cohort-Gate** — ein Minderjähriger kann einem Erwachsenen weder folgen noch ihn ansehen (der Server gibt
  `404` zurück, und der Firestore-Schreibvorgang findet nie statt), während Aktionen innerhalb derselben Cohort
  gelingen – was beweist, dass das Gate cohort-spezifisch ist und keine pauschale Sperre.
- **Admin** — Cohort-Override ist nur für Mitarbeiter (ein reguläres Mitglied wird mit
  `422` abgelehnt; ein Mitarbeiter-Konto gelingt und schreibt eine regulatorische Audit-Zeile).
- **Moderation** — Meldung → Admin-Sperre (+ Audit) → Einspruch → Entsperrung, vollständig
  serverseitig durchgesetzt, mit idempotenter Bereinigung.

Die Authentifizierung in den Journeys verwendet immer die **In-App-Dev-Persona-Auswahl** – niemals
echte Google-/Apple-Anmeldung.

> **Hinweis zu den Journey-Specs.** Die Gherkin-Pläne in
> `journey-tests/j01-j19` sind teilweise _aspirational_: Sie verweisen auf
> UI, die die ausgelieferte App nicht hat (z. B. einen E-Mail/Passwort-Registrierungsbildschirm, versteckte
> Minderjährigen-Tabs, einen Discovery-Bildschirm). Der Runner bildet daher die tatsächliche Absicht jeder Journey
> gegen die **tatsächliche** App + Firestore + API ab und protokolliert solche
> Abweichungen als Findings, statt an Fiktion zu scheitern.

---

## 5. Fehlerbehebung

| Symptom                                                                   | Lösung                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                                     | Telefon einstecken / koppeln; `adb devices` prüfen.                                                                                                  |
| Bleibt beim Erreichen von SignIn hängen / "backend NOT reachable"         | Der lokale Stack ist nicht hochgefahren oder die `adb reverse`-Tunnel wurden nicht gesetzt — `bash local/start.sh` neu starten und erneut ausführen. |
| `persona "<email>" not found in picker`                                   | Personas sind nicht geseedet — den Seed-Befehl in §1 ausführen.                                                                                      |
| `Firestore assertions: ON` fehlt / DB-Schritte übersprungen               | DB-Prüfungen laufen nur für `--target local`.                                                                                                        |
| APK-Build schlägt fehl                                                    | Das ausgegebene `gradle-build.log` öffnen; sicherstellen, dass Java 21+ und das Android SDK installiert sind.                                        |
| Ein Schritt schlägt auf einem Bildschirm fehl, den du nicht erwartet hast | Den in `latest-report.md` genannten Screenshot für diesen Schritt öffnen.                                                                            |

---

## 6. Eine Journey hinzufügen

Journeys sind einfache Objekte mit einer `run(device, reporter, ctx)`-Methode, zusammengesetzt
aus den gemeinsam genutzten Helfern:

- `signInAs(device, reporter, ctx, email, nameToken)` — meldet eine Persona über
  die Auswahl an und durchläuft die Erststart-Interstitials bis zum Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText` sowie `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Server: `getIdToken(email)` → das ID-Token einer Persona, dann
  `apiCall(method, path, { token, body })`.

Verpacke jede Prüfung in `reporter.step(device, 'name', async () => { … })` — es
misst die Zeit des Schritts, erstellt einen Screenshot, protokolliert Bestanden/Fehlgeschlagen und erfasst bei einem Fehlschlag
die testTags auf dem Bildschirm. Füge das neue Objekt zum `all`-Array in `buildJourneys` hinzu.

Reine Logik (Parsing, Selektoren, Argumentverarbeitung) wird per Unit-Test in
`tests/scripts/device-journey-runner.test.js` getestet (`cd express-api && npm test`);
die Geräte-/Firestore-/API-Ebenen werden integrationsgetestet, indem die Suite auf
einem echten Gerät ausgeführt wird.
