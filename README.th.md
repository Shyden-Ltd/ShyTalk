# ShyTalk

**ห้องแชทด้วยเสียง ยุคใหม่.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | **ไทย** | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## เกี่ยวกับ

ShyTalk คือแอปแชทด้วยเสียงเพื่อสังคม ที่ให้ผู้ใช้สร้างและเข้าร่วมห้องแชทด้วยเสียงแบบเรียลไทม์ สร้างด้วย Kotlin Multiplatform (KMP) รองรับทั้ง Android และ iOS ด้วยโค้ดเบสเดียวกัน ไม่ว่าจะต้องการเป็นเจ้าภาพการสนทนา ฟังอยู่เฉย ๆ หรือเชื่อมต่อกับผู้คนทั่วโลก ShyTalk ทำให้ง่ายดาย

## ฟีเจอร์

### ห้องแชทด้วยเสียง
- สร้างหรือเข้าร่วมห้องด้วยเสียงเรียลไทม์ที่ขับเคลื่อนโดย LiveKit
- ระบบที่นั่งแบบมีโครงสร้างพร้อมบทบาทเจ้าของ โฮสต์ และผู้เข้าร่วม
- การขอและเชิญที่นั่ง -- ขอเข้านั่งหรือเชิญผู้ฟังมาพูด
- Floating chathead -- แชทด้วยเสียงต่อเนื่องขณะท่องส่วนอื่นของแอป
- การหมดอายุของห้อง -- ห้องปิดอัตโนมัติเมื่อเจ้าของไม่อยู่ พร้อมตัวนับถอยหลัง

### ข้อความ
- แชทข้อความสดควบคู่กับเสียงในทุกห้อง
- ข้อความส่วนตัวแบบตัวต่อตัว
- กลุ่มแชทพร้อมการจัดการสมาชิกและสิทธิ์
- แสดงสถานะกำลังพิมพ์แบบเรียลไทม์
- รองรับสติกเกอร์

### สังคม
- โปรไฟล์ผู้ใช้ที่ปรับแต่งได้พร้อมรูปภาพ ภาพปก ธงชาติ และประวัติส่วนตัว
- ระบบติดตาม -- ติดตามผู้ใช้คนอื่นและดูเมื่อพวกเขาออนไลน์
- ผนังของขวัญ -- แสดงของขวัญที่ได้รับจากผู้ใช้คนอื่น
- ระบบบล็อก -- บล็อกผู้ใช้ข้ามห้องและโปรไฟล์

### เศรษฐกิจเสมือน
- ระบบเศรษฐกิจแบบเหรียญพร้อมกระเป๋าเงินและประวัติธุรกรรม
- รางวัลเข้าสู่ระบบรายวันพร้อมโบนัสต่อเนื่อง
- ระบบ Lucky Spin (กาชา) พร้อมรางวัลหลายระดับ
- ของขวัญเสมือน -- ส่งและรับของขวัญแอนิเมชันระหว่างแชทด้วยเสียง
- กระเป๋าเป้สำหรับเก็บของขวัญ
- แพ็กเกจเหรียญสำหรับซื้อเหรียญ
- แบนเนอร์ประกาศพร้อมเอฟเฟกต์ของขวัญแอนิเมชัน

### บัญชีและตัวตน
- การยืนยันตัวตนหลายผู้ให้บริการ -- เข้าสู่ระบบด้วย Google, Apple หรืออีเมล (OTP)
- เชื่อมวิธีการเข้าสู่ระบบหลายวิธีกับบัญชีเดียว
- ตัวตนผู้ใช้ที่คงที่ (uniqueId) ที่คงอยู่ข้ามโปรเจกต์ Firebase
- การจัดการบัญชีที่เชื่อมในการตั้งค่าพร้อมรองรับการเชื่อม/ยกเลิกการเชื่อม
- การผูกอุปกรณ์ -- แต่ละอุปกรณ์ผูกถาวรกับบัญชีเดียว

### การกลั่นกรองและความปลอดภัย
- เครื่องมือกลั่นกรอง -- ปิดเสียง เตะออก ย้ายที่นั่ง และจัดการโฮสต์ในฐานะเจ้าของห้อง
- ระบบรายงานผู้ใช้พร้อมขั้นตอนการตรวจสอบ
- ระบบเตือนและระงับการใช้งานสำหรับการละเมิดนโยบาย
- หน้าจอมาตรฐานชุมชน นโยบายความเป็นส่วนตัว และข้อกำหนดการใช้งาน
- ขั้นตอนการยอมรับทางกฎหมายสำหรับผู้ใช้ใหม่
- การบังคับอัปเดตสำหรับเวอร์ชันแอปที่ล้าสมัย

### หน้าจอเริ่มต้น
- หน้าจอเปิดตัวที่กำหนดค่าได้ แสดงเมื่อเริ่มแอป
- เนื้อหาที่จัดการโดยผู้ดูแลระบบพร้อมตัวเลือกการกำหนดเวลาและการกำหนดเป้าหมาย

### ความปลอดภัย
- การป้องกันด้วยรหัส PIN สำหรับการเข้าถึงแอป
- การยืนยันตัวตนด้วยไบโอเมตริก -- ลายนิ้วมือและการจดจำใบหน้า
- การยืนยัน OTP (รหัสผ่านใช้ครั้งเดียว) สำหรับการดำเนินการที่ละเอียดอ่อน

### แผงผู้ดูแลระบบ
- แดชบอร์ดกลั่นกรองบนเว็บที่ไซต์แบบสแตติกของโปรเจกต์
- การจัดการผู้ใช้ การกลั่นกรองเนื้อหา และการกำหนดค่า
- การจัดการเทมเพลตและของขวัญพร้อมตัวอย่างสด
- การสตรีมบันทึกแบบเรียลไทม์และการแจ้งเตือน

### การบีบอัดรูปภาพ
- การบีบอัดรูปภาพอัตโนมัติเมื่ออัปโหลดผ่าน Express API
- ลดต้นทุนพื้นที่จัดเก็บและแบนด์วิดท์โดยคงคุณภาพไว้

### การรองรับหลายภาษา
- รองรับ 19 ภาษาตั้งแต่ต้น
- การแปลเป็นภาษาท้องถิ่นครบถ้วนสำหรับสตริงที่ผู้ใช้เห็น

### การบันทึกและการตรวจสอบ
- การบันทึกแบบมีโครงสร้างทั่ว Express API แอปมือถือ และแผงผู้ดูแลระบบ
- การสตรีมบันทึกแบบเรียลไทม์ในแดชบอร์ดผู้ดูแลระบบ
- การแบนอุปกรณ์และเครือข่ายพร้อมการบังคับใช้อัตโนมัติ
- ระบบแจ้งเตือนสำหรับข้อผิดพลาดร้ายแรงและความผิดปกติ
- การส่งผ่าน Trace ID สำหรับการติดตามคำขอแบบครบวงจร

## เทคโนโลยีที่ใช้

| เลเยอร์ | เทคโนโลยี |
|-------|-----------|
| **เฟรมเวิร์ก** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **สถาปัตยกรรม** | MVVM + Repository Pattern |
| **DI** | Koin |
| **การยืนยันตัวตน** | Firebase Authentication (Google, Apple, Email+OTP) พร้อมระบบตัวตนหลายผู้ให้บริการ |
| **ฐานข้อมูล** | Cloud Firestore |
| **เรียลไทม์** | Firebase Realtime Database |
| **พื้นที่จัดเก็บ** | Cloudflare R2 (ผ่าน Express API proxy) |
| **เซิร์ฟเวอร์ API** | Express.js on Oracle Cloud Free Tier |
| **เสียง** | LiveKit |
| **การแจ้งเตือน Push** | Firebase Cloud Messaging |
| **โหลดรูปภาพ** | Coil 3 (KMP) |
| **แอนิเมชัน** | Lottie Compose |
| **วันที่/เวลา** | kotlinx-datetime |
| **การนำทาง** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## สถาปัตยกรรม

ShyTalk ใช้ **MVVM** ร่วมกับ **Repository Pattern** ที่สะอาด:

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

- **shared module** (`commonMain`) -- โมเดล อินเทอร์เฟซ repository, ViewModel และ UI ที่ใช้ร่วมกันข้ามแพลตฟอร์ม
- **app module** -- หน้าจอเฉพาะ Android การใช้งาน repository และจุดเริ่มต้น
- **iosApp module** -- จุดเริ่มต้นเฉพาะ iOS
- **express-api** -- แบ็กเอนด์ Express.js ที่รันบน Oracle Cloud Free Tier

## โครงสร้างโปรเจกต์

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

## การเริ่มต้นใช้งาน

### ข้อกำหนดเบื้องต้น

- **Android Studio** Ladybug หรือใหม่กว่า
- **JDK 17+**
- **Node.js 24+**
- **Docker** (สำหรับเซิร์ฟเวอร์ LiveKit ในเครื่อง)
- **Firebase CLI** (`npm install -g firebase-tools`)

### การพัฒนาในเครื่อง (แนะนำ)

วิธีที่เร็วที่สุดในการเริ่มต้น ใช้ Firebase Emulators และ LiveKit Docker container ในเครื่อง -- ไม่ต้องใช้บัญชีคลาวด์ ไม่มีค่าใช้จ่าย ไม่มีขีดจำกัดโควต้า

1. **โคลนและติดตั้ง**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **เริ่มบริการในเครื่อง**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   คำสั่งนี้จะเริ่ม Firebase Emulators (Firestore, Auth, RTDB) และ LiveKit Docker container เมื่อรันครั้งแรกจะเติมข้อมูลทดสอบอัตโนมัติ (ผู้ใช้ admin ของขวัญตัวอย่าง การตั้งค่า)

   คุณจะเห็น:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **เริ่ม Express API** (ในเทอร์มินัลใหม่)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Edit R2/SMTP values if needed
   npm run local
   ```
   API เริ่มที่ `http://localhost:3000` ทดสอบ: `curl http://localhost:3000/api/health`

4. **รันบน Android Emulator**
   ```bash
   ./gradlew installLocalDebug
   ```
   build flavor `local` เชื่อมต่อกับ `10.0.2.2` (loopback ของ Android emulator ไปยังเครื่องของคุณ) ใช้งานได้ทันที ไม่ต้องตั้งค่าเพิ่มเติม

5. **รันบนอุปกรณ์จริง**

   โทรศัพท์ต้องอยู่บน **เครือข่าย Wi-Fi เดียวกัน** กับเครื่องพัฒนา

   a. ค้นหา IP ในเครื่องของคุณ:
   ```bash
   # Windows
   ipconfig    # Look for "IPv4 Address" under your Wi-Fi adapter (e.g. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # or: ip addr show
   ```

   b. อัปเดต build flavor local ให้ใช้ IP ของคุณแทน `10.0.2.2` ใน `app/build.gradle.kts` ค้นหา flavor `local` และเปลี่ยน:
   ```kotlin
   // Replace 10.0.2.2 with your machine's local IP
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. เชื่อมต่ออุปกรณ์ผ่าน USB และเปิดใช้งาน USB debugging จากนั้น:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. หรือใช้ **adb reverse** เพื่อหลีกเลี่ยงการแก้ไขโค้ด (อุปกรณ์จะเส้นทาง localhost ไปยังเครื่องของคุณ):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   ด้วย `adb reverse` ที่อยู่ `10.0.2.2` เริ่มต้นใน local flavor จะทำงานบนอุปกรณ์จริงด้วย -- ไม่ต้องเปลี่ยนการตั้งค่า build

6. **เข้าสู่ระบบ**
   - ใช้ขั้นตอนการเข้าสู่ระบบด้วยอีเมลพร้อมบัญชีทดสอบที่เติมไว้: `claude-test@shytalk.dev` / `localdev123`
   - หรือสร้างบัญชีใหม่ -- จะใช้ emulator ในเครื่อง
   - Google/Apple sign-in ไม่ทำงานในเครื่อง (ไม่มี OAuth จริง) -- ใช้ email OTP แทน

7. **หยุดบริการในเครื่อง**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   หรือกด `Ctrl+C` ในเทอร์มินัลของ start script ข้อมูล emulator จะถูกบันทึกอัตโนมัติและกู้คืนในการเริ่มต้นครั้งถัดไป

### URL สำหรับการพัฒนาในเครื่องที่มีประโยชน์

| บริการ | URL | จุดประสงค์ |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | ดูข้อมูล Firestore ผู้ใช้ Auth, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Health check | http://localhost:3000/api/health | ตรวจสอบว่า API กำลังทำงาน |

### การพัฒนาบนคลาวด์ (ทางเลือก)

หากต้องการทดสอบกับบริการคลาวด์จริง (เช่น การแจ้งเตือน push จริง Google Sign-In จริง):

1. **ตั้งค่า Firebase**
   - สร้างโปรเจกต์ Firebase ที่ [console.firebase.google.com](https://console.firebase.google.com)
   - เปิดใช้งาน **Google Sign-In** และ **Apple Sign-In** ในการยืนยันตัวตน
   - เปิดใช้งาน **Firestore**, **Realtime Database** และ **Cloud Messaging**
   - ดาวน์โหลด `google-services.json` และวางไว้ใน `app/src/dev/`

2. **ตั้งค่า Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edit with your cloud credentials
   npm install
   npm start
   ```

3. **Deploy Firestore rules**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Build แอป Android** (dev flavor)
   ```bash
   ./gradlew assembleDevDebug
   ```

### ตัวแปรสภาพแวดล้อม

| ตัวแปร | คำอธิบาย | ตำแหน่ง |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK service account JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 access key | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 secret key | Express API |
| `R2_BUCKET_NAME` | R2 bucket name (default: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | LiveKit API key | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API secret | Express API |
| `LIVEKIT_URL` | LiveKit server URL | Android app (BuildConfig) |
| `WORKER_URL` | Express API base URL | Android app (BuildConfig) |

## การทดสอบ

| ชุดทดสอบ | คำสั่ง | จำนวน |
|-------|---------|-------|
| Kotlin unit tests | `./gradlew test` | 100+ tests |
| Express API tests | `cd express-api && npm test` | 1,540+ tests |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature files |
| Playwright web tests | `npx playwright test` | 28 specs |

```bash
# Kotlin/KMP unit tests
./gradlew test

# Express API tests
cd express-api && npm test

# E2E tests (requires connected device or emulator)
./gradlew connectedDevDebugAndroidTest

# Playwright browser tests (requires admin panel running)
npx playwright test
```

## การ Deploy

การ deploy จัดการผ่าน GitHub Actions workflows (`.github/workflows/`):

| Workflow | ทริกเกอร์ | สิ่งที่ทำ |
|----------|---------|-------------|
| **PR Checks** | อัตโนมัติเมื่อมี PR ไปยัง `main` | รัน lint, Kotlin tests, Express API tests, Playwright tests (ตามไฟล์ที่เปลี่ยน) |
| **Deploy to Dev** | ด้วยตนเอง (`workflow_dispatch`) | Deploy Express API + web ไปยัง dev แจก APK ให้ผู้ทดสอบ และเลือกรัน Playwright tests |
| **Deploy to Prod** | ด้วยตนเอง (`workflow_dispatch`) | Deploy release ที่ tag แล้วไปยัง prod -- Express API, web, Play Store และ App Store |

Workflow เพิ่มเติม: **E2E Tests** (Android emulator matrix), **SonarCloud** (การวิเคราะห์แบบสแตติก), **Lint**, **Backend Tests**, **Dependabot Auto-merge**

- **Express API:** Deploy ไปยัง Oracle Cloud VMs ผ่าน SSH + PM2 (dev: ลอนดอน, prod: สิงคโปร์)
- **Android:** Bundle และอัปโหลดไปยัง Google Play ผ่าน CI
- **iOS:** Build และอัปโหลดไปยัง App Store Connect / TestFlight ผ่าน CI
- **Admin panel / web:** Deploy ไปยัง Cloudflare Pages

## การมีส่วนร่วม

ยินดีรับการมีส่วนร่วม! โปรดดูแนวทางที่ [CONTRIBUTING.md](CONTRIBUTING.md)

## สัญญาอนุญาต

โปรเจกต์นี้ใช้สัญญาอนุญาต Apache License 2.0 ดูรายละเอียดที่ [LICENSE](LICENSE)

## ขอบคุณ

- [Firebase](https://firebase.google.com) -- Authentication, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- การสื่อสารด้วยเสียงแบบเรียลไทม์
- [Cloudflare](https://www.cloudflare.com) -- R2 storage, Pages hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM Free Tier สำหรับ Express API
- [Express.js](https://expressjs.com) -- เฟรมเวิร์ก API server
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI แบบ declarative สมัยใหม่
- [Koin](https://insert-koin.io) -- Dependency injection แบบเบา
- [Coil](https://coil-kt.github.io/coil/) -- การโหลดรูปภาพสำหรับ Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- เอฟเฟกต์ของขวัญแอนิเมชันและ UI
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- วันที่/เวลาแบบ multiplatform
