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

## Quick Start

### 1. Install the runner on your Mac

```bash
./scripts/setup-runner.sh
```

This will:
- Install GitHub Actions self-hosted runner
- Install Homebrew, Fastlane, Claude Code
- Configure keychain for headless code signing
- Set up a 15-minute polling timer

### 2. Copy workflow files to your project

```bash
cp -r workflows/ your-ios-project/.github/workflows/
cp -r scripts/fetch-feedback.ts your-ios-project/scripts/
```

### 3. Configure GitHub Secrets

| Secret | Description | Where to find |
|--------|-------------|---------------|
| `ASC_KEY_ID` | App Store Connect API Key ID | [App Store Connect → Keys](https://appstoreconnect.apple.com/access/integrations/api) |
| `ASC_ISSUER_ID` | API Key Issuer ID | Same page, top of the page |
| `ASC_KEY_CONTENT` | `.p8` file contents | Downloaded when creating the key |
| `ASC_APP_ID` | Numeric App ID | App Store Connect → App Information → Apple ID |
| `KEYCHAIN_PASSWORD` | Mac login password | Your Mac's login password |

### 4. Configure Fastlane

Copy the `Fastfile` template and update your team ID:

```bash
cp fastlane/Fastfile your-ios-project/fastlane/Fastfile
# Edit: replace TEAM_ID with your Apple Developer Team ID
```

### 5. Create the `release` branch

```bash
git checkout -b release
git push origin release
```

Done! The pipeline will now:
- Poll for TestFlight feedback every 15 minutes
- Auto-fix actionable bugs with Claude Code
- Build-verify before pushing
- Deploy to TestFlight on push to `release`

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

1. **Fetch** — Calls App Store Connect API to get recent TestFlight feedback (screenshots, crashes)
2. **Deduplicate** — Compares against `processed-feedback.json` to skip already-handled items
3. **Fix** — Sends feedback to Claude Code, which reads the codebase, identifies the issue, and commits fixes
4. **Verify** — Runs `xcodebuild build` + unit tests. If either fails, reverts all changes
5. **Deploy** — Pushes to `main`, merges to `release`, which triggers the release workflow

### Release (`release.yml`)

1. **Build** — Archives the app with automatic signing via App Store Connect API Key
2. **Upload** — Fastlane uploads the `.ipa` to TestFlight
3. **Done** — Testers get the update automatically

### Polling Timer (`com.testflight-feedback-fix.poll.plist`)

A macOS LaunchAgent that runs `gh workflow run` every 15 minutes. More reliable than GitHub Actions cron, which can be delayed or skipped for inactive repos.

## Customization

### Change polling interval

Edit `setup/com.testflight-feedback-fix.poll.plist`:

```xml
<key>StartInterval</key>
<integer>900</integer>  <!-- seconds: 900 = 15 min -->
```

### Change Claude's fix behavior

Edit the prompt in `workflows/feedback-autofix.yml`:

```yaml
- name: Claude auto-fix
  run: |
    claude -p "Your custom instructions here..." \
    --print --dangerously-skip-permissions
```

### Skip certain feedback types

Modify `scripts/fetch-feedback.ts` to filter by source:

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
│   └── fetch-feedback.ts       # App Store Connect feedback fetcher
├── setup/
│   └── com.testflight-feedback-fix.poll.plist  # macOS timer
└── lib/
    └── app-store-connect.ts    # App Store Connect API client
```

## FAQ

**Q: How much does this cost?**
A: $0 extra. Claude Code runs on your existing subscription. The Mac Mini is yours. GitHub Actions is free for self-hosted runners.

**Q: What if Claude introduces a bug?**
A: The pipeline runs `xcodebuild build` and unit tests after Claude's fixes. If either fails, all changes are reverted and nothing is pushed.

**Q: What if there's no new feedback?**
A: The workflow checks, finds 0 new items, and exits in ~3 seconds. Claude is never called, no resources used.

**Q: Can I use this without Claude Code?**
A: Yes — remove the "Claude auto-fix" step and use the pipeline as a manual feedback-to-deploy workflow. Or replace Claude with any other AI tool.

**Q: Does this work with Xcode Cloud?**
A: This is designed for self-hosted runners. For Xcode Cloud, you'd need to adapt the release workflow.

## License

MIT
