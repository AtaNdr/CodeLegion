// Remediation routes: POST /setup/action/:id, /setup/upload-*

import express from 'express';
import { fixers, ensureBaseAppSettings } from './fixers.js';
import { runOne } from './runner.js';
import { setAppSettings } from '../azure/app-settings.js';
import { normalizePrivateKey } from '../github/pem.js';
import { clearTokenCache } from '../github/app.js';

export const setupActionsRouter = express.Router();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Re-run a check up to N times, with delays in between, stopping early on
// green. Handles ARM list eventual-consistency: a freshly-created resource
// may not appear in list() for a few seconds.
async function reverifyWithRetries(id, delays = [1500, 3000, 5000]) {
  let last = null;
  for (let i = 0; i < delays.length; i++) {
    await sleep(delays[i]);
    try {
      last = await runOne(id);
      if (last?.status === 'green') return last;
    } catch (e) {
      last = { status: 'red', detail: e.message || String(e), ranAt: new Date().toISOString() };
    }
  }
  return last;
}

// Single check run with a brief initial delay — fast path for things that
// don't need the ARM eventual-consistency retries (GitHub API + Anthropic
// API are strongly consistent on writes).
async function reverifyOnce(id, delayMs = 500) {
  await sleep(delayMs);
  try {
    return await runOne(id);
  } catch (e) {
    return { status: 'red', detail: e.message || String(e), ranAt: new Date().toISOString() };
  }
}

setupActionsRouter.post('/setup/action/:id', async (req, res) => {
  const id = req.params.id;
  const fixer = fixers[id];
  if (!fixer) return res.status(400).json({ error: `No fixer registered for ${id}` });
  try {
    const fixResult = await fixer();
    // Auto re-verify with retries. runOne() persists each result, so the
    // last attempt overwrites the state — the UI will reflect whatever the
    // re-check actually found.
    const verified = await reverifyWithRetries(id);
    res.json({ fix: fixResult, check: verified });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

setupActionsRouter.post('/setup/bootstrap', async (_req, res) => {
  // Write controller-generated base settings (REPORT_TOKEN, GH_WEBHOOK_SECRET,
  // CONTROLLER_PUBLIC_URL, AGENT_SCRIPTS_URL). Idempotent.
  try {
    const keys = await ensureBaseAppSettings();
    res.json({ ok: true, written: Object.keys(keys) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Surface the webhook URL + secret the user needs when creating their GitHub
// App on github.com. Generates the secret if it doesn't exist yet so the user
// always has something to paste.
setupActionsRouter.get('/setup/gh-app-prep', async (_req, res) => {
  try {
    // Triggers REPORT_TOKEN + GH_WEBHOOK_SECRET + URL settings if any are missing.
    await ensureBaseAppSettings();
    const host = process.env.WEBSITE_HOSTNAME || (process.env.CONTROLLER_PUBLIC_URL || '').replace(/^https?:\/\//, '');
    res.json({
      webhookUrl: host ? `https://${host}/webhook` : null,
      webhookSecret: process.env.GH_WEBHOOK_SECRET || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

setupActionsRouter.post('/setup/upload-anthropic-key', async (req, res) => {
  const key = (req.body?.apiKey || '').trim();
  if (!key) return res.status(400).json({ error: 'apiKey required' });
  if (!key.startsWith('sk-')) return res.status(400).json({ error: 'key does not look like a Claude API key (expected sk-...)' });
  try {
    await setAppSettings({ ANTHROPIC_API_KEY: key });
    process.env.ANTHROPIC_API_KEY = key;
    const check = await reverifyOnce('anthropic');
    res.json({ ok: true, check });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

setupActionsRouter.post('/setup/upload-gh-key', async (req, res) => {
  const raw = (req.body?.privateKey || '').trim();
  if (!raw) return res.status(400).json({ error: 'privateKey required (PEM)' });
  const normalized = normalizePrivateKey(raw);
  if (!normalized || !normalized.includes('PRIVATE KEY')) {
    return res.status(400).json({ error: 'Could not parse as PEM private key' });
  }
  try {
    await setAppSettings({ GH_APP_PRIVATE_KEY: normalized });
    process.env.GH_APP_PRIVATE_KEY = normalized;
    clearTokenCache();
    // Re-verify the GitHub App check now that PEM + (presumably) IDs are set.
    // This is the second call in the Configure App flow, so by now everything
    // the check needs is in place.
    const check = await reverifyOnce('githubApp');
    res.json({ ok: true, check });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

setupActionsRouter.post('/setup/upload-gh-config', async (req, res) => {
  const { appId, installationId, owner, repo } = req.body || {};
  const patch = {};
  if (appId) patch.GH_APP_ID = String(appId);
  if (installationId) patch.GH_INSTALLATION_ID = String(installationId);
  if (owner) patch.GH_REPO_OWNER = String(owner);
  if (repo) patch.GH_REPO_NAME = String(repo);
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'no fields' });
  try {
    await setAppSettings(patch);
    for (const [k, v] of Object.entries(patch)) process.env[k] = v;
    clearTokenCache();
    // No reverify here — the modal flow calls upload-gh-key right after,
    // which DOES reverify. Avoids running the check twice and wasting an
    // API call against /app/installations.
    res.json({ ok: true, written: Object.keys(patch) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
