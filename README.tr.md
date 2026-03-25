# ShyTalk

**Sesli sohbet odalari, yeniden tasarlandi.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | **Türkçe** | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Hakkında

ShyTalk, kullanıcıların gerçek zamanlı sesli sohbet odaları oluşturabileceği ve katılabileceği bir sosyal sesli sohbet uygulamasıdır. Kotlin Multiplatform (KMP) ile oluşturulan bu uygulama, Android ve iOS'u paylaşılan bir kod tabanı ile hedefler. Konuşma barındırmak, dinlemek veya dünyada insanlarla bağlantı kurmak istiyorsanız, ShyTalk bunu kolaylaştırır.

iOS desteklenen bir platformdur ancak bu rehber, birincil geliştirme hedefi olan Android geliştirmeye odaklanır.

## Özellikler

### Sesli Sohbet Odaları
- LiveKit tarafından desteklenen gerçek zamanlı sesle odalara katılın veya oluşturun
- Sahip, host ve katılımcı rollerine sahip yapılandırılmış oturum sistemi
- Koltuk istekleri ve davetler -- bir koltuğa katılmayı isteyin veya dinleyicileri konuşmaya davet edin
- Kayan sohbet başlığı -- uygulamanın diğer bölümlerine göz atarken sesli sohbeti devam ettirin
- Oda geçerliliği -- sahip uzakta olduğunda odalar geri sayım zamanlayıcıları ile otomatik olarak kapanır

### Mesajlaşma
- Her odada sesle birlikte canlı metin sohbeti
- 1-on-1 konuşmalarla özel mesajlaşma
- Üye yönetimi ve izinleri olan grup sohbetleri
- Gerçek zamanlı yazma göstergeleri
- Çıkartma desteği

### Sosyal
- Fotoğraf, kapak görselleri, milliyetlik bayrakları ve biyografilerle özelleştirilebilir kullanıcı profilleri
- Takip sistemi -- diğer kullanıcıları takip edin ve etkin olduklarında görün
- Hediye duvarı -- diğer kullanıcılardan alınan hediyeleri sergileyip
- Bloke sistemi -- odalar ve profiller arasında kullanıcıları engelleyin

### Sanal Ekonomi
- Cüzdan ve işlem geçmişi ile madeni para tabanlı ekonomi
- Giriş çizgi bonusları ile günlük giriş ödülleri
- Katmanlı ödüller ile Lucky Spin (gacha) sistemi
- Sanal hediyeler -- sesli sohbetler sırasında animasyonlu hediyeler gönderin ve alın
- Hediyeleri depolamak için Sırt çantası envanteri
- Madeni para satın almak için Madeni para paketleri
- Animasyonlu hediye efektli Yayın paftaları

### Hesap & Kimlik
- Çoklu sağlayıcı kimlik doğrulaması -- Google, Apple veya E-posta (OTP) ile giriş yapın
- Birden fazla giriş yöntemini tek bir hesaba bağlayın
- Firebase projeleri arasında devam eden Kararlı kullanıcı kimliği (uniqueId)
- Ayarlar'da Bağlı Hesaplar yönetimi ile bağlama/çöz desteği
- Cihaz bağlaması -- her cihaz kalıcı olarak bir hesaba bağlanır

### İtidal & Güvenlik
- Moderation araçları -- oda sahibi olarak sessiz, atma, koltukları taşı ve hostları yönet
- İnceleme iş akışı ile kullanıcı raporlama sistemi
- İlke ihlalleri için uyarı ve askıya alma sistemi
- Topluluk standartları, gizlilik politikası ve hizmet şartları ekranları
- Yeni kullanıcılar için yasal kabul akışı
- Eski uygulama sürümleri için zorunlu güncelleme uygulaması

### Başlangıç Ekranları
- Uygulama başlangıcında gösterilen yapılandırılabilir başlatma ekranları
- Planlama ve hedefleme seçenekleri ile yönetici tarafından yönetilen içerik

### Güvenlik
- Uygulama erişimi için PIN kodu koruması
- Biyometrik kimlik doğrulaması -- parmak izi ve yüz tanıma
- Hassas işlemler için OTP (tek kullanımlık şifre) doğrulaması

### Yönetici Paneli
- Projenin statik sitesinde web tabanlı moderation panosu
- Kullanıcı yönetimi, içerik moderasyonu ve yapılandırma
- Canlı önizleme ile şablon ve hediye yönetimi
- Gerçek zamanlı günlük akışı ve uyarı

### Görüntü Sıkıştırma
- Express API üzerinden yükleme sırasında otomatik görüntü sıkıştırması
- Kaliteyi korurken depolama ve bant genişliği maliyetlerini azaltır

### Uluslararasılaştırma
- Kutusuz 19 dil desteği
- Tüm kullanıcı karşılıklı dizeler için tam yerelleştirme

### Günlük Tutuş & İzleme
- Express API, mobil uygulamalar ve yönetici paneli arasında yapılandırılmış günlük tutuş
- Yönetici panosunda gerçek zamanlı günlük akışı
- Otomatik uygulamalar ile cihaz ve ağ yasaklaması
- Kritik hatalar ve anomaliler için uyarı sistemi
- Uçtan uca istek izleme için Trace ID yayılması

## Teknoloji Yığını

| Layer | Technology |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Architecture** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Auth** | Firebase Authentication (Google, Apple, Email+OTP) with multi-provider identity system |
| **Database** | Cloud Firestore |
| **Real-time** | Firebase Realtime Database |
| **Storage** | Cloudflare R2 (via Express API proxy) |
| **API Server** | Express.js on Oracle Cloud Free Tier |
| **Voice** | LiveKit |
| **Push Notifications** | Firebase Cloud Messaging |
| **Image Loading** | Coil 3 (KMP) |
| **Animations** | Lottie Compose |
| **Date/Time** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Mimarı

ShyTalk, temiz bir **Repository Pattern** ile **MVVM** takip eder:

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

- **shared modülü** (`commonMain`) -- Modeller, depo arayüzleri, ViewModeller ve platformlar arasında paylaşılan UI
- **app modülü** -- Android'e özel ekranlar, depo uygulamaları ve giriş noktası
- **iosApp modülü** -- iOS'a özel giriş noktası
- **express-api** -- Oracle Cloud Ücretsiz Seviye'sinde çalışan Express.js arka ucu

## Proje Yapısı

```
ShyTalk/
+-- app/                              # Android app module
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Application entry point
|       |   +-- MainActivity.kt       # Main activity
|       |   +-- core/
|       |   |   +-- di/               # Koin DI module
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit voice, presence, notifications
|       |   |   +-- repository/       # Repository implementations
|       |   +-- feature/
|       |   |   +-- auth/             # Google Sign-In screen
|       |   |   +-- profile/          # Profile screen
|       |   |   +-- room/             # Room screen
|       |   |   +-- settings/         # App settings
|       |   +-- navigation/           # NavGraph & Screen routes
|       +-- test/                     # Unit tests
|       +-- androidTest/              # E2E tests (Compose UI Test)
+-- shared/                           # KMP shared module
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Shared Koin modules
|       |   +-- model/                # Data models (User, ChatRoom, Gift, etc.)
|       |   +-- ui/                   # Shared components
|       |   +-- util/                 # Utilities & constants
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # Repository interfaces
|       +-- feature/                  # Shared feature modules
+-- iosApp/                           # iOS app module
+-- express-api/                      # Express.js API server
|   +-- src/
|       +-- routes/                   # API route handlers
|       +-- middleware/               # Auth, logging middleware
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Scheduled jobs
+-- public/                           # Static site & admin panel
+-- local/                            # Local development environment (emulators, seed data)
+-- tests/web/                        # Playwright browser tests
+-- scripts/                          # Utility scripts
+-- .github/workflows/                # CI/CD (PR Checks, Deploy to Dev/Prod, E2E, lint)
+-- firestore.rules                   # Firestore security rules
+-- database.rules.json               # RTDB security rules
+-- firestore.indexes.json            # Firestore composite indexes
+-- firebase.json                     # Firebase configuration
```

## Başlarken

### Ön Koşullar

- **Android Studio** Ladybug veya daha yeni
- **JDK 17+**
- **Node.js 24+**
- **Docker** (LiveKit sesli sunucu, MinIO depolama, Mailpit e-postası için)
- **Firebase CLI** (`npm install -g firebase-tools`)

Başlamak için bulut hesaplarına gerek yoktur -- yerel ortam tamamen çevrimdışı çalışır.

### Yerel Geliştirme (Önerilir)

Başlamanın en hızlı yolu. Bir komut her şeyi başlatır -- Firebase Emülatörleri, Docker konteynerlerini, Express API'yi ve Android uygulamasını oluşturur. Bulut hesabına, maliyete veya kota sınırlarına gerek yoktur.

1. **Klonla ve yükle**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Her şeyi başlat**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Bu tek komut:
   - Docker konteynerlerini başlatır (LiveKit sesli sunucu, MinIO depolama, Mailpit e-postası)
   - Firebase Emülatörlerini başlatır (Firestore, Auth, RTDB)
   - Test verilerini tohumlar ve MinIO depolama kovanını oluşturur
   - Express API'yi başlatır
   - Android uygulamasını oluşturur ve yükler (cihaz bağlı ise)

   Hazır olduğunda şunu göreceksiniz:
   ```
   Yerel ortam hazır (tam çevrimdışı):

     Hizmetler:
       Firebase UI:    http://localhost:4000
       Express API:    http://localhost:3000
       Mailpit UI:     http://localhost:8025
       MinIO Console:  http://localhost:9001
       LiveKit:        localhost:7880

     Kimlik Bilgileri:
       Test yöneticisi:     claude-test@shytalk.dev / localdev123
       Test kullanıcısı:      user@test.com / localdev123
       MinIO:          minioadmin / minioadmin
   ```

3. **Giriş yap**
   - Tohumlanmış test hesabı ile e-posta oturum açma akışını kullanın: `claude-test@shytalk.dev` / `localdev123`
   - Veya yeni bir hesap oluşturun -- yerel emülatörleri kullanacaktır
   - Google/Apple oturum açması yerel olarak çalışmaz (gerçek OAuth yok) -- bunun yerine e-posta OTP'sini kullanın
   - OTP kodları Mailpit tarafından yakalanır -- http://localhost:8025 adresini kontrol edin

4. **Fiziksel Cihazda Çalıştırın**

   Telefonunuz, geliştirme makinenizle aynı **Wi-Fi ağında** olmalıdır.

   a. Makinenizin yerel IP'sini bulun:
   ```bash
   # Windows
   ipconfig    # Wi-Fi bağdaştırıcınız altında "IPv4 Adresi"ni arayın (örn. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # veya: ip addr show
   ```

   b. Yerel yapı lezzetini `10.0.2.2` yerine IP'nizi kullanacak şekilde güncelleyin. `app/build.gradle.kts` içinde `local` lezzetini bulun ve değiştirin:
   ```kotlin
   // 10.0.2.2 yerine makinenizin yerel IP'sini değiştirin
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Cihazınızı USB aracılığıyla bağlayın ve USB hata ayıklamayı etkinleştirin, ardından:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternatif olarak, herhangi bir kodu değiştirmekten kaçınmak için **adb reverse** kullanın (cihaz localhost'u makinenize yönlendirir):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emülatörü
   adb reverse tcp:9099 tcp:9099   # Auth emülatörü
   adb reverse tcp:9000 tcp:9000   # RTDB emülatörü
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (görüntü depolama)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   `adb reverse` ile, yerel lezzetteki varsayılan `10.0.2.2` adresleri fiziksel bir cihazda da çalışacaktır -- yapı konfigürasyonu değişikliklerine gerek yoktur.

5. **Yerel hizmetleri durdur**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Veya başlat komut dosyası terminalinde `Ctrl+C` tuşuna basın. Emülatör verileri otomatik olarak kaydedilir ve sonraki başlangıçta geri yüklenir.

### Faydalı Yerel Dev URL'leri

| Hizmet | URL | Amaç |
|---------|-----|---------|
| Firebase Emülatör UI | http://localhost:4000 | Firestore verilerini, Auth kullanıcılarını, RTDB'yi göz atın |
| Express API | http://localhost:3000 | Arka uç API'si |
| Sağlık kontrolü | http://localhost:3000/api/health | API'nin çalışır durumda olduğunu doğrulayın |
| Mailpit | http://localhost:8025 | Yakalanan e-postaları ve OTP kodlarını görüntüleyin |
| MinIO Konsolu | http://localhost:9001 | Yüklenmiş görselleri ve dosyaları göz atın |

### İsteğe Bağlı Hizmetler

**LibreTranslate (İleti Çevirisi)**

Çeviri özelliğini yerel olarak test etmek için isteğe bağlı 6GB+ Docker görüntüsü:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Büyük görüntü boyutu nedeniyle varsayılan kuruluma dahil değildir. Çeviri bunu olmadan çalışır -- iletiler çevrilmez.

### Bulut Geliştirme (İsteğe Bağlı)

Gerçek bulut hizmetlerine karşı test etmeniz gerekiyorsa (örneğin, gerçek itme bildirimleri, gerçek Google Oturum Açma):

1. **Firebase kurulumu**
   - [console.firebase.google.com](https://console.firebase.google.com) adresinde bir Firebase projesi oluşturun
   - Kimlik Doğrulamada **Google Oturum Açma** ve **Apple Oturum Açma**'yı etkinleştirin
   - **Firestore**, **Gerçek Zamanlı Veritabanı** ve **Bulut Mesajlaşması**'nı etkinleştirin
   - `google-services.json` dosyasını indirin ve `app/src/dev/` konumuna yerleştirin

2. **Express API kurulumu**
   ```bash
   cd express-api
   cp .env.example .env  # Bulut kimlik bilgilerinizle düzenleyin
   npm install
   npm start
   ```

3. **Firestore kurallarını dağıt**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Android uygulamasını oluştur** (dev lezzeti)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Ortam Değişkenleri

| Değişken | Açıklama | Nerede |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK hizmet hesabı JSON'u | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 hesap kimliği | Express API |
| `R2_ACCESS_KEY_ID` | R2 erişim anahtarı | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 gizli anahtarı | Express API |
| `R2_BUCKET_NAME` | R2 kova adı (varsayılan: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | LiveKit API anahtarı | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API sırrı | Express API |
| `LIVEKIT_URL` | LiveKit sunucu URL'si | Android uygulaması (BuildConfig) |
| `WORKER_URL` | Express API temel URL'si | Android uygulaması (BuildConfig) |

## Test

### Testleri Yerel Olarak Çalıştırma

```bash
# İnteraktif test menüsü (çalıştırılacak seçin):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Veya bireysel paketleri çalıştırın:
bash local/test-unit.sh       # Kotlin + Express API birim testleri
bash local/test-playwright.sh # Playwright web testleri (yerel ortama ihtiyaç duyar)
bash local/test-e2e.sh        # Android E2E testleri (yerel ortam + cihaza ihtiyaç duyar)
bash local/test-lint.sh       # ktlint + ESLint

# Allure test raporunu görüntüle:
npx allure serve allure-results
```

### Test Paketleri

| Paket | Komut | Say |
|-------|---------|-------|
| Kotlin birim testleri | `./gradlew test` | 100+ test |
| Express API testleri | `cd express-api && npm test` | 1,540+ test |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 özellik dosyası |
| Playwright web testleri | `npx playwright test` | 28 spec |

```bash
# Kotlin/KMP birim testleri
./gradlew test

# Express API testleri
cd express-api && npm test

# E2E testleri (bağlı cihaz veya emülatör gerekir)
./gradlew connectedDevDebugAndroidTest

# Playwright tarayıcı testleri (yönetici paneli çalışması gerekir)
npx playwright test
```

### CI'de Test Etme

CI'de, Playwright ve Android E2E testleri aynı yerel ortamda (emülatörler + Docker) çalışır -- hiçbir bulut hizmeti kullanılmaz. Bu, testlerin canlı test edicilerle hiçbir zaman müdahale etmemesini sağlar.

## Sorun Giderme

- **Bağlantı noktası zaten kullanımda**: `lsof -i :<port>` (Linux/macOS) veya `netstat -ano | findstr :<port>` (Windows) bağlantı noktasını neyin kullandığını bulun.
- **Docker çalışmıyor**: Docker Desktop'un başlatıldığından emin olun. Doğrulamak için `docker ps` çalıştırın.
- **Firebase emülatörleri başlatılamıyor**: Java 11+ gerektirir. `java -version` ile kontrol edin.
- **Android yapısı başarısız**: JDK 17+ ve Android SDK'nın yüklendiğinden emin olun. `./gradlew clean` deneyin.
- **adb cihazı algılanmadı**: USB hata ayıklamayı etkinleştirin. Kontrol etmek için `adb devices` çalıştırın.
- **Görüntüler yüklenmiyorsa**: MinIO kovası oluşturulmamış olabilir. `cd express-api && NODE_ENV=local node ../local/seed.js` çalıştırın. Fiziksel cihazlar için `adb reverse tcp:9002 tcp:9002` çalıştırın.
- **OTP ulaşmıyor**: Konsol çıktısını `[OTP-LOCAL]` satırları için kontrol edin. Ayrıca http://localhost:8025 adresindeki Mailpit UI'yi kontrol edin.
- **Emülatör verilerini sıfırla**: `local/firebase-emulator-data/` dizinini silin ve yeniden başlatın.
- **MinIO verilerini sıfırla**: Birimleri kaldırmak için `docker compose -f local/docker-compose.yml down -v` çalıştırın.

## Dağıtım

Dağıtımlar GitHub Actions iş akışları (`.github/workflows/`) aracılığıyla yönetilir:

| İş Akışı | Tetikleyici | Ne yaptığı |
|----------|---------|-------------|
| **PR Kontrolleri** | `main` 'e PR'ler hakkında otomatik | Lint, Kotlin testleri, Express API testleri, Playwright testlerini çalıştırır (değişen dosyalara dayalı) |
| **Dev'e Dağıt** | Manuel (`workflow_dispatch`) | Express API + web'i dev'e dağıtır, APK'yı test edicilere dağıtır, isteğe bağlı olarak Playwright testlerini çalıştırır |
| **Prod'a Dağıt** | Manuel (`workflow_dispatch`) | Etiketlenmiş bir yayını prod'a dağıtır -- Express API, web, Play Store ve App Store |

Ek iş akışları: **E2E Testleri** (Android emülatör matrisi), **SonarCloud** (statik analiz), **Lint**, **Arka Uç Testleri**, **Dependabot Otomatik Birleştirilmesi**.

- **Express API:** SSH + PM2 aracılığıyla Oracle Cloud VM'lerine dağıtılır (dev: Londra, prod: Singapur)
- **Android:** CI aracılığıyla Google Play'e paketlenmiş ve yüklenir
- **iOS:** CI aracılığıyla App Store Connect / TestFlight'a oluşturulur ve yüklenir
- **Yönetici paneli / web:** Cloudflare Pages'e dağıtılır

## Katkıda Bulunma

Katkılar memnuniyetle karşılanır! Lütfen yönergeler için [CONTRIBUTING.md](CONTRIBUTING.md) adresine bakın.

## Lisans

Bu proje Apache Lisansı 2.0 altında lisanslanmıştır. Ayrıntılar için [LICENSE](LICENSE) adresine bakın.

## Teşekkürler

- [Firebase](https://firebase.google.com) -- Kimlik Doğrulama, Firestore, Gerçek Zamanlı Veritabanı, Bulut Mesajlaşması
- [LiveKit](https://livekit.io) -- Gerçek zamanlı sesli iletişim
- [Cloudflare](https://www.cloudflare.com) -- R2 depolama, Pages barındırma, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Express API için ücretsiz seviye VM
- [Express.js](https://expressjs.com) -- API sunucu çerçevesi
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Modern bildirimsel UI
- [Koin](https://insert-koin.io) -- Hafif bağımlılık enjeksiyonu
- [Coil](https://coil-kt.github.io/coil/) -- Kotlin Multiplatform için görüntü yükleme
- [Lottie](https://airbnb.design/lottie/) -- Animasyonlu hediye ve UI efektleri
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Çok platformlu tarih/saat
