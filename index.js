// agent-fleet v2 — controller entrypoint.

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Webhook needs raw body for HMAC signature verify; mount the raw parser ONLY
// on /webhook and JSON parser on the rest.
app.use('/webhook', express.raw({ type: '*/*', limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));

// Static: agent scripts tarball + individual scripts.
app.use('/scripts', express.static(path.join(__dirname, 'scripts-static'), {
  fallthrough: true,
  dotfiles: 'ignore',
}));

// ---- API ---------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true, version: config.version }));

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
  if (summary.allGreen) {
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

app.listen(config.port, () => {
  console.log(`[v2] controller v${config.version} listening on :${config.port}`);
  console.log(`[v2] subscription=${config.subscriptionId || 'UNSET'} rg=${config.resourceGroup || 'UNSET'} webapp=${config.webAppName || 'UNSET'}`);
  try { startRetirementSweep(); } catch (e) { console.warn('[v2] retirement sweep not started:', e.message); }
});
