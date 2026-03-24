# ShyTalk

**语音聊天室，全新体验。**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | **中文**

## 关于

ShyTalk 是一款社交语音聊天应用，用户可以创建和加入实时语音聊天室。基于 Kotlin Multiplatform（KMP）构建，同时支持 Android 和 iOS 平台，共享同一套代码。无论你想主持一场对话、旁听讨论，还是与世界各地的人建立联系，ShyTalk 都能让这一切变得轻松简单。

## 功能特性

### 语音聊天室
- 基于 LiveKit 技术，创建或加入实时语音房间
- 结构化的座位系统，支持房主、主持人和听众等角色
- 上座申请与邀请——申请上座发言或邀请听众参与
- 悬浮窗——在浏览应用其他部分时继续语音聊天
- 房间过期机制——房主离开后自动关闭房间，带有倒计时提示

### 消息系统
- 在每个房间中同步进行文字聊天
- 一对一私信功能
- 群聊功能，支持成员管理与权限设置
- 实时输入状态提示
- 表情贴纸支持

### 社交功能
- 自定义用户资料，包括头像、封面图片、国旗标识和个人简介
- 关注系统——关注其他用户，查看其在线状态
- 礼物墙——展示收到的礼物
- 拉黑系统——在房间和个人资料页面屏蔽用户

### 虚拟经济
- 基于金币的经济系统，含钱包和交易记录
- 每日登录奖励，连续登录有额外加成
- 幸运转盘（抽奖）系统，设有多个奖品等级
- 虚拟礼物——在语音聊天中发送和接收动画礼物
- 背包系统，用于存放礼物
- 金币商城，可购买金币套餐
- 广播横幅，附带动画礼物特效

### 账户与身份
- 多提供商认证——支持 Google、Apple 或邮箱（OTP）登录
- 将多种登录方式关联到同一账户
- 稳定的用户身份（uniqueId），跨 Firebase 项目持久化
- 设置中的关联账户管理，支持关联/取消关联操作
- 设备绑定——每台设备永久绑定到一个账户

### 管理与安全
- 管理工具——作为房主可以禁言、踢出、调换座位和管理主持人
- 用户举报系统及审核流程
- 警告与封禁机制
- 社区准则、隐私政策和服务条款页面
- 新用户法律条款确认流程
- 强制更新机制，确保用户使用最新版本

### 启动页面
- 可配置的应用启动画面
- 管理员管理内容，支持定时和定向投放

### 安全性
- PIN 码保护应用访问
- 生物识别认证——指纹和面部识别
- 一次性密码（OTP）验证敏感操作

### 管理面板
- 基于 Web 的管理后台，部署在项目静态站点
- 用户管理、内容审核和配置
- 模板和礼物管理，支持实时预览
- 实时日志流和告警

### 图片压缩
- 通过 Express API 上传时自动压缩图片
- 降低存储和带宽成本，同时保持画质

### 国际化
- 开箱即用支持 19 种语言
- 所有面向用户的字符串完全本地化

### 日志与监控
- 横跨 Express API、移动应用和管理面板的结构化日志
- 管理后台支持实时日志流
- 设备和网络封禁，支持自动执行
- 关键错误和异常的告警系统
- Trace ID 传播，实现端到端的请求追踪

## 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **架构** | MVVM + Repository 模式 |
| **依赖注入** | Koin |
| **认证** | Firebase Authentication（Google、Apple、邮箱+OTP）多提供商身份系统 |
| **数据库** | Cloud Firestore |
| **实时通信** | Firebase Realtime Database |
| **存储** | Cloudflare R2（通过 Express API 代理） |
| **API 服务器** | Express.js（Oracle Cloud 免费层） |
| **语音** | LiveKit |
| **推送通知** | Firebase Cloud Messaging |
| **图片加载** | Coil 3 (KMP) |
| **动画** | Lottie Compose |
| **日期/时间** | kotlinx-datetime |
| **导航** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## 架构

ShyTalk 遵循 **MVVM** 架构，采用清晰的 **Repository 模式**：

```
+---------------------------------------------+
|                   UI 层                      |
|  Compose 界面 -> ViewModels -> UI 状态        |
+---------------------------------------------+
|                  领域层                       |
|            Repository 接口                    |
+---------------------------------------------+
|                  数据层                       |
|  Repository 实现 -> Firestore / R2 / RTDB / LiveKit  |
+---------------------------------------------+
```

- **shared 模块**（`commonMain`）——跨平台共享的模型、Repository 接口、ViewModel 和 UI
- **app 模块**——Android 特定的界面、Repository 实现和入口
- **iosApp 模块**——iOS 特定的入口
- **express-api**——运行在 Oracle Cloud 免费层上的 Express.js 后端

## 项目结构

```
ShyTalk/
+-- app/                              # Android 应用模块
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # 应用入口
|       |   +-- MainActivity.kt       # 主 Activity
|       |   +-- core/
|       |   |   +-- di/               # Koin 依赖注入模块
|       |   |   +-- room/             # ActiveRoomManager 和 RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit 语音、在线状态、通知
|       |   |   +-- repository/       # Repository 实现
|       |   +-- feature/
|       |   |   +-- auth/             # Google 登录界面
|       |   |   +-- profile/          # 个人资料界面
|       |   |   +-- room/             # 房间界面
|       |   |   +-- settings/         # 应用设置
|       |   +-- navigation/           # 导航图和路由
|       +-- test/                     # 单元测试
|       +-- androidTest/              # 端到端测试（Compose UI Test）
+-- shared/                           # KMP 共享模块
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # 共享 Koin 模块
|       |   +-- model/                # 数据模型（User、ChatRoom、Gift 等）
|       |   +-- ui/                   # 共享组件
|       |   +-- util/                 # 工具类和常量
|       +-- data/
|       |   +-- remote/               # VoiceService、TokenService 等
|       |   +-- repository/           # Repository 接口
|       +-- feature/                  # 共享功能模块
+-- iosApp/                           # iOS 应用模块
+-- express-api/                      # Express.js API 服务器
|   +-- src/
|       +-- routes/                   # API 路由处理
|       +-- middleware/               # 认证、日志中间件
|       +-- utils/                    # Firebase Admin、R2、日志工具
|       +-- cron/                     # 定时任务
+-- public/                           # 静态网站和管理面板
+-- local/                            # 本地开发环境（模拟器、种子数据）
+-- tests/web/                        # Playwright 浏览器测试
+-- scripts/                          # 工具脚本
+-- .github/workflows/                # CI/CD（PR 检查、部署到 Dev/Prod、E2E、代码检查）
+-- firestore.rules                   # Firestore 安全规则
+-- database.rules.json               # RTDB 安全规则
+-- firestore.indexes.json            # Firestore 复合索引
+-- firebase.json                     # Firebase 配置
```

## 快速开始

### 前置条件

- **Android Studio** Ladybug 或更新版本
- **JDK 17+**
- **Node.js 24+**
- **Docker**（用于本地 LiveKit 服务器）
- **Firebase CLI**（`npm install -g firebase-tools`）

### 本地开发（推荐）

最快的入门方式。使用 Firebase 模拟器和本地 LiveKit Docker 容器——无需云账号，零成本，无配额限制。

1. **克隆并安装**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **启动本地服务**

   **Linux / macOS / Git Bash：**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell：**
   ```powershell
   .\local\start.ps1
   ```

   这将启动 Firebase 模拟器（Firestore、Auth、RTDB）和 LiveKit Docker 容器。首次运行时会自动填充测试数据（管理员账户、示例礼物、配置）。

   你将看到：
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **启动 Express API**（在新终端窗口中）
   ```bash
   cd express-api
   cp .env.local.example .env.local   # 按需编辑 R2/SMTP 值
   npm run local
   ```
   API 将在 `http://localhost:3000` 启动。测试：`curl http://localhost:3000/api/health`

4. **在 Android 模拟器上运行**
   ```bash
   ./gradlew installLocalDebug
   ```
   `local` 构建变体连接到 `10.0.2.2`（Android 模拟器的回环地址）。无需额外配置即可运行。

5. **在真机上运行**

   你的手机必须与开发机在**同一个 Wi-Fi 网络**上。

   a. 查找你的机器本地 IP：
   ```bash
   # Windows
   ipconfig    # 查找 Wi-Fi 适配器下的 "IPv4 Address"（例如 192.168.1.42）

   # macOS / Linux
   ifconfig | grep "inet "    # 或：ip addr show
   ```

   b. 更新本地构建变体以使用你的 IP 替代 `10.0.2.2`。在 `app/build.gradle.kts` 中找到 `local` 变体并修改：
   ```kotlin
   // 将 10.0.2.2 替换为你的本地 IP
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. 通过 USB 连接设备并启用 USB 调试，然后：
   ```bash
   ./gradlew installLocalDebug
   ```

   d. 或者，使用 **adb reverse** 避免修改代码（设备将 localhost 路由到你的机器）：
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore 模拟器
   adb reverse tcp:9099 tcp:9099   # Auth 模拟器
   adb reverse tcp:9000 tcp:9000   # RTDB 模拟器
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   使用 `adb reverse` 后，本地变体中默认的 `10.0.2.2` 地址在真机上也能正常工作——无需修改构建配置。

6. **登录**
   - 使用邮箱登录流程和预设测试账户：`claude-test@shytalk.dev` / `localdev123`
   - 或创建新账户——将使用本地模拟器
   - Google/Apple 登录在本地不可用（无真实 OAuth）——请使用邮箱 OTP

7. **停止本地服务**

   **Linux / macOS / Git Bash：**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell：**
   ```powershell
   .\local\stop.ps1
   ```

   或在启动脚本终端中按 `Ctrl+C`。模拟器数据会自动保存，下次启动时恢复。

### 常用本地开发 URL

| 服务 | URL | 用途 |
|------|-----|------|
| Firebase Emulator UI | http://localhost:4000 | 浏览 Firestore 数据、Auth 用户、RTDB |
| Express API | http://localhost:3000 | 后端 API |
| 健康检查 | http://localhost:3000/api/health | 验证 API 是否运行 |

### 云端开发（可选）

如果你需要使用真实云服务进行测试（例如真实推送通知、真实 Google 登录）：

1. **Firebase 设置**
   - 在 [console.firebase.google.com](https://console.firebase.google.com) 创建 Firebase 项目
   - 在认证部分启用 **Google 登录** 和 **Apple 登录**
   - 启用 **Firestore**、**Realtime Database** 和 **Cloud Messaging**
   - 下载 `google-services.json` 并放置于 `app/src/dev/`

2. **Express API 设置**
   ```bash
   cd express-api
   cp .env.example .env  # 填入你的云端凭据
   npm install
   npm start
   ```

3. **部署 Firestore 规则**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **构建 Android 应用**（dev 变体）
   ```bash
   ./gradlew assembleDevDebug
   ```

### 环境变量

| 变量 | 说明 | 位置 |
|------|------|------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK 服务账号 JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 账号 ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 访问密钥 | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 密钥 | Express API |
| `R2_BUCKET_NAME` | R2 存储桶名称（默认：`shytalk-media`） | Express API |
| `LIVEKIT_API_KEY` | LiveKit API 密钥 | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API 密钥 | Express API |
| `LIVEKIT_URL` | LiveKit 服务器 URL | Android 应用（BuildConfig） |
| `WORKER_URL` | Express API 基础 URL | Android 应用（BuildConfig） |

## 测试

| 套件 | 命令 | 数量 |
|------|------|------|
| Kotlin 单元测试 | `./gradlew test` | 100+ 测试 |
| Express API 测试 | `cd express-api && npm test` | 1,540+ 测试 |
| E2E Gherkin（Android） | `./gradlew connectedDevDebugAndroidTest` | 34 个特性文件 |
| Playwright Web 测试 | `npx playwright test` | 28 个测试规范 |

```bash
# Kotlin/KMP 单元测试
./gradlew test

# Express API 测试
cd express-api && npm test

# E2E 测试（需要连接设备或模拟器）
./gradlew connectedDevDebugAndroidTest

# Playwright 浏览器测试（需要管理面板运行）
npx playwright test
```

## 部署

部署通过 GitHub Actions 工作流管理（`.github/workflows/`）：

| 工作流 | 触发方式 | 功能 |
|--------|----------|------|
| **PR Checks** | PR 到 `main` 时自动触发 | 运行代码检查、Kotlin 测试、Express API 测试、Playwright 测试（根据变更文件） |
| **Deploy to Dev** | 手动（`workflow_dispatch`） | 部署 Express API + Web 到 dev，分发 APK 给测试人员，可选运行 Playwright 测试 |
| **Deploy to Prod** | 手动（`workflow_dispatch`） | 部署标记版本到 prod——Express API、Web、Play Store 和 App Store |

其他工作流：**E2E Tests**（Android 模拟器矩阵）、**SonarCloud**（静态分析）、**Lint**、**Backend Tests**、**Dependabot Auto-merge**。

- **Express API：** 通过 SSH + PM2 部署到 Oracle Cloud 虚拟机（dev：伦敦，prod：新加坡）
- **Android：** 通过 CI 打包上传到 Google Play
- **iOS：** 通过 CI 构建上传到 App Store Connect / TestFlight
- **管理面板 / Web：** 部署到 Cloudflare Pages

## 参与贡献

欢迎贡献代码！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献指南。

## 许可证

本项目基于 Apache License 2.0 开源。详情请参阅 [LICENSE](LICENSE)。

## 致谢

- [Firebase](https://firebase.google.com) —— 认证、Firestore、Realtime Database、云消息推送
- [LiveKit](https://livekit.io) —— 实时语音通信
- [Cloudflare](https://www.cloudflare.com) —— R2 存储、Pages 托管、CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) —— 免费层虚拟机，用于 Express API
- [Express.js](https://expressjs.com) —— API 服务器框架
- [Jetpack Compose](https://developer.android.com/jetpack/compose) —— 现代声明式 UI 框架
- [Koin](https://insert-koin.io) —— 轻量级依赖注入
- [Coil](https://coil-kt.github.io/coil/) —— Kotlin Multiplatform 图片加载库
- [Lottie](https://airbnb.design/lottie/) —— 动画礼物和 UI 效果
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) —— 跨平台日期时间处理
