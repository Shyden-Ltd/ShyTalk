# ShyTalk

**Golosovi chat-kimnaty, pereosmussleni.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | **Українська** | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Pro proekt

ShyTalk -- tse sotsialnyi dodatok dlia holosovoho chatu, de korystuvachi mozhut stvoriuvaty ta doluchiatsia do holosovykh kimnat u realnomu chasi. Pobudovanyi na Kotlin Multiplatform (KMP), vin pidtrymuie Android ta iOS iz spilnoiu kodovoiu bazoiu. Chomu by vy ne khotily vesty rozmovu, slukhaty chy zv'iazuvatysia z liudmy z usoho svitu -- ShyTalk robyt tse prosto.

## Funktsii

### Holosovi chat-kimnaty
- Stvoriuite abo doluchaitesia do kimnat z holosom u realnomu chasi na bazi LiveKit
- Strukturovana systema misc z roliamy vlasnika, moderatora ta uchasnyka
- Zapyty na mistse ta zaproshennia -- zapytuite mistse abo zaprosit slukhachiv hovoryty
- Plavaiuchyi chat -- prodovzhuyte holosovyi chat, perehliadaiuchy inshi chastyny dodatku
- Termin dii kimnaty -- kimnaty avtomatychno zakryvaiutsia, koly vlasnyk vidsutii, z taimeramy zvorotnoho vidliku

### Povidomlennia
- Zhyvyi tekstovyi chat poriad z holosom u kozhnii kimnati
- Pryvatni povidomlennia z rozmovamy 1-na-1
- Hrupovi chaty z kerivnytstvm uchasnykiv ta dozvolamy
- Indykatory naboru tekstu v realnomu chasi
- Pidtrymka stykeeriv

### Sotsialne
- Nastroiuvani profili korystuvachiv z foto, obkladynkamy, praporamy krainy ta biohrafiiamy
- Systema pidpysok -- pidpysuitesia na inshykh korystuvachiv i divitsia, koly vony aktyvni
- Stina podarunkiv -- demonstruyte podarunky, otrymani vid inshykh korystuvachiv
- Systema blokuvannia -- blokuyte korystuvachiv u kimnatakh ta profiliakh

### Virtualna ekonomika
- Ekonomika na osnovi monet z hamantsem ta istoriieiu tranzaktsii
- Shchodenni nahorody za vkhid z bonusamy za seriiu
- Systema Kolo udachi (hacha) z rivnyamy pryziv
- Virtualni podarunky -- nadsilajte ta otrymuyte animovani podarunky pid chas holosovykh chativ
- Inventar riukzaka dlia zberihannia podarunkiv
- Pakety monet dlia prydbannia
- Trannsliatsiini banery z animovanymy efektamy podarunkiv

### Oblikovi zapys ta identychnist
- Bahatoprovaiderna avtentyfikatsiia -- vkhid cherez Google, Apple abo E-mail (OTP)
- Priv'iazhit kilka metodiv vkhodu do odnoho oblikovoho zapysu
- Stabilna identychnist korystuvacha (uniqueId), shcho zberighaietsia mizh proektamy Firebase
- Keruvannia pryvazanymy oblikovymy zapysamy v nalashtuvanniakh z pidtrymkoiu pryvazky/vidvazky
- Pryvazka prystroiu -- kozhen prystrii nazavzhdy pryvazanyi do odnoho oblikovoho zapysu

### Moderatsiia ta bezpeka
- Instrumenty moderatsii -- vymknennia zvuku, vykliuchennia, peremishchennia misc ta keruvannia moderatoramy yak vlasnyk kimnaty
- Systema skarh korystuvachiv z robochym protsesom perevirky
- Systema poperedzhen ta pryzupynen za porushennia polityky
- Ekrany standartiv spilnoty, polityky konfidentsinosti ta umov vykorystannia
- Potik pryiniattia pravovykh umov dlia novykh korystuvachiv
- Prymusove onovlennia dlia zastarilykh versii dodatku

### Startovi ekrany
- Nastroiuvani ekrany zapusku, shcho pokazuiutsia pry starti dodatku
- Keruvanyi administratorom vmist z parametramy planuvannia ta natsilennia

### Bezpeka
- Zakhyst PIN-kodom dlia dostupu do dodatku
- Biometrychna avtentyfikatsiia -- vidbytok palttsia ta rozpiznnavannia oblychchya
- OTP (odnorazovyi parol) dlia sensytyvnykh dii

### Panel administratora
- Veb-pannel moderatsii na statychnomu saiti proektu
- Keruvannia korystuvachamy, moderatsiia vmistu ta konfighuratsiia
- Keruvannia shablonamy ta podarunkamy z podhliadom u realnomu chasi
- Potokove lohuvannia ta spovishchennia v realnomu chasi

### Styskuvannia zobrazhen
- Avtomatychne styskuvannia zobrazhen pry zavantzhenni cherez Express API
- Zmenshuie vytraty na zberihannia ta smugu propuskannia, zberigaiuchy yakist

### Internatsionalizatsiia
- 19 mov pidtrymuyetsia odrazhu
- Povna lokalizatsiia usikh riadkiv, shcho bache korystuvach

### Lohuvannia ta monitorynh
- Strukturovane lohuvannia cherez Express API, mobilni dodatky ta panel administratora
- Potokove lohuvannia v realnomu chasi v paneli administratora
- Zaborona prystroiv ta merezh z avtomatychnym zastosuvannyam
- Systema spovishchen dlia krytychnykh pomylok ta anomalii
- Poshyrennia Trace ID dlia naskriznoho vidstezhennia zapytiv

## Tekhnolohichnyi stek

| Riven | Tekhnolohiia |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Arkhitektura** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Avtentyfikatsiia** | Firebase Authentication (Google, Apple, Email+OTP) z bahatoprovadernoiu systemoiu identychnosti |
| **Baza danykh** | Cloud Firestore |
| **Realnyi chas** | Firebase Realtime Database |
| **Skhovyshche** | Cloudflare R2 (cherez Express API proksi) |
| **API-server** | Express.js na Oracle Cloud Free Tier |
| **Holos** | LiveKit |
| **Push-spovishchennia** | Firebase Cloud Messaging |
| **Zavantazhennia zobrazhen** | Coil 3 (KMP) |
| **Animatsii** | Lottie Compose |
| **Data/Chas** | kotlinx-datetime |
| **Navihatsiia** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Arkhitektura

ShyTalk dotrymuietsia patterna **MVVM** z chystym **Repository Pattern**:

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

- **shared modul** (`commonMain`) -- Modeli, interfejsy repozytoriv, ViewModel ta UI, spilni dlia platform
- **app modul** -- Ekrany, spetsyfichni dlia Android, implementatsii repozytoriv ta tochka vkhodu
- **iosApp modul** -- Tochka vkhodu, spetsyfichna dlia iOS
- **express-api** -- Express.js backend na Oracle Cloud Free Tier

## Struktura proektu

```
ShyTalk/
+-- app/                              # Modul dodatku Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Tochka vkhodu dodatku
|       |   +-- MainActivity.kt       # Holovna aktyvnist
|       |   +-- core/
|       |   |   +-- di/               # Modul Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit holos, prysutnist, spovishchennia
|       |   |   +-- repository/       # Implementatsii repozytoriv
|       |   +-- feature/
|       |   |   +-- auth/             # Ekran vkhodu Google
|       |   |   +-- profile/          # Ekran profiliu
|       |   |   +-- room/             # Ekran kimnaty
|       |   |   +-- settings/         # Nalashtuvannia dodatku
|       |   +-- navigation/           # NavGraph ta marshruty ekraniv
|       +-- test/                     # Modulni testy
|       +-- androidTest/              # E2E testy (Compose UI Test)
+-- shared/                           # KMP spilnyi modul
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Spilni moduli Koin
|       |   +-- model/                # Modeli danykh (User, ChatRoom, Gift toshcho)
|       |   +-- ui/                   # Spilni komponenty
|       |   +-- util/                 # Utiliti ta konstanty
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService toshcho
|       |   +-- repository/           # Interfejsy repozytoriv
|       +-- feature/                  # Spilni feature-moduli
+-- iosApp/                           # Modul dodatku iOS
+-- express-api/                      # Express.js API-server
|   +-- src/
|       +-- routes/                   # Obrobnyky API-marshrutiv
|       +-- middleware/               # Auth, lohuvannia middleware
|       +-- utils/                    # Firebase Admin, R2, Logger
|       +-- cron/                     # Zaplanovani zavdannia
+-- public/                           # Statychnyi sait ta panel administratora
+-- local/                            # Lokalne seredovyshche rozrobky (emulatory, testovi dani)
+-- tests/web/                        # Playwright testy brauzera
+-- scripts/                          # Dopomizhni skrypty
+-- .github/workflows/                # CI/CD (PR Perevirky, Rozhortannia na Dev/Prod, E2E, Lint)
+-- firestore.rules                   # Pravyla bezpeky Firestore
+-- database.rules.json               # Pravyla bezpeky RTDB
+-- firestore.indexes.json            # Skladeni indeksy Firestore
+-- firebase.json                     # Konfiguratsiia Firebase
```

## Pochatok roboty

### Peredumovy

- **Android Studio** Ladybug abo novishyi
- **JDK 17+**
- **Node.js 24+**
- **Docker** (dlia lokalnoho servera LiveKit)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Lokalna rozrobka (Rekomendovano)

Naishvydshyi sposib pochaty. Vykorystovuie Firebase Emulatory ta lokalnyi Docker kontejner LiveKit -- ne potribni khmarni obllikovi zapysy, bez vytrat, bez limitiv kvot.

1. **Klonuvannia ta vstanovlennia**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Zapusk lokalnykh servisiv**
   ```bash
   bash local/start.sh
   ```
   Tse zapuskaie Firebase Emulatory (Firestore, Auth, RTDB) ta Docker kontejner LiveKit. Pry pershomu zapusku avtomatychno zahruzhuiutsia testovi dani (korystuvach-administrator, zrazky podarunkiv, konfiguratsiia).

   Vy pobachyte:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Zapustit Express API** (u novomu terminali)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Vidredahuyte znachennia R2/SMTP za potreby
   npm run local
   ```
   API zapuskaietsia na `http://localhost:3000`. Test: `curl http://localhost:3000/api/health`

4. **Zapusk na emulatori Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   Build flavor `local` pidkliuchaietsia do `10.0.2.2` (zvorotnyi tsykl emulatora Android do vashoii mashyny). Pratsiuie odrazhu -- dodatkova konfiguratsiia ne potribna.

5. **Zapusk na fizychnomu prystroii**

   Vash telefon maie buty u **tii samii Wi-Fi merezhi**, shcho i vasha mashyna rozrobky.

   a. Znaidit lokalnyi IP vashoii mashyny:
   ```bash
   # Windows
   ipconfig    # Shukajte "IPv4 Address" pid vashym Wi-Fi adapterom (napr. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # abo: ip addr show
   ```

   b. Onovit lokalnyi build flavor, shchob vykorystovuvaty vashu IP zamist `10.0.2.2`. U `app/build.gradle.kts` znaidit flavor `local` ta zminit:
   ```kotlin
   // Zaminit 10.0.2.2 na lokalnyi IP vashoii mashyny
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Pidkliuchit prystrii cherez USB ta vvimknit nalahodzhennia USB, potim:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternatyvno vykorystovuite **adb reverse**, shchob unyknuty zmin kodu (prystrii perenapravliaie localhost na vashu mashynu):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulator Firestore
   adb reverse tcp:9099 tcp:9099   # Emulator Auth
   adb reverse tcp:9000 tcp:9000   # Emulator RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Z `adb reverse` adresy `10.0.2.2` za zamovchuvannyam u lokalnomu flavori pratsyuvatymut i na fizychnomu prystroii -- zminy konfiguratsii zbirky ne potribni.

6. **Vvijty**
   - Vykorystovuite potik vkhodu cherez email z tesotovym oblikovym zapysom: `claude-test@shytalk.dev` / `localdev123`
   - Abo stvorit novyi oblikovyi zapys -- vin vykorystovuvatyme lokalni emulatory
   - Vkhid cherez Google/Apple ne pratsyie lokalno (nemaie realnoho OAuth) -- vykorystovuite email OTP

7. **Zupynka lokalnykh servisiv**
   ```bash
   bash local/stop.sh
   ```
   Abo natysnitl `Ctrl+C` u terminali `start.sh`. Dani emulatora avtomatychno zberighaytsia ta vidnovliuiutsia pry nastupnomu zapusku.

### Korysni URL dlia lokalnoi rozrobky

| Servis | URL | Pryznachennia |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Perehliad danykh Firestore, korystuvachiv Auth, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Perevirka zdorovia | http://localhost:3000/api/health | Perevirka roboty API |

### Khmarna rozrobka (Neoboviazkovoi)

Yakshcho vam potribno testuvaty z realnymy khmarnymy servisamy (napr. realni push-spovishchennia, realnyi vkhid cherez Google):

1. **Nalashtuvannia Firebase**
   - Stvorit proekt Firebase na [console.firebase.google.com](https://console.firebase.google.com)
   - Uvimknit **Vkhid cherez Google** ta **Vkhid cherez Apple** v Avtentyfikatsii
   - Uvimknit **Firestore**, **Realtime Database** ta **Cloud Messaging**
   - Zavantazhte `google-services.json` ta rozmistit u `app/src/dev/`

2. **Nalashtuvannia Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Vidredahuyte z vashymy khmarnymy oblikovymy danymy
   npm install
   npm start
   ```

3. **Rozhortannia pravyl Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Zbirka dodatku Android** (dev flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Zminni seredovyshcha

| Zminna | Opys | De |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON servisnoho obliikovoho zapysu Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID obliikovoho zapysu Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Kliuch dostupu R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Sekretnyi kliuch R2 | Express API |
| `R2_BUCKET_NAME` | Nazva R2 bucket (za zamovchuvannyam: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | API kliuch LiveKit | Express API |
| `LIVEKIT_API_SECRET` | API sekret LiveKit | Express API |
| `LIVEKIT_URL` | URL servera LiveKit | Dodatok Android (BuildConfig) |
| `WORKER_URL` | Bazova URL Express API | Dodatok Android (BuildConfig) |

## Testuvannia

| Suite | Komanda | Kilkist |
|-------|---------|-------|
| Modulni testy Kotlin | `./gradlew test` | 100+ testiv |
| Testy Express API | `cd express-api && npm test` | 1 540+ testiv |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature-faily |
| Playwright web testy | `npx playwright test` | 28 spetsyfikatsii |

```bash
# Modulni testy Kotlin/KMP
./gradlew test

# Testy Express API
cd express-api && npm test

# E2E testy (potribien pidkliuchenyi prystrii abo emulator)
./gradlew connectedDevDebugAndroidTest

# Playwright testy brauzera (potribna zapushchena panel administratora)
npx playwright test
```

## Rozhortannia

Rozhortannia keruiutsia cherez robochi protsesy GitHub Actions (`.github/workflows/`):

| Robochyi protses | Trygher | Shcho robytt |
|----------|---------|-------------|
| **PR Checks** | Avtomatychno na PR do `main` | Zapuskaie lint, testy Kotlin, testy Express API, testy Playwright (zalezhno vid zminyenykh fajliv) |
| **Deploy to Dev** | Vruchnu (`workflow_dispatch`) | Rozhortaie Express API + web na dev, rozpodilaie APK testerau, za bazhannyam zapuskaie testy Playwright |
| **Deploy to Prod** | Vruchnu (`workflow_dispatch`) | Rozhortaie pozhnachehnyi reliz na prod -- Express API, web, Play Store ta App Store |

Dodatkovi robochi protsesy: **E2E Tests** (matrytsia emulatoriv Android), **SonarCloud** (statychnyi analiz), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Rozhortaietsia na VM Oracle Cloud cherez SSH + PM2 (dev: London, prod: Sinhnapur)
- **Android:** Pakuietsia ta zavanttazhuietsia na Google Play cherez CI
- **iOS:** Zbyraietsia ta zavantazhuietsia na App Store Connect / TestFlight cherez CI
- **Panel administratora / web:** Rozhortaietsia na Cloudflare Pages

## Uchast

Vneski vitaiutsia! Bud laska, dyvitsia [CONTRIBUTING.md](CONTRIBUTING.md) dlia rekomendatsii.

## Litsenziia

Tsei proekt litsenzovanyi za litsenziieiu Apache 2.0. Dyvitsia [LICENSE](LICENSE) dlia detailei.

## Podiaky

- [Firebase](https://firebase.google.com) -- Avtentyfikatsiia, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Holsovyi zv'iazok u realnomu chasi
- [Cloudflare](https://www.cloudflare.com) -- Skhovyshche R2, khostynh Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Bezkhoshtovna VM dlia Express API
- [Express.js](https://expressjs.com) -- Framework API-servera
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Suchasnyi deklaratyvnyi UI
- [Koin](https://insert-koin.io) -- Lehka in'iektsiia zalezhnostei
- [Coil](https://coil-kt.github.io/coil/) -- Zavantazhennia zobrazhen dlia Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Animovani efekty podarunkiv ta UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Bahatoplatformni data/chas
