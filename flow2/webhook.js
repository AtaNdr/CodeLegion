// GitHub webhook handler — decides whether to wake or spin a VM.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listAgents, isAlive, isWakeable, groupByModel, startExistingAgent, spinNewAgent } from '../azure/vm.js';
import { recordHint } from './reconcile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _cfg = null;
function cfg() {
  if (!_cfg) _cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8'));
  return _cfg;
}

export function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.GH_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- Webhook dedup ---------------------------------------------------
// GitHub fires issues.opened AND issues.labeled (one per label) when you
// open an issue with labels already attached. Without dedup we spin one VM
// per webhook delivery for the same issue. Track recent (issueNumber,model)
// pairs in memory and refuse to act if we just acted on the same pair.

const recentSpins = new Map();  // key = `${issueNumber}:${model}` → timestamp
const DEDUP_WINDOW_MS = 120_000;  // 2 minutes covers a typical VM boot

function dedupKey(issueNumber, model) {
  return `${issueNumber}:${model}`;
}

function isDuplicate(issueNumber, model) {
  const now = Date.now();
  for (const [k, ts] of recentSpins) {
    if (now - ts > DEDUP_WINDOW_MS) recentSpins.delete(k);
  }
  return recentSpins.has(dedupKey(issueNumber, model));
}

function markHandled(issueNumber, model) {
  recentSpins.set(dedupKey(issueNumber, model), Date.now());
}

export async function handleWebhook({ event, payload }) {
  if (event !== 'issues') return { action: 'ignored', reason: `event=${event}` };
  if (!['labeled', 'opened', 'reopened'].includes(payload.action)) {
    return { action: 'ignored', reason: `action=${payload.action}` };
  }
  const labels = (payload.issue.labels || []).map(l => l.name);
  if (!labels.includes('agent-ready')) return { action: 'skipped', reason: 'not ready' };
  if (labels.includes('agent:blocked') || labels.includes('agent:do-not-pick')) {
    return { action: 'skipped', reason: 'blocked or do-not-pick' };
  }

  const modelLabel = labels.find(l => l.startsWith('model:'));
  const model = modelLabel ? modelLabel.replace('model:', '') : cfg().fleet.defaultModel;
  if (!['haiku', 'sonnet', 'opus'].includes(model)) {
    return { action: 'error', reason: `unknown model: ${model}` };
  }

  const issueNumber = payload.issue.number;
  if (isDuplicate(issueNumber, model)) {
    console.log(`[webhook] dedup: already handled #${issueNumber}/${model} within last ${DEDUP_WINDOW_MS/1000}s`);
    return { action: 'skipped', reason: 'duplicate within dedup window' };
  }

  const agents = await listAgents();
  const alive = agents.filter(isAlive);
  const aliveByModel = groupByModel(alive);
  const aliveCount = (aliveByModel[model] || []).length;
  const totalAlive = alive.length;
  const fleet = cfg().fleet;

  console.log(`[webhook] issue #${issueNumber} needs ${model}; alive ${aliveCount}/${fleet.maxAgentsPerModel[model]} (total ${totalAlive}/${fleet.maxAgentsTotal})`);

  if (aliveCount >= fleet.maxAgentsPerModel[model]) {
    return { action: 'skipped', reason: `fleet full for ${model}` };
  }
  if (totalAlive >= fleet.maxAgentsTotal) {
    return { action: 'skipped', reason: 'global cap reached' };
  }

  if (aliveCount === 0) {
    // Mark BEFORE the async spin so a concurrent webhook is rejected.
    markHandled(issueNumber, model);
    const repoUrl = payload.repository.clone_url;
    const sleeping = agents.filter(a => isWakeable(a) && a.model === model);
    const sameRepo = sleeping.find(a => a.repo === repoUrl);
    const candidate = sameRepo || sleeping[0];

    const onboarding = labels.includes('agent:onboarding');
    if (candidate) {
      await startExistingAgent(candidate.vmName);
      // Record a hint so the next reconcile pass treats issue N as covered by
      // this waking VM and doesn't spin/wake a second one for the same issue.
      recordHint(candidate.vmName, { issue: issueNumber, model, onboarding });
      return { action: 'waking', vmName: candidate.vmName, sameRepo: !!sameRepo };
    }
    const vmName = await spinNewAgent({ repoUrl, model });
    recordHint(vmName, { issue: issueNumber, model, onboarding });
    return { action: 'spawning', vmName };
  }

  return { action: 'noop', reason: `${aliveCount} ${model} agent(s) already alive` };
}
