# ShyTalk 设备端旅程测试运行器

_这是 JOURNEY-RUNNER.md 的译文。_

`device-journey-runner.js` 驱动**已连接手机上的真实 ShyTalk 应用**完成端到端用户旅程，
并写出一份你可以阅读的**详细的通过/失败报告**——这样你只需运行一条命令、阅读一份报告，
而不必手动逐步点按。

它是一个**混合式**运行器。每个旅程可以同时在三个层面进行断言：

1. **UI** —— 通过 `adb` + `uiautomator` 点按/检查正在运行的应用（Compose 的
   `testTag` 会在转储中显示为 `resource-id`；对话框按其可见文本匹配）。
2. **Firestore** —— 直接读取本地模拟器（通过 `firebase-admin`），以确认每个操作背后的
   数据库状态。
3. **服务器 / API** —— 以每个 persona 的身份登录（来自 Auth 模拟器的真实 Firebase ID
   令牌）并调用 `express-api`，从而验证**服务器强制执行的规则**（OSA cohort 关卡、管理员
   覆盖、审核）——这些仅凭 UI 是*看不到*的。

> 本指南的译文位于 `journey-runner-locales/`（20 种语言）。

---

## 1. 前置条件

| 你需要                      | 如何                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 运行中的 **Docker Desktop** | 用于 Firebase 模拟器 + LiveKit/MinIO                                                                                                |
| **本地栈已启动**            | `bash local/start.sh`（从仓库根目录）—— 启动 Firebase 模拟器 + express-api。让它保持运行。                                          |
| **已植入 personas**         | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js`（幂等；以密码 `localdev123` 植入 P‑02…P‑19 测试阵容） |
| **一部已连接的手机**        | `adb devices` 必须列出一部（USB 数据线**或**无线 `adb`）。Android 模拟器也可以。                                                    |
| **Java 21+ 及 Android SDK** | 仅首次需要，以便在缺少 APK 时运行器能构建应用                                                                                       |

如果 `local` 调试 APK 尚未构建，运行器会自行构建它。

---

## 2. 运行它

从仓库根目录：

```sh
# Run the whole suite against the local stack
node express-api/scripts/device-journey-runner.js

# See the list of journeys without running anything
node express-api/scripts/device-journey-runner.js --list

# Run only specific journeys
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# Force a fresh APK build first
node express-api/scripts/device-journey-runner.js --rebuild

# Full option list
node express-api/scripts/device-journey-runner.js --help
```

选项：`--target local|dev`（默认 `local`）· `--serial <adb-serial>`（默认：自动选择）·
`--journeys <ids>` · `--rebuild` · `--no-reset`（跳过 smoke 旅程中的全新重装）·
`--out <dir>` · `--list` · `--help`。

运行器为每条命令固定**一个** adb 序列号，因此即使一部手机出现两次（USB + 无线）它也能正常工作。
对于 `local` 目标，它会设置 `adb reverse` 隧道，使设备上的应用能够访问你机器上的栈。

---

## 3. 查看结果

完成后，它会打印一份摘要，并在 `journey-results/` 下写入：

| 文件                            | 内容                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **阅读此文件** —— 按旅程、按步骤的 ✅/❌ 及其原因、屏幕上的 testTag，以及每个步骤的截图链接 |
| `latest-report.json`            | 相同数据，机器可读                                                                          |
| `runs/<runId>/*.png`            | 每个步骤的一张截图（通过*和*失败的都有）                                                    |
| `runs/<runId>/report.{md,json}` | 该次特定运行的归档报告                                                                      |

当所有旅程都通过时退出码为 `0`，当有任何旅程失败时为 `1`。失败时，该步骤会准确记录屏幕上的内容，
因此你无需重新操作手机即可看到失败的*原因*。

---

## 4. 旅程涵盖的内容

运行 `--list` 查看实时集合。总体而言，该套件涵盖：

- **Smoke** —— 全新安装 → 法律条款接受 → 登录，后端可达。
- **Cohort 登录** —— 成人 / 未成年 / 管理员 personas 通过应用内开发者 persona 选择器登录；
  身份会对照调试覆盖层和 Firestore 的 `cohort` 字段进行确认。
- **OSA cohort 关卡** —— 未成年人无法关注或查看成人（服务器返回 `404`，且 Firestore 写入
  从不发生），而同一 cohort 内的操作则成功——证明该关卡是按 cohort 区分的，而非一刀切的封锁。
- **管理员** —— cohort 覆盖仅限员工（普通成员会被以 `422` 拒绝；员工账户成功并写入一条监管
  审计记录）。
- **审核** —— 举报 → 管理员封禁（+ 审计）→ 申诉 → 解封，完全由服务器强制执行，并具备幂等清理。

旅程中的身份验证始终使用**应用内开发者 persona 选择器**——绝不使用真实的 Google/Apple 登录。

> **关于旅程规范的说明。** `journey-tests/j01-j19` 中的 Gherkin 计划部分是
> _理想化的_：它们引用了已发布应用并不具备的 UI（例如电子邮件/密码注册页面、隐藏的未成年标签页、
> 一个发现页面）。因此运行器将每个旅程的真实意图对照**实际**应用 + Firestore + API 进行映射，
> 并将此类偏差记录为发现项，而不是因虚构内容而失败。

---

## 5. 故障排查

| 症状                                            | 修复                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `No adb device found`                           | 插入 / 配对手机；检查 `adb devices`。                                              |
| 卡在到达 SignIn / "backend NOT reachable"       | 本地栈未启动，或 `adb reverse` 隧道未设置——重启 `bash local/start.sh` 并重新运行。 |
| `persona "<email>" not found in picker`         | personas 未植入——运行 §1 中的植入命令。                                            |
| 缺少 `Firestore assertions: ON` / DB 步骤被跳过 | DB 断言仅对 `--target local` 运行。                                                |
| APK 构建失败                                    | 打开打印出的 `gradle-build.log`；确保已安装 Java 21+ 和 Android SDK。              |
| 某个步骤在你意料之外的屏幕上失败                | 打开 `latest-report.md` 中为该步骤命名的截图。                                     |

---

## 6. 添加一个旅程

旅程是带有 `run(device, reporter, ctx)` 方法的普通对象，由共享的辅助函数组合而成：

- `signInAs(device, reporter, ctx, email, nameToken)` —— 通过选择器以某个 persona 登录，
  并穿过首次启动的插页直至 Home。
- UI：`tapId` / `waitForId` / `waitForText` / `selectPersonaByText` / `tapLowestText`，
  以及 `dump(device)` + `byId` / `byText` / `byTextContains`。
- Firestore：`dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`。
- 服务器：`getIdToken(email)` → 某个 persona 的 ID 令牌，然后
  `apiCall(method, path, { token, body })`。

将每个断言包裹在 `reporter.step(device, 'name', async () => { … })` 中——它会为该步骤计时、
截图、记录通过/失败，并在失败时捕获屏幕上的 testTag。将新对象添加到 `buildJourneys` 中的
`all` 数组里。

纯逻辑（解析、选择器、参数处理）在 `tests/scripts/device-journey-runner.test.js` 中进行单元测试
（`cd express-api && npm test`）；设备/Firestore/API 层则通过在真实设备上运行该套件来进行集成测试。
