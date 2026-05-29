// CodeLegion — controller entrypoint.

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, missingRequiredConfig } from './config.js';
import { discoverAll } from './azure/discovery.js';
import { readState, updateState } from './state.js';
import { flow1Router } from './flow1/routes.js';
import { setupActionsRouter } from './flow1/actions.js';
import { flow2Router } from './flow2/routes.js';
import { renderPage } from './ui/render.js';
import { renderFleet } from './ui/sections/fleet.js';
import { renderCost } from './ui/sections/cost.js';
import { getResults, summarize } from './flow1/runner.js';
import { fleetSnapshot } from './flow2/vmlist.js';
import { readRecent, todayMonthTotals } from './flow2/cost.js';
import { startRetirementSweep } from './flow2/retirement.js';
import { startReconcileLoop } from './flow2/reconcile.js';
import { getAppSetting, setAppSettings } from './azure/app-settings.js';
import { getUpdateInfo } from './azure/self-update.js';
import {
  requireDashboardAuth, verifyPassword, setSessionCookie, clearSessionCookie,
  isAuthConfigured,
} from './flow2/auth.js';
import { renderLoginPage } from './ui/sections/login.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Webhook needs raw body for HMAC signature verify; mount the raw parser ONLY
// on /webhook and JSON parser on the rest.
app.use('/webhook', express.raw({ type: '*/*', limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));  // for /login form

// Static: agent scripts tarball + individual scripts. Mounted before auth
// so agents (which have no cookie) can fetch them.
app.use('/scripts', express.static(path.join(__dirname, 'scripts-static'), {
  fallthrough: true,
  dotfiles: 'ignore',
}));

// ---- Auth (dashboard login) --------------------------------------
// Login routes are themselves public (they're how you get a cookie).
app.get('/login', (req, res) => {
  if (!isAuthConfigured()) return res.redirect('/');  // legacy open mode
  res.type('text/html').send(renderLoginPage({ returnTo: req.query.return || '/' }));
});

app.post('/login', (req, res) => {
  if (!isAuthConfigured()) return res.redirect('/');
  const password = (req.body && req.body.password) || '';
  const returnTo = (req.body && req.body.return) || '/';
  if (verifyPassword(password, process.env.DASHBOARD_PASSWORD_HASH)) {
    setSessionCookie(res);
    return res.redirect(returnTo);
  }
  res.status(401).type('text/html').send(renderLoginPage({
    error: 'Wrong password.',
    returnTo,
  }));
});

app.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.redirect('/login');
});

// Everything mounted AFTER this middleware requires a valid session cookie,
// EXCEPT the bypass list inside requireDashboardAuth (agent/*, webhook,
// health, login, scripts). If DASHBOARD_PASSWORD_HASH is unset, the
// middleware no-ops and the dashboard stays open (legacy behaviour).
app.use(requireDashboardAuth);

// ---- API ---------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true, version: config.version }));

app.get('/api/version', async (_req, res) => {
  let update = null;
  try { update = await getUpdateInfo(); } catch {}
  res.json({
    version: config.version,
    commit: config.commit,
    buildDate: config.buildDate,
    update,
  });
});

app.get('/api/discovery', async (_req, res) => {
  try { res.json(await discoverAll()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/state', (_req, res) => res.json(readState()));

// Flow 1 (setup wizard)
app.use(flow1Router);
app.use(setupActionsRouter);
// Flow 2 (orchestrator)
app.use(flow2Router);

// ---- HTML --------------------------------------------------------
app.get(['/', '/status'], async (_req, res) => {
  const missing = missingRequiredConfig();
  let discovery = { rg: null, network: { vnets: [], nsgs: [], natGateways: [] }, netError: null };
  let topError = null;
  if (missing.length === 0) {
    try { discovery = await discoverAll(); }
    catch (e) { topError = e.message; }
  }
  const results = getResults();
  const summary = summarize(results);

  let fleetHtml = '';
  let costHtml = '';
  if (summary.allDone) {
    try {
      const fleet = await fleetSnapshot();
      fleetHtml = renderFleet(fleet);
      const recent = readRecent(20);
      const totals = todayMonthTotals();
      costHtml = renderCost({ recent, totals });
    } catch (e) {
      fleetHtml = `<div class="card err"><strong>Fleet error:</strong> ${escapeForError(e.message)}</div>`;
    }
  }

  res.send(renderPage({
    phase1: { results, summary },
    discovery,
    missing,
    topError,
    fleet: fleetHtml,
    cost: costHtml,
    version: config.version,
    adminToken: process.env.REPORT_TOKEN || null,
  }));
});

function escapeForError(s) {
  return String(s || '').replace(/[<>&]/g, '');
}

// ---- Boot --------------------------------------------------------
const missing = missingRequiredConfig();
if (missing.length > 0) {
  console.warn(`[v2] Missing required config: ${missing.join(', ')}`);
  console.warn('[v2] Server will boot but discovery and Flow 1 will be limited until set.');
}

try { updateState((s) => s); }
catch (e) { console.warn(`[v2] Could not init state dir at ${config.dataDir}:`, e.message); }

// Publish version to App Settings so it's visible in the Azure portal.
// Idempotent: only writes if changed (writes trigger an App Service restart,
// so guarding against rewrite avoids a boot loop).
async function publishVersionToAppSettings() {
  if (!config.webAppName || !config.resourceGroup || !config.subscriptionId) return;
  try {
    const current = await getAppSetting('CODELEGION_VERSION');
    if (current === config.version) return;
    await setAppSettings({ CODELEGION_VERSION: config.version });
    console.log(`[v2] published CODELEGION_VERSION=${config.version} to App Settings`);
  } catch (e) {
    console.warn('[v2] could not publish version to App Settings:', e.message);
  }
}

app.listen(config.port, () => {
  console.log(`[v2] controller v${config.version} listening on :${config.port}`);
  console.log(`[v2] subscription=${config.subscriptionId || 'UNSET'} rg=${config.resourceGroup || 'UNSET'} webapp=${config.webAppName || 'UNSET'}`);
  try { startRetirementSweep(); } catch (e) { console.warn('[v2] retirement sweep not started:', e.message); }
  try { startReconcileLoop(); } catch (e) { console.warn('[v2] reconcile loop not started:', e.message); }
  // Fire and forget — don't block boot on App Settings writes.
  publishVersionToAppSettings().catch(() => {});
});
