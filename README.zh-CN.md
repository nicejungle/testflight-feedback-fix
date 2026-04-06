[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md)

# testflight-feedback-fix

自动化流水线：TestFlight 反馈 → AI 修复 → 构建验证 → TestFlight 部署。

```
测试人员在 TestFlight 中提交反馈
         ↓ (每 15 分钟轮询)
Mac Mini 通过 App Store Connect API 获取新反馈
         ↓
Claude Code 分析反馈并修复代码（使用你的订阅）
         ↓
xcodebuild 验证构建 + 运行单元测试
         ↓ (通过)
推送到 main → 合并到 release → 自动部署到 TestFlight
         ↓
测试人员获取更新版本
```

**费用：$0** — 自托管运行器（你的 Mac）+ Claude Code 订阅。无 API 费用，无云构建成本。

## 前提条件

- Mac（推荐 Mac Mini，保持常开）
- [Claude Code](https://claude.ai/code)，需有效订阅（Max 计划）
- Apple 开发者账户（付费）
- 用于 iOS 项目的 GitHub 仓库
- App Store Connect API 密钥

## 一键部署

### Claude Code

在你的 iOS 项目目录中运行：

```bash
claude -p "Install testflight-feedback-fix from https://github.com/nicejungle/testflight-feedback-fix into this project. Read the repo's README, scripts, and workflow files, then: 1) Copy workflows to .github/workflows/, 2) Copy lib/ and scripts/ to the project, 3) Create fastlane/Fastfile with my project name and scheme, 4) Ask me for my Team ID, ASC Key info, and Mac Mini SSH details, 5) Run setup-runner.sh on my Mac Mini, 6) Configure all GitHub secrets"
```

### Codex

```bash
codex "Install testflight-feedback-fix from https://github.com/nicejungle/testflight-feedback-fix into this project. Read the repo's README, scripts, and workflow files, then: 1) Copy workflows to .github/workflows/, 2) Copy lib/ and scripts/ to the project, 3) Create fastlane/Fastfile with my project name and scheme, 4) Ask me for my Team ID, ASC Key info, and Mac Mini SSH details, 5) Run setup-runner.sh on my Mac Mini, 6) Configure all GitHub secrets"
```

## 手动设置

### 1. 在你的 Mac 上安装运行器

```bash
git clone https://github.com/nicejungle/testflight-feedback-fix.git
cd testflight-feedback-fix
./scripts/setup-runner.sh
```

### 2. 将文件添加到你的 iOS 项目

```bash
# 工作流
mkdir -p your-ios-project/.github/workflows
cp workflows/*.yml your-ios-project/.github/workflows/

# 反馈获取器
cp -r lib/ your-ios-project/lib/
cp -r scripts/ your-ios-project/scripts/

# Fastlane（复制后编辑 TEAM_ID 和项目名称）
mkdir -p your-ios-project/fastlane
cp fastlane/Fastfile your-ios-project/fastlane/Fastfile
```

### 3. 配置你的项目

编辑已复制文件中的以下占位符：

| 占位符 | 替换为 | 文件 |
|--------|--------|------|
| `YourApp.xcodeproj` | 你的 Xcode 项目文件 | `workflows/*.yml`, `fastlane/Fastfile` |
| `YourApp` | 你的 scheme 名称 | `workflows/*.yml`, `fastlane/Fastfile` |
| `YourAppTests` | 你的测试目标 | `workflows/feedback-autofix.yml` |
| `TEAM_ID` | Apple 开发者团队 ID | `fastlane/Fastfile` |
| `OWNER/REPO` | GitHub 所有者/仓库 | `setup/*.plist` |

### 4. 配置 GitHub Secrets

```bash
gh secret set ASC_KEY_ID --body "your-key-id"
gh secret set ASC_ISSUER_ID --body "your-issuer-id"
gh secret set ASC_KEY_CONTENT < ~/path/to/AuthKey.p8
gh secret set ASC_APP_ID --body "your-numeric-app-id"
gh secret set KEYCHAIN_PASSWORD --body "your-mac-password"
```

| Secret | 描述 | 获取位置 |
|--------|------|----------|
| `ASC_KEY_ID` | API 密钥 ID | [App Store Connect → Keys](https://appstoreconnect.apple.com/access/integrations/api) |
| `ASC_ISSUER_ID` | 颁发者 ID | 同一页面顶部 |
| `ASC_KEY_CONTENT` | `.p8` 文件内容 | 创建密钥时下载 |
| `ASC_APP_ID` | 数字 App ID | App Store Connect → 应用信息 → Apple ID |
| `KEYCHAIN_PASSWORD` | Mac 登录密码 | 你的 Mac 登录密码 |

### 5. 创建 `release` 分支

```bash
git checkout -b release
git push origin release
```

完成！

## 架构

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

## 工作原理

### 反馈轮询 (`feedback-autofix.yml`)

1. **获取** — 调用 App Store Connect API 获取最近的 TestFlight 反馈
2. **去重** — 通过 `processed-feedback.json` 跳过已处理的条目
3. **修复** — Claude Code 阅读代码库，识别问题，提交修复
4. **验证** — `xcodebuild build` + 单元测试。如果任一失败，回滚所有更改
5. **部署** — 推送到 `main` → 合并到 `release` → 触发发布工作流

### 发布 (`release.yml`)

1. **构建** — 使用 App Store Connect API 密钥通过自动签名进行归档
2. **上传** — Fastlane 上传到 TestFlight
3. **完成** — 测试人员收到更新

### 轮询定时器 (`com.testflight-feedback-fix.poll.plist`)

macOS LaunchAgent 每 15 分钟触发一次 `gh workflow run`。比 GitHub Actions cron 更可靠。

## 自定义

### 轮询间隔

编辑 `setup/com.testflight-feedback-fix.poll.plist`：

```xml
<key>StartInterval</key>
<integer>900</integer>  <!-- 秒：900 = 15 分钟，300 = 5 分钟 -->
```

### Claude 提示词

编辑 `workflows/feedback-autofix.yml` 中的提示词以更改修复行为、语言或范围。

### 反馈过滤

修改 `scripts/fetch-feedback.ts` 以跳过某些类型：

```typescript
const newItems = summary.combined
  .filter(item => !processed.includes(item.id))
  .filter(item => item.source !== 'betaFeedbackCrash'); // 跳过崩溃
```

## 文件结构

```
testflight-feedback-fix/
├── README.md
├── workflows/
│   ├── feedback-autofix.yml    # 反馈 → 修复 → 验证 → 部署
│   └── release.yml             # 构建并上传到 TestFlight
├── fastlane/
│   └── Fastfile                # 构建、签名、上传模板
├── scripts/
│   ├── setup-runner.sh         # 一键 Mac 设置
│   ├── fetch-feedback.ts       # App Store Connect 反馈获取器
│   └── package.json            # Node 依赖
├── setup/
│   └── com.testflight-feedback-fix.poll.plist  # macOS 定时器
└── lib/
    └── app-store-connect.ts    # App Store Connect API 客户端
```

## 常见问题

**问：这要花多少钱？**
额外费用 $0。Claude Code 使用你现有的订阅。GitHub Actions 对自托管运行器免费。

**问：如果 Claude 引入了 bug 怎么办？**
流水线会在修复后运行 `xcodebuild build` 和单元测试。如果任一失败，所有更改将被回滚。

**问：如果没有新反馈怎么办？**
约 3 秒内退出。不会调用 Claude。

**问：可以不用 Claude Code 吗？**
可以 — 移除"Claude 自动修复"步骤即可使用手动的反馈到部署工作流，或替换为其他 AI 工具。

**问：这能与 Xcode Cloud 配合使用吗？**
本项目为自托管运行器设计。使用 Xcode Cloud 需要调整工作流。

## AGENTS.md / CLAUDE.md

将以下内容添加到你项目的 `CLAUDE.md` 或 `AGENTS.md` 中，为 AI 提供上下文：

```markdown
## TestFlight 反馈自动修复

本项目使用 testflight-feedback-fix 进行自动化反馈处理。
- 工作流：`.github/workflows/feedback-autofix.yml`
- 发布：`.github/workflows/release.yml`
- 每 15 分钟通过 App Store Connect API 获取反馈
- 仅修复可操作的 bug/用户体验问题；跳过功能请求
- 所有修复必须通过 xcodebuild build + 单元测试后才能推送
- 部署分支：`release`（推送到 release 触发 TestFlight 上传）
```

## 许可证

MIT
