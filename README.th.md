# ShyTalk

**ห้องแชทด้วยเสียง ยุคใหม่.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | **ไทย** | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## เกี่ยวกับ

ShyTalk เป็นแอปแชทด้วยเสียงโซเชียลที่ผู้ใช้สามารถสร้างและเข้าร่วมห้องแชทเสียงแบบ real-time ได้ สร้างด้วย Kotlin Multiplatform (KMP) โดยมีเป้าหมายสำหรับ Android และ iOS ด้วยโค้ดที่ใช้ร่วมกัน ไม่ว่าคุณต้องการเป็นเจ้าภาพสนทนา ฟังแบบเงียบ ๆ หรือเชื่อมต่อกับผู้คนทั่วโลก ShyTalk จะทำให้เรื่องนี้เป็นเรื่องง่าย

iOS เป็นแพลตฟอร์มที่รองรับ แต่คู่มือนี้มุ่งเน้นไปที่การพัฒนา Android ซึ่งเป็นเป้าหมายการพัฒนาหลัก

## คุณสมบัติ

### ห้องแชทด้วยเสียง
- สร้างหรือเข้าร่วมห้องด้วยเสียง real-time ที่ขับเคลื่อนโดย LiveKit
- ระบบที่นั่งแบบมีโครงสร้างพร้อมบทบาทเจ้าของ โฮสต์ และผู้เข้าร่วม
- คำขอที่นั่งและการเชิญ — ขอเข้าร่วมที่นั่งหรือเชิญผู้ฟังให้พูด
- หัวแชทลอยตัว — ทำให้แชทด้วยเสียงต่อเนื่องในขณะที่เรียกดูส่วนอื่นของแอป
- การหมดอายุของห้อง — ห้องจะปิดโดยอัตโนมัติเมื่อเจ้าของไม่อยู่ พร้อมตัวนับถอยหลัง

### การส่งข้อความ
- แชทข้อความสดใจ ข้างๆ เสียงในทุกห้อง
- การส่งข้อความส่วนตัวด้วยการสนทนาแบบ 1-1
- แชทกลุ่มพร้อมการจัดการสมาชิกและสิทธิ์
- ตัวบ่งชี้การพิมพ์ real-time
- การรองรับสติกเกอร์

### โซเชียล
- โปรไฟล์ผู้ใช้ที่ปรับแต่งได้ด้วยรูปภาพ ภาพปก แฟล็กชาติ และประวัติ
- ระบบติดตาม — ติดตามผู้ใช้อื่น ๆ และดูว่าพวกเขาออนไลน์เมื่อใด
- กำแพงของขวัญ — แสดงขวัญที่ได้รับจากผู้ใช้อื่น ๆ
- ระบบปิดกั้น — ปิดกั้นผู้ใช้ในห้องและโปรไฟล์

### เศรษฐกิจเสมือน
- เศรษฐกิจที่ใช้เหรียญ พร้อมกระเป๋าและประวัติธุรกรรม
- รางวัลการเข้าสู่ระบบรายวัน พร้อมโบนัสจากการรักษาสตรีค
- ระบบ Lucky Spin (gacha) ที่มีรางวัลหลายระดับ
- ของขวัญเสมือน — ส่งและรับของขวัญแบบเคลื่อนไหวในระหว่างแชทด้วยเสียง
- สินค้าคงคลังเป้สะพาย สำหรับจัดเก็บของขวัญ
- แพ็คเกจเหรียญสำหรับซื้อเหรียญ
- แบนเนอร์ประกาศโฆษณาพร้อมเอฟเฟกต์ของขวัญแบบเคลื่อนไหว

### บัญชีและข้อมูลประจำตัว
- การตรวจสอบสิทธิ์จากหลายผู้ให้บริการ — ลงชื่อเข้าใช้ด้วย Google, Apple หรือ Email (OTP)
- เชื่อมโยงวิธีการลงชื่อเข้าใช้หลายวิธีกับบัญชีเดียว
- ข้อมูลประจำตัวผู้ใช้ที่เสถียร (uniqueId) ที่ยืนหยัดในโครงการ Firebase
- การจัดการบัญชีที่เชื่อมโยงในการตั้งค่า พร้อมการรองรับลิงก์/ยกเลิกลิงก์
- การผูกอุปกรณ์ — อุปกรณ์แต่ละเครื่องจะเชื่อมโยงกับบัญชีเดียวอย่างถาวร

### การดูแลและความปลอดภัย
- เครื่องมือการดูแล — ปิดเสียง เตะออก ย้ายที่นั่ง และจัดการโฮสต์เป็นเจ้าของห้อง
- ระบบรายงานผู้ใช้ด้วยเวิร์กโฟลว์การตรวจสอบ
- ระบบคำเตือนและการระงับสำหรับการละเมิดนโยบาย
- หน้าจออมูลมาตรฐานชุมชน นโยบายความเป็นส่วนตัว และเงื่อนไขการให้บริการ
- ขั้นตอนการยอมรับทางกฎหมายสำหรับผู้ใช้ใหม่
- บังคับปรับปรุงสำหรับเวอร์ชันแอปที่ล้าสมัย

### หน้าจอเริ่มต้น
- หน้าจอเปิดตัวที่สามารถกำหนดค่าได้ที่แสดงบนการเปิดตัวแอป
- เนื้อหาที่จัดการโดยผู้ดูแลระบบ พร้อมตัวเลือกการกำหนดเวลาและเป้าหมาย

### ความปลอดภัย
- การป้องกัน PIN code สำหรับการเข้าถึงแอป
- การตรวจสอบสิทธิ์แบบชีววัตร — การรู้จำลายนิ้วมือและใบหน้า
- การยืนยัน OTP (รหัสผ่านครั้งเดียว) สำหรับการดำเนินการที่ละเอียดอ่อน

### แผงควบคุมผู้ดูแลระบบ
- แดชบอร์ดการดูแลแบบเว็บที่ไซต์คงที่ของโครงการ
- การจัดการผู้ใช้ การดูแลเนื้อหา และการกำหนดค่า
- การจัดการเทมเพลตและของขวัญพร้อมการแสดงตัวอย่างสดใจ
- การสตรีมบันทึกเรียลไทม์ และการแจ้งเตือน

### การบีบอัดภาพ
- การบีบอัดภาพอัตโนมัติเมื่ออัปโหลดผ่าน Express API
- ลดต้นทุนการจัดเก็บและแบนด์วิดท์พร้อมรักษาคุณภาพ

### การสนับสนุนหลายภาษา
- รองรับ 19 ภาษา จากกล่องไป
- การแปลเป็นภาษาถิ่นแบบเต็มรูปแบบสำหรับสตริงที่ผู้ใช้มองเห็น

### การบันทึกและการเฝ监视
- การบันทึกเชิงโครงสร้างข้าม Express API, แอปมือถือ และแผงควบคุมผู้ดูแลระบบ
- การสตรีมบันทึกเรียลไทม์ในแดชบอร์ดผู้ดูแลระบบ
- การห้ามอุปกรณ์และเครือข่าย พร้อมการบังคับใช้อัตโนมัติ
- ระบบการแจ้งเตือนสำหรับข้อผิดพลาดและความผิดปกติที่สำคัญ
- การแพร่กระจาย Trace ID สำหรับการติดตามคำขอจากต้นทางถึงปลายทาง

## สแต็กเทคโนโลยี

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

## สถาปัตยกรรม

ShyTalk ปฏิบัติตาม **MVVM** ด้วย **Repository Pattern** ที่สะอาด:

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

- **shared module** (`commonMain`) -- โมเดล อินเทอร์เฟซที่เก็บข้อมูล ViewModels และ UI ที่ใช้ร่วมกันบนแพลตฟอร์ม
- **app module** -- หน้าจออื่น ๆ ของ Android, การใช้งานระบบที่เก็บข้อมูล และจุดเริ่มต้น
- **iosApp module** -- จุดเริ่มต้นเฉพาะ iOS
- **express-api** -- Express.js backend ทำงานบน Oracle Cloud Free Tier

## โครงสร้างโครงการ

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

## เริ่มต้นใช้งาน

### ข้อกำหนดเบื้องต้น

- **Android Studio** Ladybug หรือใหม่กว่า
- **JDK 17+**
- **Node.js 24+**
- **Docker** (สำหรับ LiveKit voice server, MinIO storage, Mailpit email)
- **Firebase CLI** (`npm install -g firebase-tools`)

ไม่จำเป็นต้องมีบัญชี cloud เพื่อเริ่มต้น -- สภาพแวดล้อมท้องถิ่นทำงานออนไลน์โดยสิ้นเชิง

### การพัฒนาในสภาพแวดล้อมท้องถิ่น (ลองเลิก)

วิธีที่เร็วที่สุดในการเริ่มต้น คำสั่งเดียวเริ่มต้นทุกอย่าง -- Firebase Emulators, Docker containers, Express API และสร้างแอป Android ไม่จำเป็นต้องมีบัญชี cloud ไม่มีต้นทุน ไม่มีขีดจำกัดโควต้า

1. **Clone and install**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Start everything**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   This single command:
   - Starts Docker containers (LiveKit voice server, MinIO storage, Mailpit email)
   - Starts Firebase Emulators (Firestore, Auth, RTDB)
   - Seeds test data and creates the MinIO storage bucket
   - Starts the Express API
   - Builds and installs the Android app (if a device is connected)

   When ready, you'll see:
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

3. **ลงชื่อเข้าใช้**
   - ใช้ขั้นตอนการลงชื่อเข้าใช้ด้วยอีเมลกับบัญชีทดสอบที่จัดเตรียมไว้: `claude-test@shytalk.dev` / `localdev123`
   - หรือสร้างบัญชีใหม่ -- จะใช้ emulator ท้องถิ่น
   - การลงชื่อเข้าใช้ Google/Apple จะไม่ทำงานในสภาพแวดล้อมท้องถิ่น (ไม่มี OAuth จริง) -- ใช้ email OTP แทน
   - รหัส OTP จะถูกจับโดย Mailpit -- ตรวจสอบที่ http://localhost:8025

4. **เรียกใช้บนอุปกรณ์จริง**

   โทรศัพท์ของคุณต้องอยู่บน **เครือข่าย Wi-Fi เดียวกัน** กับเครื่องพัฒนาของคุณ

   a. Find your machine's local IP:
   ```bash
   # Windows
   ipconfig    # Look for "IPv4 Address" under your Wi-Fi adapter (e.g. 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # or: ip addr show
   ```

   b. Update the local build flavor to use your IP instead of `10.0.2.2`. In `app/build.gradle.kts`, find the `local` flavor and change:
   ```kotlin
   // Replace 10.0.2.2 with your machine's local IP
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Connect your device via USB and enable USB debugging, then:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Alternatively, use **adb reverse** to avoid changing any code (device routes localhost to your machine):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (image storage)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   ด้วย `adb reverse` ที่อยู่ `10.0.2.2` เริ่มต้นในรสชาติท้องถิ่นจะทำงานบนอุปกรณ์จริงได้เช่นกัน -- ไม่จำเป็นต้องเปลี่ยนการตั้งค่าการสร้าง

5. **หยุดบริการท้องถิ่น**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   หรือกด `Ctrl+C` ในเทอร์มินัล start script ข้อมูล Emulator จะบันทึกโดยอัตโนมัติและเรียกคืนเมื่อเริ่มครั้งต่อไป

### URL การพัฒนาท้องถิ่นที่มีประโยชน์

| Service | URL | Purpose |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | เรียกดูข้อมูล Firestore, ผู้ใช้ Auth, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Health check | http://localhost:3000/api/health | ตรวจสอบว่า API กำลังทำงาน |
| Mailpit | http://localhost:8025 | ดูอีเมลและรหัส OTP ที่จับได้ |
| MinIO Console | http://localhost:9001 | เรียกดูรูปภาพและไฟล์ที่อัปโหลด |

### บริการเสริม

**LibreTranslate (การแปลข้อความ)**

ภาพ Docker ขนาด 6GB+ ที่เสริมสำหรับการทดสอบฟีเจอร์การแปลภาษาในสภาพแวดล้อมท้องถิ่น:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
ไม่รวมในการตั้งค่าเริ่มต้นเนื่องจากขนาดภาพขนาดใหญ่ การแปลจะทำงานโดยไม่มี -- ข้อความจะยังคงไม่แปล

### การพัฒนา Cloud (ไม่บังคับ)

หากคุณต้องการทดสอบเกี่ยวกับบริการ cloud จริง (เช่น การแจ้งเตือนแบบ push จริง การลงชื่อเข้าใช้ Google จริง):

1. **การตั้งค่า Firebase**
   - สร้างโครงการ Firebase ที่ [console.firebase.google.com](https://console.firebase.google.com)
   - เปิดใช้งาน **Google Sign-In** และ **Apple Sign-In** ในการตรวจสอบสิทธิ์
   - เปิดใช้งาน **Firestore**, **Realtime Database** และ **Cloud Messaging**
   - ดาวน์โหลด `google-services.json` และวางไว้ใน `app/src/dev/`

2. **การตั้งค่า Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Edit with your cloud credentials
   npm install
   npm start
   ```

3. **ปรับใช้กฎ Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **สร้างแอป Android** (รสชาติ dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### ตัวแปรสภาพแวดล้อม

| Variable | Description | Where |
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

### การเรียกใช้การทดสอบในสภาพแวดล้อมท้องถิ่น

```bash
# Interactive test menu (choose what to run):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Or run individual suites:
bash local/test-unit.sh       # Kotlin + Express API unit tests
bash local/test-playwright.sh # Playwright web tests (needs local env)
bash local/test-e2e.sh        # Android E2E tests (needs local env + device)
bash local/test-lint.sh       # ktlint + ESLint

# View Allure test report:
npx allure serve allure-results
```

### ชุดการทดสอบ

| Suite | Command | Count |
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

### การทดสอบใน CI

ใน CI Playwright และการทดสอบ Android E2E ทำงานเกี่ยวกับสภาพแวดล้อมท้องถิ่นเดียวกัน (emulator + Docker) -- ไม่มีการใช้บริการ cloud ซึ่งช่วยให้มั่นใจว่าการทดสอบไม่ขัดขวางผู้ทดสอบสดใจ

## การแก้ปัญหา

- **Port already in use**: `lsof -i :<port>` (Linux/macOS) หรือ `netstat -ano | findstr :<port>` (Windows) เพื่อค้นหาสิ่งที่ใช้พอร์ต
- **Docker not running**: ตรวจสอบว่า Docker Desktop เริ่มขึ้นแล้ว เรียกใช้ `docker ps` เพื่อตรวจสอบ
- **Firebase emulators fail to start**: ต้องใช้ Java 11+ ตรวจสอบด้วย `java -version`
- **Android build fails**: ตรวจสอบว่าติดตั้ง JDK 17+ และ Android SDK แล้ว ลองใช้ `./gradlew clean`
- **adb device not detected**: เปิดใช้งาน USB debugging เรียกใช้ `adb devices` เพื่อตรวจสอบ
- **Images not loading**: MinIO bucket อาจไม่ได้สร้าง เรียกใช้ `cd express-api && NODE_ENV=local node ../local/seed.js` สำหรับอุปกรณ์จริง ให้เรียกใช้ `adb reverse tcp:9002 tcp:9002`
- **OTP not arriving**: ตรวจสอบเอาต์พุตคอนโซลหาเส้น `[OTP-LOCAL]` ยังตรวจสอบ Mailpit UI ที่ http://localhost:8025
- **Reset emulator data**: ลบไดเรกทอรี `local/firebase-emulator-data/` และเริ่มต้นใหม่
- **Reset MinIO data**: เรียกใช้ `docker compose -f local/docker-compose.yml down -v` เพื่อลบปริมาณ

## การปรับใช้

การปรับใช้ได้รับการจัดการผ่าน GitHub Actions workflows (`.github/workflows/`):

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **PR Checks** | Automatic on PRs to `main` | Runs lint, Kotlin tests, Express API tests, Playwright tests (based on changed files) |
| **Deploy to Dev** | Manual (`workflow_dispatch`) | Deploys Express API + web to dev, distributes APK to testers, optionally runs Playwright tests |
| **Deploy to Prod** | Manual (`workflow_dispatch`) | Deploys a tagged release to prod -- Express API, web, Play Store, and App Store |

Workflows เพิ่มเติม: **E2E Tests** (Android emulator matrix), **SonarCloud** (static analysis), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** ปรับใช้ไปยัง Oracle Cloud VMs ผ่าน SSH + PM2 (dev: London, prod: Singapore)
- **Android:** บันเดิลและอัปโหลดไปยัง Google Play ผ่าน CI
- **iOS:** สร้างและอัปโหลดไปยัง App Store Connect / TestFlight ผ่าน CI
- **Admin panel / web:** ปรับใช้ไปยัง Cloudflare Pages

## การมีส่วนร่วม

อยากต้อนรับการร่วมมือ! โปรดดู [CONTRIBUTING.md](CONTRIBUTING.md) สำหรับคำแนะนำ

## ลิขสิทธิ์

โครงการนี้อยู่ภายใต้ใบอนุญาต Apache License 2.0 ดู [LICENSE](LICENSE) สำหรับรายละเอียด

## ข้อมูลสำคัญ

- [Firebase](https://firebase.google.com) -- Authentication, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Real-time voice communication
- [Cloudflare](https://www.cloudflare.com) -- R2 storage, Pages hosting, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Free tier VM for Express API
- [Express.js](https://expressjs.com) -- API server framework
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Modern declarative UI
- [Koin](https://insert-koin.io) -- Lightweight dependency injection
- [Coil](https://coil-kt.github.io/coil/) -- Image loading for Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Animated gift and UI effects
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Multiplatform date/time
