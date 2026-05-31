// Cost storage — JSONL on the Web App's persistent disk.
// Each line is a cost record: { timestamp, agent, model, issue, kind, input,
// output, cacheCreate, cacheRead, durationSeconds, cost }.

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { calculateCost } from '../anthropic/pricing.js';
import { ghFetch } from '../github/app.js';

const COST_LOG = path.join(config.dataDir, 'cost.jsonl');

function ensureDir() {
  fs.mkdirSync(path.dirname(COST_LOG), { recursive: true });
}

export function appendCostRecord(record) {
  ensureDir();
  fs.appendFileSync(COST_LOG, JSON.stringify(record) + '\n');
}

export function readAll() {
  if (!fs.existsSync(COST_LOG)) return [];
  return fs.readFileSync(COST_LOG, 'utf8')
    .split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

export function readRecent(n = 20) {
  return readAll().slice(-n).reverse();
}

export function todayMonthTotals() {
  const reports = readAll();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const sum = (arr, key = 'cost') => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const tokenSum = (arr) => arr.reduce((s, r) => s + (r.input || 0) + (r.output || 0) + (r.cacheCreate || 0) + (r.cacheRead || 0), 0);

  const today = reports.filter(r => new Date(r.timestamp).getTime() >= startOfDay);
  const month = reports.filter(r => new Date(r.timestamp).getTime() >= startOfMonth);

  const byModelMonth = {};
  for (const model of ['haiku', 'sonnet', 'opus']) {
    byModelMonth[model] = { cost: sum(month.filter(r => r.model === model)) };
  }

  return {
    today: { cost: sum(today), tokens: tokenSum(today), count: today.length },
    month: { cost: sum(month), tokens: tokenSum(month), count: month.length },
    byModelMonth,
  };
}

export function buildCostRecord({ agent, agentEmoji, model, issue, kind, input, output, cacheCreate, cacheRead, durationSeconds }) {
  const cost = calculateCost({ model, input, output, cacheCreate, cacheRead });
  return {
    timestamp: new Date().toISOString(),
    agent, agentEmoji: agentEmoji || null,
    model, issue, kind: kind || 'task',
    input: Number(input || 0),
    output: Number(output || 0),
    cacheCreate: Number(cacheCreate || 0),
    cacheRead: Number(cacheRead || 0),
    durationSeconds: Number(durationSeconds || 0),
    cost,
  };
}

export { calculateCost };

// Post a cost summary as a comment on the issue, so the same trail of
// per-task spend lives on GitHub alongside the agent's plan + PR comments.
// Best-effort: failures are logged but don't break the controller response.
const fmtTokens = (n) => n >= 1_000_000 ? (n / 1e6).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
const fmtDuration = (s) => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
const fmtCost = (c) => c < 0.01 ? '$' + c.toFixed(4) : c < 1 ? '$' + c.toFixed(3) : '$' + c.toFixed(2);

export async function commentCostOnIssue(record) {
  // Skip non-task kinds (explorer/preview/etc.) to avoid noise.
  if (record.kind && record.kind !== 'task') return;
  if (!record.issue) return;
  // Skip $0 reports — no real spend (mostly happens when usage parsing failed).
  if (!record.cost || record.cost < 0.000001) return;

  const owner = process.env.GH_REPO_OWNER;
  const repo = process.env.GH_REPO_NAME;
  if (!owner || !repo) return;

  const totalTokens = (record.input || 0) + (record.output || 0) + (record.cacheCreate || 0) + (record.cacheRead || 0);
  const agentLabel = record.agentEmoji ? `${record.agentEmoji} ${record.agent}` : (record.agent || 'agent');
  const body = `💰 **Task cost: ${fmtCost(record.cost)}** — ${record.model} · ${fmtTokens(totalTokens)} tokens · ${fmtDuration(record.durationSeconds)}\n\n` +
    `<sub>by ${agentLabel} · input ${fmtTokens(record.input)} · output ${fmtTokens(record.output)} · cache write ${fmtTokens(record.cacheCreate)} · cache read ${fmtTokens(record.cacheRead)}</sub>`;

  try {
    const resp = await ghFetch(`/repos/${owner}/${repo}/issues/${record.issue}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[cost] comment on #${record.issue} failed: ${resp.status} ${text.slice(0, 120)}`);
    }
  } catch (e) {
    console.warn(`[cost] comment on #${record.issue} threw:`, e.message);
  }
}
