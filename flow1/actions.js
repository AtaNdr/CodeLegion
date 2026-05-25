// Remediation routes: POST /setup/action/:id, /setup/upload-*

import express from 'express';
import { fixers, ensureBaseAppSettings } from './fixers.js';
import { runOne } from './runner.js';
import { setAppSettings } from '../azure/app-settings.js';
import { normalizePrivateKey } from '../github/pem.js';
import { clearTokenCache } from '../github/app.js';

export const setupActionsRouter = express.Router();

setupActionsRouter.post('/setup/action/:id', async (req, res) => {
  const id = req.params.id;
  const fixer = fixers[id];
  if (!fixer) return res.status(400).json({ error: `No fixer registered for ${id}` });
  try {
    const result = await fixer();
    // Re-run the corresponding check to refresh the persisted status.
    await runOne(id).catch(() => {});
    res.json(result);
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

setupActionsRouter.post('/setup/upload-anthropic-key', async (req, res) => {
  const key = (req.body?.apiKey || '').trim();
  if (!key) return res.status(400).json({ error: 'apiKey required' });
  if (!key.startsWith('sk-')) return res.status(400).json({ error: 'key does not look like a Claude API key (expected sk-...)' });
  try {
    await setAppSettings({ ANTHROPIC_API_KEY: key });
    process.env.ANTHROPIC_API_KEY = key;  // make it available this process before restart
    res.json({ ok: true, note: 'Settings updated. The Web App will restart automatically.' });
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
    res.json({ ok: true });
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
    res.json({ ok: true, written: Object.keys(patch) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
