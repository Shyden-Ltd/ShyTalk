# ShyTalk

**Phòng trò chuyện thoại, được tái tưởng tượng.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | **Tiếng Việt** | [中文](README.zh.md)

## Giới thiệu

ShyTalk là ứng dụng trò chuyện thoại xã hội nơi người dùng có thể tạo và tham gia các phòng trò chuyện thoại theo thời gian thực. Được xây dựng bằng Kotlin Multiplatform (KMP), ứng dụng hỗ trợ cả Android và iOS từ một codebase chung. Dù bạn muốn tổ chức cuộc trò chuyện, lắng nghe, hay kết nối với mọi người trên khắp thế giới, ShyTalk giúp việc đó trở nên dễ dàng.

## Tính năng

### Phòng trò chuyện thoại
- Tạo hoặc tham gia phòng với thoại thời gian thực được hỗ trợ bởi LiveKit
- Hệ thống chỗ ngồi có cấu trúc với vai trò chủ phòng, người dẫn và người tham dự
- Yêu cầu và lời mời chỗ ngồi -- yêu cầu tham gia chỗ ngồi hoặc mời người nghe lên phát biểu
- Chathead nổi -- tiếp tục trò chuyện thoại khi duyệt các phần khác của ứng dụng
- Hết hạn phòng -- phòng tự động đóng khi chủ phòng vắng mặt, kèm theo đồng hồ đếm ngược

### Nhắn tin
- Trò chuyện văn bản trực tiếp kết hợp với thoại trong mỗi phòng
- Nhắn tin riêng tư với các cuộc trò chuyện 1-1
- Trò chuyện nhóm với quản lý thành viên và phân quyền
- Hiển thị trạng thái đang nhập theo thời gian thực
- Hỗ trợ nhãn dán

### Xã hội
- Hồ sơ người dùng tùy chỉnh với ảnh đại diện, ảnh bìa, cờ quốc tịch và giới thiệu bản thân
- Hệ thống theo dõi -- theo dõi người dùng khác và xem khi họ đang hoạt động
- Tường quà tặng -- trưng bày quà tặng nhận được từ người dùng khác
- Hệ thống chặn -- chặn người dùng trên toàn bộ phòng và hồ sơ

### Kinh tế ảo
- Nền kinh tế dựa trên xu với ví và lịch sử giao dịch
- Phần thưởng đăng nhập hàng ngày với điểm thưởng liên tiếp
- Hệ thống Lucky Spin (gacha) với các giải thưởng theo bậc
- Quà tặng ảo -- gửi và nhận quà tặng có hiệu ứng động trong khi trò chuyện thoại
- Kho ba lô để lưu trữ quà tặng
- Gói xu để mua xu
- Băng rôn phát sóng với hiệu ứng quà tặng động

### Tài khoản & Danh tính
- Xác thực đa nhà cung cấp -- đăng nhập bằng Google, Apple hoặc Email (OTP)
- Liên kết nhiều phương thức đăng nhập vào một tài khoản duy nhất
- Danh tính người dùng ổn định (uniqueId) tồn tại qua các dự án Firebase
- Quản lý tài khoản được liên kết trong Cài đặt với hỗ trợ liên kết/hủy liên kết
- Ràng buộc thiết bị -- mỗi thiết bị được gắn vĩnh viễn với một tài khoản

### Kiểm duyệt & An toàn
- Công cụ kiểm duyệt -- tắt tiếng, đuổi, di chuyển chỗ ngồi và quản lý người dẫn với tư cách chủ phòng
- Hệ thống báo cáo người dùng với quy trình xét duyệt
- Hệ thống cảnh báo và đình chỉ khi vi phạm chính sách
- Màn hình tiêu chuẩn cộng đồng, chính sách bảo mật và điều khoản dịch vụ
- Luồng chấp nhận pháp lý cho người dùng mới
- Bắt buộc cập nhật cho các phiên bản ứng dụng lỗi thời

### Màn hình khởi động
- Màn hình khởi động có thể cấu hình, hiển thị khi mở ứng dụng
- Nội dung do quản trị viên quản lý với các tùy chọn lên lịch và nhắm mục tiêu

### Bảo mật
- Bảo vệ truy cập ứng dụng bằng mã PIN
- Xác thực sinh trắc học -- nhận dạng vân tay và khuôn mặt
- Xác minh OTP (mật khẩu dùng một lần) cho các thao tác nhạy cảm

### Bảng quản trị
- Bảng điều khiển kiểm duyệt trên web tại trang tĩnh của dự án
- Quản lý người dùng, kiểm duyệt nội dung và cấu hình
- Quản lý mẫu và quà tặng với xem trước trực tiếp
- Truyền phát nhật ký theo thời gian thực và cảnh báo

### Nén ảnh
- Tự động nén ảnh khi tải lên qua Express API
- Giảm chi phí lưu trữ và băng thông trong khi vẫn giữ chất lượng

### Quốc tế hóa
- Hỗ trợ 19 ngôn ngữ ngay từ đầu
- Bản địa hóa đầy đủ cho tất cả các chuỗi hiển thị với người dùng

### Ghi nhật ký & Giám sát
- Ghi nhật ký có cấu trúc trên toàn bộ Express API, ứng dụng di động và bảng quản trị
- Truyền phát nhật ký theo thời gian thực trên bảng điều khiển quản trị
- Chặn thiết bị và mạng với thực thi tự động
- Hệ thống cảnh báo cho các lỗi nghiêm trọng và bất thường
- Truyền tải Trace ID để theo dõi yêu cầu đầu cuối

## Công nghệ sử dụng

| Tầng | Công nghệ |
|-------|-----------|
| **Framework** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **Kiến trúc** | MVVM + Repository Pattern |
| **DI** | Koin |
| **Xác thực** | Firebase Authentication (Google, Apple, Email+OTP) với hệ thống danh tính đa nhà cung cấp |
| **Cơ sở dữ liệu** | Cloud Firestore |
| **Thời gian thực** | Firebase Realtime Database |
| **Lưu trữ** | Cloudflare R2 (qua proxy Express API) |
| **API Server** | Express.js on Oracle Cloud Free Tier |
| **Thoại** | LiveKit |
| **Thông báo đẩy** | Firebase Cloud Messaging |
| **Tải ảnh** | Coil 3 (KMP) |
| **Hoạt ảnh** | Lottie Compose |
| **Ngày/Giờ** | kotlinx-datetime |
| **Điều hướng** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Kiến trúc

ShyTalk tuân theo **MVVM** với **Repository Pattern** rõ ràng:

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

- **shared module** (`commonMain`) -- Mô hình, giao diện repository, ViewModel và UI dùng chung trên các nền tảng
- **app module** -- Màn hình dành riêng cho Android, triển khai repository và điểm đầu vào
- **iosApp module** -- Điểm đầu vào dành riêng cho iOS
- **express-api** -- Backend Express.js chạy trên Oracle Cloud Free Tier

## Cấu trúc dự án

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

## Bắt đầu

### Yêu cầu

- **Android Studio** Ladybug hoặc mới hơn
- **JDK 17+**
- **Node.js 24+**
- **Docker** (cho máy chủ LiveKit cục bộ)
- **Firebase CLI** (`npm install -g firebase-tools`)

### Phát triển cục bộ (Khuyến nghị)

Cách nhanh nhất để bắt đầu. Sử dụng Firebase Emulators và container Docker LiveKit cục bộ — không cần tài khoản đám mây, không tốn chi phí, không giới hạn quota.

1. **Clone và cài đặt**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Khởi động dịch vụ cục bộ**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Lệnh này khởi động Firebase Emulators (Firestore, Auth, RTDB) và container Docker LiveKit. Lần chạy đầu tiên sẽ tự động seed dữ liệu thử nghiệm (người dùng quản trị, quà tặng mẫu, cấu hình).

   Bạn sẽ thấy:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Khởi động Express API** (trong terminal mới)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # Chỉnh sửa giá trị R2/SMTP nếu cần
   npm run local
   ```
   API khởi động tại `http://localhost:3000`. Kiểm tra: `curl http://localhost:3000/api/health`

4. **Chạy trên Android Emulator**
   ```bash
   ./gradlew installLocalDebug
   ```
   Build flavor `local` kết nối tới `10.0.2.2` (loopback của Android emulator tới máy của bạn). Hoạt động ngay — không cần cấu hình thêm.

5. **Chạy trên thiết bị thực**

   Điện thoại của bạn phải kết nối cùng **mạng Wi-Fi** với máy phát triển.

   a. Tìm địa chỉ IP cục bộ của máy:
   ```bash
   # Windows
   ipconfig    # Tìm "IPv4 Address" dưới Wi-Fi adapter (ví dụ: 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # hoặc: ip addr show
   ```

   b. Cập nhật build flavor local để dùng IP của bạn thay vì `10.0.2.2`. Trong `app/build.gradle.kts`, tìm flavor `local` và thay đổi:
   ```kotlin
   // Thay 10.0.2.2 bằng IP cục bộ của máy bạn
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Kết nối thiết bị qua USB và bật USB debugging, sau đó:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Hoặc, dùng **adb reverse** để tránh thay đổi code (thiết bị định tuyến localhost tới máy của bạn):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   Với `adb reverse`, địa chỉ `10.0.2.2` mặc định trong local flavor sẽ hoạt động trên thiết bị thực — không cần thay đổi cấu hình build.

6. **Đăng nhập**
   - Dùng luồng đăng nhập email với tài khoản thử nghiệm đã seed: `claude-test@shytalk.dev` / `localdev123`
   - Hoặc tạo tài khoản mới — sẽ sử dụng emulators cục bộ
   - Đăng nhập Google/Apple sẽ không hoạt động cục bộ (không có OAuth thực) — dùng email OTP thay thế

7. **Dừng dịch vụ cục bộ**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Hoặc nhấn `Ctrl+C` trong terminal chạy script khởi động. Dữ liệu emulator được lưu tự động và khôi phục lần khởi động tiếp theo.

### URL hữu ích khi phát triển cục bộ

| Dịch vụ | URL | Mục đích |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Duyệt dữ liệu Firestore, Auth users, RTDB |
| Express API | http://localhost:3000 | Backend API |
| Health check | http://localhost:3000/api/health | Kiểm tra API đang chạy |

### Phát triển trên đám mây (Tùy chọn)

Nếu bạn cần kiểm tra với các dịch vụ đám mây thực (ví dụ: thông báo đẩy thực, Google Sign-In thực):

1. **Thiết lập Firebase**
   - Tạo dự án Firebase tại [console.firebase.google.com](https://console.firebase.google.com)
   - Bật **Google Sign-In** và **Apple Sign-In** trong Authentication
   - Bật **Firestore**, **Realtime Database** và **Cloud Messaging**
   - Tải `google-services.json` và đặt vào `app/src/dev/`

2. **Thiết lập Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Chỉnh sửa với thông tin xác thực đám mây của bạn
   npm install
   npm start
   ```

3. **Triển khai Firestore rules**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Build ứng dụng Android** (flavor dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Biến môi trường

| Biến | Mô tả | Vị trí |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON tài khoản dịch vụ Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | ID tài khoản Cloudflare R2 | Express API |
| `R2_ACCESS_KEY_ID` | Khóa truy cập R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Khóa bí mật R2 | Express API |
| `R2_BUCKET_NAME` | Tên bucket R2 (mặc định: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | Khóa API LiveKit | Express API |
| `LIVEKIT_API_SECRET` | Bí mật API LiveKit | Express API |
| `LIVEKIT_URL` | URL máy chủ LiveKit | Android app (BuildConfig) |
| `WORKER_URL` | URL cơ sở Express API | Android app (BuildConfig) |

## Kiểm thử

| Bộ kiểm thử | Lệnh | Số lượng |
|-------|---------|-------|
| Kotlin unit tests | `./gradlew test` | 100+ bài kiểm thử |
| Express API tests | `cd express-api && npm test` | 1.540+ bài kiểm thử |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 feature files |
| Playwright web tests | `npx playwright test` | 28 specs |

```bash
# Kotlin/KMP unit tests
./gradlew test

# Express API tests
cd express-api && npm test

# E2E tests (yêu cầu thiết bị hoặc emulator đã kết nối)
./gradlew connectedDevDebugAndroidTest

# Playwright browser tests (yêu cầu bảng quản trị đang chạy)
npx playwright test
```

## Triển khai

Việc triển khai được quản lý qua GitHub Actions workflows (`.github/workflows/`):

| Workflow | Trigger | Chức năng |
|----------|---------|-------------|
| **PR Checks** | Tự động khi có PR vào `main` | Chạy lint, Kotlin tests, Express API tests, Playwright tests (dựa trên các file đã thay đổi) |
| **Deploy to Dev** | Thủ công (`workflow_dispatch`) | Triển khai Express API + web lên dev, phân phối APK cho testers, tùy chọn chạy Playwright tests |
| **Deploy to Prod** | Thủ công (`workflow_dispatch`) | Triển khai release có tag lên prod -- Express API, web, Play Store và App Store |

Workflow bổ sung: **E2E Tests** (ma trận Android emulator), **SonarCloud** (phân tích tĩnh), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** Triển khai lên Oracle Cloud VMs qua SSH + PM2 (dev: London, prod: Singapore)
- **Android:** Đóng gói và tải lên Google Play qua CI
- **iOS:** Build và tải lên App Store Connect / TestFlight qua CI
- **Bảng quản trị / web:** Triển khai lên Cloudflare Pages

## Đóng góp

Mọi đóng góp đều được chào đón! Vui lòng xem [CONTRIBUTING.md](CONTRIBUTING.md) để biết hướng dẫn.

## Giấy phép

Dự án này được cấp phép theo Apache License 2.0. Xem [LICENSE](LICENSE) để biết chi tiết.

## Lời cảm ơn

- [Firebase](https://firebase.google.com) -- Authentication, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- Giao tiếp thoại thời gian thực
- [Cloudflare](https://www.cloudflare.com) -- Lưu trữ R2, hosting Pages, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- VM miễn phí cho Express API
- [Express.js](https://expressjs.com) -- Framework máy chủ API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- UI khai báo hiện đại
- [Koin](https://insert-koin.io) -- Dependency injection nhẹ
- [Coil](https://coil-kt.github.io/coil/) -- Tải ảnh cho Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Hiệu ứng quà tặng và UI có hoạt ảnh
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Ngày/giờ đa nền tảng
