// Controller-driven orchestration.
//
// Instead of agents polling GitHub and self-claiming (which raced and
// double-claimed), the controller periodically reconciles: it lists
// unclaimed agent-ready issues and the fleet's live status, then ASSIGNS
// each unclaimed issue to a free agent of the matching model. Agents ask
// `GET /agent/next-task?vm=…` and execute their assignment.
//
// Assignments are short-lived hints (a reservation) that expire once the
// agent reports it's working, or after a TTL — so the same issue is never
// assigned to two VMs.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ghFetch } from '../github/app.js';
import {
  listAgents, isAlive, isWakeable, groupByModel,
  startExistingAgent, spinNewAgent, inFlightCount, getVmCreateOutcomes,
} from '../azure/vm.js';
import { allStatus } from './activity.js';
import { findOpenOnboardingIssue, repoNeedsOnboarding, ensureOnboardingIssue } from '../github/repo.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _cfg = null;
function cfg() {
  if (!_cfg) _cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8'));
  return _cfg;
}

// Labels that start with "agent:" but are NOT a claim by a specific agent.
const CLAIM_EXCEPTIONS = new Set([
  'agent:onboarding', 'agent:needs-revision', 'agent:blocked', 'agent:do-not-pick', 'agent:approved',
]);
const BUSY_STATES = new Set(['claimed', 'planning', 'coding']);
// States that mean the VM is NOT eligible for new assignment (about to be
// gone, or genuinely broken). Without this, we'd race-assign to a VM that's
// in self_deallocate's 5-min wait and will never poll again.
const UNAVAILABLE_STATES = new Set(['deallocating', 'failed', 'auth-error', 'config-error']);
const HINT_TTL_MS = 90_000;

// vmName → { issue, model, onboarding, at }
const hints = new Map();

// Last reconcile summary, surfaced in the UI for visibility.
let lastRun = null;
// Rolling history of recent reconcile runs (newest last). Bounded so memory
// stays small; survives until the Web App restarts.
const HISTORY_MAX = 50;
const runHistory = [];

// vmName → { pollCount, lastPolledAt, lastResult, lastAssignedIssue }
// Updated by the /agent/next-task handler; surfaced in the fleet UI so you
// can see whether an agent is actually polling and what it's getting back.
const pollTelemetry = new Map();

export function recordPoll(vmName, result, assignedIssue) {
  const t = pollTelemetry.get(vmName) || { pollCount: 0 };
  t.pollCount++;
  t.lastPolledAt = Date.now();
  t.lastResult = result;
  t.lastAssignedIssue = assignedIssue;
  pollTelemetry.set(vmName, t);
}

export function getPollTelemetry(vmName) {
  const t = pollTelemetry.get(vmName);
  if (!t) return null;
  return { ...t, ageSeconds: Math.round((Date.now() - t.lastPolledAt) / 1000) };
}

const isClaimLabel = (name) => name.startsWith('agent:') && !CLAIM_EXCEPTIONS.has(name);

export function getReconcileState() {
  return {
    lastRun,
    assignments: Array.from(hints.entries()).map(([vm, h]) => ({
      vm, issue: h.issue, onboarding: h.onboarding, ageSeconds: Math.round((Date.now() - h.at) / 1000),
    })),
    historyCount: runHistory.length,
    vmOutcomes: getVmCreateOutcomes().slice(0, 10),
  };
}

export function getReconcileHistory() {
  // Newest first.
  return runHistory.slice().reverse();
}

// Per-VM assignment for the fleet UI (so a card shows its assigned issue
// even before the agent has reported a status).
export function assignmentFor(vmName) {
  const h = hints.get(vmName);
  if (!h || Date.now() - h.at > HINT_TTL_MS) return null;
  return { issue: h.issue, onboarding: h.onboarding };
}

export async function listUnclaimedIssues() {
  const o = process.env.GH_REPO_OWNER, r = process.env.GH_REPO_NAME;
  if (!o || !r) return [];
  const resp = await ghFetch(`/repos/${o}/${r}/issues?state=open&labels=agent-ready&per_page=100`);
  if (!resp.ok) return [];
  const arr = await resp.json();
  const out = [];
  for (const it of arr) {
    if (it.pull_request) continue;
    const labels = (it.labels || []).map(l => (typeof l === 'string' ? l : l.name));
    if (labels.includes('agent:blocked') || labels.includes('agent:do-not-pick')) continue;
    if (labels.some(isClaimLabel)) continue;  // already claimed by an agent
    const modelLabel = labels.find(l => l.startsWith('model:'));
    let model = modelLabel ? modelLabel.replace('model:', '') : cfg().fleet.defaultModel;
    if (!['haiku', 'sonnet', 'opus'].includes(model)) model = cfg().fleet.defaultModel;
    out.push({ number: it.number, model, onboarding: labels.includes('agent:onboarding') });
  }
  // Onboarding first, then oldest issue number first.
  out.sort((a, b) => (Number(b.onboarding) - Number(a.onboarding)) || (a.number - b.number));
  return out;
}

export function clearHint(vmName) { hints.delete(vmName); }

export function getAssignment(vmName) {
  const h = hints.get(vmName);
  if (!h) return null;
  if (Date.now() - h.at > HINT_TTL_MS) { hints.delete(vmName); return null; }
  return h;
}

async function ensureCapacity(neededByModel, agents) {
  const fleet = cfg().fleet;
  const actions = [];
  for (const [model, count] of Object.entries(neededByModel)) {
    if (count <= 0) continue;
    const alive = agents.filter(isAlive);
    if (alive.length >= fleet.maxAgentsTotal) {
      actions.push({ model, action: 'skipped', reason: 'global cap reached' });
      break;
    }
    const aliveOfModel = alive.filter(a => a.model === model).length;
    const inFlight = inFlightCount(model);
    // Count in-flight creates toward capacity — otherwise we'd respawn every
    // 45s while a VM is mid-provisioning.
    if (aliveOfModel + inFlight >= fleet.maxAgentsPerModel[model]) {
      actions.push({ model, action: 'skipped', reason: `${model} cap reached (alive ${aliveOfModel}, in-flight ${inFlight})` });
      continue;
    }
    if (inFlight > 0) {
      actions.push({ model, action: 'waiting', reason: `${inFlight} ${model} VM(s) still creating — not spinning another` });
      continue;
    }

    const sleeping = agents.filter(a => isWakeable(a) && a.model === model);
    if (sleeping[0]) {
      try {
        await startExistingAgent(sleeping[0].vmName);
        actions.push({ model, action: 'waking', vmName: sleeping[0].vmName });
        console.log(`[reconcile] woke ${sleeping[0].vmName} for ${model}`);
      } catch (e) {
        actions.push({ model, action: 'wake-failed', vmName: sleeping[0].vmName, error: e.message });
        console.error(`[reconcile] wake failed for ${sleeping[0].vmName}:`, e.message);
      }
    } else {
      const repoUrl = `https://github.com/${process.env.GH_REPO_OWNER}/${process.env.GH_REPO_NAME}.git`;
      try {
        const vmName = await spinNewAgent({ repoUrl, model });
        actions.push({ model, action: 'spinning', vmName });
        console.log(`[reconcile] spun ${vmName} for ${model}`);
      } catch (e) {
        // spinNewAgent's awaited steps (NIC create, location lookup) can throw.
        // The fire-and-forget VM create can fail later — that won't reach here,
        // but the NIC failure (subnet exhaustion) does.
        actions.push({ model, action: 'spin-failed', error: e.message });
        console.error(`[reconcile] spin failed for ${model}:`, e.message);
      }
    }
  }
  return actions;
}

let _running = false;
export async function reconcile() {
  if (_running) return;
  _running = true;
  try {
    if (!config.subscriptionId || !process.env.GH_REPO_OWNER || !process.env.GH_REPO_NAME) return;

    // Keep the onboarding issue alive while the repo needs it (cheap: one
    // API call unless none is open).
    try {
      const open = await findOpenOnboardingIssue();
      if (!open && await repoNeedsOnboarding()) {
        const ob = await ensureOnboardingIssue();
        console.log(`[reconcile] ensured onboarding issue #${ob.number}`);
      }
    } catch (e) { /* non-fatal */ }

    const agents = await listAgents();
    const alive = agents.filter(isAlive);

    // Expire hints for dead VMs or past TTL.
    for (const [vm, h] of hints) {
      if (Date.now() - h.at > HINT_TTL_MS || !alive.find(a => a.vmName === vm)) hints.delete(vm);
    }

    const unclaimed = await listUnclaimedIssues();
    const statuses = allStatus();

    // A VM is unassignable if it's actively working, holds an unexpired hint,
    // OR is in a terminal/unavailable state (deallocating, auth-error,
    // config-error, failed). Without the last category we'd race-assign to a
    // VM that just hit idle-timeout: it's still powerState='running' for a
    // few seconds while self_deallocate's 5-min wait runs, then it's gone.
    const busy = new Set();
    const unavailable = new Set();
    for (const a of alive) {
      const st = statuses[a.vmName];
      if (st && BUSY_STATES.has(st.state)) busy.add(a.vmName);
      if (st && UNAVAILABLE_STATES.has(st.state)) unavailable.add(a.vmName);
      if (hints.has(a.vmName)) busy.add(a.vmName);
    }
    const free = alive.filter(a =>
      a.powerState === 'running' && !busy.has(a.vmName) && !unavailable.has(a.vmName)
    );

    const assignedIssues = new Set(Array.from(hints.values()).map(h => h.issue));
    const newAssignments = [];
    const needCapacity = {};
    for (const issue of unclaimed) {
      if (assignedIssues.has(issue.number)) continue;
      const agent = free.find(a => a.model === issue.model && !hints.has(a.vmName));
      if (agent) {
        hints.set(agent.vmName, { issue: issue.number, model: issue.model, onboarding: issue.onboarding, at: Date.now() });
        assignedIssues.add(issue.number);
        newAssignments.push({ vm: agent.vmName, issue: issue.number, model: issue.model });
        console.log(`[reconcile] assigned #${issue.number} (${issue.model}) → ${agent.vmName}`);
      } else {
        needCapacity[issue.model] = (needCapacity[issue.model] || 0) + 1;
      }
    }
    let capacityActions = [];
    if (Object.keys(needCapacity).length) capacityActions = await ensureCapacity(needCapacity, agents);

    lastRun = {
      at: new Date().toISOString(),
      unclaimedCount: unclaimed.length,
      unclaimed: unclaimed.map(i => ({ issue: i.number, model: i.model, onboarding: i.onboarding })),
      aliveCount: alive.length,
      freeCount: free.length,
      assigned: newAssignments,
      needCapacity,
      capacityActions,
    };
  } catch (e) {
    console.error('[reconcile] error:', e.message);
    lastRun = { at: new Date().toISOString(), error: e.message };
  } finally {
    _running = false;
    // Push to rolling history (append-only, capped). Done in finally so even
    // errored runs are recorded for diagnosis.
    if (lastRun) {
      runHistory.push(lastRun);
      while (runHistory.length > HISTORY_MAX) runHistory.shift();
    }
  }
}

export function startReconcileLoop() {
  const intervalMs = (cfg().reconcile?.intervalSeconds || 45) * 1000;
  setTimeout(() => reconcile().catch(() => {}), 10_000);
  setInterval(() => reconcile().catch(() => {}), intervalMs);
  console.log(`[reconcile] loop every ${intervalMs / 1000}s`);
}
