# Troubleshooting

Common issues encountered during setup and operation, with solutions.

## Fetch Feedback

### `Cannot find module './lib/app-store-connect'`
**Cause:** Using `node` to run TypeScript files directly.
**Fix:** Use `npx tsx` instead of `node`. The workflow template already handles this.

### `Top-level await is currently not supported with the "cjs" output format`
**Cause:** Inline TypeScript with `npx tsx -e` using top-level `await`.
**Fix:** Use a script file with `async function main()` wrapper. Already fixed in `scripts/fetch-feedback.ts`.

## Push & Deploy

### `403 Write access denied`
**Cause:** Workflow missing write permissions.
**Fix:** Ensure workflow has:
```yaml
permissions:
  contents: write
```

### `! [rejected] main -> main (fetch first)`
**Cause:** Remote `main` has new commits pushed while workflow was running.
**Fix:** The workflow now runs `git pull origin main --rebase` before pushing. If this still fails, the next poll cycle will pick it up.

### `CONFLICT: Merge conflict in ...`
**Cause:** `release` branch diverged from `main`.
**Fix:** The workflow uses `git merge main --no-edit -X theirs` which auto-resolves by favoring `main`. If this fails, it falls back to `git checkout --theirs . && git add -A && git commit`.

## Code Signing

### `errSecInternalComponent`
**Cause:** Keychain locked or codesign not allowed in non-interactive session.
**Fix:** The workflow unlocks keychain and sets partition list:
```bash
security unlock-keychain -p "$PASSWORD" ~/Library/Keychains/login.keychain-db
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASSWORD" ~/Library/Keychains/login.keychain-db
```

### `No profiles for 'com.xxx' were found`
**Cause:** No provisioning profiles on the build machine.
**Fix:** Use `-allowProvisioningUpdates` with API key authentication in Fastlane:
```ruby
xcargs: "-allowProvisioningUpdates -authenticationKeyPath '...' -authenticationKeyID '...' -authenticationKeyIssuerID '...'"
```

### `sudo: a terminal is required to read the password`
**Cause:** `sudo xcode-select` needs password in headless environment.
**Fix:** Add passwordless sudo for xcode-select:
```bash
echo "$(whoami) ALL=(ALL) NOPASSWD: /usr/bin/xcode-select" | sudo tee /etc/sudoers.d/xcode-select
```
The `setup-runner.sh` script handles this automatically.

## Runner

### GitHub Actions cron not triggering
**Cause:** GitHub Actions schedule can be delayed or skipped for inactive repos.
**Fix:** Use the macOS LaunchAgent timer instead (included in `setup/`). It calls `gh workflow run` locally every 15 minutes, which is more reliable.

### Runner service not starting after reboot
**Fix:** Verify the LaunchAgent is loaded:
```bash
launchctl list | grep actions.runner
launchctl list | grep testflight-feedback-fix
```
If missing, reload:
```bash
launchctl load ~/Library/LaunchAgents/actions.runner.*.plist
launchctl load ~/Library/LaunchAgents/com.testflight-feedback-fix.poll.plist
```

## Build

### `CFBundleIdentifier not found in Info.plist`
**Cause:** Info.plist missing standard bundle keys.
**Fix:** Ensure your Info.plist contains:
```xml
<key>CFBundleIdentifier</key>
<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleVersion</key>
<string>$(CURRENT_PROJECT_VERSION)</string>
```

### `The -authenticationKeyPath flag must be an absolute path`
**Cause:** Relative path passed to xcodebuild.
**Fix:** Use `File.expand_path()` in Fastlane or `$HOME` absolute path in workflow.
