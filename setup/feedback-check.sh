#!/bin/bash
# Smart trigger: only dispatches workflow if no job is already running/queued.
# This prevents duplicate runs and wasted runner time.

export PATH=/opt/homebrew/bin:$PATH
REPO="${FEEDBACK_FIX_REPO:-OWNER/REPO}"

# Skip if a Feedback Auto-Fix job is already running or queued
ACTIVE=$(gh run list --repo "$REPO" --workflow 'Feedback Auto-Fix' --json status -q '[.[] | select(.status != "completed")] | length' 2>/dev/null)
if [ "$ACTIVE" -gt 0 ]; then
  echo "$(date): Skipping — $ACTIVE job(s) already active"
  exit 0
fi

gh workflow run 'Feedback Auto-Fix' --ref main --repo "$REPO"
echo "$(date): Triggered workflow"
