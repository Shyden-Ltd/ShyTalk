# ShyTalk

**Ruang obrolan suara, dirancang ulang.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | **Bahasa Indonesia** | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Tentang

ShyTalk adalah aplikasi obrolan suara sosial di mana pengguna dapat membuat dan bergabung dengan ruang obrolan suara secara real-time. Dibangun dengan Kotlin Multiplatform (KMP), aplikasi ini menargetkan Android dan iOS dengan basis kode bersama. Baik Anda ingin menjadi tuan rumah percakapan, mendengarkan, atau terhubung dengan orang di seluruh dunia, ShyTalk membuatnya mudah.

iOS adalah platform yang didukung tetapi panduan ini berfokus pada pengembangan Android, yang merupakan target pengembangan utama.

## Fitur

### Ruang Obrolan Suara
- Buat atau bergabung dengan ruangan dengan suara real-time didukung oleh LiveKit
- Sistem tempat duduk terstruktur dengan peran pemilik, host, dan peserta
- Permintaan dan undangan tempat duduk -- minta untuk bergabung di tempat duduk atau undang pendengar untuk berbicara
- Chathead mengambang -- lanjutkan obrolan suara sambil menjelajahi bagian lain aplikasi
- Kedaluwarsa ruangan -- ruangan otomatis ditutup saat pemilik tidak ada, dengan timer hitung mundur

### Pesan
- Obrolan teks langsung bersamaan dengan suara di setiap ruangan
- Pesan pribadi dengan percakapan 1-on-1
- Obrolan grup dengan manajemen anggota dan izin
- Indikator mengetik secara real-time
- Dukungan stiker

### Sosial
- Profil pengguna yang dapat disesuaikan dengan foto, gambar sampul, bendera kebangsaan, dan bio
- Sistem ikuti -- ikuti pengguna lain dan lihat kapan mereka aktif
- Dinding hadiah -- tampilkan hadiah yang diterima dari pengguna lain
- Sistem blokir -- blokir pengguna di seluruh ruangan dan profil

### Ekonomi Virtual
- Ekonomi berbasis koin dengan dompet dan riwayat transaksi
- Hadiah login harian dengan bonus beruntun
- Sistem Lucky Spin (gacha) dengan hadiah bertingkat
- Hadiah virtual -- kirim dan terima hadiah animasi selama obrolan suara
- Inventaris ransel untuk menyimpan hadiah
- Paket koin untuk membeli koin
- Banner siaran dengan efek hadiah animasi

### Akun & Identitas
- Autentikasi multi-penyedia -- masuk dengan Google, Apple, atau Email (OTP)
- Hubungkan beberapa metode masuk ke satu akun
- Identitas pengguna stabil (uniqueId) yang bertahan di seluruh proyek Firebase
- Manajemen akun terhubung di Pengaturan dengan dukungan hubungkan/lepaskan
- Pengikatan perangkat -- setiap perangkat terikat secara permanen ke satu akun

### Moderasi & Keamanan
- Alat moderasi -- bisukan, keluarkan, pindahkan tempat duduk, dan kelola host sebagai pemilik ruangan
- Sistem pelaporan pengguna dengan alur kerja peninjauan
- Sistem peringatan dan penangguhan untuk pelanggaran kebijakan
- Layar standar komunitas, kebijakan privasi, dan ketentuan layanan
- Alur penerimaan hukum untuk pengguna baru
- Pembaruan paksa untuk versi aplikasi yang usang

### Layar Awal
- Layar peluncuran yang dapat dikonfigurasi yang ditampilkan saat startup aplikasi
- Konten yang dikelola admin dengan opsi penjadwalan dan penargetan

### Keamanan
- Perlindungan kode PIN untuk akses aplikasi
- Autentikasi biometrik -- sidik jari dan pengenalan wajah
- Verifikasi OTP (kata sandi sekali pakai) untuk tindakan sensitif

### Panel Admin
- Dashboard moderasi berbasis web di situs statis proyek
- Manajemen pengguna, moderasi konten, dan konfigurasi
- Manajemen template dan hadiah dengan pratinjau langsung
- Streaming log dan peringatan real-time

### Kompresi Gambar
- Kompresi gambar otomatis saat unggah melalui Express API
- Mengurangi biaya penyimpanan dan bandwidth sambil menjaga kualitas

### Internasionalisasi
- 19 bahasa didukung secara bawaan
- Lokalisasi penuh untuk semua string yang menghadap pengguna

### Logging & Pemantauan
- Logging terstruktur di seluruh Express API, aplikasi mobile, dan panel admin
- Streaming log real-time di dashboard admin
- Pemblokiran perangkat dan jaringan dengan penegakan otomatis
- Sistem peringatan untuk kesalahan kritis dan anomali
- Propagasi Trace ID untuk pelacakan permintaan end-to-end

## Stack Teknologi

| Lapisan | Teknologi |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Arsitektur** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Autentikasi** | Firebase Authentication (Google, Apple, Email+OTP) dengan sistem identitas multi-penyedia |
| **Database** | Cloud Firestore |
| **Real-time** | Firebase Realtime Database |
| **Penyimpanan** | Cloudflare R2 (melalui proxy Express API) |
| **Server API** | Express.js di Oracle Cloud Free Tier |
| **Suara** | LiveKit (self-hosted on Oracle Cloud) |
| **Notifikasi Push** | Firebase Cloud Messaging |
| **Pemuatan Gambar** | Coil 3 (KMP) |
| **Animasi** | Lottie Compose |
| **Tanggal/Waktu** | kotlinx-datetime |
| **Navigasi** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Arsitektur

ShyTalk mengikuti **MVVM** dengan **Repository Pattern** yang bersih:

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

- **Modul shared** (`commonMain`) -- Model, antarmuka repository, ViewModel, dan UI yang dibagikan antar platform
- **Modul app** -- Layar khusus Android, implementasi repository, dan titik masuk
- **Modul iosApp** -- Titik masuk khusus iOS
- **express-api** -- Backend Express.js yang berjalan di Oracle Cloud Free Tier

## Struktur Proyek

```
ShyTalk/
+-- app/                              # Modul aplikasi Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Titik masuk aplikasi
|       |   +-- MainActivity.kt       # Aktivitas utama
|       |   +-- core/
|       |   |   +-- di/               # Modul Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Suara LiveKit, kehadiran, notifikasi
|       |   |   +-- repository/       # Implementasi repository
|       |   +-- feature/
|       |   |   +-- auth/             # Layar masuk Google
|       |   |   +-- profile/          # Layar profil
|       |   |   +-- room/             # Layar ruangan
|       |   |   +-- settings/         # Pengaturan aplikasi
|       |   +-- navigation/           # NavGraph & rute layar
|       +-- test/                     # Tes unit
|       +-- androidTest/              # Tes E2E (Compose UI Test)
+-- shared/                           # Modul bersama KMP
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Modul Koin bersama
|       |   +-- model/                # Model data (User, ChatRoom, Gift, dll.)
|       |   +-- ui/                   # Komponen bersama
|       |   +-- util/                 # Utilitas & konstanta
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, dll.
|       |   +-- repository/           # Antarmuka repository
|       +-- feature/                  # Modul fitur bersama
+-- iosApp/                           # Modul aplikasi iOS
+-- express-api/                      # Server Express.js API
|   +-- src/
|       +-- routes/                   # Handler rute API
|       +-- middleware/               # Middleware autentikasi dan logging
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Tugas terjadwal
+-- public/                           # Situs statis & panel admin
+-- local/                            # Lingkungan pengembangan lokal (emulator, data seed)
+-- tests/web/                        # Tes browser Playwright
+-- scripts/                          # Skrip utilitas
+-- .github/workflows/                # CI/CD (Pemeriksaan PR, Deploy ke Dev/Prod, E2E, lint)
+-- firestore.rules                   # Aturan keamanan Firestore
+-- database.rules.json               # Aturan keamanan RTDB
+-- firestore.indexes.json            # Indeks komposit Firestore
+-- firebase.json                     # Konfigurasi Firebase
```

## Memulai

### Prasyarat

- **Android Studio** Ladybug atau lebih baru
- **JDK 21+**
- **Node.js 24+**
- **Docker** (untuk server suara LiveKit, penyimpanan MinIO, email Mailpit)
- **Firebase CLI** (`npm install -g firebase-tools`)

Tidak perlu akun cloud untuk memulai -- lingkungan lokal berjalan sepenuhnya offline.

### Pengembangan Lokal (Disarankan)

Cara tercepat untuk memulai. Satu perintah memulai semuanya -- Firebase Emulator, kontainer Docker, Express API, dan membangun aplikasi Android. Tidak perlu akun cloud, tanpa biaya, tanpa batas kuota.

1. **Clone dan instal**
   ```bash
   git clone https://github.com/Shyden-Ltd/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Mulai semuanya**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Perintah tunggal ini:
   - Memulai kontainer Docker (server suara LiveKit, penyimpanan MinIO, email Mailpit)
   - Memulai Firebase Emulator (Firestore, Auth, RTDB)
   - Menyemai data tes dan membuat bucket penyimpanan MinIO
   - Memulai Express API
   - Membangun dan menginstal aplikasi Android (jika perangkat terhubung)

   Saat siap, Anda akan melihat:
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

3. **Masuk**
   - Gunakan alur masuk email dengan akun tes yang sudah disediakan: `claude-test@shytalk.dev` / `localdev123`
   - Atau buat akun baru -- akan menggunakan emulator lokal
   - Masuk Google/Apple tidak berfungsi secara lokal (tidak ada OAuth asli) -- gunakan OTP email sebagai gantinya
   - Kode OTP ditangkap oleh Mailpit -- periksa http://localhost:8025

4. **Jalankan di Perangkat Fisik**

   Ponsel Anda harus berada di **jaringan Wi-Fi yang sama** dengan mesin pengembangan Anda.

   a. Temukan IP lokal mesin Anda:
   ```bash
   # Windows
   ipconfig    # Cari "IPv4 Address" di bawah adaptor Wi-Fi Anda (mis. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # atau: ip addr show
   ```

   b. Perbarui flavor build lokal untuk menggunakan IP Anda alih-alih `10.0.2.2`. Di `app/build.gradle.kts`, temukan flavor `local` dan ubah:
   ```kotlin
   // Ganti 10.0.2.2 dengan IP lokal mesin Anda
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Hubungkan perangkat Anda melalui USB dan aktifkan debugging USB, lalu:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternatifnya, gunakan **adb reverse** untuk menghindari perubahan kode (perangkat merutekan localhost ke mesin Anda):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulator Firestore
   adb reverse tcp:9099 tcp:9099   # Emulator Auth
   adb reverse tcp:9000 tcp:9000   # Emulator RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (penyimpanan gambar)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Dengan `adb reverse`, alamat default `10.0.2.2` di flavor lokal juga akan berfungsi di perangkat fisik -- tidak perlu perubahan konfigurasi build.

5. **Hentikan layanan lokal**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Atau tekan `Ctrl+C` di terminal skrip mulai. Data emulator disimpan secara otomatis dan dipulihkan saat mulai berikutnya.

### URL Lokal yang Berguna

| Layanan | URL | Tujuan |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Jelajahi data Firestore, pengguna Auth, RTDB |
| Express API | http://localhost:3000 | API backend |
| Health check | http://localhost:3000/api/health | Verifikasi API berjalan |
| Mailpit | http://localhost:8025 | Lihat email yang ditangkap dan kode OTP |
| MinIO Console | http://localhost:9001 | Jelajahi gambar dan file yang diunggah |

### Layanan Opsional

**LibreTranslate (Terjemahan Pesan)**

Image Docker opsional 6GB+ untuk menguji fitur terjemahan secara lokal:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Tidak disertakan dalam pengaturan default karena ukuran image yang besar. Terjemahan berfungsi tanpanya -- pesan hanya tetap tidak diterjemahkan.

### Pengembangan Cloud (Opsional)

Jika Anda perlu menguji terhadap layanan cloud asli (mis. notifikasi push asli, masuk Google asli):

1. **Pengaturan Firebase**
   - Buat proyek Firebase di [console.firebase.google.com](https://console.firebase.google.com)
   - Aktifkan **Masuk Google** dan **Masuk Apple** di Autentikasi
   - Aktifkan **Firestore**, **Realtime Database**, dan **Cloud Messaging**
   - Unduh `google-services.json` dan letakkan di `app/src/dev/`

2. **Pengaturan Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edit dengan kredensial cloud Anda
   npm install
   npm start
   ```

3. **Deploy aturan Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Bangun aplikasi Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Variabel Lingkungan

| Variabel | Deskripsi | Di mana |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON akun layanan Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID akun Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Kunci akses R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Kunci rahasia R2 | Express API |
| `R2_BUCKET_NAME` | Nama bucket R2 (default: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | Kunci API LiveKit (Asia/Singapura) | Express API |
| `LIVEKIT_SECRET_ASIA` | Rahasia API LiveKit (Asia/Singapura) | Express API |
| `LIVEKIT_URL_ASIA` | URL server LiveKit (Asia) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | Kunci API LiveKit (EU/London) | Express API |
| `LIVEKIT_SECRET_EU` | Rahasia API LiveKit (EU/London) | Express API |
| `LIVEKIT_URL_EU` | URL server LiveKit (EU) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | Kunci API LiveKit (cadangan saat kunci per-wilayah tidak disetel) | Express API |
| `LIVEKIT_API_SECRET` | Rahasia API LiveKit (cadangan saat kunci per-wilayah tidak disetel) | Express API |
| `LIVEKIT_URL` | URL server LiveKit (dipanggang ke aplikasi Android saat build) | Aplikasi Android (BuildConfig) |
| `WORKER_URL` | URL dasar Express API | Aplikasi Android (BuildConfig) |

## Pengujian

### Menjalankan Tes Secara Lokal

```bash
# Menu tes interaktif (pilih apa yang akan dijalankan):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Atau jalankan suite individual:
bash local/test-unit.sh       # Tes unit Kotlin + Express API
bash local/test-playwright.sh # Tes web Playwright (butuh lingkungan lokal)
bash local/test-e2e.sh        # Tes E2E Android (butuh lingkungan lokal + perangkat)
bash local/test-lint.sh       # ktlint + ESLint

# Lihat laporan tes Allure:
npx allure serve allure-results
```

### Suite Tes

| Suite | Perintah | Jumlah |
|-------|---------|-------|
| Tes unit Kotlin | `./gradlew test` | 100+ tes |
| Tes Express API | `cd express-api && npm test` | 1.540+ tes |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 file fitur |
| Tes web Playwright | `npx playwright test` | 28 spesifikasi |

```bash
# Tes unit Kotlin/KMP
./gradlew test

# Tes Express API
cd express-api && npm test

# Tes E2E (membutuhkan perangkat terhubung atau emulator)
./gradlew connectedDevDebugAndroidTest

# Tes browser Playwright (membutuhkan panel admin berjalan)
npx playwright test
```

### Pengujian di CI

Di CI, tes Playwright dan Android E2E berjalan terhadap lingkungan lokal yang sama (emulator + Docker) -- tidak ada layanan cloud yang digunakan. Ini memastikan tes tidak pernah mengganggu penguji yang sebenarnya.

## Pemecahan Masalah

- **Port sudah digunakan**: `lsof -i :<port>` (Linux/macOS) atau `netstat -ano | findstr :<port>` (Windows) untuk menemukan apa yang menggunakan port.
- **Docker tidak berjalan**: Pastikan Docker Desktop sudah dimulai. Jalankan `docker ps` untuk memverifikasi.
- **Firebase emulator gagal memulai**: Membutuhkan Java 21+. Periksa dengan `java -version`.
- **Build Android gagal**: Pastikan JDK 21+ dan Android SDK terinstal. Coba `./gradlew clean`.
- **Perangkat adb tidak terdeteksi**: Aktifkan debugging USB. Jalankan `adb devices` untuk memeriksa.
- **Gambar tidak dimuat**: Bucket MinIO mungkin belum dibuat. Jalankan `cd express-api && NODE_ENV=local node ../local/seed.js`. Untuk perangkat fisik, jalankan `adb reverse tcp:9002 tcp:9002`.
- **OTP tidak tiba**: Periksa output konsol untuk baris `[OTP-LOCAL]`. Juga periksa UI Mailpit di http://localhost:8025.
- **Reset data emulator**: Hapus direktori `local/firebase-emulator-data/` dan mulai ulang.
- **Reset data MinIO**: Jalankan `docker compose -f local/docker-compose.yml down -v` untuk menghapus volume.

## Deployment

Deployment dikelola melalui alur kerja GitHub Actions (`.github/workflows/`):

| Alur Kerja | Pemicu | Apa yang dilakukan |
|----------|---------|-------------|
| **PR Checks** | Otomatis pada PR ke `main` | Menjalankan lint, tes Kotlin, tes Express API, tes Playwright (berdasarkan file yang diubah) |
| **Deploy to Dev** | Manual (`workflow_dispatch`) | Deploy Express API + web ke dev, mendistribusikan APK ke penguji, opsional menjalankan tes Playwright |
| **Deploy to Prod** | Manual (`workflow_dispatch`) | Deploy rilis bertag ke prod -- Express API, web, Play Store, dan App Store |

Alur kerja tambahan: **E2E Tests** (matriks emulator Android), **SonarCloud** (analisis statis), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Di-deploy ke VM Oracle Cloud melalui SSH + PM2 (dev: London, prod: Singapura)
- **Android:** Dibundel dan diunggah ke Google Play melalui CI
- **iOS:** Dibangun dan diunggah ke App Store Connect / TestFlight melalui CI
- **Panel admin / web:** Di-deploy ke Cloudflare Pages

## Berkontribusi

Kontribusi sangat diterima! Silakan lihat [CONTRIBUTING.md](CONTRIBUTING.md) untuk panduan.

## Lisensi

Proyek ini dilisensikan di bawah Lisensi Apache 2.0. Lihat [LICENSE](LICENSE) untuk detail.

## Penghargaan

- [Firebase](https://firebase.google.com) -- Autentikasi, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Komunikasi suara real-time
- [Cloudflare](https://www.cloudflare.com) -- Penyimpanan R2, hosting Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM tier gratis untuk Express API
- [Express.js](https://expressjs.com) -- Framework server API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI deklaratif modern
- [Koin](https://insert-koin.io) -- Injeksi dependensi ringan
- [Coil](https://coil-kt.github.io/coil/) -- Pemuatan gambar untuk Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Efek hadiah dan UI animasi
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Tanggal/waktu multiplatform
