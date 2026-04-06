#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 8090;
const REPO = process.env.GITHUB_REPO || 'OWNER/REPO'; // UPDATE: your GitHub repo
const PROJECT_ROOT = path.resolve(__dirname, '..');

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT }).trim();
  } catch (e) {
    return '';
  }
}

function getRunner() {
  const raw = exec(`gh api repos/${REPO}/actions/runners --jq '.runners[0] | {name, status, busy}'`);
  try {
    const r = JSON.parse(raw);
    // Check current running job
    const activeRaw = exec(`gh run list --repo ${REPO} --json name,status --jq '[.[] | select(.status == "in_progress")][0].name'`);
    return { ...r, currentJob: activeRaw || null };
  } catch { return { name: 'unknown', status: 'offline', busy: false, currentJob: null }; }
}

function getRuns() {
  const raw = exec(`gh run list --repo ${REPO} --workflow "Feedback Auto-Fix" --limit 10 --json databaseId,name,status,conclusion,createdAt`);
  try {
    const runs = JSON.parse(raw);
    // Also get release runs
    const releaseRaw = exec(`gh run list --repo ${REPO} --workflow "Release to TestFlight" --limit 5 --json databaseId,name,status,conclusion,createdAt`);
    const releaseRuns = JSON.parse(releaseRaw || '[]').map(r => ({ ...r, name: '🚀 ' + r.name }));
    return [...runs, ...releaseRuns].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
  } catch { return []; }
}

function getDismissed() {
  const dismissedFile = path.join(PROJECT_ROOT, '.github', 'dismissed-feedback.json');
  try { return JSON.parse(fs.readFileSync(dismissedFile, 'utf8')); } catch { return []; }
}

function getFeedback() {
  // Get processed IDs
  const processedFile = path.join(PROJECT_ROOT, '.github', 'processed-feedback.json');
  let processed = [];
  try { processed = JSON.parse(fs.readFileSync(processedFile, 'utf8')); } catch {}

  // Fetch all feedback from API
  const keyPath = path.join(process.env.HOME, '.appstoreconnect/private_keys/AuthKey_${process.env.ASC_KEY_ID || 'YOUR_KEY_ID'}.p8');
  let privateKey = '';
  try { privateKey = fs.readFileSync(keyPath, 'utf8'); } catch {}

  const allRaw = exec(`cd ${PROJECT_ROOT} && ASC_KEY_ID=${process.env.ASC_KEY_ID || 'YOUR_KEY_ID'} ASC_ISSUER_ID=${process.env.ASC_ISSUER_ID || 'YOUR_ISSUER_ID'} ASC_PRIVATE_KEY="${privateKey.replace(/"/g, '\\"')}" ASC_APP_ID=${process.env.ASC_APP_ID || 'YOUR_APP_ID'} npx tsx scripts/fetch-all-feedback.ts 2>/dev/null`);

  let all = [];
  try { all = JSON.parse(allRaw); } catch {}

  const dismissed = getDismissed();

  // Get currently processing feedback IDs (from the in-progress run's /tmp/feedback.json)
  let processing = [];
  try {
    const raw = fs.readFileSync('/tmp/feedback.json', 'utf8');
    processing = JSON.parse(raw).map(f => f.id);
  } catch {}

  // Get next poll time from launchd
  let nextPoll = null;
  try {
    const logRaw = fs.readFileSync('/tmp/feedback-poll.log', 'utf8');
    const lastLine = logRaw.trim().split('\n').pop();
    const match = lastLine.match(/^(.+?):/);
    if (match) {
      const lastTime = new Date(match[1]);
      nextPoll = new Date(lastTime.getTime() + 15 * 60 * 1000).toISOString();
    }
  } catch {}

  return { all, processed, dismissed, processing, nextPoll };
}

function getFixes() {
  const raw = exec(`git -C ${PROJECT_ROOT} log --oneline --format='{"sha":"%H","message":"%s","date":"%aI"}' main --grep="^fix:" -20`);
  try {
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch { return []; }
}

function getLiveLog() {
  // Find the in-progress run
  const activeRaw = exec(`gh run list --repo ${REPO} --workflow "Feedback Auto-Fix" --json databaseId,status --jq '[.[] | select(.status == "in_progress")][0].databaseId'`);
  if (!activeRaw) return { active: false, runId: null, log: [] };

  const runId = activeRaw.trim();
  // Get the current step
  const stepsRaw = exec(`gh run view ${runId} --repo ${REPO} --json jobs --jq '.jobs[0].steps[] | "\\(.status) \\(.conclusion // "-") \\(.name)"'`);
  const steps = stepsRaw.split('\n').filter(Boolean).map(line => {
    const [status, conclusion, ...nameParts] = line.split(' ');
    return { status, conclusion, name: nameParts.join(' ') };
  });

  // Read Claude's live output from local file
  let logLines = [];
  try {
    const raw = fs.readFileSync('/tmp/claude-live.log', 'utf8');
    logLines = raw.split('\n')
      .map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
      .filter(l => l.length > 0)
      .slice(-50);
  } catch {}

  return { active: true, runId, steps, log: logLines };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api') {
    const cmd = url.searchParams.get('cmd');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    let data;
    switch (cmd) {
      case 'runner': data = getRunner(); break;
      case 'runs': data = getRuns(); break;
      case 'feedback': data = getFeedback(); break;
      case 'fixes': data = getFixes(); break;
      case 'livelog': data = getLiveLog(); break;
      case 'cancel': {
        const runId = url.searchParams.get('runId');
        if (runId) {
          exec(`gh run cancel ${runId} --repo ${REPO}`);
          data = { ok: true, cancelled: runId };
        } else {
          // Cancel all active
          const active = exec(`gh run list --repo ${REPO} --json databaseId,status --jq '[.[] | select(.status != "completed")] | .[].databaseId'`);
          active.split('\n').filter(Boolean).forEach(id => exec(`gh run cancel ${id} --repo ${REPO}`));
          data = { ok: true, cancelled: 'all' };
        }
        break;
      }
      case 'trigger': {
        exec(`gh workflow run "Feedback Auto-Fix" --ref main --repo ${REPO}`);
        data = { ok: true, triggered: true };
        break;
      }
      case 'dismiss': {
        const feedbackId = url.searchParams.get('id');
        if (feedbackId) {
          // Add to dismissed list
          const dismissedFile = path.join(PROJECT_ROOT, '.github', 'dismissed-feedback.json');
          let dismissed = [];
          try { dismissed = JSON.parse(fs.readFileSync(dismissedFile, 'utf8')); } catch {}
          if (!dismissed.includes(feedbackId)) {
            dismissed.push(feedbackId);
            fs.writeFileSync(dismissedFile, JSON.stringify(dismissed));
          }
          // Also add to processed so it won't trigger auto-fix
          const processedFile = path.join(PROJECT_ROOT, '.github', 'processed-feedback.json');
          let processed = [];
          try { processed = JSON.parse(fs.readFileSync(processedFile, 'utf8')); } catch {}
          if (!processed.includes(feedbackId)) {
            processed.push(feedbackId);
            fs.writeFileSync(processedFile, JSON.stringify(processed));
          }
          exec(`cd ${PROJECT_ROOT} && git add .github/processed-feedback.json .github/dismissed-feedback.json && git commit -m "chore: dismiss feedback" && git push origin main`);
          data = { ok: true, dismissed: feedbackId };
        } else {
          data = { error: 'missing id' };
        }
        break;
      }
      case 'fix-one': {
        const feedbackId = url.searchParams.get('id');
        if (feedbackId) {
          exec(`gh workflow run "Feedback Auto-Fix" --ref main --repo ${REPO} -f feedback_id=${feedbackId}`);
          data = { ok: true, triggered: true, feedbackId };
        } else {
          data = { error: 'missing id' };
        }
        break;
      }
      default: data = { error: 'unknown cmd' };
    }
    res.end(JSON.stringify(data));
    return;
  }

  // Serve dashboard.html
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Tailscale: http://$(hostname):${PORT}`);
});
