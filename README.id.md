# ShyTalk

**Ruang obrolan suara, dirancang ulang.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | **Bahasa Indonesia** | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## Tentang

ShyTalk adalah aplikasi obrolan suara sosial di mana pengguna dapat membuat dan bergabung dengan ruang obrolan suara secara real-time. Dibangun dengan Kotlin Multiplatform (KMP), aplikasi ini menargetkan Android dan iOS dengan basis kode bersama. Baik Anda ingin mengadakan percakapan, mendengarkan, atau terhubung dengan orang-orang di seluruh dunia, ShyTalk membuatnya mudah.

## Fitur

### Ruang Obrolan Suara
- Buat atau bergabung dengan ruang dengan suara real-time yang didukung oleh LiveKit
- Sistem tempat duduk terstruktur dengan peran pemilik, host, dan peserta
- Permintaan dan undangan tempat duduk -- minta untuk bergabung di tempat duduk atau undang pendengar untuk berbicara
- Chathead mengambang -- lanjutkan obrolan suara sambil menjelajahi bagian lain dari aplikasi
- Kedaluwarsa ruang -- ruang otomatis ditutup saat pemilik tidak hadir, dengan penghitung waktu mundur

### Pesan
- Obrolan teks langsung bersamaan dengan suara di setiap ruang
- Pesan pribadi dengan percakapan 1-lawan-1
- Obrolan grup dengan manajemen anggota dan izin
- Indikator mengetik secara real-time
- Dukungan stiker

### Sosial
- Profil pengguna yang dapat disesuaikan dengan foto, gambar sampul, bendera kebangsaan, dan bio
- Sistem ikuti -- ikuti pengguna lain dan lihat kapan mereka aktif
- Dinding hadiah -- tampilkan hadiah yang diterima dari pengguna lain
- Sistem blokir -- blokir pengguna di seluruh ruang dan profil

### Ekonomi Virtual
- Ekonomi berbasis koin dengan dompet dan riwayat transaksi
- Hadiah login harian dengan bonus beruntun
- Sistem Putaran Beruntung (gacha) dengan hadiah bertingkat
- Hadiah virtual -- kirim dan terima hadiah animasi selama obrolan suara
- Inventaris ransel untuk menyimpan hadiah
- Paket koin untuk membeli koin
- Banner siaran dengan efek hadiah animasi

### Akun & Identitas
- Autentikasi multi-penyedia -- masuk dengan Google, Apple, atau Email (OTP)
- Hubungkan beberapa metode masuk ke satu akun
- Identitas pengguna stabil (uniqueId) yang bertahan di seluruh proyek Firebase
- Manajemen Akun Terhubung di Pengaturan dengan dukungan hubungkan/putuskan
- Pengikatan perangkat -- setiap perangkat secara permanen terikat ke satu akun

### Moderasi & Keamanan
- Alat moderasi -- bisukan, keluarkan, pindahkan tempat duduk, dan kelola host sebagai pemilik ruang
- Sistem pelaporan pengguna dengan alur kerja peninjauan
- Sistem peringatan dan penangguhan untuk pelanggaran kebijakan
- Layar standar komunitas, kebijakan privasi, dan ketentuan layanan
- Alur penerimaan hukum untuk pengguna baru
- Pemaksaan pembaruan untuk versi aplikasi yang sudah usang

### Layar Pembuka
- Layar peluncuran yang dapat dikonfigurasi yang ditampilkan saat aplikasi dimulai
- Konten yang dikelola admin dengan opsi penjadwalan dan penargetan

### Keamanan
- Perlindungan kode PIN untuk akses aplikasi
- Autentikasi biometrik -- sidik jari dan pengenalan wajah
- Verifikasi OTP (kata sandi sekali pakai) untuk tindakan sensitif

### Panel Admin
- Dasbor moderasi berbasis web di situs statis proyek
- Manajemen pengguna, moderasi konten, dan konfigurasi
- Manajemen template dan hadiah dengan pratinjau langsung
- Streaming log real-time dan peringatan

### Kompresi Gambar
- Kompresi gambar otomatis saat unggah melalui Express API
- Mengurangi biaya penyimpanan dan bandwidth sambil menjaga kualitas

### Internasionalisasi
- 19 bahasa didukung secara bawaan
- Lokalisasi penuh untuk semua string yang menghadap pengguna

### Pencatatan & Pemantauan
- Pencatatan terstruktur di seluruh Express API, aplikasi mobile, dan panel admin
- Streaming log real-time di dasbor admin
- Pelarangan perangkat dan jaringan dengan penegakan otomatis
- Sistem peringatan untuk kesalahan kritis dan anomali
- Propagasi Trace ID untuk pelacakan permintaan ujung ke ujung

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
| **Suara** | LiveKit |
| **Notifikasi Push** | Firebase Cloud Messaging |
| **Pemuatan Gambar** | Coil 3 (KMP) |
| **Animasi** | Lottie Compose |
| **Tanggal/Waktu** | kotlinx-datetime |
| **Navigasi** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Arsitektur

ShyTalk mengikuti pola **MVVM** dengan **Repository Pattern** yang bersih:

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
|       |   +-- MainActivity.kt       # Activity utama
|       |   +-- core/
|       |   |   +-- di/               # Modul Koin DI
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Suara LiveKit, kehadiran, notifikasi
|       |   |   +-- repository/       # Implementasi repository
|       |   +-- feature/
|       |   |   +-- auth/             # Layar masuk Google
|       |   |   +-- profile/          # Layar profil
|       |   |   +-- room/             # Layar ruang
|       |   |   +-- settings/         # Pengaturan aplikasi
|       |   +-- navigation/           # NavGraph & rute layar
|       +-- test/                     # Tes unit
|       +-- androidTest/              # Tes E2E (Compose UI Test)
+-- shared/                           # Modul shared KMP
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
|       +-- middleware/               # Auth, middleware pencatatan
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Tugas terjadwal
+-- public/                           # Situs statis & panel admin
+-- local/                            # Lingkungan pengembangan lokal (emulator, data awal)
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
- **JDK 17+**
- **Node.js 24+**
- **Docker** (untuk server LiveKit lokal)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Pengembangan Lokal (Direkomendasikan)

Cara tercepat untuk memulai. Menggunakan Emulator Firebase dan kontainer Docker LiveKit lokal -- tidak perlu akun cloud, tanpa biaya, tanpa batas kuota.

1. **Clone dan instal**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Mulai layanan lokal**
   ```bash
   bash local/start.sh
   ```
   Ini memulai Emulator Firebase (Firestore, Auth, RTDB) dan kontainer Docker LiveKit. Pada proses pertama, secara otomatis menyemai data pengujian (pengguna admin, hadiah contoh, konfigurasi).

   Anda akan melihat:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Mulai Express API** (di terminal baru)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Edit nilai R2/SMTP jika diperlukan
   npm run local
   ```
   API dimulai di `http://localhost:3000`. Tes: `curl http://localhost:3000/api/health`

4. **Jalankan di Emulator Android**
   ```bash
   ./gradlew installLocalDebug
   ```
   Build flavor `local` terhubung ke `10.0.2.2` (loopback emulator Android ke mesin Anda). Langsung berfungsi -- tidak perlu konfigurasi tambahan.

5. **Jalankan di Perangkat Fisik**

   Ponsel Anda harus berada di **jaringan Wi-Fi yang sama** dengan mesin pengembangan Anda.

   a. Temukan IP lokal mesin Anda:
   ```bash
   # Windows
   ipconfig    # Cari "IPv4 Address" di bawah adapter Wi-Fi Anda (misal 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # atau: ip addr show
   ```

   b. Perbarui build flavor lokal untuk menggunakan IP Anda alih-alih `10.0.2.2`. Di `app/build.gradle.kts`, temukan flavor `local` dan ubah:
   ```kotlin
   // Ganti 10.0.2.2 dengan IP lokal mesin Anda
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Hubungkan perangkat Anda melalui USB dan aktifkan USB debugging, lalu:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Sebagai alternatif, gunakan **adb reverse** untuk menghindari perubahan kode apa pun (perangkat mengarahkan localhost ke mesin Anda):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Emulator Firestore
   adb reverse tcp:9099 tcp:9099   # Emulator Auth
   adb reverse tcp:9000 tcp:9000   # Emulator RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Dengan `adb reverse`, alamat default `10.0.2.2` di flavor lokal akan berfungsi di perangkat fisik juga -- tidak perlu perubahan konfigurasi build.

6. **Masuk**
   - Gunakan alur masuk email dengan akun pengujian yang disemai: `claude-test@shytalk.dev` / `localdev123`
   - Atau buat akun baru -- akan menggunakan emulator lokal
   - Masuk Google/Apple tidak akan berfungsi secara lokal (tidak ada OAuth nyata) -- gunakan OTP email sebagai gantinya

7. **Hentikan layanan lokal**
   ```bash
   bash local/stop.sh
   ```
   Atau tekan `Ctrl+C` di terminal `start.sh`. Data emulator disimpan secara otomatis dan dipulihkan saat mulai berikutnya.

### URL Berguna untuk Pengembangan Lokal

| Layanan | URL | Tujuan |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Jelajahi data Firestore, pengguna Auth, RTDB |
| Express API | http://localhost:3000 | API backend |
| Pemeriksaan kesehatan | http://localhost:3000/api/health | Verifikasi API berjalan |

### Pengembangan Cloud (Opsional)

Jika Anda perlu menguji terhadap layanan cloud nyata (misal notifikasi push nyata, masuk Google nyata):

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

4. **Build aplikasi Android** (flavor dev)
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
| `LIVEKIT_API_KEY` | Kunci API LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Rahasia API LiveKit | Express API |
| `LIVEKIT_URL` | URL server LiveKit | Aplikasi Android (BuildConfig) |
| `WORKER_URL` | URL dasar Express API | Aplikasi Android (BuildConfig) |

## Pengujian

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

# Tes E2E (memerlukan perangkat terhubung atau emulator)
./gradlew connectedDevDebugAndroidTest

# Tes browser Playwright (memerlukan panel admin berjalan)
npx playwright test
```

## Deployment

Deployment dikelola melalui workflow GitHub Actions (`.github/workflows/`):

| Workflow | Pemicu | Apa yang dilakukan |
|----------|---------|-------------|
| **PR Checks** | Otomatis pada PR ke `main` | Menjalankan lint, tes Kotlin, tes Express API, tes Playwright (berdasarkan file yang diubah) |
| **Deploy to Dev** | Manual (`workflow_dispatch`) | Men-deploy Express API + web ke dev, mendistribusikan APK ke tester, secara opsional menjalankan tes Playwright |
| **Deploy to Prod** | Manual (`workflow_dispatch`) | Men-deploy rilis bertag ke prod -- Express API, web, Play Store, dan App Store |

Workflow tambahan: **E2E Tests** (matriks emulator Android), **SonarCloud** (analisis statis), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Di-deploy ke VM Oracle Cloud melalui SSH + PM2 (dev: London, prod: Singapura)
- **Android:** Dikemas dan diunggah ke Google Play melalui CI
- **iOS:** Di-build dan diunggah ke App Store Connect / TestFlight melalui CI
- **Panel admin / Web:** Di-deploy ke Cloudflare Pages

## Berkontribusi

Kontribusi sangat diterima! Silakan lihat [CONTRIBUTING.md](CONTRIBUTING.md) untuk panduan.

## Lisensi

Proyek ini dilisensikan di bawah Lisensi Apache 2.0. Lihat [LICENSE](LICENSE) untuk detail.

## Penghargaan

- [Firebase](https://firebase.google.com) -- Autentikasi, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Komunikasi suara real-time
- [Cloudflare](https://www.cloudflare.com) -- Penyimpanan R2, hosting Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM tingkat gratis untuk Express API
- [Express.js](https://expressjs.com) -- Framework server API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI deklaratif modern
- [Koin](https://insert-koin.io) -- Injeksi dependensi ringan
- [Coil](https://coil-kt.github.io/coil/) -- Pemuatan gambar untuk Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Efek hadiah dan UI animasi
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Tanggal/waktu multiplatform
