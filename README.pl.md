# ShyTalk

**Pokoje czatu glosowego na nowo.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | **Polski** | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## O projekcie

ShyTalk to spolecznosciowa aplikacja czatu glosowego, w ktorej uzytkownicy moga tworzyc i dolaczac do pokojow czatu glosowego w czasie rzeczywistym. Zbudowana z wykorzystaniem Kotlin Multiplatform (KMP), obsluguje zarowno Androida, jak i iOS ze wspolna baza kodu. Niezaleznie od tego, czy chcesz prowadzic rozmowe, sluchac, czy nawiazywac kontakty z ludzmi na calym swiecie -- ShyTalk sprawia, ze to proste.

## Funkcje

### Pokoje czatu glosowego
- Tworzenie lub dolaczanie do pokojow z glosem w czasie rzeczywistym dzieki LiveKit
- Strukturalny system miejsc z rolami wlasciciela, hosta i uczestnika
- Prosby o miejsce i zaproszenia -- popros o miejsce lub zapros sluchaczy do rozmowy
- Plywajace okno czatu -- kontynuuj czat glosowy podczas przegladania innych czesci aplikacji
- Wygasanie pokoju -- pokoje zamykaja sie automatycznie, gdy wlasciciel jest nieobecny, z licznikami czasu

### Wiadomosci
- Tekstowy czat na zywo obok glosu w kazdym pokoju
- Prywatne wiadomosci z rozmowami 1-na-1
- Czaty grupowe z zarzadzaniem czlonkami i uprawnieniami
- Wskazniki pisania w czasie rzeczywistym
- Obsluga naklejek

### Funkcje spolecznosciowe
- Konfigurowalne profile uzytkownikow ze zdjeciami, obrazami okladek, flagami narodowosci i biografiami
- System obserwowania -- obserwuj innych uzytkownikow i zobacz, kiedy sa aktywni
- Sciana prezentow -- prezentuj prezenty otrzymane od innych uzytkownikow
- System blokowania -- blokuj uzytkownikow w pokojach i profilach

### Wirtualna ekonomia
- Ekonomia oparta na monetach z portfelem i historia transakcji
- Dzienne nagrody za logowanie z bonusami za serie
- System Lucky Spin (gacha) z wielopoziomowymi nagrodami
- Wirtualne prezenty -- wysylaj i otrzymuj animowane prezenty podczas czatow glosowych
- Inwentarz plecaka do przechowywania prezentow
- Pakiety monet do zakupu monet
- Banery rozgloszeniowe z animowanymi efektami prezentow

### Konto i tozsamosc
- Uwierzytelnianie wielu dostawcow -- zaloguj sie przez Google, Apple lub e-mail (OTP)
- Polacz wiele metod logowania z jednym kontem
- Stabilna tozsamosc uzytkownika (uniqueId), ktora utrzymuje sie miedzy projektami Firebase
- Zarzadzanie polaczonymi kontami w Ustawieniach z obsluga laczenia/odlaczania
- Powiazanie urzadzenia -- kazde urzadzenie jest trwale powiazane z jednym kontem

### Moderacja i bezpieczenstwo
- Narzedzia moderacji -- wyciszanie, wyrzucanie, przenoszenie miejsc i zarzadzanie hostami jako wlasciciel pokoju
- System zglaszania uzytkownikow z obiegiem przegladania
- System ostrzezen i zawieszen za naruszenia zasad
- Ekrany standardow spolecznosci, polityki prywatnosci i warunkow korzystania z uslugi
- Proces akceptacji prawnej dla nowych uzytkownikow
- Wymuszanie aktualizacji dla przestarzalych wersji aplikacji

### Ekrany startowe
- Konfigurowalne ekrany startowe wyswietlane przy uruchomieniu aplikacji
- Tresc zarzadzana przez administratora z opcjami planowania i targetowania

### Bezpieczenstwo
- Ochrona kodem PIN dla dostepu do aplikacji
- Uwierzytelnianie biometryczne -- odcisk palca i rozpoznawanie twarzy
- Weryfikacja OTP (jednorazowe haslo) dla wrazliwych operacji

### Panel administracyjny
- Internetowy panel moderacji na stronie statycznej projektu
- Zarzadzanie uzytkownikami, moderacja tresci i konfiguracja
- Zarzadzanie szablonami i prezentami z podgladem na zywo
- Strumieniowanie logow w czasie rzeczywistym i alerty

### Kompresja obrazow
- Automatyczna kompresja obrazow podczas przesylania przez Express API
- Zmniejsza koszty przechowywania i transferu przy zachowaniu jakosci

### Internacjonalizacja
- 19 jezykow obslugiwanych od reki
- Pelna lokalizacja wszystkich tekstow widocznych dla uzytkownika

### Logowanie i monitoring
- Strukturalne logowanie w Express API, aplikacjach mobilnych i panelu administracyjnym
- Strumieniowanie logow w czasie rzeczywistym w panelu administracyjnym
- Banowanie urzadzen i sieci z automatycznym egzekwowaniem
- System alertow dla krytycznych bledow i anomalii
- Propagacja Trace ID dla sledzenia zadan end-to-end

## Stos technologiczny

| Warstwa | Technologia |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architektura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Uwierzytelnianie** | Firebase Authentication (Google, Apple, Email+OTP) z systemem tozsamosci wielu dostawcow |
| **Baza danych** | Cloud Firestore |
| **Czas rzeczywisty** | Firebase Realtime Database |
| **Przechowywanie** | Cloudflare R2 (przez Express API proxy) |
| **Serwer API** | Express.js na Oracle Cloud Free Tier |
| **Glos** | LiveKit |
| **Powiadomienia push** | Firebase Cloud Messaging |
| **Ladowanie obrazow** | Coil 3 (KMP) |
| **Animacje** | Lottie Compose |
| **Data/Czas** | kotlinx-datetime |
| **Nawigacja** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Architektura

ShyTalk stosuje wzorzec **MVVM** z czystym **Repository Pattern**:

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

- **Modul shared** (`commonMain`) -- Modele, interfejsy repozytoriow, ViewModels i UI wspoldzielone miedzy platformami
- **Modul app** -- Ekrany specyficzne dla Androida, implementacje repozytoriow i punkt wejscia
- **Modul iosApp** -- Punkt wejscia specyficzny dla iOS
- **express-api** -- Backend Express.js na Oracle Cloud Free Tier

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
|       |   |   +-- remote/           # LiveKit glos, obecnosc, powiadomienia
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
|       +-- middleware/               # Auth, middleware logowania
|       +-- utils/                    # Firebase Admin, R2, Logger
|       +-- cron/                     # Zaplanowane zadania
+-- public/                           # Strona statyczna i panel administracyjny
+-- local/                            # Lokalne srodowisko deweloperskie (emulatory, dane testowe)
+-- tests/web/                        # Testy przegladarkowe Playwright
+-- scripts/                          # Skrypty pomocnicze
+-- .github/workflows/                # CI/CD (Kontrole PR, Deploy do Dev/Prod, E2E, Lint)
+-- firestore.rules                   # Reguly bezpieczenstwa Firestore
+-- database.rules.json               # Reguly bezpieczenstwa RTDB
+-- firestore.indexes.json            # Zlozone indeksy Firestore
+-- firebase.json                     # Konfiguracja Firebase
```

## Pierwsze kroki

### Wymagania wstepne

- **Android Studio** Ladybug lub nowszy
- **JDK 17+**
- **Node.js 24+**
- **Docker** (dla lokalnego serwera LiveKit)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Rozwoj lokalny (Zalecane)

Najszybszy sposob na rozpoczecie. Wykorzystuje emulatory Firebase i lokalny kontener Docker LiveKit -- nie sa potrzebne konta w chmurze, brak kosztow, brak limitow.

1. **Klonowanie i instalacja**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Uruchomienie lokalnych uslug**
   ```bash
   bash local/start.sh
   ```
   Uruchamia emulatory Firebase (Firestore, Auth, RTDB) i kontener Docker LiveKit. Przy pierwszym uruchomieniu automatycznie seeduje dane testowe (uzytkownik admin, przykladowe prezenty, konfiguracja).

   Zobaczysz:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Uruchomienie Express API** (w nowym terminalu)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Edytuj wartosci R2/SMTP w razie potrzeby
   npm run local
   ```
   API startuje na `http://localhost:3000`. Test: `curl http://localhost:3000/api/health`

4. **Uruchomienie na emulatorze Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   Wariant `local` laczy sie z `10.0.2.2` (loopback emulatora Android do twojej maszyny). Dziala od razu -- nie wymaga dodatkowej konfiguracji.

5. **Uruchomienie na urzadzeniu fizycznym**

   Twoj telefon musi byc w **tej samej sieci Wi-Fi** co maszyna deweloperska.

   a. Znajdz lokalne IP swojej maszyny:
   ```bash
   # Windows
   ipconfig    # Szukaj "IPv4 Address" pod adapterem Wi-Fi (np. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # lub: ip addr show
   ```

   b. Zaktualizuj lokalny wariant budowania, aby uzyc twojego IP zamiast `10.0.2.2`. W `app/build.gradle.kts` znajdz wariant `local` i zmien:
   ```kotlin
   // Zamien 10.0.2.2 na lokalne IP twojej maszyny
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Podlacz urzadzenie przez USB i wlacz debugowanie USB, nastepnie:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternatywnie uzyj **adb reverse**, aby uniknac zmian w kodzie (urzadzenie kieruje localhost do twojej maszyny):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulator Firestore
   adb reverse tcp:9099 tcp:9099   # Emulator Auth
   adb reverse tcp:9000 tcp:9000   # Emulator RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Z `adb reverse` domyslne adresy `10.0.2.2` w lokalnym wariancie dzialaja rowniez na urzadzeniu fizycznym -- nie sa potrzebne zmiany konfiguracji budowania.

6. **Logowanie**
   - Uzyj procesu logowania przez e-mail z seedowanym kontem testowym: `claude-test@shytalk.dev` / `localdev123`
   - Lub utworz nowe konto -- bedzie korzystac z lokalnych emulatorow
   - Logowanie przez Google/Apple nie dziala lokalnie (brak prawdziwego OAuth) -- uzyj zamiast tego e-mail OTP

7. **Zatrzymanie lokalnych uslug**
   ```bash
   bash local/stop.sh
   ```
   Lub nacisnij `Ctrl+C` w terminalu `start.sh`. Dane emulatora sa automatycznie zapisywane i przywracane przy nastepnym uruchomieniu.

### Przydatne URL-e dla rozwoju lokalnego

| Usluga | URL | Cel |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Przegladanie danych Firestore, uzytkownikow Auth, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Kontrola zdrowia | http://localhost:3000/api/health | Sprawdz, czy API dziala |

### Rozwoj w chmurze (Opcjonalnie)

Jesli musisz testowac z prawdziwymi uslugami chmurowymi (np. prawdziwe powiadomienia push, prawdziwe logowanie Google):

1. **Konfiguracja Firebase**
   - Utworz projekt Firebase na [console.firebase.google.com](https://console.firebase.google.com)
   - Wlacz **logowanie Google** i **logowanie Apple** w Uwierzytelnianiu
   - Wlacz **Firestore**, **Realtime Database** i **Cloud Messaging**
   - Pobierz `google-services.json` i umiest go w `app/src/dev/`

2. **Konfiguracja Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edytuj z danymi uwierzytelniajacymi chmury
   npm install
   npm start
   ```

3. **Wdrozenie regul Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Budowanie aplikacji Android** (wariant dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Zmienne srodowiskowe

| Zmienna | Opis | Gdzie |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON konta uslugowego Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | Identyfikator konta Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Klucz dostepu R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Tajny klucz R2 | Express API |
| `R2_BUCKET_NAME` | Nazwa bucketu R2 (domyslnie: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | Klucz API LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Tajny klucz API LiveKit | Express API |
| `LIVEKIT_URL` | URL serwera LiveKit | Aplikacja Android (BuildConfig) |
| `WORKER_URL` | Bazowy URL Express API | Aplikacja Android (BuildConfig) |

## Testowanie

| Zestaw | Polecenie | Ilosc |
|-------|---------|-------|
| Testy jednostkowe Kotlin | `./gradlew test` | 100+ testow |
| Testy Express API | `cd express-api && npm test` | 1540+ testow |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 pliki feature |
| Testy webowe Playwright | `npx playwright test` | 28 specyfikacji |

```bash
# Testy jednostkowe Kotlin/KMP
./gradlew test

# Testy Express API
cd express-api && npm test

# Testy E2E (wymaga podlaczonego urzadzenia lub emulatora)
./gradlew connectedDevDebugAndroidTest

# Testy przegladarkowe Playwright (wymaga uruchomionego panelu admin)
npx playwright test
```

## Wdrazanie

Wdrozenia sa zarzadzane przez workflows GitHub Actions (`.github/workflows/`):

| Workflow | Wyzwalacz | Co robi |
|----------|---------|-------------|
| **PR Checks** | Automatycznie przy PR-ach do `main` | Uruchamia lint, testy Kotlin, testy Express API, testy Playwright (na podstawie zmienionych plikow) |
| **Deploy to Dev** | Reczny (`workflow_dispatch`) | Wdraza Express API + web do dev, dystrybuuje APK do testerow, opcjonalnie uruchamia testy Playwright |
| **Deploy to Prod** | Reczny (`workflow_dispatch`) | Wdraza otagowane wydanie do prod -- Express API, web, Play Store i App Store |

Dodatkowe workflows: **E2E Tests** (macierz emulatorow Android), **SonarCloud** (analiza statyczna), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Wdrozony na maszynach Oracle Cloud VM przez SSH + PM2 (dev: Londyn, prod: Singapur)
- **Android:** Spakowany i wgrany do Google Play przez CI
- **iOS:** Zbudowany i wgrany do App Store Connect / TestFlight przez CI
- **Panel admin / Web:** Wdrozony na Cloudflare Pages

## Wspoltworzenie

Wklad jest mile widziany! Zapoznaj sie z [CONTRIBUTING.md](CONTRIBUTING.md), aby poznac wytyczne.

## Licencja

Ten projekt jest licencjonowany na podstawie Apache License 2.0. Zobacz [LICENSE](LICENSE), aby uzyskac szczegoly.

## Podziekowania

- [Firebase](https://firebase.google.com) -- Uwierzytelnianie, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Komunikacja glosowa w czasie rzeczywistym
- [Cloudflare](https://www.cloudflare.com) -- Przechowywanie R2, hosting Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Darmowa warstwa VM dla Express API
- [Express.js](https://expressjs.com) -- Framework serwera API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Nowoczesne deklaratywne UI
- [Koin](https://insert-koin.io) -- Lekkie wstrzykiwanie zaleznosci
- [Coil](https://coil-kt.github.io/coil/) -- Ladowanie obrazow dla Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Animowane efekty prezentow i UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Wieloplatformowa data/czas
