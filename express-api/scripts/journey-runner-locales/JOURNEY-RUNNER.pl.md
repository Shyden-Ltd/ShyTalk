# Runner testów ścieżek na urządzeniu ShyTalk

_To jest tłumaczenie pliku JOURNEY-RUNNER.md._

`device-journey-runner.js` prowadzi **prawdziwą aplikację ShyTalk na podłączonym
telefonie** przez kompleksowe (end-to-end) ścieżki użytkownika i zapisuje
**szczegółowy raport zaliczone/niezaliczone**, który możesz przeczytać — więc
uruchamiasz jedno polecenie i czytasz jeden raport, zamiast przeklikiwać każdy
krok ręcznie.

To runner **hybrydowy**. Każda ścieżka może weryfikować trzy warstwy
jednocześnie:

1. **UI** — dotyka/sprawdza działającą aplikację przez `adb` + `uiautomator`
   (`testTag`i z Compose pojawiają się jako `resource-id` w zrzucie; okna
   dialogowe są dopasowywane po ich widocznym tekście).
2. **Firestore** — czyta lokalny emulator bezpośrednio (przez `firebase-admin`),
   aby potwierdzić stan bazy danych stojący za każdą akcją.
3. **Serwer / API** — loguje się jako każda persona (prawdziwy token ID Firebase z
   emulatora Auth) i wywołuje `express-api`, dzięki czemu weryfikuje **reguły,
   które wymusza serwer** (bramkę cohort OSA, nadpisanie przez admina, moderację)
   — które _nie_ są widoczne wyłącznie w UI.

> Tłumaczenia tego przewodnika znajdują się w `journey-runner-locales/` (20
> języków).

---

## 1. Wymagania wstępne

| Potrzebujesz                      | Jak                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Działającego **Docker Desktop**   | dla emulatorów Firebase + LiveKit/MinIO                                                                                                               |
| **Uruchomionego lokalnego stosu** | `bash local/start.sh` (z katalogu głównego repo) — uruchamia emulatory Firebase + express-api. Zostaw je działające.                                  |
| **Zaseedowanych person**          | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempotentne; seeduje obsadę testową P‑02…P‑19 z hasłem `localdev123`) |
| **Podłączonego telefonu**         | `adb devices` musi wyświetlić jeden (kabel USB **lub** bezprzewodowe `adb`). Emulator Androida również działa.                                        |
| **Java 21+ oraz Android SDK**     | potrzebne tylko za pierwszym razem, aby runner mógł zbudować aplikację, jeśli brakuje APK                                                             |

Runner sam buduje debugowy APK `local`, jeśli nie został jeszcze zbudowany.

---

## 2. Uruchom go

Z katalogu głównego repo:

```sh
# Uruchom cały zestaw względem lokalnego stosu
node express-api/scripts/device-journey-runner.js

# Zobacz listę ścieżek bez uruchamiania czegokolwiek
node express-api/scripts/device-journey-runner.js --list

# Uruchom tylko określone ścieżki
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Wymuś najpierw świeży build APK
node express-api/scripts/device-journey-runner.js --rebuild

# Pełna lista opcji
node express-api/scripts/device-journey-runner.js --help
```

Opcje: `--target local|dev` (domyślnie `local`) · `--serial <adb-serial>`
(domyślnie: autowybór) · `--journeys <ids>` · `--rebuild` · `--no-reset`
(pomija czystą reinstalację w ścieżce smoke) · `--out <dir>` · `--list` ·
`--help`.

Runner przypina **jeden** adb serial dla każdego polecenia, więc działa nawet
wtedy, gdy telefon pojawia się dwukrotnie (USB + bezprzewodowo). Dla celu
`local` ustawia tunele `adb reverse`, aby aplikacja na urządzeniu mogła dotrzeć
do stosu na twojej maszynie.

---

## 3. Zobacz wyniki

Po zakończeniu wypisuje podsumowanie i zapisuje, w katalogu
`journey-results/`:

| Plik                            | Co                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Przeczytaj to** — dla każdej ścieżki, dla każdego kroku ✅/❌ z powodem, testTagi na ekranie oraz link do zrzutu ekranu dla każdego kroku |
| `latest-report.json`            | te same dane, w postaci czytelnej dla maszyny                                                                                               |
| `runs/<runId>/*.png`            | zrzut ekranu każdego kroku (zarówno zaliczonego, _jak i_ niezaliczonego)                                                                    |
| `runs/<runId>/report.{md,json}` | zarchiwizowany raport dla tego konkretnego przebiegu                                                                                        |

Kod wyjścia to `0`, gdy każda ścieżka przeszła, a `1`, gdy którakolwiek się nie
powiodła. Przy niepowodzeniu krok zapisuje dokładnie to, co było na ekranie,
więc możesz zobaczyć _dlaczego_ bez ponownego sterowania telefonem.

---

## 4. Co obejmują ścieżki

Uruchom `--list`, aby zobaczyć aktualny zestaw. W skrócie zestaw obejmuje:

- **Smoke** — czysta instalacja → akceptacja warunków prawnych → logowanie,
  backend osiągalny.
- **Logowanie cohort** — persony dorosłego / niepełnoletniego / admina logują się
  przez wbudowany wybierak person deweloperskich (dev persona picker); tożsamość
  jest potwierdzana względem nakładki debugowania oraz pola `cohort` w Firestore.
- **Bramka cohort OSA** — niepełnoletni nie może obserwować ani wyświetlać
  dorosłego (serwer zwraca `404`, a zapis do Firestore nigdy nie następuje),
  podczas gdy akcje w obrębie tego samego cohort kończą się powodzeniem — co
  dowodzi, że bramka jest specyficzna dla cohort, a nie jest blokadą ogólną.
- **Admin** — nadpisanie cohort jest dostępne tylko dla personelu (zwykły członek
  zostaje odrzucony z `422`; konto personelu kończy się powodzeniem i zapisuje
  regulacyjny wiersz audytu).
- **Moderacja** — report → admin suspend (+ audit) → appeal → unsuspend, w pełni
  wymuszane przez serwer, z idempotentnym czyszczeniem.

Uwierzytelnianie w ścieżkach zawsze korzysta z **wbudowanego wybieraka person
deweloperskich** — nigdy z prawdziwego logowania Google/Apple.

> **Uwaga dotycząca specyfikacji ścieżek.** Plany Gherkin w
> `journey-tests/j01-j19` są częściowo _aspiracyjne_: odwołują się
> do UI, którego wydana aplikacja nie ma (np. ekran rejestracji
> email/password, ukryte zakładki dla niepełnoletnich, ekran discovery). Dlatego
> runner mapuje rzeczywistą intencję każdej ścieżki względem **rzeczywistej**
> aplikacji + Firestore + API i zapisuje takie rozbieżności jako ustalenia,
> zamiast oblewać na fikcji.

---

## 5. Rozwiązywanie problemów

| Objaw                                                         | Rozwiązanie                                                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                         | Podłącz / sparuj telefon; sprawdź `adb devices`.                                                                              |
| Utknięcie przy dotarciu do SignIn / "backend NOT reachable"   | Lokalny stos nie działa lub tunele `adb reverse` nie zostały ustawione — zrestartuj `bash local/start.sh` i uruchom ponownie. |
| `persona "<email>" not found in picker`                       | Persony nie zostały zaseedowane — uruchom polecenie seed z §1.                                                                |
| Brak `Firestore assertions: ON` / kroki DB pominięte          | Asercje DB działają tylko dla `--target local`.                                                                               |
| Build APK nie powiódł się                                     | Otwórz wypisany `gradle-build.log`; upewnij się, że zainstalowano Java 21+ oraz Android SDK.                                  |
| Krok nie powiódł się na ekranie, którego się nie spodziewałeś | Otwórz zrzut ekranu wymieniony w `latest-report.md` dla tego kroku.                                                           |

---

## 6. Dodawanie ścieżki

Ścieżki to zwykłe obiekty z metodą `run(device, reporter, ctx)`, złożone ze
współdzielonych pomocników:

- `signInAs(device, reporter, ctx, email, nameToken)` — loguje personę przez
  wybierak i przechodzi przez ekrany przejściowe (interstitials) przy pierwszym
  uruchomieniu aż do Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, oraz `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Serwer: `getIdToken(email)` → token ID persony, następnie
  `apiCall(method, path, { token, body })`.

Owiń każdą asercję w `reporter.step(device, 'name', async () => { … })` —
mierzy ona czas kroku, robi mu zrzut ekranu, zapisuje zaliczenie/niepowodzenie, a
przy niepowodzeniu przechwytuje testTagi na ekranie. Dodaj nowy obiekt do
tablicy `all` w `buildJourneys`.

Czysta logika (parsowanie, selektory, obsługa argumentów) jest testowana
jednostkowo w `tests/scripts/device-journey-runner.test.js` (`cd express-api &&
npm test`); warstwy urządzenia/Firestore/API są testowane integracyjnie przez
uruchomienie zestawu na prawdziwym urządzeniu.
