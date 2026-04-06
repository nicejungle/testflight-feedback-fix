[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md)

# testflight-feedback-fix

自動パイプライン：TestFlight フィードバック → AI 修正 → ビルド検証 → TestFlight デプロイ。

```
テスターが TestFlight でフィードバックを送信
         ↓ (15分ごとにポーリング)
Mac Mini が App Store Connect API 経由で新しいフィードバックを取得
         ↓
Claude Code がフィードバックを分析しコードを修正（あなたのサブスクリプションを使用）
         ↓
xcodebuild がビルドを検証 + ユニットテストを実行
         ↓ (合格)
main にプッシュ → release にマージ → TestFlight に自動デプロイ
         ↓
テスターが更新されたビルドを取得
```

**費用：$0** — セルフホストランナー（あなたの Mac）+ Claude Code サブスクリプション。API 料金なし、クラウドビルド費用なし。

## 前提条件

- Mac（Mac Mini 推奨、常時稼働）
- [Claude Code](https://claude.ai/code)（有効なサブスクリプション、Max プラン）
- Apple Developer Account（有料）
- iOS プロジェクト用の GitHub リポジトリ
- App Store Connect API キー

## ワンコマンドデプロイ

### Claude Code

iOS プロジェクトのディレクトリで実行：

```bash
claude -p "Install testflight-feedback-fix from https://github.com/nicejungle/testflight-feedback-fix into this project. Read the repo's README, scripts, and workflow files, then: 1) Copy workflows to .github/workflows/, 2) Copy lib/ and scripts/ to the project, 3) Create fastlane/Fastfile with my project name and scheme, 4) Ask me for my Team ID, ASC Key info, and Mac Mini SSH details, 5) Run setup-runner.sh on my Mac Mini, 6) Configure all GitHub secrets"
```

### Codex

```bash
codex "Install testflight-feedback-fix from https://github.com/nicejungle/testflight-feedback-fix into this project. Read the repo's README, scripts, and workflow files, then: 1) Copy workflows to .github/workflows/, 2) Copy lib/ and scripts/ to the project, 3) Create fastlane/Fastfile with my project name and scheme, 4) Ask me for my Team ID, ASC Key info, and Mac Mini SSH details, 5) Run setup-runner.sh on my Mac Mini, 6) Configure all GitHub secrets"
```

## 手動セットアップ

### 1. Mac にランナーをインストール

```bash
git clone https://github.com/nicejungle/testflight-feedback-fix.git
cd testflight-feedback-fix
./scripts/setup-runner.sh
```

### 2. iOS プロジェクトにファイルを追加

```bash
# ワークフロー
mkdir -p your-ios-project/.github/workflows
cp workflows/*.yml your-ios-project/.github/workflows/

# フィードバック取得ツール
cp -r lib/ your-ios-project/lib/
cp -r scripts/ your-ios-project/scripts/

# Fastlane（コピー後に TEAM_ID とプロジェクト名を編集）
mkdir -p your-ios-project/fastlane
cp fastlane/Fastfile your-ios-project/fastlane/Fastfile
```

### 3. プロジェクトを設定

コピーしたファイル内の以下のプレースホルダーを編集：

| プレースホルダー | 置換内容 | ファイル |
|------------------|----------|----------|
| `YourApp.xcodeproj` | あなたの Xcode プロジェクトファイル | `workflows/*.yml`, `fastlane/Fastfile` |
| `YourApp` | あなたのスキーム名 | `workflows/*.yml`, `fastlane/Fastfile` |
| `YourAppTests` | あなたのテストターゲット | `workflows/feedback-autofix.yml` |
| `TEAM_ID` | Apple Developer チーム ID | `fastlane/Fastfile` |
| `OWNER/REPO` | GitHub オーナー/リポジトリ | `setup/*.plist` |

### 4. GitHub Secrets を設定

```bash
gh secret set ASC_KEY_ID --body "your-key-id"
gh secret set ASC_ISSUER_ID --body "your-issuer-id"
gh secret set ASC_KEY_CONTENT < ~/path/to/AuthKey.p8
gh secret set ASC_APP_ID --body "your-numeric-app-id"
gh secret set KEYCHAIN_PASSWORD --body "your-mac-password"
```

| Secret | 説明 | 取得場所 |
|--------|------|----------|
| `ASC_KEY_ID` | API キー ID | [App Store Connect → Keys](https://appstoreconnect.apple.com/access/integrations/api) |
| `ASC_ISSUER_ID` | 発行者 ID | 同ページ上部 |
| `ASC_KEY_CONTENT` | `.p8` ファイルの内容 | キー作成時にダウンロード |
| `ASC_APP_ID` | 数値の App ID | App Store Connect → アプリ情報 → Apple ID |
| `KEYCHAIN_PASSWORD` | Mac のログインパスワード | あなたの Mac のログインパスワード |

### 5. `release` ブランチを作成

```bash
git checkout -b release
git push origin release
```

完了！

## アーキテクチャ

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   TestFlight    │     │    Mac Mini       │     │    TestFlight   │
│   Feedback      │────▶│                  │────▶│   New Build     │
│   (App Store    │poll │  ┌─────────────┐ │push │                 │
│    Connect API) │every│  │ Claude Code │ │to   │                 │
│                 │15min│  │ (auto-fix)  │ │rel. │                 │
└─────────────────┘     │  └──────┬──────┘ │     └─────────────────┘
                        │         │        │
                        │  ┌──────▼──────┐ │
                        │  │  xcodebuild │ │
                        │  │  (verify)   │ │
                        │  └─────────────┘ │
                        └──────────────────┘
```

## 仕組み

### フィードバックポーリング (`feedback-autofix.yml`)

1. **取得** — App Store Connect API を呼び出して最新の TestFlight フィードバックを取得
2. **重複排除** — `processed-feedback.json` により処理済みの項目をスキップ
3. **修正** — Claude Code がコードベースを読み、問題を特定し、修正をコミット
4. **検証** — `xcodebuild build` + ユニットテスト。いずれかが失敗した場合、すべての変更を元に戻す
5. **デプロイ** — `main` にプッシュ → `release` にマージ → リリースワークフローを起動

### リリース (`release.yml`)

1. **ビルド** — App Store Connect API キーによる自動署名でアーカイブ
2. **アップロード** — Fastlane が TestFlight にアップロード
3. **完了** — テスターがアップデートを受け取る

### ポーリングタイマー (`com.testflight-feedback-fix.poll.plist`)

macOS LaunchAgent が 15 分ごとに `gh workflow run` を起動。GitHub Actions の cron よりも信頼性が高い。

## カスタマイズ

### ポーリング間隔

`setup/com.testflight-feedback-fix.poll.plist` を編集：

```xml
<key>StartInterval</key>
<integer>900</integer>  <!-- 秒：900 = 15分、300 = 5分 -->
```

### Claude プロンプト

`workflows/feedback-autofix.yml` 内のプロンプトを編集して、修正の動作、言語、または範囲を変更。

### フィードバックフィルタリング

`scripts/fetch-feedback.ts` を修正して特定の種類をスキップ：

```typescript
const newItems = summary.combined
  .filter(item => !processed.includes(item.id))
  .filter(item => item.source !== 'betaFeedbackCrash'); // クラッシュをスキップ
```

## ファイル構成

```
testflight-feedback-fix/
├── README.md
├── workflows/
│   ├── feedback-autofix.yml    # フィードバック → 修正 → 検証 → デプロイ
│   └── release.yml             # ビルドして TestFlight にアップロード
├── fastlane/
│   └── Fastfile                # ビルド、署名、アップロードテンプレート
├── scripts/
│   ├── setup-runner.sh         # ワンクリック Mac セットアップ
│   ├── fetch-feedback.ts       # App Store Connect フィードバック取得ツール
│   └── package.json            # Node 依存関係
├── setup/
│   └── com.testflight-feedback-fix.poll.plist  # macOS タイマー
└── lib/
    └── app-store-connect.ts    # App Store Connect API クライアント
```

## よくある質問

**Q：費用はいくらですか？**
追加費用 $0。Claude Code は既存のサブスクリプションを使用します。GitHub Actions はセルフホストランナーに対して無料です。

**Q：Claude がバグを導入した場合はどうなりますか？**
パイプラインは修正後に `xcodebuild build` とユニットテストを実行します。いずれかが失敗した場合、すべての変更が元に戻されます。

**Q：新しいフィードバックがない場合はどうなりますか？**
約 3 秒で終了します。Claude は呼び出されません。

**Q：Claude Code なしで使えますか？**
はい — 「Claude 自動修正」ステップを削除すれば、手動のフィードバックからデプロイへのワークフローになります。または別の AI ツールに置き換えることもできます。

**Q：Xcode Cloud で動作しますか？**
セルフホストランナー向けに設計されています。Xcode Cloud を使用するにはワークフローの調整が必要です。

## AGENTS.md / CLAUDE.md

以下をプロジェクトの `CLAUDE.md` または `AGENTS.md` に追加して、AI にコンテキストを提供してください：

```markdown
## TestFlight フィードバック自動修正

このプロジェクトは testflight-feedback-fix を使用してフィードバック処理を自動化しています。
- ワークフロー：`.github/workflows/feedback-autofix.yml`
- リリース：`.github/workflows/release.yml`
- フィードバックは App Store Connect API 経由で 15 分ごとに取得されます
- 対応可能なバグ/UX の問題のみ修正し、機能リクエストはスキップします
- すべての修正はプッシュ前に xcodebuild build + ユニットテストに合格する必要があります
- デプロイブランチ：`release`（release へのプッシュで TestFlight アップロードが起動）
```

## プロジェクトについて

[**石竹株式会社 (ISHITAKE Inc.)**](https://ishitakes.com/) によるオープンソースプロジェクト

## ライセンス

MIT
