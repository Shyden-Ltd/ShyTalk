# ShyTalk 온디바이스 여정 테스트 실행기

_이 문서는 JOURNEY-RUNNER.md의 번역본입니다._

`device-journey-runner.js`는 **연결된 휴대폰에서 실제 ShyTalk 앱**을 엔드투엔드 사용자
여정으로 구동하고, 읽을 수 있는 **상세한 통과/실패 보고서**를 작성합니다 — 그래서 모든
단계를 손으로 일일이 탭하는 대신, 명령 하나를 실행하고 보고서 하나를 읽으면 됩니다.

이것은 **하이브리드** 실행기입니다. 각 여정은 세 개의 계층을 동시에 검증할 수 있습니다:

1. **UI** — `adb` + `uiautomator`를 통해 실행 중인 앱을 탭/검사합니다 (Compose
   `testTag`은 덤프에서 `resource-id`로 나타나며, 대화상자는 화면에 보이는 텍스트로
   매칭됩니다).
2. **Firestore** — 로컬 에뮬레이터를 (`firebase-admin`을 통해) 직접 읽어 각 동작 뒤의
   데이터베이스 상태를 확인합니다.
3. **서버 / API** — 각 페르소나로 로그인하고 (Auth 에뮬레이터의 실제 Firebase ID 토큰)
   `express-api`를 호출하므로, **서버가 강제하는 규칙**을 검증합니다 (OSA cohort 게이트,
   admin 재정의, 모더레이션) — 이는 UI만으로는 _보이지 않습니다_.

> 이 가이드의 번역본은 `journey-runner-locales/`에 있습니다 (20개 언어).

---

## 1. 사전 요구사항

| 필요한 것                   | 방법                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** 실행     | Firebase 에뮬레이터 + LiveKit/MinIO용                                                                                                             |
| **로컬 스택 가동**          | `bash local/start.sh` (repo 루트에서) — Firebase 에뮬레이터 + express-api를 시작합니다. 계속 실행해 두세요.                                       |
| **페르소나 시딩**           | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js` (멱등적; 비밀번호 `localdev123`으로 P‑02…P‑19 테스트 캐스트를 시딩) |
| **휴대폰 연결**             | `adb devices`가 하나를 표시해야 합니다 (USB 케이블 **또는** 무선 `adb`). Android 에뮬레이터도 동작합니다.                                         |
| **Java 21+ 및 Android SDK** | 처음 한 번만 필요하며, APK가 없을 때 실행기가 앱을 빌드할 수 있게 합니다                                                                          |

APK가 아직 빌드되지 않은 경우 실행기가 `local` 디버그 APK를 직접 빌드합니다.

---

## 2. 실행하기

repo 루트에서:

```sh
# 로컬 스택을 대상으로 전체 스위트 실행
node express-api/scripts/device-journey-runner.js

# 아무것도 실행하지 않고 여정 목록 보기
node express-api/scripts/device-journey-runner.js --list

# 특정 여정만 실행
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# 먼저 새 APK 빌드 강제
node express-api/scripts/device-journey-runner.js --rebuild

# 전체 옵션 목록
node express-api/scripts/device-journey-runner.js --help
```

옵션: `--target local|dev` (기본값 `local`) · `--serial <adb-serial>`
(기본값: 자동 선택) · `--journeys <ids>` · `--rebuild` · `--no-reset` (smoke
여정에서 깨끗한 재설치를 건너뜀) · `--out <dir>` · `--list` · `--help`.

실행기는 모든 명령에 대해 adb serial **하나**를 고정하므로, 휴대폰이 두 번 표시될
때에도 (USB + 무선) 동작합니다. `local` 대상의 경우 온디바이스 앱이 사용자
컴퓨터의 스택에 도달하도록 `adb reverse` 터널을 설정합니다.

---

## 3. 결과 보기

완료되면 요약을 출력하고 `journey-results/` 아래에 다음을 작성합니다:

| 파일                            | 내용                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **이것을 읽으세요** — 여정별, 단계별 ✅/❌와 이유, 화면상 testTag, 그리고 모든 단계의 스크린샷 링크 |
| `latest-report.json`            | 동일한 데이터, 기계 판독 가능                                                                       |
| `runs/<runId>/*.png`            | 모든 단계의 스크린샷 (통과 _및_ 실패)                                                               |
| `runs/<runId>/report.{md,json}` | 해당 특정 실행에 대해 보관된 보고서                                                                 |

종료 코드는 모든 여정이 통과하면 `0`, 하나라도 실패하면 `1`입니다. 실패 시 해당
단계는 화면에 무엇이 있었는지 정확히 기록하므로, 휴대폰을 다시 구동하지 않고도
*이유*를 볼 수 있습니다.

---

## 4. 여정이 다루는 범위

실시간 세트는 `--list`로 실행하세요. 한눈에 보면 이 스위트는 다음을 다룹니다:

- **Smoke** — 깨끗한 설치 → 법적 동의 → 로그인, 백엔드 도달 가능.
- **Cohort 로그인** — 성인 / 미성년자 / admin 페르소나가 인앱 dev 페르소나
  선택기를 통해 로그인하며, 신원은 디버그 오버레이와 Firestore `cohort` 필드에
  대해 확인됩니다.
- **OSA cohort 게이트** — 미성년자는 성인을 follow하거나 볼 수 없으며 (서버가
  `404`를 반환하고 Firestore 쓰기는 결코 발생하지 않음), 동일 cohort 동작은
  성공합니다 — 이 게이트가 전면 차단이 아니라 cohort 특정적임을 증명합니다.
- **Admin** — cohort 재정의는 스태프 전용입니다 (일반 멤버는 `422`로 거부되며,
  스태프 계정은 성공하고 규제 audit 행을 작성합니다).
- **모더레이션** — report → admin suspend (+ audit) → appeal → unsuspend, 완전히
  서버에서 강제되며, 멱등적 정리를 포함합니다.

여정에서의 인증은 항상 **인앱 dev 페르소나 선택기**를 사용합니다 — 실제
Google/Apple 로그인은 결코 사용하지 않습니다.

> **여정 사양에 대한 참고.** `.project/test-plans/manual/j01-j19`의 Gherkin
> 계획은 부분적으로 *이상적(aspirational)*입니다: 출시된 앱에 없는 UI를
> 참조합니다 (예: email/password 가입 화면, 숨겨진 미성년자 탭, discovery 화면).
> 따라서 실행기는 각 여정의 실제 의도를 **실제** 앱 + Firestore + API에 대해
> 매핑하고, 그러한 차이를 실패로 처리하는 대신 발견 사항으로 기록합니다.

---

## 5. 문제 해결

| 증상                                             | 해결                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                            | 휴대폰을 연결/페어링하세요; `adb devices`를 확인하세요.                                                                      |
| SignIn 도달에서 멈춤 / "backend NOT reachable"   | 로컬 스택이 가동되지 않았거나 `adb reverse` 터널이 설정되지 않았습니다 — `bash local/start.sh`를 재시작하고 다시 실행하세요. |
| `persona "<email>" not found in picker`          | 페르소나가 시딩되지 않았습니다 — §1의 시드 명령을 실행하세요.                                                                |
| `Firestore assertions: ON` 누락 / DB 단계 건너뜀 | DB 검증은 `--target local`에 대해서만 실행됩니다.                                                                            |
| APK 빌드 실패                                    | 출력된 `gradle-build.log`를 여세요; Java 21+ 및 Android SDK가 설치되어 있는지 확인하세요.                                    |
| 예상하지 못한 화면에서 단계 실패                 | 해당 단계에 대해 `latest-report.md`에 명명된 스크린샷을 여세요.                                                              |

---

## 6. 여정 추가하기

여정은 `run(device, reporter, ctx)` 메서드를 가진 일반 객체이며, 공유 헬퍼로부터
구성됩니다:

- `signInAs(device, reporter, ctx, email, nameToken)` — picker를 통해 페르소나로
  로그인하고 첫 실행 인터스티셜을 거쳐 Home으로 이동합니다.
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`, 그리고 `dump(device)` + `byId` / `byText` / `byTextContains`.
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`.
- 서버: `getIdToken(email)` → 페르소나의 ID 토큰, 그다음
  `apiCall(method, path, { token, body })`.

각 검증을 `reporter.step(device, 'name', async () => { … })`로 감싸세요 — 이것은
단계 시간을 측정하고, 스크린샷을 찍고, 통과/실패를 기록하며, 실패 시 화면상
testTag을 캡처합니다. 새 객체를 `buildJourneys`의 `all` 배열에 추가하세요.

순수 로직(파싱, 셀렉터, 인자 처리)은 `tests/scripts/device-journey-runner.test.js`에서
유닛 테스트됩니다 (`cd express-api && npm test`); 디바이스/Firestore/API 계층은
실제 디바이스에서 스위트를 실행하여 통합 테스트됩니다.
