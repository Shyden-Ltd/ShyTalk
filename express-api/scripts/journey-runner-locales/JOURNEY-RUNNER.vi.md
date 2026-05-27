# Trình chạy kiểm thử hành trình trên thiết bị của ShyTalk

_Đây là bản dịch của JOURNEY-RUNNER.md._

`device-journey-runner.js` điều khiển **ứng dụng ShyTalk thật trên một điện thoại
đã kết nối** qua các hành trình người dùng đầu-cuối và ghi ra một **báo cáo
đạt/không đạt chi tiết** mà bạn có thể đọc — nhờ vậy bạn chạy một lệnh và đọc một
báo cáo thay vì chạm qua từng bước bằng tay.

Đây là một trình chạy **lai (hybrid)**. Mỗi hành trình có thể khẳng định trên ba
tầng cùng lúc:

1. **UI** — chạm/kiểm tra ứng dụng đang chạy qua `adb` + `uiautomator` (các
   `testTag` của Compose hiện ra dưới dạng `resource-id` trong bản kết xuất; các
   hộp thoại được khớp theo văn bản hiển thị của chúng).
2. **Firestore** — đọc trực tiếp trình giả lập cục bộ (qua `firebase-admin`) để
   xác nhận trạng thái cơ sở dữ liệu phía sau mỗi hành động.
3. **Máy chủ / API** — đăng nhập với tư cách từng persona (mã thông báo ID
   Firebase thật từ trình giả lập Auth) và gọi `express-api`, nên nó xác minh
   **các quy tắc mà máy chủ thực thi** (cổng cohort của OSA, ghi đè quản trị,
   kiểm duyệt) — những thứ _không_ hiển thị chỉ trong UI.

> Các bản dịch của hướng dẫn này nằm trong `journey-runner-locales/` (20 ngôn ngữ).

---

## 1. Điều kiện tiên quyết

| Bạn cần                       | Cách làm                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** đang chạy  | cho các trình giả lập Firebase + LiveKit/MinIO                                                                                                            |
| **Ngăn xếp cục bộ đã chạy**   | `bash local/start.sh` (từ thư mục gốc của kho) — khởi động các trình giả lập Firebase + express-api. Để nó tiếp tục chạy.                                 |
| **Đã gieo persona**           | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (lũy đẳng; gieo dàn nhân vật kiểm thử P‑02…P‑19 với mật khẩu `localdev123`) |
| **Một điện thoại đã kết nối** | `adb devices` phải liệt kê một máy (cáp USB **hoặc** `adb` không dây). Một trình giả lập Android cũng hoạt động được.                                     |
| **Java 21+ & Android SDK**    | chỉ cần ở lần đầu tiên, để trình chạy có thể dựng ứng dụng nếu thiếu APK                                                                                  |

Trình chạy tự dựng APK gỡ lỗi `local` nếu nó chưa được dựng.

---

## 2. Chạy nó

Từ thư mục gốc của kho:

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

Tùy chọn: `--target local|dev` (mặc định `local`) · `--serial <adb-serial>`
(mặc định: tự động chọn) · `--journeys <ids>` · `--rebuild` · `--no-reset` (bỏ qua
việc cài đặt lại sạch trong hành trình smoke) · `--out <dir>` · `--list` · `--help`.

Trình chạy ghim **một** số sê-ri adb cho mọi lệnh, nên nó vẫn hoạt động ngay cả
khi một điện thoại xuất hiện hai lần (USB + không dây). Với mục tiêu `local`, nó
thiết lập các đường hầm `adb reverse` để ứng dụng trên thiết bị tiếp cận được
ngăn xếp trên máy của bạn.

---

## 3. Xem kết quả

Khi hoàn tất, nó in ra một bản tóm tắt và ghi vào, bên dưới `journey-results/`:

| Tệp                             | Nội dung                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **Đọc tệp này** — theo từng hành trình, từng bước ✅/❌ kèm lý do, các testTag trên màn hình, và một liên kết ảnh chụp màn hình cho mỗi bước |
| `latest-report.json`            | cùng dữ liệu đó, định dạng máy đọc được                                                                                                      |
| `runs/<runId>/*.png`            | một ảnh chụp màn hình của mỗi bước (cả đạt _lẫn_ không đạt)                                                                                  |
| `runs/<runId>/report.{md,json}` | báo cáo được lưu trữ cho lần chạy cụ thể đó                                                                                                  |

Mã thoát là `0` khi mọi hành trình đều đạt, là `1` khi có bất kỳ hành trình nào
thất bại. Khi thất bại, bước đó ghi lại chính xác những gì có trên màn hình, nên
bạn có thể thấy _lý do_ mà không cần điều khiển lại điện thoại.

---

## 4. Các hành trình bao quát những gì

Chạy `--list` để xem tập hợp hiện thời. Nhìn chung, bộ kiểm thử bao quát:

- **Smoke** — cài đặt sạch → chấp nhận điều khoản pháp lý → đăng nhập, tiếp cận
  được phần phụ trợ.
- **Đăng nhập theo cohort** — các persona người lớn / vị thành niên / quản trị
  đăng nhập qua bộ chọn persona dành cho nhà phát triển ngay trong ứng dụng;
  danh tính được xác nhận đối chiếu với lớp phủ gỡ lỗi và trường `cohort` trong
  Firestore.
- **Cổng cohort của OSA** — một vị thành niên không thể theo dõi hoặc xem một
  người lớn (máy chủ trả về `404`, và việc ghi vào Firestore không bao giờ xảy
  ra), trong khi các hành động cùng cohort lại thành công — chứng minh cổng này
  đặc thù theo cohort, chứ không phải chặn toàn bộ.
- **Quản trị** — ghi đè cohort chỉ dành cho nhân viên (một thành viên thường bị
  từ chối với `422`; một tài khoản nhân viên thành công và ghi một dòng kiểm
  toán theo quy định).
- **Kiểm duyệt** — báo cáo → quản trị đình chỉ (+ kiểm toán) → kháng nghị → gỡ
  đình chỉ, hoàn toàn do máy chủ thực thi, với việc dọn dẹp lũy đẳng.

Xác thực trong các hành trình luôn dùng **bộ chọn persona dành cho nhà phát triển
ngay trong ứng dụng** — không bao giờ dùng đăng nhập Google/Apple thật.

> **Lưu ý về các đặc tả hành trình.** Các kế hoạch Gherkin trong
> `.project/test-plans/manual/j01-j19` một phần mang tính _kỳ vọng_: chúng tham
> chiếu đến UI mà ứng dụng đã phát hành không có (ví dụ một màn hình đăng ký bằng
> email/mật khẩu, các tab ẩn cho vị thành niên, một màn hình khám phá). Do đó
> trình chạy ánh xạ ý định thực sự của mỗi hành trình đối chiếu với ứng dụng
> **thực tế** + Firestore + API, và ghi nhận những sai lệch như vậy thành các
> phát hiện thay vì thất bại trên điều không có thật.

---

## 5. Khắc phục sự cố

| Triệu chứng                                              | Cách khắc phục                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                    | Cắm / ghép nối điện thoại; kiểm tra `adb devices`.                                                                                |
| Kẹt ở việc tới SignIn / "backend NOT reachable"          | Ngăn xếp cục bộ chưa chạy hoặc các đường hầm `adb reverse` chưa được thiết lập — khởi động lại `bash local/start.sh` và chạy lại. |
| `persona "<email>" not found in picker`                  | Các persona chưa được gieo — chạy lệnh gieo trong §1.                                                                             |
| Thiếu `Firestore assertions: ON` / các bước DB bị bỏ qua | Các khẳng định DB chỉ chạy cho `--target local`.                                                                                  |
| Dựng APK thất bại                                        | Mở tệp `gradle-build.log` được in ra; đảm bảo đã cài Java 21+ và Android SDK.                                                     |
| Một bước thất bại trên màn hình bạn không ngờ tới        | Mở ảnh chụp màn hình được nêu tên trong `latest-report.md` cho bước đó.                                                           |

---

## 6. Thêm một hành trình

Các hành trình là các đối tượng thuần với một phương thức `run(device, reporter, ctx)`,
được tạo thành từ các trợ giúp dùng chung:

- `signInAs(device, reporter, ctx, email, nameToken)` — đăng nhập một persona qua
  bộ chọn và đi qua các màn hình chen ngang lúc khởi chạy lần đầu để tới Home.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, và `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- Máy chủ: `getIdToken(email)` → mã thông báo ID của một persona, rồi
  `apiCall(method, path, { token, body })`.

Bọc mỗi khẳng định trong `reporter.step(device, 'name', async () => { … })` — nó
đo thời gian bước, chụp màn hình bước đó, ghi nhận đạt/không đạt, và khi thất bại
sẽ ghi lại các testTag trên màn hình. Thêm đối tượng mới vào mảng `all` trong
`buildJourneys`.

Logic thuần (phân tích cú pháp, bộ chọn, xử lý đối số) được kiểm thử đơn vị trong
`tests/scripts/device-journey-runner.test.js` (`cd express-api && npm test`); các
tầng thiết bị/Firestore/API được kiểm thử tích hợp bằng cách chạy bộ kiểm thử
trên một thiết bị thật.
