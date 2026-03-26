# ShyTalk

**Pokoje czatu glosowego na nowo.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | **Polski** | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## O projekcie

ShyTalk to spoleczna aplikacja czatu glosowego, w ktorej uzytkownicy moga tworzyc i dolaczac do pokojow czatu glosowego w czasie rzeczywistym. Zbudowana z Kotlin Multiplatform (KMP), obsluguje zarowno Android, jak i iOS ze wspolna baza kodu. Niezaleznie od tego, czy chcesz prowadzic rozmowe, sluchac, czy laczyc sie z ludzmi na calym swiecie, ShyTalk to ulatwia.

iOS jest obslugiwana platforma, ale ten przewodnik koncentruje sie na rozwoju Android, ktory jest glownym celem rozwoju.

## Funkcje

### Pokoje czatu glosowego
- Tworzenie lub dolaczanie do pokojow z glosem w czasie rzeczywistym napedzanym przez LiveKit
- Ustrukturyzowany system miejsc z rolami wlasciciela, hosta i uczestnika
- Prosby o miejsce i zaproszenia -- popros o dolaczenie na miejsce lub zapros sluchaczy do mowienia
- Plywajacy chathead -- kontynuuj czat glosowy przegladajac inne czesci aplikacji
- Wygasanie pokoju -- pokoje zamykaja sie automatycznie, gdy wlasciciel jest nieobecny, z timerami odliczania

### Wiadomosci
- Czat tekstowy na zywo obok glosu w kazdym pokoju
- Prywatne wiadomosci z rozmowami 1-na-1
- Czaty grupowe z zarzadzaniem czlonkami i uprawnieniami
- Wskazniki pisania w czasie rzeczywistym
- Obsluga naklejek

### Spolecznosc
- Personalizowane profile uzytkownikow ze zdjeciami, obrazami okladki, flagami narodowosci i biografiami
- System obserwowania -- obserwuj innych uzytkownikow i sprawdzaj, kiedy sa aktywni
- Sciana prezentow -- prezentuj prezenty otrzymane od innych uzytkownikow
- System blokowania -- blokuj uzytkownikow w pokojach i profilach

### Wirtualna ekonomia
- Ekonomia oparta na monetach z portfelem i historia transakcji
- Dzienne nagrody za logowanie z bonusami za serie
- System Lucky Spin (gacha) ze stopniowanymi nagrodami
- Wirtualne prezenty -- wysylaj i otrzymuj animowane prezenty podczas czatow glosowych
- Inwentarz plecaka do przechowywania prezentow
- Pakiety monet do kupowania monet
- Bannery transmisji z animowanymi efektami prezentow

### Konto i tozsamosc
- Uwierzytelnianie wielodostawcowe -- logowanie przez Google, Apple lub e-mail (OTP)
- Laczenie wielu metod logowania z jednym kontem
- Stabilna tozsamosc uzytkownika (uniqueId) utrzymywana miedzy projektami Firebase
- Zarzadzanie polaczonymi kontami w Ustawieniach z obsluga laczenia/odlaczania
- Powiazanie urzadzenia -- kazde urzadzenie jest trwale powiazane z jednym kontem

### Moderacja i bezpieczenstwo
- Narzedzia moderacji -- wyciszanie, wyrzucanie, przenoszenie miejsc i zarzadzanie hostami jako wlasciciel pokoju
- System zglaszania uzytkownikow z przeplywem recenzji
- System ostrzezen i zawieszen za naruszenia zasad
- Ekrany standardow spolecznosci, polityki prywatnosci i warunkow uzytkowania
- Przeplyw akceptacji prawnej dla nowych uzytkownikow
- Wymuszona aktualizacja dla przestarzalych wersji aplikacji

### Ekrany startowe
- Konfigurowalne ekrany uruchamiania wyswietlane przy starcie aplikacji
- Tresci zarzadzane przez administratora z opcjami planowania i targetowania

### Bezpieczenstwo
- Ochrona kodem PIN dostepu do aplikacji
- Uwierzytelnianie biometryczne -- odcisk palca i rozpoznawanie twarzy
- Weryfikacja OTP (jednorazowe haslo) dla wrazliwych akcji

### Panel administracyjny
- Webowy dashboard moderacji na statycznej stronie projektu
- Zarzadzanie uzytkownikami, moderacja tresci i konfiguracja
- Zarzadzanie szablonami i prezentami z podgladem na zywo
- Strumieniowanie logow i alerty w czasie rzeczywistym

### Kompresja obrazow
- Automatyczna kompresja obrazow przy przesylaniu przez Express API
- Zmniejsza koszty pamieci i przepustowosci zachowujac jakosc

### Internacjonalizacja
- 19 jezykow obslugiwanych domyslnie
- Pelna lokalizacja wszystkich tekstow widocznych dla uzytkownika

### Logowanie i monitorowanie
- Ustrukturyzowane logowanie w Express API, aplikacjach mobilnych i panelu administracyjnym
- Strumieniowanie logow w czasie rzeczywistym w dashboardzie administracyjnym
- Blokowanie urzadzen i sieci z automatycznym egzekwowaniem
- System alertow dla krytycznych bledow i anomalii
- Propagacja Trace ID do sledzenia zadan od poczatku do konca

## Stos technologiczny

| Warstwa | Technologia |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architektura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Uwierzytelnianie** | Firebase Authentication (Google, Apple, Email+OTP) z systemem tozsamosci wielodostawcowej |
| **Baza danych** | Cloud Firestore |
| **Czas rzeczywisty** | Firebase Realtime Database |
| **Pamiec** | Cloudflare R2 (przez proxy Express API) |
| **Serwer API** | Express.js na Oracle Cloud Free Tier |
| **Glos** | LiveKit (self-hosted on Oracle Cloud) |
| **Powiadomienia push** | Firebase Cloud Messaging |
| **Ladowanie obrazow** | Coil 3 (KMP) |
| **Animacje** | Lottie Compose |
| **Data/Czas** | kotlinx-datetime |
| **Nawigacja** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Architektura

ShyTalk podaza za wzorcem **MVVM** z czystym **Repository Pattern**:

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

- **Modul shared** (`commonMain`) -- Modele, interfejsy repozytoriow, ViewModele i UI wspoldzielone miedzy platformami
- **Modul app** -- Ekrany specyficzne dla Androida, implementacje repozytoriow i punkt wejscia
- **Modul iosApp** -- Punkt wejscia specyficzny dla iOS
- **express-api** -- Backend Express.js dzialajacy na Oracle Cloud Free Tier

## Struktura projektu

```
ShyTalk/
+-- app/                              # Modul aplikacji Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Punkt wejscia aplikacji
|       |   +-- MainActivity.kt       # Glowna aktywnosc
|       |   +-- core/
|       |   |   +-- di/               # Modul Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Glos LiveKit, obecnosc, powiadomienia
|       |   |   +-- repository/       # Implementacje repozytoriow
|       |   +-- feature/
|       |   |   +-- auth/             # Ekran logowania Google
|       |   |   +-- profile/          # Ekran profilu
|       |   |   +-- room/             # Ekran pokoju
|       |   |   +-- settings/         # Ustawienia aplikacji
|       |   +-- navigation/           # NavGraph & trasy ekranow
|       +-- test/                     # Testy jednostkowe
|       +-- androidTest/              # Testy E2E (Compose UI Test)
+-- shared/                           # Modul wspoldzielony KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Wspoldzielone moduly Koin
|       |   +-- model/                # Modele danych (User, ChatRoom, Gift itp.)
|       |   +-- ui/                   # Wspoldzielone komponenty
|       |   +-- util/                 # Narzedzia i stale
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService itp.
|       |   +-- repository/           # Interfejsy repozytoriow
|       +-- feature/                  # Wspoldzielone moduly funkcji
+-- iosApp/                           # Modul aplikacji iOS
+-- express-api/                      # Serwer Express.js API
|   +-- src/
|       +-- routes/                   # Handlery tras API
|       +-- middleware/               # Middleware uwierzytelniania i logowania
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Zaplanowane zadania
+-- public/                           # Strona statyczna i panel administracyjny
+-- local/                            # Lokalne srodowisko deweloperskie (emulatory, dane poczatkowe)
+-- tests/web/                        # Testy przegladarkowe Playwright
+-- scripts/                          # Skrypty narzediowe
+-- .github/workflows/                # CI/CD (Sprawdzenia PR, Wdrazanie na Dev/Prod, E2E, lint)
+-- firestore.rules                   # Reguly bezpieczenstwa Firestore
+-- database.rules.json               # Reguly bezpieczenstwa RTDB
+-- firestore.indexes.json            # Indeksy zlozzone Firestore
+-- firebase.json                     # Konfiguracja Firebase
```

## Rozpoczecie pracy

### Wymagania wstepne

- **Android Studio** Ladybug lub nowsze
- **JDK 21+**
- **Node.js 24+**
- **Docker** (dla serwera glosowego LiveKit, pamieci MinIO, poczty Mailpit)
- **Firebase CLI** (`npm install -g firebase-tools`)

Nie sa potrzebne konta chmurowe, aby rozpoczac -- lokalne srodowisko dziala calkowicie offline.

### Rozwoj lokalny (Zalecany)

Najszybszy sposob na rozpoczecie. Jedno polecenie uruchamia wszystko -- emulatory Firebase, kontenery Docker, Express API i buduje aplikacje Android. Bez kont chmurowych, bez kosztow, bez limitow.

1. **Klonowanie i instalacja**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Uruchomienie wszystkiego**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   To pojedyncze polecenie:
   - Uruchamia kontenery Docker (serwer glosowy LiveKit, pamiec MinIO, poczta Mailpit)
   - Uruchamia emulatory Firebase (Firestore, Auth, RTDB)
   - Zasila dane testowe i tworzy bucket pamieci MinIO
   - Uruchamia Express API
   - Buduje i instaluje aplikacje Android (jesli urzadzenie jest podlaczone)

   Gdy gotowe, zobaczysz:
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

3. **Logowanie**
   - Uzyj przepływu logowania e-mail z kontem testowym: `claude-test@shytalk.dev` / `localdev123`
   - Lub stworz nowe konto -- bedzie korzystac z lokalnych emulatorow
   - Logowanie Google/Apple nie dziala lokalnie (brak prawdziwego OAuth) -- uzyj e-mail OTP
   - Kody OTP sa przechwytywane przez Mailpit -- sprawdz http://localhost:8025

4. **Uruchomienie na urzadzeniu fizycznym**

   Twoj telefon musi byc w **tej samej sieci Wi-Fi** co maszyna deweloperska.

   a. Znajdz lokalne IP swojej maszyny:
   ```bash
   # Windows
   ipconfig    # Szukaj "IPv4 Address" pod adapterem Wi-Fi (np. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # lub: ip addr show
   ```

   b. Zaktualizuj lokalny flavor budowania, aby uzyc Twojego IP zamiast `10.0.2.2`. W `app/build.gradle.kts` znajdz flavor `local` i zmien:
   ```kotlin
   // Zamien 10.0.2.2 na lokalne IP Twojej maszyny
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Podlacz urzadzenie przez USB i wlacz debugowanie USB, nastepnie:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternatywnie, uzyj **adb reverse**, aby uniknac zmian w kodzie (urzadzenie kieruje localhost do Twojej maszyny):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulator Firestore
   adb reverse tcp:9099 tcp:9099   # Emulator Auth
   adb reverse tcp:9000 tcp:9000   # Emulator RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (pamiec obrazow)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Z `adb reverse`, domyslne adresy `10.0.2.2` w lokalnym flavorze beda dzialac takze na urzadzeniu fizycznym -- nie sa potrzebne zmiany konfiguracji budowania.

5. **Zatrzymanie lokalnych uslug**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Lub nacisnij `Ctrl+C` w terminalu skryptu startowego. Dane emulatorow sa automatycznie zapisywane i przywracane przy nastepnym uruchomieniu.

### Przydatne lokalne URL-e deweloperskie

| Usluga | URL | Cel |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Przegladanie danych Firestore, uzytkownikow Auth, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Health check | http://localhost:3000/api/health | Weryfikacja dzialania API |
| Mailpit | http://localhost:8025 | Przegladanie przechwyconych e-maili i kodow OTP |
| MinIO Console | http://localhost:9001 | Przegladanie przeslanych obrazow i plikow |

### Opcjonalne uslugi

**LibreTranslate (Tlumaczenie wiadomosci)**

Opcjonalny obraz Docker 6GB+ do lokalnego testowania funkcji tlumaczenia:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Nie zawarty w domyslnej konfiguracji z powodu duzego rozmiaru obrazu. Tlumaczenie dziala bez niego -- wiadomosci po prostu pozostaja nietlumaczone.

### Rozwoj chmurowy (Opcjonalny)

Jesli musisz testowac z prawdziwymi uslugami chmurowymi (np. prawdziwe powiadomienia push, prawdziwe logowanie Google):

1. **Konfiguracja Firebase**
   - Stworz projekt Firebase na [console.firebase.google.com](https://console.firebase.google.com)
   - Wlacz **Logowanie Google** i **Logowanie Apple** w Uwierzytelnianiu
   - Wlacz **Firestore**, **Realtime Database** i **Cloud Messaging**
   - Pobierz `google-services.json` i umiesc w `app/src/dev/`

2. **Konfiguracja Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edytuj z danymi uwierzytelniajacymi chmury
   npm install
   npm start
   ```

3. **Wdrazanie regul Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Budowanie aplikacji Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Zmienne srodowiskowe

| Zmienna | Opis | Gdzie |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON konta uslugowego Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID konta Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Klucz dostepu R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Tajny klucz R2 | Express API |
| `R2_BUCKET_NAME` | Nazwa bucketa R2 (domyslnie: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | Klucz API LiveKit (Azja/Singapur) | Express API |
| `LIVEKIT_SECRET_ASIA` | Sekret API LiveKit (Azja/Singapur) | Express API |
| `LIVEKIT_URL_ASIA` | URL serwera LiveKit (Azja) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | Klucz API LiveKit (UE/Londyn) | Express API |
| `LIVEKIT_SECRET_EU` | Sekret API LiveKit (UE/Londyn) | Express API |
| `LIVEKIT_URL_EU` | URL serwera LiveKit (UE) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | Klucz API LiveKit (awaryjny gdy klucze regionalne nie sa ustawione) | Express API |
| `LIVEKIT_API_SECRET` | Sekret API LiveKit (awaryjny gdy klucze regionalne nie sa ustawione) | Express API |
| `LIVEKIT_URL` | URL serwera LiveKit (wbudowany w aplikacje Android w czasie budowania) | Aplikacja Android (BuildConfig) |
| `WORKER_URL` | Bazowy URL Express API | Aplikacja Android (BuildConfig) |

## Testowanie

### Lokalne uruchamianie testow

```bash
# Interaktywne menu testow (wybierz co uruchomic):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Lub uruchom poszczegolne zestawy:
bash local/test-unit.sh       # Testy jednostkowe Kotlin + Express API
bash local/test-playwright.sh # Testy webowe Playwright (wymaga srodowiska lokalnego)
bash local/test-e2e.sh        # Testy E2E Android (wymaga srodowiska lokalnego + urzadzenia)
bash local/test-lint.sh       # ktlint + ESLint

# Wyswietl raport testow Allure:
npx allure serve allure-results
```

### Zestawy testow

| Zestaw | Polecenie | Ilosc |
|-------|---------|-------|
| Testy jednostkowe Kotlin | `./gradlew test` | 100+ testow |
| Testy Express API | `cd express-api && npm test` | 1 540+ testow |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 pliki funkcji |
| Testy webowe Playwright | `npx playwright test` | 28 specyfikacji |

```bash
# Testy jednostkowe Kotlin/KMP
./gradlew test

# Testy Express API
cd express-api && npm test

# Testy E2E (wymaga podlaczonego urzadzenia lub emulatora)
./gradlew connectedDevDebugAndroidTest

# Testy przegladarkowe Playwright (wymaga dzialajacego panelu administracyjnego)
npx playwright test
```

### Testowanie w CI

W CI testy Playwright i Android E2E uruchamiane sa w tym samym srodowisku lokalnym (emulatory + Docker) -- nie sa uzywane uslugi chmurowe. To zapewnia, ze testy nigdy nie koliduja z prawdziwymi testerami.

## Rozwiazywanie problemow

- **Port juz w uzyciu**: `lsof -i :<port>` (Linux/macOS) lub `netstat -ano | findstr :<port>` (Windows), aby znalezc co uzywa portu.
- **Docker nie dziala**: Upewnij sie, ze Docker Desktop jest uruchomiony. Uruchom `docker ps`, aby zweryfikowac.
- **Emulatory Firebase nie uruchamiaja sie**: Wymaga Java 21+. Sprawdz `java -version`.
- **Budowanie Android nie powiodlo sie**: Upewnij sie, ze JDK 21+ i Android SDK sa zainstalowane. Sprobuj `./gradlew clean`.
- **Urzadzenie adb nie wykryte**: Wlacz debugowanie USB. Uruchom `adb devices`, aby sprawdzic.
- **Obrazy sie nie laduja**: Bucket MinIO moze nie byc utworzony. Uruchom `cd express-api && NODE_ENV=local node ../local/seed.js`. Dla urzadzen fizycznych uruchom `adb reverse tcp:9002 tcp:9002`.
- **OTP nie dochodzi**: Sprawdz wyjscie konsoli pod katem linii `[OTP-LOCAL]`. Sprawdz tez UI Mailpit na http://localhost:8025.
- **Resetowanie danych emulatora**: Usun katalog `local/firebase-emulator-data/` i uruchom ponownie.
- **Resetowanie danych MinIO**: Uruchom `docker compose -f local/docker-compose.yml down -v`, aby usunac wolumeny.

## Wdrazanie

Wdrazania sa zarzadzane przez przeplywy pracy GitHub Actions (`.github/workflows/`):

| Przeplyw pracy | Wyzwalacz | Co robi |
|----------|---------|-------------|
| **PR Checks** | Automatycznie przy PR do `main` | Uruchamia lint, testy Kotlin, testy Express API, testy Playwright (na podstawie zmienionych plikow) |
| **Deploy to Dev** | Reczne (`workflow_dispatch`) | Wdraza Express API + web na dev, dystrybuuje APK do testerow, opcjonalnie uruchamia testy Playwright |
| **Deploy to Prod** | Reczne (`workflow_dispatch`) | Wdraza otagowane wydanie na prod -- Express API, web, Play Store i App Store |

Dodatkowe przeplywy: **E2E Tests** (matryca emulatorow Android), **SonarCloud** (analiza statyczna), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Wdrazana na maszyny wirtualne Oracle Cloud przez SSH + PM2 (dev: Londyn, prod: Singapur)
- **Android:** Pakowana i przesylana na Google Play przez CI
- **iOS:** Budowana i przesylana na App Store Connect / TestFlight przez CI
- **Panel administracyjny / web:** Wdrazany na Cloudflare Pages

## Wspoltworz

Wklady sa mile widziane! Prosimy o zapoznanie sie z [CONTRIBUTING.md](CONTRIBUTING.md) w celu uzyskania wytycznych.

## Licencja

Ten projekt jest licencjonowany na podstawie Licencji Apache 2.0. Szczegoly w [LICENSE](LICENSE).

## Podziekowania

- [Firebase](https://firebase.google.com) -- Uwierzytelnianie, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Komunikacja glosowa w czasie rzeczywistym
- [Cloudflare](https://www.cloudflare.com) -- Pamiec R2, hosting Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Darmowa maszyna wirtualna dla Express API
- [Express.js](https://expressjs.com) -- Framework serwera API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Nowoczesny deklaratywny UI
- [Koin](https://insert-koin.io) -- Lekka iniekcja zaleznosci
- [Coil](https://coil-kt.github.io/coil/) -- Ladowanie obrazow dla Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Animowane efekty prezentow i UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Wieloplatformowa data/czas
