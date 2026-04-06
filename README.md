# testflight-feedback-fix

Automated pipeline: TestFlight feedback → AI fix → build verify → TestFlight deploy.

```
Tester submits feedback in TestFlight
         ↓ (15 min poll)
Mac Mini fetches new feedback via App Store Connect API
         ↓
Claude Code analyzes feedback and fixes code (uses your subscription)
         ↓
xcodebuild verifies build + runs unit tests
         ↓ (pass)
Pushes to main → merges to release → auto deploys to TestFlight
         ↓
Tester gets updated build
```

**Cost: $0** — Self-hosted runner (your Mac) + Claude Code subscription. No API fees, no cloud build costs.

## Prerequisites

- Mac (Mac Mini recommended, always-on)
- [Claude Code](https://claude.ai/code) with active subscription (Max plan)
- Apple Developer Account (paid)
- GitHub repository for your iOS project
- App Store Connect API Key

## One-Command Deploy

### Claude Code

In your iOS project directory, run:

```bash
claude -p "Install testflight-feedback-fix from https://github.com/nicejungle/testflight-feedback-fix into this project. Read the repo's README, scripts, and workflow files, then: 1) Copy workflows to .github/workflows/, 2) Copy lib/ and scripts/ to the project, 3) Create fastlane/Fastfile with my project name and scheme, 4) Ask me for my Team ID, ASC Key info, and Mac Mini SSH details, 5) Run setup-runner.sh on my Mac Mini, 6) Configure all GitHub secrets"
```

### Codex

```bash
codex "Install testflight-feedback-fix from https://github.com/nicejungle/testflight-feedback-fix into this project. Read the repo's README, scripts, and workflow files, then: 1) Copy workflows to .github/workflows/, 2) Copy lib/ and scripts/ to the project, 3) Create fastlane/Fastfile with my project name and scheme, 4) Ask me for my Team ID, ASC Key info, and Mac Mini SSH details, 5) Run setup-runner.sh on my Mac Mini, 6) Configure all GitHub secrets"
```

## Manual Setup

### 1. Install the runner on your Mac

```bash
git clone https://github.com/nicejungle/testflight-feedback-fix.git
cd testflight-feedback-fix
./scripts/setup-runner.sh
```

### 2. Add files to your iOS project

```bash
# Workflows
mkdir -p your-ios-project/.github/workflows
cp workflows/*.yml your-ios-project/.github/workflows/

# Feedback fetcher
cp -r lib/ your-ios-project/lib/
cp -r scripts/ your-ios-project/scripts/

# Fastlane (edit TEAM_ID and project name after copying)
mkdir -p your-ios-project/fastlane
cp fastlane/Fastfile your-ios-project/fastlane/Fastfile
```

### 3. Configure your project

Edit these placeholders in the copied files:

| Placeholder | Replace with | Files |
|-------------|-------------|-------|
| `YourApp.xcodeproj` | Your Xcode project file | `workflows/*.yml`, `fastlane/Fastfile` |
| `YourApp` | Your scheme name | `workflows/*.yml`, `fastlane/Fastfile` |
| `YourAppTests` | Your test target | `workflows/feedback-autofix.yml` |
| `TEAM_ID` | Apple Developer Team ID | `fastlane/Fastfile` |
| `OWNER/REPO` | GitHub owner/repo | `setup/*.plist` |

### 4. Configure GitHub Secrets

```bash
gh secret set ASC_KEY_ID --body "your-key-id"
gh secret set ASC_ISSUER_ID --body "your-issuer-id"
gh secret set ASC_KEY_CONTENT < ~/path/to/AuthKey.p8
gh secret set ASC_APP_ID --body "your-numeric-app-id"
gh secret set KEYCHAIN_PASSWORD --body "your-mac-password"
```

| Secret | Description | Where to find |
|--------|-------------|---------------|
| `ASC_KEY_ID` | API Key ID | [App Store Connect → Keys](https://appstoreconnect.apple.com/access/integrations/api) |
| `ASC_ISSUER_ID` | Issuer ID | Same page, top |
| `ASC_KEY_CONTENT` | `.p8` file contents | Downloaded when creating the key |
| `ASC_APP_ID` | Numeric App ID | App Store Connect → App Information → Apple ID |
| `KEYCHAIN_PASSWORD` | Mac login password | Your Mac's login password |

### 5. Create the `release` branch

```bash
git checkout -b release
git push origin release
```

Done!

## Architecture

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

## How It Works

### Feedback Polling (`feedback-autofix.yml`)

1. **Fetch** — Calls App Store Connect API for recent TestFlight feedback
2. **Deduplicate** — Skips already-handled items via `processed-feedback.json`
3. **Fix** — Claude Code reads the codebase, identifies the issue, commits fixes
4. **Verify** — `xcodebuild build` + unit tests. Reverts all changes if either fails
5. **Deploy** — Pushes to `main` → merges to `release` → triggers release workflow

### Release (`release.yml`)

1. **Build** — Archives with automatic signing via App Store Connect API Key
2. **Upload** — Fastlane uploads to TestFlight
3. **Done** — Testers get the update

### Polling Timer (`com.testflight-feedback-fix.poll.plist`)

macOS LaunchAgent triggers `gh workflow run` every 15 minutes. More reliable than GitHub Actions cron.

## Customization

### Polling interval

Edit `setup/com.testflight-feedback-fix.poll.plist`:

```xml
<key>StartInterval</key>
<integer>900</integer>  <!-- seconds: 900 = 15 min, 300 = 5 min -->
```

### Claude prompt

Edit the prompt in `workflows/feedback-autofix.yml` to change fix behavior, language, or scope.

### Feedback filtering

Modify `scripts/fetch-feedback.ts` to skip certain types:

```typescript
const newItems = summary.combined
  .filter(item => !processed.includes(item.id))
  .filter(item => item.source !== 'betaFeedbackCrash'); // skip crashes
```

## File Structure

```
testflight-feedback-fix/
├── README.md
├── workflows/
│   ├── feedback-autofix.yml    # Feedback → fix → verify → deploy
│   └── release.yml             # Build and upload to TestFlight
├── fastlane/
│   └── Fastfile                # Build, sign, upload template
├── scripts/
│   ├── setup-runner.sh         # One-click Mac setup
│   ├── fetch-feedback.ts       # App Store Connect feedback fetcher
│   └── package.json            # Node dependencies
├── setup/
│   └── com.testflight-feedback-fix.poll.plist  # macOS timer
└── lib/
    └── app-store-connect.ts    # App Store Connect API client
```

## FAQ

**Q: How much does this cost?**
$0 extra. Claude Code uses your existing subscription. GitHub Actions is free for self-hosted runners.

**Q: What if Claude introduces a bug?**
The pipeline runs `xcodebuild build` and unit tests after fixes. If either fails, all changes are reverted.

**Q: What if there's no new feedback?**
Exits in ~3 seconds. Claude is never called.

**Q: Can I use this without Claude Code?**
Yes — remove the "Claude auto-fix" step for a manual feedback-to-deploy workflow, or replace with another AI tool.

**Q: Does this work with Xcode Cloud?**
Designed for self-hosted runners. Xcode Cloud would need workflow adaptation.

## AGENTS.md / CLAUDE.md

Add this to your project's `CLAUDE.md` or `AGENTS.md` to give the AI context:

```markdown
## TestFlight Feedback Auto-Fix

This project uses testflight-feedback-fix for automated feedback handling.
- Workflow: `.github/workflows/feedback-autofix.yml`
- Release: `.github/workflows/release.yml`
- Feedback is fetched via App Store Connect API every 15 minutes
- Only actionable bugs/UX issues should be fixed; skip feature requests
- All fixes must pass xcodebuild build + unit tests before pushing
- Deploy branch: `release` (push to release triggers TestFlight upload)
```

## License

MIT
