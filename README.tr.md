# ShyTalk

**Sesli sohbet odalari, yeniden tasarlandi.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | **Türkçe** | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Hakkinda

ShyTalk, kullanicilarin gercek zamanli sesli sohbet odalari olusturup katilabilecegi sosyal bir sesli sohbet uygulamasidir. Kotlin Multiplatform (KMP) ile gelistirilmis olup, paylasilan bir kod tabani ile hem Android hem de iOS'u destekler. Bir sohbet yonetmek, dinlemek ya da dunyanin dort bir yanindaki insanlarla baglanti kurmak istiyorsaniz -- ShyTalk bunu kolaylastirir.

## Ozellikler

### Sesli Sohbet Odalari
- LiveKit destekli gercek zamanli sesle odalar olusturun veya katilim
- Sahip, moderator ve katilimci rolleriyle yapilandirilmis oturma sistemi
- Koltuk talepleri ve davetler -- bir koltuqa katilim isteyin veya dinleyicileri konusmaya davet edin
- Yuvarlak sohbet penceresi -- uygulamanin diger bolumlerinde gezinirken sesli sohbete devam edin
- Oda suresi dolumu -- sahip uzakta oldugunda odalar geri sayim zamanlayicilariyla otomatik kapanir

### Mesajlasma
- Her odada sesin yaninda canli metin sohbeti
- 1'e 1 gorusmelerle ozel mesajlasma
- Uye yonetimi ve izinlerle grup sohbetleri
- Gercek zamanli yazma gostergeleri
- Cikartma destegi

### Sosyal
- Fotograflar, kapak resimleri, milliyet bayraklari ve biyografilerle ozellestirilebilir kullanici profilleri
- Takip sistemi -- diger kullanicilari takip edin ve ne zaman aktif olduklarini gorun
- Hediye duvari -- diger kullanicilardan alinan hediyeleri sergileyin
- Engelleme sistemi -- odalarda ve profillerde kullanicilari engelleyin

### Sanal Ekonomi
- Cuzdanli ve islem gecmisli jeton tabanli ekonomi
- Seri bonuslariyla gunluk giris odulleri
- Kademeli odullerle Sans Carki (gacha) sistemi
- Sanal hediyeler -- sesli sohbet sirasinda animasyonlu hediyeler gonderin ve alin
- Hediyeleri saklamak icin sirt cantasi envanteri
- Jeton satin almak icin jeton paketleri
- Animasyonlu hediye efektleriyle yayin bannerlari

### Hesap ve Kimlik
- Coklu saglayici kimlik dogrulamasi -- Google, Apple veya E-posta (OTP) ile giris yapin
- Birden fazla giris yontemini tek bir hesaba baglayim
- Firebase projeleri arasinda kalici olan kararli kullanici kimligi (uniqueId)
- Ayarlarda baglama/cozme destegi ile Bagli Hesaplar yonetimi
- Cihaz baglama -- her cihaz kalici olarak bir hesaba baglidir

### Moderasyon ve Guvenlik
- Moderasyon araclari -- oda sahibi olarak sessize alma, cikarma, koltuk degistirme ve moderator yonetimi
- Inceleme is akisiyla kullanici raporlama sistemi
- Politika ihlalleri icin uyari ve askiya alma sistemi
- Topluluk standartlari, gizlilik politikasi ve kullanim kosullari ekranlari
- Yeni kullanicilar icin yasal kabul akisi
- Eski uygulama surumleri icin zorunlu guncelleme

### Baslangic Ekranlari
- Uygulama baslatildiginda gosterilen yapilandirmali baslangic ekranlari
- Zamanlama ve hedefleme secenekleriyle yonetici tarafindan yonetilen icerik

### Guvenlik
- Uygulama erisimi icin PIN kodu korumasi
- Biyometrik kimlik dogrulama -- parmak izi ve yuz tanima
- Hassas islemler icin OTP (tek kullanimlik sifre) dogrulamasi

### Yonetici Paneli
- Projenin statik sitesinde web tabanli moderasyon panosu
- Kullanici yonetimi, icerik moderasyonu ve yapilandirma
- Canli onizleme ile sablon ve hediye yonetimi
- Gercek zamanli log akisi ve uyarilar

### Goruntu Sikistirma
- Express API uzerinden yukleme sirasinda otomatik goruntu sikistirma
- Kaliteyi koruyarak depolama ve bant genisligi maliyetlerini azaltir

### Uluslararasilastirma
- Kutudan cikar cikmaz 19 dil destegi
- Tum kullaniciya yonelik dizeler icin tam yerellesitirme

### Gunluk Kaydi ve Izleme
- Express API, mobil uygulamalar ve yonetici panelinde yapilandirilmis gunluk kaydi
- Yonetici panosunda gercek zamanli log akisi
- Otomatik uygulama ile cihaz ve ag yasaklama
- Kritik hatalar ve anormallikler icin uyari sistemi
- Uctan uca istek takibi icin Trace ID yayilimi

## Teknoloji Yigini

| Katman | Teknoloji |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Mimari** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Kimlik Dogrulama** | Firebase Authentication (Google, Apple, Email+OTP) coklu saglayici kimlik sistemiyle |
| **Veritabani** | Cloud Firestore |
| **Gercek Zamanli** | Firebase Realtime Database |
| **Depolama** | Cloudflare R2 (Express API proxy uzerinden) |
| **API Sunucusu** | Express.js, Oracle Cloud Free Tier uzerinde |
| **Ses** | LiveKit |
| **Anlik Bildirimler** | Firebase Cloud Messaging |
| **Goruntu Yukleme** | Coil 3 (KMP) |
| **Animasyonlar** | Lottie Compose |
| **Tarih/Saat** | kotlinx-datetime |
| **Navigasyon** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Mimari

ShyTalk, temiz bir **Repository Pattern** ile **MVVM** mimarisini takip eder:

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

- **shared modulu** (`commonMain`) -- Platformlar arasi paylasilan modeller, repository arayuzleri, ViewModel'ler ve UI
- **app modulu** -- Android'e ozel ekranlar, repository uygulamalari ve giris noktasi
- **iosApp modulu** -- iOS'a ozel giris noktasi
- **express-api** -- Oracle Cloud Free Tier uzerinde calisan Express.js backend

## Proje Yapisi

```
ShyTalk/
+-- app/                              # Android uygulama modulu
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Uygulama giris noktasi
|       |   +-- MainActivity.kt       # Ana aktivite
|       |   +-- core/
|       |   |   +-- di/               # Koin DI modulu
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit ses, mevcudiyet, bildirimler
|       |   |   +-- repository/       # Repository uygulamalari
|       |   +-- feature/
|       |   |   +-- auth/             # Google giris ekrani
|       |   |   +-- profile/          # Profil ekrani
|       |   |   +-- room/             # Oda ekrani
|       |   |   +-- settings/         # Uygulama ayarlari
|       |   +-- navigation/           # NavGraph & Ekran rotalari
|       +-- test/                     # Birim testleri
|       +-- androidTest/              # E2E testleri (Compose UI Test)
+-- shared/                           # KMP paylasilan modul
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Paylasilan Koin modulleri
|       |   +-- model/                # Veri modelleri (User, ChatRoom, Gift vb.)
|       |   +-- ui/                   # Paylasilan bilesenler
|       |   +-- util/                 # Yardimci fonksiyonlar ve sabitler
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService vb.
|       |   +-- repository/           # Repository arayuzleri
|       +-- feature/                  # Paylasilan ozellik modulleri
+-- iosApp/                           # iOS uygulama modulu
+-- express-api/                      # Express.js API sunucusu
|   +-- src/
|       +-- routes/                   # API rota isleyicileri
|       +-- middleware/               # Auth, gunluk kaydi ara yazilimi
|       +-- utils/                    # Firebase Admin, R2, Logger
|       +-- cron/                     # Zamanlanmis gorevler
+-- public/                           # Statik site ve yonetici paneli
+-- local/                            # Yerel gelistirme ortami (emulatorler, test verileri)
+-- tests/web/                        # Playwright tarayici testleri
+-- scripts/                          # Yardimci betikler
+-- .github/workflows/                # CI/CD (PR Kontrolleri, Dev/Prod'a Dagitim, E2E, Lint)
+-- firestore.rules                   # Firestore guvenlik kurallari
+-- database.rules.json               # RTDB guvenlik kurallari
+-- firestore.indexes.json            # Firestore bilesik indeksler
+-- firebase.json                     # Firebase yapilandirmasi
```

## Baslarken

### Onkosuullar

- **Android Studio** Ladybug veya daha yenisi
- **JDK 17+**
- **Node.js 24+**
- **Docker** (yerel LiveKit sunucusu icin)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Yerel Gelistirme (Onerilen)

Baslamanin en hizli yolu. Firebase Emulatorleri ve yerel bir LiveKit Docker konteyneri kullanir -- bulut hesabi gerekmez, maliyet yok, kota siniri yok.

1. **Klonla ve yukle**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Yerel servisleri baslat**
   ```bash
   bash local/start.sh
   ```
   Bu, Firebase Emulatorlerini (Firestore, Auth, RTDB) ve bir LiveKit Docker konteynerini baslatir. Ilk calistirmada otomatik olarak test verileri yuklenir (yonetici kullanicisi, ornek hediyeler, yapilandirma).

   Goreceksiniz:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Express API'yi baslat** (yeni bir terminalde)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Gerekirse R2/SMTP degerlerini duzenleyin
   npm run local
   ```
   API `http://localhost:3000` adresinde baslar. Test: `curl http://localhost:3000/api/health`

4. **Android Emulatorde calistir**
   ```bash
   ./gradlew installLocalDebug
   ```
   `local` build flavor'u `10.0.2.2`'ye baglanir (Android emulatorunun makinenize dongusu). Ek yapilandirma gerekmeden calisir.

5. **Fiziksel bir cihazda calistir**

   Telefonunuz gelistirme makinenizle **ayni Wi-Fi aginda** olmalidir.

   a. Makinenizin yerel IP'sini bulun:
   ```bash
   # Windows
   ipconfig    # Wi-Fi adaptoru altinda "IPv4 Address" arayim (orn. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # veya: ip addr show
   ```

   b. Yerel build flavor'u `10.0.2.2` yerine IP'nizi kullanacak sekilde guncelleyin. `app/build.gradle.kts` dosyasinda `local` flavor'u bulun ve degistirin:
   ```kotlin
   // 10.0.2.2'yi makinenizin yerel IP'si ile degistirin
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Cihazinizi USB ile baglayin ve USB hata ayiklamayi etkinlestirin, ardindan:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternatif olarak, kod degisikligi yapmadan **adb reverse** kullanin (cihaz localhost'u makinenize yonlendirir):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   `adb reverse` ile yerel flavor'daki varsayilan `10.0.2.2` adresleri fiziksel bir cihazda da calisir -- build yapilandirma degisikligi gerekmez.

6. **Giris yap**
   - Yuklenmis test hesabiyla e-posta giris akisini kullanin: `claude-test@shytalk.dev` / `localdev123`
   - Veya yeni bir hesap olusturun -- yerel emulatorleri kullanacaktir
   - Google/Apple girisi yerel olarak calismaz (gercek OAuth yok) -- bunun yerine e-posta OTP kullanin

7. **Yerel servisleri durdur**
   ```bash
   bash local/stop.sh
   ```
   Veya `start.sh` terminalinde `Ctrl+C` tuslayin. Emulator verileri otomatik kaydedilir ve sonraki baslatmada geri yuklenir.

### Yararli Yerel Gelistirme URL'leri

| Servis | URL | Amac |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Firestore verileri, Auth kullanicilari, RTDB'ye gozat |
| Express API | http://localhost:3000 | Backend API |
| Saglik kontrolu | http://localhost:3000/api/health | API'nin calistigini dogrula |

### Bulut Gelistirme (Istege Bagli)

Gercek bulut hizmetlerine karsi test etmeniz gerekiyorsa (orn. gercek anlik bildirimler, gercek Google Girisi):

1. **Firebase kurulumu**
   - [console.firebase.google.com](https://console.firebase.google.com) adresinde bir Firebase projesi olusturun
   - Kimlik Dogrulamada **Google Girisi** ve **Apple Girisi**'ni etkinlestirin
   - **Firestore**, **Realtime Database** ve **Cloud Messaging**'i etkinlestirin
   - `google-services.json` dosyasini indirin ve `app/src/dev/` icine yerlestirin

2. **Express API kurulumu**
   ```bash
   cd express-api
   cp .env.example .env  # Bulut kimlik bilgilerinizle duzenleyin
   npm install
   npm start
   ```

3. **Firestore kurallarini dagit**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Android uygulamasini derle** (dev flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Ortam Degiskenleri

| Degisken | Aciklama | Nerede |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK hizmet hesabi JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 hesap kimlig | Express API |
| `R2_ACCESS_KEY_ID` | R2 erisim anahtari | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 gizli anahtar | Express API |
| `R2_BUCKET_NAME` | R2 bucket adi (varsayilan: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | LiveKit API anahtari | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API sifresi | Express API |
| `LIVEKIT_URL` | LiveKit sunucu URL'si | Android uygulamasi (BuildConfig) |
| `WORKER_URL` | Express API temel URL'si | Android uygulamasi (BuildConfig) |

## Testler

| Suite | Komut | Sayi |
|-------|---------|-------|
| Kotlin birim testleri | `./gradlew test` | 100+ test |
| Express API testleri | `cd express-api && npm test` | 1.540+ test |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature dosyasi |
| Playwright web testleri | `npx playwright test` | 28 spesifikasyon |

```bash
# Kotlin/KMP birim testleri
./gradlew test

# Express API testleri
cd express-api && npm test

# E2E testleri (bagli cihaz veya emulator gerektirir)
./gradlew connectedDevDebugAndroidTest

# Playwright tarayici testleri (yonetici panelinin calismasi gerekir)
npx playwright test
```

## Dagitim

Dagitimlar GitHub Actions is akislari uzerinden yonetilir (`.github/workflows/`):

| Is Akisi | Tetikleyici | Ne yapar |
|----------|---------|-------------|
| **PR Checks** | PR'larda `main`'e otomatik | Degisen dosyalara gore lint, Kotlin testleri, Express API testleri, Playwright testleri calistirir |
| **Deploy to Dev** | Manuel (`workflow_dispatch`) | Express API + web'i dev'e dagitir, test kullanicilarina APK dagitir, istege bagli Playwright testleri calistirir |
| **Deploy to Prod** | Manuel (`workflow_dispatch`) | Etiketlenmis bir surumu prod'a dagitir -- Express API, web, Play Store ve App Store |

Ek is akislari: **E2E Tests** (Android emulator matrisi), **SonarCloud** (statik analiz), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** SSH + PM2 ile Oracle Cloud VM'lerine dagitilir (dev: Londra, prod: Singapur)
- **Android:** CI uzerinden paketlenip Google Play'e yuklenir
- **iOS:** CI uzerinden derlenir ve App Store Connect / TestFlight'a yuklenir
- **Yonetici paneli / web:** Cloudflare Pages'e dagitilir

## Katki

Katkilar memnuniyetle karsilanir! Yonergeler icin lutfen [CONTRIBUTING.md](CONTRIBUTING.md) dosyasina bakin.

## Lisans

Bu proje Apache Lisansi 2.0 altinda lisanslanmistir. Ayrintilar icin [LICENSE](LICENSE) dosyasina bakin.

## Tesekkurler

- [Firebase](https://firebase.google.com) -- Kimlik dogrulama, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Gercek zamanli ses iletisimi
- [Cloudflare](https://www.cloudflare.com) -- R2 depolama, Pages barindirma, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Express API icin ucretsiz katman VM
- [Express.js](https://expressjs.com) -- API sunucu framework'u
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Modern bildirimsel UI
- [Koin](https://insert-koin.io) -- Hafif bagimlilik enjeksiyonu
- [Coil](https://coil-kt.github.io/coil/) -- Kotlin Multiplatform icin goruntu yukleme
- [Lottie](https://airbnb.design/lottie/) -- Animasyonlu hediye ve UI efektleri
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Cok platformlu tarih/saat
