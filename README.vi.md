# ShyTalk

**Phòng trò chuyện thoại, được tái tưởng tượng.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | **Tiếng Việt** | [中文](README.zh.md)

## Giới Thiệu

ShyTalk là một ứng dụng trò chuyện thoại xã hội nơi người dùng có thể tạo và tham gia các phòng trò chuyện thoại theo thời gian thực. Được xây dựng bằng Kotlin Multiplatform (KMP), nó hướng đến cả Android và iOS với một codebase chung. Cho dù bạn muốn tổ chức một cuộc trò chuyện, lắng nghe, hay kết nối với mọi người trên thế giới, ShyTalk giúp bạn dễ dàng thực hiện.

iOS là một nền tảng được hỗ trợ nhưng hướng dẫn này tập trung vào phát triển Android, đây là mục tiêu phát triển chính.

## Tính Năng

### Phòng Trò Chuyện Thoại
- Tạo hoặc tham gia các phòng với thoại thời gian thực được cung cấp bởi LiveKit
- Hệ thống xếp chỗ ngồi có cấu trúc với vai trò chủ sở hữu, người dẫn dắt và người tham dự
- Yêu cầu chỗ ngồi và lời mời -- yêu cầu tham gia một chỗ ngồi hoặc mời những người lắng nghe để phát biểu
- Chathead nổi -- tiếp tục trò chuyện thoại trong khi duyệt các phần khác của ứng dụng
- Hết hạn phòng -- các phòng tự động đóng khi chủ sở hữu vắng mặt, có bộ đếm ngược

### Nhắn Tin
- Trò chuyện văn bản trực tiếp cùng với thoại trong mỗi phòng
- Nhắn tin riêng tư với cuộc trò chuyện 1-1
- Trò chuyện nhóm với quản lý thành viên và quyền hạn
- Chỉ báo đang gõ theo thời gian thực
- Hỗ trợ sticker

### Xã Hội
- Hồ sơ người dùng có thể tùy chỉnh với ảnh, ảnh bìa, cờ quốc tịch và tiểu sử
- Hệ thống theo dõi -- theo dõi người dùng khác và xem khi họ hoạt động
- Tường quà -- trưng bày các quà tặng nhận được từ người dùng khác
- Hệ thống chặn -- chặn người dùng trên các phòng và hồ sơ

### Nền Kinh Tế Ảo
- Nền kinh tế dựa trên đồng tiền với ví và lịch sử giao dịch
- Phần thưởng đăng nhập hàng ngày với tiền thưởng streak
- Hệ thống Lucky Spin (gacha) với giải thưởng theo tầng
- Quà tặng ảo -- gửi và nhận quà tặng động hình trong các cuộc trò chuyện thoại
- Kho lưu trữ để lưu trữ quà tặng
- Gói đồng tiền để mua đồng tiền
- Spanduk phát sóng với các hiệu ứng quà tặng động hình

### Tài Khoản & Nhận Dạng
- Xác thực đa nhà cung cấp -- đăng nhập bằng Google, Apple hoặc Email (OTP)
- Liên kết nhiều phương pháp đăng nhập với một tài khoản
- Danh tính người dùng ổn định (uniqueId) vẫn tồn tại trên các dự án Firebase
- Quản lý Tài Khoản Được Liên Kết trong Cài Đặt với hỗ trợ liên kết/bỏ liên kết
- Liên kết thiết bị -- mỗi thiết bị được gắn vĩnh viễn với một tài khoản

### Kiểm Duyệt & An Toàn
- Công cụ kiểm duyệt -- tắt tiếng, loại bỏ, chuyển chỗ ngồi và quản lý người dẫn dắt như chủ sở hữu phòng
- Hệ thống báo cáo người dùng với quy trình xem xét
- Hệ thống cảnh báo và tạm dừng để vi phạm chính sách
- Các màn hình tiêu chuẩn cộng đồng, chính sách bảo mật và điều khoản dịch vụ
- Quy trình chấp nhận pháp lý cho những người dùng mới
- Thực thi cập nhật bắt buộc cho các phiên bản ứng dụng lỗi thời

### Màn Hình Khởi Động
- Các màn hình khởi động có thể cấu hình được hiển thị khi khởi động ứng dụng
- Nội dung do quản trị viên quản lý với các tùy chọn lên lịch và nhắm mục tiêu

### Bảo Mật
- Bảo vệ mã PIN cho quyền truy cập ứng dụng
- Xác thực sinh trắc học -- nhận dạng dấu vân tay và khuôn mặt
- Xác minh OTP (mật khẩu một lần) cho các hành động nhạy cảm

### Bảng Điều Khiển Quản Trị
- Bảng điều khiển kiểm duyệt dựa trên web tại trang tĩnh của dự án
- Quản lý người dùng, kiểm duyệt nội dung và cấu hình
- Quản lý mẫu và quà tặng với xem trước trực tiếp
- Phát trực tiếp nhật ký theo thời gian thực và cảnh báo

### Nén Ảnh
- Nén ảnh tự động khi tải lên thông qua Express API
- Giảm chi phí lưu trữ và băng thông trong khi bảo toàn chất lượng

### Quốc Tế Hóa
- 19 ngôn ngữ được hỗ trợ ngay từ đầu
- Bản địa hóa đầy đủ cho tất cả các chuỗi đối mặt với người dùng

### Ghi Nhật Ký & Giám Sát
- Ghi nhật ký có cấu trúc trên Express API, các ứng dụng di động và bảng điều khiển quản trị
- Phát trực tiếp nhật ký theo thời gian thực trong bảng điều khiển quản trị
- Lệnh cấm thiết bị và mạng với thực thi tự động
- Hệ thống cảnh báo cho các lỗi nghiêm trọng và bất thường
- Lan truyền ID theo dõi cho việc theo dõi yêu cầu từ đầu đến cuối

## Tech Stack

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
| **Voice** | LiveKit (self-hosted on Oracle Cloud) |
| **Push Notifications** | Firebase Cloud Messaging |
| **Image Loading** | Coil 3 (KMP) |
| **Animations** | Lottie Compose |
| **Date/Time** | kotlinx-datetime |
| **Navigation** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## Kiến Trúc

ShyTalk tuân theo **MVVM** với một **Mẫu Kho Dữ Liệu** sạch:

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

- **shared module** (`commonMain`) -- Mô hình, giao diện kho dữ liệu, ViewModels và UI được chia sẻ trên các nền tảng
- **app module** -- Các màn hình dành riêng cho Android, triển khai kho dữ liệu và điểm vào
- **iosApp module** -- Điểm vào dành riêng cho iOS
- **express-api** -- Backend Express.js chạy trên Oracle Cloud Free Tier

## Cấu Trúc Dự Án

```
ShyTalk/
+-- app/                              # Module ứng dụng Android
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # Điểm vào ứng dụng
|       |   +-- MainActivity.kt       # Hoạt động chính
|       |   +-- core/
|       |   |   +-- di/               # Module DI Koin
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # Thoại LiveKit, có mặt, thông báo
|       |   |   +-- repository/       # Triển khai kho dữ liệu
|       |   +-- feature/
|       |   |   +-- auth/             # Màn hình Đăng Nhập Google
|       |   |   +-- profile/          # Màn hình hồ sơ
|       |   |   +-- room/             # Màn hình phòng
|       |   |   +-- settings/         # Cài đặt ứng dụng
|       |   +-- navigation/           # NavGraph & Tuyến đường màn hình
|       +-- test/                     # Kiểm tra đơn vị
|       +-- androidTest/              # Kiểm tra E2E (Compose UI Test)
+-- shared/                           # Module KMP chia sẻ
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # Các mô-đun Koin chia sẻ
|       |   +-- model/                # Các mô hình dữ liệu (Người dùng, ChatRoom, Quà tặng, v.v.)
|       |   +-- ui/                   # Các thành phần chia sẻ
|       |   +-- util/                 # Tiện ích & hằng số
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, v.v.
|       |   +-- repository/           # Giao diện kho dữ liệu
|       +-- feature/                  # Các mô-đun tính năng chia sẻ
+-- iosApp/                           # Module ứng dụng iOS
+-- express-api/                      # Máy chủ API Express.js
|   +-- src/
|       +-- routes/                   # Trình xử lý tuyến đường API
|       +-- middleware/               # Middleware xác thực, ghi nhật ký
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # Các công việc được lên lịch
+-- public/                           # Trang tĩnh & bảng điều khiển quản trị
+-- local/                            # Môi trường phát triển cục bộ (bộ giả lập, dữ liệu hạt giống)
+-- tests/web/                        # Kiểm tra trình duyệt Playwright
+-- scripts/                          # Các tập lệnh tiện ích
+-- .github/workflows/                # CI/CD (Kiểm tra PR, Triển khai đến Dev/Prod, E2E, lint)
+-- firestore.rules                   # Quy tắc bảo mật Firestore
+-- database.rules.json               # Quy tắc bảo mật RTDB
+-- firestore.indexes.json            # Chỉ số tổng hợp Firestore
+-- firebase.json                     # Cấu hình Firebase
```

## Bắt Đầu

### Điều Kiện Tiên Quyết

- **Android Studio** Ladybug hoặc mới hơn
- **JDK 21+**
- **Node.js 24+**
- **Docker** (cho máy chủ thoại LiveKit, lưu trữ MinIO, email Mailpit)
- **Firebase CLI** (`npm install -g firebase-tools`)

Không cần tài khoản đám mây để bắt đầu -- môi trường cục bộ chạy hoàn toàn ngoại tuyến.

### Phát Triển Cục Bộ (Được Khuyến Nghị)

Cách nhanh nhất để bắt đầu. Một lệnh khởi động tất cả -- Firebase Emulators, vùng chứa Docker, Express API và xây dựng ứng dụng Android. Không cần tài khoản đám mây, không có chi phí, không có giới hạn hạn ngạch.

1. **Sao chép và cài đặt**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **Khởi động tất cả**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   Một lệnh này:
   - Khởi động vùng chứa Docker (máy chủ thoại LiveKit, lưu trữ MinIO, email Mailpit)
   - Khởi động Firebase Emulators (Firestore, Auth, RTDB)
   - Tạo hạt giống dữ liệu kiểm tra và tạo bộ lưu trữ MinIO
   - Khởi động Express API
   - Xây dựng và cài đặt ứng dụng Android (nếu một thiết bị được kết nối)

   Khi sẵn sàng, bạn sẽ thấy:
   ```
   Môi trường cục bộ sẵn sàng (hoàn toàn ngoại tuyến):

     Dịch vụ:
       Firebase UI:    http://localhost:4000
       Express API:    http://localhost:3000
       Mailpit UI:     http://localhost:8025
       MinIO Console:  http://localhost:9001
       LiveKit:        localhost:7880

     Thông tin đăng nhập:
       Quản trị viên kiểm tra:  claude-test@shytalk.dev / localdev123
       Người dùng kiểm tra:     user@test.com / localdev123
       MinIO:                   minioadmin / minioadmin
   ```

3. **Đăng nhập**
   - Sử dụng luồng đăng nhập email với tài khoản kiểm tra đã tạo hạt giống: `claude-test@shytalk.dev` / `localdev123`
   - Hoặc tạo một tài khoản mới -- nó sẽ sử dụng bộ giả lập cục bộ
   - Đăng nhập Google/Apple sẽ không hoạt động cục bộ (không OAuth thực tế) -- thay vào đó sử dụng email OTP
   - Các mã OTP được Mailpit ghi lại -- kiểm tra http://localhost:8025

4. **Chạy trên Thiết Bị Vật Lý**

   Điện thoại của bạn phải ở trên **mạng Wi-Fi giống nhau** với máy phát triển của bạn.

   a. Tìm IP cục bộ của máy của bạn:
   ```bash
   # Windows
   ipconfig    # Tìm "IPv4 Address" dưới bộ điều hợp Wi-Fi của bạn (ví dụ: 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # hoặc: ip addr show
   ```

   b. Cập nhật hương vị xây dựng cục bộ để sử dụng IP của bạn thay vì `10.0.2.2`. Trong `app/build.gradle.kts`, tìm hương vị `local` và thay đổi:
   ```kotlin
   // Thay thế 10.0.2.2 bằng IP cục bộ của máy của bạn
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. Kết nối thiết bị của bạn qua USB và bật gỡ lỗi USB, sau đó:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. Ngoài ra, sử dụng **adb reverse** để tránh thay đổi bất kỳ mã nào (thiết bị định tuyến localhost đến máy của bạn):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Bộ giả lập Firestore
   adb reverse tcp:9099 tcp:9099   # Bộ giả lập Auth
   adb reverse tcp:9000 tcp:9000   # Bộ giả lập RTDB
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (lưu trữ hình ảnh)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   Với `adb reverse`, địa chỉ `10.0.2.2` mặc định trong hương vị cục bộ cũng sẽ hoạt động trên thiết bị vật lý -- không cần thay đổi cấu hình xây dựng.

5. **Dừng các dịch vụ cục bộ**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   Hoặc nhấn `Ctrl+C` trong terminal tập lệnh khởi động. Dữ liệu bộ giả lập được lưu tự động và khôi phục khi khởi động lại.

### Các URL Phát Triển Cục Bộ Hữu Ích

| Dịch Vụ | URL | Mục Đích |
|---------|-----|---------|
| Giao diện người dùng Firebase Emulator | http://localhost:4000 | Duyệt dữ liệu Firestore, người dùng Auth, RTDB |
| Express API | http://localhost:3000 | API Backend |
| Kiểm tra sức khỏe | http://localhost:3000/api/health | Xác minh API đang chạy |
| Mailpit | http://localhost:8025 | Xem email được ghi lại và mã OTP |
| Bảng điều khiển MinIO | http://localhost:9001 | Duyệt hình ảnh và tệp đã tải lên |

### Dịch Vụ Tùy Chọn

**LibreTranslate (Dịch Tin Nhắn)**

Hình ảnh Docker tùy chọn 6GB+ để kiểm tra tính năng dịch cục bộ:
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
Không được đưa vào thiết lập mặc định do kích thước hình ảnh lớn. Dịch hoạt động mà không có nó -- tin nhắn chỉ cần giữ nguyên không được dịch.

### Phát Triển Đám Mây (Tùy Chọn)

Nếu bạn cần kiểm tra đối với các dịch vụ đám mây thực tế (ví dụ: thông báo đẩy thực tế, Đăng Nhập Google thực tế):

1. **Thiết lập Firebase**
   - Tạo dự án Firebase tại [console.firebase.google.com](https://console.firebase.google.com)
   - Bật **Đăng Nhập Google** và **Đăng Nhập Apple** trong Xác Thực
   - Bật **Firestore**, **Cơ Sở Dữ Liệu Thời Gian Thực** và **Nhắn Tin Đám Mây**
   - Tải xuống `google-services.json` và đặt nó vào `app/src/dev/`

2. **Thiết lập Express API**
   ```bash
   cd express-api
   cp .env.example .env  # Chỉnh sửa bằng thông tin đăng nhập đám mây của bạn
   npm install
   npm start
   ```

3. **Triển khai quy tắc Firestore**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Xây dựng ứng dụng Android** (hương vị dev)
   ```bash
   ./gradlew assembleDevDebug
   ```

### Biến Môi Trường

| Biến | Mô Tả | Nơi |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON tài khoản dịch vụ Firebase Admin SDK | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 ID tài khoản | Express API |
| `R2_ACCESS_KEY_ID` | Khóa truy cập R2 | Express API |
| `R2_SECRET_ACCESS_KEY` | Khóa bí mật R2 | Express API |
| `R2_BUCKET_NAME` | Tên xô R2 (mặc định: `shytalk-media`) | Express API |
| `LIVEKIT_KEY_ASIA` | Khóa API LiveKit (Châu Á/Singapore) | Express API |
| `LIVEKIT_SECRET_ASIA` | Bí mật API LiveKit (Châu Á/Singapore) | Express API |
| `LIVEKIT_URL_ASIA` | URL máy chủ LiveKit (Châu Á) — `wss://livekit.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_KEY_EU` | Khóa API LiveKit (EU/London) | Express API |
| `LIVEKIT_SECRET_EU` | Bí mật API LiveKit (EU/London) | Express API |
| `LIVEKIT_URL_EU` | URL máy chủ LiveKit (EU) — `wss://livekit-eu.shytalk.shyden.co.uk` | Express API |
| `LIVEKIT_API_KEY` | Khóa API LiveKit (dự phòng khi khóa theo vùng chưa được đặt) | Express API |
| `LIVEKIT_API_SECRET` | Bí mật API LiveKit (dự phòng khi khóa theo vùng chưa được đặt) | Express API |
| `LIVEKIT_URL` | URL máy chủ LiveKit (được nhúng vào ứng dụng Android lúc build) | Ứng dụng Android (BuildConfig) |
| `WORKER_URL` | URL cơ sở Express API | Ứng dụng Android (BuildConfig) |

## Kiểm Tra

### Chạy Kiểm Tra Cục Bộ

```bash
# Menu kiểm tra tương tác (chọn cái gì để chạy):
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# Hoặc chạy các bộ riêng lẻ:
bash local/test-unit.sh       # Kiểm tra đơn vị Kotlin + Express API
bash local/test-playwright.sh # Kiểm tra web Playwright (cần môi trường cục bộ)
bash local/test-e2e.sh        # Kiểm tra E2E Android (cần môi trường cục bộ + thiết bị)
bash local/test-lint.sh       # ktlint + ESLint

# Xem báo cáo kiểm tra Allure:
npx allure serve allure-results
```

### Bộ Kiểm Tra

| Bộ | Lệnh | Số Lượng |
|-------|---------|-------|
| Kiểm tra đơn vị Kotlin | `./gradlew test` | Hơn 100 bài kiểm tra |
| Kiểm tra Express API | `cd express-api && npm test` | Hơn 1.540 bài kiểm tra |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 tệp tính năng |
| Kiểm tra web Playwright | `npx playwright test` | 28 spec |

```bash
# Kiểm tra đơn vị Kotlin/KMP
./gradlew test

# Kiểm tra Express API
cd express-api && npm test

# Kiểm tra E2E (yêu cầu thiết bị được kết nối hoặc bộ giả lập)
./gradlew connectedDevDebugAndroidTest

# Kiểm tra trình duyệt Playwright (yêu cầu bảng điều khiển quản trị chạy)
npx playwright test
```

### Kiểm Tra trong CI

Trong CI, kiểm tra Playwright và Android E2E chạy dựa trên cùng một môi trường cục bộ (bộ giả lập + Docker) -- không sử dụng dịch vụ đám mây. Điều này đảm bảo kiểm tra không bao giờ can thiệp vào những người kiểm tra trực tiếp.

## Khắc Phục Sự Cố

- **Cổng đã được sử dụng**: `lsof -i :<port>` (Linux/macOS) hoặc `netstat -ano | findstr :<port>` (Windows) để tìm cái gì đang sử dụng cổng.
- **Docker không chạy**: Đảm bảo Docker Desktop được khởi động. Chạy `docker ps` để xác minh.
- **Bộ giả lập Firebase không khởi động**: Yêu cầu Java 21+. Kiểm tra với `java -version`.
- **Bản dựng Android không thành công**: Đảm bảo JDK 21+ và Android SDK được cài đặt. Thử `./gradlew clean`.
- **Thiết bị adb không được phát hiện**: Bật gỡ lỗi USB. Chạy `adb devices` để kiểm tra.
- **Hình ảnh không tải**: Xô MinIO có thể không được tạo. Chạy `cd express-api && NODE_ENV=local node ../local/seed.js`. Đối với thiết bị vật lý, hãy chạy `adb reverse tcp:9002 tcp:9002`.
- **OTP không đến**: Kiểm tra đầu ra bảng điều khiển cho các dòng `[OTP-LOCAL]`. Cũng kiểm tra Giao diện Mailpit tại http://localhost:8025.
- **Đặt lại dữ liệu bộ giả lập**: Xóa thư mục `local/firebase-emulator-data/` và khởi động lại.
- **Đặt lại dữ liệu MinIO**: Chạy `docker compose -f local/docker-compose.yml down -v` để xóa các tập.

## Triển Khai

Các triển khai được quản lý thông qua các quy trình làm việc GitHub Actions (`.github/workflows/`):

| Quy Trình Làm Việc | Kích Hoạt | Chức Năng |
|----------|---------|-------------|
| **Kiểm Tra PR** | Tự động trên PR để `main` | Chạy lint, kiểm tra Kotlin, kiểm tra Express API, kiểm tra Playwright (dựa trên các tệp đã thay đổi) |
| **Triển Khai Để Dev** | Thủ công (`workflow_dispatch`) | Triển khai Express API + web để phát triển, phân phối APK cho người kiểm tra, tùy chọn chạy kiểm tra Playwright |
| **Triển Khai Để Prod** | Thủ công (`workflow_dispatch`) | Triển khai bản phát hành được gắn thẻ để sản xuất -- Express API, web, Play Store và App Store |

Quy trình làm việc bổ sung: **Kiểm Tra E2E** (ma trận bộ giả lập Android), **SonarCloud** (phân tích tĩnh), **Lint**, **Kiểm Tra Backend**, **Tự Động Hợp Nhất Dependabot**.

- **Express API:** Triển khai trên máy ảo Oracle Cloud thông qua SSH + PM2 (dev: London, prod: Singapore)
- **Android:** Được lập gói và tải lên Google Play thông qua CI
- **iOS:** Được xây dựng và tải lên App Store Connect / TestFlight thông qua CI
- **Bảng điều khiển quản trị / web:** Triển khai trên Cloudflare Pages

## Đóng Góp

Sự đóng góp được chào đón! Vui lòng xem [CONTRIBUTING.md](CONTRIBUTING.md) để biết hướng dẫn.

## Giấy Phép

Dự án này được cấp phép theo Giấy Phép Apache 2.0. Xem [LICENSE](LICENSE) để biết chi tiết.

## Lời Cảm Ơn

- [Firebase](https://firebase.google.com) -- Xác Thực, Firestore, Cơ Sở Dữ Liệu Thời Gian Thực, Nhắn Tin Đám Mây
- [LiveKit](https://livekit.io) -- Giao Tiếp Thoại Thời Gian Thực
- [Cloudflare](https://www.cloudflare.com) -- Lưu Trữ R2, Trang Lưu Trữ, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Máy Ảo Tầng Miễn Phí Cho Express API
- [Express.js](https://expressjs.com) -- Khung Công Việc Máy Chủ API
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- Giao Diện Người Dùng Khai Báo Hiện Đại
- [Koin](https://insert-koin.io) -- Tiêm Phụ Thuộc Nhẹ
- [Coil](https://coil-kt.github.io/coil/) -- Tải Hình Ảnh Cho Kotlin Multiplatform
- [Lottie](https://airbnb.design/lottie/) -- Hiệu Ứng Quà Tặng Và Giao Diện Người Dùng Động Hình
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- Ngày/Giờ Multiplatform
