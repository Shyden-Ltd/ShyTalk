# ShyTalk 実機 journey-test ランナー

_これは JOURNEY-RUNNER.md の翻訳です。_

`device-journey-runner.js` は、**接続された電話上の実際の ShyTalk アプリ**を
エンドツーエンドのユーザー journey で操作し、読める**詳細な pass/fail レポート**を
書き出します。つまり、各ステップを手作業でタップする代わりに、1 つのコマンドを実行して
1 つのレポートを読むだけで済みます。

これは**ハイブリッド**ランナーです。各 journey は 3 つのレイヤーに同時に assert できます:

1. **UI** — `adb` + `uiautomator` を介してライブアプリをタップ／検査します（Compose の
   `testTag` はダンプ内で `resource-id` として表示され、ダイアログはその可視テキストで照合されます）。
2. **Firestore** — ローカルエミュレータを直接（`firebase-admin` 経由で）読み取り、
   各 action の背後にあるデータベースの状態を確認します。
3. **Server / API** — 各 persona としてサインインし（Auth エミュレータからの実際の Firebase ID token）、
   `express-api` を呼び出します。これにより、**サーバーが強制するルール**
   （OSA cohort gate、admin override、moderation）を検証します。これらは UI だけでは*見えません*。

> このガイドの翻訳は `journey-runner-locales/`（20 言語）にあります。

---

## 1. 前提条件

| 必要なもの                             | 方法                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker Desktop** が起動していること  | Firebase エミュレータ + LiveKit/MinIO 用                                                                                                                    |
| **ローカルスタックが起動していること** | `bash local/start.sh`（repo のルートから）— Firebase エミュレータ + express-api を起動します。起動したままにしておいてください。                            |
| **Personas がシードされていること**    | `cd express-api && node --env-file=.env.local scripts/seed-personas-local.js`（冪等。パスワード `localdev123` で P‑02…P‑19 のテストキャストをシードします） |
| **電話が 1 台接続されていること**      | `adb devices` に 1 台表示される必要があります（USB ケーブル**または**ワイヤレス `adb`）。Android エミュレータでも動作します。                               |
| **Java 21+ と Android SDK**            | 初回のみ必要です。APK が無い場合にランナーがアプリをビルドできるようにするためです。                                                                        |

ランナーは、まだビルドされていなければ `local` debug APK を自身でビルドします。

---

## 2. 実行する

repo のルートから:

```sh
# ローカルスタックに対してスイート全体を実行
node express-api/scripts/device-journey-runner.js

# 何も実行せずに journey の一覧を表示
node express-api/scripts/device-journey-runner.js --list

# 特定の journey のみを実行
node express-api/scripts/device-journey-runner.js --journeys J02,J08,J11

# 先に新しい APK ビルドを強制
node express-api/scripts/device-journey-runner.js --rebuild

# オプションの全一覧
node express-api/scripts/device-journey-runner.js --help
```

オプション: `--target local|dev`（default `local`）· `--serial <adb-serial>`
（default: 自動選択）· `--journeys <ids>` · `--rebuild` · `--no-reset`（smoke
journey でのクリーン再インストールをスキップ）· `--out <dir>` · `--list` · `--help`。

ランナーはすべてのコマンドに対して **1 つ**の adb serial を固定するため、電話が
2 回（USB + ワイヤレス）表示される場合でも動作します。`local` ターゲットの場合は、
オンデバイスのアプリがマシン上のスタックに到達できるよう `adb reverse` トンネルを設定します。

---

## 3. 結果を見る

終了すると、要約を表示し、`journey-results/` の下に次を書き出します:

| ファイル                        | 内容                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `latest-report.md`              | **これを読んでください** — journey ごと、ステップごとの ✅/❌、その理由、画面上の testTag、各ステップのスクリーンショットへのリンク |
| `latest-report.json`            | 同じデータ、機械可読                                                                                                                |
| `runs/<runId>/*.png`            | 各ステップのスクリーンショット（pass _も_ fail _も_）                                                                               |
| `runs/<runId>/report.{md,json}` | その特定の run のアーカイブされたレポート                                                                                           |

終了コードは、すべての journey が pass したとき `0`、いずれかが fail したとき `1` です。fail 時には
そのステップが画面上にあったものを正確に記録するため、電話を再操作せずに*理由*を確認できます。

---

## 4. journey がカバーする内容

ライブのセットは `--list` で実行してください。概観として、スイートは次をカバーします:

- **Smoke** — クリーンインストール → 法的同意 → sign-in、backend に到達可能。
- **Cohort sign-in** — adult / minor / admin の personas がアプリ内の
  dev persona picker を介してサインインします。identity は debug overlay と
  Firestore の `cohort` field に対して確認されます。
- **OSA cohort gate** — minor は adult を follow も閲覧もできません（サーバーは
  `404` を返し、Firestore への write は決して発生しません）。一方、同一 cohort の action は
  成功します — gate が cohort 固有であり、一律のブロックではないことを証明します。
- **Admin** — cohort-override はスタッフ専用です（通常の member は
  `422` で拒否され、スタッフアカウントは成功して規制上の audit row を書き込みます）。
- **Moderation** — report → admin suspend（+ audit）→ appeal → unsuspend。完全に
  サーバーで強制され、冪等なクリーンアップを伴います。

journey での認証は常に**アプリ内の dev persona picker** を使用します — 実際の
Google/Apple sign-in は決して使用しません。

> **journey の仕様に関する注記。**
> `journey-tests/j01-j19` の Gherkin プランは、部分的に*理想を述べたもの*です。
> リリース済みアプリには無い UI を参照しています（例: email/password のサインアップ画面、隠された
> minor のタブ、discovery 画面）。そのためランナーは、各 journey の実際の
> 意図を**実際の**アプリ + Firestore + API に対してマッピングし、そうした
> 相違をフィクションで fail させるのではなく findings として記録します。

---

## 5. トラブルシューティング

| 症状                                                            | 対処                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `No adb device found`                                           | 電話を接続／ペアリングし、`adb devices` を確認してください。                                                                            |
| SignIn への到達で停止 / "backend NOT reachable"                 | ローカルスタックが起動していないか、`adb reverse` トンネルが設定されていません — `bash local/start.sh` を再起動して再実行してください。 |
| `persona "<email>" not found in picker`                         | Personas がシードされていません — §1 のシードコマンドを実行してください。                                                               |
| `Firestore assertions: ON` が無い / DB ステップがスキップされる | DB の assert は `--target local` の場合のみ実行されます。                                                                               |
| APK ビルドが失敗する                                            | 表示された `gradle-build.log` を開いてください。Java 21+ と Android SDK がインストールされていることを確認してください。                |
| 予期しない画面でステップが fail する                            | そのステップについて `latest-report.md` に記載されたスクリーンショットを開いてください。                                                |

---

## 6. journey を追加する

journey は `run(device, reporter, ctx)` メソッドを持つプレーンなオブジェクトで、
共有ヘルパーから構成されます:

- `signInAs(device, reporter, ctx, email, nameToken)` — picker を介して persona を
  サインインし、初回起動のインタースティシャルを通って Home まで進みます。
- UI: `tapId` / `waitForId` / `waitForText` / `selectPersonaByText` /
  `tapLowestText`、および `dump(device)` + `byId` / `byText` / `byTextContains`。
- Firestore: `dbGet(ctx.db, path)` / `dbWaitField(...)` / `arrayContains`。
- Server: `getIdToken(email)` → persona の ID token、その後
  `apiCall(method, path, { token, body })`。

各 assertion を `reporter.step(device, 'name', async () => { … })` でラップしてください — これは
ステップの時間を計測し、スクリーンショットを取得し、pass/fail を記録し、fail 時には
画面上の testTag をキャプチャします。新しいオブジェクトを `buildJourneys` の `all` 配列に追加してください。

純粋なロジック（parsing、selectors、arg 処理）は
`tests/scripts/device-journey-runner.test.js`（`cd express-api && npm test`）でユニットテストされます。
device/Firestore/API のレイヤーは、スイートを実機で実行することで統合テストされます。
