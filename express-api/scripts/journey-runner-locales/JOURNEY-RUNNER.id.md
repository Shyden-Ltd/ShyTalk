# Runner journey-test on-device ShyTalk

_Ini adalah terjemahan dari JOURNEY-RUNNER.md._

`device-journey-runner.js` menjalankan **aplikasi ShyTalk asli pada ponsel yang terhubung**
melalui journey pengguna end-to-end dan menulis sebuah **laporan pass/fail yang terperinci** yang
dapat Anda baca — sehingga Anda menjalankan satu perintah dan membaca satu laporan alih-alih mengetuk
setiap langkah secara manual.

Ini adalah runner **hybrid**. Setiap journey dapat melakukan assert pada tiga lapisan sekaligus:

1. **UI** — mengetuk/memeriksa aplikasi langsung melalui `adb` + `uiautomator` (Compose
   `testTag` muncul sebagai `resource-id` dalam dump; dialog dicocokkan berdasarkan
   teks yang terlihat).
2. **Firestore** — membaca emulator lokal secara langsung (via `firebase-admin`) untuk
   mengonfirmasi state database di balik setiap action.
3. **Server / API** — masuk sebagai setiap persona (token ID Firebase asli dari
   emulator Auth) dan memanggil `express-api`, sehingga memverifikasi **aturan yang
   diterapkan server** (gate cohort OSA, override admin, moderation) — yang _tidak_
   terlihat dari UI saja.

> Terjemahan panduan ini berada di `journey-runner-locales/` (20 bahasa).

---

## 1. Prasyarat

| Yang Anda butuhkan          | Cara                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Docker Desktop** berjalan | untuk emulator Firebase + LiveKit/MinIO                                                                                                                      |
| **Stack lokal aktif**       | `bash local/start.sh` (dari root repo) — memulai emulator Firebase + express-api. Biarkan tetap berjalan.                                                    |
| **Persona telah di-seed**   | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (idempoten; melakukan seed cast uji P‑02…P‑19 dengan kata sandi `localdev123`) |
| **Sebuah ponsel terhubung** | `adb devices` harus mencantumkan satu (kabel USB **atau** `adb` nirkabel). Emulator Android juga berfungsi.                                                  |
| **Java 21+ & Android SDK**  | hanya diperlukan saat pertama kali, sehingga runner dapat membangun aplikasi jika APK tidak ada                                                              |

Runner membangun sendiri APK debug `local` jika belum dibangun.

---

## 2. Jalankan

Dari root repo:

```sh
# Jalankan seluruh suite terhadap stack lokal
node express-api/scripts/device-journey-runner.js

# Lihat daftar journey tanpa menjalankan apa pun
node express-api/scripts/device-journey-runner.js --list

# Jalankan hanya journey tertentu
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Paksa build APK baru terlebih dahulu
node express-api/scripts/device-journey-runner.js --rebuild

# Daftar opsi lengkap
node express-api/scripts/device-journey-runner.js --help
```

Opsi: `--target local|dev` (default `local`) · `--serial <adb-serial>`
(default: pemilihan otomatis) · `--journeys <ids>` · `--rebuild` · `--no-reset` (melewati
instalasi ulang bersih pada journey smoke) · `--out <dir>` · `--list` · `--help`.

Runner menyematkan **satu** serial adb untuk setiap perintah, sehingga tetap berfungsi bahkan ketika
sebuah ponsel muncul dua kali (USB + nirkabel). Untuk target `local`, ia menyiapkan
tunnel `adb reverse` agar aplikasi on-device dapat menjangkau stack di mesin Anda.

---

## 3. Lihat hasilnya

Saat selesai, ia mencetak ringkasan dan menulis, di bawah `journey-results/`:

| Berkas                          | Apa                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Baca ini** — per-journey, per-langkah ✅/❌ dengan alasannya, testTag di layar, dan tautan tangkapan layar untuk setiap langkah |
| `latest-report.json`            | data yang sama, dapat dibaca mesin                                                                                                |
| `runs/<runId>/*.png`            | tangkapan layar setiap langkah (pass _dan_ fail)                                                                                  |
| `runs/<runId>/report.{md,json}` | laporan terarsip untuk run tertentu tersebut                                                                                      |

Kode keluar adalah `0` ketika setiap journey berhasil, `1` ketika ada yang gagal. Saat terjadi kegagalan,
langkah tersebut mencatat dengan tepat apa yang ada di layar, sehingga Anda dapat melihat _mengapa_ tanpa
menjalankan ulang ponsel.

---

## 4. Apa yang dicakup journey

Jalankan `--list` untuk set langsung. Sekilas, suite mencakup:

- **Smoke** — instalasi bersih → penerimaan legal → sign-in, backend dapat dijangkau.
- **Sign-in cohort** — persona adult / minor / admin masuk melalui
  pemilih persona dev dalam aplikasi; identitas dikonfirmasi terhadap overlay debug dan
  field `cohort` Firestore.
- **Gate cohort OSA** — seorang minor tidak dapat mem-follow atau melihat seorang adult (server mengembalikan
  `404`, dan write Firestore tidak pernah terjadi), sementara action sesama cohort
  berhasil — membuktikan gate bersifat spesifik-cohort, bukan pemblokiran menyeluruh.
- **Admin** — override-cohort hanya untuk staf (seorang member biasa ditolak dengan
  `422`; sebuah akun staf berhasil dan menulis baris audit regulasi).
- **Moderation** — report → admin suspend (+ audit) → appeal → unsuspend, sepenuhnya
  diterapkan server, dengan pembersihan idempoten.

Autentikasi dalam journey selalu menggunakan **pemilih persona dev dalam aplikasi** — tidak pernah
sign-in Google/Apple asli.

> **Catatan tentang spesifikasi journey.** Rencana Gherkin di
> `.project/test-plans/manual/j01-j19` sebagian bersifat _aspirasional_: mereka mereferensikan
> UI yang tidak dimiliki aplikasi yang dirilis (mis. layar pendaftaran email/kata sandi, tab
> minor tersembunyi, layar discovery). Oleh karena itu runner memetakan maksud nyata setiap journey
> terhadap aplikasi + Firestore + API yang **sebenarnya**, dan mencatat
> divergensi semacam itu sebagai temuan alih-alih gagal pada fiksi.

---

## 5. Pemecahan masalah

| Gejala                                                  | Perbaikan                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `No adb device found`                                   | Colokkan / pasangkan ponsel; periksa `adb devices`.                                                                      |
| Macet saat menjangkau SignIn / "backend NOT reachable"  | Stack lokal tidak aktif atau tunnel `adb reverse` tidak tersetel — mulai ulang `bash local/start.sh` dan jalankan ulang. |
| `persona "<email>" not found in picker`                 | Persona belum di-seed — jalankan perintah seed di §1.                                                                    |
| `Firestore assertions: ON` hilang / langkah DB dilewati | Assert DB hanya berjalan untuk `--target local`.                                                                         |
| Build APK gagal                                         | Buka `gradle-build.log` yang dicetak; pastikan Java 21+ dan Android SDK terpasang.                                       |
| Sebuah langkah gagal pada layar yang tidak Anda duga    | Buka tangkapan layar yang dinamai dalam `latest-report.md` untuk langkah tersebut.                                       |

---

## 6. Menambahkan journey

Journey adalah objek biasa dengan metode `run(device, reporter, ctx)`, disusun
dari helper bersama:

- `signInAs(device, reporter, ctx, email, nameToken)` — masuk sebagai sebuah persona melalui
  pemilih dan lewati interstisial first-launch hingga Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, serta `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Server: `getIdToken(email)` → token ID sebuah persona, lalu
  `apiCall(method, path, { token, body })`.

Bungkus setiap assertion dalam `reporter.step(device, 'name', async () => { … })` — ia
mengukur waktu langkah, menangkap layarnya, mencatat pass/fail, dan saat gagal menangkap
testTag di layar. Tambahkan objek baru ke array `all` di `buildJourneys`.

Logika murni (parsing, selektor, penanganan arg) diuji unit di
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`);
lapisan device/Firestore/API diuji integrasi dengan menjalankan suite pada perangkat nyata.
