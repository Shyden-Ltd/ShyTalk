# ShyTalks körare för resetester på enheten

_Detta är en översättning av JOURNEY-RUNNER.md._

`device-journey-runner.js` driver den **riktiga ShyTalk-appen på en ansluten telefon**
genom användarresor från början till slut och skriver en **detaljerad rapport om godkänt/underkänt** som du
kan läsa — så du kör ett kommando och läser en rapport i stället för att trycka
dig igenom varje steg för hand.

Det är en **hybrid**-körare. Varje resa kan kontrollera tre lager samtidigt:

1. **UI** — trycker/inspekterar den live-app via `adb` + `uiautomator` (Composes
   `testTag`-ar dyker upp som `resource-id`-ar i dumpen; dialoger matchas på
   sin synliga text).
2. **Firestore** — läser den lokala emulatorn direkt (via `firebase-admin`) för att
   bekräfta databasens tillstånd bakom varje åtgärd.
3. **Server / API** — loggar in som varje persona (en riktig Firebase-ID-token från
   Auth-emulatorn) och anropar `express-api`, så den verifierar de **regler som
   servern upprätthåller** (OSA-kohortspärren, admin-åsidosättning, moderering) — som
   _inte_ är synliga i enbart UI.

> Översättningar av denna guide finns i `journey-runner-locales/` (20 språk).

---

## 1. Förutsättningar

| Du behöver                   | Hur                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** igång     | för Firebase-emulatorerna + LiveKit/MinIO                                                                                                                   |
| **Den lokala stacken uppe**  | `bash local/start.sh` (från repots rot) — startar Firebase-emulatorerna + express-api. Låt den fortsätta köra.                                              |
| **Personas seedade**         | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotent; seedar testuppsättningen P‑02…P‑19 med lösenordet `localdev123`) |
| **En ansluten telefon**      | `adb devices` måste lista en (USB-kabel **eller** trådlös `adb`). En Android-emulator fungerar också.                                                       |
| **Java 21+ och Android SDK** | behövs bara första gången, så att köraren kan bygga appen om APK:n saknas                                                                                   |

Köraren bygger själv `local`-debug-APK:n om den inte redan är byggd.

---

## 2. Kör den

Från repots rot:

```sh
# Run the whole suite against the local stack
node express-api/scripts/device-journey-runner.js

# See the list of journeys without running anything
node express-api/scripts/device-journey-runner.js --list

# Run only specific journeys
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Force a fresh APK build first
node express-api/scripts/device-journey-runner.js --rebuild

# Full option list
node express-api/scripts/device-journey-runner.js --help
```

Alternativ: `--target local|dev` (standard `local`) · `--serial <adb-serial>`
(standard: autoval) · `--journeys <ids>` · `--rebuild` · `--no-reset` (hoppa över
den rena ominstallationen i smoke-resan) · `--out <dir>` · `--list` · `--help`.

Köraren fäster **ett** adb-serienummer för varje kommando, så den fungerar även när en
telefon dyker upp två gånger (USB + trådlöst). För målet `local` sätter den upp
`adb reverse`-tunnlar så att appen på enheten når stacken på din maskin.

---

## 3. Se resultaten

När den är klar skriver den ut en sammanfattning och skriver, under `journey-results/`:

| Fil                             | Vad                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Läs denna** — per resa, per steg ✅/❌ med orsaken, testTags:arna på skärmen och en skärmdumpslänk för varje steg |
| `latest-report.json`            | samma data, maskinläsbart                                                                                           |
| `runs/<runId>/*.png`            | en skärmdump av varje steg (både godkänt _och_ underkänt)                                                           |
| `runs/<runId>/report.{md,json}` | den arkiverade rapporten för just den körningen                                                                     |

Avslutskoden är `0` när varje resa godkänts, `1` när någon underkänts. Vid ett misslyckande
registrerar steget exakt vad som fanns på skärmen, så du kan se _varför_ utan
att köra telefonen på nytt.

---

## 4. Vad resorna täcker

Kör `--list` för den live-uppsättningen. I korthet täcker sviten:

- **Smoke** — ren installation → juridiskt godkännande → inloggning, backend nåbar.
- **Kohortinloggning** — personas vuxen / minderårig / admin loggar in via den
  inbyggda dev-personaväljaren; identiteten bekräftas mot debug-overlayen och
  Firestore-fältet `cohort`.
- **OSA-kohortspärr** — en minderårig kan varken följa eller visa en vuxen (servern returnerar
  `404`, och Firestore-skrivningen sker aldrig), medan åtgärder inom samma kohort
  lyckas — vilket bevisar att spärren är kohortspecifik, inte en heltäckande blockering.
- **Admin** — kohortåsidosättning är endast för personal (en vanlig medlem avvisas med
  `422`; ett personalkonto lyckas och skriver en regulatorisk granskningsrad).
- **Moderering** — anmälan → admin-avstängning (+ granskning) → överklagan → upphävd avstängning, helt
  serverupprätthållen, med idempotent uppstädning.

Autentisering i resor använder alltid den **inbyggda dev-personaväljaren** — aldrig
riktig inloggning med Google/Apple.

> **Notering om resespecifikationerna.** Gherkin-planerna i
> `.project/test-plans/manual/j01-j19` är delvis _önsketänkande_: de refererar till
> UI som den utskeppade appen inte har (t.ex. en registreringsskärm med e-post/lösenord, dolda
> flikar för minderåriga, en upptäcktsskärm). Köraren mappar därför varje resas verkliga avsikt
> mot den **faktiska** appen + Firestore + API och registrerar sådana
> avvikelser som fynd i stället för att underkännas på fiktion.

---

## 5. Felsökning

| Symptom                                                 | Åtgärd                                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                   | Anslut / para telefonen; kontrollera `adb devices`.                                                                           |
| Fastnar vid att nå SignIn / "backend NOT reachable"     | Den lokala stacken är inte uppe eller `adb reverse`-tunnlarna sattes inte upp — starta om `bash local/start.sh` och kör igen. |
| `persona "<email>" not found in picker`                 | Personas är inte seedade — kör seed-kommandot i §1.                                                                           |
| `Firestore assertions: ON` saknas / DB-steg hoppas över | DB-kontroller körs endast för `--target local`.                                                                               |
| APK-bygget misslyckas                                   | Öppna den utskrivna `gradle-build.log`; säkerställ att Java 21+ och Android SDK är installerade.                              |
| Ett steg misslyckas på en skärm du inte väntade dig     | Öppna skärmdumpen som namnges i `latest-report.md` för det steget.                                                            |

---

## 6. Lägga till en resa

Resor är vanliga objekt med en `run(device, reporter, ctx)`-metod, sammansatta
av de delade hjälparna:

- `signInAs(device, reporter, ctx, email, nameToken)` — logga in en persona via
  väljaren och rid de mellansidor som visas vid första start fram till Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, och `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Server: `getIdToken(email)` → en personas ID-token, sedan
  `apiCall(method, path, { token, body })`.

Linda in varje kontroll i `reporter.step(device, 'name', async () => { … })` — den
tar tid på steget, skärmdumpar det, registrerar godkänt/underkänt och fångar vid fel
testTags:arna på skärmen. Lägg till det nya objektet i `all`-arrayen i `buildJourneys`.

Ren logik (parsning, selektorer, argumenthantering) enhetstestas i
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`);
enhets-/Firestore-/API-lagren integrationstestas genom att köra sviten på
en riktig enhet.
