# ShyTalk

**음성 채팅방, 새롭게 상상하다.**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | [日本語](README.ja.md) | **한국어** | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## 소개

ShyTalk은 실시간 음성 채팅방을 만들고 참여할 수 있는 소셜 음성 채팅 앱입니다. Kotlin Multiplatform(KMP)으로 구축되어 공유 코드베이스로 Android와 iOS를 모두 지원합니다. 대화를 호스팅하거나, 듣거나, 전 세계 사람들과 연결하고 싶을 때 ShyTalk이 쉽게 만들어 드립니다.

## 기능

### 음성 채팅방
- LiveKit 기반 실시간 음성으로 방을 만들거나 참여
- 소유자, 호스트, 참석자 역할이 있는 구조화된 좌석 시스템
- 좌석 요청 및 초대 -- 좌석 참여를 요청하거나 청취자를 발언에 초대
- 플로팅 채팅헤드 -- 앱의 다른 부분을 탐색하면서 음성 채팅 계속
- 방 만료 -- 소유자가 부재 시 카운트다운 타이머와 함께 자동으로 방 종료

### 메시징
- 모든 방에서 음성과 함께 실시간 텍스트 채팅
- 1:1 대화를 통한 개인 메시지
- 멤버 관리 및 권한이 있는 그룹 채팅
- 실시간 타이핑 표시
- 스티커 지원

### 소셜
- 사진, 커버 이미지, 국기, 소개글로 커스터마이징 가능한 사용자 프로필
- 팔로우 시스템 -- 다른 사용자를 팔로우하고 활동 상태 확인
- 선물 벽 -- 다른 사용자로부터 받은 선물 전시
- 차단 시스템 -- 방과 프로필 전체에서 사용자 차단

### 가상 경제
- 지갑과 거래 내역이 있는 코인 기반 경제
- 연속 보너스가 있는 일일 로그인 보상
- 등급별 상품이 있는 럭키 스핀(가차) 시스템
- 가상 선물 -- 음성 채팅 중 애니메이션 선물 주고받기
- 선물 보관용 배낭 인벤토리
- 코인 구매 패키지
- 애니메이션 선물 효과가 있는 방송 배너

### 계정 및 신원
- 멀티 프로바이더 인증 -- Google, Apple 또는 이메일(OTP)로 로그인
- 여러 로그인 방법을 하나의 계정에 연결
- Firebase 프로젝트 간에 유지되는 안정적인 사용자 ID(uniqueId)
- 설정에서 연결/해제를 지원하는 연결된 계정 관리
- 기기 바인딩 -- 각 기기는 하나의 계정에 영구적으로 연결

### 중재 및 안전
- 중재 도구 -- 방 소유자로서 음소거, 추방, 좌석 이동, 호스트 관리
- 검토 워크플로가 있는 사용자 신고 시스템
- 정책 위반에 대한 경고 및 정지 시스템
- 커뮤니티 기준, 개인정보 보호 정책, 서비스 약관 화면
- 신규 사용자를 위한 법적 동의 흐름
- 오래된 앱 버전에 대한 강제 업데이트

### 시작 화면
- 앱 시작 시 표시되는 구성 가능한 런치 스크린
- 일정 및 타겟팅 옵션이 있는 관리자 관리 콘텐츠

### 보안
- 앱 접근을 위한 PIN 코드 보호
- 생체 인증 -- 지문 및 얼굴 인식
- 민감한 작업을 위한 OTP(일회용 비밀번호) 확인

### 관리 패널
- 프로젝트 정적 사이트의 웹 기반 중재 대시보드
- 사용자 관리, 콘텐츠 중재, 설정
- 실시간 미리보기가 있는 템플릿 및 선물 관리
- 실시간 로그 스트리밍 및 알림

### 이미지 압축
- Express API를 통한 업로드 시 자동 이미지 압축
- 품질을 유지하면서 스토리지 및 대역폭 비용 절감

### 국제화
- 19개 언어 기본 지원
- 모든 사용자 대면 문자열의 완전한 현지화

### 로깅 및 모니터링
- Express API, 모바일 앱, 관리 패널 전체의 구조화된 로깅
- 관리 대시보드의 실시간 로그 스트리밍
- 자동 적용되는 기기 및 네트워크 차단
- 심각한 오류 및 이상에 대한 알림 시스템
- 종단 간 요청 추적을 위한 Trace ID 전파

## 기술 스택

| 레이어 | 기술 |
|-------|-----------|
| **프레임워크** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **아키텍처** | MVVM + Repository Pattern |
| **DI** | Koin |
| **인증** | Firebase Authentication (Google, Apple, Email+OTP) 멀티 프로바이더 ID 시스템 포함 |
| **데이터베이스** | Cloud Firestore |
| **실시간** | Firebase Realtime Database |
| **스토리지** | Cloudflare R2 (Express API 프록시 경유) |
| **API 서버** | Express.js on Oracle Cloud Free Tier |
| **음성** | LiveKit |
| **푸시 알림** | Firebase Cloud Messaging |
| **이미지 로딩** | Coil 3 (KMP) |
| **애니메이션** | Lottie Compose |
| **날짜/시간** | kotlinx-datetime |
| **네비게이션** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## 아키텍처

ShyTalk은 클린한 **Repository 패턴**과 함께 **MVVM**을 따릅니다:

```
+---------------------------------------------+
|                    UI 레이어                   |
|  Compose Screens -> ViewModels -> UI State   |
+---------------------------------------------+
|                 도메인 레이어                   |
|         Repository Interfaces                |
+---------------------------------------------+
|                 데이터 레이어                   |
|  Repository Impls -> Firestore / R2 / RTDB / LiveKit  |
+---------------------------------------------+
```

- **shared module** (`commonMain`) -- 모델, 리포지토리 인터페이스, ViewModel, 플랫폼 간 공유 UI
- **app module** -- Android 전용 화면, 리포지토리 구현, 엔트리 포인트
- **iosApp module** -- iOS 전용 엔트리 포인트
- **express-api** -- Oracle Cloud Free Tier에서 실행되는 Express.js 백엔드

## 프로젝트 구조

```
ShyTalk/
+-- app/                              # Android 앱 모듈
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # 애플리케이션 엔트리 포인트
|       |   +-- MainActivity.kt       # 메인 액티비티
|       |   +-- core/
|       |   |   +-- di/               # Koin DI 모듈
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit 음성, 프레즌스, 알림
|       |   |   +-- repository/       # 리포지토리 구현
|       |   +-- feature/
|       |   |   +-- auth/             # Google 로그인 화면
|       |   |   +-- profile/          # 프로필 화면
|       |   |   +-- room/             # 방 화면
|       |   |   +-- settings/         # 앱 설정
|       |   +-- navigation/           # NavGraph & Screen 라우트
|       +-- test/                     # 유닛 테스트
|       +-- androidTest/              # E2E 테스트 (Compose UI Test)
+-- shared/                           # KMP 공유 모듈
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # 공유 Koin 모듈
|       |   +-- model/                # 데이터 모델 (User, ChatRoom, Gift 등)
|       |   +-- ui/                   # 공유 컴포넌트
|       |   +-- util/                 # 유틸리티 & 상수
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService 등
|       |   +-- repository/           # 리포지토리 인터페이스
|       +-- feature/                  # 공유 기능 모듈
+-- iosApp/                           # iOS 앱 모듈
+-- express-api/                      # Express.js API 서버
|   +-- src/
|       +-- routes/                   # API 라우트 핸들러
|       +-- middleware/               # 인증, 로깅 미들웨어
|       +-- utils/                    # Firebase Admin, R2, 로거
|       +-- cron/                     # 스케줄 작업
+-- public/                           # 정적 사이트 & 관리 패널
+-- local/                            # 로컬 개발 환경 (에뮬레이터, 시드 데이터)
+-- tests/web/                        # Playwright 브라우저 테스트
+-- scripts/                          # 유틸리티 스크립트
+-- .github/workflows/                # CI/CD (PR 체크, Dev/Prod 배포, E2E, lint)
+-- firestore.rules                   # Firestore 보안 규칙
+-- database.rules.json               # RTDB 보안 규칙
+-- firestore.indexes.json            # Firestore 복합 인덱스
+-- firebase.json                     # Firebase 설정
```

## 시작하기

### 사전 요구사항

- **Android Studio** Ladybug 이상
- **JDK 17+**
- **Node.js 24+**
- **Docker** (LiveKit 로컬 서버용)
- **Firebase CLI** (`npm install -g firebase-tools`)

### 로컬 개발 (권장)

가장 빠른 시작 방법입니다. Firebase Emulators와 로컬 LiveKit Docker 컨테이너를 사용합니다 -- 클라우드 계정 불필요, 비용 없음, 할당량 제한 없음.

1. **클론 및 설치**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **로컬 서비스 시작**
   ```bash
   bash local/start.sh
   ```
   Firebase Emulators (Firestore, Auth, RTDB)와 LiveKit Docker 컨테이너를 시작합니다. 첫 실행 시 테스트 데이터(관리자 사용자, 샘플 선물, 설정)를 자동으로 시드합니다.

   다음이 표시됩니다:
   ```
   Local environment ready:
     Firebase UI:  http://localhost:4000
     Firestore:    localhost:8080
     Auth:         localhost:9099
     RTDB:         localhost:9000
     LiveKit:      localhost:7880
   ```

3. **Express API 시작** (새 터미널에서)
   ```bash
   cd express-api
   cp .env.local.example .env.local   # 필요시 R2/SMTP 값 편집
   npm run local
   ```
   API가 `http://localhost:3000`에서 시작됩니다. 테스트: `curl http://localhost:3000/api/health`

4. **Android 에뮬레이터에서 실행**
   ```bash
   ./gradlew installLocalDebug
   ```
   `local` 빌드 플레이버는 `10.0.2.2`(Android 에뮬레이터의 호스트 머신 루프백)에 연결됩니다. 추가 설정 없이 바로 작동합니다.

5. **물리적 기기에서 실행**

   휴대폰이 개발 머신과 **같은 Wi-Fi 네트워크**에 연결되어 있어야 합니다.

   a. 머신의 로컬 IP 확인:
   ```bash
   # Windows
   ipconfig    # Wi-Fi 어댑터의 "IPv4 주소"를 확인 (예: 192.168.1.42)

   # macOS / Linux
   ifconfig | grep "inet "    # 또는: ip addr show
   ```

   b. 로컬 빌드 플레이버를 업데이트하여 `10.0.2.2` 대신 자신의 IP를 사용합니다. `app/build.gradle.kts`에서 `local` 플레이버를 찾아 변경:
   ```kotlin
   // 10.0.2.2를 머신의 로컬 IP로 교체
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. USB로 기기를 연결하고 USB 디버깅을 활성화한 후:
   ```bash
   ./gradlew installLocalDebug
   ```

   d. 또는, 코드 변경 없이 **adb reverse**를 사용 (기기가 localhost를 머신으로 라우팅):
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestore 에뮬레이터
   adb reverse tcp:9099 tcp:9099   # Auth 에뮬레이터
   adb reverse tcp:9000 tcp:9000   # RTDB 에뮬레이터
   adb reverse tcp:7880 tcp:7880   # LiveKit
   ```
   `adb reverse`를 사용하면 로컬 플레이버의 기본 `10.0.2.2` 주소가 물리적 기기에서도 작동합니다 -- 빌드 설정 변경이 필요 없습니다.

6. **로그인**
   - 시드된 테스트 계정으로 이메일 로그인 흐름 사용: `claude-test@shytalk.dev` / `localdev123`
   - 또는 새 계정 생성 -- 로컬 에뮬레이터를 사용합니다
   - Google/Apple 로그인은 로컬에서 작동하지 않습니다 (실제 OAuth 없음) -- 이메일 OTP를 대신 사용

7. **로컬 서비스 중지**
   ```bash
   bash local/stop.sh
   ```
   또는 `start.sh` 터미널에서 `Ctrl+C`를 누릅니다. 에뮬레이터 데이터는 자동으로 저장되고 다음 시작 시 복원됩니다.

### 유용한 로컬 개발 URL

| 서비스 | URL | 용도 |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Firestore 데이터, Auth 사용자, RTDB 탐색 |
| Express API | http://localhost:3000 | 백엔드 API |
| 헬스 체크 | http://localhost:3000/api/health | API 실행 확인 |

### 클라우드 개발 (선택사항)

실제 클라우드 서비스에 대해 테스트해야 하는 경우 (예: 실제 푸시 알림, 실제 Google 로그인):

1. **Firebase 설정**
   - [console.firebase.google.com](https://console.firebase.google.com)에서 Firebase 프로젝트 생성
   - 인증에서 **Google 로그인** 및 **Apple 로그인** 활성화
   - **Firestore**, **Realtime Database**, **Cloud Messaging** 활성화
   - `google-services.json`을 다운로드하여 `app/src/dev/`에 배치

2. **Express API 설정**
   ```bash
   cd express-api
   cp .env.example .env  # 클라우드 자격 증명으로 편집
   npm install
   npm start
   ```

3. **Firestore 규칙 배포**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Android 앱 빌드** (dev 플레이버)
   ```bash
   ./gradlew assembleDevDebug
   ```

### 환경 변수

| 변수 | 설명 | 위치 |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK 서비스 계정 JSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2 계정 ID | Express API |
| `R2_ACCESS_KEY_ID` | R2 액세스 키 | Express API |
| `R2_SECRET_ACCESS_KEY` | R2 시크릿 키 | Express API |
| `R2_BUCKET_NAME` | R2 버킷 이름 (기본값: `shytalk-media`) | Express API |
| `LIVEKIT_API_KEY` | LiveKit API 키 | Express API |
| `LIVEKIT_API_SECRET` | LiveKit API 시크릿 | Express API |
| `LIVEKIT_URL` | LiveKit 서버 URL | Android 앱 (BuildConfig) |
| `WORKER_URL` | Express API 베이스 URL | Android 앱 (BuildConfig) |

## 테스트

| 스위트 | 명령어 | 수량 |
|-------|---------|-------|
| Kotlin 유닛 테스트 | `./gradlew test` | 100+ 테스트 |
| Express API 테스트 | `cd express-api && npm test` | 1,540+ 테스트 |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34 피처 파일 |
| Playwright 웹 테스트 | `npx playwright test` | 28 스펙 |

```bash
# Kotlin/KMP 유닛 테스트
./gradlew test

# Express API 테스트
cd express-api && npm test

# E2E 테스트 (연결된 기기 또는 에뮬레이터 필요)
./gradlew connectedDevDebugAndroidTest

# Playwright 브라우저 테스트 (관리 패널 실행 필요)
npx playwright test
```

## 배포

배포는 GitHub Actions 워크플로(`.github/workflows/`)로 관리됩니다:

| 워크플로 | 트리거 | 동작 내용 |
|----------|---------|-------------|
| **PR Checks** | `main`으로의 PR 시 자동 | lint, Kotlin 테스트, Express API 테스트, Playwright 테스트 실행 (변경 파일 기반) |
| **Deploy to Dev** | 수동 (`workflow_dispatch`) | Express API + 웹을 dev에 배포, APK를 테스터에게 배포, 선택적으로 Playwright 테스트 실행 |
| **Deploy to Prod** | 수동 (`workflow_dispatch`) | 태그된 릴리스를 prod에 배포 -- Express API, 웹, Play Store, App Store |

추가 워크플로: **E2E Tests** (Android 에뮬레이터 매트릭스), **SonarCloud** (정적 분석), **Lint**, **Backend Tests**, **Dependabot Auto-merge**.

- **Express API:** SSH + PM2를 통해 Oracle Cloud VM에 배포 (dev: 런던, prod: 싱가포르)
- **Android:** 번들링 후 CI를 통해 Google Play에 업로드
- **iOS:** 빌드 후 CI를 통해 App Store Connect / TestFlight에 업로드
- **관리 패널 / 웹:** Cloudflare Pages에 배포

## 기여

기여를 환영합니다! 가이드라인은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요.

## 라이선스

이 프로젝트는 Apache License 2.0에 따라 라이선스됩니다. 자세한 내용은 [LICENSE](LICENSE)를 참조하세요.

## 감사의 말

- [Firebase](https://firebase.google.com) -- 인증, Firestore, Realtime Database, Cloud Messaging
- [LiveKit](https://livekit.io) -- 실시간 음성 통신
- [Cloudflare](https://www.cloudflare.com) -- R2 스토리지, Pages 호스팅, CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Express API용 무료 티어 VM
- [Express.js](https://expressjs.com) -- API 서버 프레임워크
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- 모던 선언형 UI
- [Koin](https://insert-koin.io) -- 경량 의존성 주입
- [Coil](https://coil-kt.github.io/coil/) -- Kotlin Multiplatform용 이미지 로딩
- [Lottie](https://airbnb.design/lottie/) -- 애니메이션 선물 및 UI 효과
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- 멀티플랫폼 날짜/시간
