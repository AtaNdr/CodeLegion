// All Flow 2 routes: webhook, agent callbacks, admin actions, JSON APIs.

import express from 'express';
import crypto from 'crypto';
import { verifySignature } from './webhook.js';
import { appendCostRecord, buildCostRecord, todayMonthTotals, readRecent, commentCostOnIssue } from './cost.js';
import { appendAgentLog, readAgentLog } from './logs.js';
import { recordStatus, appendTimelineLines, readTimeline } from './activity.js';
import { fleetSnapshot } from './vmlist.js';
import { renderFleet } from '../ui/sections/fleet.js';
import { buildSecretsResponse } from './secrets.js';
import {
  listAgents, startExistingAgent, deallocateAgent, deleteAgent,
  spinNewAgent, runShellCommand, cleanupOrphans,
} from '../azure/vm.js';
import { injectFiles, cleanFiles } from '../github/repo.js';
import { cleanAzureResources } from '../azure/uninstall.js';
import { retireStaleAgents } from './retirement.js';
import { selfUpdate, clearUpdateCache, getUpdateInfo } from '../azure/self-update.js';
import { reconcile, getAssignment, clearHint, getReconcileState, recordPoll, getReconcileHistory } from './reconcile.js';
import { isPaused, setPaused, getPauseState } from './pause.js';
import { setAppSettings } from '../azure/app-settings.js';
import { getPricing } from '../anthropic/pricing.js';

const BUSY_STATES = new Set(['claimed', 'planning', 'coding']);
const CLEAR_HINT_STATES = new Set(['claimed', 'planning', 'coding', 'deallocating', 'auth-error', 'config-error']);

export const flow2Router = express.Router();

// ---- Auth helper -------------------------------------------------
function verifyReportToken(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer (.+)$/);
  const token = process.env.REPORT_TOKEN;
  if (!match || !token) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireReportToken(req, res, next) {
  if (!verifyReportToken(req)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function verifyAdminToken(req) {
  const provided = req.headers['x-admin-token'] || req.body?._adminToken;
  const token = process.env.REPORT_TOKEN;  // reuse REPORT_TOKEN for admin actions too
  if (!provided || !token) return false;
  return provided === token;
}

function requireAdminToken(req, res, next) {
  if (!verifyAdminToken(req)) return res.status(401).json({ error: 'admin token required (X-Admin-Token header or _adminToken in body)' });
  next();
}

// ---- Webhook ----------------------------------------------------
// The webhook is now just a low-latency trigger for the reconcile loop —
// it doesn't decide anything itself. Reconcile lists unclaimed issues and
// assigns/wakes/spins as needed.
flow2Router.post('/webhook', (req, res) => {
  const raw = req.body;  // Buffer (mounted with express.raw in index.js)
  if (!Buffer.isBuffer(raw)) return res.status(400).send('expected raw body');
  if (!verifySignature(raw, req.headers['x-hub-signature-256'])) {
    return res.status(401).send('bad signature');
  }
  const event = req.headers['x-github-event'];
  res.json({ ok: true, event, triggered: 'reconcile' });
  // Fire-and-forget: only issue/PR events can change the work queue.
  if (['issues', 'issue_comment', 'pull_request'].includes(event)) {
    reconcile().catch((e) => console.error('[webhook→reconcile]', e.message));
  }
});

// ---- Agent callbacks -------------------------------------------
flow2Router.post('/agent/log', requireReportToken, (req, res) => {
  const { agent, vmName, level, message } = req.body || {};
  if (!agent || !message) return res.status(400).json({ error: 'agent + message required' });
  appendAgentLog(vmName || agent, agent, level, message);
  res.json({ ok: true });
});

flow2Router.get('/agent/logs/:name', (req, res) => {
  const log = readAgentLog(req.params.name);
  res.type('text/plain').send(log || '(no log yet)');
});

flow2Router.post('/agent/status', requireReportToken, (req, res) => {
  const { vmName, state, issue, summary, agentName, agentEmoji } = req.body || {};
  if (!vmName) return res.status(400).json({ error: 'vmName required' });
  recordStatus({ vmName, state, issue, summary, agentName, agentEmoji });
  // Drop the assignment hint when the agent is genuinely working (busy is
  // now tracked by status) OR when it's leaving the pool (deallocating /
  // errored — assignment would never be picked up).
  if (CLEAR_HINT_STATES.has(state)) clearHint(vmName);
  res.json({ ok: true });
});

// The agent asks what to work on. Returns its current controller assignment
// (or null). The agent then claims + executes it.
flow2Router.get('/agent/next-task', requireReportToken, (req, res) => {
  const vm = req.query.vm;
  if (!vm) return res.status(400).json({ error: 'vm query param required' });
  const a = getAssignment(vm);
  recordPoll(vm, a ? 'assigned' : 'no-work', a ? a.issue : null);
  res.json({ issue: a ? a.issue : null, onboarding: a ? !!a.onboarding : false });
});

// Cheap auth/reachability probe — agents hit this at boot to fail fast when
// REPORT_TOKEN has drifted (rather than spinning silently for 10 minutes).
flow2Router.get('/agent/heartbeat', requireReportToken, (_req, res) => {
  res.json({ ok: true });
});

flow2Router.post('/agent/sync', requireReportToken, (req, res) => {
  const { vmName, lines } = req.body || {};
  if (!vmName) return res.status(400).json({ error: 'vmName required' });
  if (!lines) return res.json({ ok: true, written: 0 });
  const written = appendTimelineLines(vmName, lines);
  res.json({ ok: true, written });
});

flow2Router.get('/agent/secrets', requireReportToken, async (_req, res) => {
  try {
    const secrets = await buildSecretsResponse();
    res.json(secrets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

flow2Router.post('/agent/deallocate', requireReportToken, async (req, res) => {
  const { vmName, agentName } = req.body || {};
  if (!vmName) return res.status(400).json({ error: 'vmName required' });
  console.log(`[agent/deallocate] from ${agentName || '?'} for ${vmName}`);
  await deallocateAgent(vmName);
  res.json({ ok: true, vmName, action: 'deallocating' });
});

// ---- Cost ------------------------------------------------------
flow2Router.post('/cost/report', requireReportToken, (req, res) => {
  const { agent, model, issue } = req.body || {};
  if (!agent || !model || !issue) return res.status(400).json({ error: 'agent, model, issue required' });
  const record = buildCostRecord(req.body);
  appendCostRecord(record);
  res.json({ ok: true, cost: record.cost });
  // Fire-and-forget: post a cost-summary comment on the issue. Failures
  // are logged inside the helper; the response is already sent so a slow
  // GitHub round-trip can't block the agent's next loop iteration.
  commentCostOnIssue(record).catch(() => {});
});

flow2Router.get('/cost/summary', (_req, res) => {
  const totals = todayMonthTotals();
  res.json({ ...totals, recent: readRecent(20) });
});

// ---- Fleet inspection -----------------------------------------
flow2Router.get('/fleet', async (_req, res) => {
  try { res.json(await fleetSnapshot()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Rendered HTML fragment for the dashboard's fleet section. The client
// polls this every 30s and innerHTML-swaps the fleet container, instead
// of reloading the whole page (which makes Environment & discovery flicker
// every refresh and resets the user's scroll/selection).
flow2Router.get('/fleet/section', async (_req, res) => {
  try {
    const snap = await fleetSnapshot();
    res.type('text/html').send(renderFleet(snap));
  } catch (e) {
    res.status(500).type('text/html').send(`<div class="card err"><strong>Fleet error:</strong> ${String(e.message || e).replace(/[<>&]/g, '')}</div>`);
  }
});

flow2Router.get('/admin/vm/:name/timeline', (req, res) => {
  const events = readTimeline(req.params.name, { tail: 100 });
  res.json({ events });
});

// ---- Admin actions --------------------------------------------
flow2Router.delete('/admin/vm/:name', requireAdminToken, async (req, res) => {
  try { await deleteAgent(req.params.name); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.post('/admin/vm/:name/wake', requireAdminToken, async (req, res) => {
  try { await startExistingAgent(req.params.name); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.post('/admin/vm/:name/sleep', requireAdminToken, async (req, res) => {
  try { await deallocateAgent(req.params.name); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.post('/admin/vm/:name/force-sync', requireAdminToken, async (req, res) => {
  try {
    const out = await runShellCommand(req.params.name, [
      'OFFSET=$(cat /var/lib/agent/last-sync-offset 2>/dev/null || echo 0)',
      'tail -c +$((OFFSET+1)) /var/lib/agent/activity.jsonl 2>/dev/null || true',
    ]);
    const lines = out.split('\n').filter(Boolean);
    const written = appendTimelineLines(req.params.name, lines);
    res.json({ ok: true, written, raw: out.slice(0, 2000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

flow2Router.post('/admin/wake-all', requireAdminToken, async (_req, res) => {
  const agents = await listAgents();
  const woken = [];
  for (const a of agents) {
    if (a.powerState === 'deallocated' || a.powerState === 'stopped') {
      await startExistingAgent(a.vmName);
      woken.push(a.vmName);
    }
  }
  res.json({ ok: true, woken });
});

flow2Router.post('/admin/sleep-all', requireAdminToken, async (_req, res) => {
  const agents = await listAgents();
  const slept = [];
  for (const a of agents) {
    if (a.powerState === 'running' || a.powerState === 'starting') {
      await deallocateAgent(a.vmName);
      slept.push(a.vmName);
    }
  }
  res.json({ ok: true, slept });
});

flow2Router.post('/admin/spin', requireAdminToken, async (req, res) => {
  const { repo, model = 'sonnet' } = req.body || {};
  const repoUrl = repo || (process.env.GH_REPO_OWNER && process.env.GH_REPO_NAME
    ? `https://github.com/${process.env.GH_REPO_OWNER}/${process.env.GH_REPO_NAME}.git` : null);
  if (!repoUrl) return res.status(400).json({ error: 'repo required (or set GH_REPO_OWNER/NAME)' });
  try {
    const vmName = await spinNewAgent({ repoUrl, model });
    res.json({ ok: true, vmName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

flow2Router.post('/admin/inject-repo', requireAdminToken, async (_req, res) => {
  try { res.json({ ok: true, results: await injectFiles() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.post('/admin/clean-repo', requireAdminToken, async (_req, res) => {
  try { res.json({ ok: true, results: await cleanFiles() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.post('/admin/retire-stale', requireAdminToken, async (_req, res) => {
  try { res.json(await retireStaleAgents()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.post('/admin/reconcile', requireAdminToken, async (_req, res) => {
  try { await reconcile(); res.json(getReconcileState()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.get('/admin/reconcile/history', (_req, res) => {
  res.json({ runs: getReconcileHistory() });
});

flow2Router.post('/admin/cleanup-orphans', requireAdminToken, async (_req, res) => {
  try { res.json(await cleanupOrphans()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Pause: halt reconcile + deallocate every running agent. Resume: clear the
// flag; reconcile picks up assignments on the next tick (45s) or via webhook.
flow2Router.post('/admin/fleet/pause', requireAdminToken, async (req, res) => {
  try {
    setPaused(true, (req.body && req.body.reason) || null);
    const agents = await listAgents();
    const slept = [];
    for (const a of agents) {
      if (a.powerState === 'running' || a.powerState === 'starting') {
        await deallocateAgent(a.vmName);
        slept.push(a.vmName);
      }
    }
    res.json({ ok: true, paused: true, slept });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.post('/admin/fleet/resume', requireAdminToken, async (_req, res) => {
  setPaused(false);
  // Kick the reconcile loop so the UI updates without waiting 45s.
  reconcile().catch((e) => console.error('[resume→reconcile]', e.message));
  res.json({ ok: true, paused: false });
});

flow2Router.get('/admin/fleet/pause-state', (_req, res) => {
  res.json(getPauseState());
});

// Edit VM sizes per model. Writes VM_SIZE_HAIKU/SONNET/OPUS App Settings;
// also hot-sets process.env so spinNewAgent uses the new sizes immediately
// without waiting for the App Service restart that follows the write.
flow2Router.post('/admin/vm-config', requireAdminToken, async (req, res) => {
  const body = req.body || {};
  const patch = {};
  for (const m of ['haiku', 'sonnet', 'opus']) {
    const v = body[m];
    if (typeof v === 'string' && v.trim()) {
      if (!/^[A-Za-z0-9_]+$/.test(v.trim())) {
        return res.status(400).json({ error: `invalid size for ${m}: ${v}` });
      }
      patch[`VM_SIZE_${m.toUpperCase()}`] = v.trim();
    }
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no sizes provided (expected haiku/sonnet/opus)' });
  }
  try {
    await setAppSettings(patch);
    for (const [k, v] of Object.entries(patch)) process.env[k] = v;
    res.json({ ok: true, patch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set or clear the PRICING_JSON override. Body { json: "<stringified>" }
// or { json: null|"" } to clear and revert to bundled.
flow2Router.post('/admin/pricing-override', requireAdminToken, async (req, res) => {
  const body = req.body || {};
  if (body.json === null || body.json === '') {
    try {
      await setAppSettings({ PRICING_JSON: '' });
      delete process.env.PRICING_JSON;
      return res.json({ ok: true, cleared: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  if (typeof body.json !== 'string') {
    return res.status(400).json({ error: 'expected json: <stringified> or null to clear' });
  }
  try {
    const parsed = JSON.parse(body.json);
    if (!parsed || !parsed.models || typeof parsed.models !== 'object') {
      return res.status(400).json({ error: 'parsed JSON must have a `models` object' });
    }
    await setAppSettings({ PRICING_JSON: body.json });
    process.env.PRICING_JSON = body.json;
    res.json({ ok: true, models: Object.keys(parsed.models).length });
  } catch (e) {
    res.status(400).json({ error: 'invalid JSON: ' + e.message });
  }
});

// Read current pricing — for pre-filling the edit modal.
flow2Router.get('/admin/pricing', (_req, res) => {
  res.json(getPricing());
});

// Uninstall — three scopes. All pause the fleet up front (clean-repo via
// the modal text; clean-azure inside cleanAzureResources itself). All
// destructive. Each returns a structured summary the UI can render.
flow2Router.post('/admin/uninstall/:scope', requireAdminToken, async (req, res) => {
  const scope = req.params.scope;
  if (!['repo', 'azure', 'both'].includes(scope)) {
    return res.status(400).json({ error: `unknown scope: ${scope} (expected repo|azure|both)` });
  }
  const out = {};
  try {
    if (scope === 'repo' || scope === 'both') {
      out.repo = { results: await cleanFiles() };
    }
    if (scope === 'azure' || scope === 'both') {
      out.azure = await cleanAzureResources();
    }
    res.json({ ok: true, scope, ...out });
  } catch (e) {
    res.status(500).json({ error: e.message, ...out });
  }
});

flow2Router.post('/admin/self-update', requireAdminToken, async (_req, res) => {
  try { res.json(await selfUpdate()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Force a fresh update-info fetch (bypass the 5-min cache). Useful after
// setting / changing UPDATE_TOKEN to verify it works without waiting.
flow2Router.post('/admin/check-update', requireAdminToken, async (_req, res) => {
  try { clearUpdateCache(); res.json(await getUpdateInfo()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
