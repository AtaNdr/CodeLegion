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
  startExistingAgent, spinNewAgent,
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
const HINT_TTL_MS = 90_000;

// vmName → { issue, model, onboarding, at }
const hints = new Map();

const isClaimLabel = (name) => name.startsWith('agent:') && !CLAIM_EXCEPTIONS.has(name);

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
  for (const [model, count] of Object.entries(neededByModel)) {
    if (count <= 0) continue;
    const alive = agents.filter(isAlive);
    if (alive.length >= fleet.maxAgentsTotal) break;
    const aliveOfModel = alive.filter(a => a.model === model).length;
    if (aliveOfModel >= fleet.maxAgentsPerModel[model]) continue;

    const sleeping = agents.filter(a => isWakeable(a) && a.model === model);
    if (sleeping[0]) {
      await startExistingAgent(sleeping[0].vmName);
      console.log(`[reconcile] woke ${sleeping[0].vmName} for ${model}`);
    } else {
      const repoUrl = `https://github.com/${process.env.GH_REPO_OWNER}/${process.env.GH_REPO_NAME}.git`;
      const vmName = await spinNewAgent({ repoUrl, model });
      console.log(`[reconcile] spun ${vmName} for ${model}`);
    }
  }
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
    if (unclaimed.length === 0) return;

    const statuses = allStatus();
    // A VM is busy if it's actively working OR holds an unexpired hint.
    const busy = new Set();
    for (const a of alive) {
      const st = statuses[a.vmName];
      if (st && BUSY_STATES.has(st.state)) busy.add(a.vmName);
      if (hints.has(a.vmName)) busy.add(a.vmName);
    }
    const free = alive.filter(a => !busy.has(a.vmName));

    const assignedIssues = new Set(Array.from(hints.values()).map(h => h.issue));
    const needCapacity = {};
    for (const issue of unclaimed) {
      if (assignedIssues.has(issue.number)) continue;
      const agent = free.find(a => a.model === issue.model && !hints.has(a.vmName));
      if (agent) {
        hints.set(agent.vmName, { issue: issue.number, model: issue.model, onboarding: issue.onboarding, at: Date.now() });
        assignedIssues.add(issue.number);
        console.log(`[reconcile] assigned #${issue.number} (${issue.model}) → ${agent.vmName}`);
      } else {
        needCapacity[issue.model] = (needCapacity[issue.model] || 0) + 1;
      }
    }
    if (Object.keys(needCapacity).length) await ensureCapacity(needCapacity, agents);
  } catch (e) {
    console.error('[reconcile] error:', e.message);
  } finally {
    _running = false;
  }
}

export function startReconcileLoop() {
  const intervalMs = (cfg().reconcile?.intervalSeconds || 45) * 1000;
  setTimeout(() => reconcile().catch(() => {}), 10_000);
  setInterval(() => reconcile().catch(() => {}), intervalMs);
  console.log(`[reconcile] loop every ${intervalMs / 1000}s`);
}
