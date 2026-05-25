// GitHub webhook handler — decides whether to wake or spin a VM.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listAgents, isAlive, isWakeable, groupByModel, startExistingAgent, spinNewAgent } from '../azure/vm.js';

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

  const agents = await listAgents();
  const alive = agents.filter(isAlive);
  const aliveByModel = groupByModel(alive);
  const aliveCount = (aliveByModel[model] || []).length;
  const totalAlive = alive.length;
  const fleet = cfg().fleet;

  console.log(`[webhook] issue #${payload.issue.number} needs ${model}; alive ${aliveCount}/${fleet.maxAgentsPerModel[model]} (total ${totalAlive}/${fleet.maxAgentsTotal})`);

  if (aliveCount >= fleet.maxAgentsPerModel[model]) {
    return { action: 'skipped', reason: `fleet full for ${model}` };
  }
  if (totalAlive >= fleet.maxAgentsTotal) {
    return { action: 'skipped', reason: 'global cap reached' };
  }

  if (aliveCount === 0) {
    const repoUrl = payload.repository.clone_url;
    const sleeping = agents.filter(a => isWakeable(a) && a.model === model);
    const sameRepo = sleeping.find(a => a.repo === repoUrl);
    const candidate = sameRepo || sleeping[0];

    if (candidate) {
      await startExistingAgent(candidate.vmName);
      return { action: 'waking', vmName: candidate.vmName, sameRepo: !!sameRepo };
    }
    const vmName = await spinNewAgent({ repoUrl, model });
    return { action: 'spawning', vmName };
  }

  return { action: 'noop', reason: `${aliveCount} ${model} agent(s) already alive` };
}
