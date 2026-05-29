# ShyTalk on-device journey-test runner

_Dit is een vertaling van JOURNEY-RUNNER.md._

`device-journey-runner.js` stuurt de **echte ShyTalk-app op een aangesloten
telefoon** door end-to-end gebruikersreizen heen en schrijft een **gedetailleerd
geslaagd/mislukt-rapport** dat je kunt lezen — zodat je één commando uitvoert en
één rapport leest in plaats van elke stap handmatig aan te tikken.

Het is een **hybride** runner. Elke reis kan tegelijk op drie lagen
controleren:

1. **UI** — tikt op/inspecteert de live app via `adb` + `uiautomator` (Compose
   `testTag`s verschijnen als `resource-id`s in de dump; dialogen worden gematcht
   op hun zichtbare tekst).
2. **Firestore** — leest de lokale emulator rechtstreeks (via `firebase-admin`)
   om de databasestatus achter elke actie te bevestigen.
3. **Server / API** — meldt zich aan als elke persona (echte Firebase ID-token uit
   de Auth-emulator) en roept de `express-api` aan, zodat het de **regels die de
   server afdwingt** verifieert (de OSA cohort-gate, admin-override, moderatie) —
   die _niet_ alleen in de UI zichtbaar zijn.

> Vertalingen van deze gids staan in `journey-runner-locales/` (20 talen).

---

## 1. Vereisten

| Je hebt nodig                 | Hoe                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** draaiend   | voor de Firebase-emulators + LiveKit/MinIO                                                                                                           |
| **De lokale stack actief**    | `bash local/start.sh` (vanuit de repo-root) — start de Firebase-emulators + de express-api. Laat het draaien.                                        |
| **Persona's geseed**          | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotent; seedt de P‑02…P‑19 testcast met wachtwoord `localdev123`) |
| **Een telefoon aangesloten**  | `adb devices` moet er één tonen (USB-kabel **of** draadloze `adb`). Een Android-emulator werkt ook.                                                  |
| **Java 21+ & de Android SDK** | alleen de eerste keer nodig, zodat de runner de app kan bouwen als de APK ontbreekt                                                                  |

De runner bouwt de `local` debug-APK zelf als die nog niet is gebouwd.

---

## 2. Voer het uit

Vanuit de repo-root:

```sh
# Voer de hele suite uit tegen de lokale stack
node express-api/scripts/device-journey-runner.js

# Bekijk de lijst met reizen zonder iets uit te voeren
node express-api/scripts/device-journey-runner.js --list

# Voer alleen specifieke reizen uit
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Forceer eerst een verse APK-build
node express-api/scripts/device-journey-runner.js --rebuild

# Volledige optielijst
node express-api/scripts/device-journey-runner.js --help
```

Opties: `--target local|dev` (standaard `local`) · `--serial <adb-serial>`
(standaard: automatisch selecteren) · `--journeys <ids>` · `--rebuild` ·
`--no-reset` (sla de schone herinstallatie in de smoke-reis over) · `--out <dir>`
· `--list` · `--help`.

De runner pint **één** adb-serial voor elk commando, zodat het zelfs werkt
wanneer een telefoon twee keer verschijnt (USB + draadloos). Voor het `local`
target zet het `adb reverse`-tunnels op zodat de app op het apparaat de stack op
jouw machine bereikt.

---

## 3. Bekijk de resultaten

Als het klaar is print het een samenvatting en schrijft het, onder
`journey-results/`:

| Bestand                         | Wat                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Lees dit** — per reis, per stap ✅/❌ met de reden, de testTags op het scherm, en een screenshot-link voor elke stap |
| `latest-report.json`            | dezelfde data, machineleesbaar                                                                                         |
| `runs/<runId>/*.png`            | een screenshot van elke stap (geslaagd _en_ mislukt)                                                                   |
| `runs/<runId>/report.{md,json}` | het gearchiveerde rapport voor die specifieke run                                                                      |

De exitcode is `0` wanneer elke reis is geslaagd, `1` wanneer er één is mislukt.
Bij een mislukking legt de stap precies vast wat er op het scherm stond, zodat je
kunt zien _waarom_ zonder de telefoon opnieuw te besturen.

---

## 4. Wat de reizen dekken

Voer `--list` uit voor de actuele set. In een oogopslag dekt de suite:

- **Smoke** — schone installatie → juridische acceptatie → aanmelden, backend
  bereikbaar.
- **Cohort-aanmelding** — volwassen / minderjarige / admin persona's melden zich
  aan via de in-app dev persona-kiezer; de identiteit wordt bevestigd tegen de
  debug-overlay en het Firestore `cohort`-veld.
- **OSA cohort-gate** — een minderjarige kan een volwassene niet volgen of
  bekijken (de server retourneert `404`, en de Firestore-schrijfactie gebeurt
  nooit), terwijl acties binnen hetzelfde cohort wel slagen — wat bewijst dat de
  gate cohort-specifiek is, geen algehele blokkade.
- **Admin** — cohort-override is alleen voor staf (een gewoon lid wordt geweigerd
  met `422`; een staf-account slaagt en schrijft een regelgevende audit-rij).
- **Moderatie** — report → admin suspend (+ audit) → appeal → unsuspend, volledig
  server-afgedwongen, met idempotente opschoning.

Authenticatie in reizen gebruikt altijd de **in-app dev persona-kiezer** — nooit
echte Google/Apple-aanmelding.

> **Opmerking over de reisspecificaties.** De Gherkin-plannen in
> `journey-tests/j01-j19` zijn deels _aspirationeel_: ze verwijzen
> naar UI die de uitgebrachte app niet heeft (bijv. een email/password
> aanmeldscherm, verborgen tabs voor minderjarigen, een discovery-scherm). De
> runner mapt daarom de echte intentie van elke reis tegen de **werkelijke** app +
> Firestore + API, en registreert zulke afwijkingen als bevindingen in plaats van
> te falen op fictie.

---

## 5. Probleemoplossing

| Symptoom                                                       | Oplossing                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                          | Sluit de telefoon aan / koppel hem; controleer `adb devices`.                                                                     |
| Vastgelopen bij SignIn / "backend NOT reachable"               | De lokale stack draait niet of de `adb reverse`-tunnels werden niet opgezet — herstart `bash local/start.sh` en voer opnieuw uit. |
| `persona "<email>" not found in picker`                        | Persona's zijn niet geseed — voer het seed-commando uit in §1.                                                                    |
| `Firestore assertions: ON` ontbreekt / DB-stappen overgeslagen | DB-asserties draaien alleen voor `--target local`.                                                                                |
| APK-build mislukt                                              | Open de geprinte `gradle-build.log`; zorg dat Java 21+ en de Android SDK geïnstalleerd zijn.                                      |
| Een stap mislukt op een scherm dat je niet verwachtte          | Open de screenshot die in `latest-report.md` voor die stap genoemd wordt.                                                         |

---

## 6. Een reis toevoegen

Reizen zijn gewone objecten met een `run(device, reporter, ctx)`-methode,
samengesteld uit de gedeelde helpers:

- `signInAs(device, reporter, ctx, email, nameToken)` — meldt een persona aan via
  de kiezer en rijdt door de interstitials bij de eerste start naar Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, en `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Server: `getIdToken(email)` → de ID-token van een persona, daarna
  `apiCall(method, path, { token, body })`.

Wikkel elke assertie in `reporter.step(device, 'name', async () => { … })` — het
timet de stap, maakt er een screenshot van, registreert geslaagd/mislukt, en legt
bij een mislukking de testTags op het scherm vast. Voeg het nieuwe object toe aan
de `all`-array in `buildJourneys`.

Pure logica (parsen, selectors, argumentafhandeling) wordt unit-getest in
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`); de
device-/Firestore-/API-lagen worden integratie-getest door de suite op een echt
apparaat uit te voeren.
