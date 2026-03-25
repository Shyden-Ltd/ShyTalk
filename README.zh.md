# ShyTalk

**语音聊天室，全新体验。**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | **中文**

## 关于

ShyTalk 是一款社交语音聊天应用，用户可以创建并加入实时语音聊天室。基于 Kotlin Multiplatform（KMP）构建，通过共享代码库同时面向 Android 和 iOS 平台。无论您想主持对话、倾听他人，还是与世界各地的人建立联系，ShyTalk 都能轻松实现。

iOS 是受支持的平台，但本指南侧重于 Android 开发，这是主要的开发目标。

## 功能特性

### 语音聊天室
- 创建或加入由 LiveKit 驱动的实时语音房间
- 结构化座位系统，设有房主、主持人和听众角色
- 座位申请与邀请 -- 申请上麦或邀请听众发言
- 悬浮聊天头像 -- 在浏览应用其他部分时继续语音聊天
- 房间过期 -- 房主离开时房间自动关闭，并显示倒计时

### 消息通讯
- 每个房间内与语音同步的实时文字聊天
- 一对一私信功能
- 支持成员管理和权限设置的群聊
- 实时输入状态提示
- 贴纸支持

### 社交互动
- 可自定义用户资料，包含照片、封面图、国籍旗帜和个人简介
- 关注系统 -- 关注其他用户并查看其在线状态
- 礼物墙 -- 展示收到的来自其他用户的礼物
- 拉黑系统 -- 在房间和个人资料中屏蔽用户

### 虚拟经济
- 基于金币的经济体系，含钱包和交易记录
- 每日登录奖励与连续登录加成
- 幸运转盘（扭蛋）系统，含分级奖品
- 虚拟礼物 -- 在语音聊天中发送和接收动态礼物
- 背包库存用于存储礼物
- 金币礼包供购买金币
- 带动态礼物特效的广播横幅

### 账户与身份
- 多渠道认证 -- 支持 Google、Apple 或邮箱（OTP）登录
- 将多个登录方式关联到同一账户
- 稳定的用户身份（uniqueId），跨 Firebase 项目持久保留
- 设置中的关联账户管理，支持关联/取消关联
- 设备绑定 -- 每台设备永久绑定至一个账户

### 内容管理与安全
- 管理工具 -- 房主可禁言、踢人、移动座位及管理主持人
- 用户举报系统与审核流程
- 针对违规行为的警告与封禁系统
- 社区规范、隐私政策和服务条款页面
- 新用户法律条款接受流程
- 强制更新旧版本应用

### 启动页面
- 应用启动时显示的可配置启动屏幕
- 管理员管理的内容，支持排期和定向推送

### 安全防护
- PIN 码保护应用访问
- 生物特征认证 -- 指纹和面部识别
- 敏感操作的 OTP（一次性密码）验证

### 管理后台
- 项目静态网站上基于 Web 的内容管理仪表盘
- 用户管理、内容审核与配置
- 模板和礼物管理，支持实时预览
- 实时日志流与告警

### 图片压缩
- 通过 Express API 在上传时自动压缩图片
- 在保持质量的同时降低存储和带宽成本

### 国际化
- 开箱即用支持 19 种语言
- 所有用户可见字符串的完整本地化

### 日志与监控
- 覆盖 Express API、移动应用和管理后台的结构化日志
- 管理仪表盘中的实时日志流
- 设备和网络封禁，自动执行
- 针对严重错误和异常的告警系统
- 端到端请求追踪的 Trace ID 传播

## 技术栈

| 层级 | 技术 |
|-------|-----------|
| **框架** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **架构** | MVVM + Repository Pattern |
| **依赖注入** | Koin |
| **认证** | Firebase Authentication（Google、Apple、Email+OTP），含多渠道身份系统 |
| **数据库** | Cloud Firestore |
| **实时通信** | Firebase Realtime Database |
| **存储** | Cloudflare R2（通过 Express API 代理） |
| **API 服务器** | Express.js（部署于 Oracle Cloud 免费层） |
| **语音** | LiveKit |
| **推送通知** | Firebase Cloud Messaging |
| **图片加载** | Coil 3 (KMP) |
| **动画** | Lottie Compose |
| **日期/时间** | kotlinx-datetime |
| **导航** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## 架构

ShyTalk 遵循 **MVVM** 架构与清晰的**仓库模式**：

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

- **shared 模块**（`commonMain`）-- 跨平台共享的模型、仓库接口、ViewModel 和 UI
- **app 模块** -- Android 专属页面、仓库实现及入口点
- **iosApp 模块** -- iOS 专属入口点
- **express-api** -- 运行在 Oracle Cloud 免费层的 Express.js 后端

## 项目结构

```
ShyTalk/
+-- app/                              # Android 应用模块
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # 应用入口点
|       |   +-- MainActivity.kt       # 主 Activity
|       |   +-- core/
|       |   |   +-- di/               # Koin DI 模块
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit voice, presence, notifications
|       |   |   +-- repository/       # 仓库实现
|       |   +-- feature/
|       |   |   +-- auth/             # Google 登录页面
|       |   |   +-- profile/          # 个人资料页面
|       |   |   +-- room/             # 房间页面
|       |   |   +-- settings/         # 应用设置
|       |   +-- navigation/           # NavGraph & Screen routes
|       +-- test/                     # 单元测试
|       +-- androidTest/              # E2E 测试（Compose UI Test）
+-- shared/                           # KMP 共享模块
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # 共享 Koin 模块
|       |   +-- model/                # 数据模型（User、ChatRoom、Gift 等）
|       |   +-- ui/                   # 共享组件
|       |   +-- util/                 # 工具类与常量
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService, etc.
|       |   +-- repository/           # 仓库接口
|       +-- feature/                  # 共享功能模块
+-- iosApp/                           # iOS 应用模块
+-- express-api/                      # Express.js API 服务器
|   +-- src/
|       +-- routes/                   # API 路由处理器
|       +-- middleware/               # 认证、日志中间件
|       +-- utils/                    # Firebase Admin, R2, logger
|       +-- cron/                     # 定时任务
+-- public/                           # 静态网站与管理后台
+-- local/                            # 本地开发环境（模拟器、种子数据）
+-- tests/web/                        # Playwright 浏览器测试
+-- scripts/                          # 工具脚本
+-- .github/workflows/                # CI/CD（PR 检查、发布至 Dev/Prod、E2E、lint）
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
- **Docker**（用于 LiveKit 语音服务器、MinIO 存储、Mailpit 邮件）
- **Firebase CLI**（`npm install -g firebase-tools`）

开始前无需任何云账户 -- 本地环境完全离线运行。

### 本地开发（推荐）

最快的上手方式。一条命令启动所有服务 -- Firebase 模拟器、Docker 容器、Express API，并构建 Android 应用。无需云账户，无费用，无配额限制。

1. **克隆并安装**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **启动所有服务**

   **Linux / macOS / Git Bash：**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell：**
   ```powershell
   .\local\start.ps1
   ```

   该命令将：
   - 启动 Docker 容器（LiveKit 语音服务器、MinIO 存储、Mailpit 邮件）
   - 启动 Firebase 模拟器（Firestore、Auth、RTDB）
   - 填充测试数据并创建 MinIO 存储桶
   - 启动 Express API
   - 构建并安装 Android 应用（如已连接设备）

   就绪后，您将看到：
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

3. **登录**
   - 使用预填充的测试账户通过邮箱登录：`claude-test@shytalk.dev` / `localdev123`
   - 或创建新账户 -- 将使用本地模拟器
   - Google/Apple 登录在本地不可用（无真实 OAuth） -- 请改用邮箱 OTP
   - OTP 验证码由 Mailpit 捕获 -- 查看 http://localhost:8025

4. **在实体设备上运行**

   您的手机必须与开发机器处于**同一 Wi-Fi 网络**。

   a. 查找您机器的本地 IP：
   ```bash
   # Windows
   ipconfig    # 在 Wi-Fi 适配器下查找"IPv4 地址"（如 192.168.1.42）

   # macOS / Linux
   ifconfig | grep "inet "    # 或：ip addr show
   ```

   b. 更新本地构建 flavor 以使用您的 IP 替代 `10.0.2.2`。在 `app/build.gradle.kts` 中，找到 `local` flavor 并修改：
   ```kotlin
   // 将 10.0.2.2 替换为您机器的本地 IP
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. 通过 USB 连接设备并启用 USB 调试，然后：
   ```bash
   ./gradlew installLocalDebug
   ```

   d. 或者，使用 **adb reverse** 避免修改任何代码（设备将 localhost 路由到您的机器）：
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore emulator
   adb reverse tcp:9099 tcp:9099   # Auth emulator
   adb reverse tcp:9000 tcp:9000   # RTDB emulator
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO (image storage)
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   使用 `adb reverse` 后，local flavor 中默认的 `10.0.2.2` 地址在实体设备上同样有效 -- 无需修改构建配置。

5. **停止本地服务**

   **Linux / macOS / Git Bash：**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell：**
   ```powershell
   .\local\stop.ps1
   ```

   或在启动脚本终端按 `Ctrl+C`。模拟器数据自动保存，下次启动时恢复。

### 常用本地开发 URL

| 服务 | URL | 用途 |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | 浏览 Firestore 数据、Auth 用户、RTDB |
| Express API | http://localhost:3000 | 后端 API |
| 健康检查 | http://localhost:3000/api/health | 验证 API 是否运行 |
| Mailpit | http://localhost:8025 | 查看捕获的邮件和 OTP 验证码 |
| MinIO Console | http://localhost:9001 | 浏览上传的图片和文件 |

### 可选服务

**LibreTranslate（消息翻译）**

用于在本地测试翻译功能的可选 6GB+ Docker 镜像：
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
由于镜像体积较大，默认配置中未包含。不安装也可正常使用翻译功能 -- 消息仅保持原文不翻译。

### 云端开发（可选）

如需对接真实云服务（如真实推送通知、真实 Google 登录）：

1. **Firebase 设置**
   - 在 [console.firebase.google.com](https://console.firebase.google.com) 创建 Firebase 项目
   - 在 Authentication 中启用 **Google 登录** 和 **Apple 登录**
   - 启用 **Firestore**、**Realtime Database** 和 **Cloud Messaging**
   - 下载 `google-services.json` 并放置于 `app/src/dev/`

2. **Express API 设置**
   ```bash
   cd express-api
   cp .env.example .env  # 编辑并填入您的云端凭据
   npm install
   npm start
   ```

3. **部署 Firestore 规则**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **构建 Android 应用**（dev flavor）
   ```bash
   ./gradlew assembleDevDebug
   ```

### 环境变量

| 变量 | 描述 | 位置 |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK 服务账户 JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 账户 ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 访问密钥 | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 密钥 | Express API |
| `R2_BUCKET_NAME` | R2 存储桶名称（默认：`shytalk-media`） | Express API |
| `LIVEKIT_API_KEY` | LiveKit API 密钥 | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API 密钥 | Express API |
| `LIVEKIT_URL` | LiveKit 服务器 URL | Android 应用（BuildConfig） |
| `WORKER_URL` | Express API 基础 URL | Android 应用（BuildConfig） |

## 测试

### 在本地运行测试

```bash
# 交互式测试菜单（选择要运行的内容）：
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# 或运行单独的测试套件：
bash local/test-unit.sh       # Kotlin + Express API 单元测试
bash local/test-playwright.sh # Playwright 网页测试（需要本地环境）
bash local/test-e2e.sh        # Android E2E 测试（需要本地环境 + 设备）
bash local/test-lint.sh       # ktlint + ESLint

# 查看 Allure 测试报告：
npx allure serve allure-results
```

### 测试套件

| 套件 | 命令 | 数量 |
|-------|---------|-------|
| Kotlin 单元测试 | `./gradlew test` | 100+ 个测试 |
| Express API 测试 | `cd express-api && npm test` | 1,540+ 个测试 |
| E2E Gherkin（Android） | `./gradlew connectedDevDebugAndroidTest` | 34 个 feature 文件 |
| Playwright 网页测试 | `npx playwright test` | 28 个规格 |

```bash
# Kotlin/KMP 单元测试
./gradlew test

# Express API 测试
cd express-api && npm test

# E2E 测试（需要已连接的设备或模拟器）
./gradlew connectedDevDebugAndroidTest

# Playwright 浏览器测试（需要管理后台运行）
npx playwright test
```

### CI 中的测试

在 CI 中，Playwright 和 Android E2E 测试针对相同的本地环境（模拟器 + Docker）运行 -- 不使用任何云服务。这确保测试永远不会干扰线上用户。

## 故障排除

- **端口已被占用**：使用 `lsof -i :<port>`（Linux/macOS）或 `netstat -ano | findstr :<port>`（Windows）查找占用端口的程序。
- **Docker 未运行**：确保 Docker Desktop 已启动。运行 `docker ps` 验证。
- **Firebase 模拟器启动失败**：需要 Java 11+。使用 `java -version` 检查。
- **Android 构建失败**：确保已安装 JDK 17+ 和 Android SDK。尝试 `./gradlew clean`。
- **未检测到 adb 设备**：启用 USB 调试。运行 `adb devices` 检查。
- **图片无法加载**：MinIO 存储桶可能未创建。运行 `cd express-api && NODE_ENV=local node ../local/seed.js`。实体设备请运行 `adb reverse tcp:9002 tcp:9002`。
- **OTP 未收到**：检查控制台输出中的 `[OTP-LOCAL]` 行。同时检查 Mailpit UI：http://localhost:8025。
- **重置模拟器数据**：删除 `local/firebase-emulator-data/` 目录并重启。
- **重置 MinIO 数据**：运行 `docker compose -f local/docker-compose.yml down -v` 删除卷。

## 部署

部署通过 GitHub Actions 工作流（`.github/workflows/`）管理：

| 工作流 | 触发方式 | 功能描述 |
|----------|---------|-------------|
| **PR 检查** | 向 `main` 发起 PR 时自动触发 | 运行 lint、Kotlin 测试、Express API 测试、Playwright 测试（基于变更文件） |
| **发布至 Dev** | 手动（`workflow_dispatch`） | 将 Express API + 网页部署至 dev 环境，向测试人员分发 APK，可选运行 Playwright 测试 |
| **发布至 Prod** | 手动（`workflow_dispatch`） | 将标记的发布版本部署至 prod -- Express API、网页、Play Store 和 App Store |

其他工作流：**E2E 测试**（Android 模拟器矩阵）、**SonarCloud**（静态分析）、**Lint**、**后端测试**、**Dependabot 自动合并**。

- **Express API：** 通过 SSH + PM2 部署至 Oracle Cloud 虚拟机（dev：伦敦，prod：新加坡）
- **Android：** 通过 CI 打包并上传至 Google Play
- **iOS：** 通过 CI 构建并上传至 App Store Connect / TestFlight
- **管理后台 / 网页：** 部署至 Cloudflare Pages

## 贡献

欢迎贡献！请查阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解指南。

## 许可证

本项目基于 Apache License 2.0 授权。详情请参阅 [LICENSE](LICENSE)。

## 致谢

- [Firebase](https://firebase.google.com) -- 身份认证、Firestore、实时数据库、云消息推送
- [LiveKit](https://livekit.io) -- 实时语音通信
- [Cloudflare](https://www.cloudflare.com) -- R2 存储、Pages 托管、CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Express API 的免费层虚拟机
- [Express.js](https://expressjs.com) -- API 服务器框架
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- 现代声明式 UI
- [Koin](https://insert-koin.io) -- 轻量级依赖注入
- [Coil](https://coil-kt.github.io/coil/) -- Kotlin Multiplatform 图片加载
- [Lottie](https://airbnb.design/lottie/) -- 动态礼物和 UI 特效
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- 多平台日期/时间
