#!/bin/bash
set -euo pipefail

echo "=== testflight-feedback-fix setup ==="
echo ""

# Check requirements
command -v xcodebuild >/dev/null || { echo "Error: Xcode not installed"; exit 1; }

# Get config from user
read -p "GitHub repo (owner/repo): " REPO
read -p "Mac login password: " -s KEYCHAIN_PWD
echo ""

# 1. Install Homebrew if needed
if ! command -v brew &>/dev/null; then
  echo "Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
fi

# 2. Install dependencies
echo "Installing dependencies..."
brew install fastlane gh node 2>/dev/null || true
npm install -g @anthropic-ai/claude-code 2>/dev/null || true

# 3. Login to GitHub CLI
if ! gh auth status &>/dev/null; then
  echo "Please login to GitHub:"
  gh auth login
fi

# 4. Setup GitHub Actions runner
echo "Setting up GitHub Actions runner..."
RUNNER_DIR=~/actions-runner
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | grep tag_name | cut -d'"' -f4 | sed 's/v//')
curl -sL -o actions-runner.tar.gz "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
tar xzf actions-runner.tar.gz

TOKEN=$(gh api -X POST "repos/${REPO}/actions/runners/registration-token" --jq '.token')
./config.sh --url "https://github.com/${REPO}" --token "$TOKEN" --name "$(hostname -s)" --labels self-hosted,macOS,ARM64 --unattended --replace
./svc.sh install
./svc.sh start

# 5. Configure keychain for headless signing
echo "Configuring keychain..."
security unlock-keychain -p "$KEYCHAIN_PWD" ~/Library/Keychains/login.keychain-db
security set-keychain-settings -t 86400 ~/Library/Keychains/login.keychain-db
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PWD" ~/Library/Keychains/login.keychain-db >/dev/null 2>&1

# 6. Allow passwordless xcode-select
echo "$KEYCHAIN_PWD" | sudo -S sh -c "echo '$(whoami) ALL=(ALL) NOPASSWD: /usr/bin/xcode-select' > /etc/sudoers.d/xcode-select && chmod 0440 /etc/sudoers.d/xcode-select"

# 7. Setup polling timer
echo "Setting up 15-minute polling timer..."
PLIST=~/Library/LaunchAgents/com.testflight-feedback-fix.poll.plist
sed "s|OWNER/REPO|${REPO}|g" "$(dirname "$0")/../setup/com.testflight-feedback-fix.poll.plist" > "$PLIST"
launchctl load "$PLIST"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Login to Claude Code:  claude"
echo "2. Login to Xcode: Open Xcode → Settings → Accounts → Add Apple ID"
echo "3. Add GitHub Secrets: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_CONTENT, ASC_APP_ID, KEYCHAIN_PASSWORD"
echo "4. Copy workflows/ to your project's .github/workflows/"
echo "5. Create a 'release' branch: git checkout -b release && git push origin release"
