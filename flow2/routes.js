// All Flow 2 routes: webhook, agent callbacks, admin actions, JSON APIs.

import express from 'express';
import crypto from 'crypto';
import { verifySignature } from './webhook.js';
import { appendCostRecord, buildCostRecord, todayMonthTotals, readRecent } from './cost.js';
import { appendAgentLog, readAgentLog } from './logs.js';
import { recordStatus, appendTimelineLines, readTimeline } from './activity.js';
import { fleetSnapshot } from './vmlist.js';
import { buildSecretsResponse } from './secrets.js';
import {
  listAgents, startExistingAgent, deallocateAgent, deleteAgent,
  spinNewAgent, runShellCommand, cleanupOrphanedNics,
} from '../azure/vm.js';
import { injectFiles, cleanFiles } from '../github/repo.js';
import { retireStaleAgents } from './retirement.js';
import { selfUpdate } from '../azure/self-update.js';
import { reconcile, getAssignment, clearHint, getReconcileState, recordPoll } from './reconcile.js';

const BUSY_STATES = new Set(['claimed', 'planning', 'coding']);

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
  const { vmName, state, issue, summary } = req.body || {};
  if (!vmName) return res.status(400).json({ error: 'vmName required' });
  recordStatus({ vmName, state, issue, summary });
  // Once the agent is genuinely working, drop its assignment hint — its
  // "busy" state is now tracked by status, and the hint reservation is done.
  if (BUSY_STATES.has(state)) clearHint(vmName);
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

flow2Router.post('/admin/cleanup-nics', requireAdminToken, async (_req, res) => {
  try { res.json(await cleanupOrphanedNics()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

flow2Router.post('/admin/self-update', requireAdminToken, async (_req, res) => {
  try { res.json(await selfUpdate()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
