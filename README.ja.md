# ShyTalk

**ボイスチャットルームを、再構築。**

[![Android](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green.svg)](https://play.google.com/store/apps/details?id=com.shyden.shytalk)
[![Kotlin](https://img.shields.io/badge/Kotlin-2.3.20-blue.svg)](https://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

🌍 [English](README.md) | [العربية](README.ar.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [हिन्दी](README.hi.md) | [Bahasa Indonesia](README.id.md) | [Italiano](README.it.md) | **日本語** | [한국어](README.ko.md) | [Nederlands](README.nl.md) | [Polski](README.pl.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [Svenska](README.sv.md) | [ไทย](README.th.md) | [Türkçe](README.tr.md) | [Українська](README.uk.md) | [Tiếng Việt](README.vi.md) | [中文](README.zh.md)

## 概要

ShyTalkは、リアルタイムのボイスチャットルームを作成・参加できるソーシャルボイスチャットアプリです。Kotlin Multiplatform（KMP）で構築されており、共通のコードベースでAndroidとiOSの両方に対応しています。会話をホストしたり、聴いたり、世界中の人々とつながりたい場合でも、ShyTalkが簡単に実現します。

iOSはサポート対象プラットフォームですが、このガイドは主要な開発ターゲットであるAndroid開発に焦点を当てています。

## 機能

### ボイスチャットルーム
- LiveKitによるリアルタイム音声でルームを作成または参加
- オーナー、ホスト、参加者の役割を持つ構造化された座席システム
- 座席リクエストと招待 -- 座席への参加をリクエストしたり、リスナーに発言を招待
- フローティングチャットヘッド -- アプリの他の部分を閲覧しながらボイスチャットを継続
- ルーム有効期限 -- オーナーが不在の場合、カウントダウンタイマーで自動的にルームを閉鎖

### メッセージング
- すべてのルームで音声と並行してライブテキストチャット
- 1対1の会話によるプライベートメッセージ
- メンバー管理と権限付きのグループチャット
- リアルタイムの入力インジケーター
- スタンプ対応

### ソーシャル
- 写真、カバー画像、国旗、自己紹介でカスタマイズ可能なユーザープロフィール
- フォローシステム -- 他のユーザーをフォローし、アクティブ状態を確認
- ギフトウォール -- 他のユーザーから受け取ったギフトを展示
- ブロックシステム -- ルームやプロフィール全体でユーザーをブロック

### バーチャルエコノミー
- ウォレットと取引履歴付きのコインベース経済
- 連続ログインボーナス付きのデイリーログイン報酬
- 段階別賞品付きのラッキースピン（ガチャ）システム
- バーチャルギフト -- ボイスチャット中にアニメーションギフトを送受信
- ギフト保管用のバックパックインベントリ
- コイン購入パッケージ
- アニメーションギフトエフェクト付きのブロードキャストバナー

### アカウントとID
- マルチプロバイダー認証 -- Google、Apple、またはメール（OTP）でサインイン
- 複数のサインイン方法を1つのアカウントにリンク
- Firebaseプロジェクト間で保持される安定したユーザーID（uniqueId）
- リンク/解除対応の設定画面でのリンク済みアカウント管理
- デバイスバインディング -- 各デバイスは1つのアカウントに永続的に紐付け

### モデレーションと安全性
- モデレーションツール -- ルームオーナーとしてミュート、キック、座席移動、ホスト管理
- レビューワークフロー付きのユーザー報告システム
- ポリシー違反に対する警告とサスペンションシステム
- コミュニティ基準、プライバシーポリシー、利用規約画面
- 新規ユーザー向けの法的同意フロー
- 古いアプリバージョンに対する強制アップデート

### 起動画面
- アプリ起動時に表示される設定可能なランチスクリーン
- スケジュールとターゲティングオプション付きの管理者管理コンテンツ

### セキュリティ
- アプリアクセス用のPINコード保護
- 生体認証 -- 指紋認証と顔認証
- 機密操作用のOTP（ワンタイムパスワード）検証

### 管理パネル
- プロジェクトの静的サイトにあるWebベースのモデレーションダッシュボード
- ユーザー管理、コンテンツモデレーション、設定
- ライブプレビュー付きのテンプレートとギフト管理
- リアルタイムログストリーミングとアラート

### 画像圧縮
- Express API経由のアップロード時自動画像圧縮
- 品質を保ちながらストレージと帯域幅コストを削減

### 国際化
- 19言語をそのまま対応
- すべてのユーザー向け文字列の完全なローカライズ

### ログとモニタリング
- Express API、モバイルアプリ、管理パネル全体の構造化ログ
- 管理ダッシュボードでのリアルタイムログストリーミング
- 自動適用によるデバイスとネットワークの禁止
- 重大なエラーと異常に対するアラートシステム
- エンドツーエンドのリクエスト追跡のためのトレースID伝播

## 技術スタック

| レイヤー | 技術 |
|-------|-----------|
| **フレームワーク** | Kotlin Multiplatform (KMP) |
| **UI** | Compose Multiplatform |
| **アーキテクチャ** | MVVM + Repository Pattern |
| **DI** | Koin |
| **認証** | Firebase Authentication (Google, Apple, Email+OTP) マルチプロバイダーIDシステム付き |
| **データベース** | Cloud Firestore |
| **リアルタイム** | Firebase Realtime Database |
| **ストレージ** | Cloudflare R2 (Express APIプロキシ経由) |
| **APIサーバー** | Express.js on Oracle Cloud Free Tier |
| **音声** | LiveKit |
| **プッシュ通知** | Firebase Cloud Messaging |
| **画像読み込み** | Coil 3 (KMP) |
| **アニメーション** | Lottie Compose |
| **日時** | kotlinx-datetime |
| **ナビゲーション** | Compose Navigation |
| **CDN** | Cloudflare Pages + CDN |

## アーキテクチャ

ShyTalkはクリーンな**Repositoryパターン**を使用した**MVVM**に準拠しています：

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

- **shared module** (`commonMain`) -- モデル、リポジトリインターフェース、ViewModel、プラットフォーム間で共有されるUI
- **app module** -- Android固有の画面、リポジトリ実装、エントリポイント
- **iosApp module** -- iOS固有のエントリポイント
- **express-api** -- Oracle Cloud Free Tierで動作するExpress.jsバックエンド

## プロジェクト構成

```
ShyTalk/
+-- app/                              # Androidアプリモジュール
|   +-- src/
|       +-- main/java/.../
|       |   +-- ShyTalkApp.kt         # アプリケーションエントリポイント
|       |   +-- MainActivity.kt       # メインアクティビティ
|       |   +-- core/
|       |   |   +-- di/               # Koin DIモジュール
|       |   |   +-- room/             # ActiveRoomManager & RoomService
|       |   +-- data/
|       |   |   +-- remote/           # LiveKit音声、プレゼンス、通知
|       |   |   +-- repository/       # リポジトリ実装
|       |   +-- feature/
|       |   |   +-- auth/             # Googleサインイン画面
|       |   |   +-- profile/          # プロフィール画面
|       |   |   +-- room/             # ルーム画面
|       |   |   +-- settings/         # アプリ設定
|       |   +-- navigation/           # NavGraph & Screenルート
|       +-- test/                     # ユニットテスト
|       +-- androidTest/              # E2Eテスト (Compose UI Test)
+-- shared/                           # KMP共有モジュール
|   +-- src/commonMain/kotlin/.../
|       +-- core/
|       |   +-- di/                   # 共有Koinモジュール
|       |   +-- model/                # データモデル (User, ChatRoom, Gift等)
|       |   +-- ui/                   # 共有コンポーネント
|       |   +-- util/                 # ユーティリティ & 定数
|       +-- data/
|       |   +-- remote/               # VoiceService, TokenService等
|       |   +-- repository/           # リポジトリインターフェース
|       +-- feature/                  # 共有機能モジュール
+-- iosApp/                           # iOSアプリモジュール
+-- express-api/                      # Express.js APIサーバー
|   +-- src/
|       +-- routes/                   # APIルートハンドラー
|       +-- middleware/               # 認証、ログミドルウェア
|       +-- utils/                    # Firebase Admin, R2, ロガー
|       +-- cron/                     # スケジュールジョブ
+-- public/                           # 静的サイト & 管理パネル
+-- local/                            # ローカル開発環境 (エミュレーター、シードデータ)
+-- tests/web/                        # Playwrightブラウザテスト
+-- scripts/                          # ユーティリティスクリプト
+-- .github/workflows/                # CI/CD (PRチェック、Dev/Prodデプロイ、E2E、lint)
+-- firestore.rules                   # Firestoreセキュリティルール
+-- database.rules.json               # RTDBセキュリティルール
+-- firestore.indexes.json            # Firestore複合インデックス
+-- firebase.json                     # Firebase設定
```

## はじめに

### 前提条件

- **Android Studio** Ladybug以降
- **JDK 17+**
- **Node.js 24+**
- **Docker** (LiveKit音声サーバー、MinIOストレージ、Mailpitメール用)
- **Firebase CLI** (`npm install -g firebase-tools`)

開始するのにクラウドアカウントは不要です -- ローカル環境は完全にオフラインで動作します。

### ローカル開発 (推奨)

最速の開始方法です。1つのコマンドですべてを起動します -- Firebase Emulators、Dockerコンテナ、Express API、そしてAndroidアプリをビルドします。クラウドアカウント不要、コスト不要、クォータ制限なし。

1. **クローンとインストール**
   ```bash
   git clone https://github.com/ShydenMcM/ShyTalk.git
   cd ShyTalk
   cd express-api && npm install && cd ..
   ```

2. **すべてを起動**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/start.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\start.ps1
   ```

   この1つのコマンドで：
   - Dockerコンテナを起動（LiveKit音声サーバー、MinIOストレージ、Mailpitメール）
   - Firebase Emulatorsを起動（Firestore、Auth、RTDB）
   - テストデータをシードし、MinIOストレージバケットを作成
   - Express APIを起動
   - Androidアプリをビルドしてインストール（デバイスが接続されている場合）

   準備完了時に以下が表示されます：
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

3. **サインイン**
   - シードされたテストアカウントでメールサインインフローを使用：`claude-test@shytalk.dev` / `localdev123`
   - または新しいアカウントを作成 -- ローカルエミュレーターを使用します
   - Google/Appleサインインはローカルでは動作しません（実際のOAuthなし） -- 代わりにメールOTPを使用
   - OTPコードはMailpitにキャプチャされます -- http://localhost:8025 を確認

4. **物理デバイスでの実行**

   スマートフォンは開発マシンと**同じWi-Fiネットワーク**に接続されている必要があります。

   a. マシンのローカルIPを確認：
   ```bash
   # Windows
   ipconfig    # Wi-Fiアダプターの「IPv4アドレス」を確認（例：192.168.1.42）

   # macOS / Linux
   ifconfig | grep "inet "    # または: ip addr show
   ```

   b. ローカルビルドフレーバーを更新して、`10.0.2.2`の代わりにあなたのIPを使用します。`app/build.gradle.kts`で`local`フレーバーを見つけて変更：
   ```kotlin
   // 10.0.2.2をマシンのローカルIPに置き換え
   buildConfigField("String", "API_BASE_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "WORKER_URL", "\"http://192.168.1.42:3000\"")
   buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://192.168.1.42:7880\"")
   buildConfigField("String", "RTDB_URL", "\"http://192.168.1.42:9000\"")
   ```

   c. USBでデバイスを接続してUSBデバッグを有効にし、以下を実行：
   ```bash
   ./gradlew installLocalDebug
   ```

   d. または、コード変更を避けるために**adb reverse**を使用（デバイスがlocalhostをマシンにルーティング）：
   ```bash
   adb reverse tcp:3000 tcp:3000   # Express API
   adb reverse tcp:8080 tcp:8080   # Firestoreエミュレーター
   adb reverse tcp:9099 tcp:9099   # Authエミュレーター
   adb reverse tcp:9000 tcp:9000   # RTDBエミュレーター
   adb reverse tcp:7880 tcp:7880   # LiveKit
   adb reverse tcp:9002 tcp:9002   # MinIO（画像ストレージ）
   adb reverse tcp:8025 tcp:8025   # Mailpit UI
   ```
   `adb reverse`を使用すると、ローカルフレーバーのデフォルト`10.0.2.2`アドレスが物理デバイスでも動作します -- ビルド設定の変更は不要です。

5. **ローカルサービスの停止**

   **Linux / macOS / Git Bash:**
   ```bash
   bash local/stop.sh
   ```

   **Windows PowerShell:**
   ```powershell
   .\local\stop.ps1
   ```

   または起動スクリプトターミナルで`Ctrl+C`を押します。エミュレーターデータは自動的に保存され、次回起動時に復元されます。

### 便利なローカル開発URL

| サービス | URL | 用途 |
|---------|-----|---------|
| Firebase Emulator UI | http://localhost:4000 | Firestoreデータ、Authユーザー、RTDBの閲覧 |
| Express API | http://localhost:3000 | バックエンドAPI |
| ヘルスチェック | http://localhost:3000/api/health | APIの動作確認 |
| Mailpit | http://localhost:8025 | キャプチャされたメールとOTPコードの確認 |
| MinIO Console | http://localhost:9001 | アップロードされた画像とファイルの閲覧 |

### オプションサービス

**LibreTranslate（メッセージ翻訳）**

翻訳機能をローカルでテストするためのオプションの6GB+ Dockerイメージ：
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```
イメージサイズが大きいため、デフォルトのセットアップには含まれていません。翻訳はこれなしでも動作します -- メッセージが翻訳されないだけです。

### クラウド開発 (オプション)

実際のクラウドサービスに対してテストする必要がある場合（例：実際のプッシュ通知、実際のGoogleサインイン）：

1. **Firebaseセットアップ**
   - [console.firebase.google.com](https://console.firebase.google.com)でFirebaseプロジェクトを作成
   - 認証で**Googleサインイン**と**Appleサインイン**を有効化
   - **Firestore**、**Realtime Database**、**Cloud Messaging**を有効化
   - `google-services.json`をダウンロードして`app/src/dev/`に配置

2. **Express APIセットアップ**
   ```bash
   cd express-api
   cp .env.example .env  # クラウド認証情報で編集
   npm install
   npm start
   ```

3. **Firestoreルールのデプロイ**
   ```bash
   npx firebase deploy --only firestore:rules
   ```

4. **Androidアプリのビルド**（devフレーバー）
   ```bash
   ./gradlew assembleDevDebug
   ```

### 環境変数

| 変数 | 説明 | 場所 |
|----------|-------------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDKサービスアカウントJSON | Express API |
| `R2_ACCOUNT_ID` | Cloudflare R2アカウントID | Express API |
| `R2_ACCESS_KEY_ID` | R2アクセスキー | Express API |
| `R2_SECRET_ACCESS_KEY` | R2シークレットキー | Express API |
| `R2_BUCKET_NAME` | R2バケット名（デフォルト：`shytalk-media`） | Express API |
| `LIVEKIT_API_KEY` | LiveKit APIキー | Express API |
| `LIVEKIT_API_SECRET` | LiveKit APIシークレット | Express API |
| `LIVEKIT_URL` | LiveKitサーバーURL | Androidアプリ (BuildConfig) |
| `WORKER_URL` | Express APIベースURL | Androidアプリ (BuildConfig) |

## テスト

### ローカルでテストを実行

```bash
# インタラクティブテストメニュー（実行するものを選択）：
bash local/test.sh        # Linux / macOS / Git Bash
.\local\test.ps1          # Windows PowerShell

# または個別のスイートを実行：
bash local/test-unit.sh       # Kotlin + Express APIユニットテスト
bash local/test-playwright.sh # Playwrightウェブテスト（ローカル環境が必要）
bash local/test-e2e.sh        # Android E2Eテスト（ローカル環境 + デバイスが必要）
bash local/test-lint.sh       # ktlint + ESLint

# Allureテストレポートを表示：
npx allure serve allure-results
```

### テストスイート

| スイート | コマンド | 数量 |
|-------|---------|-------|
| Kotlinユニットテスト | `./gradlew test` | 100以上のテスト |
| Express APIテスト | `cd express-api && npm test` | 1,540以上のテスト |
| E2E Gherkin (Android) | `./gradlew connectedDevDebugAndroidTest` | 34フィーチャーファイル |
| Playwrightウェブテスト | `npx playwright test` | 28スペック |

```bash
# Kotlin/KMPユニットテスト
./gradlew test

# Express APIテスト
cd express-api && npm test

# E2Eテスト（接続されたデバイスまたはエミュレーターが必要）
./gradlew connectedDevDebugAndroidTest

# Playwrightブラウザテスト（管理パネルの実行が必要）
npx playwright test
```

### CIでのテスト

CIでは、PlaywrightとAndroid E2Eテストは同じローカル環境（エミュレーター + Docker）に対して実行されます -- クラウドサービスは使用されません。これにより、テストがライブテスターに干渉することはありません。

## トラブルシューティング

- **ポートが使用中**: `lsof -i :<port>` (Linux/macOS) または `netstat -ano | findstr :<port>` (Windows) でポートを使用しているものを確認。
- **Dockerが動作していない**: Docker Desktopが起動していることを確認。`docker ps`で確認。
- **Firebase Emulatorsが起動しない**: Java 11+が必要。`java -version`で確認。
- **Androidビルドが失敗**: JDK 17+とAndroid SDKがインストールされていることを確認。`./gradlew clean`を試す。
- **adbデバイスが検出されない**: USBデバッグを有効にする。`adb devices`で確認。
- **画像が読み込まれない**: MinIOバケットが作成されていない可能性。`cd express-api && NODE_ENV=local node ../local/seed.js`を実行。物理デバイスの場合、`adb reverse tcp:9002 tcp:9002`を実行。
- **OTPが届かない**: コンソール出力で`[OTP-LOCAL]`行を確認。http://localhost:8025 のMailpit UIも確認。
- **エミュレーターデータのリセット**: `local/firebase-emulator-data/`ディレクトリを削除して再起動。
- **MinIOデータのリセット**: `docker compose -f local/docker-compose.yml down -v`を実行してボリュームを削除。

## デプロイ

デプロイはGitHub Actionsワークフロー（`.github/workflows/`）で管理されています：

| ワークフロー | トリガー | 動作内容 |
|----------|---------|-------------|
| **PR Checks** | `main`へのPR時に自動 | lint、Kotlinテスト、Express APIテスト、Playwrightテストを実行（変更ファイルに基づく） |
| **Deploy to Dev** | 手動（`workflow_dispatch`） | Express API + Webをdevにデプロイ、APKをテスターに配布、オプションでPlaywrightテストを実行 |
| **Deploy to Prod** | 手動（`workflow_dispatch`） | タグ付きリリースをprodにデプロイ -- Express API、Web、Play Store、App Store |

追加ワークフロー: **E2E Tests**（Androidエミュレーターマトリクス）、**SonarCloud**（静的解析）、**Lint**、**Backend Tests**、**Dependabot Auto-merge**。

- **Express API:** SSH + PM2経由でOracle Cloud VMにデプロイ（dev: ロンドン、prod: シンガポール）
- **Android:** バンドルしてCI経由でGoogle Playにアップロード
- **iOS:** ビルドしてCI経由でApp Store Connect / TestFlightにアップロード
- **管理パネル / Web:** Cloudflare Pagesにデプロイ

## コントリビュート

コントリビュートを歓迎します！ガイドラインについては[CONTRIBUTING.md](CONTRIBUTING.md)をご覧ください。

## ライセンス

このプロジェクトはApache License 2.0の下でライセンスされています。詳細は[LICENSE](LICENSE)をご覧ください。

## 謝辞

- [Firebase](https://firebase.google.com) -- 認証、Firestore、Realtime Database、Cloud Messaging
- [LiveKit](https://livekit.io) -- リアルタイム音声通信
- [Cloudflare](https://www.cloudflare.com) -- R2ストレージ、Pagesホスティング、CDN
- [Oracle Cloud](https://www.oracle.com/cloud/free/) -- Express API用の無料ティアVM
- [Express.js](https://expressjs.com) -- APIサーバーフレームワーク
- [Jetpack Compose](https://developer.android.com/jetpack/compose) -- モダンな宣言型UI
- [Koin](https://insert-koin.io) -- 軽量な依存性注入
- [Coil](https://coil-kt.github.io/coil/) -- Kotlin Multiplatform用画像読み込み
- [Lottie](https://airbnb.design/lottie/) -- アニメーションギフトとUIエフェクト
- [kotlinx-datetime](https://github.com/Kotlin/kotlinx-datetime) -- マルチプラットフォーム日時
